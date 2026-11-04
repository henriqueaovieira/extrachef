-- Objective: restore monthly estimated earnings for the authenticated worker.
-- Dependencies: public.users, public.operational_assignments, and auth.uid().
-- Risk: incorrect time-zone boundaries or assignment filters can misstate totals.
-- Validation:
--   SELECT to_regprocedure('public.get_worker_estimated_earnings()');
--   SELECT pg_get_functiondef(
--     'public.get_worker_estimated_earnings()'::regprocedure
--   );
--   Exercise as a worker with current-month paid, disputed, interrupted, and
--   prior-month assignments; non-workers must receive SQLSTATE 42501.
-- Rollback: restore the previous function body in a new forward migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('public.users') IS NULL
    OR to_regclass('public.operational_assignments') IS NULL THEN
    RAISE EXCEPTION 'Missing earnings dependencies; reconcile users and operational assignments first.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.get_worker_estimated_earnings()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  estimated_total numeric;
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
    AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.users AS users
    WHERE users.id = auth.uid() AND users.role = 'worker'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido somente para trabalhadores autenticados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(assignments.amount), 0)::numeric
  INTO estimated_total
  FROM public.operational_assignments AS assignments
  WHERE assignments.worker_id = auth.uid()
    AND assignments.interruption IS NULL
    AND assignments.checkout_at IS NOT NULL
    AND assignments.receipt_confirmed_at >= month_start
    AND assignments.receipt_confirmed_at < month_start + interval '1 month'
    AND assignments.payment_disputed_at IS NULL;

  RETURN estimated_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_worker_estimated_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_estimated_earnings() TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
