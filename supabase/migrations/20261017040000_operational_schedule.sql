BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('extrachef-operational-minute','* * * * *',
  'SELECT public.process_operational_schedule()');
COMMIT;
