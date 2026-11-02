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
    SELECT 1 FROM public.users AS users
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

NOTIFY pgrst, 'reload schema';
