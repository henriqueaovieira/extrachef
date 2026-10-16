BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Confere dependências e o contrato auditado, sem aplicar migrations anteriores.
DO $preflight$
DECLARE
  jobs_oid regclass := to_regclass('public.jobs');
  status_type_oid oid;
BEGIN
  IF jobs_oid IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.events') IS NULL
     OR to_regclass('public.work_locations') IS NULL THEN
    RAISE EXCEPTION
      'Dependências ausentes: users, jobs, events e work_locations são obrigatórias.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = jobs_oid
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'RLS de jobs precisa estar habilitada antes desta migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = jobs_oid
      AND attname = 'value'
      AND attnum > 0
      AND NOT attisdropped
      AND atttypid = 'numeric'::regtype
      AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'Contrato incompatível: jobs.value deve ser numeric NOT NULL.';
  END IF;

  SELECT atttypid
  INTO status_type_oid
  FROM pg_catalog.pg_attribute
  WHERE attrelid = jobs_oid
    AND attname = 'status'
    AND attnum > 0
    AND NOT attisdropped
    AND attnotnull;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS types
    JOIN pg_catalog.pg_enum AS labels
      ON labels.enumtypid = types.oid
    WHERE types.oid = status_type_oid
      AND types.typtype = 'e'
      AND types.typname = 'job_status'
      AND labels.enumlabel = 'open'
  ) THEN
    RAISE EXCEPTION
      'Contrato incompatível: jobs.status deve utilizar o enum job_status com o valor open.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute
    WHERE attrelid = jobs_oid
      AND attname IN ('latitude', 'longitude')
      AND attnum > 0
      AND NOT attisdropped
      AND atttypid = 'double precision'::regtype
      AND NOT attnotnull
  ) <> 2 THEN
    RAISE EXCEPTION
      'Contrato incompatível: coordenadas legadas devem ser double precision e anuláveis.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = jobs_oid
      AND attname = 'created_at'
      AND attnum > 0
      AND NOT attisdropped
      AND atttypid = 'timestamp with time zone'::regtype
      AND attnotnull
  ) THEN
    RAISE EXCEPTION
      'Contrato incompatível: jobs.created_at deve ser timestamptz NOT NULL.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = jobs_oid
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Foram encontrados triggers em jobs. Revisar os efeitos antes de aplicar esta migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.events'::regclass
      AND attname = 'location_status'
      AND attnum > 0
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.events'::regclass
      AND attname = 'revision'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION
      'O contrato de snapshots de eventos da Fase 2 é obrigatório.';
  END IF;
END;
$preflight$;

