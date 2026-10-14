CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  CONSTRAINT messages_content_length_check
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN content SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ENABLE ROW LEVEL SECURITY;

DO $message_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname = 'messages_content_length_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_content_length_check
      CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000);
  END IF;
END;
$message_constraints$;

CREATE INDEX IF NOT EXISTS messages_job_created_at_idx
  ON public.messages (job_id, created_at);

GRANT SELECT, INSERT ON public.messages TO authenticated;

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
        AND applications.status = 'approved'
        AND (
          applications.worker_id = auth.uid()
          OR jobs.restaurant_id = auth.uid()
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.is_approved_chat_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_chat_participant(uuid) TO authenticated;

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
    AND applications.status = 'approved'
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

REVOKE ALL ON FUNCTION public.get_approved_chat_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_chat_context(uuid) TO authenticated;

DROP POLICY IF EXISTS messages_select_approved_participants ON public.messages;
CREATE POLICY messages_select_approved_participants
ON public.messages
FOR SELECT
TO authenticated
USING (public.is_approved_chat_participant(job_id));

DROP POLICY IF EXISTS messages_select_approved_participants_restrictive ON public.messages;
CREATE POLICY messages_select_approved_participants_restrictive
ON public.messages
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.is_approved_chat_participant(job_id));

DROP POLICY IF EXISTS messages_insert_approved_participants ON public.messages;
CREATE POLICY messages_insert_approved_participants
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND char_length(btrim(content)) BETWEEN 1 AND 4000
  AND public.is_approved_chat_participant(job_id)
);

DROP POLICY IF EXISTS messages_insert_approved_participants_restrictive ON public.messages;
CREATE POLICY messages_insert_approved_participants_restrictive
ON public.messages
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND char_length(btrim(content)) BETWEEN 1 AND 4000
  AND public.is_approved_chat_participant(job_id)
);

DO $realtime$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END;
$realtime$;