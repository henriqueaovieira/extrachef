BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_account_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_id uuid := auth.uid();
  account_email text;
  account_metadata jsonb;
  account_role public.users.role%TYPE;
  account_name text;
  account_city text;
  account_phone text;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Faça login para concluir o cadastro.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = current_user_id) THEN
    RETURN;
  END IF;

  SELECT email, raw_user_meta_data INTO account_email, account_metadata
  FROM auth.users WHERE id = current_user_id;
  account_role := account_metadata ->> 'role';
  account_name := btrim(COALESCE(account_metadata ->> 'name', ''));
  account_city := btrim(COALESCE(account_metadata ->> 'city', ''));
  account_phone := btrim(COALESCE(account_metadata ->> 'phone', ''));

  IF account_email IS NULL OR account_role IS NULL
    OR account_role NOT IN ('worker', 'restaurant')
    OR char_length(account_name) NOT BETWEEN 2 AND 120
    OR char_length(account_city) NOT BETWEEN 2 AND 120
    OR char_length(account_phone) > 30 THEN
    RAISE EXCEPTION 'Dados de cadastro incompletos ou inválidos.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.users (id, email, name, role, city, phone, score, verified)
  VALUES (
    current_user_id, account_email, account_name, account_role,
    account_city, account_phone, 5, false
  )
  ON CONFLICT (id) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_account_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_account_profile() TO authenticated;

REVOKE INSERT, UPDATE ON TABLE public.worker_profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT (verification_status), UPDATE (verification_status)
  ON TABLE public.worker_profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  user_id, cpf, rg, date_of_birth, phone, whatsapp, address, city, state,
  postal_code, bio, experience, specialties, certificates, profile_photo_path,
  resume_pdf_path, selfie_verification_path, updated_at
) ON TABLE public.worker_profiles TO authenticated;
GRANT UPDATE (
  user_id, cpf, rg, date_of_birth, phone, whatsapp, address, city, state, postal_code,
  bio, experience, specialties, certificates, profile_photo_path,
  resume_pdf_path, selfie_verification_path, updated_at
) ON TABLE public.worker_profiles TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
