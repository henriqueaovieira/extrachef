BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.events
  ADD COLUMN event_address text,
  ADD COLUMN event_city text,
  ADD COLUMN event_state text,
  ADD COLUMN event_postal_code text,
  ADD COLUMN event_latitude double precision,
  ADD COLUMN event_longitude double precision,
  ADD COLUMN location_name text;

ALTER TABLE public.jobs
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN work_address text,
  ADD COLUMN work_number text,
  ADD COLUMN work_neighborhood text,
  ADD COLUMN work_city text,
  ADD COLUMN work_state text,
  ADD COLUMN work_postal_code text,
  ADD COLUMN work_latitude double precision,
  ADD COLUMN work_longitude double precision,
  ADD COLUMN location_name text,
  ADD COLUMN geofence_radius_m integer NOT NULL DEFAULT 200,
  ADD COLUMN location_source text NOT NULL DEFAULT 'address';

-- Preserve the old operational GPS and radius, never infer an address from the company profile.
UPDATE public.jobs SET
  work_latitude = latitude,
  work_longitude = longitude,
  geofence_radius_m = 300,
  location_source = 'legacy'
WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;
UPDATE public.jobs SET location_source = 'legacy', geofence_radius_m = 300
WHERE work_latitude IS NULL OR work_longitude IS NULL;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_work_coordinates_check CHECK (
    (work_latitude IS NULL AND work_longitude IS NULL) OR
    (work_latitude IS NOT NULL AND work_longitude IS NOT NULL
      AND work_latitude BETWEEN -90 AND 90 AND work_longitude BETWEEN -180 AND 180)
  ),
  ADD CONSTRAINT jobs_geofence_radius_check CHECK (geofence_radius_m IN (100, 200, 300, 500)),
  ADD CONSTRAINT jobs_location_source_check CHECK (location_source IN ('legacy', 'address')),
  ADD CONSTRAINT jobs_work_address_check CHECK (
    location_source = 'legacy' OR (
      work_address IS NOT NULL AND char_length(btrim(work_address)) BETWEEN 3 AND 300
      AND work_city IS NOT NULL AND char_length(btrim(work_city)) BETWEEN 2 AND 120
      AND work_state IS NOT NULL AND work_state ~ '^[A-Z]{2}$'
      AND work_postal_code IS NOT NULL AND work_postal_code ~ '^[0-9]{8}$'
      AND work_latitude IS NOT NULL AND work_longitude IS NOT NULL
    )
  );

ALTER TABLE public.events ADD CONSTRAINT events_location_check CHECK (
  (event_address IS NULL AND event_city IS NULL AND event_state IS NULL
    AND event_postal_code IS NULL AND event_latitude IS NULL AND event_longitude IS NULL)
  OR (
    event_address IS NOT NULL AND char_length(btrim(event_address)) BETWEEN 3 AND 500
    AND event_city IS NOT NULL AND char_length(btrim(event_city)) BETWEEN 2 AND 120
    AND event_state IS NOT NULL AND event_state ~ '^[A-Z]{2}$'
    AND event_postal_code IS NOT NULL AND event_postal_code ~ '^[0-9]{8}$'
    AND event_latitude IS NOT NULL AND event_latitude BETWEEN -90 AND 90
    AND event_longitude IS NOT NULL AND event_longitude BETWEEN -180 AND 180
  )
);

CREATE INDEX jobs_event_id_idx ON public.jobs(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX jobs_work_city_state_idx ON public.jobs(work_state, work_city) WHERE status = 'open';
CREATE INDEX events_city_state_idx ON public.events(event_state, event_city);

GRANT SELECT (
  event_id, work_address, work_number, work_neighborhood, work_city, work_state,
  work_postal_code, work_latitude, work_longitude, location_name, geofence_radius_m, location_source
) ON public.jobs TO authenticated;
GRANT INSERT (
  event_id, work_address, work_number, work_neighborhood, work_city, work_state,
  work_postal_code, work_latitude, work_longitude, location_name
) ON public.jobs TO authenticated;

DROP POLICY IF EXISTS jobs_insert_restaurant_open ON public.jobs;
CREATE POLICY jobs_insert_restaurant_open ON public.jobs
FOR INSERT TO authenticated WITH CHECK (
  restaurant_id = (SELECT auth.uid()) AND status = 'open'
  AND work_latitude BETWEEN -90 AND 90 AND work_longitude BETWEEN -180 AND 180
  AND EXISTS (
    SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant'
  )
);
DROP POLICY IF EXISTS jobs_insert_restaurant_open_restrictive ON public.jobs;
CREATE POLICY jobs_insert_restaurant_open_restrictive ON public.jobs
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
  restaurant_id = (SELECT auth.uid()) AND status = 'open'
  AND work_latitude BETWEEN -90 AND 90 AND work_longitude BETWEEN -180 AND 180
  AND EXISTS (
    SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant'
  )
);

CREATE OR REPLACE FUNCTION public.validate_job_operational_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.location_source := 'address';
    NEW.geofence_radius_m := 200;
  ELSIF ROW(NEW.work_address, NEW.work_number, NEW.work_neighborhood, NEW.work_city, NEW.work_state,
    NEW.work_postal_code, NEW.work_latitude, NEW.work_longitude, NEW.location_name, NEW.geofence_radius_m)
    IS DISTINCT FROM ROW(OLD.work_address, OLD.work_number, OLD.work_neighborhood, OLD.work_city, OLD.work_state,
    OLD.work_postal_code, OLD.work_latitude, OLD.work_longitude, OLD.location_name, OLD.geofence_radius_m)
    AND EXISTS (SELECT 1 FROM public.checkins WHERE job_id = OLD.id) THEN
    RAISE EXCEPTION 'Não altere o local ou o raio de uma diária já iniciada.' USING ERRCODE = '22023';
  END IF;
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = NEW.event_id AND e.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'O evento deve pertencer ao restaurante da vaga.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_job_operational_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER jobs_validate_operational_location
BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_job_operational_location();

