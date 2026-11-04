-- Operational locations: each restaurant registers its places once (CEP and number required),
-- coordinates are resolved from the server-written geocoding cache and confirmed on the location,
-- and operations select a resolved location instead of typing an address.
-- Apply after 20261104200000_geocoding_cache.sql and 20261104210000_operational_location_readiness.sql.
-- Existing locations and operations are not modified.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE dependency text;
BEGIN
  FOREACH dependency IN ARRAY ARRAY[
    'public.save_work_location(text,text,text,text,text,text,text,uuid,integer)',
    'public.manage_work_location(uuid,text,integer)',
    'public.create_restaurant_job(text,text,date,time without time zone,time without time zone,numeric,text,uuid,integer,uuid,integer)',
    'public.create_restaurant_demand(text,text,date,time without time zone,time without time zone,numeric,text,uuid,integer,uuid,integer)',
    'public.operational_location_ready(public.jobs)',
    'public.attest_geocoded_work_location()',
    'public.normalize_geocoding_field(text)'
  ] LOOP
    IF to_regprocedure(dependency) IS NULL THEN
      RAISE EXCEPTION 'Operational locations preflight: missing %.', dependency;
    END IF;
  END LOOP;
  IF to_regclass('public.geocoding_cache') IS NULL THEN
    RAISE EXCEPTION 'Operational locations preflight: geocoding cache is missing.';
  END IF;
END;
$preflight$;

ALTER TABLE public.work_locations
  ADD COLUMN kind text NOT NULL DEFAULT 'permanent' CHECK (kind IN ('permanent', 'temporary')),
  ADD COLUMN valid_until date,
  ADD COLUMN geocoding_precision text CHECK (geocoding_precision IN ('house', 'street', 'device')),
  ADD COLUMN candidate_latitude double precision,
  ADD COLUMN candidate_longitude double precision,
  ADD COLUMN geocoded_address jsonb CHECK (geocoded_address IS NULL OR jsonb_typeof(geocoded_address) = 'object'),
  ADD COLUMN confirmed_at timestamptz,
  ADD CONSTRAINT work_locations_kind_validity_check CHECK (
    (kind = 'temporary') = (valid_until IS NOT NULL) AND NOT (kind = 'temporary' AND is_default)
  ),
  ADD CONSTRAINT work_locations_candidate_check CHECK (
    (candidate_latitude IS NULL AND candidate_longitude IS NULL)
    OR (candidate_latitude BETWEEN -90 AND 90 AND candidate_longitude BETWEEN -180 AND 180)
  );

-- New or re-addressed locations need CEP and number; legacy rows stay editable for archive/default.
CREATE FUNCTION public.require_operational_location_address()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.is_default AND NEW.kind = 'temporary' THEN
    RAISE EXCEPTION 'Um local temporário não pode ser o endereço principal.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' OR ROW(NEW.address, NEW.number, NEW.neighborhood, NEW.city, NEW.state, NEW.postal_code)
    IS DISTINCT FROM ROW(OLD.address, OLD.number, OLD.neighborhood, OLD.city, OLD.state, OLD.postal_code) THEN
    IF NEW.postal_code !~ '^[0-9]{8}$' THEN
      RAISE EXCEPTION 'Informe um CEP válido com 8 dígitos.' USING ERRCODE = '22023';
    END IF;
    IF btrim(NEW.number) = '' THEN
      RAISE EXCEPTION 'Informe o número do endereço.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.address_version IS DISTINCT FROM OLD.address_version THEN
    NEW.geocoding_precision := NULL;
    NEW.candidate_latitude := NULL;
    NEW.candidate_longitude := NULL;
    NEW.geocoded_address := NULL;
    NEW.confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.require_operational_location_address() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_locations_require_operational_address BEFORE INSERT OR UPDATE ON public.work_locations
  FOR EACH ROW EXECUTE FUNCTION public.require_operational_location_address();

