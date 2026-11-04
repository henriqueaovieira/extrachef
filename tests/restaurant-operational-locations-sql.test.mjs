import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE users(id uuid PRIMARY KEY,role text,deleted_at timestamptz);
    INSERT INTO users VALUES('${id(1)}','restaurant',NULL),('${id(2)}','worker',NULL),('${id(3)}','restaurant',NULL);
    CREATE TABLE restaurant_profiles(user_id uuid PRIMARY KEY,address text,city text,state text,postal_code text);
    CREATE TYPE job_status AS ENUM('open','filled','completed','cancelled');
    CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid REFERENCES users(id),
      title text NOT NULL,description text,job_date date NOT NULL,start_time time NOT NULL,end_time time NOT NULL,
      value numeric NOT NULL,status job_status NOT NULL DEFAULT 'open',created_at timestamptz NOT NULL DEFAULT now(),
      latitude double precision,longitude double precision);
    CREATE TABLE applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),
      worker_id uuid REFERENCES users(id),status text,UNIQUE(job_id,worker_id));
    ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_jobs ON jobs FOR SELECT TO authenticated USING(restaurant_id=auth.uid());
    GRANT SELECT ON jobs,applications,users TO authenticated;
    CREATE FUNCTION approve_application(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION export_own_account_data() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION anonymize_account(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  for (const migration of [
    '20261015010000_restaurant_events.sql', '20261015060000_work_locations_catalog.sql',
    '20261015070000_event_location_snapshots.sql', '20261015080000_job_location_snapshots.sql',
    '20261017010000_operational_demands.sql', '20261019000000_demand_restaurant_location.sql',
    '20261104080000_single_vacancy_operations.sql',
  ]) await db.exec(source(migration));
  await db.exec(`
    CREATE TABLE operational_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs,
      checkin_at timestamptz,replacement_requested_at timestamptz);
    CREATE TABLE demand_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid,
      status text, replacement_assignment_id uuid REFERENCES operational_assignments);
    ALTER TABLE jobs ADD COLUMN demand_archived_at timestamptz;
    CREATE FUNCTION participant_assignment(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION issue_operational_code(uuid,text,double precision,double precision) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION operational_start(j public.jobs) RETURNS timestamptz LANGUAGE sql AS $$ SELECT j.job_date+j.start_time $$;
    CREATE FUNCTION recruitment_closes_at(j public.jobs) RETURNS timestamptz LANGUAGE sql AS $$ SELECT j.job_date+j.start_time-interval '5 hours' $$;
    CREATE FUNCTION recruitment_blocked(public.jobs) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION recruitment_available(public.jobs) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION recruitment_hireable(public.jobs) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  `);
  for (const migration of [
    '20261104040000_reconcile_geocoded_locations.sql', '20261104200000_geocoding_cache.sql',
    '20261104210000_operational_location_readiness.sql',
  ]) await db.exec(source(migration));
  // Legacy location created before the new rules (no CEP), kept untouched by the migration.
  await db.exec(`INSERT INTO work_locations(restaurant_id,name,address,number,city,state)
    VALUES('${id(1)}','Legado','Rua Antiga','','São Paulo','SP')`);
  await db.exec(source('20261105000000_restaurant_operational_locations.sql'));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await rows(sql, args))[0];
  const login = n => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${id(n)}'; SET ROLE authenticated;`);
  const admin = () => db.exec('RESET ROLE');
  const save = (fields = {}) => {
    const value = { name: 'Matriz', address: 'Rua das Flores', number: '120', neighborhood: 'Centro', city: 'São Paulo',
      state: 'SP', postal_code: '01001-000', kind: 'permanent', valid_until: null, make_default: false, id: null, revision: null, ...fields };
    return one(`SELECT * FROM save_restaurant_location($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      value.name, value.address, value.number, value.neighborhood, value.city, value.state, value.postal_code,
      value.kind, value.valid_until, value.make_default, value.id, value.revision]);
  };
  const cache = async (owner, location, latitude, longitude, number = location.number) => {
    await admin();
    const normalize = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
    await rows(`INSERT INTO geocoding_cache(restaurant_id,operation,address_hash,normalized_address,latitude,longitude,
      result_address,provider,provider_namespace,provider_response_hash,expires_at)
      VALUES($1,'geocode',$2,$3,$4,$5,$6,'photon','namespace',$2,now()+interval '1 hour')`, [
      id(owner), Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64), JSON.stringify({
        address: normalize(location.address), number: normalize(location.number),
        neighborhood: normalize(location.neighborhood), city: normalize(location.city),
        state: normalize(location.state), postal_code: location.postal_code.replace(/\D/g, ''), country: 'br',
      }), latitude, longitude, JSON.stringify({ address: location.address, number })]);
    await login(owner);
  };
  const demand = (kind, location = null, revision = null, date = '2099-01-01') => one(`SELECT create_restaurant_demand(
    'Garçom','Detalhes',$4,'10:00','18:00',150,$1,$2,$3) AS id`, [kind, location, revision, date]);
  return { db, rows, one, login, admin, save, cache, demand };
}

test('locations require CEP and number, first permanent location becomes primary, legacy rows stay manageable', async t => {
  const { one, rows, login, save } = await database(t);
  await login(1);
  await assert.rejects(save({ postal_code: '' }), /CEP válido/);
  await assert.rejects(save({ postal_code: '1234' }), /CEP válido/);
  await assert.rejects(save({ number: ' ' }), /número/);
  await assert.rejects(save({ kind: 'temporary' }), /até quando/);
  await assert.rejects(save({ kind: 'permanent', valid_until: '2099-01-01' }), /Somente locais temporários/);
  await assert.rejects(save({ kind: 'temporary', valid_until: '2099-01-01' }), /no máximo 1 ano/);
  const tomorrow = await one(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS d`);
  await assert.rejects(save({ kind: 'temporary', valid_until: tomorrow.d, make_default: true }), /não pode ser o endereço principal/);
  const primary = await save();
  assert.equal(primary.is_default, true);
  assert.equal(primary.kind, 'permanent');
  assert.equal(primary.postal_code, '01001000');
  assert.equal(primary.geocoding_status, 'pending');
  const branch = await save({ name: 'Filial', address: 'Avenida Paulista', number: '1000' });
  assert.equal(branch.is_default, false);
  const temporary = await save({ name: 'Feira', kind: 'temporary', valid_until: tomorrow.d });
  assert.equal(temporary.kind, 'temporary');
  assert.equal(temporary.is_default, false);
  await assert.rejects(rows(`SELECT manage_work_location($1,'set_default',$2)`, [temporary.id, temporary.revision]),
    /não pode ser o endereço principal/);
  const promoted = await save({ name: 'Filial', address: 'Avenida Paulista', number: '1000', id: branch.id,
    revision: branch.revision, make_default: true });
  assert.equal(promoted.is_default, true);
  assert.equal((await one('SELECT is_default FROM work_locations WHERE id=$1', [primary.id])).is_default, false);
  const legacy = await one(`SELECT * FROM work_locations WHERE name='Legado'`);
  await rows(`SELECT manage_work_location($1,'archive',$2)`, [legacy.id, legacy.revision]);
  assert.ok((await one('SELECT archived_at FROM work_locations WHERE id=$1', [legacy.id])).archived_at);
  await login(3);
  assert.equal((await rows('SELECT id FROM work_locations')).length, 0, 'owners only see their locations');
  await assert.rejects(save({ id: primary.id, revision: primary.revision + 1 }), /não encontrado/);
  await login(2);
  await assert.rejects(save(), /conta do restaurante/);
});

