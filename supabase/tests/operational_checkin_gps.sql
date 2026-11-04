-- Local isolated database only. Executed by tests/recruitment-sql.test.mjs.
-- Fixture: test.checkin_job_id is a hired job for today, with snapshot (0,0),
-- no code/check-in for its current assignment yet (history may exist);
-- test.worker_id/restaurant_id/outsider_id are active users.
-- Every mutation, including successful issuance, is rolled back.
BEGIN;

CREATE FUNCTION pg_temp.expect_error(command text, expected_state text, expected_message text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state OR SQLERRM !~ expected_message THEN
      RAISE EXCEPTION 'Unexpected error [%]: %; command: %', SQLSTATE, SQLERRM, command;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected error %, but command succeeded: %', expected_state, command;
END;
$fn$;

DO $test$
DECLARE f pg_catalog.pg_proc;
BEGIN
  SELECT * INTO STRICT f FROM pg_catalog.pg_proc
    WHERE oid = 'public.issue_operational_code(uuid,text,double precision,double precision)'::regprocedure;
  IF f.proargnames <> ARRAY['p_job_id','p_stage','p_latitude','p_longitude'] OR f.pronargdefaults <> 2
    OR f.prorettype <> 'jsonb'::regtype OR NOT f.prosecdef OR f.proconfig <> ARRAY['search_path=""']
    OR to_regprocedure('public.issue_operational_code(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid RPC signature/defaults/security or ambiguous legacy overload.';
  END IF;
  IF has_function_privilege('anon', f.oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) WHERE grantee = 0 AND privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Invalid RPC execute privileges.';
  END IF;
END;
$test$;

CREATE TEMP TABLE gps_before AS
  SELECT (SELECT count(*) FROM public.notifications) AS notifications,
    (SELECT count(*) FROM public.operational_codes) AS codes;

SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(format(
  'SELECT public.issue_operational_code(%L,''checkin'',0,0)', current_setting('test.checkin_job_id')),
  '42501', 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('test.outsider_id'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format(
  'SELECT public.issue_operational_code(%L,''checkin'',0,0)', current_setting('test.checkin_job_id')),
  '42501', 'conta');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('test.restaurant_id'), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format(
  'SELECT public.issue_operational_code(%L,''checkin'',0,0)', current_setting('test.checkin_job_id')),
  '42501', 'profissional');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('test.worker_id'), true);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  job uuid := current_setting('test.checkin_job_id')::uuid;
  coordinates record;
BEGIN
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'')', job), '22023', 'GPS');
  FOR coordinates IN SELECT * FROM (VALUES
    (NULL::double precision, 0::double precision), (0,NULL),
    (91,0), (-91,0), (0,181), (0,-181),
    ('NaN',0), (0,'NaN'), ('Infinity',0), ('-Infinity',0), (0,'Infinity'), (0,'-Infinity')
  ) AS invalid(latitude,longitude) LOOP
    PERFORM pg_temp.expect_error(format(
      'SELECT public.issue_operational_code(p_job_id=>%L,p_stage=>''checkin'',p_latitude=>%L::float8,p_longitude=>%L::float8)',
      job, coordinates.latitude, coordinates.longitude), '22023', 'GPS');
  END LOOP;
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'',%L::float8,0)',
    job, degrees(100.001 / 6371000.0)), '22023', '100 metros');
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'',0,%L::float8)',
    job, degrees(300.0 / 6371000.0)), '22023', '100 metros');
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkout'')', job), '42501', 'Checkout');
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,NULL,0,0)', job), 'P0001', 'Etapa');
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''invalid'',0,0)', job), 'P0001', 'Etapa');
END;
$test$;
RESET ROLE;

