import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('staff membership is isolated from marketplace roles and audited transactionally', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    INSERT INTO auth.users (id, email) VALUES
      ('${id(1)}', 'admin@example.test'),
      ('${id(2)}', 'reviewer@example.test'),
      ('${id(3)}', 'support@example.test'),
      ('${id(4)}', 'worker@example.test'),
      ('${id(5)}', 'restaurant@example.test'),
      ('${id(6)}', 'unassigned@example.test'),
      ('${id(7)}', 'disabled-admin@example.test'),
      ('${id(8)}', 'revoked-admin@example.test');
  `);
  for (const migration of [
    '20261110010000_staff_foundation.sql',
    '20261110020000_admin_audit_log.sql',
    '20261110030000_staff_functions.sql',
    '20261110040000_admin_preservation.sql',
    '20261110050000_admin_audit_read_rpc.sql',
  ]) await db.exec(source(migration));

  await db.exec(`
    INSERT INTO private.staff_members (user_id, staff_role, reason)
    VALUES     ('${id(1)}', 'admin', 'Initial isolated test fixture'),
    ('${id(2)}', 'reviewer', 'Initial isolated test fixture'),
    ('${id(3)}', 'support', 'Initial isolated test fixture');
  `);

  const login = async (userId, role = 'authenticated') => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
    await db.exec(`SET ROLE ${role}`);
  };
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const events = () => db.query('SELECT action, actor_user_id, target_user_id FROM private.admin_audit_log ORDER BY created_at, id');

  await t.test('only active staff membership authorizes the corresponding role', async () => {
    for (const [userId, expected] of [
      [id(1), ['admin', true, true, false, false]],
      [id(2), ['reviewer', true, false, true, false]],
      [id(3), ['support', true, false, false, true]],
      [id(4), [null, false, false, false, false]],
      [id(5), [null, false, false, false, false]],
    ]) {
      await login(userId);
      assert.deepEqual([
        (await db.query('SELECT public.get_staff_membership() AS value')).rows[0].value?.role ?? null,
        await scalar('SELECT public.is_staff()'),
        await scalar('SELECT public.is_admin()'),
        await scalar('SELECT public.is_reviewer()'),
        await scalar('SELECT public.is_support()'),
      ], expected);
    }
  });

  await t.test('staff table and audit log are not directly reachable through application roles', async () => {
    await login(id(1));
    await assert.rejects(db.query('SELECT * FROM private.staff_members'), /permission denied for schema private/);
    await assert.rejects(db.query('SELECT * FROM private.admin_audit_log'), /permission denied for schema private/);
    const listed = await db.query('SELECT * FROM public.list_staff_members()');
    assert.equal(listed.rows.length, 3);
    assert.equal(Object.hasOwn(listed.rows[0], 'email'), false);
  });

  await t.test('only Admin can grant memberships, and grant/revoke events capture auth.uid', async () => {
    await login(id(1));
    const granted = await db.query(
      'SELECT public.grant_staff_role($1, $2, $3) AS value',
      [id(4), 'support', 'Onboarding support operator'],
    );
    assert.deepEqual(granted.rows[0].value, { role: 'support', status: 'active' });
    await assert.rejects(
      db.query('SELECT public.grant_staff_role($1, $2, $3)', [id(1), 'admin', 'Self grant']),
      /Invalid staff target/,
    );
    await assert.rejects(
      db.query('SELECT public.grant_staff_role($1, $2, $3)', [id(5), 'owner', 'Invalid role']),
      /Invalid staff role/,
    );

    await login(id(2));
    await assert.rejects(
      db.query('SELECT public.grant_staff_role($1, $2, $3)', [id(5), 'support', 'Unauthorized grant']),
      /Admin access required/,
    );
    await login(id(3));
    await assert.rejects(
      db.query('SELECT public.revoke_staff_role($1, $2)', [id(4), 'Unauthorized revoke']),
      /Admin access required/,
    );
    await login(id(4));
    assert.equal((await db.query('SELECT public.get_staff_membership() AS value')).rows[0].value.role, 'support');

    await login(id(1));
    await db.query('SELECT public.revoke_staff_role($1, $2)', [id(4), 'Access no longer required']);
    await db.exec('RESET ROLE');
    const log = await events();
    assert.deepEqual(log.rows.map((row) => [row.action, row.actor_user_id, row.target_user_id]), [
      ['staff.granted', id(1), id(4)],
      ['staff.revoked', id(1), id(4)],
    ]);
  });

  await t.test('last active administrator cannot be removed and audit history is append-only', async () => {
    await login(id(1));
    await assert.rejects(
      db.query('SELECT public.revoke_staff_role($1, $2)', [id(1), 'Self revoke']),
      /Invalid staff target/,
    );
    await db.exec('RESET ROLE');
    await assert.rejects(
      db.query("UPDATE private.admin_audit_log SET reason = 'tampered'"),
      /Admin audit events are append-only/,
    );
    await assert.rejects(db.query('DELETE FROM private.admin_audit_log'), /Admin audit events are append-only/);
  });

  await t.test('Admin Preservation blocks last-admin transitions and revalidates the actor', async () => {
    const expectPreservationConflict = async (nextRole, nextStatus) => {
      await assert.rejects(
        db.query(
          "SELECT private.assert_admin_preservation('admin', 'active', $1::private.staff_role, $2::private.staff_status)",
          [nextRole, nextStatus],
        ),
        (error) => error.code === '23514',
      );
    };

    await db.exec('RESET ROLE');
    await expectPreservationConflict('reviewer', 'active');
    await expectPreservationConflict('admin', 'revoked');
    const adminCount = async () => Number(await scalar(
      "SELECT count(*) FROM private.staff_members WHERE staff_role = 'admin' AND status = 'active'",
    ));
    assert.equal(await adminCount(), 1);

    await login(id(1));
    await db.query(
      'SELECT public.grant_staff_role($1, $2, $3)',
      [id(5), 'admin', 'Add second administrator'],
    );
    await db.query(
      'SELECT public.grant_staff_role($1, $2, $3)',
      [id(5), 'reviewer', 'Downgrade while another administrator remains'],
    );
    await db.exec('RESET ROLE');
    assert.equal(await adminCount(), 1);

    await login(id(5));
    await assert.rejects(
      db.query(
        'SELECT public.grant_staff_role($1, $2, $3)',
        [id(4), 'support', 'Former administrator must be denied'],
      ),
      /Admin access required/,
    );

    await login(id(1));
    await db.query(
      'SELECT public.grant_staff_role($1, $2, $3)',
      [id(5), 'admin', 'Restore second administrator'],
    );
    await db.query(
      'SELECT public.revoke_staff_role($1, $2)',
      [id(5), 'Revoke while another administrator remains'],
    );
    await db.exec('RESET ROLE');
    assert.equal(await adminCount(), 1);
  });

  await t.test('audit read RPC exposes only the intended contract and grants authenticated only', async () => {
    const functionInfo = await db.query(`
      SELECT p.proargnames, p.pronargs, p.prorettype::regtype::text AS return_type,
        p.provolatile, p.prosecdef, p.proconfig,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
        EXISTS (
          SELECT 1 FROM aclexplode(p.proacl) AS grant_entry
          WHERE grant_entry.grantee = 0 AND grant_entry.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'public.list_admin_audit_log(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)'::regprocedure
    `);
    const rpc = functionInfo.rows[0];
    assert.equal(rpc.pronargs, 8);
    assert.deepEqual(rpc.proargnames.slice(0, 8), [
      'p_limit', 'p_cursor_created_at', 'p_cursor_id', 'p_actor_user_id',
      'p_target_user_id', 'p_action', 'p_from', 'p_to',
    ]);
    assert.deepEqual(rpc.proargnames.slice(8), [
      'id', 'created_at', 'action', 'entity_type', 'entity_id', 'actor_user_id', 'target_user_id',
    ]);
    assert.equal(rpc.return_type, 'record');
    assert.equal(rpc.provolatile, 's');
    assert.equal(rpc.prosecdef, true);
    assert.deepEqual(rpc.proconfig, ['search_path=""']);
    assert.equal(rpc.authenticated_execute, true);
    assert.equal(rpc.anon_execute, false);
    assert.equal(rpc.service_role_execute, false);
    assert.equal(rpc.public_execute, false);

    await login(id(1));
    await assert.rejects(db.query('SELECT * FROM private.admin_audit_log'), /permission denied for schema private/);
  });

  await t.test('audit read RPC enforces active Admin authorization, including direct calls', async () => {
    await db.exec('RESET ROLE');
    await db.exec(`
      INSERT INTO private.staff_members (user_id, staff_role, reason, status)
      VALUES ('${id(7)}', 'admin', 'Disabled test fixture', 'disabled');
      INSERT INTO private.staff_members (
        user_id, staff_role, reason, status, revoked_by, revoked_at
      ) VALUES (
        '${id(8)}', 'admin', 'Revoked test fixture', 'revoked', '${id(1)}', clock_timestamp()
      );
    `);

    await login(id(1));
    assert.equal((await db.query(
      'SELECT count(*)::integer AS count FROM public.list_admin_audit_log(1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)',
    )).rows[0].count, 1);

    for (const [userId, role] of [
      [null, 'authenticated'],
      [id(2), 'authenticated'],
      [id(3), 'authenticated'],
      [id(6), 'authenticated'],
      [id(7), 'authenticated'],
      [id(8), 'authenticated'],
    ]) {
      await login(userId, role);
      await assert.rejects(
        db.query('SELECT * FROM public.list_admin_audit_log(1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)'),
        (error) => error.code === '42501',
      );
    }

    await login(null, 'anon');
    await assert.rejects(
      db.query('SELECT * FROM public.list_admin_audit_log(1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)'),
      /permission denied for function/,
    );
    await login(null, 'service_role');
    await assert.rejects(
      db.query('SELECT * FROM public.list_admin_audit_log(1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)'),
      /permission denied for function/,
    );
  });

  await t.test('audit read RPC filters, projects and paginates with a stable keyset order', async () => {
    await db.exec('RESET ROLE');
    await db.exec(`
      INSERT INTO private.admin_audit_log (
        id, actor_user_id, target_user_id, action, entity_type, entity_id, reason, created_at
      ) VALUES
        ('${id(10)}', '${id(1)}', '${id(2)}', 'staff.granted', 'staff_members', '${id(2)}', 'fixture 10', '2026-02-01 10:00:00.000002+00'),
        ('${id(11)}', '${id(2)}', '${id(1)}', 'staff.role_changed', 'staff_members', '${id(1)}', 'fixture 11', '2026-02-01 10:00:00.000002+00'),
        ('${id(12)}', NULL, NULL, 'staff.revoked', 'staff_members', NULL, 'fixture 12', '2026-02-01 10:00:00.000002+00'),
        ('${id(13)}', '${id(1)}', NULL, 'legacy.custom', 'legacy_entity', NULL, 'fixture 13', '2026-02-01 09:59:59.999999+00');
    `);
    await login(id(1));

    const pageOne = await db.query(
      'SELECT * FROM public.list_admin_audit_log(2, NULL, NULL, NULL, NULL, NULL, $1, $2)',
      ['2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(pageOne.rows.map((row) => row.id), [id(12), id(11)]);
    assert.deepEqual(Object.keys(pageOne.rows[0]).sort(), [
      'action', 'actor_user_id', 'created_at', 'entity_id', 'entity_type', 'id', 'target_user_id',
    ]);
    assert.equal(Object.hasOwn(pageOne.rows[0], 'reason'), false);
    assert.equal(pageOne.rows[0].actor_user_id, null);
    assert.equal(pageOne.rows[0].target_user_id, null);

    const pageTwo = await db.query(
      'SELECT * FROM public.list_admin_audit_log($1, $2, $3, NULL, NULL, NULL, $4, $5)',
      [2, '2026-02-01 10:00:00.000002+00', pageOne.rows[1].id, '2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(pageTwo.rows.map((row) => row.id), [id(10), id(13)]);

    const combinedFilter = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, $1, $2, $3, $4, $5)',
      [id(1), id(2), 'staff.granted', '2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(combinedFilter.rows.map((row) => row.id), [id(10)]);

    const dateWindow = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, NULL, NULL, NULL, $1, $2)',
      ['2026-02-01 10:00:00.000002+00', '2026-02-01 10:00:00.000003+00'],
    );
    assert.deepEqual(dateWindow.rows.map((row) => row.id), [id(12), id(11), id(10)]);

    const upperBoundExcluded = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, NULL, NULL, NULL, NULL, $1)',
      ['2026-02-01 10:00:00.000002+00'],
    );
    assert.deepEqual(upperBoundExcluded.rows.map((row) => row.id), [id(13)]);

    const actorFilter = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, $1, NULL, NULL, $2, $3)',
      [id(2), '2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(actorFilter.rows.map((row) => row.id), [id(11)]);

    const targetFilter = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, NULL, $1, NULL, $2, $3)',
      [id(2), '2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(targetFilter.rows.map((row) => row.id), [id(10)]);

    const actionFilter = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, NULL, NULL, $1, $2, $3)',
      ['staff.revoked', '2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.deepEqual(actionFilter.rows.map((row) => row.id), [id(12)]);

    const unknownActionRemainsVisible = await db.query(
      'SELECT id FROM public.list_admin_audit_log(101, NULL, NULL, NULL, NULL, NULL, $1, $2)',
      ['2026-02-01 09:00:00+00', '2026-02-02 00:00:00+00'],
    );
    assert.equal(unknownActionRemainsVisible.rows.some((row) => row.id === id(13)), true);
  });

  await t.test('audit read RPC rejects invalid limits, filters, ranges, and partial cursors', async () => {
    await login(id(1));
    for (const args of [
      [null, null, null, null, null, null, null, null],
      [0, null, null, null, null, null, null, null],
      [102, null, null, null, null, null, null, null],
      [1, null, null, null, null, 'legacy.custom', null, null],
      [1, null, null, null, null, null, '2026-02-02T00:00:00Z', '2026-02-01T00:00:00Z'],
      [1, '2026-02-01T00:00:00Z', null, null, null, null, null, null],
      [1, null, id(10), null, null, null, null, null],
    ]) {
      await assert.rejects(
        db.query(
          'SELECT * FROM public.list_admin_audit_log($1, $2, $3, $4, $5, $6, $7, $8)',
          args,
        ),
        (error) => error.code === '22023',
      );
    }
  });

  await t.test('anonymous callers cannot execute staff functions', async () => {
    await login(null, 'anon');
    await assert.rejects(db.query('SELECT public.get_staff_membership()'), /permission denied for function/);
    await assert.rejects(db.query('SELECT public.grant_staff_role($1, $2, $3)', [id(4), 'admin', 'No access']), /permission denied for function/);
  });
});
