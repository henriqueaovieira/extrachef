CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewed_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_one_per_user_per_job UNIQUE (job_id, reviewer_id),
  CONSTRAINT reviews_distinct_users CHECK (reviewer_id <> reviewed_id),
  CONSTRAINT reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT reviews_worker_id_fkey
    FOREIGN KEY (worker_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT reviews_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT reviews_reviewed_id_fkey
    FOREIGN KEY (reviewed_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT reviews_comment_length CHECK (char_length(comment) <= 2000)
);

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS restaurant_id uuid,
  ADD COLUMN IF NOT EXISTS worker_id uuid,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_id uuid;

DO $review_identity_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_restaurant_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_restaurant_id_fkey
      FOREIGN KEY (restaurant_id) REFERENCES public.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_restaurant_id_required'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_restaurant_id_required
      CHECK (restaurant_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_worker_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES public.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_worker_id_required'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_worker_id_required
      CHECK (worker_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_reviewer_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reviewer_id_fkey
      FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_reviewer_id_required'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reviewer_id_required
      CHECK (reviewer_id IS NOT NULL)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_reviewed_id_fkey'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reviewed_id_fkey
      FOREIGN KEY (reviewed_id) REFERENCES public.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_reviewed_id_required'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reviewed_id_required
      CHECK (reviewed_id IS NOT NULL)
      NOT VALID;
  END IF;
END;
$review_identity_constraints$;

DO $review_uniqueness$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_one_per_user_per_job'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_one_per_user_per_job
      UNIQUE (job_id, reviewer_id);
  END IF;
END;
$review_uniqueness$;

ALTER TABLE public.reviews
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN comment SET DEFAULT '',
  ALTER COLUMN created_at SET DEFAULT now(),
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS reviews_reviewed_created_at_idx
  ON public.reviews (reviewed_id, created_at DESC);

REVOKE ALL ON TABLE public.reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.is_review_participant(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.jobs AS jobs
      JOIN public.applications AS applications ON applications.job_id = jobs.id
      JOIN public.checkouts AS checkouts
        ON checkouts.job_id = applications.job_id
        AND checkouts.worker_id = applications.worker_id
      WHERE jobs.id = p_job_id
        AND jobs.status = 'completed'
        AND applications.status = 'completed'
        AND (
          jobs.restaurant_id = auth.uid()
          OR applications.worker_id = auth.uid()
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.is_review_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_review_participant(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_create_review(
  p_job_id uuid,
  p_reviewer_id uuid,
  p_reviewed_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.jobs AS jobs
      JOIN public.applications AS applications ON applications.job_id = jobs.id
      JOIN public.checkouts AS checkouts
        ON checkouts.job_id = applications.job_id
        AND checkouts.worker_id = applications.worker_id
      WHERE jobs.id = p_job_id
        AND jobs.status = 'completed'
        AND applications.status = 'completed'
        AND (
          (jobs.restaurant_id = p_reviewer_id AND applications.worker_id = p_reviewed_id)
          OR (applications.worker_id = p_reviewer_id AND jobs.restaurant_id = p_reviewed_id)
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_create_review(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_review(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_create_review_with_worker(
  p_job_id uuid,
  p_reviewer_id uuid,
  p_reviewed_id uuid,
  p_worker_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.jobs AS jobs
      JOIN public.applications AS applications ON applications.job_id = jobs.id
      JOIN public.checkouts AS checkouts
        ON checkouts.job_id = applications.job_id
        AND checkouts.worker_id = applications.worker_id
      WHERE jobs.id = p_job_id
        AND jobs.status = 'completed'
        AND applications.status = 'completed'
        AND applications.worker_id = p_worker_id
        AND (
          (jobs.restaurant_id = p_reviewer_id AND applications.worker_id = p_reviewed_id)
          OR (applications.worker_id = p_reviewer_id AND jobs.restaurant_id = p_reviewed_id)
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_create_review_with_worker(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_review_with_worker(uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_create_review_with_participants(
  p_job_id uuid,
  p_reviewer_id uuid,
  p_reviewed_id uuid,
  p_worker_id uuid,
  p_restaurant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.jobs AS jobs
      JOIN public.applications AS applications ON applications.job_id = jobs.id
      JOIN public.checkouts AS checkouts
        ON checkouts.job_id = applications.job_id
        AND checkouts.worker_id = applications.worker_id
      WHERE jobs.id = p_job_id
        AND jobs.status = 'completed'
        AND applications.status = 'completed'
        AND applications.worker_id = p_worker_id
        AND jobs.restaurant_id = p_restaurant_id
        AND (
          (jobs.restaurant_id = p_reviewer_id AND applications.worker_id = p_reviewed_id)
          OR (applications.worker_id = p_reviewer_id AND jobs.restaurant_id = p_reviewed_id)
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_create_review_with_participants(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_review_with_participants(uuid, uuid, uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS reviews_select_participants ON public.reviews;
CREATE POLICY reviews_select_participants
ON public.reviews
FOR SELECT
TO authenticated
USING (
  public.is_review_participant(job_id)
  AND (reviewer_id = (SELECT auth.uid()) OR reviewed_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS reviews_select_participants_restrictive ON public.reviews;
CREATE POLICY reviews_select_participants_restrictive
ON public.reviews
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.is_review_participant(job_id)
  AND (reviewer_id = (SELECT auth.uid()) OR reviewed_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS reviews_insert_after_completed_job ON public.reviews;
CREATE POLICY reviews_insert_after_completed_job
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  reviewer_id = (SELECT auth.uid())
  AND rating BETWEEN 1 AND 5
  AND char_length(comment) <= 2000
  AND public.can_create_review_with_participants(job_id, reviewer_id, reviewed_id, worker_id, restaurant_id)
);

DROP POLICY IF EXISTS reviews_insert_after_completed_job_restrictive ON public.reviews;
CREATE POLICY reviews_insert_after_completed_job_restrictive
ON public.reviews
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  reviewer_id = (SELECT auth.uid())
  AND rating BETWEEN 1 AND 5
  AND char_length(comment) <= 2000
  AND public.can_create_review_with_participants(job_id, reviewer_id, reviewed_id, worker_id, restaurant_id)
);

CREATE OR REPLACE FUNCTION public.get_review_context(p_job_id uuid)
RETURNS TABLE (
  job_title text,
  reviewed_id uuid,
  reviewed_name text,
  existing_rating integer,
  existing_comment text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_restaurant_id uuid;
  selected_worker_id uuid;
  selected_job_title text;
  selected_reviewed_id uuid;
  selected_reviewed_name text;
  selected_rating integer;
  selected_comment text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para avaliar esta diária.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jobs.restaurant_id, applications.worker_id, jobs.title
  INTO selected_restaurant_id, selected_worker_id, selected_job_title
  FROM public.jobs AS jobs
  JOIN public.applications AS applications ON applications.job_id = jobs.id
  JOIN public.checkouts AS checkouts
    ON checkouts.job_id = applications.job_id
    AND checkouts.worker_id = applications.worker_id
  WHERE jobs.id = p_job_id
    AND jobs.status = 'completed'
    AND applications.status = 'completed'
    AND (
      jobs.restaurant_id = auth.uid()
      OR applications.worker_id = auth.uid()
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliações disponíveis somente após a conclusão da diária.'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() = selected_restaurant_id THEN
    selected_reviewed_id := selected_worker_id;
  ELSE
    selected_reviewed_id := selected_restaurant_id;
  END IF;

  SELECT users.name
  INTO selected_reviewed_name
  FROM public.users AS users
  WHERE users.id = selected_reviewed_id;

  SELECT reviews.rating, reviews.comment
  INTO selected_rating, selected_comment
  FROM public.reviews AS reviews
  WHERE reviews.job_id = p_job_id
    AND reviews.reviewer_id = auth.uid();

  RETURN QUERY
  SELECT
    selected_job_title,
    selected_reviewed_id,
    COALESCE(selected_reviewed_name, 'Usuário'),
    selected_rating,
    selected_comment;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_review_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_context(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_review_context_with_worker(p_job_id uuid)
RETURNS TABLE (
  job_title text,
  worker_id uuid,
  reviewed_id uuid,
  reviewed_name text,
  existing_rating integer,
  existing_comment text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_restaurant_id uuid;
  selected_worker_id uuid;
  selected_job_title text;
  selected_reviewed_id uuid;
  selected_reviewed_name text;
  selected_rating integer;
  selected_comment text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para avaliar esta diária.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jobs.restaurant_id, applications.worker_id, jobs.title
  INTO selected_restaurant_id, selected_worker_id, selected_job_title
  FROM public.jobs AS jobs
  JOIN public.applications AS applications ON applications.job_id = jobs.id
  JOIN public.checkouts AS checkouts
    ON checkouts.job_id = applications.job_id
    AND checkouts.worker_id = applications.worker_id
  WHERE jobs.id = p_job_id
    AND jobs.status = 'completed'
    AND applications.status = 'completed'
    AND (
      jobs.restaurant_id = auth.uid()
      OR applications.worker_id = auth.uid()
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliações disponíveis somente após a conclusão da diária.'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() = selected_restaurant_id THEN
    selected_reviewed_id := selected_worker_id;
  ELSE
    selected_reviewed_id := selected_restaurant_id;
  END IF;

  SELECT users.name
  INTO selected_reviewed_name
  FROM public.users AS users
  WHERE users.id = selected_reviewed_id;

  SELECT reviews.rating, reviews.comment
  INTO selected_rating, selected_comment
  FROM public.reviews AS reviews
  WHERE reviews.job_id = p_job_id
    AND reviews.reviewer_id = auth.uid();

  RETURN QUERY
  SELECT
    selected_job_title,
    selected_worker_id,
    selected_reviewed_id,
    COALESCE(selected_reviewed_name, 'Usuário'),
    selected_rating,
    selected_comment;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_review_context_with_worker(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_context_with_worker(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_review_context_with_participants(p_job_id uuid)
RETURNS TABLE (
  job_title text,
  restaurant_id uuid,
  worker_id uuid,
  reviewed_id uuid,
  reviewed_name text,
  existing_rating integer,
  existing_comment text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_restaurant_id uuid;
  selected_worker_id uuid;
  selected_job_title text;
  selected_reviewed_id uuid;
  selected_reviewed_name text;
  selected_rating integer;
  selected_comment text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para avaliar esta diária.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jobs.restaurant_id, applications.worker_id, jobs.title
  INTO selected_restaurant_id, selected_worker_id, selected_job_title
  FROM public.jobs AS jobs
  JOIN public.applications AS applications ON applications.job_id = jobs.id
  JOIN public.checkouts AS checkouts
    ON checkouts.job_id = applications.job_id
    AND checkouts.worker_id = applications.worker_id
  WHERE jobs.id = p_job_id
    AND jobs.status = 'completed'
    AND applications.status = 'completed'
    AND (
      jobs.restaurant_id = auth.uid()
      OR applications.worker_id = auth.uid()
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliações disponíveis somente após a conclusão da diária.'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() = selected_restaurant_id THEN
    selected_reviewed_id := selected_worker_id;
  ELSE
    selected_reviewed_id := selected_restaurant_id;
  END IF;

  SELECT users.name
  INTO selected_reviewed_name
  FROM public.users AS users
  WHERE users.id = selected_reviewed_id;

  SELECT reviews.rating, reviews.comment
  INTO selected_rating, selected_comment
  FROM public.reviews AS reviews
  WHERE reviews.job_id = p_job_id
    AND reviews.reviewer_id = auth.uid();

  RETURN QUERY
  SELECT
    selected_job_title,
    selected_restaurant_id,
    selected_worker_id,
    selected_reviewed_id,
    COALESCE(selected_reviewed_name, 'Usuário'),
    selected_rating,
    selected_comment;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_review_context_with_participants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_context_with_participants(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_user_score_from_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  calculated_score numeric(4, 2);
BEGIN
  PERFORM 1
  FROM public.users AS users
  WHERE users.id = NEW.reviewed_id
  FOR UPDATE;

  SELECT AVG(reviews.rating)::numeric(4, 2)
  INTO calculated_score
  FROM public.reviews AS reviews
  WHERE reviews.reviewed_id = NEW.reviewed_id;

  UPDATE public.users AS users
  SET score = calculated_score
  WHERE users.id = NEW.reviewed_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reviews_update_user_score ON public.reviews;
CREATE TRIGGER reviews_update_user_score
AFTER INSERT ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_user_score_from_review();