import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261018020000_talent_interest.sql', import.meta.url), 'utf8');
const restoreMigration = readFileSync(new URL('../supabase/migrations/20261104090000_restore_talent_interest.sql', import.meta.url), 'utf8');
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

test('interest and favorite are exclusive and interest requires no completed work', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE users(id uuid PRIMARY KEY, role text, deleted_at timestamptz);
    CREATE TABLE jobs(id uuid PRIMARY KEY, restaurant_id uuid);
    CREATE TABLE applications(id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text);
    CREATE TABLE talent_connections(
      restaurant_id uuid, worker_id uuid, category text,
      PRIMARY KEY(restaurant_id, worker_id, category),
      CONSTRAINT talent_connections_category_check CHECK (category IN ('contact','known','favorite','partner'))
    );
    INSERT INTO users VALUES ('${id(1)}','restaurant',NULL),('${id(2)}','worker',NULL),('${id(3)}','worker',NULL);
    INSERT INTO jobs VALUES ('${id(10)}','${id(1)}');
    INSERT INTO applications VALUES ('${id(20)}','${id(10)}','${id(3)}','completed');
  `);
  await db.exec(migration);
  await db.exec(`
    INSERT INTO talent_connections VALUES
      ('${id(1)}','${id(2)}','contact'),
      ('${id(1)}','${id(2)}','known'),
      ('${id(1)}','${id(2)}','partner');
  `);
  await db.exec(restoreMigration);
  const functionDefinition = await db.query(
    "SELECT pg_get_functiondef('public.set_talent_connection(uuid,text,boolean)'::regprocedure) AS definition",
  );
  assert.match(functionDefinition.rows[0].definition, /'interest'/);
  const constraintDefinition = await db.query(`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'public.talent_connections'::regclass
      AND conname = 'talent_connections_category_check'
  `);
  assert.equal(constraintDefinition.rows.length, 1);
  assert.match(constraintDefinition.rows[0].definition, /'interest'/);
  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; SET request.jwt.claim.sub='${id(1)}'; SET ROLE authenticated;`);
  const categories = async (worker) => (await db.query(
    'SELECT category FROM public.talent_connections WHERE worker_id=$1 ORDER BY category', [worker],
  )).rows.map((row) => row.category);

  assert.deepEqual(await categories(id(2)), ['contact', 'known', 'partner']);
  await db.query("SELECT public.set_talent_connection($1,'interest',true)", [id(2)]);
  assert.deepEqual(await categories(id(2)), ['contact', 'interest', 'known', 'partner']);
  for (const category of ['contact', 'known', 'partner']) {
    await db.query('SELECT public.set_talent_connection($1,$2,false)', [id(2), category]);
  }
  await db.query("SELECT public.set_talent_connection($1,'interest',true)", [id(2)]);
  assert.deepEqual(await categories(id(2)), ['interest']);
  await db.query("SELECT public.set_talent_connection($1,'favorite',true)", [id(2)]);
  assert.deepEqual(await categories(id(2)), ['favorite']);
  await db.query("SELECT public.set_talent_connection($1,'interest',true)", [id(2)]);
  assert.deepEqual(await categories(id(2)), ['interest']);
  await db.query("SELECT public.set_talent_connection($1,'interest',false)", [id(2)]);
  assert.deepEqual(await categories(id(2)), []);

  await assert.rejects(
    db.query("SELECT public.set_talent_connection($1,'interest',true)", [id(3)]),
    /já trabalhou com você/,
  );
  await db.query("SELECT public.set_talent_connection($1,'favorite',true)", [id(3)]);
  assert.deepEqual(await categories(id(3)), ['favorite']);
});
