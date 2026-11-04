-- Objective: install pg_cron and ensure the named operational schedule runs every minute.
-- Dependencies: pg_cron must be available to the database project, and
--   public.process_operational_schedule() must exist and be safe to repeat.
-- Risk: extension installation may require elevated privileges; the scheduled
--   procedure can create load if it is slow or not idempotent.
-- Validation:
--   SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
--   SELECT jobname, schedule, command, active FROM cron.job
--     WHERE jobname = 'extrachef-operational-minute';
--   Confirm the job's run history and application effects in the project's
--   supported cron run-details view after deployment.
-- Rollback: use a new forward migration to unschedule only
--   extrachef-operational-minute. Do not drop pg_cron if other jobs use it.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.process_operational_schedule()') IS NULL THEN
    RAISE EXCEPTION 'Missing public.process_operational_schedule(); reconcile the processor before scheduling it.';
  END IF;
END;
$preflight$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'extrachef-operational-minute'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'extrachef-operational-minute',
    '* * * * *',
    'SELECT public.process_operational_schedule()'
  );
END;
$schedule$;

COMMIT;
