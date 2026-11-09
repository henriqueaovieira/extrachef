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
      ('${id(5)}', 'restaurant@example.test');
  `);
  for (const migration of [
    '20261110010000_staff_foundation.sql',
    '20261110020000_admin_audit_log.sql',
    '20261110030000_staff_functions.sql',
  ]) await db.exec(source(migration));

  await db.exec(`
    INSERT INTO private.staff_members (user_id, staff_role, reason)
    VALUES ('${id(1)}', 'admin', 'Initial isolated test fixture'),
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

  await t.test('anonymous callers cannot execute staff functions', async () => {
    await login(null, 'anon');
    await assert.rejects(db.query('SELECT public.get_staff_membership()'), /permission denied for function/);
    await assert.rejects(db.query('SELECT public.grant_staff_role($1, $2, $3)', [id(4), 'admin', 'No access']), /permission denied for function/);
  });
});
