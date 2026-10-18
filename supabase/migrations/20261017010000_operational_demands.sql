BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.jobs ADD COLUMN demand_id uuid,
  ADD COLUMN demand_revision integer NOT NULL DEFAULT 1 CHECK (demand_revision > 0);
UPDATE public.jobs SET demand_id = id;
ALTER TABLE public.jobs ALTER COLUMN demand_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN demand_id SET NOT NULL;
CREATE INDEX jobs_demand_owner_idx ON public.jobs(restaurant_id, demand_id);
GRANT SELECT(demand_id, demand_revision) ON public.jobs TO authenticated;

CREATE TABLE public.demand_reserves (
  demand_id uuid NOT NULL,
  worker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(demand_id, worker_id)
);
ALTER TABLE public.demand_reserves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demand_reserves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.demand_reserves TO authenticated;
CREATE POLICY reserves_owner ON public.demand_reserves FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT auth.uid()));

CREATE FUNCTION public.create_restaurant_demand(
  p_title text, p_description text, p_job_date date, p_start_time time,
  p_end_time time, p_value numeric, p_quantity integer DEFAULT 1,
  p_location_source text DEFAULT 'none', p_work_location_id uuid DEFAULT NULL,
  p_location_revision integer DEFAULT NULL, p_event_id uuid DEFAULT NULL,
  p_event_revision integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  demand uuid := gen_random_uuid();
  saved public.jobs;
BEGIN
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta do restaurante.' USING ERRCODE = '42501'; END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 50
    OR nullif(btrim(p_title), '') IS NULL OR nullif(btrim(p_description), '') IS NULL
    OR p_job_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_start_time = p_end_time THEN
    RAISE EXCEPTION 'Informe os dados da demanda e de 1 a 50 profissionais.' USING ERRCODE = '22023';
  END IF;
  FOR i IN 1..p_quantity LOOP
    saved := public.create_restaurant_job(p_title, p_description, p_job_date,
      p_start_time, p_end_time, p_value, p_location_source, p_work_location_id,
      p_location_revision, p_event_id, p_event_revision);
    UPDATE public.jobs SET demand_id = demand WHERE id = saved.id;
  END LOOP;
  RETURN demand;
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_restaurant_demand(text,text,date,time,time,numeric,integer,text,uuid,integer,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_restaurant_demand(text,text,date,time,time,numeric,integer,text,uuid,integer,uuid,integer) TO authenticated;

CREATE FUNCTION public.manage_restaurant_demand(
  p_demand_id uuid, p_action text, p_title text DEFAULT NULL,
  p_description text DEFAULT NULL, p_job_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL, p_end_time time DEFAULT NULL,
  p_value numeric DEFAULT NULL, p_expected_revision integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  target public.jobs;
  source public.jobs;
  new_demand uuid := gen_random_uuid();
  saved public.jobs;
BEGIN
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id = p_demand_id AND restaurant_id = auth.uid()
    ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM public.jobs WHERE demand_id = p_demand_id AND restaurant_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('edit', 'duplicate', 'cancel') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Ação inválida.' USING ERRCODE = '22023';
  END IF;
  IF p_action IN ('edit', 'duplicate') THEN
    IF nullif(btrim(p_title), '') IS NULL OR nullif(btrim(p_description), '') IS NULL
      OR p_job_date IS NULL OR p_job_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_start_time IS NULL
      OR p_end_time IS NULL OR p_start_time = p_end_time
      OR p_value IS NULL OR p_value <= 0 OR p_value::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'Confira nome, descrição, data, horários e diária.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_action = 'cancel' THEN
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.demand_id = p_demand_id
      AND j.status::text NOT IN ('open','cancelled')) THEN
      RAISE EXCEPTION 'Só é possível cancelar sem profissionais contratados.';
    END IF;
    UPDATE public.jobs SET status = 'cancelled' WHERE demand_id = p_demand_id AND restaurant_id = auth.uid();
    DELETE FROM public.demand_reserves WHERE demand_id = p_demand_id AND restaurant_id = auth.uid();
    RETURN p_demand_id;
  ELSIF p_action = 'edit' THEN
    IF p_expected_revision IS DISTINCT FROM target.demand_revision THEN
      RAISE EXCEPTION 'A demanda foi alterada em outra sessão. Atualize antes de editar.' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.demand_id = p_demand_id
      AND (j.status::text <> 'open' OR j.job_date + j.start_time <= now() AT TIME ZONE 'America/Sao_Paulo'))
      OR EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
        WHERE j.demand_id = p_demand_id) THEN
      RAISE EXCEPTION 'Demandas com candidaturas ou já iniciadas não podem ser editadas.';
    END IF;
    UPDATE public.jobs SET title = btrim(p_title), description = btrim(p_description),
      job_date = p_job_date, start_time = p_start_time, end_time = p_end_time, value = p_value,
      demand_revision = demand_revision + 1
      WHERE demand_id = p_demand_id AND restaurant_id = auth.uid();
    RETURN p_demand_id;
  END IF;
  FOR source IN SELECT * FROM public.jobs WHERE demand_id = p_demand_id AND restaurant_id = auth.uid() ORDER BY id LOOP
    saved := public.create_restaurant_job(p_title, p_description, p_job_date,
      p_start_time, p_end_time, p_value);
    UPDATE public.jobs SET demand_id = new_demand,
      event_id = source.event_id, work_location_id = source.work_location_id,
      location_source = source.location_source, location_status = source.location_status,
      location_name = source.location_name, work_address = source.work_address,
      work_number = source.work_number, work_neighborhood = source.work_neighborhood,
      work_city = source.work_city, work_state = source.work_state,
      work_postal_code = source.work_postal_code, work_country_code = source.work_country_code,
      work_latitude = source.work_latitude, work_longitude = source.work_longitude,
      location_snapshot_at = source.location_snapshot_at,
      location_source_version = source.location_source_version,
      location_event_revision = source.location_event_revision
      WHERE id = saved.id;
  END LOOP;
  RETURN new_demand;
