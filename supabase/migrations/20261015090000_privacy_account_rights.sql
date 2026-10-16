BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('message', 'application', 'operational', 'review', 'event', 'reservation'));
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS auth text GENERATED ALWAYS AS (auth_secret) STORED;

CREATE TABLE IF NOT EXISTS public.privacy_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  show_city boolean NOT NULL DEFAULT false,
  show_score boolean NOT NULL DEFAULT false,
  show_reviews boolean NOT NULL DEFAULT false,
  show_experience boolean NOT NULL DEFAULT false,
  show_phone boolean NOT NULL DEFAULT false,
  show_address boolean NOT NULL DEFAULT false,
  show_photos boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.privacy_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.privacy_preferences TO authenticated;
DROP POLICY IF EXISTS privacy_preferences_owner ON public.privacy_preferences;
CREATE POLICY privacy_preferences_owner ON public.privacy_preferences FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS privacy_preferences_owner_restrictive ON public.privacy_preferences;
CREATE POLICY privacy_preferences_owner_restrictive ON public.privacy_preferences AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version text NOT NULL,
  accepted_terms boolean NOT NULL CHECK (accepted_terms),
  accepted_privacy_policy boolean NOT NULL CHECK (accepted_privacy_policy),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;
DROP POLICY IF EXISTS legal_acceptances_owner ON public.legal_acceptances;
CREATE POLICY legal_acceptances_owner ON public.legal_acceptances FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS legal_acceptances_owner_restrictive ON public.legal_acceptances;
CREATE POLICY legal_acceptances_owner_restrictive ON public.legal_acceptances AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.accept_current_legal_documents()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.legal_acceptances (user_id, version, accepted_terms, accepted_privacy_policy)
  VALUES (auth.uid(), '2026-10-15', true, true) ON CONFLICT (user_id, version) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_current_legal_documents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal_documents() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_signup_legal_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id = NEW.id
      AND raw_user_meta_data ->> 'accepted_terms' = 'true'
      AND raw_user_meta_data ->> 'accepted_privacy_policy' = 'true'
      AND raw_user_meta_data ->> 'legal_version' = '2026-10-15'
  ) THEN
    INSERT INTO public.legal_acceptances (user_id, version, accepted_terms, accepted_privacy_policy)
    VALUES (NEW.id, '2026-10-15', true, true) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_signup_legal_acceptance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_record_legal_acceptance ON public.users;
CREATE TRIGGER users_record_legal_acceptance AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.record_signup_legal_acceptance();

REVOKE SELECT (city, score) ON public.users FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE VIEW public.public_user_directory AS
SELECT u.id, u.name, u.role, u.verified,
  CASE WHEN u.id = auth.uid() OR COALESCE(p.show_city, false) THEN u.city END AS city,
  CASE WHEN u.id = auth.uid() OR COALESCE(p.show_score, false) THEN u.score END AS score
FROM public.users AS u LEFT JOIN public.privacy_preferences AS p ON p.user_id = u.id
WHERE auth.uid() IS NOT NULL AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.users AS requester WHERE requester.id = auth.uid() AND requester.deleted_at IS NULL);
REVOKE ALL ON public.public_user_directory FROM PUBLIC, anon;
GRANT SELECT ON public.public_user_directory TO authenticated;

