-- Recruitment closes five hours before start, except urgent publications.
-- Apply only after inspecting the installed operational schema. No data is deleted.
-- Replaces the failed preflight revision; preserves the installed code-issuance signature.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE dependency text; expected record;
BEGIN
  FOREACH dependency IN ARRAY ARRAY[
    'public.users','public.jobs','public.applications','public.operational_assignments',
    'public.operational_codes','public.checkins','public.checkouts','public.demand_invitations',
    'public.demand_reserves','public.demand_events','public.messages','public.notifications',
    'public.reviews','public.worker_profiles','public.restaurant_profiles',
    'public.privacy_preferences','public.talent_connections'
  ] LOOP
    IF to_regclass(dependency) IS NULL THEN
      RAISE EXCEPTION 'Recruitment preflight: missing table %.',dependency;
    END IF;
  END LOOP;
  FOREACH dependency IN ARRAY ARRAY[
    'public.operational_start(public.jobs)','public.operational_end(public.jobs)',
    'public.require_open_job_for_application()','public.worker_has_applied_for_job(uuid,uuid)',
    'public.record_demand_event(uuid,text,uuid,text,timestamptz)',
    'public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer)',
    'public.worker_demand_invites()','public.is_approved_chat_participant(uuid)',
    'public.demand_talent_directory_before_trust(uuid,uuid,integer,integer,boolean)'
  ] LOOP
    IF to_regprocedure(dependency) IS NULL THEN
      RAISE EXCEPTION 'Recruitment preflight: missing function %.',dependency;
    END IF;
  END LOOP;
  IF to_regprocedure('public.issue_operational_code(uuid,text)') IS NULL
    AND to_regprocedure('public.issue_operational_code(uuid,text,double precision,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Recruitment preflight: missing function public.issue_operational_code(uuid,text) or GPS signature.';
  END IF;
  IF to_regprocedure('public.issue_operational_code(uuid,text)') IS NOT NULL
    AND to_regprocedure('public.issue_operational_code(uuid,text,double precision,double precision)') IS NOT NULL THEN
    RAISE EXCEPTION 'Recruitment preflight: ambiguous issue_operational_code signatures; inspect installed overloads.';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('operational_assignments','operational_assignments_job_id_key','UNIQUE (job_id)'),
    ('checkins','checkins_one_per_job','UNIQUE (job_id)'),
    ('checkins','checkins_one_per_worker_job','UNIQUE (worker_id, job_id)'),
    ('checkouts','checkouts_one_per_job','UNIQUE (job_id)'),
    ('checkouts','checkouts_one_per_worker_job','UNIQUE (worker_id, job_id)'),
    ('demand_invitations','demand_invitations_demand_id_worker_id_key','UNIQUE (demand_id, worker_id)')
  ) AS required(table_name,constraint_name,definition) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid=to_regclass('public.'||expected.table_name)
        AND c.conname=expected.constraint_name AND pg_catalog.pg_get_constraintdef(c.oid)=expected.definition) THEN
      RAISE EXCEPTION 'Recruitment preflight: incompatible constraint %.%.',
        expected.table_name,expected.constraint_name;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.applications'::regclass
      AND tgname='applications_require_open_job' AND tgenabled='O'
      AND tgfoid='public.require_open_job_for_application()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.applications'::regclass
      AND tgname='applications_operational_hire' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Recruitment preflight: application validation/hire triggers are missing or disabled.';
  END IF;
END;
$preflight$;

ALTER TABLE public.operational_assignments
  ADD COLUMN replacement_requested_at timestamptz,
  ADD COLUMN replacement_closed_at timestamptz;
ALTER TABLE public.operational_assignments DROP CONSTRAINT operational_assignments_job_id_key;
CREATE UNIQUE INDEX operational_one_current_assignment ON public.operational_assignments(job_id)
  WHERE interruption IS NULL;
CREATE INDEX operational_job_history_idx ON public.operational_assignments(job_id,interrupted_at DESC);
CREATE INDEX operational_legacy_replacement_idx ON public.operational_assignments(replacement_job_id)
  WHERE replacement_job_id IS NOT NULL;
ALTER TABLE public.checkins DROP CONSTRAINT checkins_one_per_job;
ALTER TABLE public.checkouts DROP CONSTRAINT checkouts_one_per_job;

ALTER TABLE public.demand_invitations
  ADD COLUMN replacement_assignment_id uuid REFERENCES public.operational_assignments(id);
ALTER TABLE public.demand_invitations DROP CONSTRAINT demand_invitations_demand_id_worker_id_key;
CREATE UNIQUE INDEX demand_invitation_normal ON public.demand_invitations(demand_id,worker_id)
  WHERE replacement_assignment_id IS NULL;
CREATE UNIQUE INDEX demand_invitation_replacement ON public.demand_invitations(replacement_assignment_id,worker_id)
  WHERE replacement_assignment_id IS NOT NULL;

CREATE FUNCTION public.recruitment_closes_at(p_job public.jobs)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT CASE WHEN p_job.created_at >= public.operational_start(p_job)-interval '5 hours'
    THEN public.operational_start(p_job) ELSE public.operational_start(p_job)-interval '5 hours' END;
$fn$;

CREATE FUNCTION public.recruitment_blocked(p_job public.jobs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.operational_assignments a WHERE a.job_id=p_job.id OR a.replacement_job_id=p_job.id);
$fn$;

