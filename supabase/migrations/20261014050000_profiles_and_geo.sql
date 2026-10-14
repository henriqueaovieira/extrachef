CREATE OR REPLACE FUNCTION public.is_valid_cpf(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  digits text;
  total integer;
  remainder integer;
  first_digit integer;
  second_digit integer;
  index_value integer;
BEGIN
  digits := regexp_replace(COALESCE(input_value, ''), '[^0-9]', '', 'g');
  IF length(digits) <> 11 OR digits = repeat(left(digits, 1), 11) THEN
    RETURN false;
  END IF;

  total := 0;
  FOR index_value IN 1..9 LOOP
    total := total + substring(digits FROM index_value FOR 1)::integer * (11 - index_value);
  END LOOP;
  remainder := total % 11;
  first_digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;

  total := 0;
  FOR index_value IN 1..10 LOOP
    total := total + substring(digits FROM index_value FOR 1)::integer * (12 - index_value);
  END LOOP;
  remainder := total % 11;
  second_digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;

  RETURN substring(digits FROM 10 FOR 1)::integer = first_digit
    AND substring(digits FROM 11 FOR 1)::integer = second_digit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  digits text;
  total integer;
  remainder integer;
  first_digit integer;
  second_digit integer;
  index_value integer;
  weight_value integer;
BEGIN
  digits := regexp_replace(COALESCE(input_value, ''), '[^0-9]', '', 'g');
  IF length(digits) <> 14 OR digits = repeat(left(digits, 1), 14) THEN
    RETURN false;
  END IF;

  total := 0;
  FOR index_value IN 1..12 LOOP
    weight_value := CASE WHEN index_value <= 4 THEN 6 - index_value ELSE 14 - index_value END;
    total := total + substring(digits FROM index_value FOR 1)::integer * weight_value;
  END LOOP;
  remainder := total % 11;
  first_digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;

  total := 0;
  FOR index_value IN 1..13 LOOP
    weight_value := CASE WHEN index_value <= 5 THEN 7 - index_value ELSE 15 - index_value END;
    total := total + substring(digits FROM index_value FOR 1)::integer * weight_value;
  END LOOP;
  remainder := total % 11;
  second_digit := CASE WHEN remainder < 2 THEN 0 ELSE 11 - remainder END;

  RETURN substring(digits FROM 13 FOR 1)::integer = first_digit
    AND substring(digits FROM 14 FOR 1)::integer = second_digit;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.worker_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  cpf text NOT NULL,
  rg text NOT NULL,
  date_of_birth date NOT NULL,
  phone text NOT NULL,
  whatsapp text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  bio text NOT NULL DEFAULT '',
  experience text NOT NULL DEFAULT '',
  specialties text[] NOT NULL DEFAULT '{}',
  certificates jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_photo_path text,
  resume_pdf_path text,
  selfie_verification_path text,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_profiles_valid_cpf CHECK (public.is_valid_cpf(cpf))
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_profiles_cpf_unique
  ON public.worker_profiles (regexp_replace(cpf, '[^0-9]', '', 'g'));

ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.worker_profiles TO authenticated;

DROP POLICY IF EXISTS worker_profiles_select_owner ON public.worker_profiles;
CREATE POLICY worker_profiles_select_owner
ON public.worker_profiles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS worker_profiles_insert_owner ON public.worker_profiles;
CREATE POLICY worker_profiles_insert_owner
ON public.worker_profiles FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'worker')
);

DROP POLICY IF EXISTS worker_profiles_update_owner ON public.worker_profiles;
CREATE POLICY worker_profiles_update_owner
ON public.worker_profiles FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'worker')
);

CREATE TABLE IF NOT EXISTS public.restaurant_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  legal_name text NOT NULL,
  trade_name text NOT NULL,
  phone text NOT NULL,
  whatsapp text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  description text NOT NULL DEFAULT '',
  logo_path text,
  company_photos text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_profiles_valid_cnpj CHECK (public.is_valid_cnpj(cnpj))
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_profiles_cnpj_unique
  ON public.restaurant_profiles (regexp_replace(cnpj, '[^0-9]', '', 'g'));

