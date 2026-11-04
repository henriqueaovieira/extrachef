import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('real catalog/demand snapshots require server-attested coordinates and final atomic readiness', async t => {
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
    INSERT INTO restaurant_profiles VALUES('${id(1)}','Rua antiga','São Paulo','SP','01310000');
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
    '20261015010000_restaurant_events.sql','20261015060000_work_locations_catalog.sql',
    '20261015070000_event_location_snapshots.sql','20261015080000_job_location_snapshots.sql',
    '20261017010000_operational_demands.sql','20261019000000_demand_restaurant_location.sql',
    '20261104080000_single_vacancy_operations.sql',
  ]) await db.exec(source(migration));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async n => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${id(n)}'; SET ROLE authenticated;`);
  const create = (kind = 'none', location = null, revision = null) => rows(`SELECT create_restaurant_demand(
    'Garçom','Detalhes','2099-01-01','10:00','18:00',150,$1,$2,$3) AS id`, [kind, location, revision]);
  await login(1);
  const [legacy] = await create();
  await db.exec(`RESET ROLE;
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
  await db.exec(source('20261104040000_reconcile_geocoded_locations.sql'));
  await db.exec(source('20261104200000_geocoding_cache.sql'));
  await db.exec(source('20261104210000_operational_location_readiness.sql'));
  await login(1);
  await assert.rejects(create(), /Localize o endereço completo/);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',-23.55,-46.63)`),
    /Consulte o endereço/);
  const normalized = { address: 'rua a', number: '120', neighborhood: '', city: 'são paulo', state: 'sp', postal_code: '', country: 'br' };
  await db.exec('RESET ROLE');
  await rows(`INSERT INTO geocoding_cache(restaurant_id,operation,address_hash,normalized_address,latitude,longitude,
    result_address,provider,provider_namespace,provider_response_hash,expires_at)
    VALUES($1,'geocode',$2,$3,-23.55,-46.63,'{}','photon','namespace',$2,now()+interval '1 hour')`,
  [id(1), 'a'.repeat(64), JSON.stringify(normalized)]);
  await login(1);
  await assert.rejects(rows('SELECT * FROM geocoding_cache'), /permission denied/);
  await assert.rejects(rows("SELECT acquire_geocoding_request($1,$2,$3,20)", ['a'.repeat(64), id(1), id(5)]), /permission denied/);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',0,0)`), /Consulte o endereço/);
  const [location] = await rows(`SELECT * FROM save_geocoded_work_location('Local',' Rua A ','120','São Paulo','SP',-23.55,-46.63)`);
  assert.equal(location.geocoding_status, 'resolved');
  const [demand] = await create('catalog', location.id, location.revision);
  const [job] = await rows('SELECT * FROM jobs WHERE demand_id=$1', [demand.id]);
  assert.equal(job.work_latitude, -23.55);
  assert.equal(job.work_longitude, -46.63);
  assert.equal(job.location_status, 'ready');
  const [copy] = await rows(`SELECT manage_restaurant_demand($1,'duplicate','Cópia','Detalhes','2099-01-02','10:00','18:00',150,1) AS id`, [demand.id]);
  assert.equal((await rows('SELECT work_latitude FROM jobs WHERE demand_id=$1', [copy.id]))[0].work_latitude, job.work_latitude);
  const [pending] = await rows(`SELECT * FROM save_work_location('Pendente','Rua B','1','','São Paulo','SP','')`);
  await assert.rejects(create('catalog', pending.id, pending.revision), /Localize/);
  await assert.rejects(create('restaurant'), /Localize/);
  const [event] = await rows(`SELECT * FROM save_restaurant_event('Evento','Detalhes','2099-01-01','10:00','18:00',1,
    'scheduled',NULL,NULL,'set',$1,$2)`, [location.id, location.revision]);
  await rows(`SELECT create_restaurant_demand('Evento','Detalhes','2099-01-03','10:00','18:00',150,'event',NULL,NULL,$1,$2)`,
  [event.id,event.revision]);
  await login(3);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',-23.55,-46.63)`), /Consulte/);
  await db.exec('RESET ROLE');
  const [old] = await rows('SELECT * FROM jobs WHERE demand_id=$1', [legacy.id]);
  assert.equal(old.work_latitude, null);
  assert.equal((await rows('SELECT recruitment_available(jobs) AS available FROM jobs WHERE id=$1', [old.id]))[0].available, false);
  for (const sql of [
    `INSERT INTO applications(job_id,worker_id,status) VALUES('${old.id}','${id(2)}','pending')`,
    `INSERT INTO operational_assignments(job_id) VALUES('${old.id}')`,
    `INSERT INTO demand_invitations(demand_id,status) VALUES('${legacy.id}','pending')`,
  ]) await assert.rejects(db.exec(sql), /coordenadas válidas/);
  await rows("UPDATE jobs SET status='cancelled' WHERE id=$1", [old.id]);
  await assert.rejects(rows('UPDATE jobs SET work_latitude=NULL,work_longitude=NULL,location_status=$2 WHERE id=$1',
    [job.id,'pending_coordinates']), /não podem ser invalidadas/);
  await rows('INSERT INTO operational_assignments(job_id,checkin_at) VALUES($1,now())', [job.id]);
  await assert.rejects(rows('UPDATE jobs SET work_latitude=work_latitude+0.001 WHERE id=$1', [job.id]), /já iniciada/);
  await rows('UPDATE geocoding_cache SET expires_at=now()-interval \'1 second\'');
  await login(1);
  await assert.rejects(rows(`SELECT save_geocoded_work_location('Local','Rua A','120','São Paulo','SP',-23.55,-46.63)`), /Consulte/);
});

test('persistent coordinator serializes requests, respects cooldown and prevents stale-token release', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE users(id uuid PRIMARY KEY,role text,deleted_at timestamptz);
    INSERT INTO users VALUES('${id(1)}','restaurant',NULL);
  `);
  await db.exec(source('20261015060000_work_locations_catalog.sql'));
  await db.exec(source('20261104200000_geocoding_cache.sql'));
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const namespace = 'a'.repeat(64);
  assert.equal(await scalar('SELECT acquire_geocoding_request($1,$2,$3,20)', [namespace,id(1),id(2)]), true);
  assert.equal(await scalar('SELECT acquire_geocoding_request($1,$2,$3,20)', [namespace,id(1),id(3)]), false);
  await assert.rejects(scalar('SELECT release_geocoding_request($1,$2,60)', [namespace,id(3)]), /expired or replaced/);
  await scalar('SELECT release_geocoding_request($1,$2,60)', [namespace,id(2)]);
  assert.equal(await scalar('SELECT acquire_geocoding_request($1,$2,$3,20)', [namespace,id(1),id(3)]), false);
  await db.query("UPDATE geocoding_requests SET available_at=now()-interval '1 second' WHERE namespace=$1", [namespace]);
  assert.equal(await scalar('SELECT acquire_geocoding_request($1,$2,$3,20)', [namespace,id(1),id(3)]), false,
    'owner cooldown remains after global cooldown has elapsed');
  await db.exec("UPDATE geocoding_requests SET available_at=now()-interval '1 second'");
  assert.equal(await scalar('SELECT acquire_geocoding_request($1,$2,$3,20)', [namespace,id(1),id(3)]), true);
});