test('coordinates come only from the server cache; street-level results require confirmation', async t => {
  const { one, rows, login, save, cache } = await database(t);
  await login(1);
  const house = await save();
  await assert.rejects(one('SELECT * FROM apply_work_location_geocode($1,$2)', [house.id, house.address_version]),
    /Consulte o endereço/);
  await assert.rejects(rows(`UPDATE work_locations SET latitude=1 WHERE id=$1`, [house.id]), /permission denied/);
  await cache(1, house, -23.55, -46.63);
  await assert.rejects(one('SELECT * FROM apply_work_location_geocode($1,$2)', [house.id, house.address_version + 1]),
    /alterado em outra sessão/);
  const resolved = await one('SELECT * FROM apply_work_location_geocode($1,$2)', [house.id, house.address_version]);
  assert.equal(resolved.geocoding_status, 'resolved');
  assert.equal(resolved.geocoding_precision, 'house');
  assert.equal(resolved.latitude, -23.55);
  assert.ok(resolved.confirmed_at);
  await login(3);
  await assert.rejects(one('SELECT * FROM apply_work_location_geocode($1,$2)', [house.id, house.address_version]),
    /não encontrado/);
  await login(1);

  const street = await save({ name: 'Rua longa', address: 'Rua Joaquim Antônio de Oliveira', number: '224',
    city: 'São Pedro', postal_code: '13520-000' });
  await cache(1, street, -22.54339, -47.8996883, '');
  const review = await one('SELECT * FROM apply_work_location_geocode($1,$2)', [street.id, street.address_version]);
  assert.equal(review.geocoding_status, 'needs_review');
  assert.equal(review.latitude, null);
  assert.equal(review.candidate_latitude, -22.54339);
  await assert.rejects(rows(`SELECT confirm_work_location($1,$2,'device',-22.54,-47.89,120)`, [review.id, review.revision]),
    /50 m/);
  await assert.rejects(rows(`SELECT confirm_work_location($1,$2,'device',-22.60,-47.89,10)`, [review.id, review.revision]),
    /mais de 1 km/);
  await assert.rejects(rows(`SELECT confirm_work_location($1,$2,'other')`, [review.id, review.revision]), /inválida/);
  await assert.rejects(rows(`SELECT confirm_work_location($1,$2,'device',-22.5436,-47.8990,8)`, [review.id, review.revision + 1]),
    /outra sessão/);
  const device = await one(`SELECT * FROM confirm_work_location($1,$2,'device',-22.5436,-47.8990,8)`, [review.id, review.revision]);
  assert.equal(device.geocoding_status, 'resolved');
  assert.equal(device.geocoding_precision, 'device');
  assert.equal(device.coordinate_source, 'manual');
  assert.equal(device.latitude, -22.5436);
  assert.equal(device.candidate_latitude, null);
  assert.equal((await one(`SELECT current_setting('extrachef.confirming_location', true) AS v`)).v ?? '', '');
  await assert.rejects(rows(`SELECT confirm_work_location($1,$2,'approximate')`, [device.id, device.revision]),
    /não aguarda confirmação/);

  const other = await save({ name: 'Outra', address: 'Rua das Palmeiras', number: '10' });
  await cache(1, other, -23.60, -46.70, '');
  const pending = await one('SELECT * FROM apply_work_location_geocode($1,$2)', [other.id, other.address_version]);
  const approximate = await one(`SELECT * FROM confirm_work_location($1,$2,'approximate')`, [pending.id, pending.revision]);
  assert.equal(approximate.geocoding_precision, 'street');
  assert.equal(approximate.coordinate_source, 'geocoder');
  assert.equal(approximate.latitude, -23.60);

  const edited = await save({ ...other, name: 'Outra', number: '12', id: other.id, revision: approximate.revision });
  assert.equal(edited.geocoding_status, 'pending', 'address change invalidates coordinates');
  assert.equal(edited.latitude, null);
  assert.equal(edited.geocoding_precision, null);
  assert.equal(edited.confirmed_at, null);
  assert.equal(edited.address_version, other.address_version + 1);
  const failed = await one(`SELECT * FROM record_work_location_geocoding_failure($1,$2,'not_found')`, [edited.id, edited.address_version]);
  assert.equal(failed.geocoding_status, 'failed');
  assert.equal(failed.geocoding_error_code, 'not_found');
  const unchanged = await one(`SELECT * FROM record_work_location_geocoding_failure($1,$2,'not_found')`, [resolved.id, resolved.address_version]);
  assert.equal(unchanged.geocoding_status, 'resolved', 'failures never downgrade resolved locations');
  await assert.rejects(rows(`SELECT record_work_location_geocoding_failure($1,$2,'DROP TABLE')`, [edited.id, edited.address_version]),
    /inválido/);
});