CREATE FUNCTION public.recruitment_available(p_job public.jobs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p_job.status::text='open' AND p_job.demand_archived_at IS NULL
    AND clock_timestamp()<public.recruitment_closes_at(p_job)
    AND NOT public.recruitment_blocked(p_job);
$fn$;

CREATE FUNCTION public.recruitment_hireable(p_job public.jobs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p_job.status::text='open' AND p_job.demand_archived_at IS NULL
    AND clock_timestamp()<public.operational_start(p_job)
    AND NOT public.recruitment_blocked(p_job);
$fn$;

REVOKE ALL ON FUNCTION public.recruitment_closes_at(public.jobs),
  public.recruitment_blocked(public.jobs),public.recruitment_available(public.jobs),public.recruitment_hireable(public.jobs) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recruitment_closes_at(public.jobs),
  public.recruitment_blocked(public.jobs),public.recruitment_available(public.jobs),public.recruitment_hireable(public.jobs) TO authenticated;

CREATE FUNCTION public.guard_recruitment_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN NEW.created_at := clock_timestamp(); END IF;
  IF TG_OP='UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A publicação original deve ser preservada.';
  END IF;
  IF TG_OP='INSERT' OR NEW.job_date IS DISTINCT FROM OLD.job_date OR NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    IF public.operational_start(NEW)<=clock_timestamp() THEN
      RAISE EXCEPTION 'Publique a operação antes do horário de início.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.status::text='open' AND (
    OLD.status::text<>'open' OR EXISTS(SELECT 1 FROM public.operational_assignments a WHERE a.job_id=NEW.id OR a.replacement_job_id=NEW.id)) THEN
    RAISE EXCEPTION 'O recrutamento desta operação não pode ser reaberto.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_recruitment_job() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER jobs_guard_recruitment BEFORE INSERT OR UPDATE OF status,job_date,start_time,created_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_recruitment_job();

CREATE OR REPLACE FUNCTION public.require_open_job_for_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs; permitted boolean;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  permitted := FOUND AND public.recruitment_available(j);
  IF NOT permitted THEN
    -- An invitation sent before the cutoff may still be accepted before start.
    permitted := public.recruitment_hireable(j) AND EXISTS(
      SELECT 1 FROM public.demand_invitations i WHERE i.demand_id=j.demand_id
        AND i.worker_id=NEW.worker_id AND i.replacement_assignment_id IS NULL
        AND i.status='accepted' AND i.created_at<public.recruitment_closes_at(j));
  END IF;
  IF NOT COALESCE(permitted,false) THEN
    RAISE EXCEPTION 'O recrutamento desta operação foi encerrado.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.worker_id AND role='worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Profissional indisponível.' USING ERRCODE='42501';
  END IF;
  IF NEW.status::text<>'pending' THEN
    RAISE EXCEPTION 'Uma nova candidatura deve aguardar aprovação.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP POLICY jobs_select_open_or_owned ON public.jobs;
DROP POLICY jobs_select_open_or_owned_restrictive ON public.jobs;
CREATE POLICY jobs_select_open_or_owned ON public.jobs FOR SELECT TO authenticated
USING(public.recruitment_available(jobs) OR restaurant_id=auth.uid()
  OR public.worker_has_applied_for_job(id,auth.uid())
  OR EXISTS(SELECT 1 FROM public.demand_invitations i WHERE i.demand_id=jobs.demand_id AND i.worker_id=auth.uid()));
CREATE POLICY jobs_select_open_or_owned_restrictive ON public.jobs AS RESTRICTIVE FOR SELECT TO authenticated
USING(public.recruitment_available(jobs) OR restaurant_id=auth.uid()
  OR public.worker_has_applied_for_job(id,auth.uid())
  OR EXISTS(SELECT 1 FROM public.demand_invitations i WHERE i.demand_id=jobs.demand_id AND i.worker_id=auth.uid()));

DROP POLICY applications_insert_worker_open_job ON public.applications;
DROP POLICY applications_insert_worker_open_job_restrictive ON public.applications;
CREATE POLICY applications_insert_worker_open_job ON public.applications FOR INSERT TO authenticated
WITH CHECK(worker_id=auth.uid() AND status='pending'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='worker')
  AND EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=applications.job_id AND public.recruitment_available(j)));
CREATE POLICY applications_insert_worker_open_job_restrictive ON public.applications AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(worker_id=auth.uid() AND status='pending'
  AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role='worker')
  AND EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=applications.job_id AND public.recruitment_available(j)));

CREATE OR REPLACE FUNCTION public.interrupt_operational_assignment(p_job_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs;
BEGIN
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=p_job_id AND interruption IS NULL FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN(a.worker_id,a.restaurant_id)
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Operação indisponível para esta conta.' USING ERRCODE='42501';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN('cancelled','absent','abandoned')
    OR a.checkout_at IS NOT NULL OR a.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Interrupção indisponível nesta etapa.'; END IF;
  IF p_reason='cancelled' THEN
    IF a.checkin_at IS NOT NULL THEN RAISE EXCEPTION 'Cancelamento disponível antes do check-in.'; END IF;
  ELSIF auth.uid()<>a.restaurant_id THEN
    RAISE EXCEPTION 'Somente a empresa confirma esta ocorrência.' USING ERRCODE='42501';
  ELSIF p_reason='absent' AND (a.checkin_at IS NOT NULL OR clock_timestamp()<=public.operational_start(j)+interval '5 minutes') THEN
    RAISE EXCEPTION 'Aguarde a tolerância de cinco minutos e confira a chegada.';
  ELSIF p_reason='abandoned' AND (a.checkin_at IS NULL OR clock_timestamp()>=public.operational_end(j)) THEN
    RAISE EXCEPTION 'Abandono disponível apenas durante o trabalho.';
  END IF;
  UPDATE public.operational_assignments SET interruption=p_reason,interrupted_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.applications SET status='rejected' WHERE id=a.application_id;
  -- Keep the job non-public until the restaurant explicitly decides what to do.
  PERFORM public.record_demand_event(j.demand_id,CASE WHEN p_reason='cancelled' THEN 'worker_cancelled' ELSE p_reason END,
    a.worker_id,'interruption:'||a.id);
  INSERT INTO public.notifications(user_id,title,message,category,url)
  VALUES(a.restaurant_id,'Decisão necessária','Encerre a operação ou busque substituto entre os candidatos já vinculados.',
    'operational','/restaurant/demands/'||j.demand_id),
    (a.worker_id,'Ocorrência registrada','Sua ocorrência foi preservada no histórico.','operational','/checkin/'||j.id);
  RETURN j.id;
END;
$fn$;

-- Extend the existing management RPC, preserving its edit/duplicate/cancel implementation.
ALTER FUNCTION public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer)
  RENAME TO manage_restaurant_demand_before_recruitment;
