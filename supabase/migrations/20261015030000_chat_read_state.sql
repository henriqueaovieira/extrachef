BEGIN;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
REVOKE UPDATE ON TABLE public.messages FROM PUBLIC, anon, authenticated;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS messages_unread_idx ON public.messages (job_id, sender_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_message_recipient_idx
  ON public.notifications (message_id, user_id) WHERE message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_new_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
  worker_user_id uuid;
  recipient_id uuid;
BEGIN
  SELECT jobs.restaurant_id, applications.worker_id
  INTO restaurant_user_id, worker_user_id
  FROM public.jobs AS jobs
  JOIN public.applications AS applications ON applications.job_id = jobs.id
  WHERE jobs.id = NEW.job_id
    AND applications.status IN ('approved', 'in_progress', 'completed')
  LIMIT 1;

  IF NEW.sender_id = restaurant_user_id THEN recipient_id := worker_user_id;
  ELSIF NEW.sender_id = worker_user_id THEN recipient_id := restaurant_user_id;
  END IF;

  IF recipient_id IS NOT NULL AND recipient_id <> NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, message, url, category, message_id)
    VALUES (recipient_id, 'Nova mensagem no chat', 'Você recebeu uma nova mensagem sobre uma diária.',
      '/chat/' || NEW.job_id::text, 'message', NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_chat_messages_read(p_job_id uuid, p_message_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_chat_participant(p_job_id) THEN
    RAISE EXCEPTION 'Conversa não autorizada.' USING ERRCODE = '42501';
  END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 1000 mensagens por operação.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages SET read_at = now()
  WHERE job_id = p_job_id AND id = ANY(p_message_ids)
    AND sender_id <> auth.uid() AND read_at IS NULL;

  UPDATE public.notifications SET read = true
  WHERE user_id = auth.uid() AND category = 'message'
    AND message_id = ANY(p_message_ids) AND read = false
    AND EXISTS (
      SELECT 1 FROM public.messages m WHERE m.id = message_id
        AND m.job_id = p_job_id AND m.sender_id <> auth.uid() AND m.read_at IS NOT NULL
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.mark_chat_messages_read(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_chat_messages_read(uuid, uuid[]) TO authenticated;

-- Sender-controlled timestamps must not acknowledge messages for the recipient.
CREATE OR REPLACE FUNCTION public.initialize_chat_read_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.read_at := NULL;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS messages_initialize_read_state ON public.messages;
CREATE TRIGGER messages_initialize_read_state BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.initialize_chat_read_state();

CREATE OR REPLACE FUNCTION public.get_chat_message_preview(p_message_id uuid)
RETURNS TABLE (
  id uuid, job_id uuid, sender_id uuid, content text, read_at timestamptz,
  sender_name text, photo_path text, photo_bucket text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id AND m.sender_id <> auth.uid()
      AND public.is_approved_chat_participant(m.job_id)
  ) THEN
    RAISE EXCEPTION 'Mensagem não autorizada.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.job_id, m.sender_id, m.content, m.read_at,
    COALESCE(NULLIF(btrim(u.name), ''), CASE WHEN u.role = 'worker' THEN 'Profissional' ELSE 'Restaurante' END),
    CASE WHEN u.role = 'worker' THEN wp.profile_photo_path ELSE rp.logo_path END,
    CASE WHEN u.role = 'worker' THEN 'worker-private'::text ELSE 'restaurant-assets'::text END
  FROM public.messages m
  JOIN public.users u ON u.id = m.sender_id
  LEFT JOIN public.worker_profiles wp ON wp.user_id = u.id
  LEFT JOIN public.restaurant_profiles rp ON rp.user_id = u.id
  WHERE m.id = p_message_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_chat_message_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_message_preview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_chat_profile_photo(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.worker_profiles wp
    JOIN public.applications a ON a.worker_id = wp.user_id
    JOIN public.jobs j ON j.id = a.job_id
    WHERE wp.profile_photo_path = p_path AND j.restaurant_id = auth.uid()
      AND split_part(p_path, '/', 1) = wp.user_id::text
      AND split_part(p_path, '/', 2) LIKE 'profile-photo-%'
      AND a.status IN ('approved', 'in_progress', 'completed')
  );
$function$;
REVOKE ALL ON FUNCTION public.can_read_chat_profile_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_chat_profile_photo(text) TO authenticated;
DROP POLICY IF EXISTS worker_private_chat_profile_photo ON storage.objects;
CREATE POLICY worker_private_chat_profile_photo ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'worker-private' AND public.can_read_chat_profile_photo(name));

COMMIT;
NOTIFY pgrst, 'reload schema';
