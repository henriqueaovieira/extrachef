-- Geocoder results are candidates only; publishing requires an on-site device fix.
-- Existing work locations and operations are intentionally left unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regprocedure('public.apply_work_location_geocode(uuid,integer)') IS NULL
    OR to_regprocedure('public.confirm_work_location(uuid,integer,text,double precision,double precision,double precision)') IS NULL
    OR to_regprocedure('public.create_restaurant_demand(text,text,date,time without time zone,time without time zone,numeric,text,uuid,integer,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261105000000_restaurant_operational_locations.sql first.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.apply_work_location_geocode(p_id uuid, p_address_version integer)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
  hit public.geocoding_cache%ROWTYPE;
  precision text;
  error_code text;
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
    precision := 'house';
    error_code := NULL;
  ELSE
    precision := 'street';
    error_code := 'street_level';
  END IF;

  UPDATE public.work_locations SET
    latitude = NULL, longitude = NULL, coordinate_source = NULL,
    geocoding_status = 'needs_review', geocoding_precision = precision,
    candidate_latitude = hit.latitude, candidate_longitude = hit.longitude, geocoded_address = hit.result_address,
    geocoded_at = now(), geocoding_attempted_at = now(), geocoding_error_code = error_code, confirmed_at = NULL,
    revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO target;
  RETURN target;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_work_location(
  p_id uuid, p_expected_revision integer, p_method text,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL
)
RETURNS public.work_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  owner_id uuid := auth.uid();
  target public.work_locations%ROWTYPE;
  reference_latitude double precision;
  reference_longitude double precision;
  distance double precision;
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
  IF target.archived_at IS NOT NULL OR NOT (
    (target.geocoding_status = 'needs_review' AND target.candidate_latitude IS NOT NULL)
    OR (target.geocoding_status = 'resolved' AND target.geocoding_precision IN ('house', 'street')
      AND target.coordinate_source = 'geocoder' AND target.latitude IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Este local não aguarda confirmação de posição.' USING ERRCODE = '22023';
  END IF;
  IF p_method IS DISTINCT FROM 'device' THEN
    RAISE EXCEPTION 'Confirme a posição presencialmente usando o GPS do aparelho.' USING ERRCODE = '22023';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
    OR p_longitude NOT BETWEEN -180 AND 180 OR p_accuracy IS NULL OR p_accuracy NOT BETWEEN 0 AND 50 THEN
    RAISE EXCEPTION 'A localização do aparelho não é precisa o suficiente (máximo 50 m). Tente ao ar livre.'
      USING ERRCODE = '22023';
  END IF;

  reference_latitude := COALESCE(target.candidate_latitude, target.latitude);
  reference_longitude := COALESCE(target.candidate_longitude, target.longitude);
  distance := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
    power(sin(radians(p_latitude - reference_latitude) / 2), 2)
    + cos(radians(reference_latitude)) * cos(radians(p_latitude))
    * power(sin(radians(p_longitude - reference_longitude) / 2), 2)))));
  IF distance > 1000 THEN
    RAISE EXCEPTION 'Você está a mais de 1 km do endereço informado. Confirme a posição estando no local.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('extrachef.confirming_location', p_id::text, true);
  UPDATE public.work_locations SET
    latitude = p_latitude, longitude = p_longitude,
    coordinate_source = 'manual', geocoding_precision = 'device',
    geocoding_status = 'resolved', geocoded_at = now(), geocoding_error_code = NULL, confirmed_at = now(),
    candidate_latitude = NULL, candidate_longitude = NULL, revision = revision + 1, updated_at = now()
  WHERE id = p_id RETURNING * INTO target;
  PERFORM set_config('extrachef.confirming_location', '', true);
  RETURN target;
END;
$fn$;

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
  source_event public.events;
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

  IF source IS DISTINCT FROM 'catalog' AND source IS DISTINCT FROM 'event' THEN
    RAISE EXCEPTION 'Confirme presencialmente a localização usando o GPS antes de publicar a operação.'
      USING ERRCODE = '22023';
  END IF;

  IF source = 'catalog' THEN
    SELECT * INTO selected FROM public.work_locations
    WHERE id = location_id AND restaurant_id = auth.uid() AND archived_at IS NULL
    FOR SHARE;
    IF FOUND THEN
      IF selected.geocoding_status IS DISTINCT FROM 'resolved'
        OR selected.geocoding_precision IS DISTINCT FROM 'device'
        OR selected.coordinate_source IS DISTINCT FROM 'manual'
        OR selected.confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Confirme presencialmente a localização usando o GPS antes de publicar a operação.'
          USING ERRCODE = '22023';
      END IF;
      IF selected.kind = 'temporary' AND (selected.valid_until < today OR p_job_date > selected.valid_until) THEN
        RAISE EXCEPTION 'O local temporário não é válido para a data da operação.' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF source = 'event' THEN
    IF p_event_id IS NULL OR p_event_revision IS NULL
      OR p_work_location_id IS NOT NULL OR p_location_revision IS NOT NULL THEN
      RAISE EXCEPTION 'Informe um evento com local operacional confirmado presencialmente.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO source_event FROM public.events
    WHERE id = p_event_id AND restaurant_id = auth.uid()
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evento indisponível. Selecione um evento do seu restaurante.' USING ERRCODE = '22023';
    END IF;
    IF p_event_revision IS DISTINCT FROM source_event.revision THEN
      RAISE EXCEPTION 'O evento foi atualizado. Atualize os eventos e confira a seleção.' USING ERRCODE = '40001';
    END IF;
    IF source_event.work_location_id IS NULL OR source_event.location_status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'Confirme presencialmente a localização do evento antes de publicar a operação.'
        USING ERRCODE = '22023';
    END IF;
    SELECT * INTO selected FROM public.work_locations
    WHERE id = source_event.work_location_id AND restaurant_id = auth.uid() AND archived_at IS NULL
    FOR SHARE;
    IF NOT FOUND OR selected.geocoding_status IS DISTINCT FROM 'resolved'
      OR selected.geocoding_precision IS DISTINCT FROM 'device'
      OR selected.coordinate_source IS DISTINCT FROM 'manual'
      OR selected.confirmed_at IS NULL
      OR source_event.location_source_version IS DISTINCT FROM selected.address_version
      OR source_event.event_latitude IS DISTINCT FROM selected.latitude
      OR source_event.event_longitude IS DISTINCT FROM selected.longitude THEN
      RAISE EXCEPTION 'Atualize o local do evento após confirmar presencialmente a posição pelo GPS.'
        USING ERRCODE = '22023';
    END IF;
    IF selected.kind = 'temporary' AND (selected.valid_until < today OR p_job_date > selected.valid_until) THEN
      RAISE EXCEPTION 'O local temporário não é válido para a data da operação.' USING ERRCODE = '22023';
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

COMMIT;
NOTIFY pgrst, 'reload schema';