ALTER TABLE public.jobs
  ADD COLUMN event_id uuid,
  ADD COLUMN work_location_id uuid,

  ADD COLUMN location_source text NOT NULL DEFAULT 'none',
  ADD COLUMN location_status text NOT NULL DEFAULT 'not_set',

  ADD COLUMN location_name text,
  ADD COLUMN work_address text,
  ADD COLUMN work_number text,
  ADD COLUMN work_neighborhood text,
  ADD COLUMN work_city text,
  ADD COLUMN work_state text,
  ADD COLUMN work_postal_code text,
  ADD COLUMN work_country_code text,

  ADD COLUMN work_latitude double precision,
  ADD COLUMN work_longitude double precision,

  ADD COLUMN location_snapshot_at timestamptz,
  ADD COLUMN location_source_version integer,
  ADD COLUMN location_event_revision integer,

  ADD CONSTRAINT jobs_event_snapshot_fk
    FOREIGN KEY (event_id)
    REFERENCES public.events(id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION,

  ADD CONSTRAINT jobs_work_location_snapshot_fk
    FOREIGN KEY (work_location_id)
    REFERENCES public.work_locations(id)
    ON UPDATE NO ACTION
    ON DELETE NO ACTION,

  ADD CONSTRAINT jobs_location_source_check
    CHECK (
      location_source IN ('none', 'catalog', 'event')
    ),

  ADD CONSTRAINT jobs_location_status_check
    CHECK (
      location_status IN (
        'not_set',
        'pending_coordinates',
        'ready'
      )
    ),

  ADD CONSTRAINT jobs_location_provenance_check
    CHECK (
      (
        location_source = 'none'
        AND location_status = 'not_set'
        AND event_id IS NULL
        AND work_location_id IS NULL
        AND location_snapshot_at IS NULL
        AND location_source_version IS NULL
        AND location_event_revision IS NULL
      )
      OR
      (
        location_source = 'catalog'
        AND location_status IN ('pending_coordinates', 'ready')
        AND event_id IS NULL
        AND work_location_id IS NOT NULL
        AND location_snapshot_at IS NOT NULL
        AND location_source_version IS NOT NULL
        AND location_source_version > 0
        AND location_event_revision IS NULL
      )
      OR
      (
        location_source = 'event'
        AND event_id IS NOT NULL
        AND location_snapshot_at IS NOT NULL
        AND location_event_revision IS NOT NULL
        AND location_event_revision > 0
        AND (
          (
            location_status = 'not_set'
            AND work_location_id IS NULL
            AND location_source_version IS NULL
          )
          OR
          (
            location_status IN ('pending_coordinates', 'ready')
            AND work_location_id IS NOT NULL
            AND location_source_version IS NOT NULL
            AND location_source_version > 0
          )
        )
      )
    ),

  ADD CONSTRAINT jobs_location_snapshot_check
    CHECK (
      (
        location_status = 'not_set'
        AND location_name IS NULL
        AND work_address IS NULL
        AND work_number IS NULL
        AND work_neighborhood IS NULL
        AND work_city IS NULL
        AND work_state IS NULL
        AND work_postal_code IS NULL
        AND work_country_code IS NULL
        AND work_latitude IS NULL
        AND work_longitude IS NULL
      )
      OR
      (
        location_status IN ('pending_coordinates', 'ready')

        AND location_name IS NOT NULL
        AND char_length(btrim(location_name)) BETWEEN 2 AND 160

        AND work_address IS NOT NULL
        AND char_length(btrim(work_address)) BETWEEN 3 AND 300

        AND work_number IS NOT NULL
        AND char_length(work_number) <= 30

        AND work_neighborhood IS NOT NULL
        AND char_length(work_neighborhood) <= 120

        AND work_city IS NOT NULL
        AND char_length(btrim(work_city)) BETWEEN 2 AND 120

        AND work_state IS NOT NULL
        AND work_state ~ '^[A-Z]{2}$'

        AND work_postal_code IS NOT NULL
        AND (
          work_postal_code = ''
          OR work_postal_code ~ '^[0-9]{8}$'
        )

        AND work_country_code IS NOT NULL
        AND work_country_code = 'BR'

        AND (
          (
            location_status = 'pending_coordinates'
            AND work_latitude IS NULL
            AND work_longitude IS NULL
          )
          OR
          (
            location_status = 'ready'
            AND work_latitude IS NOT NULL
            AND work_longitude IS NOT NULL
            AND work_latitude BETWEEN -90 AND 90
            AND work_longitude BETWEEN -180 AND 180
          )
        )
      )
    );

CREATE INDEX jobs_event_snapshot_idx
  ON public.jobs(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX jobs_work_location_snapshot_idx
  ON public.jobs(work_location_id)
  WHERE work_location_id IS NOT NULL;

REVOKE INSERT, UPDATE
ON TABLE public.jobs
FROM PUBLIC, anon, authenticated;

-- Grants por coluna não são eliminados pela revogação no nível da tabela.
DO $column_privileges$
DECLARE
  column_list text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', attname),
    ', ' ORDER BY attnum
  )
  INTO column_list
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.jobs'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF column_list IS NULL THEN
    RAISE EXCEPTION
      'Não foi possível identificar as colunas de jobs para revisar privilégios.';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s), UPDATE (%s) ON TABLE public.jobs FROM PUBLIC, anon, authenticated',
    column_list,
    column_list
  );
END;
$column_privileges$;

-- A leitura permanece sujeita às policies existentes de jobs.
GRANT SELECT (
  event_id,
  work_location_id,
  location_source,
  location_status,
  location_name,
  work_address,
  work_number,
  work_neighborhood,
  work_city,
  work_state,
  work_postal_code,
  work_country_code,
  work_latitude,
  work_longitude,
  location_snapshot_at,
  location_source_version,
  location_event_revision
)
ON TABLE public.jobs
TO authenticated;

