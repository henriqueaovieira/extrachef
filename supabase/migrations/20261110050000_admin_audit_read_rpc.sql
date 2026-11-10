BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE FUNCTION public.list_admin_audit_log(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  action text,
  entity_type text,
  entity_id uuid,
  actor_user_id uuid,
  target_user_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101
    OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
    OR (p_cursor_created_at IS NOT NULL AND NOT isfinite(p_cursor_created_at))
    OR (p_action IS NOT NULL AND p_action NOT IN ('staff.granted', 'staff.role_changed', 'staff.revoked'))
    OR (p_from IS NOT NULL AND NOT isfinite(p_from))
    OR (p_to IS NOT NULL AND NOT isfinite(p_to))
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to) THEN
    RAISE EXCEPTION 'Invalid audit query.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    audit.id,
    audit.created_at,
    audit.action,
    audit.entity_type,
    audit.entity_id,
    audit.actor_user_id,
    audit.target_user_id
  FROM private.admin_audit_log AS audit
  WHERE (p_cursor_created_at IS NULL
      OR (audit.created_at, audit.id) < (p_cursor_created_at, p_cursor_id))
    AND (p_actor_user_id IS NULL OR audit.actor_user_id = p_actor_user_id)
    AND (p_target_user_id IS NULL OR audit.target_user_id = p_target_user_id)
    AND (p_action IS NULL OR audit.action = p_action)
    AND (p_from IS NULL OR audit.created_at >= p_from)
    AND (p_to IS NULL OR audit.created_at < p_to)
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_admin_audit_log(
  integer, timestamptz, uuid, uuid, uuid, text, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_admin_audit_log(
  integer, timestamptz, uuid, uuid, uuid, text, timestamptz, timestamptz
) TO authenticated;

COMMIT;
