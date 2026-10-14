ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
REVOKE SELECT (email, phone) ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, city, score, role, verified) ON TABLE public.users TO authenticated;
GRANT INSERT (id, email, name, role, city, phone, score, verified) ON TABLE public.users TO authenticated;

REVOKE ALL ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, restaurant_id, title, description, job_date, start_time, end_time, value, status)
  ON TABLE public.jobs TO authenticated;
GRANT INSERT (restaurant_id, title, description, job_date, start_time, end_time, value, status, latitude, longitude)
  ON TABLE public.jobs TO authenticated;

REVOKE ALL ON TABLE public.applications FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, job_id, worker_id, status, created_at) ON TABLE public.applications TO authenticated;
GRANT INSERT (job_id, worker_id, status) ON TABLE public.applications TO authenticated;

CREATE OR REPLACE FUNCTION public.worker_has_applied_for_job(p_job_id uuid, p_worker_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_worker_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.applications AS applications
      WHERE applications.job_id = p_job_id
        AND applications.worker_id = p_worker_id
    );
$function$;

REVOKE ALL ON FUNCTION public.worker_has_applied_for_job(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_has_applied_for_job(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS users_select_authenticated_directory ON public.users;
CREATE POLICY users_select_authenticated_directory
ON public.users FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS users_select_authenticated_directory_restrictive ON public.users;
CREATE POLICY users_select_authenticated_directory_restrictive
ON public.users AS RESTRICTIVE FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self
ON public.users FOR INSERT TO authenticated
WITH CHECK (
  id = (SELECT auth.uid())
  AND role IN ('worker', 'restaurant')
  AND COALESCE(verified, false) = false
  AND score = 5
);

DROP POLICY IF EXISTS users_insert_self_restrictive ON public.users;
CREATE POLICY users_insert_self_restrictive
ON public.users AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  id = (SELECT auth.uid())
  AND role IN ('worker', 'restaurant')
  AND COALESCE(verified, false) = false
  AND score = 5
);

DROP POLICY IF EXISTS jobs_select_open_or_owned ON public.jobs;
CREATE POLICY jobs_select_open_or_owned
ON public.jobs FOR SELECT TO authenticated
USING (
  status = 'open'
  OR restaurant_id = (SELECT auth.uid())
  OR public.worker_has_applied_for_job(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS jobs_select_open_or_owned_restrictive ON public.jobs;
CREATE POLICY jobs_select_open_or_owned_restrictive
ON public.jobs AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  status = 'open'
  OR restaurant_id = (SELECT auth.uid())
  OR public.worker_has_applied_for_job(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS jobs_insert_restaurant_open ON public.jobs;
CREATE POLICY jobs_insert_restaurant_open
ON public.jobs FOR INSERT TO authenticated
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND status = 'open'
  AND latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS jobs_insert_restaurant_open_restrictive ON public.jobs;
CREATE POLICY jobs_insert_restaurant_open_restrictive
ON public.jobs AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  restaurant_id = (SELECT auth.uid())
  AND status = 'open'
  AND latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'restaurant'
  )
);

DROP POLICY IF EXISTS applications_select_participant ON public.applications;
CREATE POLICY applications_select_participant
ON public.applications FOR SELECT TO authenticated
USING (
  worker_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.jobs AS jobs
    WHERE jobs.id = applications.job_id AND jobs.restaurant_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS applications_select_participant_restrictive ON public.applications;
CREATE POLICY applications_select_participant_restrictive
ON public.applications AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  worker_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.jobs AS jobs
    WHERE jobs.id = applications.job_id AND jobs.restaurant_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS applications_insert_worker_open_job ON public.applications;
CREATE POLICY applications_insert_worker_open_job
ON public.applications FOR INSERT TO authenticated
WITH CHECK (
  worker_id = (SELECT auth.uid())
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'worker'
  )
  AND EXISTS (
    SELECT 1 FROM public.jobs AS jobs
    WHERE jobs.id = applications.job_id AND jobs.status = 'open'
  )
);

DROP POLICY IF EXISTS applications_insert_worker_open_job_restrictive ON public.applications;
CREATE POLICY applications_insert_worker_open_job_restrictive
ON public.applications AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  worker_id = (SELECT auth.uid())
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.users AS users
    WHERE users.id = (SELECT auth.uid()) AND users.role = 'worker'
  )
  AND EXISTS (
    SELECT 1 FROM public.jobs AS jobs
    WHERE jobs.id = applications.job_id AND jobs.status = 'open'
  )
);