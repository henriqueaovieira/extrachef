-- Objective: restore the paginated operational message inbox for restaurants.
-- Dependencies: public.users, jobs, applications, worker_profiles,
--   privacy_preferences, operational_assignments, messages,
--   operational_start(uuid), operational_end(uuid), and
--   is_approved_chat_participant(uuid).
-- Risk: exposes worker and operational data; authorization and privacy filters
--   must remain intact.
-- Validation:
--   SELECT to_regprocedure('public.restaurant_operational_message_inbox(integer,integer)');
--   SELECT pg_get_functiondef(
--     'public.restaurant_operational_message_inbox(integer,integer)'::regprocedure
--   );
--   Test unauthorized roles, pagination limits, unread counts, and each privacy
--   preference before enabling the client.
-- Rollback: restore the prior RPC definition with a new forward migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('public.users') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR to_regclass('public.applications') IS NULL
    OR to_regclass('public.worker_profiles') IS NULL
    OR to_regclass('public.privacy_preferences') IS NULL
    OR to_regclass('public.operational_assignments') IS NULL
    OR to_regclass('public.messages') IS NULL
    OR to_regprocedure('public.operational_start(public.jobs)') IS NULL
    OR to_regprocedure('public.operational_end(public.jobs)') IS NULL
    OR to_regprocedure('public.is_approved_chat_participant(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing operational inbox dependencies; reconcile operational messaging first.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.restaurant_operational_message_inbox(
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  job_id uuid,
  demand_id uuid,
  worker_id uuid,
  worker_name text,
  worker_specialty text,
  worker_score numeric,
  worker_photo_path text,
  completed_operations bigint,
  demand_title text,
  job_date date,
  start_time time,
  end_time time,
  location text,
  operational_status text,
  latest_message text,
  latest_message_at timestamptz,
  unread_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users actor
    WHERE actor.id = auth.uid()
      AND actor.role = 'restaurant'
      AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;

  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Página inválida.';
  END IF;

  RETURN QUERY
  SELECT
    j.id,
    j.demand_id,
    worker.id,
    worker.name,
    CASE WHEN COALESCE(pref.show_experience, false) THEN wp.specialties[1] END,
    CASE WHEN COALESCE(pref.show_score, false) THEN worker.score::numeric END,
    CASE WHEN COALESCE(pref.show_photos, false) THEN wp.profile_photo_path END,
    (
      SELECT count(*)
      FROM public.operational_assignments completed
      WHERE completed.worker_id = worker.id
        AND completed.checkout_at IS NOT NULL
        AND completed.interruption IS NULL
    ),
    j.title,
    j.job_date,
    j.start_time,
    j.end_time,
    COALESCE(
      NULLIF(btrim(j.location_name), ''),
      NULLIF(concat_ws(', ',
        NULLIF(btrim(j.work_address), ''),
        NULLIF(btrim(j.work_neighborhood), ''),
        NULLIF(btrim(j.work_city), ''),
        NULLIF(btrim(j.work_state), '')
      ), ''),
      'Local a definir'
    ),
    CASE
      WHEN assignment.interruption IS NOT NULL THEN 'Encerrada'
      WHEN assignment.checkout_at IS NOT NULL THEN 'Concluída'
      WHEN assignment.checkin_at IS NULL AND now() < public.operational_start(j) THEN 'Contratado'
      WHEN assignment.checkin_at IS NULL THEN 'Check-in pendente'
      WHEN now() < public.operational_end(j) THEN 'Em operação'
      WHEN assignment.receipt_confirmed_at IS NOT NULL THEN 'Checkout pendente'
      ELSE 'Pagamento pendente'
    END,
    latest.content,
    latest.created_at,
    (
      SELECT count(*)
      FROM public.messages unread
      WHERE unread.job_id = j.id
        AND unread.sender_id <> auth.uid()
        AND unread.read_at IS NULL
    )
  FROM public.jobs j
  JOIN public.users restaurant ON restaurant.id = j.restaurant_id
  JOIN public.applications application ON application.job_id = j.id
  JOIN public.users worker ON worker.id = application.worker_id
  LEFT JOIN public.worker_profiles wp ON wp.user_id = worker.id
  LEFT JOIN public.privacy_preferences pref ON pref.user_id = worker.id
  LEFT JOIN public.operational_assignments assignment
    ON assignment.job_id = j.id AND assignment.worker_id = worker.id
  LEFT JOIN LATERAL (
    SELECT message.content, message.created_at
    FROM public.messages message
    WHERE message.job_id = j.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) latest ON true
  WHERE j.restaurant_id = auth.uid()
    AND restaurant.role = 'restaurant'
    AND worker.role = 'worker'
    AND worker.deleted_at IS NULL
    AND worker.id <> j.restaurant_id
    AND application.status IN ('approved', 'in_progress', 'completed')
    AND public.is_approved_chat_participant(j.id)
  ORDER BY COALESCE(latest.created_at, assignment.hired_at) DESC NULLS LAST, j.id
  OFFSET p_offset
  LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.restaurant_operational_message_inbox(integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_operational_message_inbox(integer, integer)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