-- Same attestation as 20261104200000, plus an explicit bypass used only inside confirm_work_location.
CREATE OR REPLACE FUNCTION public.attest_geocoded_work_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.geocoding_status = 'resolved'
    AND current_setting('extrachef.confirming_location', true) = NEW.id::text THEN
    RETURN NEW;
  END IF;
  IF NEW.geocoding_status='resolved' AND (
    TG_OP='INSERT' OR ROW(NEW.latitude,NEW.longitude,NEW.address,NEW.number,NEW.neighborhood,NEW.city,NEW.state,NEW.postal_code)
      IS DISTINCT FROM ROW(OLD.latitude,OLD.longitude,OLD.address,OLD.number,OLD.neighborhood,OLD.city,OLD.state,OLD.postal_code)
    OR OLD.geocoding_status IS DISTINCT FROM 'resolved'
  ) THEN
    IF NOT EXISTS(SELECT 1 FROM public.geocoding_cache c
      WHERE c.restaurant_id=NEW.restaurant_id AND c.operation='geocode'
        AND c.latitude=NEW.latitude AND c.longitude=NEW.longitude AND c.expires_at>clock_timestamp()
        AND c.normalized_address=jsonb_build_object(
          'address',public.normalize_geocoding_field(NEW.address),
          'number',public.normalize_geocoding_field(NEW.number),
          'neighborhood',public.normalize_geocoding_field(NEW.neighborhood),
          'city',public.normalize_geocoding_field(NEW.city),
          'state',public.normalize_geocoding_field(NEW.state),
          'postal_code',regexp_replace(NEW.postal_code,'[^0-9]','','g'),'country','br')) THEN
      RAISE EXCEPTION 'Consulte o endereço pelo serviço de localização antes de salvar as coordenadas.'
        USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.attest_geocoded_work_location() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_restaurant_location(
  p_name text, p_address text, p_number text, p_neighborhood text,
  p_city text, p_state text, p_postal_code text,
  p_kind text DEFAULT 'permanent', p_valid_until date DEFAULT NULL, p_make_default boolean DEFAULT false,
  p_id uuid DEFAULT NULL, p_expected_revision integer DEFAULT NULL
)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  saved public.work_locations%ROWTYPE;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('permanent', 'temporary') THEN
    RAISE EXCEPTION 'Tipo de local inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'temporary' AND (p_valid_until IS NULL OR p_valid_until < today OR p_valid_until > today + 365) THEN
    RAISE EXCEPTION 'Informe até quando o local temporário será usado (no máximo 1 ano).' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'permanent' AND p_valid_until IS NOT NULL THEN
    RAISE EXCEPTION 'Somente locais temporários possuem validade.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'temporary' AND COALESCE(p_make_default, false) THEN
    RAISE EXCEPTION 'Um local temporário não pode ser o endereço principal.' USING ERRCODE = '22023';
  END IF;

  saved := public.save_work_location(p_name, p_address, p_number, p_neighborhood, p_city, p_state,
    COALESCE(p_postal_code, ''), p_id, p_expected_revision);

  IF saved.is_default AND p_kind = 'temporary' THEN
    RAISE EXCEPTION 'Um local temporário não pode ser o endereço principal.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.work_locations SET kind = p_kind, valid_until = p_valid_until
  WHERE id = saved.id RETURNING * INTO saved;

  IF p_kind = 'permanent' AND NOT saved.is_default AND (COALESCE(p_make_default, false) OR NOT EXISTS (
    SELECT 1 FROM public.work_locations
    WHERE restaurant_id = owner_id AND is_default AND archived_at IS NULL
  )) THEN
    PERFORM public.manage_work_location(saved.id, 'set_default', saved.revision);
    SELECT * INTO STRICT saved FROM public.work_locations WHERE id = saved.id;
  END IF;
  RETURN saved;
END;
$fn$;