CREATE FUNCTION public.create_restaurant_job(
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
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  owner_id uuid := auth.uid();
  source_location public.work_locations%ROWTYPE;
  source_event public.events%ROWTYPE;
  snapshot public.jobs%ROWTYPE;
  saved public.jobs%ROWTYPE;
BEGIN
  -- Mesma ordem inicial de locks das RPCs do catálogo e de eventos.
  PERFORM 1
  FROM public.users
  WHERE id = owner_id
    AND role = 'restaurant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Entre na conta do restaurante para criar uma vaga.'
      USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL
     OR p_description IS NULL
     OR p_job_date IS NULL
     OR p_start_time IS NULL
     OR p_end_time IS NULL
     OR p_value IS NULL THEN
    RAISE EXCEPTION
      'Informe título, descrição, data, horários e valor da vaga.'
      USING ERRCODE = '22023';
  END IF;

  IF p_value::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION
      'Informe um valor numérico finito.'
      USING ERRCODE = '22023';
  END IF;

  IF p_value <= 0 THEN
    RAISE EXCEPTION
      'O valor da vaga deve ser maior que zero.'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_source IS NULL
     OR p_location_source NOT IN ('none', 'catalog', 'event') THEN
    RAISE EXCEPTION
      'Origem de localização inválida.'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_source = 'none' THEN
    IF p_work_location_id IS NOT NULL
       OR p_location_revision IS NOT NULL
       OR p_event_id IS NOT NULL
       OR p_event_revision IS NOT NULL THEN
      RAISE EXCEPTION
        'Vaga sem origem de localização não deve receber dados de catálogo ou evento.'
        USING ERRCODE = '22023';
    END IF;

  ELSIF p_location_source = 'catalog' THEN
    IF p_work_location_id IS NULL
       OR p_location_revision IS NULL
       OR p_location_revision <= 0
       OR p_event_id IS NOT NULL
       OR p_event_revision IS NOT NULL THEN
      RAISE EXCEPTION
        'Informe somente o local do catálogo e sua revisão.'
        USING ERRCODE = '22023';
    END IF;

  ELSE
    IF p_event_id IS NULL
       OR p_event_revision IS NULL
       OR p_event_revision <= 0
       OR p_work_location_id IS NOT NULL
       OR p_location_revision IS NOT NULL THEN
      RAISE EXCEPTION
        'Informe somente o evento e sua revisão.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  snapshot.location_source := p_location_source;
  snapshot.location_status := 'not_set';

  IF p_location_source = 'catalog' THEN
    SELECT *
    INTO source_location
    FROM public.work_locations
    WHERE id = p_work_location_id
      AND restaurant_id = owner_id
      AND archived_at IS NULL
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Local indisponível. Selecione um local ativo do seu catálogo.'
        USING ERRCODE = '22023';
    END IF;

    IF p_location_revision IS DISTINCT FROM source_location.revision THEN
      RAISE EXCEPTION
        'O local foi atualizado. Atualize o catálogo e confira a seleção.'
        USING ERRCODE = '40001';
    END IF;

    snapshot.work_location_id := source_location.id;

    snapshot.location_name := source_location.name;
    snapshot.work_address := source_location.address;
    snapshot.work_number := source_location.number;
    snapshot.work_neighborhood := source_location.neighborhood;
    snapshot.work_city := source_location.city;
    snapshot.work_state := source_location.state;
    snapshot.work_postal_code := source_location.postal_code;
    snapshot.work_country_code := source_location.country_code;

    snapshot.work_latitude := source_location.latitude;
    snapshot.work_longitude := source_location.longitude;

    snapshot.location_status := CASE
      WHEN source_location.geocoding_status = 'resolved'
        THEN 'ready'
      ELSE 'pending_coordinates'
    END;

    snapshot.location_snapshot_at := now();
    snapshot.location_source_version := source_location.address_version;

  ELSIF p_location_source = 'event' THEN
    SELECT *
    INTO source_event
    FROM public.events
    WHERE id = p_event_id
      AND restaurant_id = owner_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Evento indisponível. Selecione um evento do seu restaurante.'
        USING ERRCODE = '22023';
    END IF;

    IF p_event_revision IS DISTINCT FROM source_event.revision THEN
      RAISE EXCEPTION
        'O evento foi atualizado. Atualize os eventos e confira a seleção.'
        USING ERRCODE = '40001';
    END IF;

    snapshot.event_id := source_event.id;
    snapshot.work_location_id := source_event.work_location_id;

    snapshot.location_name := source_event.location_name;
    snapshot.work_address := source_event.event_address;
    snapshot.work_number := source_event.event_number;
    snapshot.work_neighborhood := source_event.event_neighborhood;
    snapshot.work_city := source_event.event_city;
    snapshot.work_state := source_event.event_state;
    snapshot.work_postal_code := source_event.event_postal_code;
    snapshot.work_country_code := source_event.event_country_code;

    snapshot.work_latitude := source_event.event_latitude;
    snapshot.work_longitude := source_event.event_longitude;

    snapshot.location_status := source_event.location_status;
    snapshot.location_snapshot_at := now();
    snapshot.location_source_version := source_event.location_source_version;
    snapshot.location_event_revision := source_event.revision;

    -- Confere propriedade sem substituir o snapshot pelo endereço atual.
    -- Uma origem arquivada continua válida para herança do evento.
    IF snapshot.work_location_id IS NOT NULL THEN
      PERFORM 1
      FROM public.work_locations
      WHERE id = snapshot.work_location_id
        AND restaurant_id = owner_id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'A origem do local do evento está inconsistente. Solicite revisão.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.jobs (
    id,
    restaurant_id,
    title,
    description,
    job_date,
    start_time,
    end_time,
    value,
    status,
    created_at,

    latitude,
    longitude,

    event_id,
    work_location_id,
    location_source,
    location_status,

    location_name,
    work_address,
    work_number,
    work_neighborhood,
    work_city,
    work_state,
    work_postal_code,
    work_country_code,

    work_latitude,
    work_longitude,

    location_snapshot_at,
    location_source_version,
    location_event_revision
  )
  VALUES (
    gen_random_uuid(),
    owner_id,
    p_title,
    p_description,
    p_job_date,
    p_start_time,
    p_end_time,
    p_value,
    'open',
    now(),

    NULL,
    NULL,

    snapshot.event_id,
    snapshot.work_location_id,
    snapshot.location_source,
    snapshot.location_status,

    snapshot.location_name,
    snapshot.work_address,
    snapshot.work_number,
    snapshot.work_neighborhood,
    snapshot.work_city,
    snapshot.work_state,
    snapshot.work_postal_code,
    snapshot.work_country_code,

    snapshot.work_latitude,
    snapshot.work_longitude,

    snapshot.location_snapshot_at,
    snapshot.location_source_version,
    snapshot.location_event_revision
  )
  RETURNING * INTO saved;

  RETURN saved;
