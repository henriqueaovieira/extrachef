BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Requires only the existing events schema and the independent work_locations catalog.
ALTER TABLE public.events
  ADD COLUMN work_location_id uuid REFERENCES public.work_locations(id) ON DELETE NO ACTION,
  ADD COLUMN location_name text,
  ADD COLUMN event_address text,
  ADD COLUMN event_number text,
  ADD COLUMN event_neighborhood text,
  ADD COLUMN event_city text,
  ADD COLUMN event_state text,
  ADD COLUMN event_postal_code text,
  ADD COLUMN event_country_code text,
  ADD COLUMN event_latitude double precision,
  ADD COLUMN event_longitude double precision,
  ADD COLUMN location_status text NOT NULL DEFAULT 'not_set',
  ADD COLUMN location_snapshot_at timestamptz,
  ADD COLUMN location_source_version integer,
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT events_revision_check CHECK (revision > 0),
  ADD CONSTRAINT events_location_status_check
    CHECK (location_status IN ('not_set', 'pending_coordinates', 'ready')),
  ADD CONSTRAINT events_location_snapshot_check CHECK (
    (
      location_status = 'not_set'
      AND work_location_id IS NULL AND location_name IS NULL
      AND event_address IS NULL AND event_number IS NULL AND event_neighborhood IS NULL
      AND event_city IS NULL AND event_state IS NULL AND event_postal_code IS NULL
      AND event_country_code IS NULL AND event_latitude IS NULL AND event_longitude IS NULL
      AND location_snapshot_at IS NULL AND location_source_version IS NULL
    )
    OR (
      location_status IN ('pending_coordinates', 'ready')
      AND work_location_id IS NOT NULL
      AND location_name IS NOT NULL AND char_length(btrim(location_name)) BETWEEN 2 AND 160
      AND event_address IS NOT NULL AND char_length(btrim(event_address)) BETWEEN 3 AND 300
      AND event_number IS NOT NULL AND char_length(event_number) <= 30
      AND event_neighborhood IS NOT NULL AND char_length(event_neighborhood) <= 120
      AND event_city IS NOT NULL AND char_length(btrim(event_city)) BETWEEN 2 AND 120
      AND event_state IS NOT NULL AND event_state ~ '^[A-Z]{2}$'
      AND event_postal_code IS NOT NULL AND (event_postal_code = '' OR event_postal_code ~ '^[0-9]{8}$')
      AND event_country_code IS NOT NULL AND event_country_code = 'BR'
      AND location_snapshot_at IS NOT NULL
      AND location_source_version IS NOT NULL AND location_source_version > 0
      AND (
        (location_status = 'pending_coordinates' AND event_latitude IS NULL AND event_longitude IS NULL)
        OR (location_status = 'ready'
          AND event_latitude IS NOT NULL AND event_longitude IS NOT NULL
          AND event_latitude BETWEEN -90 AND 90 AND event_longitude BETWEEN -180 AND 180)
      )
    )
  );

CREATE INDEX events_work_location_idx ON public.events(work_location_id) WHERE work_location_id IS NOT NULL;

-- Preserve SELECT/DELETE and existing owner policies; snapshots are written only by the RPC.
REVOKE INSERT, UPDATE ON TABLE public.events FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_restaurant_event(
  p_title text, p_description text, p_event_date date,
  p_start_time time, p_end_time time, p_expected_people integer,
  p_status text DEFAULT 'scheduled', p_id uuid DEFAULT NULL,
  p_expected_revision integer DEFAULT NULL,
  p_location_action text DEFAULT 'keep',
  p_work_location_id uuid DEFAULT NULL,
  p_location_revision integer DEFAULT NULL
)
RETURNS public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  owner_id uuid := auth.uid();
  target public.events%ROWTYPE;
  selected public.work_locations%ROWTYPE;