CREATE OR REPLACE FUNCTION public.export_own_account_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  owner_id uuid := auth.uid();
  result jsonb;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'exported_at', now(), 'format_version', 1,
    'account', (SELECT to_jsonb(u) FROM public.users AS u WHERE id = owner_id),
    'worker_profile', (SELECT to_jsonb(p) FROM public.worker_profiles AS p WHERE user_id = owner_id),
    'restaurant_profile', (SELECT to_jsonb(p) FROM public.restaurant_profiles AS p WHERE user_id = owner_id),
    'jobs', COALESCE((SELECT jsonb_agg(to_jsonb(j)) FROM public.jobs AS j WHERE restaurant_id = owner_id), '[]'),
    'applications', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.applications AS a WHERE worker_id = owner_id), '[]'),
    'messages_sent', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.messages AS m WHERE sender_id = owner_id), '[]'),
    'checkins', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.checkins AS c WHERE worker_id = owner_id), '[]'),
    'checkouts', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.checkouts AS c WHERE worker_id = owner_id), '[]'),
    'reviews_written', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.reviews AS r WHERE reviewer_id = owner_id), '[]'),
    'notifications', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.notifications AS n WHERE user_id = owner_id), '[]'),
    'privacy_preferences', (SELECT to_jsonb(p) FROM public.privacy_preferences AS p WHERE user_id = owner_id),
    'notification_preferences', (SELECT to_jsonb(p) FROM public.notification_preferences AS p WHERE user_id = owner_id),
    'legal_acceptances', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.legal_acceptances AS a WHERE user_id = owner_id), '[]')
  ) INTO result;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_own_account_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_own_account_data() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_request_account_deletion()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.applications WHERE worker_id = auth.uid() AND status IN ('approved', 'in_progress'))
    OR EXISTS (SELECT 1 FROM public.jobs AS j JOIN public.applications AS a ON a.job_id = j.id
      WHERE j.restaurant_id = auth.uid() AND a.status IN ('approved', 'in_progress')) THEN
    RAISE EXCEPTION 'Existem diárias ativas.';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.can_request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_request_account_deletion() TO authenticated;

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM 1 FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM public.applications WHERE worker_id = p_user_id AND status IN ('approved', 'in_progress'))
    OR EXISTS (SELECT 1 FROM public.jobs AS j JOIN public.applications AS a ON a.job_id = j.id
      WHERE j.restaurant_id = p_user_id AND a.status IN ('approved', 'in_progress')) THEN
    RAISE EXCEPTION 'Finalize ou resolva as diárias em andamento antes de excluir a conta.';
  END IF;
  DELETE FROM public.worker_profiles WHERE user_id = p_user_id;
  DELETE FROM public.restaurant_profiles WHERE user_id = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.privacy_preferences WHERE user_id = p_user_id;
  DELETE FROM public.legal_acceptances WHERE user_id = p_user_id;
  UPDATE public.messages SET content = '[Mensagem removida a pedido do autor]' WHERE sender_id = p_user_id;
  UPDATE public.reviews SET comment = '' WHERE reviewer_id = p_user_id;
  UPDATE public.users SET name = 'Conta excluída', email = p_user_id::text || '@deleted.invalid',
    phone = '', city = '', verified = false, deleted_at = now() WHERE id = p_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.may_view_profile_media(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.users AS u
    JOIN public.privacy_preferences AS pref ON pref.user_id = u.id AND pref.show_photos
    LEFT JOIN public.worker_profiles AS wp ON wp.user_id = u.id
    LEFT JOIN public.restaurant_profiles AS rp ON rp.user_id = u.id
    WHERE u.deleted_at IS NULL AND (
      (p_bucket = 'worker-private' AND wp.profile_photo_path = p_path
        AND p_path LIKE u.id::text || '/profile-photo-%')
      OR (p_bucket = 'restaurant-assets' AND (rp.logo_path = p_path OR p_path = ANY(rp.company_photos)))
    ) AND EXISTS (
      SELECT 1 FROM public.jobs AS j JOIN public.applications AS a ON a.job_id = j.id
      WHERE a.status IN ('approved', 'in_progress', 'completed')
        AND ((j.restaurant_id = auth.uid() AND a.worker_id = u.id)
          OR (a.worker_id = auth.uid() AND j.restaurant_id = u.id))
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.may_view_profile_media(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.may_view_profile_media(text, text) TO authenticated;
UPDATE storage.buckets SET public = false WHERE id = 'restaurant-assets';
DROP POLICY IF EXISTS profile_media_visibility ON storage.objects;
CREATE POLICY profile_media_visibility ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id NOT IN ('worker-private', 'restaurant-assets')
  OR (storage.foldername(name))[1] = auth.uid()::text
  OR public.may_view_profile_media(bucket_id, name)
);
DROP POLICY IF EXISTS profile_media_allowed ON storage.objects;
CREATE POLICY profile_media_allowed ON storage.objects FOR SELECT TO authenticated
USING (public.may_view_profile_media(bucket_id, name));

CREATE OR REPLACE FUNCTION public.get_visible_profile(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (p_user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.jobs AS j JOIN public.applications AS a ON a.job_id = j.id
    WHERE a.status IN ('approved', 'in_progress', 'completed')
      AND ((a.worker_id = auth.uid() AND j.restaurant_id = p_user_id)
        OR (j.restaurant_id = auth.uid() AND a.worker_id = p_user_id))
  )) THEN RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'id', u.id, 'name', u.name, 'role', u.role,
    'city', CASE WHEN pref.show_city OR u.id = auth.uid() THEN u.city END,
    'score', CASE WHEN pref.show_score OR u.id = auth.uid() THEN u.score END,
    'phone', CASE WHEN pref.show_phone OR u.id = auth.uid() THEN COALESCE(wp.phone, rp.phone) END,
    'experience', CASE WHEN pref.show_experience OR u.id = auth.uid() THEN wp.experience END,
    'address', CASE WHEN pref.show_address OR u.id = auth.uid() THEN rp.address END,
    'photos', CASE WHEN pref.show_photos OR u.id = auth.uid() THEN to_jsonb(rp.company_photos) ELSE '[]'::jsonb END,
    'reviews', CASE WHEN pref.show_reviews OR u.id = auth.uid() THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rating', r.rating, 'comment', r.comment, 'created_at', r.created_at))
      FROM public.reviews AS r WHERE r.reviewed_id = u.id
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO result FROM public.users AS u
  LEFT JOIN public.privacy_preferences AS pref ON pref.user_id = u.id
  LEFT JOIN public.worker_profiles AS wp ON wp.user_id = u.id
  LEFT JOIN public.restaurant_profiles AS rp ON rp.user_id = u.id
  WHERE u.id = p_user_id AND u.deleted_at IS NULL;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_visible_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_visible_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_push_test()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE notification_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta indisponível.' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = auth.uid() AND title = 'Teste de Push'
    AND created_at > now() - interval '1 minute') THEN
    RAISE EXCEPTION 'Aguarde um minuto antes de repetir o teste.';
  END IF;
  INSERT INTO public.notifications (user_id, title, message, category, url)
  VALUES (auth.uid(), 'Teste de Push', 'Notificação de teste do ExtraChef.', 'operational', '/notifications')
  RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_push_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_push_test() TO authenticated;

CREATE OR REPLACE FUNCTION public.account_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL
  );
$function$;
REVOKE ALL ON FUNCTION public.account_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_is_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_deleted_account_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Esta conta foi excluída.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_deleted_account_write() FROM PUBLIC, anon, authenticated;

DO $active_account_guards$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'jobs', 'applications', 'messages', 'reviews', 'notifications',
    'worker_profiles', 'restaurant_profiles', 'checkins', 'checkouts', 'push_subscriptions',
    'privacy_preferences', 'notification_preferences', 'restaurant_events', 'work_locations'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS account_active_guard ON public.%I', table_name);
    EXECUTE format('CREATE POLICY account_active_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.account_is_active()) WITH CHECK (public.account_is_active())', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS reject_deleted_account_write ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER reject_deleted_account_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_deleted_account_write()', table_name);
  END LOOP;
END;
$active_account_guards$;
DROP POLICY IF EXISTS storage_active_account_guard ON storage.objects;
CREATE POLICY storage_active_account_guard ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (public.account_is_active()) WITH CHECK (public.account_is_active());

COMMIT;
NOTIFY pgrst, 'reload schema';