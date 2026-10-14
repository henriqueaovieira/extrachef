CREATE TABLE IF NOT EXISTS public.checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checkout_time timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkouts_one_per_job UNIQUE (job_id),
  CONSTRAINT checkouts_one_per_worker_job UNIQUE (worker_id, job_id)
);

ALTER TABLE public.checkouts
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN checkout_time SET DEFAULT now(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS checkouts_worker_created_at_idx
  ON public.checkouts (worker_id, created_at DESC);

REVOKE ALL ON TABLE public.checkouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.checkouts TO authenticated;

CREATE OR REPLACE FUNCTION public.is_checkout_participant(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.checkouts AS checkouts
      JOIN public.jobs AS jobs ON jobs.id = checkouts.job_id
      WHERE checkouts.job_id = p_job_id
        AND (
          checkouts.worker_id = auth.uid()
          OR jobs.restaurant_id = auth.uid()
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.is_checkout_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_checkout_participant(uuid) TO authenticated;

DROP POLICY IF EXISTS checkouts_select_participants ON public.checkouts;
CREATE POLICY checkouts_select_participants
ON public.checkouts
FOR SELECT
TO authenticated
USING (public.is_checkout_participant(job_id));

DROP POLICY IF EXISTS checkouts_select_participants_restrictive ON public.checkouts;
CREATE POLICY checkouts_select_participants_restrictive
ON public.checkouts
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.is_checkout_participant(job_id));

CREATE OR REPLACE FUNCTION public.get_worker_checkout_context(p_job_id uuid)
RETURNS TABLE (
  job_id uuid,
  job_title text,
  job_date date,
  start_time time without time zone,
  end_time time without time zone,
  application_status text,
  checkin_time timestamptz,
  checkout_time timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_job_id uuid;
  selected_job_title text;
  selected_job_date date;
  selected_start_time time without time zone;
  selected_end_time time without time zone;
  selected_application_status text;
  selected_checkin_time timestamptz;
  selected_checkout_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para acessar o check-out.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    jobs.id,
    jobs.title,
    jobs.job_date,
    jobs.start_time,
    jobs.end_time,
    applications.status,
    checkins.checkin_time,
    checkouts.checkout_time
  INTO
    selected_job_id,
    selected_job_title,
    selected_job_date,
    selected_start_time,
    selected_end_time,
    selected_application_status,
    selected_checkin_time,
    selected_checkout_time
  FROM public.applications AS applications
  JOIN public.jobs AS jobs ON jobs.id = applications.job_id
  JOIN public.checkins AS checkins
    ON checkins.job_id = applications.job_id
    AND checkins.worker_id = applications.worker_id
  LEFT JOIN public.checkouts AS checkouts
    ON checkouts.job_id = applications.job_id
    AND checkouts.worker_id = applications.worker_id
  WHERE applications.job_id = p_job_id
    AND applications.worker_id = auth.uid()
    AND applications.status IN ('in_progress', 'completed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check-out disponível somente após o check-in do trabalhador.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    selected_job_id,
    selected_job_title,
    selected_job_date,
    selected_start_time,
    selected_end_time,
    selected_application_status,
    selected_checkin_time,
    selected_checkout_time;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_worker_checkout_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_checkout_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_worker_checkout(p_job_id uuid)
RETURNS TABLE (checkout_id uuid, checkout_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_application_id uuid;
  selected_application_status text;
  selected_job_status text;
  selected_checkout_id uuid;
  selected_checkout_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para realizar o check-out.'
      USING ERRCODE = '42501';
  END IF;

  SELECT applications.id, applications.status, jobs.status
  INTO selected_application_id, selected_application_status, selected_job_status
  FROM public.applications AS applications
  JOIN public.jobs AS jobs ON jobs.id = applications.job_id
  WHERE applications.job_id = p_job_id
    AND applications.worker_id = auth.uid()
  FOR UPDATE OF applications, jobs;

  IF NOT FOUND OR selected_application_status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'Check-out disponível somente após o check-in do trabalhador.'
      USING ERRCODE = '42501';
  END IF;

  IF selected_application_status = 'completed' THEN
    RAISE EXCEPTION 'O check-out desta vaga já foi realizado.'
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.checkins AS checkins
    WHERE checkins.job_id = p_job_id
      AND checkins.worker_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Realize o check-in antes do check-out.'
      USING ERRCODE = '42501';
  END IF;

  IF selected_job_status <> 'filled' THEN
    RAISE EXCEPTION 'A vaga não está em andamento.';
  END IF;

  selected_checkout_time := now();

  INSERT INTO public.checkouts (job_id, worker_id, checkout_time)
  VALUES (p_job_id, auth.uid(), selected_checkout_time)
  RETURNING id, checkouts.checkout_time
  INTO selected_checkout_id, selected_checkout_time;

  UPDATE public.applications AS applications
  SET status = 'completed'
  WHERE applications.id = selected_application_id
    AND applications.worker_id = auth.uid()
    AND applications.status = 'in_progress';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A candidatura não está mais em andamento.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.jobs AS jobs
  SET status = 'completed'
  WHERE jobs.id = p_job_id
    AND jobs.status = 'filled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A vaga não está mais em andamento.'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT selected_checkout_id, selected_checkout_time;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_worker_checkout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_worker_checkout(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_approved_chat_participant(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.applications AS applications
      JOIN public.jobs AS jobs ON jobs.id = applications.job_id
      WHERE applications.job_id = p_job_id
        AND applications.status IN ('approved', 'in_progress', 'completed')
        AND (
          applications.worker_id = auth.uid()
          OR jobs.restaurant_id = auth.uid()
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_approved_chat_context(p_job_id uuid)
RETURNS TABLE (
  job_title text,
  current_user_role text,
  participant_name text,
  participant_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
  worker_user_id uuid;
  selected_job_title text;
  selected_participant_id uuid;
  selected_participant_role text;
  selected_participant_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'É necessário entrar na conta para acessar o chat.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jobs.restaurant_id, applications.worker_id, jobs.title
  INTO restaurant_user_id, worker_user_id, selected_job_title
  FROM public.jobs AS jobs
  JOIN public.applications AS applications ON applications.job_id = jobs.id
  WHERE jobs.id = p_job_id
    AND applications.status IN ('approved', 'in_progress', 'completed')
    AND (
      jobs.restaurant_id = auth.uid()
      OR applications.worker_id = auth.uid()
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chat indisponível: candidatura não aprovada ou usuário sem autorização.'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() = restaurant_user_id THEN
    current_user_role := 'restaurant';
    selected_participant_id := worker_user_id;
    selected_participant_role := 'worker';
  ELSE
    current_user_role := 'worker';
    selected_participant_id := restaurant_user_id;
    selected_participant_role := 'restaurant';
  END IF;

  SELECT users.name
  INTO selected_participant_name
  FROM public.users AS users
  WHERE users.id = selected_participant_id;

  RETURN QUERY
  SELECT
    selected_job_title,
    current_user_role,
    COALESCE(selected_participant_name, selected_participant_role),
    selected_participant_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_approved_chat_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_chat_participant(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_approved_chat_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_chat_context(uuid) TO authenticated;