DO $test$
DECLARE coordinates record;
BEGIN
  FOR coordinates IN SELECT * FROM (VALUES
    (NULL::double precision, 0::double precision), (0,NULL), (91,0), (0,181),
    ('NaN',0), (0,'NaN'), ('Infinity',0), (0,'-Infinity')
  ) AS invalid(latitude,longitude) LOOP
    UPDATE public.jobs SET work_latitude = coordinates.latitude, work_longitude = coordinates.longitude
      WHERE id = current_setting('test.checkin_job_id')::uuid;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'',0,0)',
      current_setting('test.checkin_job_id')), '22023', 'coordenadas');
    RESET ROLE;
  END LOOP;
  UPDATE public.jobs SET work_latitude = 0, work_longitude = 0
    WHERE id = current_setting('test.checkin_job_id')::uuid;
  IF (SELECT count(*) FROM public.notifications) <> (SELECT notifications FROM gps_before)
    OR (SELECT count(*) FROM public.operational_codes) <> (SELECT codes FROM gps_before) THEN
    RAISE EXCEPTION 'Failed GPS requests created codes or notifications.';
  END IF;
END;
$test$;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  job uuid := current_setting('test.checkin_job_id')::uuid;
  boundary jsonb;
  inside jsonb;
BEGIN
  boundary := public.issue_operational_code(
    p_job_id => job, p_stage => 'checkin', p_latitude => degrees(100.0 / 6371000.0), p_longitude => 0);
  inside := public.issue_operational_code(job, 'checkin', degrees(99.999 / 6371000.0), 0);
  IF boundary->>'code' IS NULL OR boundary->>'code' !~ '^[A-F0-9]{8}$'
    OR boundary->>'code' IS DISTINCT FROM inside->>'code'
    OR (inside->>'has_code')::boolean IS DISTINCT FROM true OR inside->>'checkin_at' IS NOT NULL THEN
    RAISE EXCEPTION '100m boundary, reuse, or bilateral check-in behavior changed.';
  END IF;
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'',%L::float8,0)',
    job, degrees(100.001 / 6371000.0)), '22023', '100 metros');
  PERFORM pg_temp.expect_error(format('SELECT public.issue_operational_code(%L,''checkin'')', job), '22023', 'GPS');
END;
$test$;
RESET ROLE;

DO $test$
BEGIN
  IF (SELECT count(*) FROM public.notifications) <> (SELECT notifications + 1 FROM gps_before)
    OR (SELECT count(*) FROM public.operational_codes) <> (SELECT codes + 1 FROM gps_before) THEN
    RAISE EXCEPTION 'Issuance/reuse did not create exactly one code and notification.';
  END IF;
END;
$test$;

UPDATE public.operational_codes SET blocked_until = now() + interval '10 minutes'
  WHERE assignment_id = (public.participant_assignment(current_setting('test.checkin_job_id')::uuid)).id
    AND stage = 'checkin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format(
  'SELECT public.issue_operational_code(%L,''checkin'',0,0)', current_setting('test.checkin_job_id')),
  'P0001', 'Muitas tentativas');
RESET ROLE;

CREATE TEMP TABLE gps_original_code AS
  SELECT code FROM public.operational_codes
    WHERE assignment_id = (public.participant_assignment(current_setting('test.checkin_job_id')::uuid)).id
      AND stage = 'checkin';
UPDATE public.operational_codes
  SET blocked_until = NULL, expires_at = now() - interval '1 second', attempts = 3, consumed_at = now()
  WHERE assignment_id = (public.participant_assignment(current_setting('test.checkin_job_id')::uuid)).id
    AND stage = 'checkin';
SET LOCAL ROLE authenticated;
SELECT public.issue_operational_code(current_setting('test.checkin_job_id')::uuid, 'checkin', 0, 0);
RESET ROLE;
DO $test$
DECLARE token public.operational_codes;
BEGIN
  SELECT * INTO STRICT token FROM public.operational_codes
    WHERE assignment_id = (public.participant_assignment(current_setting('test.checkin_job_id')::uuid)).id
      AND stage = 'checkin';
  IF token.code = (SELECT code FROM gps_original_code) OR token.expires_at <> now() + interval '10 minutes'
    OR token.attempts <> 0 OR token.blocked_until IS NOT NULL OR token.consumed_at IS NOT NULL
    OR (SELECT count(*) FROM public.notifications) <> (SELECT notifications + 2 FROM gps_before) THEN
    RAISE EXCEPTION 'Expired code renewal, attempts, consumption or notification behavior changed.';
  END IF;
END;
$test$;
ROLLBACK;