ALTER TABLE public.restaurant_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.restaurant_profiles TO authenticated;

DROP POLICY IF EXISTS restaurant_profiles_select_owner ON public.restaurant_profiles;
CREATE POLICY restaurant_profiles_select_owner
ON public.restaurant_profiles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS restaurant_profiles_insert_owner ON public.restaurant_profiles;
CREATE POLICY restaurant_profiles_insert_owner
ON public.restaurant_profiles FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant')
);

DROP POLICY IF EXISTS restaurant_profiles_update_owner ON public.restaurant_profiles;
CREATE POLICY restaurant_profiles_update_owner
ON public.restaurant_profiles FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role = 'restaurant')
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('worker-private', 'worker-private', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('restaurant-assets', 'restaurant-assets', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS worker_private_select_owner ON storage.objects;
CREATE POLICY worker_private_select_owner ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'worker-private' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS worker_private_insert_owner ON storage.objects;
CREATE POLICY worker_private_insert_owner ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'worker-private' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS worker_private_update_owner ON storage.objects;
CREATE POLICY worker_private_update_owner ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'worker-private' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'worker-private' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS worker_private_delete_owner ON storage.objects;
CREATE POLICY worker_private_delete_owner ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'worker-private' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS restaurant_assets_public_read ON storage.objects;
CREATE POLICY restaurant_assets_public_read ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'restaurant-assets');

DROP POLICY IF EXISTS restaurant_assets_insert_owner ON storage.objects;
CREATE POLICY restaurant_assets_insert_owner ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'restaurant-assets' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS restaurant_assets_update_owner ON storage.objects;
CREATE POLICY restaurant_assets_update_owner ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'restaurant-assets' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'restaurant-assets' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS restaurant_assets_delete_owner ON storage.objects;
CREATE POLICY restaurant_assets_delete_owner ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'restaurant-assets' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

ALTER TABLE public.checkouts
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

DO $coordinate_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_location_coordinates_valid') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_location_coordinates_valid
      CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.checkins'::regclass AND conname = 'checkins_coordinates_valid') THEN
    ALTER TABLE public.checkins ADD CONSTRAINT checkins_coordinates_valid
      CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.checkouts'::regclass AND conname = 'checkouts_coordinates_valid') THEN
    ALTER TABLE public.checkouts ADD CONSTRAINT checkouts_coordinates_valid
      CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
  END IF;
END;
$coordinate_constraints$;

DROP FUNCTION IF EXISTS public.register_worker_checkin(uuid);
CREATE FUNCTION public.register_worker_checkin(
  p_job_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS TABLE (checkin_id uuid, checkin_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_application_id uuid;
  selected_application_status text;
  job_latitude double precision;
  job_longitude double precision;
  distance_meters double precision;
  selected_checkin_id uuid;
  selected_checkin_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para realizar o check-in.' USING ERRCODE = '42501';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Não foi possível obter uma localização válida.' USING ERRCODE = '22023';
  END IF;

  SELECT applications.id, applications.status, jobs.latitude, jobs.longitude
  INTO selected_application_id, selected_application_status, job_latitude, job_longitude
  FROM public.applications AS applications
  JOIN public.jobs AS jobs ON jobs.id = applications.job_id
  WHERE applications.job_id = p_job_id
    AND applications.worker_id = auth.uid()
  FOR UPDATE OF applications, jobs;

  IF NOT FOUND OR selected_application_status <> 'approved' THEN
    RAISE EXCEPTION 'Check-in disponível somente para trabalhadores aprovados.' USING ERRCODE = '42501';
  END IF;
  IF job_latitude IS NULL OR job_longitude IS NULL THEN
    RAISE EXCEPTION 'O restaurante ainda não cadastrou a localização desta vaga.' USING ERRCODE = '22023';
  END IF;

  distance_meters := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
    power(sin(radians(p_latitude - job_latitude) / 2), 2)
    + cos(radians(job_latitude)) * cos(radians(p_latitude)) * power(sin(radians(p_longitude - job_longitude) / 2), 2)
  ))));
  IF distance_meters > 300 THEN
    RAISE EXCEPTION 'Você está fora do raio de 300 metros do local da diária.' USING ERRCODE = '22023';
  END IF;

  selected_checkin_time := now();
  INSERT INTO public.checkins (job_id, worker_id, checkin_time, latitude, longitude)
  VALUES (p_job_id, auth.uid(), selected_checkin_time, p_latitude, p_longitude)
  RETURNING id, checkins.checkin_time INTO selected_checkin_id, selected_checkin_time;

  UPDATE public.applications AS applications
  SET status = 'in_progress'
  WHERE applications.id = selected_application_id AND applications.status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A candidatura não está mais aprovada.' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT selected_checkin_id, selected_checkin_time;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_worker_checkin(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_worker_checkin(uuid, double precision, double precision) TO authenticated;

