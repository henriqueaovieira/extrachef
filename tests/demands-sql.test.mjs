import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

test('operational demands persist 1–50 slots atomically and protect ownership, reservations and existing attendance contracts', async (t) => {
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
      ('${id(3)}','worker'),('${id(4)}','worker'),('${id(5)}','worker');
    CREATE FUNCTION public.export_own_account_data() RETURNS jsonb LANGUAGE plpgsql AS $fn$
      BEGIN
        IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.'; END IF;
        RETURN jsonb_build_object('format_version',1,'account',auth.uid());
      END;
    $fn$;
    CREATE FUNCTION public.anonymize_account(p_user_id uuid) RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.applications WHERE worker_id=p_user_id AND status='approved') THEN
          RAISE EXCEPTION 'Diárias ativas';
        END IF;
        UPDATE public.users SET deleted_at=now() WHERE id=p_user_id;
      END;
    $fn$;
    CREATE TYPE public.job_status AS ENUM ('open','filled','completed');
    CREATE TABLE public.jobs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid REFERENCES public.users(id),
      title text NOT NULL, description text, job_date date NOT NULL, start_time time NOT NULL,
      end_time time NOT NULL, value numeric NOT NULL, status public.job_status NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now(), latitude double precision, longitude double precision,
      event_id uuid, work_location_id uuid, location_source text DEFAULT 'none', location_status text DEFAULT 'not_set',
      location_name text, work_address text, work_number text, work_neighborhood text, work_city text, work_state text,
      work_postal_code text, work_country_code text, work_latitude double precision, work_longitude double precision,
      location_snapshot_at timestamptz, location_source_version integer, location_event_revision integer
    );
    CREATE TABLE public.work_locations(id uuid, restaurant_id uuid, archived_at timestamptz, revision integer,
      name text,address text,number text,neighborhood text,city text,state text,postal_code text,country_code text,
      latitude double precision,longitude double precision,geocoding_status text,address_version integer);
    CREATE TABLE public.events(id uuid, restaurant_id uuid,revision integer,work_location_id uuid,
      location_name text,event_address text,event_number text,event_neighborhood text,event_city text,event_state text,
      event_postal_code text,event_country_code text,event_latitude double precision,event_longitude double precision,
      location_status text,location_source_version integer);
    CREATE TABLE public.applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid REFERENCES public.jobs(id), worker_id uuid REFERENCES public.users(id), status text,
      UNIQUE(job_id,worker_id));
    ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_jobs ON public.jobs FOR SELECT TO authenticated USING(restaurant_id=auth.uid());
    GRANT SELECT ON public.jobs,public.applications TO authenticated;
    INSERT INTO public.jobs(id,restaurant_id,title,job_date,start_time,end_time,value)
      VALUES ('${id(10)}','${id(1)}','Legado','2099-01-01','18:00','23:00',100);
  `);
  const originalCreate = source('20261015080000_job_location_snapshots.sql');
  await db.exec(originalCreate.slice(originalCreate.indexOf('CREATE FUNCTION public.create_restaurant_job('),
    originalCreate.indexOf('$function$;', originalCreate.indexOf('CREATE FUNCTION public.create_restaurant_job(')) + '$function$;'.length));
  await db.exec(source('20261014000000_approve_application_and_block_closed_jobs.sql'));
  await db.exec(source('20261017000000_demand_cancelled_status.sql'));
  await db.exec(source('20261017010000_operational_demands.sql'));
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const login = async (value) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${value ? id(value) : ''}'; SET ROLE authenticated;`);
  const create = async (quantity = 1) => (await query("SELECT public.create_restaurant_demand('Garçom','Reforço','2099-01-01','18:00','23:00',100,$1) AS id", [quantity]))[0].id;
  const jobs = (demand) => query('SELECT * FROM public.jobs WHERE demand_id=$1 ORDER BY id', [demand]);
  const manage = async (demand, action, date = '2099-02-01') => (await query(
    "SELECT public.manage_restaurant_demand($1,$2,'Novo nome','Descrição',$3,'10:00','20:00',150,1) AS id", [demand, action, date],
  ))[0].id;
  const apply = async (job, worker) => {
    await db.exec('RESET ROLE');
    await query("INSERT INTO public.applications(job_id,worker_id,status) VALUES($1,$2,'pending')", [job, id(worker)]);
    await db.exec('SET ROLE authenticated');
  };
  await login(1);
  assert.equal((await query('SELECT demand_id FROM public.jobs WHERE id=$1', [id(10)]))[0].demand_id, id(10));
  for (const quantity of [1, 2, 20, 50]) {
    const demand = await create(quantity);
    assert.equal((await jobs(demand)).length, quantity);
    assert.equal(new Set((await jobs(demand)).map((job) => job.demand_id)).size, 1);
  }
  for (const quantity of [0, -1, 51, null]) await assert.rejects(create(quantity), /1 a 50/);
  await db.exec(`RESET ROLE;
    CREATE FUNCTION public.fail_second_slot() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.title='Falhar' AND EXISTS(SELECT 1 FROM public.jobs WHERE title='Falhar') THEN
        RAISE EXCEPTION 'Falha na segunda posição';
      END IF;
      RETURN NEW;
    END; $fn$;
    CREATE TRIGGER fail_second_slot BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.fail_second_slot();
    SET ROLE authenticated;`);
  await assert.rejects(query("SELECT public.create_restaurant_demand('Falhar','Teste','2099-01-01','18:00','23:00',100,2)"), /segunda posição/);
  assert.equal((await query("SELECT count(*) AS total FROM public.jobs WHERE title='Falhar'"))[0].total, 0);
  await db.exec('RESET ROLE; DROP TRIGGER fail_second_slot ON public.jobs; DROP FUNCTION public.fail_second_slot(); SET ROLE authenticated;');
  const single = await create();
  const edited = await manage(single, 'edit');
  assert.equal((await jobs(edited))[0].title, 'Novo nome');
  await assert.rejects(manage(single, 'edit'), /outra sessão/);
  await assert.rejects(manage(single, 'edit', '2000-01-01'), /Confira/);
  await assert.rejects(manage(single, 'invalid'), /inválida/);
  await login(2);
  assert.deepEqual(await jobs(single), []);
  for (const action of ['edit', 'duplicate', 'cancel']) await assert.rejects(manage(single, action), /não encontrada/);
  await assert.rejects(query('SELECT public.set_demand_reserve($1,$2,true)', [single, id(3)]), /não encontrada/);
  await login(3);
  await assert.rejects(create(), /restaurante/);
  await assert.rejects(manage(single, 'cancel'), /empresa/);
  await login(null);
  await assert.rejects(create(), /restaurante/);
  await login(1);
  const team = await create(2);
  const slots = await jobs(team);
  await apply(slots[0].id, 3);
  await apply(slots[1].id, 3);
  await apply(slots[0].id, 4);
  await query('SELECT public.set_demand_reserve($1,$2,true)', [team, id(4)]);
  assert.equal((await query('SELECT * FROM public.demand_reserves WHERE demand_id=$1', [team])).length, 1);
  const exported = (await query('SELECT public.export_own_account_data() AS data'))[0].data;
  assert.equal(exported.format_version, 1);
  assert.equal(exported.demand_reserves.length, 1);
  await login(2);
  assert.equal((await query('SELECT public.export_own_account_data() AS data'))[0].data.demand_reserves.length, 0);
  await login(4);
  assert.equal((await query('SELECT public.export_own_account_data() AS data'))[0].data.demand_reserves.length, 1);
  await assert.rejects(query('SELECT public.anonymize_account($1)', [id(4)]), /permission denied/);
  await db.exec('RESET ROLE');
  await query('SELECT public.anonymize_account($1)', [id(4)]);
  assert.equal((await query('SELECT * FROM public.demand_reserves WHERE worker_id=$1', [id(4)])).length, 0);
  await login(1);
  await assert.rejects(query('SELECT public.set_demand_reserve($1,$2,true)', [team, id(4)]), /candidato disponível/);
  await db.exec(`RESET ROLE; UPDATE public.users SET deleted_at=NULL WHERE id='${id(4)}'; SET ROLE authenticated;`);
  await query('SELECT public.set_demand_reserve($1,$2,true)', [team, id(4)]);
  await assert.rejects(query('SELECT public.set_demand_reserve($1,$2,true)', [team, id(5)]), /candidato disponível/);
  await assert.rejects(manage(team, 'edit'), /candidaturas/);
  await query('SELECT public.approve_application($1,$2)', [slots[0].id, id(3)]);
  await assert.rejects(query('SELECT public.approve_application($1,$2)', [slots[1].id, id(3)]), /já foi contratado/);
  await assert.rejects(manage(team, 'cancel'), /sem profissionais contratados/);
  await assert.rejects(query('SELECT public.set_demand_reserve($1,$2,true)', [team, id(3)]), /candidato disponível/);
  await assert.rejects(query('SELECT public.approve_single_application($1,$2)', [slots[1].id, id(3)]), /permission denied/);
  await query('SELECT public.approve_demand_candidate($1,$2)', [team, id(4)]);
  assert.ok((await jobs(team)).every((job) => job.status === 'filled'));
  assert.equal((await query('SELECT * FROM public.demand_reserves WHERE demand_id=$1', [team])).length, 0);
  await assert.rejects(query('SELECT public.approve_demand_candidate($1,$2)', [team, id(5)]), /posição aberta/);
  await assert.rejects(query('SELECT public.approve_demand_candidate($1,$2)', [team, id(3)]), /já foi contratado/);
  await login(2);
  assert.deepEqual(await query('SELECT * FROM public.demand_reserves'), []);
  await login(1);
  await db.exec('RESET ROLE');
  await query("UPDATE public.jobs SET location_name='Local original', work_address='Rua A', work_city='São Paulo' WHERE demand_id=$1", [team]);
  await db.exec('SET ROLE authenticated');
  const duplicate = await manage(team, 'duplicate');
  assert.notEqual(duplicate, team);
  const duplicated = await jobs(duplicate);
  assert.equal(duplicated.length, 2);
  assert.ok(duplicated.every((job) => job.status === 'open' && job.title === 'Novo nome' && job.location_name === 'Local original'));
  assert.equal((await query('SELECT * FROM public.applications WHERE job_id=ANY($1::uuid[])', [duplicated.map((job) => job.id)])).length, 0);
  assert.equal((await query('SELECT * FROM public.demand_reserves WHERE demand_id=$1', [duplicate])).length, 0);
  await manage(duplicate, 'cancel');
  assert.ok((await jobs(duplicate)).every((job) => job.status === 'cancelled'));
  await assert.rejects(query("INSERT INTO public.jobs(restaurant_id,title,job_date,start_time,end_time,value) VALUES($1,'A','2099-01-01','10:00','20:00',10)", [id(1)]), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(create(), /permission denied/);
  await assert.rejects(manage(single, 'duplicate'), /permission denied/);

  await db.exec(`RESET ROLE;
    ALTER TABLE public.users ADD COLUMN name text DEFAULT 'Profissional', ADD COLUMN score numeric DEFAULT 4.7;
    ALTER TABLE public.applications ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    CREATE TABLE public.worker_profiles(user_id uuid PRIMARY KEY,specialties text[],experience text,profile_photo_path text);
    CREATE TABLE public.privacy_preferences(user_id uuid PRIMARY KEY,show_experience boolean,show_score boolean,show_photos boolean);
    INSERT INTO public.worker_profiles VALUES('${id(3)}',ARRAY['Garçom'],'Experiência real','${id(3)}/photo.jpg');
    INSERT INTO public.privacy_preferences VALUES('${id(3)}',true,true,true),('${id(4)}',false,false,false);
    CREATE TABLE public.checkins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,worker_id uuid,checkin_time timestamptz DEFAULT now());
    CREATE TABLE public.checkouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,worker_id uuid,checkout_time timestamptz DEFAULT now());
    CREATE TABLE public.reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,worker_id uuid,created_at timestamptz DEFAULT now());
    CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,category text,url text);
    CREATE FUNCTION public.may_view_profile_media(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects(bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT ON storage.objects TO authenticated;
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
  `);
  await db.exec(source('20261017020000_demand_control_center.sql'));
  await login(1);
  const operation = await create(2);
  const newSlots = await jobs(operation);
  const timeline = (demand) => query('SELECT * FROM public.demand_events WHERE demand_id=$1 ORDER BY occurred_at,id', [demand]);
  assert.equal((await timeline(operation)).filter(event => event.kind === 'created').length, 1);
  await assert.rejects(query("INSERT INTO public.demand_events(demand_id,kind,source_key) VALUES($1,'hired','fake')", [operation]), /permission denied/);
  await assert.rejects(query("SELECT public.record_demand_event($1,'hired',$2,'fake')", [operation, id(3)]), /permission denied/);
  const directory = await query('SELECT * FROM public.demand_talent_directory($1)', [operation]);
  assert.equal(directory.find(person => person.id === id(3)).score, '4.7');
  assert.deepEqual(directory.find(person => person.id === id(3)).specialties, ['Garçom']);
  assert.equal(directory.find(person => person.id === id(4)).score, null);
  assert.equal(directory.find(person => person.id === id(4)).photo_path, null);
  await query("SELECT public.set_talent_connection($1,'favorite',true)", [id(3)]);
  assert.deepEqual((await query('SELECT * FROM public.demand_talent_directory($1,$2)', [operation,id(3)]))[0].categories, ['favorite']);
  await assert.rejects(query("SELECT public.set_talent_connection($1,'invented',true)", [id(3)]), /categoria/);
  assert.equal((await query('SELECT public.may_view_profile_media($1,$2) AS allowed', ['worker-private',`${id(3)}/photo.jpg`]))[0].allowed,true);
  assert.equal((await query('SELECT public.may_view_profile_media($1,$2) AS allowed', ['worker-private',`${id(3)}/cpf.pdf`]))[0].allowed,false);
  await query('SELECT public.invite_demand_worker($1,$2)', [operation,id(3)]);
  await assert.rejects(query('SELECT public.invite_demand_worker($1,$2)', [operation,id(3)]), /já recebeu/);
  assert.ok((await timeline(operation)).some(event => event.kind === 'invitation_sent'));
  const invitation = (await query('SELECT * FROM public.demand_invitations WHERE demand_id=$1', [operation]))[0];
  await login(2);
  assert.deepEqual(await timeline(operation), []);
  await assert.rejects(query('SELECT * FROM public.demand_talent_directory($1)', [operation]), /não encontrada/);
  await assert.rejects(query('SELECT public.invite_demand_worker($1,$2)', [operation,id(4)]), /posição aberta/);
  await assert.rejects(query('SELECT public.archive_restaurant_demand($1,true)', [operation]), /não encontrada/);
  await login(4);
  await assert.rejects(query('SELECT public.respond_demand_invitation($1,true)', [invitation.id]), /indisponível/);
  await login(3);
  assert.equal((await query('SELECT * FROM public.worker_demand_invites()')).length,1);
  await query('SELECT public.respond_demand_invitation($1,true)', [invitation.id]);
  await assert.rejects(query('SELECT public.respond_demand_invitation($1,false)', [invitation.id]), /já foi respondido/);
  await login(1);
  assert.ok((await timeline(operation)).some(event => event.kind === 'candidate_received'));
  assert.ok((await timeline(operation)).some(event => event.kind === 'invitation_accepted'));
  assert.equal((await query('SELECT * FROM public.applications WHERE job_id=ANY($1::uuid[])', [newSlots.map(slot=>slot.id)])).filter(app=>app.status==='approved').length,0);
  await query('SELECT public.set_demand_reserve($1,$2,true)', [operation,id(3)]);
  assert.ok((await timeline(operation)).some(event => event.kind === 'reserve_added'));
  await query('SELECT public.approve_demand_candidate($1,$2)', [operation,id(3)]);
  assert.equal((await timeline(operation)).filter(event => event.kind === 'hired').length,1);
  await assert.rejects(query('SELECT public.archive_restaurant_demand($1,true)', [operation]), /Conclua/);
  await db.exec('RESET ROLE');
  const hiredSlot = (await jobs(operation)).find(slot=>slot.status==='filled');
  await query('INSERT INTO public.checkins(job_id,worker_id) VALUES($1,$2)', [hiredSlot.id,id(3)]);
  await query('INSERT INTO public.checkouts(job_id,worker_id) VALUES($1,$2)', [hiredSlot.id,id(3)]);
  await query('INSERT INTO public.reviews(job_id,worker_id) VALUES($1,$2)', [hiredSlot.id,id(3)]);
  await query("UPDATE public.jobs SET status='completed' WHERE demand_id=$1", [operation]);
  await login(1);
  for (const kind of ['checkin','checkout','review']) assert.ok((await timeline(operation)).some(event=>event.kind===kind));
  await query('SELECT public.archive_restaurant_demand($1,true)', [operation]);
  assert.ok((await jobs(operation)).every(slot=>slot.demand_archived_at));
  assert.equal((await timeline(operation)).filter(event=>event.kind==='archived').length,1);
  await query('SELECT public.archive_restaurant_demand($1,false)', [operation]);
  assert.ok((await jobs(operation)).every(slot=>slot.demand_archived_at===null));
  assert.equal((await timeline(operation)).filter(event=>event.kind==='restored').length,1);
  const exportControl = (await query('SELECT public.export_own_account_data() AS data'))[0].data;
  assert.ok(exportControl.demand_events.length);
  assert.ok(exportControl.demand_invitations.length);
  assert.ok(exportControl.talent_connections.length);
  const declineDemand = await create();
  await query('SELECT public.invite_demand_worker($1,$2)', [declineDemand,id(5)]);
  await login(5);
  const declined = (await query('SELECT * FROM public.worker_demand_invites()'))[0];
  await query('SELECT public.respond_demand_invitation($1,false)', [declined.id]);
  await login(1);
  assert.ok((await timeline(declineDemand)).some(event=>event.kind==='invitation_declined'));
  const closedDemand = await create();
  await query('SELECT public.invite_demand_worker($1,$2)', [closedDemand,id(4)]);
  const closedInvite = (await query('SELECT * FROM public.demand_invitations WHERE demand_id=$1', [closedDemand]))[0];
  await manage(closedDemand,'cancel');
  await login(4);
  await assert.rejects(query('SELECT public.respond_demand_invitation($1,true)', [closedInvite.id]), /posições abertas/);
  assert.equal((await query('SELECT * FROM public.demand_invitations WHERE id=$1', [closedInvite.id]))[0].status,'pending');
  await login(1);
  assert.equal((await query('SELECT * FROM public.demand_talent_directory($1,$2,0,50,true)', [closedDemand,id(4)])).length,1);
  assert.equal((await query('SELECT * FROM public.demand_talent_directory($1,$2,0,50,true)', [closedDemand,id(3)])).length,0);
  await db.exec('RESET ROLE');
  await query("UPDATE public.applications SET status='completed' WHERE worker_id=$1", [id(3)]);
  await query('SELECT public.anonymize_account($1)', [id(3)]);
  assert.equal((await query('SELECT * FROM public.demand_events WHERE worker_id=$1', [id(3)])).length,0);
  assert.equal((await query('SELECT * FROM public.demand_invitations WHERE worker_id=$1', [id(3)])).length,0);
  await login(1);
  assert.equal((await query('SELECT * FROM public.demand_talent_directory($1,$2)', [operation,id(3)])).length,0);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(query('SELECT * FROM public.demand_talent_directory($1)', [operation]), /permission denied/);
});