-- Coordinates come only from the server-written cache for this exact address, never from the client.
CREATE FUNCTION public.apply_work_location_geocode(p_id uuid, p_address_version integer)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
  hit public.geocoding_cache%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar locais.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target FROM public.work_locations WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restaure o local antes de localizá-lo.' USING ERRCODE = '22023';
  END IF;
  IF p_address_version IS DISTINCT FROM target.address_version THEN
    RAISE EXCEPTION 'O endereço foi alterado em outra sessão. Recarregue antes de continuar.' USING ERRCODE = '40001';
  END IF;

  SELECT c.* INTO hit FROM public.geocoding_cache c
  WHERE c.restaurant_id = owner_id AND c.operation = 'geocode' AND c.expires_at > clock_timestamp()
    AND c.normalized_address = jsonb_build_object(
      'address', public.normalize_geocoding_field(target.address),
      'number', public.normalize_geocoding_field(target.number),
      'neighborhood', public.normalize_geocoding_field(target.neighborhood),
      'city', public.normalize_geocoding_field(target.city),
      'state', public.normalize_geocoding_field(target.state),
      'postal_code', regexp_replace(target.postal_code, '[^0-9]', '', 'g'), 'country', 'br')
  ORDER BY c.updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulte o endereço pelo serviço de localização antes de salvar as coordenadas.'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(btrim(hit.result_address->>'number'), '') <> '' THEN
    UPDATE public.work_locations SET
      latitude = hit.latitude, longitude = hit.longitude, coordinate_source = 'geocoder',
      geocoding_status = 'resolved', geocoding_precision = 'house',
      candidate_latitude = NULL, candidate_longitude = NULL, geocoded_address = hit.result_address,
      geocoded_at = now(), geocoding_attempted_at = now(), geocoding_error_code = NULL, confirmed_at = now(),
      revision = revision + 1, updated_at = now()
    WHERE id = p_id RETURNING * INTO target;
  ELSE
    -- Street-level results need on-site or explicit confirmation: check-in radius is 100 m.
    UPDATE public.work_locations SET
      latitude = NULL, longitude = NULL, coordinate_source = NULL,
      geocoding_status = 'needs_review', geocoding_precision = NULL,
      candidate_latitude = hit.latitude, candidate_longitude = hit.longitude, geocoded_address = hit.result_address,
      geocoded_at = NULL, geocoding_attempted_at = now(), geocoding_error_code = 'street_level', confirmed_at = NULL,
      revision = revision + 1, updated_at = now()
    WHERE id = p_id RETURNING * INTO target;
  END IF;
  RETURN target;
END;
$fn$;

CREATE FUNCTION public.record_work_location_geocoding_failure(p_id uuid, p_address_version integer, p_code text)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'Código de falha inválido.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar locais.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target FROM public.work_locations WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_address_version IS DISTINCT FROM target.address_version OR target.geocoding_status = 'resolved' THEN
    RETURN target;
  END IF;
  UPDATE public.work_locations SET
    geocoding_status = 'failed', geocoding_attempted_at = now(), geocoding_error_code = p_code,
    candidate_latitude = NULL, candidate_longitude = NULL, geocoded_address = NULL,
    revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO target;
  RETURN target;
END;
$fn$;

-- 'device': restaurant is on site; GPS (<= 50 m accuracy) within 1 km of the street candidate.
-- 'approximate': restaurant explicitly accepts the street-level coordinate.
CREATE FUNCTION public.confirm_work_location(
  p_id uuid, p_expected_revision integer, p_method text,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL
)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
  distance double precision;
  confirmed_latitude double precision;
  confirmed_longitude double precision;
  v_source text;
  v_precision text;
BEGIN
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar locais.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO target FROM public.work_locations WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_revision IS DISTINCT FROM target.revision THEN
    RAISE EXCEPTION 'O local foi atualizado em outra sessão. Recarregue antes de continuar.' USING ERRCODE = '40001';
  END IF;
  IF target.archived_at IS NOT NULL OR target.geocoding_status <> 'needs_review'
    OR target.candidate_latitude IS NULL THEN
    RAISE EXCEPTION 'Este local não aguarda confirmação de posição.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('extrachef.confirming_location', p_id::text, true);
  IF p_method = 'device' THEN
    IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
      OR p_longitude NOT BETWEEN -180 AND 180 OR p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 50 THEN
      RAISE EXCEPTION 'A localização do aparelho não é precisa o suficiente (máximo 50 m). Tente ao ar livre.'
        USING ERRCODE = '22023';
    END IF;
    distance := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(p_latitude - target.candidate_latitude) / 2), 2)
      + cos(radians(target.candidate_latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - target.candidate_longitude) / 2), 2)))));
    IF distance > 1000 THEN
      RAISE EXCEPTION 'Você está a mais de 1 km do endereço informado. Confirme a posição estando no local.'
        USING ERRCODE = '22023';
    END IF;
    confirmed_latitude := p_latitude;
    confirmed_longitude := p_longitude;
    v_source := 'manual';
    v_precision := 'device';
  ELSIF p_method = 'approximate' THEN
    confirmed_latitude := target.candidate_latitude;
    confirmed_longitude := target.candidate_longitude;
    v_source := 'geocoder';
    v_precision := 'street';
  ELSE
    RAISE EXCEPTION 'Forma de confirmação inválida.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.work_locations SET
    latitude = confirmed_latitude, longitude = confirmed_longitude,
    coordinate_source = v_source, geocoding_precision = v_precision,
    geocoding_status = 'resolved', geocoded_at = now(), geocoding_error_code = NULL, confirmed_at = now(),
    candidate_latitude = NULL, candidate_longitude = NULL, revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO target;
  PERFORM set_config('extrachef.confirming_location', '', true);
  RETURN target;
