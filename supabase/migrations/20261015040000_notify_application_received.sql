BEGIN;

CREATE OR REPLACE FUNCTION public.notify_application_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  recipient_id uuid;
  worker_name text;
  job_title text;
BEGIN
  SELECT jobs.restaurant_id, users.name, jobs.title
  INTO STRICT recipient_id, worker_name, job_title
  FROM public.jobs AS jobs
  JOIN public.users AS users ON users.id = NEW.worker_id
  WHERE jobs.id = NEW.job_id;

  INSERT INTO public.notifications (user_id, title, message, url, category)
  VALUES (
    recipient_id,
    'Nova candidatura recebida',
    format('%s se candidatou para %s',
      COALESCE(NULLIF(btrim(worker_name), ''), 'Profissional'), job_title),
    '/restaurant/candidates',
    'application'
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_application_received()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS applications_notify_received ON public.applications;
CREATE TRIGGER applications_notify_received
AFTER INSERT ON public.applications
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.notify_application_received();

COMMIT;
NOTIFY pgrst, 'reload schema';
