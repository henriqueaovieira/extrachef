CREATE OR REPLACE FUNCTION public.update_own_profile_summary(
  p_name text,
  p_city text,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS users WHERE users.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Sessão inválida para atualizar o perfil.' USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 120
    OR char_length(btrim(COALESCE(p_city, ''))) NOT BETWEEN 2 AND 120
    OR char_length(btrim(COALESCE(p_phone, ''))) NOT BETWEEN 8 AND 30 THEN
    RAISE EXCEPTION 'Nome, cidade ou telefone inválido.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET name = btrim(p_name), city = btrim(p_city), phone = btrim(p_phone)
  WHERE id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.update_own_profile_summary(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_own_profile_summary(text, text, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.push_subscriptions TO authenticated;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own
ON public.push_subscriptions FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_select_own_restrictive ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own_restrictive
ON public.push_subscriptions AS RESTRICTIVE FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own
ON public.push_subscriptions FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_delete_own_restrictive ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own_restrictive
ON public.push_subscriptions AS RESTRICTIVE FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';