BEGIN
  -- Same lock order as catalog writes: owner first, then dependent rows.
  PERFORM 1 FROM public.users WHERE id = owner_id AND role = 'restaurant' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante para gerenciar eventos.' USING ERRCODE = '42501';
  END IF;
  IF p_location_action IS NULL OR p_location_action NOT IN ('keep', 'set', 'clear') THEN
    RAISE EXCEPTION 'Ação de local inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('scheduled', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'Status de evento inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_location_action <> 'set' AND (p_work_location_id IS NOT NULL OR p_location_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'Seleção de local incompatível com a ação.' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO target FROM public.events WHERE id = p_id AND restaurant_id = owner_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evento não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_revision IS DISTINCT FROM target.revision THEN
      RAISE EXCEPTION 'O evento foi atualizado em outra sessão. Recarregue antes de continuar.' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF p_status <> 'scheduled' THEN
      RAISE EXCEPTION 'Novos eventos devem começar como agendados.' USING ERRCODE = '22023';
    END IF;
    target.location_status := 'not_set';
  END IF;

  IF p_location_action = 'set' THEN
    SELECT * INTO selected FROM public.work_locations
    WHERE id = p_work_location_id AND restaurant_id = owner_id AND archived_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Local indisponível. Selecione um local ativo do seu catálogo.' USING ERRCODE = '22023';
    END IF;
    IF p_location_revision IS DISTINCT FROM selected.revision THEN
      RAISE EXCEPTION 'O local foi atualizado. Atualize o catálogo e confira a seleção antes de salvar.' USING ERRCODE = '40001';
    END IF;
    target.work_location_id := selected.id;
    target.location_name := selected.name;
    target.event_address := selected.address;
    target.event_number := selected.number;
    target.event_neighborhood := selected.neighborhood;
    target.event_city := selected.city;
    target.event_state := selected.state;
    target.event_postal_code := selected.postal_code;
    target.event_country_code := selected.country_code;
    target.event_latitude := selected.latitude;
    target.event_longitude := selected.longitude;
    target.location_status := CASE WHEN selected.geocoding_status = 'resolved' THEN 'ready' ELSE 'pending_coordinates' END;
    target.location_snapshot_at := now();
    target.location_source_version := selected.address_version;
  ELSIF p_location_action = 'clear' THEN
    target.work_location_id := NULL;
    target.location_name := NULL;
    target.event_address := NULL;
    target.event_number := NULL;
    target.event_neighborhood := NULL;
    target.event_city := NULL;
    target.event_state := NULL;
    target.event_postal_code := NULL;
    target.event_country_code := NULL;
    target.event_latitude := NULL;
    target.event_longitude := NULL;
    target.location_status := 'not_set';
    target.location_snapshot_at := NULL;
    target.location_source_version := NULL;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.events(
      restaurant_id, title, description, event_date, start_time, end_time, expected_people, status,
      work_location_id, location_name, event_address, event_number, event_neighborhood,
      event_city, event_state, event_postal_code, event_country_code, event_latitude, event_longitude,
      location_status, location_snapshot_at, location_source_version
    ) VALUES (
      owner_id, btrim(p_title), btrim(p_description), p_event_date, p_start_time, p_end_time, p_expected_people, p_status,
      target.work_location_id, target.location_name, target.event_address, target.event_number, target.event_neighborhood,
      target.event_city, target.event_state, target.event_postal_code, target.event_country_code, target.event_latitude, target.event_longitude,
      target.location_status, target.location_snapshot_at, target.location_source_version
    ) RETURNING * INTO target;
  ELSE
    UPDATE public.events SET
      title = btrim(p_title), description = btrim(p_description), event_date = p_event_date,
      start_time = p_start_time, end_time = p_end_time, expected_people = p_expected_people, status = p_status,
      work_location_id = target.work_location_id, location_name = target.location_name,
      event_address = target.event_address, event_number = target.event_number,
      event_neighborhood = target.event_neighborhood, event_city = target.event_city, event_state = target.event_state,
      event_postal_code = target.event_postal_code, event_country_code = target.event_country_code,
      event_latitude = target.event_latitude, event_longitude = target.event_longitude,
      location_status = target.location_status, location_snapshot_at = target.location_snapshot_at,
      location_source_version = target.location_source_version, revision = revision + 1
    WHERE id = p_id RETURNING * INTO target;
  END IF;
  RETURN target;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_restaurant_event(text,text,date,time,time,integer,text,uuid,integer,text,uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_restaurant_event(text,text,date,time,time,integer,text,uuid,integer,text,uuid,integer)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
