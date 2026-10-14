CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN read SET DEFAULT false,
  ALTER COLUMN created_at SET DEFAULT now(),
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx
  ON public.notifications (user_id, created_at DESC);

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read) ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_select_own_restrictive ON public.notifications;
CREATE POLICY notifications_select_own_restrictive
ON public.notifications
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notifications_update_own_restrictive ON public.notifications;
CREATE POLICY notifications_update_own_restrictive
ON public.notifications
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.notify_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      NEW.worker_id,
      'Candidatura aprovada',
      'Sua candidatura para a vaga foi aprovada. O chat já está disponível.'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS applications_notify_approved ON public.applications;
CREATE TRIGGER applications_notify_approved
AFTER UPDATE OF status ON public.applications
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_application_approved();

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
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      recipient_id,
      'Nova mensagem no chat',
      'Você recebeu uma nova mensagem sobre uma diária.'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS messages_notify_recipient ON public.messages;
CREATE TRIGGER messages_notify_recipient
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_chat_message();

CREATE OR REPLACE FUNCTION public.notify_checkin_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
BEGIN
  SELECT jobs.restaurant_id
  INTO restaurant_user_id
  FROM public.jobs AS jobs
  WHERE jobs.id = NEW.job_id;

  IF restaurant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      restaurant_user_id,
      'Check-in confirmado',
      'O profissional registrou a chegada para a diária.'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS checkins_notify_restaurant ON public.checkins;
CREATE TRIGGER checkins_notify_restaurant
AFTER INSERT ON public.checkins
FOR EACH ROW
EXECUTE FUNCTION public.notify_checkin_confirmed();

CREATE OR REPLACE FUNCTION public.notify_checkout_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  restaurant_user_id uuid;
BEGIN
  SELECT jobs.restaurant_id
  INTO restaurant_user_id
  FROM public.jobs AS jobs
  WHERE jobs.id = NEW.job_id;

  IF restaurant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      restaurant_user_id,
      'Check-out confirmado',
      'O profissional finalizou a diária.'
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS checkouts_notify_restaurant ON public.checkouts;
CREATE TRIGGER checkouts_notify_restaurant
AFTER INSERT ON public.checkouts
FOR EACH ROW
EXECUTE FUNCTION public.notify_checkout_confirmed();

CREATE OR REPLACE FUNCTION public.notify_review_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, title, message)
  VALUES (
    NEW.reviewed_id,
    'Nova avaliação recebida',
    'Você recebeu uma nova avaliação após a diária.'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reviews_notify_reviewed_user ON public.reviews;
CREATE TRIGGER reviews_notify_reviewed_user
AFTER INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.notify_review_received();

CREATE OR REPLACE FUNCTION public.get_restaurant_dashboard_stats()
RETURNS TABLE (
  total_jobs bigint,
  open_jobs bigint,
  in_progress_jobs bigint,
  completed_jobs bigint,
  professionals_hired bigint,
  average_rating numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = auth.uid() AND users.role = 'restaurant'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido somente para restaurantes autenticados.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE jobs.status = 'open')::bigint,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.applications AS applications
        WHERE applications.job_id = jobs.id
          AND applications.status = 'in_progress'
      )
    )::bigint,
    COUNT(*) FILTER (WHERE jobs.status = 'completed')::bigint,
    (
      SELECT COUNT(DISTINCT applications.worker_id)::bigint
      FROM public.applications AS applications
      JOIN public.jobs AS hired_jobs ON hired_jobs.id = applications.job_id
      WHERE hired_jobs.restaurant_id = auth.uid()
        AND applications.status IN ('approved', 'in_progress', 'completed')
    ),
    COALESCE((
      SELECT ROUND(AVG(reviews.rating)::numeric, 2)
      FROM public.reviews AS reviews
      WHERE reviews.reviewed_id = auth.uid()
    ), 0)::numeric
  FROM public.jobs AS jobs
  WHERE jobs.restaurant_id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_worker_dashboard_stats()
RETURNS TABLE (
  total_applications bigint,
  completed_jobs bigint,
  average_rating numeric,
  current_score numeric,
  history jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_total_applications bigint;
  selected_completed_jobs bigint;
  selected_average_rating numeric;
  selected_score numeric;
  selected_history jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = auth.uid() AND users.role = 'worker'
  ) THEN
    RAISE EXCEPTION 'Acesso permitido somente para trabalhadores autenticados.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE applications.status = 'completed')::bigint
  INTO selected_total_applications, selected_completed_jobs
  FROM public.applications AS applications
  WHERE applications.worker_id = auth.uid();

  SELECT COALESCE(ROUND(AVG(reviews.rating)::numeric, 2), 0)
  INTO selected_average_rating
  FROM public.reviews AS reviews
  WHERE reviews.reviewed_id = auth.uid();

  SELECT COALESCE(users.score, 0)::numeric
  INTO selected_score
  FROM public.users AS users
  WHERE users.id = auth.uid();

  SELECT COALESCE(
    jsonb_agg(to_jsonb(history_rows) ORDER BY history_rows.job_date DESC, history_rows.application_created_at DESC),
    '[]'::jsonb
  )
  INTO selected_history
  FROM (
    SELECT
      jobs.id AS job_id,
      jobs.title,
      jobs.job_date,
      jobs.start_time,
      jobs.end_time,
      jobs.value,
      applications.status,
      applications.created_at AS application_created_at,
      restaurants.name AS restaurant_name
    FROM public.applications AS applications
    JOIN public.jobs AS jobs ON jobs.id = applications.job_id
    LEFT JOIN public.users AS restaurants ON restaurants.id = jobs.restaurant_id
    WHERE applications.worker_id = auth.uid()
      AND applications.status IN ('in_progress', 'completed')
    ORDER BY jobs.job_date DESC, applications.created_at DESC
    LIMIT 8
  ) AS history_rows;

  RETURN QUERY
  SELECT
    selected_total_applications,
    selected_completed_jobs,
    selected_average_rating,
    COALESCE(selected_score, 0),
    selected_history;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_worker_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_worker_dashboard_stats() TO authenticated;

DO $realtime$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END;
$realtime$;

NOTIFY pgrst, 'reload schema';