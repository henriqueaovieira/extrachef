BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE private.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  target_user_id uuid,
  action text NOT NULL CHECK (btrim(action) <> ''),
  entity_type text NOT NULL CHECK (btrim(entity_type) <> ''),
  entity_id uuid,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX admin_audit_log_created_at_idx
  ON private.admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_log_actor_created_at_idx
  ON private.admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX admin_audit_log_target_created_at_idx
  ON private.admin_audit_log (target_user_id, created_at DESC);

ALTER TABLE private.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.admin_audit_log FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.prevent_admin_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'Admin audit events are append-only.' USING ERRCODE = '42501';
END;
$fn$;

REVOKE ALL ON FUNCTION private.prevent_admin_audit_log_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON private.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION private.prevent_admin_audit_log_mutation();

COMMIT;
