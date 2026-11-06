-- Geocoded candidate locations remain usable with precision-specific radii and learn
-- from check-ins that are confirmed through the existing two-party code flow.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.work_locations') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR to_regclass('public.operational_assignments') IS NULL
    OR to_regclass('public.operational_codes') IS NULL
    OR to_regprocedure('public.issue_operational_code(uuid,text,double precision,double precision)') IS NULL
    OR to_regprocedure('public.validate_operational_code(uuid,text,text)') IS NULL
    OR to_regprocedure('public.worker_operational_reputation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Operational geolocation preflight failed. Apply operational location and trust migrations first.';
  END IF;
END;
$preflight$;

ALTER TABLE public.work_locations
  ADD COLUMN IF NOT EXISTS candidate_accuracy double precision,
  ADD COLUMN IF NOT EXISTS candidate_sample_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS candidate_worker_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS candidate_job_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS device_verified_at timestamptz;

ALTER TABLE public.work_locations
  DROP CONSTRAINT IF EXISTS work_locations_coordinate_source_check,
  ADD CONSTRAINT work_locations_coordinate_source_check
    CHECK (coordinate_source IN ('geocoder', 'manual', 'device')),
  ADD CONSTRAINT work_locations_candidate_accuracy_check
    CHECK (candidate_accuracy IS NULL OR candidate_accuracy BETWEEN 0 AND 50),
  ADD CONSTRAINT work_locations_candidate_counts_check
    CHECK (candidate_sample_count >= 0 AND candidate_worker_count >= 0 AND candidate_job_count >= 0);

CREATE TABLE public.work_location_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_location_id uuid NOT NULL REFERENCES public.work_locations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(8,2) NOT NULL CHECK (accuracy_meters BETWEEN 0 AND 50),
  trust_score integer NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
  location_address_version integer NOT NULL CHECK (location_address_version > 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, worker_id)
);

CREATE INDEX idx_work_location_evidence_location
  ON public.work_location_evidence(work_location_id);
CREATE INDEX idx_work_location_evidence_worker
  ON public.work_location_evidence(worker_id);
CREATE INDEX idx_work_location_evidence_recorded
  ON public.work_location_evidence(recorded_at);
CREATE INDEX idx_work_location_evidence_version
  ON public.work_location_evidence(work_location_id, location_address_version);
ALTER TABLE public.work_location_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.work_location_evidence FROM PUBLIC, anon, authenticated;

CREATE TABLE public.checkin_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX checkin_attempts_job_time_idx ON public.checkin_attempts(job_id, attempted_at);
CREATE INDEX checkin_attempts_worker_time_idx ON public.checkin_attempts(worker_id, attempted_at);
ALTER TABLE public.checkin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkin_attempts FROM PUBLIC, anon, authenticated;

ALTER TABLE public.operational_codes
  ADD COLUMN checkin_latitude double precision,
  ADD COLUMN checkin_longitude double precision,
  ADD COLUMN checkin_accuracy double precision,
  ADD COLUMN checkin_speed double precision,
  ADD COLUMN checkin_is_mock boolean;

CREATE OR REPLACE FUNCTION public.require_operational_location_address()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.is_default AND NEW.kind = 'temporary' THEN
    RAISE EXCEPTION 'Um local temporário não pode ser o endereço principal.';
  END IF;
  IF TG_OP = 'INSERT' OR ROW(NEW.address, NEW.number, NEW.neighborhood, NEW.city, NEW.state, NEW.postal_code)
    IS DISTINCT FROM ROW(OLD.address, OLD.number, OLD.neighborhood, OLD.city, OLD.state, OLD.postal_code) THEN
    IF NEW.postal_code !~ '^[0-9]{8}$' THEN
      RAISE EXCEPTION 'Informe um CEP válido com 8 dígitos.' USING ERRCODE = '22023';
    END IF;
    IF btrim(NEW.number) = '' THEN
      RAISE EXCEPTION 'Informe o número do endereço.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.address_version IS DISTINCT FROM OLD.address_version THEN
    NEW.geocoding_precision := NULL;
    NEW.candidate_latitude := NULL;
    NEW.candidate_longitude := NULL;
    NEW.candidate_accuracy := NULL;
    NEW.candidate_sample_count := 0;
    NEW.candidate_worker_count := 0;
    NEW.candidate_job_count := 0;
    NEW.device_verified_at := NULL;
    NEW.geocoded_address := NULL;
    NEW.confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.prepare_geocoded_job_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE location public.work_locations%ROWTYPE;
