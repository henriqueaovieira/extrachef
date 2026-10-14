ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS url text;

CREATE OR REPLACE FUNCTION public.notify_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, title, message, url)
    VALUES (
      NEW.worker_id,
      'Candidatura aprovada',
      'Sua candidatura foi aprovada. O chat e o check-in já estão disponíveis.',
      '/chat/' || NEW.job_id::text
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
    INSERT INTO public.notifications (user_id, title, message, url)
    VALUES (recipient_id, 'Nova mensagem no chat', 'Você recebeu uma nova mensagem sobre uma diária.', '/chat/' || NEW.job_id::text);
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
    INSERT INTO public.notifications (user_id, title, message, url)
    VALUES (restaurant_user_id, 'Check-in confirmado', 'O profissional registrou a chegada para a diária.', '/restaurant/candidates#chats');
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
    INSERT INTO public.notifications (user_id, title, message, url)
    VALUES (restaurant_user_id, 'Check-out confirmado', 'O profissional finalizou a diária.', '/restaurant/candidates#chats');
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
  INSERT INTO public.notifications (user_id, title, message, url)
  VALUES (NEW.reviewed_id, 'Nova avaliação recebida', 'Você recebeu uma nova avaliação após a diária.', '/reviews/' || NEW.job_id::text);
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';