END;
$fn$;
REVOKE ALL ON FUNCTION public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer) TO authenticated;

CREATE FUNCTION public.set_demand_reserve(p_demand_id uuid, p_worker_id uuid, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id = p_demand_id AND restaurant_id = auth.uid() ORDER BY id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '42501'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Informe a ação de reserva.'; END IF;
  IF NOT p_enabled THEN
    DELETE FROM public.demand_reserves WHERE demand_id = p_demand_id AND worker_id = p_worker_id AND restaurant_id = auth.uid();
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_worker_id AND role = 'worker' AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE j.demand_id = p_demand_id AND a.worker_id = p_worker_id AND a.status = 'pending' AND j.status::text <> 'cancelled')
    OR EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE j.demand_id = p_demand_id AND a.worker_id = p_worker_id AND a.status IN ('approved','in_progress','completed'))
    OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE demand_id = p_demand_id AND status::text <> 'cancelled'
      AND job_date + start_time > now() AT TIME ZONE 'America/Sao_Paulo') THEN
    RAISE EXCEPTION 'Selecione um candidato disponível desta demanda antes do início.';
  END IF;
  INSERT INTO public.demand_reserves(demand_id,worker_id,restaurant_id)
    VALUES(p_demand_id,p_worker_id,auth.uid()) ON CONFLICT DO NOTHING;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_demand_reserve(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_demand_reserve(uuid,uuid,boolean) TO authenticated;

ALTER FUNCTION public.approve_application(uuid,uuid) RENAME TO approve_single_application;
REVOKE ALL ON FUNCTION public.approve_single_application(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.approve_application(p_job_id uuid,p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE demand uuid;
BEGIN
  SELECT demand_id INTO demand FROM public.jobs WHERE id = p_job_id AND restaurant_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_worker_id AND role = 'worker' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Este profissional não está disponível.';
  END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id = demand ORDER BY id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id
    AND job_date + end_time + CASE WHEN end_time <= start_time THEN interval '1 day' ELSE interval '0' END
      > now() AT TIME ZONE 'America/Sao_Paulo') THEN
    RAISE EXCEPTION 'O turno desta demanda já terminou.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
    WHERE j.demand_id = demand AND a.worker_id = p_worker_id AND a.status IN ('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional já foi contratado nesta demanda.';
  END IF;
  PERFORM public.approve_single_application(p_job_id,p_worker_id);
  DELETE FROM public.demand_reserves WHERE demand_id = demand AND worker_id = p_worker_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.approve_application(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_application(uuid,uuid) TO authenticated;

CREATE FUNCTION public.approve_demand_candidate(p_demand_id uuid, p_worker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  target_job uuid;
  source_application uuid;
BEGIN
  PERFORM 1 FROM public.users WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entre na conta da empresa.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.jobs WHERE demand_id = p_demand_id AND restaurant_id = auth.uid() ORDER BY id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demanda não encontrada.' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE j.demand_id = p_demand_id AND a.worker_id = p_worker_id AND a.status IN ('approved','in_progress','completed')) THEN
    RAISE EXCEPTION 'Este profissional já foi contratado nesta demanda.';
  END IF;
  SELECT a.job_id INTO target_job FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
    WHERE j.demand_id = p_demand_id AND a.worker_id = p_worker_id AND a.status = 'pending' AND j.status = 'open'
    ORDER BY j.id LIMIT 1;
  IF target_job IS NULL THEN
    SELECT id INTO target_job FROM public.jobs WHERE demand_id = p_demand_id AND status = 'open' ORDER BY id LIMIT 1;
    SELECT a.id INTO source_application FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE j.demand_id = p_demand_id AND j.status::text <> 'cancelled' AND a.worker_id = p_worker_id AND a.status = 'pending'
      ORDER BY a.id LIMIT 1;
    IF target_job IS NULL OR source_application IS NULL THEN
      RAISE EXCEPTION 'Não há posição aberta ou candidatura disponível nesta demanda.';
    END IF;
    UPDATE public.applications SET job_id = target_job WHERE id = source_application;
  END IF;
  PERFORM public.approve_application(target_job, p_worker_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.approve_demand_candidate(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_demand_candidate(uuid,uuid) TO authenticated;

ALTER FUNCTION public.export_own_account_data() RENAME TO export_account_before_demands;
REVOKE ALL ON FUNCTION public.export_account_before_demands() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.export_own_account_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
  result := public.export_account_before_demands();
  RETURN result || jsonb_build_object('demand_reserves', COALESCE(
    (SELECT jsonb_agg(to_jsonb(r)) FROM public.demand_reserves r
      WHERE r.restaurant_id = auth.uid() OR r.worker_id = auth.uid()), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.export_own_account_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_own_account_data() TO authenticated;

ALTER FUNCTION public.anonymize_account(uuid) RENAME TO anonymize_account_before_demands;
REVOKE ALL ON FUNCTION public.anonymize_account_before_demands(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.anonymize_account(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.anonymize_account_before_demands(p_user_id);
  DELETE FROM public.demand_reserves WHERE worker_id = p_user_id OR restaurant_id = p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_account(uuid) TO service_role;
COMMIT;
