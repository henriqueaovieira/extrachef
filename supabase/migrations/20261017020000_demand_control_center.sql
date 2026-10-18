BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.jobs ADD COLUMN demand_archived_at timestamptz;
GRANT SELECT(demand_archived_at) ON public.jobs TO authenticated;

CREATE TABLE public.demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL,
  kind text NOT NULL,
  worker_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_key text NOT NULL UNIQUE
);
CREATE INDEX demand_events_order_idx ON public.demand_events(demand_id, occurred_at, id);
ALTER TABLE public.demand_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demand_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.demand_events TO authenticated;
CREATE POLICY demand_events_owner ON public.demand_events FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.jobs j WHERE j.demand_id = demand_events.demand_id AND j.restaurant_id = auth.uid()));

CREATE TABLE public.talent_connections (
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN ('contact','known','favorite','partner')),
  PRIMARY KEY(restaurant_id, worker_id, category)
);
ALTER TABLE public.talent_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.talent_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.talent_connections TO authenticated;
CREATE POLICY talent_connections_owner ON public.talent_connections FOR SELECT TO authenticated USING(restaurant_id = auth.uid());

CREATE TABLE public.demand_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE(demand_id,worker_id)
);
ALTER TABLE public.demand_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demand_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.demand_invitations TO authenticated;
CREATE POLICY invitation_participants ON public.demand_invitations FOR SELECT TO authenticated
  USING(restaurant_id = auth.uid() OR worker_id = auth.uid());

CREATE FUNCTION public.record_demand_event(p_demand uuid,p_kind text,p_worker uuid,p_key text,p_time timestamptz DEFAULT now())
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $fn$
  INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at)
    VALUES(p_demand,p_kind,p_worker,p_key,p_time) ON CONFLICT(source_key) DO NOTHING;
$fn$;
REVOKE ALL ON FUNCTION public.record_demand_event(uuid,text,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_demand_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  row_data jsonb;
  old_data jsonb;
  demand uuid;
  worker uuid;
  kind text;
  key text;
  event_time timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := to_jsonb(OLD); ELSE row_data := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' THEN old_data := to_jsonb(OLD); END IF;
  worker := (row_data->>'worker_id')::uuid;
  IF TG_TABLE_NAME = 'jobs' THEN
    demand := (row_data->>'demand_id')::uuid;
    IF TG_OP = 'INSERT' OR old_data->>'demand_id' IS DISTINCT FROM row_data->>'demand_id' THEN
      IF TG_OP = 'UPDATE' THEN
        DELETE FROM public.demand_events WHERE source_key = 'created:' || (old_data->>'demand_id')
          AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE demand_id = (old_data->>'demand_id')::uuid);
      END IF;
      PERFORM public.record_demand_event(demand,'created',NULL,'created:'||demand,(row_data->>'created_at')::timestamptz);
    ELSIF old_data->>'status' IS DISTINCT FROM row_data->>'status' AND row_data->>'status' = 'cancelled' THEN
      PERFORM public.record_demand_event(demand,'cancelled',NULL,'cancelled:'||demand);
    ELSIF old_data->>'demand_revision' IS DISTINCT FROM row_data->>'demand_revision' THEN
      PERFORM public.record_demand_event(demand,'edited',NULL,'edited:'||demand||':'||(row_data->>'demand_revision'));
    ELSIF old_data->>'demand_archived_at' IS DISTINCT FROM row_data->>'demand_archived_at' THEN
      PERFORM public.record_demand_event(demand,
        CASE WHEN row_data->>'demand_archived_at' IS NULL THEN 'restored' ELSE 'archived' END,
        NULL,'archive:'||demand||':'||COALESCE(row_data->>'demand_archived_at','restored:'||now()::text));
    END IF;
    RETURN NULL;
  ELSIF TG_TABLE_NAME IN ('demand_reserves','demand_invitations') THEN
    demand := (row_data->>'demand_id')::uuid;
  ELSE
    SELECT demand_id INTO demand FROM public.jobs WHERE id = (row_data->>'job_id')::uuid;
  END IF;
  IF demand IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'applications' THEN
    IF TG_OP = 'INSERT' THEN kind := 'candidate_received';
    ELSIF old_data->>'status' IS DISTINCT FROM row_data->>'status' THEN
      kind := CASE row_data->>'status' WHEN 'approved' THEN 'hired' WHEN 'cancelled' THEN 'worker_cancelled' ELSE NULL END;
    END IF;
    key := kind||':'||(row_data->>'id');
    event_time := CASE WHEN TG_OP = 'INSERT' THEN (row_data->>'created_at')::timestamptz ELSE now() END;
  ELSIF TG_TABLE_NAME = 'demand_reserves' THEN
    kind := CASE WHEN TG_OP = 'DELETE' THEN 'reserve_removed' ELSE 'reserve_added' END;
    key := kind||':'||demand||':'||worker||':'||gen_random_uuid();
    event_time := now();
  ELSIF TG_TABLE_NAME = 'demand_invitations' THEN
    kind := CASE WHEN TG_OP = 'INSERT' THEN 'invitation_sent' WHEN old_data->>'status' IS DISTINCT FROM row_data->>'status' THEN 'invitation_'||(row_data->>'status') END;
    key := kind||':'||(row_data->>'id');
    event_time := now();
  ELSE
    kind := CASE TG_TABLE_NAME WHEN 'checkins' THEN 'checkin' WHEN 'checkouts' THEN 'checkout' WHEN 'reviews' THEN 'review' END;
    key := kind||':'||(row_data->>'id');
    event_time := COALESCE((row_data->>'checkin_time')::timestamptz,(row_data->>'checkout_time')::timestamptz,(row_data->>'created_at')::timestamptz,now());
  END IF;
  IF kind IS NOT NULL THEN PERFORM public.record_demand_event(demand,kind,worker,key,COALESCE(event_time,now())); END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_demand_activity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER jobs_demand_activity AFTER INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER applications_demand_activity AFTER INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER reserves_demand_activity AFTER INSERT OR DELETE ON public.demand_reserves FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER invitations_demand_activity AFTER INSERT OR UPDATE ON public.demand_invitations FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER checkins_demand_activity AFTER INSERT ON public.checkins FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER checkouts_demand_activity AFTER INSERT ON public.checkouts FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();