BEGIN
  IF NEW.work_location_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO location FROM public.work_locations WHERE id = NEW.work_location_id;
  IF NOT FOUND OR location.address_version IS DISTINCT FROM NEW.location_source_version
    OR location.geocoding_precision IS NULL
    OR location.geocoding_precision NOT IN ('house', 'street')
    OR location.geocoding_status NOT IN ('needs_review', 'resolved') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(location.candidate_latitude, location.latitude) NOT BETWEEN -90 AND 90
    OR COALESCE(location.candidate_longitude, location.longitude) NOT BETWEEN -180 AND 180 THEN
    RETURN NEW;
  END IF;
  NEW.work_latitude := COALESCE(location.candidate_latitude, location.latitude);
  NEW.work_longitude := COALESCE(location.candidate_longitude, location.longitude);
  NEW.location_status := 'ready';
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.prepare_geocoded_job_location() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER jobs_prepare_geocoded_location
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.prepare_geocoded_job_location();

CREATE OR REPLACE FUNCTION public.internal_operational_trust_score(p_worker_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  previous_subject text := current_setting('request.jwt.claim.sub', true);
  reputation jsonb;
  score integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_worker_id AND role = 'worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Perfil profissional indisponível.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', p_worker_id::text, true);
  BEGIN
    reputation := public.worker_operational_reputation(p_worker_id);
    score := round((reputation->>'score')::numeric)::integer;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(previous_subject, ''), true);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(previous_subject, ''), true);
  IF score IS NULL THEN RAISE EXCEPTION 'Confiança operacional indisponível.'; END IF;
  RETURN score;