END;
$fn$;

-- Same signature as 20261104080000; 'restaurant' now means the confirmed primary location.
CREATE OR REPLACE FUNCTION public.create_restaurant_demand(
  p_title text,
  p_description text,
  p_job_date date,
  p_start_time time,
  p_end_time time,
  p_value numeric,
  p_location_source text DEFAULT 'none',
  p_work_location_id uuid DEFAULT NULL,
  p_location_revision integer DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_event_revision integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  demand uuid := gen_random_uuid();
  saved public.jobs;
  selected public.work_locations;
  source text := p_location_source;
  location_id uuid := p_work_location_id;
  location_revision integer := p_location_revision;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM 1 FROM public.users
  WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR p_job_date < today
    OR p_start_time = p_end_time THEN
    RAISE EXCEPTION 'Informe os dados da demanda.' USING ERRCODE = '22023';
  END IF;

  IF source = 'restaurant' THEN
    IF p_work_location_id IS NOT NULL OR p_location_revision IS NOT NULL
      OR p_event_id IS NOT NULL OR p_event_revision IS NOT NULL THEN
      RAISE EXCEPTION 'O endereço principal é obtido automaticamente do restaurante.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO selected FROM public.work_locations
    WHERE restaurant_id = auth.uid() AND is_default AND archived_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cadastre o endereço operacional principal antes de publicar.' USING ERRCODE = '22023';
    END IF;
    source := 'catalog';
    location_id := selected.id;
    location_revision := selected.revision;
  END IF;

  IF source = 'catalog' THEN
    SELECT * INTO selected FROM public.work_locations
    WHERE id = location_id AND restaurant_id = auth.uid() AND archived_at IS NULL
    FOR SHARE;
    IF FOUND THEN
      IF selected.geocoding_status <> 'resolved' THEN
        RAISE EXCEPTION 'Confirme a localização do local antes de publicar a operação.' USING ERRCODE = '22023';
      END IF;
      IF selected.kind = 'temporary' AND (selected.valid_until < today OR p_job_date > selected.valid_until) THEN
        RAISE EXCEPTION 'O local temporário não é válido para a data da operação.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  saved := public.create_restaurant_job(
    p_title, p_description, p_job_date, p_start_time, p_end_time, p_value,
    source, location_id, location_revision, p_event_id, p_event_revision
  );
  UPDATE public.jobs SET demand_id = demand WHERE id = saved.id;
  RETURN demand;
END;
$fn$;

REVOKE ALL ON FUNCTION
  public.save_restaurant_location(text,text,text,text,text,text,text,text,date,boolean,uuid,integer),
  public.apply_work_location_geocode(uuid,integer),
  public.record_work_location_geocoding_failure(uuid,integer,text),
  public.confirm_work_location(uuid,integer,text,double precision,double precision,double precision)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.save_restaurant_location(text,text,text,text,text,text,text,text,date,boolean,uuid,integer),
  public.apply_work_location_geocode(uuid,integer),
  public.record_work_location_geocoding_failure(uuid,integer,text),
  public.confirm_work_location(uuid,integer,text,double precision,double precision,double precision)
TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
