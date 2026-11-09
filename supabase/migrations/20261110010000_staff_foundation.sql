BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Missing auth.users; staff foundation cannot be installed.';
  END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TYPE private.staff_role AS ENUM ('admin', 'reviewer', 'support');
CREATE TYPE private.staff_status AS ENUM ('active', 'disabled', 'revoked');

CREATE TABLE private.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  staff_role private.staff_role NOT NULL,
  status private.staff_status NOT NULL DEFAULT 'active',
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by uuid,
  revoked_at timestamptz,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT staff_members_revocation_state_check CHECK (
    (status = 'revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_by IS NULL AND revoked_at IS NULL)
  )
);

CREATE INDEX staff_members_role_idx ON private.staff_members (staff_role);
CREATE INDEX staff_members_status_idx ON private.staff_members (status);

ALTER TABLE private.staff_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.staff_members FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
