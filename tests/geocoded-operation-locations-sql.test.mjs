import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('catalog operations persist without coordinates and retain geocoded coordinates when available', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.users(id uuid PRIMARY KEY, role text, deleted_at timestamptz);
    INSERT INTO public.users(id,role) VALUES ('${id(1)}','restaurant'),('${id(2)}','worker');
    CREATE TABLE public.restaurant_profiles(
      user_id uuid PRIMARY KEY REFERENCES public.users(id), address text, city text, state text, postal_code text);
    INSERT INTO public.restaurant_profiles VALUES ('${id(1)}','Rua antiga','Campinas','SP','13000000');
    CREATE TYPE public.job_status AS ENUM ('open','filled','completed','cancelled');
    CREATE TABLE public.jobs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid REFERENCES public.users(id),
      title text NOT NULL, description text, job_date date NOT NULL, start_time time NOT NULL,
      end_time time NOT NULL, value numeric NOT NULL, status public.job_status NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now(), latitude double precision, longitude double precision);
    CREATE TABLE public.applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid REFERENCES public.jobs(id), worker_id uuid REFERENCES public.users(id), status text,
      UNIQUE(job_id,worker_id));
    ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_jobs ON public.jobs FOR SELECT TO authenticated USING(restaurant_id=auth.uid());
    GRANT SELECT ON public.jobs,public.applications,public.users TO authenticated;
    CREATE FUNCTION public.approve_application(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.export_own_account_data() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION public.anonymize_account(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  for (const name of [
    '20261015010000_restaurant_events.sql', '20261015060000_work_locations_catalog.sql',
    '20261015070000_event_location_snapshots.sql', '20261015080000_job_location_snapshots.sql',
    '20261017010000_operational_demands.sql', '20261019000000_demand_restaurant_location.sql',
  ]) await db.exec(source(name));

  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  await db.exec(`SET request.jwt.claim.sub='${id(1)}'; SET ROLE authenticated;`);
  const [legacy] = await query(`SELECT public.create_restaurant_demand(
    'Garçom','Operação antiga','2099-01-01','18:00','23:00',150,1,'none') AS id`);

  await db.exec('RESET ROLE;');
  await db.exec(source('20261019010000_geocoded_operation_locations.sql'));
  await db.exec(source('20261103010000_optional_operation_geocoding.sql'));
  await db.exec(source('20261104080000_single_vacancy_operations.sql'));
  await db.exec(`SET request.jwt.claim.sub='${id(1)}'; SET ROLE authenticated;`);
  const [location] = await query(`SELECT * FROM public.save_geocoded_work_location(
    'Local da Operação','Rua das Flores','120','São Paulo','SP',-23.55,-46.63)`);
  assert.equal(location.geocoding_status, 'resolved');
  assert.equal(location.postal_code, '');
  assert.equal(location.latitude, -23.55);
  assert.equal(location.longitude, -46.63);
  assert.equal(location.coordinate_source, 'geocoder');

  const [created] = await query(`SELECT public.create_restaurant_demand(
    'Garçom','Detalhes','2099-01-02','18:00','23:00',150,'catalog',$1,$2) AS id`,
  [location.id, location.revision]);
  const [snapshot] = await query('SELECT * FROM public.jobs WHERE demand_id=$1', [created.id]);
  assert.equal(snapshot.location_status, 'ready');
  assert.equal(snapshot.work_latitude, -23.55);
  assert.equal(snapshot.work_longitude, -46.63);
  assert.equal(snapshot.work_location_id, location.id);

  const [pending] = await query(`SELECT * FROM public.save_work_location(
    'Local pendente','Rua sem coordenada','10','','São Paulo','SP','')`);
  const [pendingDemand] = await query(`SELECT public.create_restaurant_demand(
    'Garçom','Detalhes','2099-01-03','18:00','23:00',150,'catalog',$1,$2) AS id`,
  [pending.id, pending.revision]);
  const [pendingSnapshot] = await query('SELECT * FROM public.jobs WHERE demand_id=$1', [pendingDemand.id]);
  assert.equal(pendingSnapshot.location_status, 'pending_coordinates');
  assert.equal(pendingSnapshot.work_address, 'Rua sem coordenada');
  assert.equal(pendingSnapshot.work_latitude, null);
  assert.equal(pendingSnapshot.work_longitude, null);
  await assert.rejects(query(`SELECT public.save_geocoded_work_location(
    'Local inválido','Rua inválida','10','São Paulo','SP',91,-46)`,
  ), /coordenadas válidas/);

  const [unchangedLegacy] = await query('SELECT location_status,work_latitude,work_longitude FROM public.jobs WHERE demand_id=$1', [legacy.id]);
  assert.equal(unchangedLegacy.location_status, 'not_set');
  assert.equal(unchangedLegacy.work_latitude, null);
  assert.equal(unchangedLegacy.work_longitude, null);
});
