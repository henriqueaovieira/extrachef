BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE FUNCTION private.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.staff_members AS member
    WHERE member.user_id = auth.uid()
      AND member.status = 'active'
  );
$fn$;

CREATE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.staff_members AS member
    WHERE member.user_id = auth.uid()
      AND member.staff_role = 'admin'
      AND member.status = 'active'
  );
$fn$;

CREATE FUNCTION private.is_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.staff_members AS member
    WHERE member.user_id = auth.uid()
      AND member.staff_role = 'reviewer'
      AND member.status = 'active'
  );
$fn$;

CREATE FUNCTION private.is_support()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.staff_members AS member
    WHERE member.user_id = auth.uid()
      AND member.staff_role = 'support'
      AND member.status = 'active'
  );
$fn$;

CREATE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT private.is_staff();
$fn$;

CREATE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT private.is_admin();
$fn$;

CREATE FUNCTION public.is_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT private.is_reviewer();
$fn$;

CREATE FUNCTION public.is_support()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT private.is_support();
$fn$;

CREATE FUNCTION public.get_staff_membership()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'role', member.staff_role::text,
    'status', member.status::text
  )
  FROM private.staff_members AS member
  WHERE member.user_id = auth.uid();
$fn$;

CREATE FUNCTION public.list_staff_members(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  staff_role text,
  status text,
  granted_at timestamptz,
  revoked_at timestamptz
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
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
    OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid pagination.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT member.id, member.user_id, member.staff_role::text, member.status::text,
    member.granted_at, member.revoked_at
  FROM private.staff_members AS member
  ORDER BY member.created_at DESC, member.id
  LIMIT p_limit OFFSET p_offset;
END;
$fn$;

CREATE FUNCTION public.grant_staff_role(p_user_id uuid, p_staff_role text, p_reason text)
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

  SELECT member.staff_role, member.status
  INTO existing_role, existing_status
  FROM private.staff_members AS member
  WHERE member.user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND existing_status = 'active' AND existing_role = requested_role THEN
    RAISE EXCEPTION 'User already has this active staff role.' USING ERRCODE = '23505';
  END IF;

  IF FOUND THEN
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

CREATE FUNCTION public.revoke_staff_role(p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  actor_id uuid := auth.uid();
  current_role private.staff_role;
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

  SELECT member.staff_role, member.status
  INTO current_role, current_status
  FROM private.staff_members AS member
  WHERE member.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_status <> 'active' THEN
    RAISE EXCEPTION 'Active staff member not found.' USING ERRCODE = 'P0002';
  END IF;

  IF current_role = 'admin' AND (
    SELECT count(*) FROM private.staff_members AS member
    WHERE member.staff_role = 'admin' AND member.status = 'active'
  ) <= 1 THEN
    RAISE EXCEPTION 'The last active admin cannot be revoked.' USING ERRCODE = '23514';
  END IF;

  previous_data := jsonb_build_object('role', current_role::text, 'status', current_status::text);
  UPDATE private.staff_members
  SET status = 'revoked',
      revoked_by = actor_id,
      revoked_at = clock_timestamp(),
      reason = btrim(p_reason),
      updated_at = clock_timestamp()
  WHERE user_id = p_user_id;

  next_data := jsonb_build_object('role', current_role::text, 'status', 'revoked');
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

CREATE POLICY staff_members_admin_select
  ON private.staff_members FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY staff_members_admin_insert
  ON private.staff_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY staff_members_admin_update
  ON private.staff_members FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_reviewer() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_support() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_reviewer() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_support() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_staff_membership() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_staff_members(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_staff_role(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_staff_role(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_reviewer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_support() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff_members(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_staff_role(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_role(uuid, text) TO authenticated;

COMMIT;
