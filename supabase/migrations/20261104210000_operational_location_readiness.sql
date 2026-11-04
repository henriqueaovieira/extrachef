-- Apply after recruitment, GPS restoration and geocoding cache. No legacy data is repaired.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE dependency text;
BEGIN
  FOREACH dependency IN ARRAY ARRAY[
    'public.recruitment_available(public.jobs)', 'public.recruitment_hireable(public.jobs)',
    'public.participant_assignment(uuid)',
    'public.issue_operational_code(uuid,text,double precision,double precision)',
    'public.save_geocoded_work_location(text,text,text,text,text,double precision,double precision)'
  ] LOOP
    IF to_regprocedure(dependency) IS NULL THEN
      RAISE EXCEPTION 'Operational location preflight: missing %.',dependency;
    END IF;
  END LOOP;
  IF to_regclass('public.geocoding_cache') IS NULL THEN
    RAISE EXCEPTION 'Operational location preflight: geocoding cache is missing.';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.operational_location_ready(p_job public.jobs)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT COALESCE(p_job.location_status='ready'
    AND p_job.work_latitude IS NOT NULL AND p_job.work_longitude IS NOT NULL
    AND p_job.work_latitude BETWEEN -90 AND 90 AND p_job.work_longitude BETWEEN -180 AND 180,false);
$fn$;
REVOKE ALL ON FUNCTION public.operational_location_ready(public.jobs) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.operational_location_ready(public.jobs) TO authenticated;

-- Deferred validation preserves the existing atomic historical-snapshot duplication.
CREATE FUNCTION public.require_published_job_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id=NEW.id;
  IF FOUND AND NOT public.operational_location_ready(j) THEN
    RAISE EXCEPTION 'Localize o endereço completo antes de publicar a operação.' USING ERRCODE='22023';
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER jobs_require_operational_location
  AFTER INSERT ON public.jobs DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.require_published_job_location();

CREATE FUNCTION public.guard_operational_job_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF public.operational_location_ready(OLD) AND NOT public.operational_location_ready(NEW) THEN
    RAISE EXCEPTION 'As coordenadas da operação não podem ser invalidadas.' USING ERRCODE='22023';
  END IF;
  IF ROW(NEW.work_latitude,NEW.work_longitude,NEW.work_address,NEW.work_number,NEW.work_city,NEW.work_state,
      NEW.work_neighborhood,NEW.work_postal_code,NEW.work_location_id,NEW.event_id,NEW.location_source,NEW.location_status)
    IS DISTINCT FROM ROW(OLD.work_latitude,OLD.work_longitude,OLD.work_address,OLD.work_number,OLD.work_city,OLD.work_state,
      OLD.work_neighborhood,OLD.work_postal_code,OLD.work_location_id,OLD.event_id,OLD.location_source,OLD.location_status)
    AND EXISTS(SELECT 1 FROM public.operational_assignments WHERE job_id=OLD.id AND checkin_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Não altere a localização de uma operação já iniciada.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER jobs_guard_operational_location BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_operational_job_location();

CREATE OR REPLACE FUNCTION public.recruitment_available(p_job public.jobs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT public.operational_location_ready(p_job)
    AND p_job.status::text='open' AND p_job.demand_archived_at IS NULL
    AND clock_timestamp()<public.recruitment_closes_at(p_job) AND NOT public.recruitment_blocked(p_job);
$fn$;
CREATE OR REPLACE FUNCTION public.recruitment_hireable(p_job public.jobs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT public.operational_location_ready(p_job)
    AND p_job.status::text='open' AND p_job.demand_archived_at IS NULL
    AND clock_timestamp()<public.operational_start(p_job) AND NOT public.recruitment_blocked(p_job);
$fn$;

CREATE FUNCTION public.guard_operational_location_advance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE j public.jobs;
BEGIN
  IF TG_TABLE_NAME='applications' THEN
    IF TG_OP='UPDATE' AND (NEW.status::text NOT IN ('pending','approved')
      OR NEW.status IS NOT DISTINCT FROM OLD.status) AND NEW.job_id IS NOT DISTINCT FROM OLD.job_id THEN
      RETURN NEW;
    END IF;
    SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  ELSIF TG_TABLE_NAME='operational_assignments' THEN
    SELECT * INTO j FROM public.jobs WHERE id=NEW.job_id FOR UPDATE;
  ELSE
    IF TG_OP='UPDATE' AND NEW.status::text<>'accepted' THEN RETURN NEW; END IF;
    IF NEW.replacement_assignment_id IS NOT NULL THEN
      SELECT job.* INTO j FROM public.jobs job JOIN public.operational_assignments a ON a.job_id=job.id
        WHERE a.id=NEW.replacement_assignment_id FOR UPDATE OF job;
    ELSE
      SELECT * INTO j FROM public.jobs WHERE demand_id=NEW.demand_id
        AND public.operational_location_ready(jobs) ORDER BY id LIMIT 1 FOR UPDATE;
    END IF;
  END IF;
  IF NOT FOUND OR NOT public.operational_location_ready(j) THEN
    RAISE EXCEPTION 'A operação precisa de coordenadas válidas antes de receber candidaturas, contratação ou substituição.'
      USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER applications_guard_operational_location BEFORE INSERT OR UPDATE OF status,job_id ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_operational_location_advance();
CREATE TRIGGER assignments_guard_operational_location BEFORE INSERT OR UPDATE OF replacement_requested_at ON public.operational_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_operational_location_advance();
CREATE TRIGGER invitations_guard_operational_location BEFORE INSERT OR UPDATE OF status ON public.demand_invitations
  FOR EACH ROW EXECUTE FUNCTION public.guard_operational_location_advance();

REVOKE ALL ON FUNCTION public.require_published_job_location(),public.guard_operational_job_location(),
  public.guard_operational_location_advance() FROM PUBLIC,anon,authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