REVOKE ALL ON FUNCTION public.manage_restaurant_demand_before_recruitment(uuid,text,text,text,date,time,time,numeric,integer)
  FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.manage_restaurant_demand(
  p_demand_id uuid,p_action text,p_title text DEFAULT NULL,p_description text DEFAULT NULL,
  p_job_date date DEFAULT NULL,p_start_time time DEFAULT NULL,p_end_time time DEFAULT NULL,
  p_value numeric DEFAULT NULL,p_expected_revision integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs; a public.operational_assignments;
BEGIN
  IF p_action NOT IN('close_interrupted','seek_replacement') OR p_action IS NULL THEN
    RETURN public.manage_restaurant_demand_before_recruitment(p_demand_id,p_action,p_title,p_description,
      p_job_date,p_start_time,p_end_time,p_value,p_expected_revision);
  END IF;
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  SELECT o.* INTO a FROM public.operational_assignments o JOIN public.jobs job ON job.id=o.job_id
    WHERE job.demand_id=p_demand_id AND job.restaurant_id=auth.uid() AND o.interruption IS NOT NULL
      AND o.replacement_closed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.operational_assignments current_assignment
        WHERE current_assignment.job_id=o.job_id AND current_assignment.interruption IS NULL)
    ORDER BY o.interrupted_at DESC,o.id LIMIT 1 FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Não há ocorrência aguardando decisão.'; END IF;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=a.job_id;
  IF p_action='seek_replacement' THEN
    IF j.demand_archived_at IS NOT NULL OR j.status::text='cancelled'
      OR clock_timestamp()>=public.operational_end(j) THEN
      RAISE EXCEPTION 'O horário de substituição foi encerrado.';
    END IF;
    UPDATE public.operational_assignments SET replacement_requested_at=COALESCE(replacement_requested_at,clock_timestamp()) WHERE id=a.id;
  ELSE
    UPDATE public.operational_assignments SET replacement_closed_at=clock_timestamp() WHERE id=a.id;
    UPDATE public.jobs SET status='cancelled' WHERE id=j.id;
  END IF;
  PERFORM public.record_demand_event(j.demand_id,p_action,NULL,p_action||':'||a.id);
  RETURN p_demand_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.invite_demand_worker(p_demand_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs; a public.operational_assignments; invitation uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Este profissional não está disponível para convite.';
  END IF;
  SELECT * INTO j FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid()
    AND public.recruitment_available(jobs) ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    SELECT o.* INTO a FROM public.operational_assignments o JOIN public.jobs job ON job.id=o.job_id
      WHERE job.demand_id=p_demand_id AND job.restaurant_id=auth.uid()
        AND job.demand_archived_at IS NULL AND job.status::text<>'cancelled'
        AND o.interruption IS NOT NULL AND o.replacement_requested_at IS NOT NULL AND o.replacement_closed_at IS NULL
        AND clock_timestamp()<public.operational_end(job)
        AND NOT EXISTS(SELECT 1 FROM public.operational_assignments current_assignment
          WHERE current_assignment.job_id=o.job_id AND current_assignment.interruption IS NULL)
      ORDER BY o.interrupted_at DESC,o.id LIMIT 1;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.applications candidate
      WHERE candidate.job_id=a.job_id AND candidate.worker_id=p_worker_id AND candidate.status='pending'
        AND candidate.created_at<a.interrupted_at)
      OR EXISTS(SELECT 1 FROM public.operational_assignments previous
        WHERE previous.job_id=a.job_id AND previous.worker_id=p_worker_id) THEN
      RAISE EXCEPTION 'Substituição disponível apenas para candidatos vinculados antes da ocorrência.';
    END IF;
    SELECT * INTO STRICT j FROM public.jobs WHERE id=a.job_id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.applications application JOIN public.jobs job ON job.id=application.job_id
    WHERE job.demand_id=p_demand_id AND application.worker_id=p_worker_id AND application.status IN('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional já foi contratado.';
  END IF;
  INSERT INTO public.demand_invitations(demand_id,restaurant_id,worker_id,replacement_assignment_id)
    VALUES(p_demand_id,auth.uid(),p_worker_id,a.id) ON CONFLICT DO NOTHING RETURNING id INTO invitation;
  IF invitation IS NULL THEN RAISE EXCEPTION 'Este profissional já recebeu este convite.'; END IF;
  PERFORM public.record_demand_event(p_demand_id,CASE WHEN a.id IS NULL THEN 'invitation_sent' ELSE 'replacement_invited' END,
    p_worker_id,'invitation_sent:'||invitation);
  IF a.id IS NOT NULL THEN
    UPDATE public.demand_events SET kind='replacement_invited' WHERE source_key='invitation_sent:'||invitation;
  END IF;
  INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(p_worker_id,CASE WHEN a.id IS NULL THEN 'Convite para trabalhar' ELSE 'Convite de substituição' END,
      j.title||' · '||to_char(j.job_date,'DD/MM/YYYY'),'operational','/worker/invitations#invitation-'||invitation);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.respond_demand_invitation(p_invitation_id uuid,p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE i public.demand_invitations; j public.jobs; a public.operational_assignments;
BEGIN
  SELECT * INTO i FROM public.demand_invitations WHERE id=p_invitation_id AND worker_id=auth.uid();
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND role='worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Convite indisponível.' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.users WHERE id=i.restaurant_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa indisponível.'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=i.demand_id ORDER BY id FOR UPDATE;
  SELECT * INTO i FROM public.demand_invitations WHERE id=p_invitation_id FOR UPDATE;
  IF i.status<>'pending' OR p_accept IS NULL THEN RAISE EXCEPTION 'Este convite já foi respondido.'; END IF;
  IF p_accept THEN
    IF i.replacement_assignment_id IS NULL THEN
      SELECT * INTO j FROM public.jobs WHERE demand_id=i.demand_id AND public.recruitment_hireable(jobs)
        AND i.created_at<public.recruitment_closes_at(jobs) ORDER BY id LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'Esta operação não aceita mais participações.'; END IF;
      UPDATE public.demand_invitations SET status='accepted',responded_at=clock_timestamp() WHERE id=i.id;
      IF NOT EXISTS(SELECT 1 FROM public.applications candidate JOIN public.jobs job ON job.id=candidate.job_id
        WHERE job.demand_id=i.demand_id AND candidate.worker_id=auth.uid()
          AND candidate.status IN('pending','approved','in_progress','completed')) THEN
        INSERT INTO public.applications(job_id,worker_id,status) VALUES(j.id,auth.uid(),'pending');
      END IF;
    ELSE
      SELECT * INTO a FROM public.operational_assignments WHERE id=i.replacement_assignment_id FOR UPDATE;
      SELECT * INTO j FROM public.jobs WHERE id=a.job_id;
      IF a.interruption IS NULL OR a.replacement_requested_at IS NULL OR a.replacement_closed_at IS NOT NULL
        OR j.status::text='cancelled' OR j.demand_archived_at IS NOT NULL OR clock_timestamp()>=public.operational_end(j)
        OR EXISTS(SELECT 1 FROM public.operational_assignments current_assignment WHERE job_id=j.id AND interruption IS NULL)
        OR NOT EXISTS(SELECT 1 FROM public.applications candidate WHERE job_id=j.id AND worker_id=auth.uid()
          AND status='pending' AND created_at<a.interrupted_at) THEN
        RAISE EXCEPTION 'Esta substituição não está mais disponível.';
      END IF;
    END IF;
  END IF;
  UPDATE public.demand_invitations SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
    responded_at=clock_timestamp() WHERE id=i.id;
  PERFORM public.record_demand_event(i.demand_id,CASE WHEN i.replacement_assignment_id IS NOT NULL AND p_accept
    THEN 'replacement_accepted' WHEN p_accept THEN 'invitation_accepted' ELSE 'invitation_declined' END,
    i.worker_id,'invitation_'||CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END||':'||i.id);
  IF i.replacement_assignment_id IS NOT NULL AND p_accept THEN
    UPDATE public.demand_events SET kind='replacement_accepted' WHERE source_key='invitation_accepted:'||i.id;
  END IF;
  INSERT INTO public.notifications(user_id,title,message,category,url)
    VALUES(i.restaurant_id,'Convite respondido',CASE WHEN p_accept THEN 'Candidato disponível. Confirme a contratação.'
      ELSE 'O profissional recusou o convite.' END,'operational','/restaurant/demands/'||i.demand_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_application(p_job_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs; a public.operational_assignments;
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id=p_job_id AND restaurant_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operação indisponível.' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.applications hired JOIN public.jobs job ON job.id=hired.job_id
    WHERE job.demand_id=j.demand_id AND hired.worker_id=p_worker_id AND hired.status IN('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional já foi contratado nesta demanda.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_worker_id AND role='worker' AND deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.applications WHERE job_id=j.id AND worker_id=p_worker_id AND status='pending') THEN
    RAISE EXCEPTION 'Candidato indisponível.';
  END IF;
  IF NOT public.recruitment_hireable(j) THEN
    SELECT * INTO a FROM public.operational_assignments WHERE job_id=j.id AND interruption IS NOT NULL
      AND replacement_requested_at IS NOT NULL AND replacement_closed_at IS NULL
      ORDER BY interrupted_at DESC,id LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR clock_timestamp()>=public.operational_end(j) OR j.demand_archived_at IS NOT NULL
      OR j.status::text='cancelled'
      OR EXISTS(SELECT 1 FROM public.operational_assignments WHERE job_id=j.id AND interruption IS NULL)
      OR EXISTS(SELECT 1 FROM public.operational_assignments WHERE job_id=j.id AND worker_id=p_worker_id)
      OR NOT EXISTS(SELECT 1 FROM public.applications WHERE job_id=j.id AND worker_id=p_worker_id
        AND status='pending' AND created_at<a.interrupted_at)
      OR NOT EXISTS(SELECT 1 FROM public.demand_invitations WHERE replacement_assignment_id=a.id
        AND worker_id=p_worker_id AND status='accepted') THEN
      RAISE EXCEPTION 'Confirme uma reserva aceita, vinculada antes da ocorrência, antes do encerramento.';
    END IF;
    UPDATE public.operational_assignments SET replacement_closed_at=clock_timestamp() WHERE id=a.id;
  END IF;
  UPDATE public.applications SET status='approved' WHERE job_id=j.id AND worker_id=p_worker_id AND status='pending';
  UPDATE public.jobs SET status='filled' WHERE id=j.id;
  DELETE FROM public.demand_reserves WHERE demand_id=j.demand_id AND worker_id=p_worker_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_demand_candidate(p_demand_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE target uuid; source_application uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND role='restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id=p_demand_id AND restaurant_id=auth.uid() ORDER BY id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE='42501'; END IF;
  SELECT candidate.job_id INTO target FROM public.applications candidate JOIN public.jobs j ON j.id=candidate.job_id
    WHERE j.demand_id=p_demand_id AND candidate.worker_id=p_worker_id AND candidate.status='pending'
      AND (public.recruitment_hireable(j) OR EXISTS(SELECT 1 FROM public.demand_invitations i
        JOIN public.operational_assignments a ON a.id=i.replacement_assignment_id
        WHERE a.job_id=j.id AND i.worker_id=p_worker_id AND i.status='accepted'
          AND a.replacement_requested_at IS NOT NULL AND a.replacement_closed_at IS NULL))
    ORDER BY j.id LIMIT 1;
  IF target IS NULL THEN
    SELECT id INTO target FROM public.jobs WHERE demand_id=p_demand_id AND public.recruitment_hireable(jobs) ORDER BY id LIMIT 1;
    SELECT candidate.id INTO source_application FROM public.applications candidate JOIN public.jobs job ON job.id=candidate.job_id
      WHERE job.demand_id=p_demand_id AND job.status::text<>'cancelled' AND candidate.worker_id=p_worker_id AND candidate.status='pending'
      ORDER BY candidate.id LIMIT 1;
    IF target IS NULL OR source_application IS NULL THEN RAISE EXCEPTION 'Não há contratação disponível para esta candidatura.'; END IF;
    UPDATE public.applications SET job_id=target WHERE id=source_application;
  END IF;
  PERFORM public.approve_application(target,p_worker_id);
END;
$fn$;

-- Resolve a participant's own historical assignment, or the restaurant's latest one.
CREATE FUNCTION public.participant_assignment(p_job_id uuid)
RETURNS public.operational_assignments LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT a FROM public.operational_assignments a
    WHERE a.job_id=p_job_id AND auth.uid() IN(a.worker_id,a.restaurant_id)
    ORDER BY (a.interruption IS NULL) DESC,a.hired_at DESC NULLS LAST,a.id DESC LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.participant_assignment(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.operational_context(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes; phase text; issuer boolean;
BEGIN
  a := public.participant_assignment(p_job_id);
  IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Operação indisponível para esta conta.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id;
  phase := CASE WHEN a.interruption IS NOT NULL THEN a.interruption
    WHEN a.checkout_at IS NOT NULL THEN 'completed'
    WHEN a.checkin_at IS NULL THEN
      CASE WHEN now()>public.operational_start(j)+interval '5 minutes' THEN 'absence_pending'
        WHEN (now() AT TIME ZONE 'America/Sao_Paulo')::date < j.job_date THEN 'confirmed'
        ELSE 'checkin' END
    WHEN now()<public.operational_end(j) THEN 'working'
    WHEN a.receipt_confirmed_at IS NOT NULL THEN 'checkout'
    WHEN a.payment_disputed_at IS NOT NULL THEN 'payment_disputed'
    WHEN a.paid_at IS NOT NULL THEN 'receipt' ELSE 'payment' END;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id
    AND stage=CASE WHEN a.checkin_at IS NULL THEN 'checkin' ELSE 'checkout' END;
  issuer := a.interruption IS NULL AND CASE WHEN a.checkin_at IS NULL THEN auth.uid()=a.worker_id ELSE auth.uid()=a.restaurant_id END;
  RETURN jsonb_build_object('assignment_id',a.id,'worker_id',a.worker_id,'job_id',j.id,'demand_id',j.demand_id,'title',j.title,
    'location',COALESCE(j.location_name,j.work_address,'Local a definir'),
    'starts_at',public.operational_start(j),'ends_at',public.operational_end(j),
    'role',CASE WHEN auth.uid()=a.worker_id THEN 'worker' ELSE 'restaurant' END,
    'worker_name',(SELECT name FROM public.users WHERE id=a.worker_id),
    'phase',phase,'amount',a.amount,'checkin_at',a.checkin_at,'paid_at',a.paid_at,
    'payment_disputed_at',a.payment_disputed_at,
    'receipt_confirmed_at',a.receipt_confirmed_at,'checkout_at',a.checkout_at,
    'code',CASE WHEN issuer AND token.expires_at>now() AND token.consumed_at IS NULL THEN token.code END,
    'code_expires_at',CASE WHEN issuer AND token.consumed_at IS NULL THEN token.expires_at END,
    'has_code',COALESCE(token.expires_at>now() AND token.consumed_at IS NULL,false),
    'review_pending',a.checkout_at IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.reviews r WHERE r.job_id=j.id AND r.reviewer_id=auth.uid()));
END;
$fn$;

-- Adapt only the installed signature: recruitment must not install or remove GPS.
DO $issuance$
DECLARE
  arguments text := 'p_job_id uuid,p_stage text';
  signature text := 'public.issue_operational_code(uuid,text)';
  gps_validation text := '';
BEGIN
  IF to_regprocedure('public.issue_operational_code(uuid,text,double precision,double precision)') IS NOT NULL THEN
    arguments := arguments || ',p_latitude double precision DEFAULT NULL,p_longitude double precision DEFAULT NULL';
    signature := 'public.issue_operational_code(uuid,text,double precision,double precision)';
    gps_validation := $gps$
    IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'Não foi possível obter uma localização válida. Permita o acesso ao GPS e tente novamente.' USING ERRCODE='22023';
    END IF;
    IF j.work_latitude IS NULL OR j.work_longitude IS NULL OR j.work_latitude NOT BETWEEN -90 AND 90 OR j.work_longitude NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'O local da operação não possui coordenadas válidas. Contate o restaurante.' USING ERRCODE='22023';
    END IF;
    distance_meters := 6371000*2*asin(sqrt(LEAST(1.0,GREATEST(0.0,
      power(sin(radians(p_latitude-j.work_latitude)/2),2)+cos(radians(j.work_latitude))*cos(radians(p_latitude))
      *power(sin(radians(p_longitude-j.work_longitude)/2),2)))));
    IF distance_meters>100 THEN
      RAISE EXCEPTION 'Você está fora do raio de 100 metros do local da operação. Aproxime-se e tente novamente.' USING ERRCODE='22023';
    END IF;
    $gps$;
  END IF;
  EXECUTE format($definition$
CREATE OR REPLACE FUNCTION public.issue_operational_code(%s)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes; distance_meters double precision;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments
    WHERE id=(public.participant_assignment(p_job_id)).id FOR UPDATE;
  IF p_stage IS NULL OR p_stage NOT IN('checkin','checkout') OR a.interruption IS NOT NULL THEN
    RAISE EXCEPTION 'Etapa indisponível.';
  END IF;
  IF p_stage='checkin' THEN
    IF auth.uid()<>a.worker_id OR a.checkin_at IS NOT NULL
      OR (now() AT TIME ZONE 'America/Sao_Paulo')::date<j.job_date THEN
      RAISE EXCEPTION 'O profissional pode gerar o código ao chegar no dia da demanda.' USING ERRCODE='42501';
    END IF;
    %s
  ELSIF auth.uid()<>a.restaurant_id OR a.receipt_confirmed_at IS NULL OR a.checkout_at IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout disponível após o profissional confirmar recebimento.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id AND stage=p_stage;
  IF token.blocked_until>now() THEN RAISE EXCEPTION 'Muitas tentativas. Aguarde dez minutos.'; END IF;
  IF token.expires_at IS NULL OR token.expires_at<=now() THEN
    INSERT INTO public.operational_codes(assignment_id,stage,code,expires_at,attempts)
      VALUES(a.id,p_stage,upper(left(replace(gen_random_uuid()::text,'-',''),8)),now()+interval '10 minutes',0)
      ON CONFLICT(assignment_id,stage) DO UPDATE SET code=EXCLUDED.code,expires_at=EXCLUDED.expires_at,
        attempts=0,blocked_until=NULL,consumed_at=NULL;
    INSERT INTO public.notifications(user_id,title,message,category,url)
      VALUES(CASE WHEN p_stage='checkin' THEN a.restaurant_id ELSE a.worker_id END,
        CASE WHEN p_stage='checkin' THEN 'Profissional chegou' ELSE 'Checkout liberado' END,
        'Confira o código com a outra parte.','operational','/'||p_stage||'/'||p_job_id);
  END IF;
  RETURN public.operational_context(p_job_id);
END;
$fn$;
$definition$,arguments,gps_validation);
  EXECUTE 'REVOKE ALL ON FUNCTION ' || signature || ' FROM PUBLIC,anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION ' || signature || ' TO authenticated';
END;
$issuance$;

CREATE OR REPLACE FUNCTION public.validate_operational_code(p_job_id uuid,p_stage text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments WHERE id=(public.participant_assignment(p_job_id)).id FOR UPDATE;
  IF p_stage IS NULL OR p_stage NOT IN('checkin','checkout') OR a.interruption IS NOT NULL THEN RAISE EXCEPTION 'Etapa indisponível.'; END IF;
  IF p_stage='checkin' THEN
    IF auth.uid()<>a.restaurant_id OR a.checkin_at IS NOT NULL THEN
      RAISE EXCEPTION 'Somente a empresa confirma a chegada.' USING ERRCODE='42501';
    END IF;
  ELSIF auth.uid()<>a.worker_id OR a.receipt_confirmed_at IS NULL OR a.checkout_at IS NOT NULL THEN
    RAISE EXCEPTION 'Confirme o recebimento antes de validar o checkout.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id=a.id AND stage=p_stage FOR UPDATE;
  IF token.blocked_until>now() THEN RETURN jsonb_build_object('error','Muitas tentativas. Aguarde dez minutos.'); END IF;
  IF token.code IS NULL OR token.expires_at<=now() OR token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','Código expirado ou indisponível. Solicite um novo código.');
  END IF;
  IF upper(btrim(COALESCE(p_code,'')))<>token.code THEN
    UPDATE public.operational_codes SET attempts=attempts+1,
      blocked_until=CASE WHEN attempts+1>=5 THEN now()+interval '10 minutes' END WHERE assignment_id=a.id AND stage=p_stage;
    RETURN jsonb_build_object('error','Código incorreto. Confira o código com a outra pessoa.');
  END IF;
  IF p_stage='checkin' THEN
    INSERT INTO public.checkins(job_id,worker_id,checkin_time) VALUES(j.id,a.worker_id,now());
    UPDATE public.operational_assignments SET checkin_at=now() WHERE id=a.id;
    UPDATE public.applications SET status='in_progress' WHERE id=a.application_id;
    PERFORM public.record_demand_event(j.demand_id,
      CASE WHEN now()<public.operational_start(j) THEN 'early'
        WHEN now()<=public.operational_start(j)+interval '5 minutes' THEN 'on_time' ELSE 'late' END,a.worker_id,'arrival:'||a.id);
  ELSE
    INSERT INTO public.checkouts(job_id,worker_id,checkout_time) VALUES(j.id,a.worker_id,now());
    UPDATE public.operational_assignments SET checkout_at=now() WHERE id=a.id;
    UPDATE public.applications SET status='completed' WHERE id=a.application_id;
    UPDATE public.jobs SET status='completed' WHERE id=j.id;
    INSERT INTO public.notifications(user_id,title,message,category,url)
      SELECT recipient,'Avaliação pendente','Trabalho concluído com sucesso. Avalie antes da sua próxima operação.',
        'review','/reviews/'||j.id FROM unnest(ARRAY[a.restaurant_id,a.worker_id]) recipient;
  END IF;
  UPDATE public.operational_codes SET consumed_at=now() WHERE assignment_id=a.id AND stage=p_stage;
  RETURN public.operational_context(p_job_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_operational_payment(p_job_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO STRICT j FROM public.jobs WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments WHERE id=(public.participant_assignment(p_job_id)).id FOR UPDATE;
  IF a.interruption IS NOT NULL OR a.checkin_at IS NULL OR a.checkout_at IS NOT NULL
    OR now()<public.operational_end(j) OR a.receipt_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pagamento indisponível nesta etapa.';
  END IF;
  IF p_action='paid' AND auth.uid()=a.restaurant_id THEN
    IF a.paid_at IS NOT NULL AND a.payment_disputed_at IS NULL THEN RAISE EXCEPTION 'Pagamento já registrado.'; END IF;
    UPDATE public.operational_assignments SET paid_at=now(),payment_disputed_at=NULL WHERE id=a.id;
    PERFORM public.record_demand_event(j.demand_id,'payment_reported',a.worker_id,'paid:'||a.id||':'||now());
    INSERT INTO public.notifications(user_id,title,message,category,url)
      VALUES(a.worker_id,'Você recebeu o pagamento?','A empresa informou o pagamento. Confira antes de confirmar.','operational','/payment/'||j.id);
  ELSIF p_action IN('received','not_received') AND auth.uid()=a.worker_id AND a.paid_at IS NOT NULL THEN
    IF p_action='received' THEN
      UPDATE public.operational_assignments SET receipt_confirmed_at=now(),payment_disputed_at=NULL WHERE id=a.id;
      INSERT INTO public.operational_codes(assignment_id,stage,code,expires_at)
        VALUES(a.id,'checkout',upper(left(replace(gen_random_uuid()::text,'-',''),8)),now()+interval '10 minutes');
      PERFORM public.record_demand_event(j.demand_id,'payment_confirmed',a.worker_id,'receipt:'||a.id);
      INSERT INTO public.notifications(user_id,title,message,category,url)
        VALUES(a.restaurant_id,'Pagamento confirmado','O profissional confirmou recebimento. Gere o código de checkout.','operational','/checkout/'||j.id);
    ELSE
      IF a.payment_disputed_at IS NOT NULL THEN RAISE EXCEPTION 'A empresa já foi avisada do não recebimento.'; END IF;
      UPDATE public.operational_assignments SET payment_disputed_at=now() WHERE id=a.id;
      PERFORM public.record_demand_event(j.demand_id,'payment_disputed',a.worker_id,'dispute:'||a.id||':'||now());
      INSERT INTO public.notifications(user_id,title,message,category,url)
        VALUES(a.restaurant_id,'Pagamento não recebido','Confira o pagamento com o profissional.','operational','/payment/'||j.id);
    END IF;
  ELSE RAISE EXCEPTION 'Ação de pagamento não autorizada.' USING ERRCODE='42501';
  END IF;
  RETURN public.operational_context(p_job_id);
END;
$fn$;

DROP FUNCTION public.worker_demand_invites();
CREATE FUNCTION public.worker_demand_invites()
RETURNS TABLE(id uuid,title text,job_date date,start_time time,end_time time,value numeric,
  location_name text,status text,created_at timestamptz,can_accept boolean,is_replacement boolean,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT i.id,j.title,j.job_date,j.start_time,j.end_time,j.value,j.location_name,i.status,i.created_at,
    i.status='pending' AND CASE WHEN i.replacement_assignment_id IS NULL
      THEN public.recruitment_hireable(j) AND i.created_at<public.recruitment_closes_at(j)
      ELSE a.interruption IS NOT NULL AND a.replacement_requested_at IS NOT NULL AND a.replacement_closed_at IS NULL
        AND j.status::text<>'cancelled' AND j.demand_archived_at IS NULL AND clock_timestamp()<public.operational_end(j)
        AND NOT EXISTS(SELECT 1 FROM public.operational_assignments current_assignment WHERE job_id=j.id AND interruption IS NULL)
        AND EXISTS(SELECT 1 FROM public.applications candidate WHERE job_id=j.id AND worker_id=auth.uid()
          AND status='pending' AND candidate.created_at<a.interrupted_at) END,
    i.replacement_assignment_id IS NOT NULL,
    CASE WHEN i.replacement_assignment_id IS NULL THEN public.operational_start(j) ELSE public.operational_end(j) END
  FROM public.demand_invitations i
  LEFT JOIN public.operational_assignments a ON a.id=i.replacement_assignment_id
  CROSS JOIN LATERAL(SELECT * FROM public.jobs job WHERE job.demand_id=i.demand_id
    AND (a.job_id IS NULL OR job.id=a.job_id) ORDER BY public.recruitment_hireable(job) DESC,job.id LIMIT 1) j
  WHERE i.worker_id=auth.uid() AND EXISTS(SELECT 1 FROM public.users WHERE id=auth.uid() AND deleted_at IS NULL)
  ORDER BY i.created_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.worker_demand_invites() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worker_demand_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.demand_talent_directory_before_trust(p_demand_id uuid,p_worker_id uuid DEFAULT NULL,
  p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_participants_only boolean DEFAULT false)
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
    (SELECT count(DISTINCT j.demand_id) FROM public.applications application JOIN public.jobs j ON j.id=application.job_id
      WHERE application.worker_id=u.id AND j.restaurant_id=auth.uid() AND application.status='completed'),
    (SELECT i.status FROM public.demand_invitations i WHERE i.demand_id=p_demand_id AND i.worker_id=u.id
      ORDER BY i.created_at DESC,i.id DESC LIMIT 1)
    FROM public.users u LEFT JOIN public.worker_profiles wp ON wp.user_id=u.id
    LEFT JOIN public.privacy_preferences pref ON pref.user_id=u.id
    WHERE u.role='worker' AND u.deleted_at IS NULL AND (p_worker_id IS NULL OR u.id=p_worker_id)
    AND (NOT p_participants_only OR EXISTS(SELECT 1 FROM public.applications application JOIN public.jobs j ON j.id=application.job_id WHERE j.demand_id=p_demand_id AND application.worker_id=u.id)
      OR EXISTS(SELECT 1 FROM public.demand_invitations i WHERE i.demand_id=p_demand_id AND i.worker_id=u.id)
      OR EXISTS(SELECT 1 FROM public.demand_events e WHERE e.demand_id=p_demand_id AND e.worker_id=u.id))
    ORDER BY u.name,u.id OFFSET p_offset LIMIT p_limit;
END;
$fn$;
REVOKE ALL ON FUNCTION public.demand_talent_directory_before_trust(uuid,uuid,integer,integer,boolean) FROM PUBLIC,anon,authenticated;

-- Messages belong to a hiring relationship, not just to the reusable job.
ALTER TABLE public.messages ADD COLUMN assignment_id uuid REFERENCES public.operational_assignments(id);
UPDATE public.messages m SET assignment_id=a.id FROM public.operational_assignments a WHERE a.job_id=m.job_id;
CREATE INDEX messages_assignment_idx ON public.messages(assignment_id,created_at);
GRANT SELECT(assignment_id) ON public.messages TO authenticated;
CREATE FUNCTION public.bind_message_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments;
BEGIN
  PERFORM 1 FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments WHERE job_id=NEW.job_id AND interruption IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN(a.worker_id,a.restaurant_id) OR NEW.sender_id<>auth.uid() THEN
    RAISE EXCEPTION 'Conversa não autorizada.' USING ERRCODE='42501';
  END IF;
  NEW.assignment_id := a.id;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.bind_message_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER messages_bind_assignment BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.bind_message_assignment();
CREATE POLICY messages_current_relationship ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING(EXISTS(SELECT 1 FROM public.operational_assignments a WHERE a.id=messages.assignment_id
  AND a.interruption IS NULL AND auth.uid() IN(a.worker_id,a.restaurant_id)));

CREATE OR REPLACE FUNCTION public.mark_chat_messages_read(p_job_id uuid,p_message_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_chat_participant(p_job_id) THEN
    RAISE EXCEPTION 'Conversa não autorizada.' USING ERRCODE='42501';
  END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 1000 mensagens por operação.' USING ERRCODE='22023';
  END IF;
  a := public.participant_assignment(p_job_id);
  IF a.interruption IS NOT NULL THEN RAISE EXCEPTION 'Conversa encerrada.'; END IF;
  UPDATE public.messages SET read_at=now() WHERE job_id=p_job_id AND assignment_id=a.id
    AND id=ANY(p_message_ids) AND sender_id<>auth.uid() AND read_at IS NULL;
  UPDATE public.notifications SET read=true WHERE user_id=auth.uid() AND category='message'
    AND message_id=ANY(p_message_ids) AND read=false AND EXISTS(
      SELECT 1 FROM public.messages m WHERE m.id=message_id AND m.assignment_id=a.id
        AND m.sender_id<>auth.uid() AND m.read_at IS NOT NULL);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_chat_message_preview(p_message_id uuid)
RETURNS TABLE(id uuid,job_id uuid,sender_id uuid,content text,read_at timestamptz,sender_name text,photo_path text,photo_bucket text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.messages m JOIN public.operational_assignments a ON a.id=m.assignment_id
    WHERE m.id=p_message_id AND m.sender_id<>auth.uid() AND a.interruption IS NULL
      AND auth.uid() IN(a.worker_id,a.restaurant_id) AND public.is_approved_chat_participant(m.job_id)) THEN
    RAISE EXCEPTION 'Mensagem não autorizada.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT m.id,m.job_id,m.sender_id,m.content,m.read_at,
    COALESCE(NULLIF(btrim(u.name),''),CASE WHEN u.role='worker' THEN 'Profissional' ELSE 'Restaurante' END),
    CASE WHEN u.role='worker' THEN wp.profile_photo_path ELSE rp.logo_path END,
    CASE WHEN u.role='worker' THEN 'worker-private'::text ELSE 'restaurant-assets'::text END
    FROM public.messages m JOIN public.users u ON u.id=m.sender_id
    LEFT JOIN public.worker_profiles wp ON wp.user_id=u.id LEFT JOIN public.restaurant_profiles rp ON rp.user_id=u.id
    WHERE m.id=p_message_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.restaurant_operational_message_inbox(p_offset integer DEFAULT 0,p_limit integer DEFAULT 100)
RETURNS TABLE(job_id uuid,demand_id uuid,worker_id uuid,worker_name text,worker_specialty text,worker_score numeric,
  worker_photo_path text,completed_operations bigint,demand_title text,job_date date,start_time time,end_time time,
  location text,operational_status text,latest_message text,latest_message_at timestamptz,unread_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users actor WHERE actor.id=auth.uid() AND actor.role='restaurant' AND actor.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Página inválida.'; END IF;
  RETURN QUERY SELECT j.id,j.demand_id,worker.id,worker.name,
    CASE WHEN COALESCE(pref.show_experience,false) THEN wp.specialties[1] END,
    CASE WHEN COALESCE(pref.show_score,false) THEN worker.score::numeric END,
    CASE WHEN COALESCE(pref.show_photos,false) THEN wp.profile_photo_path END,
    (SELECT count(*) FROM public.operational_assignments completed WHERE completed.worker_id=worker.id
      AND completed.checkout_at IS NOT NULL AND completed.interruption IS NULL),
    j.title,j.job_date,j.start_time,j.end_time,
    COALESCE(NULLIF(btrim(j.location_name),''),NULLIF(concat_ws(', ',NULLIF(btrim(j.work_address),''),
      NULLIF(btrim(j.work_neighborhood),''),NULLIF(btrim(j.work_city),''),NULLIF(btrim(j.work_state),'')),''),'Local a definir'),
    CASE WHEN assignment.checkout_at IS NOT NULL THEN 'Concluída'
      WHEN assignment.checkin_at IS NULL AND now()<public.operational_start(j) THEN 'Contratado'
      WHEN assignment.checkin_at IS NULL THEN 'Check-in pendente'
      WHEN now()<public.operational_end(j) THEN 'Em operação'
      WHEN assignment.receipt_confirmed_at IS NOT NULL THEN 'Checkout pendente' ELSE 'Pagamento pendente' END,
    latest.content,latest.created_at,
    (SELECT count(*) FROM public.messages unread WHERE unread.assignment_id=assignment.id
      AND unread.sender_id<>auth.uid() AND unread.read_at IS NULL)
    FROM public.jobs j JOIN public.users restaurant ON restaurant.id=j.restaurant_id
    JOIN public.applications application ON application.job_id=j.id
    JOIN public.users worker ON worker.id=application.worker_id
    LEFT JOIN public.worker_profiles wp ON wp.user_id=worker.id
    LEFT JOIN public.privacy_preferences pref ON pref.user_id=worker.id
    JOIN public.operational_assignments assignment ON assignment.job_id=j.id AND assignment.worker_id=worker.id
      AND assignment.interruption IS NULL
    LEFT JOIN LATERAL(SELECT message.content,message.created_at FROM public.messages message
      WHERE message.assignment_id=assignment.id ORDER BY message.created_at DESC,message.id DESC LIMIT 1) latest ON true
    WHERE j.restaurant_id=auth.uid() AND restaurant.role='restaurant' AND worker.role='worker'
      AND worker.deleted_at IS NULL AND worker.id<>j.restaurant_id
      AND application.status IN('approved','in_progress','completed') AND public.is_approved_chat_participant(j.id)
    ORDER BY COALESCE(latest.created_at,assignment.hired_at) DESC NULLS LAST,j.id OFFSET p_offset LIMIT p_limit;
END;
$fn$;
REVOKE ALL ON FUNCTION public.restaurant_operational_message_inbox(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restaurant_operational_message_inbox(integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.invite_demand_worker(uuid,uuid),public.respond_demand_invitation(uuid,boolean),
  public.approve_application(uuid,uuid),public.approve_demand_candidate(uuid,uuid),
  public.operational_context(uuid),public.interrupt_operational_assignment(uuid,text),
  public.validate_operational_code(uuid,text,text),public.record_operational_payment(uuid,text),
  public.mark_chat_messages_read(uuid,uuid[]),public.get_chat_message_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invite_demand_worker(uuid,uuid),public.respond_demand_invitation(uuid,boolean),
  public.approve_application(uuid,uuid),public.approve_demand_candidate(uuid,uuid),
  public.operational_context(uuid),public.interrupt_operational_assignment(uuid,text),
  public.validate_operational_code(uuid,text,text),public.record_operational_payment(uuid,text),
  public.mark_chat_messages_read(uuid,uuid[]),public.get_chat_message_preview(uuid) TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
