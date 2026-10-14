ALTER TYPE public.application_status
  ADD VALUE IF NOT EXISTS 'completed';

DO $job_status_enum$
DECLARE
  status_schema text;
  status_type text;
BEGIN
  SELECT namespaces.nspname, types.typname
  INTO status_schema, status_type
  FROM pg_catalog.pg_attribute AS attributes
  JOIN pg_catalog.pg_type AS types ON types.oid = attributes.atttypid
  JOIN pg_catalog.pg_namespace AS namespaces ON namespaces.oid = types.typnamespace
  WHERE attributes.attrelid = 'public.jobs'::regclass
    AND attributes.attname = 'status'
    AND NOT attributes.attisdropped
    AND types.typtype = 'e';

  IF FOUND THEN
    EXECUTE format(
      'ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',
      status_schema,
      status_type,
      'completed'
    );
  END IF;
END;
$job_status_enum$;