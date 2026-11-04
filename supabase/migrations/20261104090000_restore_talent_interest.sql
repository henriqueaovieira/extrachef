-- Objective: allow the interest category and maintain mutual exclusion with favorite.
-- Dependencies: public.talent_connections, users, applications, jobs, and
--   auth.uid(); the existing category constraint must be named
--   talent_connections_category_check.
-- Risk: validating the replacement constraint scans existing rows; ensure all
--   existing categories are represented before deployment.
-- Validation:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.talent_connections'::regclass
--       AND conname = 'talent_connections_category_check';
--   SELECT pg_get_functiondef(
--     'public.set_talent_connection(uuid,text,boolean)'::regprocedure
--   );
--   Test interest/favorite transitions, completed-worker rejection, and disabled categories.
-- Rollback: replace the function and constraint in a new forward migration only
--   after resolving rows currently using interest; do not delete user connections.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.talent_connections') IS NULL
    OR to_regclass('public.users') IS NULL
    OR to_regclass('public.applications') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.talent_connections'::regclass
        AND conname = 'talent_connections_category_check'
    ) THEN
    RAISE EXCEPTION 'Missing talent interest dependencies or expected category constraint.';
  END IF;
END;
$preflight$;

ALTER TABLE public.talent_connections
  DROP CONSTRAINT talent_connections_category_check;

ALTER TABLE public.talent_connections
  ADD CONSTRAINT talent_connections_category_check
  CHECK (category IN ('contact', 'known', 'favorite', 'partner', 'interest'));

CREATE OR REPLACE FUNCTION public.set_talent_connection(
  p_worker_id uuid,
  p_category text,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM 1
  FROM public.users
  WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_worker_id AND role = 'worker' AND deleted_at IS NULL
  )
    OR p_category IS NULL
    OR p_category NOT IN ('contact', 'known', 'favorite', 'partner', 'interest')
    OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Profissional ou categoria indisponível.';
  END IF;

  IF p_enabled AND p_category = 'interest' AND EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE j.restaurant_id = auth.uid()
      AND a.worker_id = p_worker_id
      AND a.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Este profissional já trabalhou com você. Marque-o como favorito.';
  END IF;

  IF p_enabled THEN
    INSERT INTO public.talent_connections
    VALUES (auth.uid(), p_worker_id, p_category)
    ON CONFLICT DO NOTHING;

    IF p_category IN ('favorite', 'interest') THEN
      DELETE FROM public.talent_connections
      WHERE restaurant_id = auth.uid()
        AND worker_id = p_worker_id
        AND category = CASE p_category
          WHEN 'favorite' THEN 'interest'
          ELSE 'favorite'
        END;
    END IF;
  ELSE
    DELETE FROM public.talent_connections
    WHERE restaurant_id = auth.uid()
      AND worker_id = p_worker_id
      AND category = p_category;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_talent_connection(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_talent_connection(uuid, text, boolean)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