CREATE TRIGGER reviews_demand_activity AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.record_demand_activity();

INSERT INTO public.demand_events(demand_id,kind,source_key,occurred_at)
  SELECT demand_id,'created','created:'||demand_id,min(created_at) FROM public.jobs GROUP BY demand_id;
INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at)
  SELECT j.demand_id,'candidate_received',a.worker_id,'candidate_received:'||a.id,a.created_at
  FROM public.applications a JOIN public.jobs j ON j.id=a.job_id;
INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at)
  SELECT demand_id,'reserve_added',worker_id,'reserve-backfill:'||demand_id||':'||worker_id,created_at FROM public.demand_reserves;
INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at)
  SELECT j.demand_id,'checkin',c.worker_id,'checkin:'||c.id,c.checkin_time FROM public.checkins c JOIN public.jobs j ON j.id=c.job_id
  UNION ALL SELECT j.demand_id,'checkout',c.worker_id,'checkout:'||c.id,c.checkout_time FROM public.checkouts c JOIN public.jobs j ON j.id=c.job_id
  UNION ALL SELECT j.demand_id,'review',r.worker_id,'review:'||r.id,r.created_at FROM public.reviews r JOIN public.jobs j ON j.id=r.job_id;

CREATE FUNCTION public.archive_restaurant_demand(p_demand_id uuid,p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE='42501'; END IF;
  IF p_archived IS NULL THEN RAISE EXCEPTION 'Informe a ação de arquivamento.'; END IF;
  IF p_archived AND EXISTS(SELECT 1 FROM public.jobs WHERE demand_id=p_demand_id AND status::text NOT IN ('completed','cancelled')) THEN
    RAISE EXCEPTION 'Conclua ou cancele a operação antes de arquivar.';
  END IF;
  UPDATE public.jobs SET demand_archived_at=CASE WHEN p_archived THEN now() ELSE NULL END
    WHERE demand_id=p_demand_id AND restaurant_id=auth.uid()
    AND (demand_archived_at IS NOT NULL) IS DISTINCT FROM p_archived;
END;
$fn$;
REVOKE ALL ON FUNCTION public.archive_restaurant_demand(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_restaurant_demand(uuid,boolean) TO authenticated;

CREATE FUNCTION public.set_talent_connection(p_worker_id uuid,p_category text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL)
    OR p_category IS NULL OR p_category NOT IN ('contact','known','favorite','partner') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Profissional ou categoria indisponível.';
  END IF;
  IF p_enabled THEN INSERT INTO public.talent_connections VALUES(auth.uid(),p_worker_id,p_category) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.talent_connections WHERE restaurant_id=auth.uid() AND worker_id=p_worker_id AND category=p_category; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_talent_connection(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_talent_connection(uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.invite_demand_worker(p_demand_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE target public.jobs; invitation uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() AND status='open'
    AND demand_archived_at IS NULL AND job_date+end_time+CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0' END > now() AT TIME ZONE 'America/Sao_Paulo' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há posição aberta nesta demanda.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE j.demand_id=p_demand_id AND a.worker_id=p_worker_id AND a.status IN ('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional não está disponível para convite.';
  END IF;
  INSERT INTO public.demand_invitations(demand_id,restaurant_id,worker_id)
    VALUES(p_demand_id,auth.uid(),p_worker_id) ON CONFLICT DO NOTHING RETURNING id INTO invitation;
  IF invitation IS NULL THEN RAISE EXCEPTION 'Este profissional já recebeu um convite para esta demanda.'; END IF;
  INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(p_worker_id,'Convite para trabalhar',target.title||' · '||to_char(target.job_date,'DD/MM/YYYY'),'operational','/worker/invitations');
END;
$fn$;
REVOKE ALL ON FUNCTION public.invite_demand_worker(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_demand_worker(uuid,uuid) TO authenticated;

CREATE FUNCTION public.respond_demand_invitation(p_invitation_id uuid,p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE invitation public.demand_invitations; target uuid;
BEGIN
  SELECT * INTO invitation FROM public.demand_invitations WHERE id=p_invitation_id AND worker_id=auth.uid();
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Convite indisponível.' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.users WHERE id=invitation.restaurant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa indisponível.'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=invitation.demand_id ORDER BY id FOR UPDATE;
  SELECT * INTO invitation FROM public.demand_invitations WHERE id=p_invitation_id FOR UPDATE;
  IF invitation.status<>'pending' OR p_accept IS NULL THEN RAISE EXCEPTION 'Este convite já foi respondido.'; END IF;
  IF p_accept THEN
    SELECT id INTO target FROM public.jobs WHERE demand_id=invitation.demand_id AND status='open' AND demand_archived_at IS NULL
      AND job_date+end_time+CASE WHEN end_time<=start_time THEN interval '1 day' ELSE interval '0' END > now() AT TIME ZONE 'America/Sao_Paulo'
      ORDER BY id LIMIT 1;
    IF target IS NULL THEN RAISE EXCEPTION 'Esta demanda não possui mais posições abertas.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE j.demand_id=invitation.demand_id AND a.worker_id=auth.uid() AND a.status IN ('pending','approved','in_progress','completed')) THEN
      INSERT INTO public.applications(job_id,worker_id,status) VALUES(target,auth.uid(),'pending');
    END IF;
  END IF;
  UPDATE public.demand_invitations SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,responded_at=now() WHERE id=p_invitation_id;
  INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(invitation.restaurant_id,'Convite respondido',CASE WHEN p_accept THEN 'Um profissional aceitou seu convite. Analise a candidatura.' ELSE 'Um profissional recusou seu convite.' END,
      'operational','/restaurant/demands/'||invitation.demand_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.respond_demand_invitation(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_demand_invitation(uuid,boolean) TO authenticated;

CREATE FUNCTION public.demand_talent_directory(p_demand_id uuid,p_worker_id uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_participants_only boolean DEFAULT false)
RETURNS TABLE(id uuid,name text,specialties text[],score numeric,photo_path text,experience text,categories text[],completed_operations bigint,invitation_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='restaurant' AND u.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid()) THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Página inválida.'; END IF;
  RETURN QUERY SELECT u.id,u.name,
    CASE WHEN pref.show_experience THEN wp.specialties ELSE ARRAY[]::text[] END,
    CASE WHEN pref.show_score THEN u.score::numeric END,
    CASE WHEN pref.show_photos THEN wp.profile_photo_path END,
    CASE WHEN pref.show_experience THEN wp.experience END,
    ARRAY(SELECT c.category FROM public.talent_connections c WHERE c.restaurant_id=auth.uid() AND c.worker_id=u.id),
    (SELECT count(DISTINCT j.demand_id) FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
      WHERE a.worker_id=u.id AND j.restaurant_id=auth.uid() AND a.status='completed'),
    (SELECT i.status FROM public.demand_invitations i WHERE i.demand_id=p_demand_id AND i.worker_id=u.id)
    FROM public.users u LEFT JOIN public.worker_profiles wp ON wp.user_id=u.id
    LEFT JOIN public.privacy_preferences pref ON pref.user_id=u.id
    WHERE u.role='worker' AND u.deleted_at IS NULL AND (p_worker_id IS NULL OR u.id=p_worker_id)
    AND (NOT p_participants_only OR EXISTS(SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id WHERE j.demand_id=p_demand_id AND a.worker_id=u.id)
      OR EXISTS(SELECT 1 FROM public.demand_invitations i WHERE i.demand_id=p_demand_id AND i.worker_id=u.id)
      OR EXISTS(SELECT 1 FROM public.demand_events e WHERE e.demand_id=p_demand_id AND e.worker_id=u.id))
    ORDER BY u.name,u.id OFFSET p_offset LIMIT p_limit;
END;
$fn$;
REVOKE ALL ON FUNCTION public.demand_talent_directory(uuid,uuid,integer,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demand_talent_directory(uuid,uuid,integer,integer,boolean) TO authenticated;

CREATE FUNCTION public.worker_demand_invites()
RETURNS TABLE(id uuid,title text,job_date date,start_time time,end_time time,value numeric,location_name text,status text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT i.id,j.title,j.job_date,j.start_time,j.end_time,j.value,j.location_name,i.status,i.created_at
  FROM public.demand_invitations i
  CROSS JOIN LATERAL (SELECT * FROM public.jobs WHERE demand_id=i.demand_id ORDER BY id LIMIT 1) j
  WHERE i.worker_id=auth.uid() AND EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND deleted_at IS NULL)
  ORDER BY i.created_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.worker_demand_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_demand_invites() TO authenticated;

ALTER FUNCTION public.may_view_profile_media(text,text) RENAME TO may_view_profile_media_before_demands;
REVOKE ALL ON FUNCTION public.may_view_profile_media_before_demands(text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.may_view_profile_media(p_bucket text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT public.may_view_profile_media_before_demands(p_bucket,p_path) OR (
    p_bucket='worker-private' AND EXISTS(SELECT 1 FROM public.users r WHERE r.id=auth.uid() AND r.role='restaurant' AND r.deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.worker_profiles wp JOIN public.users u ON u.id=wp.user_id
      JOIN public.privacy_preferences p ON p.user_id=u.id AND p.show_photos
      WHERE wp.profile_photo_path=p_path AND u.deleted_at IS NULL));
$fn$;
REVOKE ALL ON FUNCTION public.may_view_profile_media(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.may_view_profile_media(text,text) TO authenticated;
DROP POLICY IF EXISTS profile_media_visibility ON storage.objects;
CREATE POLICY profile_media_visibility ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING(bucket_id NOT IN ('worker-private','restaurant-assets') OR (storage.foldername(name))[1]=auth.uid()::text OR public.may_view_profile_media(bucket_id,name));
DROP POLICY IF EXISTS profile_media_allowed ON storage.objects;
CREATE POLICY profile_media_allowed ON storage.objects FOR SELECT TO authenticated USING(public.may_view_profile_media(bucket_id,name));

ALTER FUNCTION public.export_own_account_data() RENAME TO export_account_before_control_center;
REVOKE ALL ON FUNCTION public.export_account_before_control_center() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.export_own_account_data() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  RETURN public.export_account_before_control_center() || jsonb_build_object(
    'demand_invitations',COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.demand_invitations i WHERE i.restaurant_id=auth.uid() OR i.worker_id=auth.uid()),'[]'::jsonb),
    'talent_connections',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.talent_connections c WHERE c.restaurant_id=auth.uid() OR c.worker_id=auth.uid()),'[]'::jsonb),
    'demand_events',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.demand_events e WHERE e.worker_id=auth.uid() OR EXISTS(SELECT 1 FROM public.jobs j WHERE j.demand_id=e.demand_id AND j.restaurant_id=auth.uid())),'[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.export_own_account_data() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_own_account_data() TO authenticated;
ALTER FUNCTION public.anonymize_account(uuid) RENAME TO anonymize_before_control_center;
REVOKE ALL ON FUNCTION public.anonymize_before_control_center(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.anonymize_account(p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.anonymize_before_control_center(p_user_id);
  DELETE FROM public.demand_invitations WHERE restaurant_id=p_user_id OR worker_id=p_user_id;
  DELETE FROM public.talent_connections WHERE restaurant_id=p_user_id OR worker_id=p_user_id;
  UPDATE public.demand_events SET worker_id=NULL WHERE worker_id=p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
