CREATE OR REPLACE FUNCTION public.get_worker_estimated_earnings()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  estimated_total numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = auth.uid() AND users.role = 'worker'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido somente para trabalhadores autenticados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(jobs.value), 0)::numeric
  INTO estimated_total
  FROM public.applications AS applications
  JOIN public.jobs AS jobs ON jobs.id = applications.job_id
  JOIN public.checkouts AS checkouts
    ON checkouts.job_id = applications.job_id
    AND checkouts.worker_id = applications.worker_id
  WHERE applications.worker_id = auth.uid()
    AND applications.status = 'completed';

  RETURN estimated_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_worker_estimated_earnings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_estimated_earnings() TO authenticated;

NOTIFY pgrst, 'reload schema';