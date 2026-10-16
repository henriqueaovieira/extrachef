import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;

test('operational migration executes in PostgreSQL and preserves attendance/RLS', {
  skip: !process.env.PGLITE_MODULE && 'Set PGLITE_MODULE to an installed @electric-sql/pglite entry point.',
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TYPE application_status AS ENUM ('pending','approved','rejected','in_progress','completed');
    CREATE TYPE job_status AS ENUM ('open','filled','completed');
    CREATE TABLE public.users (
      id uuid PRIMARY KEY, name text, email text, city text, score numeric DEFAULT 5,
      role text, verified boolean DEFAULT false, phone text
    );
    CREATE TABLE public.jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid REFERENCES public.users,
      title text, description text, job_date date, start_time time, end_time time,
      value numeric, status job_status, latitude double precision, longitude double precision
    );
    CREATE TABLE public.applications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs,
      worker_id uuid REFERENCES public.users, status application_status, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.checkins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid UNIQUE REFERENCES public.jobs,
      worker_id uuid REFERENCES public.users, checkin_time timestamptz DEFAULT now(),
      latitude double precision, longitude double precision
    );
    CREATE TABLE public.checkouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid UNIQUE REFERENCES public.jobs,
      worker_id uuid REFERENCES public.users, checkout_time timestamptz DEFAULT now(),
      latitude double precision, longitude double precision
    );
    INSERT INTO public.users(id, role, name) VALUES
      ('${id(1)}','restaurant','Restaurant'), ('${id(2)}','restaurant','Other'),
      ('${id(3)}','worker','Worker'), ('${id(4)}','worker','Other worker');
    INSERT INTO public.jobs(id,restaurant_id,title,job_date,status,latitude,longitude) VALUES
      ('${id(101)}','${id(1)}','Legacy',current_date-10,'filled',0,0),
      ('${id(102)}','${id(1)}','Missing',current_date-10,'filled',null,null),
      ('${id(103)}','${id(1)}','History',current_date-10,'completed',1,1);
    INSERT INTO public.applications(job_id,worker_id,status) VALUES
      ('${id(101)}','${id(3)}','approved'), ('${id(102)}','${id(3)}','approved'),
      ('${id(103)}','${id(3)}','completed');
    INSERT INTO public.checkins(job_id,worker_id,latitude,longitude) VALUES ('${id(103)}','${id(3)}',1.0001,1.0001);
    INSERT INTO public.checkouts(job_id,worker_id,latitude,longitude) VALUES ('${id(103)}','${id(3)}',1.0002,1.0002);
  `);
  await db.exec(source('../supabase/migrations/20261015010000_restaurant_events.sql'));
  await db.exec(`INSERT INTO public.events(id,restaurant_id,title,event_date,start_time,end_time,expected_people)
    VALUES ('${id(201)}','${id(1)}','Legacy event',current_date,'09:00','18:00',10)`);
  await db.exec(source('../supabase/migrations/20261014000000_approve_application_and_block_closed_jobs.sql'));
  await db.exec(source('../supabase/migrations/20261014051000_core_rls.sql'));
  const previous = source('../supabase/migrations/20261014050000_profiles_and_geo.sql');
  await db.exec(previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION public.register_worker_checkin(')));
  await db.exec(source('../supabase/proposals/20261015050000_operational_locations.sql'));
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await query(sql, params))[0])[0];
  const login = async (user) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${id(user)}'; SET ROLE authenticated;`);
  const admin = async () => db.exec('RESET ROLE;');
  const checkin = (job, latitude = 0, longitude = 0) => query(
    'SELECT * FROM public.register_worker_checkin($1,$2,$3)', [id(job), latitude, longitude],
  );
  const checkout = (job, latitude = 0, longitude = 0) => query(
    'SELECT * FROM public.register_worker_checkout($1,$2,$3)', [id(job), latitude, longitude],
  );
  const legacy = await query('SELECT geofence_radius_m, location_source, work_latitude FROM public.jobs WHERE id=$1', [id(101)]);
  assert.deepEqual(legacy[0], { geofence_radius_m: 300, location_source: 'legacy', work_latitude: 0 });
  assert.equal(await scalar('SELECT work_latitude FROM public.jobs WHERE id=$1', [id(102)]), null);
  assert.equal(await scalar('SELECT latitude FROM public.checkins WHERE job_id=$1', [id(103)]), 1.0001);
  assert.equal(await scalar('SELECT latitude FROM public.checkouts WHERE job_id=$1', [id(103)]), 1.0002);

  await login(1);
  await query(`UPDATE public.events SET title='Edited legacy' WHERE id=$1`, [id(201)]);
  await assert.rejects(query(`INSERT INTO public.events(restaurant_id,title,event_date,start_time,end_time,expected_people)
    VALUES ($1,'No address',current_date,'09:00','18:00',10)`, [id(1)]), /local do evento/);
  const event = (await query(`INSERT INTO public.events(restaurant_id,title,event_date,start_time,end_time,expected_people,
    event_address,event_city,event_state,event_postal_code,event_latitude,event_longitude,location_name)
    VALUES ($1,'External event',current_date,'09:00','18:00',10,'Rua A','Piracicaba','SP','13400000',0,0,'Venue') RETURNING id`, [id(1)]))[0].id;
  const job = await scalar(`INSERT INTO public.jobs(restaurant_id,title,job_date,status,
    work_address,work_city,work_state,work_postal_code,work_latitude,work_longitude,event_id)
    VALUES ($1,'New', (now() AT TIME ZONE 'America/Sao_Paulo')::date,'open','Rua A','Piracicaba','SP','13400000',0,0,$2) RETURNING id`, [id(1), event]);
  await assert.rejects(query(`INSERT INTO public.jobs(restaurant_id,title,job_date,status)
    VALUES ($1,'Missing address',current_date,'open')`, [id(1)]), /row-level security/);
  assert.equal(await scalar('SELECT geofence_radius_m FROM public.jobs WHERE id=$1', [job]), 200);
  await login(2);
  await assert.rejects(query(`INSERT INTO public.jobs(restaurant_id,title,job_date,status,
    work_address,work_city,work_state,work_postal_code,work_latitude,work_longitude,event_id)
    VALUES ($1,'Wrong event',current_date,'open','Rua A','Piracicaba','SP','13400000',0,0,$2)`, [id(2), event]), /evento deve pertencer/);
  await login(1);
  await query('UPDATE public.events SET event_latitude=10 WHERE id=$1', [event]);
  assert.equal(await scalar('SELECT work_latitude FROM public.jobs WHERE id=$1', [job]), 0);
  await query('DELETE FROM public.events WHERE id=$1', [event]);
  assert.equal(await scalar('SELECT event_id FROM public.jobs WHERE id=$1', [job]), null);

  await login(3);
  await query(`INSERT INTO public.applications(job_id,worker_id,status) VALUES ($1,$2,'pending')`, [job, id(3)]);
  await assert.rejects(checkin(102), /local da vaga está incompleto/);
  await assert.rejects(checkin(101, NaN, 0), /localização válida/);
  await assert.rejects(checkin(101, 0.01, 0), /Distância atual: .* metros/);
  await checkin(101, 0.0025, 0); // ~278 m: legacy 300 m still accepted, old date preserved.
  await assert.rejects(checkin(101), /aprovado/);
  await assert.rejects(checkout(101, 0.01, 0), /local da vaga/);
  await checkout(101, 0.0025, 0);
  await login(1);
  await query('SELECT public.approve_application($1,$2)', [job, id(3)]);
  await admin();
  assert.equal(await scalar('SELECT status FROM public.jobs WHERE id=$1', [id(101)]), 'completed');
  assert.equal(await scalar('SELECT status FROM public.jobs WHERE id=$1', [job]), 'filled');
  await query(`UPDATE public.jobs SET job_date=job_date+1 WHERE id=$1`, [job]);
  await login(3);
  await assert.rejects(query('SELECT * FROM public.register_worker_checkin($1,0,0)', [job]), /dia da vaga/);
  await admin();
  await query('UPDATE public.jobs SET job_date=job_date-1 WHERE id=$1', [job]);
  await login(4);
  await assert.rejects(query('SELECT * FROM public.register_worker_checkin($1,0,0)', [job]), /aprovado/);
  await login(3);
  await assert.rejects(query('SELECT * FROM public.register_worker_checkin($1,0.002,0)', [job]), /local da vaga/);
  await query('SELECT * FROM public.register_worker_checkin($1,0.001,0)', [job]);
  await admin();
  await assert.rejects(query('UPDATE public.jobs SET geofence_radius_m=500 WHERE id=$1', [job]), /já iniciada/);
  await query('UPDATE public.jobs SET job_date=job_date-1 WHERE id=$1', [job]);
  await login(3);
  await query('SELECT * FROM public.register_worker_checkout($1,0.001,0)', [job]); // Overnight checkout allowed.
  await assert.rejects(query('SELECT public.assert_job_presence($1,0,0,false)', [job]), /permission denied/);
  await admin();
  assert.equal(await scalar('SELECT status FROM public.applications WHERE job_id=$1', [job]), 'completed');
  assert.equal(await scalar('SELECT count(*)::int FROM public.checkins'), 3);
  assert.equal(await scalar('SELECT count(*)::int FROM public.checkouts'), 3);

  for (const radius of [100, 200, 300, 500]) {
    const lat = radius / 6371000 * 180 / Math.PI;
    await query('UPDATE public.jobs SET geofence_radius_m=$1 WHERE id=$2', [radius, id(102)]);
    await query('UPDATE public.jobs SET work_latitude=0,work_longitude=0 WHERE id=$1', [id(102)]);
    await query('SELECT public.assert_job_presence($1,$2,0,false)', [id(102), lat * 0.999]);
    await assert.rejects(query('SELECT public.assert_job_presence($1,$2,0,false)', [id(102), lat * 1.001]), /local da vaga/);
  }
  await assert.rejects(query('UPDATE public.jobs SET work_latitude=null WHERE id=$1', [id(102)]), /check constraint/);
});