CREATE OR REPLACE FUNCTION public.require_new_event_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.event_address IS NULL OR NEW.event_latitude IS NULL OR NEW.event_longitude IS NULL THEN
    RAISE EXCEPTION 'Cadastre o local do evento antes de salvar.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.require_new_event_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER events_require_new_location BEFORE INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.require_new_event_location();

-- Foundation only: no manual-request UI, submission grant or automatic bypass.
ALTER TABLE public.applications
  ADD COLUMN manual_checkin_requested_at timestamptz,
  ADD COLUMN manual_checkin_reason text;

CREATE OR REPLACE FUNCTION public.assert_job_presence(
  p_job_id uuid, p_latitude double precision, p_longitude double precision, p_checkin boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target public.jobs%ROWTYPE;
  meters double precision;
BEGIN
  SELECT * INTO STRICT target FROM public.jobs WHERE id = p_job_id;
  IF p_latitude IS NULL OR p_longitude IS NULL
    OR NOT (p_latitude BETWEEN -90 AND 90) OR NOT (p_longitude BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Não foi possível obter uma localização válida.' USING ERRCODE = '22023';
  END IF;
  IF target.work_latitude IS NULL OR target.work_longitude IS NULL THEN
    RAISE EXCEPTION 'O local da vaga está incompleto. Solicite ao restaurante a atualização das coordenadas.' USING ERRCODE = '22023';
  END IF;
  IF p_checkin AND target.location_source <> 'legacy'
    AND target.job_date <> (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'O check-in está disponível somente no dia da vaga (horário de Brasília).' USING ERRCODE = '22023';
  END IF;
  meters := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
    power(sin(radians(p_latitude - target.work_latitude) / 2), 2)
    + cos(radians(target.work_latitude)) * cos(radians(p_latitude))
    * power(sin(radians(p_longitude - target.work_longitude) / 2), 2)
  ))));
  IF meters > target.geofence_radius_m THEN
    RAISE EXCEPTION 'Você não está no local da vaga. Distância atual: % metros. Raio permitido: % metros.',
      round(meters)::integer, target.geofence_radius_m USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_job_presence(uuid, double precision, double precision, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_worker_checkin(
  p_job_id uuid, p_latitude double precision, p_longitude double precision
)
RETURNS TABLE (checkin_id uuid, checkin_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_application_id uuid;
  selected_application_status text;
  selected_checkin_id uuid;
  selected_checkin_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para realizar o check-in.' USING ERRCODE = '42501';
  END IF;
  SELECT a.id, a.status INTO selected_application_id, selected_application_status
  FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
  WHERE a.job_id = p_job_id AND a.worker_id = auth.uid()
  FOR UPDATE OF a, j;
  IF NOT FOUND OR selected_application_status <> 'approved' THEN
    RAISE EXCEPTION 'Check-in disponível somente para trabalhadores aprovados.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_job_presence(p_job_id, p_latitude, p_longitude, true);
  selected_checkin_time := now();
  INSERT INTO public.checkins(job_id, worker_id, checkin_time, latitude, longitude)
  VALUES (p_job_id, auth.uid(), selected_checkin_time, p_latitude, p_longitude)
  RETURNING id, checkins.checkin_time INTO selected_checkin_id, selected_checkin_time;
  UPDATE public.applications SET status = 'in_progress'
  WHERE id = selected_application_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A candidatura não está mais aprovada.' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT selected_checkin_id, selected_checkin_time;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_worker_checkin(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_worker_checkin(uuid, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_worker_checkout(
  p_job_id uuid, p_latitude double precision, p_longitude double precision
)
RETURNS TABLE (checkout_id uuid, checkout_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_application_id uuid;
  selected_application_status text;
  selected_job_status text;
  selected_checkout_id uuid;
  selected_checkout_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para realizar o check-out.' USING ERRCODE = '42501';
  END IF;
  SELECT a.id, a.status, j.status
  INTO selected_application_id, selected_application_status, selected_job_status
  FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
  WHERE a.job_id = p_job_id AND a.worker_id = auth.uid()
  FOR UPDATE OF a, j;
  IF NOT FOUND OR selected_application_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Check-out disponível somente após o check-in.' USING ERRCODE = '42501';
  END IF;
  IF selected_job_status <> 'filled' THEN
    RAISE EXCEPTION 'A vaga não está em andamento.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.checkins WHERE job_id = p_job_id AND worker_id = auth.uid()) THEN
    RAISE EXCEPTION 'Realize o check-in antes do check-out.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_job_presence(p_job_id, p_latitude, p_longitude, false);
  selected_checkout_time := now();
  INSERT INTO public.checkouts(job_id, worker_id, checkout_time, latitude, longitude)
  VALUES (p_job_id, auth.uid(), selected_checkout_time, p_latitude, p_longitude)
  RETURNING id, checkouts.checkout_time INTO selected_checkout_id, selected_checkout_time;
  UPDATE public.applications SET status = 'completed'
  WHERE id = selected_application_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A candidatura não está mais em andamento.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.jobs SET status = 'completed' WHERE id = p_job_id AND status = 'filled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A vaga não está mais em andamento.' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT selected_checkout_id, selected_checkout_time;
END;
$function$;
REVOKE ALL ON FUNCTION public.register_worker_checkout(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_worker_checkout(uuid, double precision, double precision) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
