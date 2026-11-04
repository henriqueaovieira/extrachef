-- Objective: make each create_restaurant_demand call create exactly one vacancy.
-- Dependencies: the existing 12-argument RPC, users, jobs, restaurant_profiles,
--   work_locations, create_restaurant_job(...), save_work_location(...), and
--   manage_work_location(uuid,text,integer).
-- Risk: removes the p_quantity RPC argument; older clients that still send it
--   must be updated before deployment. Existing multi-vacancy demands remain intact.
-- Validation:
--   SELECT to_regprocedure(
--     'public.create_restaurant_demand(text,text,date,time without time zone,time without time zone,numeric,text,uuid,integer,uuid,integer)'
--   );
--   SELECT to_regprocedure(
--     'public.create_restaurant_demand(text,text,date,time without time zone,time without time zone,numeric,integer,text,uuid,integer,uuid,integer)'
--   );
--   The first query should return the new RPC and the second should return NULL.
--   Verify a successful call creates exactly one public.jobs row for its demand.
-- Rollback: restore the previous 12-argument function with a new forward
--   migration. Do not remove or rewrite existing multi-vacancy demand rows.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.users') IS NULL
    OR to_regclass('public.jobs') IS NULL
    OR to_regclass('public.restaurant_profiles') IS NULL
    OR to_regclass('public.work_locations') IS NULL
    OR to_regprocedure(
      'public.create_restaurant_demand(text,text,date,time without time zone,time without time zone,numeric,integer,text,uuid,integer,uuid,integer)'
    ) IS NULL
    OR to_regprocedure(
      'public.create_restaurant_job(text,text,date,time without time zone,time without time zone,numeric,text,uuid,integer,uuid,integer)'
    ) IS NULL
    OR to_regprocedure(
      'public.save_work_location(text,text,text,text,text,text,text,uuid,integer)'
    ) IS NULL
    OR to_regprocedure('public.manage_work_location(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Missing dependencies for single-vacancy operation creation.';
  END IF;
END;
$preflight$;

DROP FUNCTION public.create_restaurant_demand(
  text, text, date, time, time, numeric, integer, text, uuid, integer, uuid, integer
);

CREATE FUNCTION public.create_restaurant_demand(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  demand uuid := gen_random_uuid();
  saved public.jobs;
  profile public.restaurant_profiles;
  primary_location public.work_locations;
  source text := p_location_source;
  location_id uuid := p_work_location_id;
  location_revision integer := p_location_revision;
  v_address text;
  v_city text;
  v_state text;
  v_postal_code text;
BEGIN
  PERFORM 1
  FROM public.users
  WHERE id = auth.uid() AND role = 'restaurant' AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entre na conta do restaurante.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR p_job_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
    OR p_start_time = p_end_time THEN
    RAISE EXCEPTION 'Informe os dados da demanda.' USING ERRCODE = '22023';
  END IF;

  IF source = 'restaurant' THEN
    IF p_work_location_id IS NOT NULL
      OR p_location_revision IS NOT NULL
      OR p_event_id IS NOT NULL
      OR p_event_revision IS NOT NULL THEN
      RAISE EXCEPTION 'O endereco principal e obtido automaticamente do restaurante.'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO profile
    FROM public.restaurant_profiles
    WHERE user_id = auth.uid()
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Complete o endereco principal no perfil do restaurante antes de publicar.'
        USING ERRCODE = '22023';
    END IF;

    v_address := btrim(COALESCE(profile.address, ''));
    v_city := btrim(COALESCE(profile.city, ''));
    v_state := upper(btrim(COALESCE(profile.state, '')));
    v_postal_code := regexp_replace(COALESCE(profile.postal_code, ''), '[^0-9]', '', 'g');

    IF char_length(v_address) NOT BETWEEN 3 AND 300
      OR char_length(v_city) NOT BETWEEN 2 AND 120
      OR v_state !~ '^[A-Z]{2}$'
      OR v_postal_code !~ '^[0-9]{8}$' THEN
      RAISE EXCEPTION 'Confira endereco, cidade, UF e CEP no perfil do restaurante antes de publicar.'
        USING ERRCODE = '22023';
    END IF;

    SELECT l.* INTO primary_location
    FROM public.work_locations l
    WHERE l.restaurant_id = auth.uid()
      AND l.archived_at IS NULL
      AND l.address = v_address
      AND l.city = v_city
      AND l.state = v_state
      AND l.postal_code = v_postal_code
      AND l.number = ''
      AND l.neighborhood = ''
    ORDER BY l.is_default DESC, l.created_at, l.id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      primary_location := public.save_work_location(
        'Endereco principal do restaurante',
        v_address,
        '',
        '',
        v_city,
        v_state,
        v_postal_code
      );
    END IF;

    IF NOT primary_location.is_default THEN
      PERFORM public.manage_work_location(
        primary_location.id,
        'set_default',
        primary_location.revision
      );
      SELECT * INTO STRICT primary_location
      FROM public.work_locations
      WHERE id = primary_location.id;
    END IF;

    source := 'catalog';
    location_id := primary_location.id;
    location_revision := primary_location.revision;
  END IF;

  saved := public.create_restaurant_job(
    p_title,
    p_description,
    p_job_date,
    p_start_time,
    p_end_time,
    p_value,
    source,
    location_id,
    location_revision,
    p_event_id,
    p_event_revision
  );
  UPDATE public.jobs SET demand_id = demand WHERE id = saved.id;

  RETURN demand;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_restaurant_demand(
  text, text, date, time, time, numeric, text, uuid, integer, uuid, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_restaurant_demand(
  text, text, date, time, time, numeric, text, uuid, integer, uuid, integer
) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
