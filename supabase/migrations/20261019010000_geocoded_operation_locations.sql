BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.work_locations') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR to_regprocedure('public.save_work_location(text,text,text,text,text,text,text,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Dependencias ausentes: work_locations, jobs e save_work_location são obrigatórias.';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.save_geocoded_work_location(
  p_name text,
  p_address text,
  p_number text,
  p_city text,
  p_state text,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS public.work_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  saved public.work_locations%ROWTYPE;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL
    OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'O endereço não possui coordenadas válidas.' USING ERRCODE = '22023';
  END IF;

  saved := public.save_work_location(
    p_name, p_address, p_number, '', p_city, upper(btrim(p_state)), ''
  );

  UPDATE public.work_locations
  SET latitude = p_latitude,
      longitude = p_longitude,
      geocoding_status = 'resolved',
      coordinate_source = 'geocoder',
      geocoded_at = now(),
      geocoding_attempted_at = now(),
      geocoding_error_code = NULL
  WHERE id = saved.id AND restaurant_id = auth.uid()
  RETURNING * INTO saved;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível salvar as coordenadas do local.' USING ERRCODE = '40001';
  END IF;
  RETURN saved;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_geocoded_work_location(text,text,text,text,text,double precision,double precision)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_geocoded_work_location(text,text,text,text,text,double precision,double precision)
  TO authenticated;

CREATE FUNCTION public.require_resolved_job_location()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.location_source IN ('catalog', 'event')
    AND (NEW.location_status <> 'ready' OR NEW.work_latitude IS NULL OR NEW.work_longitude IS NULL) THEN
    RAISE EXCEPTION 'Geocodifique o local antes de publicar a operação.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.require_resolved_job_location() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER jobs_require_resolved_location
BEFORE INSERT OR UPDATE OF location_source, location_status, work_latitude, work_longitude
ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.require_resolved_job_location();

COMMIT;
NOTIFY pgrst, 'reload schema';