test('operations only use resolved, active and valid locations and snapshot their coordinates', async t => {
  const { one, rows, login, admin, save, cache, demand } = await database(t);
  await login(1);
  await assert.rejects(demand('restaurant'), /Cadastre o endereço operacional principal/);
  const primary = await save();
  await assert.rejects(demand('restaurant'), /Confirme a localização/);
  await assert.rejects(demand('catalog', primary.id, primary.revision), /Confirme a localização/);
  await cache(1, primary, -23.55, -46.63);
  const ready = await one('SELECT * FROM apply_work_location_geocode($1,$2)', [primary.id, primary.address_version]);
  const fromPrimary = await demand('restaurant');
  const job = await one('SELECT * FROM jobs WHERE demand_id=$1', [fromPrimary.id]);
  assert.equal(job.work_location_id, primary.id);
  assert.equal(job.location_status, 'ready');
  assert.equal(job.work_latitude, -23.55);
  assert.equal(job.work_postal_code, '01001000');
  assert.equal(job.work_neighborhood, 'Centro');
  await demand('catalog', ready.id, ready.revision);

  const tomorrow = (await one(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text AS d`)).d;
  const temporary = await save({ name: 'Evento', address: 'Rua do Evento', number: '5', kind: 'temporary', valid_until: tomorrow });
  await cache(1, temporary, -23.56, -46.64);
  const event = await one('SELECT * FROM apply_work_location_geocode($1,$2)', [temporary.id, temporary.address_version]);
  await demand('catalog', event.id, event.revision, tomorrow);
  await assert.rejects(demand('catalog', event.id, event.revision, '2099-01-01'), /temporário não é válido/);
  await admin();
  await rows(`UPDATE work_locations SET valid_until=(now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE id=$1`, [event.id]);
  await login(1);
  const expired = await one('SELECT revision FROM work_locations WHERE id=$1', [event.id]);
  await assert.rejects(demand('catalog', event.id, expired.revision, tomorrow), /temporário não é válido/);

  // Editing the location later never changes published operations (historical snapshot).
  const moved = await save({ name: 'Matriz', address: 'Rua Nova', number: '1', id: ready.id, revision: ready.revision });
  assert.equal(moved.geocoding_status, 'pending');
  assert.equal((await one('SELECT work_address, work_latitude FROM jobs WHERE id=$1', [job.id])).work_latitude, -23.55);
  await assert.rejects(demand('restaurant'), /Confirme a localização/);
  await rows(`SELECT manage_work_location($1,'archive',$2)`, [moved.id, moved.revision]);
  await assert.rejects(demand('restaurant'), /Cadastre o endereço operacional principal/);
  await assert.rejects(demand('catalog', moved.id, moved.revision + 1), /Local indisponível/);
  await login(3);
  await assert.rejects(demand('catalog', event.id, expired.revision, tomorrow), /Local indisponível/);
});

test('client-supplied coordinates are revoked once the new frontend is live', async t => {
  const { db, rows, login, save } = await database(t);
  await login(1);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',-23.55,-46.63)`),
    /CEP válido|Consulte o endereço/);
  await db.exec('RESET ROLE');
  await db.exec(source('20261105010000_revoke_client_geocoded_locations.sql'));
  await login(1);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',-23.55,-46.63)`),
    /permission denied/);
  assert.equal((await save()).geocoding_status, 'pending');
});
