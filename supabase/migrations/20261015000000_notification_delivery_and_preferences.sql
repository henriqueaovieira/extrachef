ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'operational';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('message', 'application', 'operational', 'review', 'event'));

UPDATE public.notifications
SET category = CASE
  WHEN title = 'Nova mensagem no chat' THEN 'message'
  WHEN title = 'Candidatura aprovada' THEN 'application'
  WHEN title = 'Nova avaliação recebida' THEN 'review'
  ELSE 'operational'
END
WHERE category = 'operational'
  AND title IN (
    'Nova mensagem no chat',
    'Candidatura aprovada',
    'Nova avaliação recebida',
    'Check-in confirmado',
    'Check-out confirmado'
  );

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  messages_enabled boolean NOT NULL DEFAULT true,
  applications_enabled boolean NOT NULL DEFAULT true,
  reviews_enabled boolean NOT NULL DEFAULT true,
  operations_enabled boolean NOT NULL DEFAULT true,
  events_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_preferences TO authenticated;
GRANT SELECT ON TABLE public.notification_preferences TO service_role;

DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own
ON public.notification_preferences
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notification_preferences_own_restrictive ON public.notification_preferences;
CREATE POLICY notification_preferences_own_restrictive
ON public.notification_preferences AS RESTRICTIVE
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

GRANT DELETE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own
ON public.notifications
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_delete_own_restrictive ON public.notifications;
CREATE POLICY notifications_delete_own_restrictive
ON public.notifications AS RESTRICTIVE
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.push_deliveries (
  notification_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  status text NOT NULL,
  status_code integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, subscription_id)
);

ALTER TABLE public.push_deliveries
  DROP CONSTRAINT IF EXISTS push_deliveries_status_check;

ALTER TABLE public.push_deliveries
  ADD CONSTRAINT push_deliveries_status_check
  CHECK (status IN ('sent', 'received', 'expired', 'failed', 'suppressed'));

ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO service_role;

CREATE OR REPLACE FUNCTION public.record_push_delivery(
  p_notification_id uuid,
  p_subscription_id uuid,
  p_status text,
  p_status_code integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_status NOT IN ('sent', 'received', 'expired', 'failed', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid push delivery status.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_deliveries (
    notification_id,
    subscription_id,
    status,
    status_code,
    updated_at
  )
  VALUES (
    p_notification_id,
    p_subscription_id,
    p_status,
    p_status_code,
    now()
  )
  ON CONFLICT (notification_id, subscription_id)
  DO UPDATE SET
    status = CASE
      WHEN public.push_deliveries.status = 'received' THEN 'received'
      ELSE EXCLUDED.status
    END,
    status_code = EXCLUDED.status_code,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.record_push_delivery(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_push_delivery(uuid, uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, title, message, url, category)
    VALUES (
      NEW.worker_id,
      'Candidatura aprovada',
      'Sua candidatura foi aprovada. O chat e o check-in já estão disponíveis.',
      '/chat/' || NEW.job_id::text,
      'application'
    );
  END IF;
  RETURN NEW;
END;
$function$;

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

  IF NEW.sender_id = restaurant_user_id THEN
    recipient_id := worker_user_id;
  ELSIF NEW.sender_id = worker_user_id THEN
    recipient_id := restaurant_user_id;
  END IF;

  IF recipient_id IS NOT NULL AND recipient_id <> NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, message, url, category)
    VALUES (
      recipient_id,
      'Nova mensagem no chat',
      'Você recebeu uma nova mensagem sobre uma diária.',
      '/chat/' || NEW.job_id::text,
      'message'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_checkin_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
BEGIN
  SELECT jobs.restaurant_id INTO restaurant_user_id
  FROM public.jobs AS jobs WHERE jobs.id = NEW.job_id;
  IF restaurant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, url, category)
    VALUES (
      restaurant_user_id,
      'Check-in confirmado',
      'O profissional registrou a chegada para a diária.',
      '/restaurant/candidates#chats',
      'operational'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_checkout_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
BEGIN
  SELECT jobs.restaurant_id INTO restaurant_user_id
  FROM public.jobs AS jobs WHERE jobs.id = NEW.job_id;
  IF restaurant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, url, category)
    VALUES (
      restaurant_user_id,
      'Check-out confirmado',
      'O profissional finalizou a diária.',
      '/restaurant/candidates#chats',
      'operational'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_review_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, url, category)
  VALUES (
    NEW.reviewed_id,
    'Nova avaliação recebida',
    'Você recebeu uma nova avaliação após a diária.',
    '/reviews/' || NEW.job_id::text,
    'review'
  );
  RETURN NEW;
END;
$function$;

DO $realtime$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END;
$realtime$;

NOTIFY pgrst, 'reload schema';

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

  SELECT users.name INTO selected_participant_name
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
