BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS jobs_require_resolved_location ON public.jobs;
DROP FUNCTION IF EXISTS public.require_resolved_job_location();

COMMIT;
