BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE FUNCTION private.assert_admin_preservation(
  p_current_role private.staff_role,
  p_current_status private.staff_status,
  p_next_role private.staff_role,
  p_next_status private.staff_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  active_admin_count bigint;
BEGIN
  IF p_current_role = 'admin'::private.staff_role
    AND p_current_status = 'active'::private.staff_status
    AND (
      p_next_role IS DISTINCT FROM 'admin'::private.staff_role
      OR p_next_status IS DISTINCT FROM 'active'::private.staff_status
    ) THEN
    SELECT count(*)
    INTO active_admin_count
    FROM private.staff_members AS member
    WHERE member.staff_role = 'admin'
      AND member.status = 'active';

    IF active_admin_count <= 1 THEN
      RAISE EXCEPTION 'The last active admin cannot be removed or downgraded.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION private.assert_admin_preservation(
  private.staff_role, private.staff_status, private.staff_role, private.staff_status
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_staff_role(p_user_id uuid, p_staff_role text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id uuid := auth.uid();
  requested_role private.staff_role;
  previous_data jsonb;
  next_data jsonb;
  existing_role private.staff_role;
  existing_status private.staff_status;
  target_exists boolean;
BEGIN
  IF actor_id IS NULL OR NOT private.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid staff target.' USING ERRCODE = '22023';
  END IF;
  IF p_staff_role IS NULL OR p_staff_role NOT IN ('admin', 'reviewer', 'support') THEN
    RAISE EXCEPTION 'Invalid staff role.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'A reason of up to 500 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_user_id) THEN
    RAISE EXCEPTION 'Auth user not found.' USING ERRCODE = 'P0002';
  END IF;

  requested_role := p_staff_role::private.staff_role;
  LOCK TABLE private.staff_members IN EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1
    FROM private.staff_members AS actor
    WHERE actor.user_id = actor_id
      AND actor.staff_role = 'admin'
      AND actor.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  SELECT member.staff_role, member.status
  INTO existing_role, existing_status
  FROM private.staff_members AS member
  WHERE member.user_id = p_user_id
  FOR UPDATE;
  target_exists := FOUND;

  IF target_exists AND existing_status = 'active' AND existing_role = requested_role THEN
    RAISE EXCEPTION 'User already has this active staff role.' USING ERRCODE = '23505';
  END IF;

  IF target_exists THEN
    PERFORM private.assert_admin_preservation(
      existing_role,
      existing_status,
      requested_role,
      'active'::private.staff_status
    );

    previous_data := jsonb_build_object('role', existing_role::text, 'status', existing_status::text);
    UPDATE private.staff_members
    SET staff_role = requested_role,
        status = 'active',
        granted_by = actor_id,
        granted_at = clock_timestamp(),
        revoked_by = NULL,
        revoked_at = NULL,
        reason = btrim(p_reason),
        updated_at = clock_timestamp()
    WHERE user_id = p_user_id;
  ELSE
    INSERT INTO private.staff_members (user_id, staff_role, status, granted_by, reason)
    VALUES (p_user_id, requested_role, 'active', actor_id, btrim(p_reason));
  END IF;

  next_data := jsonb_build_object('role', requested_role::text, 'status', 'active');
  INSERT INTO private.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  )
  VALUES (
    actor_id, p_user_id,
    CASE WHEN previous_data IS NULL THEN 'staff.granted' ELSE 'staff.role_changed' END,
    'staff_members', p_user_id, btrim(p_reason), previous_data, next_data
  );

  RETURN next_data;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_staff_role(p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id uuid := auth.uid();
  target_staff_role private.staff_role;
  current_status private.staff_status;
  previous_data jsonb;
  next_data jsonb;
BEGIN
  IF actor_id IS NULL OR NOT private.is_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id = actor_id THEN
    RAISE EXCEPTION 'Invalid staff target.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'A reason of up to 500 characters is required.' USING ERRCODE = '22023';
  END IF;

  LOCK TABLE private.staff_members IN EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1
    FROM private.staff_members AS actor
    WHERE actor.user_id = actor_id
      AND actor.staff_role = 'admin'
      AND actor.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  SELECT member.staff_role, member.status
  INTO target_staff_role, current_status
  FROM private.staff_members AS member
  WHERE member.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_status <> 'active' THEN
    RAISE EXCEPTION 'Active staff member not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM private.assert_admin_preservation(
    target_staff_role,
    current_status,
    target_staff_role,
    'revoked'::private.staff_status
  );

  previous_data := jsonb_build_object('role', target_staff_role::text, 'status', current_status::text);
  UPDATE private.staff_members
  SET status = 'revoked',
      revoked_by = actor_id,
      revoked_at = clock_timestamp(),
      reason = btrim(p_reason),
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id;

  next_data := jsonb_build_object('role', target_staff_role::text, 'status', 'revoked');
  INSERT INTO private.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id, reason, old_data, new_data
  )
  VALUES (
    actor_id, p_user_id, 'staff.revoked', 'staff_members', p_user_id,
    btrim(p_reason), previous_data, next_data
  );

  RETURN next_data;
END;
$fn$;

COMMIT;
