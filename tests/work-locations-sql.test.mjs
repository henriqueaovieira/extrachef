import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
test('independent catalog migration enforces isolation, CRUD, defaults, revision and geocoding state', {
  skip: !process.env.PGLITE_MODULE && 'Set PGLITE_MODULE to run the isolated PostgreSQL test.',
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.users(id uuid PRIMARY KEY, role text);
    INSERT INTO public.users VALUES ('${id(1)}','restaurant'),('${id(2)}','restaurant'),('${id(3)}','worker');
    GRANT SELECT(id,role) ON public.users TO authenticated;
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261015060000_work_locations_catalog.sql', import.meta.url), 'utf8'));
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const login = async (user) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${user ? id(user) : ''}'; SET ROLE authenticated;`);
  const get = async (location) => (await query('SELECT * FROM public.work_locations WHERE id=$1', [location]))[0];
  const save = async (location = null, revision = null, changes = {}) => {
    const fields = { name: 'Hotel Fazenda', address: 'Rodovia SP-304 km 20', number: 's/n',
      neighborhood: '', city: 'Piracicaba', state: 'sp', postal: '', ...changes };
    return (await query('SELECT * FROM public.save_work_location($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [...Object.values(fields), location, revision]))[0];
  };
  const action = async (location, operation, revision) => query(
    'SELECT public.manage_work_location($1,$2,$3)', [location, operation, revision],
  );
  await login(null);
  await assert.rejects(save(), /conta do restaurante/);
  await login(3);
  await assert.rejects(save(), /conta do restaurante/);
  assert.deepEqual(await query('SELECT * FROM public.work_locations'), []);
  await login(1);
  const a = await save();
  const b = await save(null, null, { name: 'Salão' });
  assert.equal(a.geocoding_status, 'pending');
  assert.equal(a.latitude, null);
  assert.equal(a.longitude, null);
  assert.equal(a.postal_code, '');
  assert.equal(a.is_default, false);
  assert.equal(a.state, 'SP');
  await assert.rejects(save(null, null, { postal: '123' }), /check constraint/);
  await assert.rejects(save(null, null, { name: '' }), /check constraint/);
  await assert.rejects(query("INSERT INTO public.work_locations(restaurant_id,name,address,city,state) VALUES ($1,'Aaa','Rua A','Cidade','SP')", [id(1)]), /permission denied/);
  await assert.rejects(query("UPDATE public.work_locations SET geocoding_status='resolved' WHERE id=$1", [a.id]), /permission denied/);
  await assert.rejects(query('DELETE FROM public.work_locations WHERE id=$1', [a.id]), /permission denied/);
  await action(a.id, 'set_default', a.revision);
  assert.equal((await get(a.id)).is_default, true);
  await action(b.id, 'set_default', b.revision);
  assert.equal((await get(a.id)).is_default, false);
  assert.equal((await get(b.id)).is_default, true);
  await db.exec('RESET ROLE');
  await assert.rejects(query('UPDATE public.work_locations SET is_default=true WHERE id=$1', [a.id]), /unique constraint/);
  await assert.rejects(query("UPDATE public.work_locations SET geocoding_status='resolved' WHERE id=$1", [a.id]), /check constraint/);
  await assert.rejects(query('UPDATE public.work_locations SET latitude=0 WHERE id=$1', [a.id]), /check constraint/);
  await login(1);
  await assert.rejects(save(a.id, a.revision), /outra sessão/);
  await assert.rejects(action(b.id, 'archive', b.revision), /outra sessão/);
  await login(2);
  assert.deepEqual(await query('SELECT * FROM public.work_locations'), []);
  await assert.rejects(save(a.id, 1), /não encontrado/);
  for (const operation of ['set_default', 'archive', 'delete', 'restore']) {
    await assert.rejects(action(a.id, operation, 1), /não encontrado/);
  }
  const other = await save();
  await action(other.id, 'set_default', other.revision);
  await login(1);
  assert.equal((await get(b.id)).is_default, true);

  const activeB = await get(b.id);
  await assert.rejects(action(b.id, 'delete', activeB.revision), /Arquive/);
  await action(b.id, 'archive', activeB.revision);
  const archived = await get(b.id);
  assert.ok(archived.archived_at);
  assert.equal(archived.is_default, false);
  await assert.rejects(action(b.id, 'set_default', archived.revision), /Restaure/);
  await assert.rejects(save(b.id, archived.revision), /Restaure/);
  await action(b.id, 'restore', archived.revision);
  assert.equal((await get(b.id)).is_default, false);
  assert.equal((await get(b.id)).archived_at, null);
  await action(a.id, 'set_default', (await get(a.id)).revision);
  await action(a.id, 'unset_default', (await get(a.id)).revision);
  assert.equal((await get(a.id)).is_default, false);
  await assert.rejects(action(a.id, 'invalid', (await get(a.id)).revision), /inválida/);

  const before = await get(a.id);
  await db.exec('RESET ROLE');
  await query(`UPDATE public.work_locations SET geocoding_status='resolved', latitude=-22,longitude=-47,
    coordinate_source='geocoder',geocoded_at=now() WHERE id=$1`, [a.id]);
  await login(1);
  const renamed = await save(a.id, before.revision, { name: 'Novo nome' });
  assert.equal(renamed.geocoding_status, 'resolved');
  assert.equal(renamed.address_version, before.address_version);
  const moved = await save(a.id, renamed.revision, { name: 'Novo nome', address: 'Rua Nova' });
  assert.equal(moved.address_version, before.address_version + 1);
  assert.equal(moved.geocoding_status, 'pending');
  assert.equal(moved.latitude, null);
  assert.equal(moved.coordinate_source, null);
  assert.equal(moved.geocoded_at, null);
  await action(a.id, 'archive', moved.revision);
  await action(a.id, 'delete', (await get(a.id)).revision);
  assert.equal(await get(a.id), undefined);
  await login(3);
  assert.deepEqual(await query('SELECT * FROM public.work_locations'), []);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(query('SELECT * FROM public.work_locations'), /permission denied/);
  await assert.rejects(save(), /permission denied/);
  await assert.rejects(action(b.id, 'restore', 1), /permission denied/);
});