END;
$function$;

REVOKE ALL
ON FUNCTION public.create_restaurant_job(
  text,
  text,
  date,
  time,
  time,
  numeric,
  text,
  uuid,
  integer,
  uuid,
  integer
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_restaurant_job(
  text,
  text,
  date,
  time,
  time,
  numeric,
  text,
  uuid,
  integer,
  uuid,
  integer
)
TO authenticated;

-- Interrompe a aplicação se privilégios herdados mantiverem escrita direta.
DO $verify_privileges$
BEGIN
  IF has_any_column_privilege(
    'authenticated', 'public.jobs', 'INSERT'
  ) OR has_any_column_privilege(
    'authenticated', 'public.jobs', 'UPDATE'
  ) OR has_any_column_privilege(
    'anon', 'public.jobs', 'INSERT'
  ) OR has_any_column_privilege(
    'anon', 'public.jobs', 'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'Ainda existem privilégios efetivos de INSERT/UPDATE direto em jobs. Revisar grants e papéis herdados.';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.create_restaurant_job(text,text,date,time,time,numeric,text,uuid,integer,uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'O papel anon ainda possui EXECUTE efetivo em create_restaurant_job.';
  END IF;
END;
$verify_privileges$;

COMMIT;

NOTIFY pgrst, 'reload schema';
