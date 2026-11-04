-- Apply only after the frontend that uses /api/locations is deployed.
-- Closes the legacy path where the browser sent coordinates to save_geocoded_work_location.
-- The function is kept (20261104210000 preflight depends on it) and remains callable by service_role.
-- Rollback: GRANT EXECUTE ON FUNCTION public.save_geocoded_work_location(
--   text,text,text,text,text,double precision,double precision) TO authenticated;
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.save_restaurant_location(text,text,text,text,text,text,text,text,date,boolean,uuid,integer)') IS NULL
    OR to_regprocedure('public.apply_work_location_geocode(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261105000000_restaurant_operational_locations.sql first.';
  END IF;
END;
$preflight$;

REVOKE EXECUTE ON FUNCTION public.save_geocoded_work_location(
  text, text, text, text, text, double precision, double precision
) FROM PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
