BEGIN;

CREATE FUNCTION public.restaurant_talent_directory(p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
RETURNS TABLE(
  id uuid,
  name text,
  city text,
  state text,
  bio text,
  specialties text[],
  score numeric,
  photo_path text,
  experience text,
  categories text[],
  completed_operations bigint,
  invitation_status text,
  reputation jsonb,
  review_count bigint,
  reviews jsonb,
  restaurant_operations bigint,
  last_hired_at timestamptz,
  history jsonb,
  has_pending_application boolean,
  candidate_demand_id uuid,
  has_invitation boolean,
  invited_demands uuid[],
  total_count bigint,
  candidate_count bigint,
  invited_count bigint,
  favorite_count bigint,
  partner_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.id = auth.uid() AND actor.role = 'restaurant' AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Página inválida.';
  END IF;

  RETURN QUERY
  WITH directory AS (
    SELECT u.id, u.name,
      CASE WHEN COALESCE(pref.show_city, false) THEN wp.city END AS city,
      CASE WHEN COALESCE(pref.show_city, false) THEN wp.state END AS state,
      CASE WHEN COALESCE(pref.show_experience, false) THEN wp.bio END AS bio,
      CASE WHEN COALESCE(pref.show_experience, false) THEN wp.specialties ELSE ARRAY[]::text[] END AS specialties,
      CASE WHEN COALESCE(pref.show_score, false) THEN u.score::numeric END AS score,
      CASE WHEN COALESCE(pref.show_photos, false) THEN wp.profile_photo_path END AS photo_path,
      CASE WHEN COALESCE(pref.show_experience, false) THEN wp.experience END AS experience,
      ARRAY(
        SELECT connection.category FROM public.talent_connections connection
        WHERE connection.restaurant_id = auth.uid() AND connection.worker_id = u.id
        ORDER BY connection.category
      ) AS categories,
      (SELECT count(DISTINCT j.demand_id)
        FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
        WHERE a.worker_id = u.id AND j.restaurant_id = auth.uid() AND a.status = 'completed') AS completed_operations,
      (SELECT i.status FROM public.demand_invitations i
        WHERE i.restaurant_id = auth.uid() AND i.worker_id = u.id
        ORDER BY i.created_at DESC LIMIT 1) AS invitation_status,
      public.worker_operational_reputation(u.id) AS reputation,
      CASE WHEN COALESCE(pref.show_reviews, false) THEN
        (SELECT count(*) FROM public.reviews r WHERE r.reviewed_id = u.id)
      END AS review_count,
      CASE WHEN COALESCE(pref.show_reviews, false) THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'restaurant_name', review.restaurant_name,
          'rating', review.rating,
          'created_at', review.created_at,
          'comment', review.comment
        ) ORDER BY review.created_at DESC)
        FROM (
          SELECT restaurant.name AS restaurant_name, r.rating, r.created_at, r.comment
          FROM public.reviews r
          JOIN public.users restaurant ON restaurant.id = r.restaurant_id
          WHERE r.reviewed_id = u.id
          ORDER BY r.created_at DESC
          LIMIT 3
        ) review
      ), '[]'::jsonb) ELSE '[]'::jsonb END AS reviews,
      (SELECT count(*) FROM public.operational_assignments assignment
        WHERE assignment.restaurant_id = auth.uid() AND assignment.worker_id = u.id) AS restaurant_operations,
      (SELECT max(assignment.hired_at) FROM public.operational_assignments assignment
        WHERE assignment.restaurant_id = auth.uid() AND assignment.worker_id = u.id) AS last_hired_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'title', operation.title,
          'job_date', operation.job_date,
          'hired_at', operation.hired_at,
          'status', operation.status
        ) ORDER BY operation.hired_at DESC)
        FROM (
          SELECT j.title, j.job_date, assignment.hired_at,
            CASE WHEN assignment.interruption IS NOT NULL THEN assignment.interruption
              WHEN assignment.checkout_at IS NOT NULL THEN 'Concluída'
              ELSE 'Contratada' END AS status
          FROM public.operational_assignments assignment
          JOIN public.jobs j ON j.id = assignment.job_id
          WHERE assignment.restaurant_id = auth.uid() AND assignment.worker_id = u.id
          ORDER BY assignment.hired_at DESC
          LIMIT 5
        ) operation
      ), '[]'::jsonb) AS history,
      EXISTS(
        SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
        WHERE j.restaurant_id = auth.uid() AND a.worker_id = u.id AND a.status = 'pending'
          AND j.status <> 'cancelled'
      ) AS has_pending_application,
      (SELECT j.demand_id FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
        WHERE j.restaurant_id = auth.uid() AND a.worker_id = u.id AND a.status = 'pending'
          AND j.status <> 'cancelled'
        ORDER BY a.created_at DESC LIMIT 1) AS candidate_demand_id,
      EXISTS(
        SELECT 1 FROM public.demand_invitations i
        WHERE i.restaurant_id = auth.uid() AND i.worker_id = u.id
      ) AS has_invitation,
      ARRAY(
        SELECT i.demand_id FROM public.demand_invitations i
        WHERE i.restaurant_id = auth.uid() AND i.worker_id = u.id
      ) AS invited_demands
    FROM public.users u
    LEFT JOIN public.worker_profiles wp ON wp.user_id = u.id
    LEFT JOIN public.privacy_preferences pref ON pref.user_id = u.id
    WHERE u.role = 'worker' AND u.deleted_at IS NULL
  )
  SELECT directory.id, directory.name, directory.city, directory.state, directory.bio,
    directory.specialties, directory.score, directory.photo_path, directory.experience,
    directory.categories, directory.completed_operations, directory.invitation_status,
    directory.reputation, directory.review_count, directory.reviews,
    directory.restaurant_operations, directory.last_hired_at, directory.history,
    directory.has_pending_application, directory.candidate_demand_id, directory.has_invitation,
    directory.invited_demands,
    count(*) OVER (),
    count(*) FILTER (WHERE directory.has_pending_application) OVER (),
    count(*) FILTER (WHERE directory.has_invitation) OVER (),
    count(*) FILTER (WHERE 'favorite' = ANY(directory.categories)) OVER (),
    count(*) FILTER (WHERE 'partner' = ANY(directory.categories)) OVER ()
  FROM directory
  ORDER BY directory.name, directory.id
  OFFSET p_offset LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.restaurant_talent_directory(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_talent_directory(integer, integer) TO authenticated;

CREATE FUNCTION public.restaurant_talent_reviews(
  p_worker_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(restaurant_name text, rating integer, created_at timestamptz, comment text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.id = auth.uid() AND actor.role = 'restaurant' AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Página inválida.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.privacy_preferences pref ON pref.user_id = u.id AND pref.show_reviews
    WHERE u.id = p_worker_id AND u.role = 'worker' AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'As avaliações deste profissional não estão disponíveis.';
  END IF;

  RETURN QUERY
  SELECT restaurant.name, review.rating, review.created_at, review.comment, count(*) OVER ()
  FROM public.reviews review
  JOIN public.users restaurant ON restaurant.id = review.restaurant_id
  WHERE review.reviewed_id = p_worker_id
  ORDER BY review.created_at DESC
  OFFSET p_offset LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.restaurant_talent_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_talent_reviews(uuid, integer, integer) TO authenticated;

CREATE FUNCTION public.restaurant_talent_history(
  p_worker_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(title text, job_date date, hired_at timestamptz, status text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users actor
    WHERE actor.id = auth.uid() AND actor.role = 'restaurant' AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Página inválida.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users worker
    WHERE worker.id = p_worker_id AND worker.role = 'worker' AND worker.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Profissional indisponível.';
  END IF;

  RETURN QUERY
  SELECT operation.title, operation.job_date, operation.hired_at, operation.status, count(*) OVER ()
  FROM (
    SELECT j.title, j.job_date, assignment.hired_at,
      CASE WHEN assignment.interruption IS NOT NULL THEN assignment.interruption
        WHEN assignment.checkout_at IS NOT NULL THEN 'Concluída'
        ELSE 'Contratada' END AS status
    FROM public.operational_assignments assignment
    JOIN public.jobs j ON j.id = assignment.job_id
    WHERE assignment.restaurant_id = auth.uid() AND assignment.worker_id = p_worker_id
  ) operation
  ORDER BY operation.hired_at DESC
  OFFSET p_offset LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.restaurant_talent_history(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_talent_history(uuid, integer, integer) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