DROP FUNCTION IF EXISTS public.register_worker_checkout(uuid);
CREATE FUNCTION public.register_worker_checkout(
  p_job_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS TABLE (checkout_id uuid, checkout_time timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_application_id uuid;
  selected_application_status text;
  selected_job_status text;
  job_latitude double precision;
  job_longitude double precision;
  distance_meters double precision;
  selected_checkout_id uuid;
  selected_checkout_time timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para realizar o check-out.' USING ERRCODE = '42501';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Não foi possível obter uma localização válida.' USING ERRCODE = '22023';
  END IF;

  SELECT applications.id, applications.status, jobs.status, jobs.latitude, jobs.longitude
  INTO selected_application_id, selected_application_status, selected_job_status, job_latitude, job_longitude
  FROM public.applications AS applications
  JOIN public.jobs AS jobs ON jobs.id = applications.job_id
  WHERE applications.job_id = p_job_id AND applications.worker_id = auth.uid()
  FOR UPDATE OF applications, jobs;

  IF NOT FOUND OR selected_application_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Check-out disponível somente após o check-in.' USING ERRCODE = '42501';
  END IF;
  IF selected_job_status <> 'filled' THEN
    RAISE EXCEPTION 'A vaga não está em andamento.' USING ERRCODE = '42501';
  END IF;
  IF job_latitude IS NULL OR job_longitude IS NULL THEN
    RAISE EXCEPTION 'A localização desta vaga não está cadastrada.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.checkins
    WHERE job_id = p_job_id AND worker_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Realize o check-in antes do check-out.' USING ERRCODE = '42501';
  END IF;

  distance_meters := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
    power(sin(radians(p_latitude - job_latitude) / 2), 2)
    + cos(radians(job_latitude)) * cos(radians(p_latitude)) * power(sin(radians(p_longitude - job_longitude) / 2), 2)
  ))));
  IF distance_meters > 300 THEN
    RAISE EXCEPTION 'Você está fora do raio de 300 metros do local da diária.' USING ERRCODE = '22023';
  END IF;

  selected_checkout_time := now();
  INSERT INTO public.checkouts (job_id, worker_id, checkout_time, latitude, longitude)
  VALUES (p_job_id, auth.uid(), selected_checkout_time, p_latitude, p_longitude)
  RETURNING id, checkouts.checkout_time INTO selected_checkout_id, selected_checkout_time;

  UPDATE public.applications SET status = 'completed'
  WHERE id = selected_application_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A candidatura não está mais em andamento.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.jobs SET status = 'completed' WHERE id = p_job_id AND status = 'filled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A vaga não está mais em andamento.' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT selected_checkout_id, selected_checkout_time;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_worker_checkout(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_worker_checkout(uuid, double precision, double precision) TO authenticated;