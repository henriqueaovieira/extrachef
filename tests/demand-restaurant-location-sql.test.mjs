import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('restaurant publication uses real catalog/job constraints and preserves legacy contracts atomically', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE public.users(id uuid PRIMARY KEY, role text, deleted_at timestamptz);
    INSERT INTO public.users(id,role) VALUES ('${id(1)}','restaurant'),('${id(2)}','restaurant'),
      ('${id(3)}','worker'),('${id(4)}','restaurant');
    CREATE TABLE public.restaurant_profiles(
      user_id uuid PRIMARY KEY REFERENCES public.users(id), address text, city text, state text, postal_code text);
    INSERT INTO public.restaurant_profiles VALUES
      ('${id(1)}',' Rua Principal, 123 ',' Sao Paulo ','sp','01310-100'),
      ('${id(2)}','Rua Outra, 456','Campinas','SP','13000000');
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
    '20261017010000_operational_demands.sql',
  ]) await db.exec(source(name));
  await db.exec(source('20261019000000_demand_restaurant_location.sql'));
  await db.exec(source('20261104080000_single_vacancy_operations.sql'));
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = (n) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${n ? id(n) : ''}'; SET ROLE authenticated;`);
  const create = async (location = 'restaurant', locationId = null, revision = null, eventId = null, eventRevision = null) =>
    (await query(`SELECT public.create_restaurant_demand('Garcom','Informacoes da operacao','2099-01-01',
      '22:00','03:00',150,$1,$2,$3,$4,$5) AS id`,
    [location, locationId, revision, eventId, eventRevision]))[0].id;
  const jobs = (demand) => query('SELECT * FROM public.jobs WHERE demand_id=$1 ORDER BY id', [demand]);
  const locations = () => query('SELECT * FROM public.work_locations ORDER BY created_at,id');

  await login(1);
  const legacyLocation = (await query(`SELECT * FROM public.save_work_location('Local antigo','Rua Antiga','','','Sao Paulo','SP','01310100')`))[0];
  const legacyEvent = (await query(`SELECT * FROM public.save_restaurant_event('Evento antigo','Historico','2099-01-01',
    '10:00','18:00',80,'scheduled',NULL,NULL,'set',$1,$2)`, [legacyLocation.id, legacyLocation.revision]))[0];
  const historicalDemand = await create('event', null, null, legacyEvent.id, legacyEvent.revision);
  const historicalJobs = await jobs(historicalDemand);
  const historicalEvents = await query('SELECT * FROM public.events');
  await db.exec('RESET ROLE');
  const constraints = await query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace='public'::regnamespace ORDER BY conname,definition`);
  const functions = await query(`SELECT oid::regprocedure::text AS signature, pg_get_functiondef(oid) AS definition
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname <> 'create_restaurant_demand' ORDER BY signature`);
  const policies = await query('SELECT * FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname', ['public']);
  assert.deepEqual(await query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace='public'::regnamespace ORDER BY conname,definition`), constraints);
  assert.deepEqual(await query(`SELECT oid::regprocedure::text AS signature, pg_get_functiondef(oid) AS definition
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname <> 'create_restaurant_demand' ORDER BY signature`), functions);
  assert.deepEqual(await query('SELECT * FROM pg_policies WHERE schemaname=$1 ORDER BY tablename,policyname', ['public']), policies);
  await login(1);

  await t.test('each operation creates one vacancy and reuses the automatic default location', async () => {
    for (let count = 0; count < 4; count += 1) {
      const rows = await jobs(await create());
      assert.equal(rows.length, 1);
      for (const job of rows) {
        assert.equal(job.location_source, 'catalog');
        assert.equal(job.event_id, null);
        assert.equal(job.location_event_revision, null);
        assert.equal(job.work_address, 'Rua Principal, 123');
        assert.equal(job.work_city, 'Sao Paulo');
        assert.equal(job.work_state, 'SP');
        assert.equal(job.work_postal_code, '01310100');
        assert.equal(job.location_status, 'pending_coordinates');
        assert.equal(job.work_latitude, null);
        assert.equal(job.work_longitude, null);
        assert.ok(job.location_snapshot_at);
      }
      assert.equal(new Set(rows.map(job => job.work_location_id)).size, 1);
    }
    const all = await locations();
    assert.equal(all.length, 2);
    assert.equal(all.filter(location => location.is_default).length, 1);
  });

  await t.test('matching resolved coordinates are reused without resetting revision or geocoding', async () => {
    const current = (await locations()).find(location => location.is_default);
    await db.exec('RESET ROLE');
    await query(`UPDATE public.work_locations SET latitude=-23.5,longitude=-46.6,
      geocoding_status='resolved',coordinate_source='geocoder' WHERE id=$1`, [current.id]);
    await login(1);
    const [job] = await jobs(await create());
    assert.equal(job.work_location_id, current.id);
    assert.equal(job.location_status, 'ready');
    assert.equal(job.work_latitude, -23.5);
    assert.equal(job.work_longitude, -46.6);
    assert.equal((await locations()).find(location => location.id === current.id).revision, current.revision);
  });

  await t.test('profile moves create a new default but do not modify any historical snapshots', async () => {
    const previous = (await locations()).find(location => location.is_default);
    const existing = await jobs(await create());
    await db.exec('RESET ROLE');
    await query("UPDATE public.restaurant_profiles SET address='Rua Nova, 789' WHERE user_id=$1", [id(1)]);
    await login(1);
    const [newJob] = await jobs(await create());
    assert.equal(newJob.work_address, 'Rua Nova, 789');
    assert.notEqual(newJob.work_location_id, previous.id);
    assert.equal(newJob.work_latitude, null);
    assert.deepEqual(await jobs(existing[0].demand_id), existing);
    assert.deepEqual(await jobs(historicalDemand), historicalJobs);
    assert.deepEqual(await query('SELECT * FROM public.events'), historicalEvents);
    assert.equal((await locations()).find(location => location.id === previous.id).address, previous.address);
    assert.equal((await locations()).filter(location => location.is_default).length, 1);
  });

  await t.test('legacy none, catalog, event and duplication contracts still work', async () => {
    assert.equal((await jobs(await create('none')))[0].location_status, 'not_set');
    const [legacyDefault] = await query(`SELECT public.create_restaurant_demand('Legado','Sem origem','2099-01-01','10:00','18:00',150) AS id`);
    assert.equal((await jobs(legacyDefault.id))[0].location_source, 'none');
    assert.equal((await jobs(await create('catalog', legacyLocation.id, legacyLocation.revision)))[0].work_address, legacyLocation.address);
    assert.equal((await jobs(await create('event', null, null, legacyEvent.id, legacyEvent.revision)))[0].event_id, legacyEvent.id);
    const [{ id: duplicate }] = await query(`SELECT public.manage_restaurant_demand($1,'duplicate',
      'Copia','Historico','2099-02-01','10:00','18:00',150,1) AS id`, [historicalDemand]);
    const [copy] = await jobs(duplicate);
    assert.equal(copy.event_id, legacyEvent.id);
    assert.equal(copy.work_address, historicalJobs[0].work_address);
    await assert.rejects(query('DELETE FROM public.events WHERE id=$1', [legacyEvent.id]), /foreign key/);
  });

  await t.test('an archived principal location is not reused and invalid input creates no orphan location', async () => {
    const current = (await locations()).find(location => location.is_default);
    await query("SELECT public.manage_work_location($1,'archive',$2)", [current.id, current.revision]);
    const before = await locations();
    await assert.rejects(query(`SELECT public.create_restaurant_demand('Garcom','Operacao','2099-01-01',
      '10:00','18:00',0,'restaurant')`), /maior que zero/);
    assert.deepEqual(await locations(), before);
    const [job] = await jobs(await create());
    assert.notEqual(job.work_location_id, current.id);
    assert.equal(job.work_address, current.address);
    assert.deepEqual((await locations()).find(location => location.id === current.id), before.find(location => location.id === current.id));
    assert.equal((await locations()).filter(location => location.is_default).length, 1);
  });

  await t.test('invalid or missing profile fails explicitly without creating a job or location', async () => {
    const before = await locations();
    for (const changes of [
      { address: '', city: 'Sao Paulo', state: 'SP', postal: '01310100' },
      { address: 'Rua A', city: '', state: 'SP', postal: '01310100' },
      { address: 'Rua A', city: 'Sao Paulo', state: 'Sao Paulo', postal: '01310100' },
      { address: 'Rua A', city: 'Sao Paulo', state: 'SP', postal: '123' },
    ]) {
      await db.exec('RESET ROLE');
      await query('UPDATE public.restaurant_profiles SET address=$1,city=$2,state=$3,postal_code=$4 WHERE user_id=$5',
        [...Object.values(changes), id(1)]);
      await login(1);
      await assert.rejects(create(), /perfil do restaurante/);
      assert.deepEqual(await locations(), before);
    }
    await login(4);
    await assert.rejects(create(), /Complete o endereco principal/);
    assert.deepEqual(await locations(), []);
    await login(1);
    await assert.rejects(create('restaurant', legacyLocation.id, 1), /automaticamente/);
    await assert.rejects(create('restaurant', null, null, legacyEvent.id, 1), /automaticamente/);
  });

  await t.test('failed operation creation rolls back the new default and catalog insertion', async () => {
    await db.exec(`RESET ROLE;
      UPDATE public.restaurant_profiles SET address='Rua Falha, 100',city='Sao Paulo',state='SP',postal_code='01310100'
        WHERE user_id='${id(1)}';
      CREATE FUNCTION public.fail_second_slot() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.work_address='Rua Falha, 100' THEN
          RAISE EXCEPTION 'Falha na operação';
        END IF;
        RETURN NEW;
      END; $fn$;
      CREATE TRIGGER fail_operation BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.fail_second_slot();`);
    await login(1);
    const before = await locations();
    await assert.rejects(create(), /Falha na operação/);
    assert.deepEqual(await locations(), before);
    assert.deepEqual(await query("SELECT id FROM public.jobs WHERE work_address='Rua Falha, 100'"), []);
    await db.exec('RESET ROLE; DROP TRIGGER fail_operation ON public.jobs; DROP FUNCTION public.fail_second_slot();');
  });

  await t.test('ownership, worker, deleted account, anonymous and catalog permissions remain enforced', async () => {
    await login(2);
    assert.deepEqual(await query('SELECT * FROM public.events'), []);
    assert.deepEqual(await locations(), []);
    const [ownJob] = await jobs(await create());
    assert.equal(ownJob.restaurant_id, id(2));
    assert.equal(ownJob.work_address, 'Rua Outra, 456');
    assert.deepEqual(await jobs(historicalDemand), []);
    await assert.rejects(query("UPDATE public.work_locations SET address='Alterado'"), /permission denied/);
    await login(3);
    await assert.rejects(create(), /conta do restaurante/);
    await login(null);
    await assert.rejects(create(), /conta do restaurante/);
    await db.exec(`RESET ROLE; UPDATE public.users SET deleted_at=now() WHERE id='${id(2)}';`);
    await login(2);
    await assert.rejects(create(), /conta do restaurante/);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(create(), /permission denied/);
  });
});
