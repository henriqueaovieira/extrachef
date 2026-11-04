-- Objective: restore saving geocoded catalog locations when coordinates are available.
-- Dependencies: public.work_locations, public.jobs, and
--   save_work_location(text,text,text,text,text,text,text,uuid,integer).
-- Risk: updates coordinates only on the authenticated restaurant's saved location;
--   review RPC privileges and address validation before deployment.
-- Validation:
--   SELECT to_regprocedure(
--     'public.save_geocoded_work_location(text,text,text,text,text,double precision,double precision)'
--   );
--   SELECT to_regprocedure('public.require_resolved_job_location()');
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass
--     AND tgname = 'jobs_require_resolved_location';
--   The last two queries must return no rows/results; this migration intentionally
--   does not restore the geocoding-required trigger or function.
-- Rollback: restore the prior RPC body using a new forward migration; preserve
--   saved location data and do not reinstate a required-geocoding guard.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.work_locations') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR to_regprocedure(
      'public.save_work_location(text,text,text,text,text,text,text,uuid,integer)'
    ) IS NULL THEN
    RAISE EXCEPTION 'Missing geocoded location dependencies; reconcile work locations first.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.save_geocoded_work_location(
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
    OR p_latitude NOT BETWEEN -90 AND 90
    OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'O endereço não possui coordenadas válidas.'
      USING ERRCODE = '22023';
  END IF;

  saved := public.save_work_location(
    p_name,
    p_address,
    p_number,
    '',
    p_city,
    upper(btrim(p_state)),
    ''
  );

  UPDATE public.work_locations
  SET latitude = p_latitude,
      longitude = p_longitude,
      geocoding_status = 'resolved',
      coordinate_source = 'geocoder',
      geocoded_at = now(),
      geocoding_attempted_at = now(),
      geocoding_error_code = NULL
  WHERE id = saved.id
    AND restaurant_id = auth.uid()
  RETURNING * INTO saved;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível salvar as coordenadas do local.'
      USING ERRCODE = '40001';
  END IF;

  RETURN saved;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_geocoded_work_location(
  text, text, text, text, text, double precision, double precision
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_geocoded_work_location(
  text, text, text, text, text, double precision, double precision
) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