END;
$fn$;
REVOKE ALL ON FUNCTION public.internal_operational_trust_score(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_work_location_checkin_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  assignment public.operational_assignments%ROWTYPE;
  job public.jobs%ROWTYPE;
  location public.work_locations%ROWTYPE;
  score integer;
  sample_count integer;
  worker_count integer;
  job_count integer;
  verified_count integer;
  verified_worker_count integer;
  verified_job_count integer;
  verified_day_count integer;
  average_latitude double precision;
  average_longitude double precision;
  verified_latitude double precision;
  verified_longitude double precision;
  average_accuracy double precision;
  verified boolean;
  previous_confirmation text;
BEGIN
  SELECT * INTO assignment FROM public.operational_assignments WHERE id = NEW.assignment_id;
  IF NOT FOUND OR assignment.checkin_at IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO job FROM public.jobs WHERE id = assignment.job_id;
  IF NOT FOUND OR job.work_location_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO location FROM public.work_locations
    WHERE id = job.work_location_id FOR UPDATE;
  IF NOT FOUND OR location.address_version IS DISTINCT FROM job.location_source_version
    OR location.geocoding_precision NOT IN ('street', 'house', 'device')
    OR NEW.checkin_latitude IS NULL OR NEW.checkin_longitude IS NULL OR NEW.checkin_accuracy IS NULL
    OR NEW.checkin_accuracy > 50 OR NEW.checkin_is_mock IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;

  score := public.internal_operational_trust_score(assignment.worker_id);
  INSERT INTO public.work_location_evidence(
    work_location_id, job_id, worker_id, latitude, longitude, accuracy_meters, trust_score, location_address_version
  ) VALUES (
    location.id, job.id, assignment.worker_id, NEW.checkin_latitude, NEW.checkin_longitude,
    NEW.checkin_accuracy, score, location.address_version
  ) ON CONFLICT (job_id, worker_id) DO NOTHING;
  IF location.geocoding_precision <> 'street' THEN RETURN NEW; END IF;

  SELECT count(*), count(DISTINCT worker_id), count(DISTINCT job_id),
    sum(latitude * CASE WHEN trust_score >= 90 THEN 1.0 WHEN trust_score >= 80 THEN 0.8
      WHEN trust_score >= 70 THEN 0.6 ELSE 0.4 END)
      / NULLIF(sum(CASE WHEN trust_score >= 90 THEN 1.0 WHEN trust_score >= 80 THEN 0.8
        WHEN trust_score >= 70 THEN 0.6 ELSE 0.4 END), 0),
    sum(longitude * CASE WHEN trust_score >= 90 THEN 1.0 WHEN trust_score >= 80 THEN 0.8
      WHEN trust_score >= 70 THEN 0.6 ELSE 0.4 END)
      / NULLIF(sum(CASE WHEN trust_score >= 90 THEN 1.0 WHEN trust_score >= 80 THEN 0.8
        WHEN trust_score >= 70 THEN 0.6 ELSE 0.4 END), 0),
    avg(accuracy_meters)
  INTO sample_count, worker_count, job_count, average_latitude, average_longitude, average_accuracy
  FROM public.work_location_evidence
  WHERE work_location_id = location.id AND location_address_version = location.address_version
    AND accuracy_meters <= 50;

  SELECT count(*), count(DISTINCT worker_id), count(DISTINCT job_id),
    count(DISTINCT (recorded_at AT TIME ZONE 'America/Sao_Paulo')::date),
    avg(latitude), avg(longitude)
  INTO verified_count, verified_worker_count, verified_job_count, verified_day_count,
    verified_latitude, verified_longitude
  FROM public.work_location_evidence
  WHERE work_location_id = location.id AND location_address_version = location.address_version
    AND accuracy_meters <= 25;

  verified := verified_count >= 10 AND verified_worker_count >= 5
    AND verified_job_count >= 5 AND verified_day_count >= 3;
  previous_confirmation := current_setting('extrachef.confirming_location', true);
  IF verified THEN PERFORM set_config('extrachef.confirming_location', location.id::text, true); END IF;
  UPDATE public.work_locations SET
    candidate_latitude = CASE WHEN verified THEN verified_latitude ELSE average_latitude END,
    candidate_longitude = CASE WHEN verified THEN verified_longitude ELSE average_longitude END,
    candidate_accuracy = average_accuracy,
    candidate_sample_count = sample_count,
    candidate_worker_count = worker_count,
    candidate_job_count = job_count,
    latitude = CASE WHEN verified THEN verified_latitude ELSE latitude END,
    longitude = CASE WHEN verified THEN verified_longitude ELSE longitude END,
    coordinate_source = CASE WHEN verified THEN 'device' ELSE coordinate_source END,
    geocoding_precision = CASE WHEN verified THEN 'device' ELSE geocoding_precision END,
    geocoding_status = CASE WHEN verified THEN 'resolved' ELSE geocoding_status END,
    geocoding_error_code = CASE WHEN verified THEN NULL ELSE geocoding_error_code END,
    confirmed_at = CASE WHEN verified THEN now() ELSE confirmed_at END,
    device_verified_at = CASE WHEN verified THEN now() ELSE device_verified_at END,
    revision = CASE WHEN verified THEN revision + 1 ELSE revision END,
    updated_at = CASE WHEN verified THEN now() ELSE updated_at END
  WHERE id = location.id;
  IF verified THEN PERFORM set_config('extrachef.confirming_location', COALESCE(previous_confirmation, ''), true); END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_work_location_checkin_evidence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER operational_codes_capture_checkin_evidence
  AFTER UPDATE OF consumed_at ON public.operational_codes
  FOR EACH ROW
  WHEN (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.stage = 'checkin')
  EXECUTE FUNCTION public.record_work_location_checkin_evidence();

CREATE OR REPLACE FUNCTION public.operational_context(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE a public.operational_assignments; j public.jobs; token public.operational_codes; phase text; issuer boolean;
  location_precision text;
BEGIN
  SELECT * INTO a FROM public.operational_assignments WHERE job_id = p_job_id;
  IF NOT FOUND OR auth.uid() IS NULL OR auth.uid() NOT IN (a.worker_id, a.restaurant_id)
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Operação indisponível para esta conta.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT j FROM public.jobs WHERE id = p_job_id;
  SELECT geocoding_precision INTO location_precision FROM public.work_locations
    WHERE id = j.work_location_id AND address_version = j.location_source_version;
  phase := CASE WHEN a.interruption IS NOT NULL THEN a.interruption
    WHEN a.checkout_at IS NOT NULL THEN 'completed'
    WHEN a.checkin_at IS NULL THEN
      CASE WHEN now() > public.operational_start(j) + interval '5 minutes' THEN 'absence_pending'
        WHEN (now() AT TIME ZONE 'America/Sao_Paulo')::date < j.job_date THEN 'confirmed'
        ELSE 'checkin' END
    WHEN now() < public.operational_end(j) THEN 'working'
    WHEN a.receipt_confirmed_at IS NOT NULL THEN 'checkout'
    WHEN a.payment_disputed_at IS NOT NULL THEN 'payment_disputed'
    WHEN a.paid_at IS NOT NULL THEN 'receipt' ELSE 'payment' END;
  SELECT * INTO token FROM public.operational_codes WHERE assignment_id = a.id
    AND stage = CASE WHEN a.checkin_at IS NULL THEN 'checkin' ELSE 'checkout' END;
  issuer := a.interruption IS NULL AND CASE WHEN a.checkin_at IS NULL
    THEN auth.uid() = a.worker_id ELSE auth.uid() = a.restaurant_id END;
  RETURN jsonb_build_object('assignment_id', a.id, 'worker_id', a.worker_id, 'job_id', j.id,
    'demand_id', j.demand_id, 'title', j.title, 'location', COALESCE(j.location_name, j.work_address, 'Local a definir'),
    'starts_at', public.operational_start(j), 'ends_at', public.operational_end(j),
    'role', CASE WHEN auth.uid() = a.worker_id THEN 'worker' ELSE 'restaurant' END,
    'worker_name', (SELECT name FROM public.users WHERE id = a.worker_id),
    'phase', phase, 'amount', a.amount, 'checkin_at', a.checkin_at, 'paid_at', a.paid_at,
    'payment_disputed_at', a.payment_disputed_at, 'receipt_confirmed_at', a.receipt_confirmed_at,
    'checkout_at', a.checkout_at, 'location_precision', location_precision,
    'code', CASE WHEN issuer AND token.expires_at > now() AND token.consumed_at IS NULL THEN token.code END,
    'code_expires_at', CASE WHEN issuer AND token.consumed_at IS NULL THEN token.expires_at END,
    'has_code', COALESCE(token.expires_at > now() AND token.consumed_at IS NULL, false),
    'review_pending', a.checkout_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reviews r WHERE r.job_id = j.id AND r.reviewer_id = auth.uid()));
END;
$fn$;

DROP FUNCTION public.issue_operational_code(uuid, text, double precision, double precision);
CREATE FUNCTION public.issue_operational_code(
  p_job_id uuid,
  p_stage text,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL,
  p_speed double precision DEFAULT NULL,
  p_is_mock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  a public.operational_assignments;
  j public.jobs;
  token public.operational_codes;
  location public.work_locations;
  latitude double precision;
  longitude double precision;
  radius_meters double precision := 100;
  distance_meters double precision;
  recent_job_attempts integer;
  recent_worker_attempts integer;
BEGIN
  PERFORM public.operational_context(p_job_id);
  SELECT * INTO STRICT j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  SELECT * INTO a FROM public.operational_assignments
    WHERE id = (public.participant_assignment(p_job_id)).id FOR UPDATE;
  IF p_stage IS NULL OR p_stage NOT IN ('checkin', 'checkout') OR a.interruption IS NOT NULL THEN
    RAISE EXCEPTION 'Etapa indisponível.';
  END IF;

  IF p_stage = 'checkin' THEN
    IF auth.uid() <> a.worker_id THEN
      RAISE EXCEPTION 'Somente o profissional pode iniciar o check-in.' USING ERRCODE = '42501';
    END IF;
    IF a.checkin_at IS NOT NULL THEN RETURN public.operational_context(p_job_id); END IF;
    SELECT * INTO token FROM public.operational_codes
      WHERE assignment_id = a.id AND stage = 'checkin' FOR UPDATE;
    IF token.expires_at > now() AND token.checkin_latitude IS NOT NULL
      AND token.consumed_at IS NULL AND (token.blocked_until IS NULL OR token.blocked_until <= now()) THEN
      RETURN public.operational_context(p_job_id);
    END IF;
    IF (now() AT TIME ZONE 'America/Sao_Paulo')::date < j.job_date THEN
      RAISE EXCEPTION 'O profissional pode gerar o código ao chegar no dia da demanda.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('checkin-job:' || p_job_id::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('checkin-worker:' || a.worker_id::text, 0));
    DELETE FROM public.checkin_attempts WHERE attempted_at < clock_timestamp() - interval '1 hour';
    SELECT count(*) INTO recent_job_attempts FROM public.checkin_attempts
      WHERE job_id = p_job_id AND attempted_at > clock_timestamp() - interval '5 minutes';
    SELECT count(*) INTO recent_worker_attempts FROM public.checkin_attempts
      WHERE worker_id = a.worker_id AND attempted_at > clock_timestamp() - interval '1 hour';
    IF recent_job_attempts >= 5 OR recent_worker_attempts >= 30 THEN
      RETURN jsonb_build_object('error', 'Muitas tentativas detectadas. Aguarde alguns minutos e tente novamente.');
    END IF;
    INSERT INTO public.checkin_attempts(job_id, worker_id) VALUES (p_job_id, a.worker_id);

    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RETURN jsonb_build_object('error', 'Ative sua localização para registrar presença.');
    END IF;
    IF p_is_mock IS DISTINCT FROM false THEN
      RETURN jsonb_build_object('error', 'Não foi possível validar sua localização.');
    END IF;
    IF p_accuracy IS NULL OR p_accuracy < 0 OR p_accuracy > 50 THEN
      RETURN jsonb_build_object('error', 'Aguardando uma localização mais precisa. Tente novamente em alguns segundos.');
    END IF;
    IF p_speed IS NOT NULL AND (p_speed < 0 OR p_speed > (100.0 / 3.6)) THEN
      RETURN jsonb_build_object('error', 'Localização inconsistente detectada.');
    END IF;
    IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
      RETURN jsonb_build_object('error', 'Não foi possível validar sua localização.');
    END IF;
    IF j.work_latitude IS NULL OR j.work_longitude IS NULL
      OR j.work_latitude NOT BETWEEN -90 AND 90 OR j.work_longitude NOT BETWEEN -180 AND 180 THEN
      RETURN jsonb_build_object('error', 'O local da operação não possui coordenadas válidas. Contate o restaurante.');
    END IF;

    IF j.work_location_id IS NOT NULL THEN
      SELECT * INTO location FROM public.work_locations
      WHERE id = j.work_location_id AND address_version = j.location_source_version;
      IF FOUND THEN
          IF location.geocoding_precision IN ('house', 'street')
            AND location.geocoding_status IN ('needs_review', 'resolved') THEN
            latitude := COALESCE(location.candidate_latitude, location.latitude);
            longitude := COALESCE(location.candidate_longitude, location.longitude);
            IF location.geocoding_precision = 'street' THEN radius_meters := 300; END IF;
        ELSIF location.geocoding_precision IN ('house', 'device')
          AND location.geocoding_status = 'resolved' THEN
          latitude := location.latitude;
          longitude := location.longitude;
        END IF;
      END IF;
    END IF;
    latitude := COALESCE(latitude, j.work_latitude);
    longitude := COALESCE(longitude, j.work_longitude);
    distance_meters := 6371000 * 2 * asin(sqrt(LEAST(1.0, GREATEST(0.0,
      power(sin(radians(p_latitude - latitude) / 2), 2)
      + cos(radians(latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - longitude) / 2), 2)
    ))));
    IF distance_meters > radius_meters THEN
      RETURN jsonb_build_object('error', 'Você parece estar distante do local da operação.');
    END IF;
  ELSIF auth.uid() <> a.restaurant_id OR a.receipt_confirmed_at IS NULL OR a.checkout_at IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout disponível após o profissional confirmar recebimento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO token FROM public.operational_codes
    WHERE assignment_id = a.id AND stage = p_stage FOR UPDATE;
  IF token.blocked_until > now() THEN
    RETURN jsonb_build_object('error', 'Muitas tentativas. Aguarde dez minutos.');
  END IF;
  IF token.expires_at IS NULL OR token.expires_at <= now()
    OR (p_stage = 'checkin' AND token.checkin_latitude IS NULL) THEN
    INSERT INTO public.operational_codes(
      assignment_id, stage, code, expires_at, attempts, checkin_latitude, checkin_longitude,
      checkin_accuracy, checkin_speed, checkin_is_mock
    ) VALUES (
      a.id, p_stage, upper(left(replace(gen_random_uuid()::text, '-', ''), 8)),
      now() + interval '10 minutes', 0,
      CASE WHEN p_stage = 'checkin' THEN p_latitude END,
      CASE WHEN p_stage = 'checkin' THEN p_longitude END,
      CASE WHEN p_stage = 'checkin' THEN p_accuracy END,
      CASE WHEN p_stage = 'checkin' THEN p_speed END,
      CASE WHEN p_stage = 'checkin' THEN p_is_mock END
    )
    ON CONFLICT (assignment_id, stage) DO UPDATE SET
      code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, attempts = 0, blocked_until = NULL,
      consumed_at = NULL, checkin_latitude = EXCLUDED.checkin_latitude,
      checkin_longitude = EXCLUDED.checkin_longitude, checkin_accuracy = EXCLUDED.checkin_accuracy,
      checkin_speed = EXCLUDED.checkin_speed, checkin_is_mock = EXCLUDED.checkin_is_mock;
    INSERT INTO public.notifications(user_id, title, message, category, url)
      VALUES (
        CASE WHEN p_stage = 'checkin' THEN a.restaurant_id ELSE a.worker_id END,
        CASE WHEN p_stage = 'checkin' THEN 'Profissional chegou' ELSE 'Checkout liberado' END,
        CASE WHEN p_stage = 'checkin' THEN 'Confira a chegada e digite o código apresentado pelo profissional.'
          ELSE 'Solicite à empresa o código de checkout.' END,
        'operational', '/' || p_stage || '/' || p_job_id
      );
  END IF;
  RETURN public.operational_context(p_job_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_operational_code(uuid, text, double precision, double precision, double precision, double precision, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_operational_code(uuid, text, double precision, double precision, double precision, double precision, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_restaurant_demand(
  p_title text,
  p_description text,
  p_job_date date,
  p_start_time time,
  p_end_time time,
  p_value numeric,
  p_location_source text DEFAULT 'none',
  p_work_location_id uuid DEFAULT NULL,
  p_location_revision integer DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_event_revision integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  demand uuid := gen_random_uuid();
  saved public.jobs;
  selected public.work_locations;
  source_event public.events;
  source text := p_location_source;
  location_id uuid := p_work_location_id;
  location_revision integer := p_location_revision;
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  geocoded_candidate boolean;
BEGIN
  PERFORM 1 FROM public.users
  WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta do restaurante.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_title), '') IS NULL OR NULLIF(btrim(p_description), '') IS NULL
    OR p_job_date < today OR p_start_time = p_end_time THEN
    RAISE EXCEPTION 'Informe os dados da demanda.' USING ERRCODE = '22023';
  END IF;
  IF source = 'restaurant' THEN
    IF p_work_location_id IS NOT NULL OR p_location_revision IS NOT NULL
      OR p_event_id IS NOT NULL OR p_event_revision IS NOT NULL THEN
      RAISE EXCEPTION 'O endereço principal é obtido automaticamente do restaurante.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO selected FROM public.work_locations
      WHERE restaurant_id = auth.uid() AND is_default AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cadastre o endereço operacional principal antes de publicar.' USING ERRCODE = '22023'; END IF;
    source := 'catalog';
    location_id := selected.id;
    location_revision := selected.revision;
  END IF;
  IF source IS DISTINCT FROM 'catalog' AND source IS DISTINCT FROM 'event' THEN
    RAISE EXCEPTION 'Selecione um local operacional antes de publicar.' USING ERRCODE = '22023';
  END IF;
  IF source = 'catalog' THEN
    SELECT * INTO selected FROM public.work_locations
      WHERE id = location_id AND restaurant_id = auth.uid() AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND OR location_revision IS DISTINCT FROM selected.revision THEN
      RAISE EXCEPTION 'Local indisponível ou atualizado. Recarregue o catálogo.' USING ERRCODE = '40001';
    END IF;
    geocoded_candidate := COALESCE(selected.geocoding_status IN ('needs_review', 'resolved')
      AND selected.geocoding_precision IN ('house', 'street')
      AND COALESCE(selected.candidate_latitude, selected.latitude) BETWEEN -90 AND 90
      AND COALESCE(selected.candidate_longitude, selected.longitude) BETWEEN -180 AND 180, false);
    IF NOT geocoded_candidate AND NOT (
      selected.geocoding_status = 'resolved'
      AND selected.geocoding_precision IN ('house', 'device')
      AND selected.latitude BETWEEN -90 AND 90 AND selected.longitude BETWEEN -180 AND 180
    ) THEN
      RAISE EXCEPTION 'A localização ainda não possui coordenadas operacionais. Localize o endereço antes de publicar.'
        USING ERRCODE = '22023';
    END IF;
    IF selected.kind = 'temporary' AND (selected.valid_until < today OR p_job_date > selected.valid_until) THEN
      RAISE EXCEPTION 'O local temporário não é válido para a data da operação.' USING ERRCODE = '22023';
    END IF;
  ELSIF source = 'event' THEN
    IF p_event_id IS NULL OR p_event_revision IS NULL OR p_work_location_id IS NOT NULL OR p_location_revision IS NOT NULL THEN
      RAISE EXCEPTION 'Informe um evento com local operacional confirmado.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO source_event FROM public.events WHERE id = p_event_id AND restaurant_id = auth.uid() FOR SHARE;
    IF NOT FOUND OR p_event_revision IS DISTINCT FROM source_event.revision
      OR source_event.work_location_id IS NULL OR source_event.location_status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'Evento indisponível. Atualize o evento e confira o local selecionado.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO selected FROM public.work_locations
      WHERE id = source_event.work_location_id AND restaurant_id = auth.uid() AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND OR selected.geocoding_status IS DISTINCT FROM 'resolved'
      OR selected.geocoding_precision IS DISTINCT FROM 'device'
      OR selected.address_version IS DISTINCT FROM source_event.location_source_version
      OR source_event.event_latitude IS DISTINCT FROM selected.latitude
      OR source_event.event_longitude IS DISTINCT FROM selected.longitude THEN
      RAISE EXCEPTION 'Atualize o local do evento antes de publicar a operação.' USING ERRCODE = '22023';
    END IF;
    IF selected.kind = 'temporary' AND (selected.valid_until < today OR p_job_date > selected.valid_until) THEN
      RAISE EXCEPTION 'O local temporário não é válido para a data da operação.' USING ERRCODE = '22023';
    END IF;
  END IF;
  saved := public.create_restaurant_job(
    p_title, p_description, p_job_date, p_start_time, p_end_time, p_value,
    source, location_id, location_revision, p_event_id, p_event_revision
  );
  UPDATE public.jobs SET demand_id = demand WHERE id = saved.id;
  RETURN demand;
END;
$fn$;

NOTIFY pgrst, 'reload schema';
COMMIT;
