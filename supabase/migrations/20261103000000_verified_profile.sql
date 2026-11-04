BEGIN;

REVOKE INSERT (selfie_verification_path), UPDATE (selfie_verification_path)
  ON public.worker_profiles FROM PUBLIC, anon, authenticated;

CREATE INDEX worker_profiles_selfie_path_idx ON public.worker_profiles (selfie_verification_path)
WHERE selfie_verification_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_worker_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  NEW.updated_at := clock_timestamp();
  IF NEW.profile_photo_path IS NOT NULL AND (
    NEW.profile_photo_path LIKE NEW.user_id::text || '/selfie-%'
    OR NEW.profile_photo_path = NEW.selfie_verification_path
  ) THEN
    RAISE EXCEPTION 'A selfie de verificação não pode ser usada como foto pública.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.cpf IS DISTINCT FROM OLD.cpf OR NEW.rg IS DISTINCT FROM OLD.rg
    OR NEW.phone IS DISTINCT FROM OLD.phone
  ) THEN
    NEW.verification_status := 'pending';
  END IF;
  IF NEW.verification_status = 'verified' AND (
    NULLIF(btrim(NEW.cpf), '') IS NULL OR NULLIF(btrim(NEW.rg), '') IS NULL
    OR NULLIF(btrim(NEW.phone), '') IS NULL OR NULLIF(NEW.selfie_verification_path, '') IS NULL
  ) THEN
    RAISE EXCEPTION 'CPF, RG, telefone e selfie são obrigatórios para verificar o perfil.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_worker_verification() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER worker_verification_guard BEFORE INSERT OR UPDATE ON public.worker_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_worker_verification();

CREATE FUNCTION public.submit_own_profile_verification(p_selfie_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE profile public.worker_profiles;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Entre na conta profissional para solicitar verificação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile FROM public.worker_profiles WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR NULLIF(btrim(profile.cpf), '') IS NULL
    OR NULLIF(btrim(profile.rg), '') IS NULL OR NULLIF(btrim(profile.phone), '') IS NULL THEN
    RAISE EXCEPTION 'Salve CPF, RG e telefone antes de solicitar verificação.' USING ERRCODE = '22023';
  END IF;
  IF profile.verification_status = 'verified'
    OR (profile.verification_status = 'pending' AND NULLIF(profile.selfie_verification_path, '') IS NOT NULL) THEN
    RAISE EXCEPTION 'O perfil já está verificado ou em análise.' USING ERRCODE = '22023';
  END IF;
  IF p_selfie_path = profile.selfie_verification_path THEN
    RAISE EXCEPTION 'Capture e envie uma nova selfie para solicitar outra revisão.' USING ERRCODE = '22023';
  END IF;
  IF p_selfie_path IS NULL OR p_selfie_path NOT LIKE auth.uid()::text || '/selfie-%'
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE bucket_id = 'worker-private' AND name = p_selfie_path
        AND metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
    ) THEN
    RAISE EXCEPTION 'Envie uma selfie válida para solicitar verificação.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.worker_profiles SET selfie_verification_path = p_selfie_path,
    verification_status = 'pending', updated_at = now() WHERE user_id = auth.uid();
END;
$fn$;
REVOKE ALL ON FUNCTION public.submit_own_profile_verification(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_own_profile_verification(text) TO authenticated;

CREATE FUNCTION public.review_profile_verification(p_user_id uuid, p_selfie_path text, p_status text, p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Resultado de revisão inválido.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.worker_profiles wp SET verification_status = p_status, updated_at = now()
  WHERE wp.user_id = p_user_id AND wp.verification_status = 'pending'
    AND wp.updated_at = p_expected_updated_at
    AND NULLIF(wp.selfie_verification_path, '') IS NOT NULL AND wp.selfie_verification_path = p_selfie_path
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = wp.user_id AND u.deleted_at IS NULL)
    AND (p_status = 'rejected' OR EXISTS (
      SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'worker-private' AND o.name = wp.selfie_verification_path
        AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
    ));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação indisponível, dados alterados ou selfie substituída. Atualize a revisão.' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.review_profile_verification(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_profile_verification(uuid, text, text, timestamptz) TO service_role;

CREATE FUNCTION public.is_submitted_verification_photo(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.worker_profiles WHERE selfie_verification_path = p_path);
$fn$;
REVOKE ALL ON FUNCTION public.is_submitted_verification_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_submitted_verification_photo(text) TO authenticated;

CREATE POLICY worker_selfie_private ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> 'worker-private'
  OR (storage.foldername(name))[1] = auth.uid()::text
  OR (name NOT LIKE '%/selfie-%' AND NOT public.is_submitted_verification_photo(name))
);

CREATE POLICY worker_selfie_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id <> 'worker-private' OR NOT public.is_submitted_verification_photo(name))
WITH CHECK (bucket_id <> 'worker-private' OR NOT public.is_submitted_verification_photo(name));
CREATE POLICY worker_selfie_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> 'worker-private' OR NOT public.is_submitted_verification_photo(name));

CREATE OR REPLACE VIEW public.public_user_directory AS
SELECT u.id, u.name, u.role, u.verified,
  CASE WHEN u.id = auth.uid() OR COALESCE(p.show_city, false) THEN u.city END AS city,
  CASE WHEN u.id = auth.uid() OR COALESCE(p.show_score, false) THEN u.score END AS score,
  u.role = 'worker' AND EXISTS (
    SELECT 1 FROM public.worker_profiles wp WHERE wp.user_id = u.id
      AND wp.verification_status = 'verified' AND NULLIF(wp.selfie_verification_path, '') IS NOT NULL
      AND NULLIF(btrim(wp.cpf), '') IS NOT NULL AND NULLIF(btrim(wp.rg), '') IS NOT NULL
      AND NULLIF(btrim(wp.phone), '') IS NOT NULL
  ) AS profile_verified
FROM public.users u LEFT JOIN public.privacy_preferences p ON p.user_id = u.id
WHERE auth.uid() IS NOT NULL AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users requester WHERE requester.id = auth.uid() AND requester.deleted_at IS NULL);

COMMIT;
NOTIFY pgrst, 'reload schema';
