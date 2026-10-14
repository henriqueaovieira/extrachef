CREATE OR REPLACE FUNCTION public.approve_application(p_job_id uuid, p_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_restaurant_id uuid;
  current_job_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'É necessário entrar na conta do restaurante.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jobs.restaurant_id, jobs.status
  INTO current_restaurant_id, current_job_status
  FROM public.jobs AS jobs
  WHERE jobs.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vaga não encontrada.';
  END IF;

  IF current_restaurant_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar candidatos desta vaga.'
      USING ERRCODE = '42501';
  END IF;

  IF current_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Esta vaga não está mais aberta.';
  END IF;

  UPDATE public.applications AS applications
  SET status = 'approved'
  WHERE applications.job_id = p_job_id
    AND applications.worker_id = p_worker_id
    AND applications.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidatura não encontrada ou não está pendente.';
  END IF;

  UPDATE public.jobs AS jobs
  SET status = 'filled'
  WHERE jobs.id = p_job_id
    AND jobs.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A vaga não está mais aberta.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_application(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_application(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_open_job_for_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_job_status text;
BEGIN
  SELECT jobs.status
  INTO current_job_status
  FROM public.jobs AS jobs
  WHERE jobs.id = NEW.job_id
  FOR UPDATE;

  IF NOT FOUND OR current_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Esta vaga não está aberta para candidaturas.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER applications_require_open_job
BEFORE INSERT ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.require_open_job_for_application();