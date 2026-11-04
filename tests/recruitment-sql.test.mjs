import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

for (const gps of [false,true]) {
for (const repairGps of [false,true]) {
test(`recruitment rules and same-job replacements with ${gps ? 'GPS' : 'production two-argument'} code issuance${repairGps ? ' + corrective GPS migration' : ''}`, async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
  const login = async n => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${n ? id(n) : ''}'; ${n ? 'SET ROLE authenticated' : ''}`);
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE users(id uuid PRIMARY KEY,role text,name text,deleted_at timestamptz,score numeric DEFAULT 5,
      email text,phone text,city text,verified boolean DEFAULT false);
    INSERT INTO users(id,role,name) VALUES('${id(1)}','restaurant','Empresa'),('${id(2)}','worker','Ana'),
      ('${id(3)}','worker','Bruno'),('${id(4)}','worker','Carla'),('${id(5)}','worker','Externo');
    CREATE TYPE job_status AS ENUM('open','filled','completed','cancelled');
    CREATE TYPE application_status AS ENUM('pending','approved','in_progress','completed','rejected');
    CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid DEFAULT gen_random_uuid(),
      restaurant_id uuid REFERENCES users(id),title text,description text,job_date date,start_time time,end_time time,
      value numeric,status job_status,location_name text,work_address text,created_at timestamptz DEFAULT now(),
      demand_archived_at timestamptz,work_latitude double precision DEFAULT 0,work_longitude double precision DEFAULT 0,
      latitude double precision DEFAULT 0,longitude double precision DEFAULT 0,work_neighborhood text,work_city text,work_state text);
    CREATE TABLE applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),
      worker_id uuid REFERENCES users(id),status application_status,created_at timestamptz DEFAULT now(),UNIQUE(job_id,worker_id));
    CREATE TABLE checkins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),worker_id uuid,checkin_time timestamptz,
      CONSTRAINT checkins_one_per_job UNIQUE(job_id),CONSTRAINT checkins_one_per_worker_job UNIQUE(worker_id,job_id));
    CREATE TABLE checkouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),worker_id uuid,checkout_time timestamptz,
      CONSTRAINT checkouts_one_per_job UNIQUE(job_id),CONSTRAINT checkouts_one_per_worker_job UNIQUE(worker_id,job_id));
    CREATE TABLE privacy_preferences(user_id uuid,show_score boolean,show_experience boolean,show_photos boolean);
    CREATE TABLE worker_profiles(user_id uuid,profile_photo_path text,specialties text[],experience text);
    CREATE TABLE restaurant_profiles(user_id uuid,logo_path text);
    CREATE TABLE talent_connections(restaurant_id uuid,worker_id uuid,category text);
    CREATE TABLE demand_reserves(demand_id uuid,worker_id uuid);
    CREATE TABLE demand_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid,kind text,worker_id uuid,
      source_key text UNIQUE,occurred_at timestamptz);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,category text,url text,
      message_id uuid,read boolean DEFAULT false);
    CREATE TABLE demand_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid,restaurant_id uuid,worker_id uuid,
      status text DEFAULT 'pending' CHECK(status IN('pending','accepted','declined')),created_at timestamptz DEFAULT now(),responded_at timestamptz,
      UNIQUE(demand_id,worker_id));
    ALTER TABLE demand_invitations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY invitation_participants ON demand_invitations FOR SELECT TO authenticated
      USING(auth.uid() IN(restaurant_id,worker_id));
    CREATE FUNCTION record_demand_event(uuid,text,uuid,text,timestamptz DEFAULT now()) RETURNS void LANGUAGE sql AS
      $$ INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING $$;
    CREATE FUNCTION register_worker_checkin(uuid,double precision,double precision) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION register_worker_checkout(uuid,double precision,double precision) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION export_own_account_data() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION demand_talent_directory(uuid,uuid DEFAULT NULL,integer DEFAULT 0,integer DEFAULT 50,boolean DEFAULT false)
      RETURNS TABLE(id uuid,name text,specialties text[],score numeric,photo_path text,experience text,categories text[],completed_operations bigint,invitation_status text)
      LANGUAGE sql AS $$ SELECT id,name,ARRAY[]::text[],NULL::numeric,NULL::text,NULL::text,ARRAY[]::text[],0::bigint,NULL::text FROM users WHERE role='worker' $$;
    CREATE FUNCTION manage_restaurant_demand(uuid,text,text DEFAULT NULL,text DEFAULT NULL,date DEFAULT NULL,time DEFAULT NULL,
      time DEFAULT NULL,numeric DEFAULT NULL,integer DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE FUNCTION worker_demand_invites() RETURNS TABLE(id uuid) LANGUAGE sql AS $$ SELECT id FROM demand_invitations $$;
    GRANT SELECT ON checkins,checkouts,demand_events,notifications,demand_invitations TO authenticated;
  `);
  await db.exec(source('20261014051000_core_rls.sql'));
  await db.exec(source('20261014000000_approve_application_and_block_closed_jobs.sql'));
  await db.exec(source('20261014010000_job_chat.sql'));
  await db.exec(source('20261014035000_job_reviews.sql'));
  await db.exec(source('20261017030000_operational_trust.sql'));
  if (gps) await db.exec(source('20261019030000_checkin_gps.sql'));
  else if (!repairGps) await db.exec('ALTER TABLE jobs DROP COLUMN work_latitude, DROP COLUMN work_longitude;');
  const control = source('20261017020000_demand_control_center.sql');
  await db.exec(control.slice(control.indexOf('CREATE FUNCTION public.record_demand_activity()'),
    control.indexOf('INSERT INTO public.demand_events(demand_id,kind,source_key,occurred_at)')));
  await db.exec('ALTER TABLE messages ADD COLUMN read_at timestamptz;');
  await db.exec(`
    SET request.jwt.claim.sub='${id(1)}';
    INSERT INTO jobs(id,demand_id,restaurant_id,title,description,job_date,start_time,end_time,value,status)
      VALUES('${id(700)}','${id(700)}','${id(1)}','Legado contratado','Histórico','2099-01-01','10:00','18:00',150,'open'),
        ('${id(701)}','${id(700)}','${id(1)}','Legado multivaga','Histórico','2099-01-01','10:00','18:00',150,'open'),
        ('${id(702)}','${id(702)}','${id(1)}','Legado concluído','Histórico','2000-01-01','10:00','18:00',150,'open');
    INSERT INTO applications(job_id,worker_id,status)
      VALUES('${id(700)}','${id(2)}','pending'),('${id(701)}','${id(3)}','pending'),
        ('${id(702)}','${id(4)}','pending');
    UPDATE applications SET status='approved' WHERE job_id IN('${id(700)}','${id(702)}');
    UPDATE jobs SET status='filled' WHERE id='${id(700)}';
    INSERT INTO demand_invitations(demand_id,restaurant_id,worker_id,status)
      VALUES('${id(700)}','${id(1)}','${id(5)}','pending');
    INSERT INTO messages(job_id,sender_id,content) VALUES('${id(700)}','${id(1)}','Mensagem histórica');
    INSERT INTO checkins(job_id,worker_id,checkin_time) VALUES('${id(702)}','${id(4)}','2000-01-01T13:00:00Z');
    INSERT INTO checkouts(job_id,worker_id,checkout_time) VALUES('${id(702)}','${id(4)}','2000-01-01T21:00:00Z');
    UPDATE operational_assignments SET checkin_at='2000-01-01T13:00:00Z',checkout_at='2000-01-01T21:00:00Z'
      WHERE job_id='${id(702)}';
    UPDATE applications SET status='completed' WHERE job_id='${id(702)}';
    UPDATE jobs SET status='completed' WHERE id='${id(702)}';
    INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again)
      VALUES('${id(702)}','${id(1)}','${id(4)}','${id(1)}','${id(4)}',5,true),
        ('${id(702)}','${id(1)}','${id(4)}','${id(4)}','${id(1)}',5,true);
    RESET request.jwt.claim.sub;
  `);
  const preservedTables = ['jobs','applications','checkins','checkouts','reviews','demand_events','notifications'];
  const snapshot = table => scalar(`SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) FROM ${table} row`);
  const beforeMigration = new Map();
  for (const table of preservedTables) beforeMigration.set(table,await snapshot(table));
  const assignmentsBefore = await snapshot('operational_assignments');
  const invitationsBefore = await snapshot('demand_invitations');
  const messagesBefore = await snapshot('messages');
  const issuanceSignature = gps ? 'uuid,text,double precision,double precision' : 'uuid,text';
  const otherSignature = gps ? 'uuid,text' : 'uuid,text,double precision,double precision';
  const issueCheckin = key => scalar(gps || repairGps ? "SELECT issue_operational_code($1,'checkin',0,0)"
    : "SELECT issue_operational_code($1,'checkin')",[key]);
  const checkGpsSql = async (key,worker) => {
    await login(0);
    for (const [setting,value] of Object.entries({
      'test.checkin_job_id':key, 'test.worker_id':id(worker),
      'test.restaurant_id':id(1), 'test.outsider_id':id(5),
    })) await rows('SELECT set_config($1,$2,false)',[setting,value]);
    await db.exec(readFileSync(new URL('../supabase/tests/operational_checkin_gps.sql',import.meta.url),'utf8'));
  };
  await db.exec(`ALTER FUNCTION public.issue_operational_code(${issuanceSignature}) RENAME TO saved_code_issuance;`);
  await assert.rejects(db.exec(source('20261104180000_recruitment_availability.sql')),/Recruitment preflight: missing function public.issue_operational_code/);
  await db.exec('ROLLBACK;');
  await db.exec(`ALTER FUNCTION public.saved_code_issuance(${issuanceSignature}) RENAME TO issue_operational_code;`);
  await db.exec(`CREATE FUNCTION public.issue_operational_code(${otherSignature}) RETURNS jsonb
    LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  await assert.rejects(db.exec(source('20261104180000_recruitment_availability.sql')),/Recruitment preflight: ambiguous/);
  await db.exec('ROLLBACK;');
  await db.exec(`DROP FUNCTION public.issue_operational_code(${otherSignature});`);
  await db.exec('ALTER TABLE checkins RENAME CONSTRAINT checkins_one_per_job TO unexpected_constraint;');
  await assert.rejects(db.exec(source('20261104180000_recruitment_availability.sql')),/Recruitment preflight: incompatible constraint/);
  await db.exec('ROLLBACK;');
  assert.equal(await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
    AND table_name='operational_assignments' AND column_name='replacement_requested_at'`),0);
  await db.exec('ALTER TABLE checkins RENAME CONSTRAINT unexpected_constraint TO checkins_one_per_job;');
  await db.exec(source('20261104180000_recruitment_availability.sql'));
  assert.notEqual(await scalar('SELECT to_regprocedure($1)::text',[`public.issue_operational_code(${issuanceSignature})`]),null);
  assert.equal(await scalar('SELECT to_regprocedure($1)::text',[`public.issue_operational_code(${otherSignature})`]),null);
  for (const table of preservedTables) assert.deepEqual(await snapshot(table),beforeMigration.get(table),table);
  assert.deepEqual(await scalar(`SELECT jsonb_agg(to_jsonb(row)-'replacement_requested_at'-'replacement_closed_at' ORDER BY row.id)
    FROM operational_assignments row`),assignmentsBefore);
  assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(row)-'replacement_assignment_id' ORDER BY row.id) FROM demand_invitations row"),invitationsBefore);
  assert.equal(await scalar('SELECT count(*) FROM demand_invitations WHERE replacement_assignment_id IS NOT NULL'),0);
  assert.deepEqual(await scalar("SELECT jsonb_agg(to_jsonb(row)-'assignment_id' ORDER BY row.id) FROM messages row"),messagesBefore);
  assert.equal(await scalar('SELECT count(*) FROM messages WHERE assignment_id IS NOT NULL'),1);
  assert.equal(await scalar('SELECT count(*) FROM jobs WHERE demand_id=$1',[id(700)]),2);
  for (const signature of ['respond_demand_invitation(uuid,boolean)','approve_demand_candidate(uuid,uuid)',
    `issue_operational_code(${issuanceSignature})`]) {
    assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')",[signature]),false);
    assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),true);
  }
  if (repairGps) {
    const correction = source('20261104190000_restore_operational_checkin_gps.sql');
    const functions = () => scalar(`SELECT jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND p.proname<>'issue_operational_code'`);
    const functionsBefore = await functions();
    const tables = [...preservedTables,'operational_assignments','operational_codes','demand_invitations','messages'];
    const dataBefore = new Map();
    const data = table => scalar(`SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM ${table} row`);
    for (const table of tables) dataBefore.set(table,await data(table));
    await db.exec('ALTER TABLE jobs RENAME COLUMN work_latitude TO unavailable_latitude;');
    await assert.rejects(db.exec(correction),/Check-in GPS preflight: jobs requires/);
    await db.exec('ROLLBACK;');
    await db.exec('ALTER TABLE jobs RENAME COLUMN unavailable_latitude TO work_latitude;');
    await db.exec('ALTER FUNCTION participant_assignment(uuid) RENAME TO unavailable_assignment;');
    await assert.rejects(db.exec(correction),/Check-in GPS preflight: missing function/);
    await db.exec('ROLLBACK;');
    await db.exec('ALTER FUNCTION unavailable_assignment(uuid) RENAME TO participant_assignment;');
    await db.exec(correction);
    await db.exec(correction);
    assert.deepEqual(await functions(),functionsBefore,'unrelated function definitions and ACLs are unchanged');
    for (const table of tables) assert.deepEqual(await data(table),dataBefore.get(table),table);
    assert.notEqual(await scalar("SELECT to_regprocedure('public.issue_operational_code(uuid,text,double precision,double precision)')"),null);
    assert.equal(await scalar("SELECT to_regprocedure('public.issue_operational_code(uuid,text)')"),null);
  }
  await login(2);
  assert.equal((await rows('SELECT content FROM messages WHERE job_id=$1',[id(700)]))[0].content,'Mensagem histórica');
  await login(4);
  assert.equal((await scalar('SELECT operational_context($1)',[id(702)])).phase,'completed');
  await login(0);
  await db.exec('GRANT SELECT ON jobs TO authenticated;');
  let next = 10;
  const job = async (hours = 12, publishedHoursAgo = 24) => {
    await login(0);
    const key = id(next++);
    // Historical fixtures predate the deployment; urgent publications use the real trigger.
    const historical = publishedHoursAgo>0 && hours>0;
    if (historical) await db.exec('ALTER TABLE jobs DISABLE TRIGGER jobs_guard_recruitment;');
    try {
    await rows(`WITH schedule AS(SELECT (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')+$2::numeric*interval '1 hour' start)
      INSERT INTO jobs(id,demand_id,restaurant_id,title,description,job_date,start_time,end_time,value,status,created_at)
      SELECT $1,$1,'${id(1)}','Operação','Descrição',start::date,start::time,(start+interval '8 hours')::time,150,'open',
        clock_timestamp()-$3::numeric*interval '1 hour' FROM schedule`, [key,hours,publishedHoursAgo]);
    } finally { if (historical) await db.exec('ALTER TABLE jobs ENABLE TRIGGER jobs_guard_recruitment;'); }
    return key;
  };
  const apply = async (key, worker) => { await login(worker); await rows("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'pending')", [key,id(worker)]); };
  const approve = async (key, worker) => { await login(1); await rows('SELECT approve_demand_candidate($1,$2)', [key,id(worker)]); };
  const available = key => scalar('SELECT recruitment_available(j) FROM jobs j WHERE id=$1', [key]);
  const invite = async (key,worker) => { await login(1); await rows('SELECT invite_demand_worker($1,$2)',[key,id(worker)]); };
  const respond = async (key,worker,replacement = false) => {
    await login(worker);
    const invitation = await scalar(`SELECT id FROM demand_invitations WHERE demand_id=$1 AND worker_id=$2
      AND (replacement_assignment_id IS NOT NULL)=$3`,[key,id(worker),replacement]);
    await rows('SELECT respond_demand_invitation($1,true)',[invitation]);
  };
  const shift = async (key,hours) => {
    await login(0);
    await db.exec('ALTER TABLE jobs DISABLE TRIGGER jobs_guard_recruitment;');
    await rows(`WITH schedule AS(SELECT (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')+$2::numeric*interval '1 hour' start)
      UPDATE jobs SET job_date=start::date,start_time=start::time,end_time=(start+interval '8 hours')::time FROM schedule WHERE id=$1`,[key,hours]);
    await db.exec('ALTER TABLE jobs ENABLE TRIGGER jobs_guard_recruitment;');
  };

  const normal = await job();
  assert.equal(await available(normal),true);
  await apply(normal,2);
  await invite(normal,3);
  await login(0);
  assert.equal(await scalar("SELECT count(*) FROM demand_events WHERE demand_id=$1 AND kind='invitation_sent'",[normal]),1);
  await rows("UPDATE demand_invitations SET created_at=clock_timestamp()-interval '9 hours' WHERE demand_id=$1",[normal]);
  await shift(normal,4);
  await login(5);
  assert.equal((await rows('SELECT id FROM jobs WHERE id=$1',[normal])).length,0);
  await assert.rejects(apply(normal,5),/recrutamento|row-level security/);
  await assert.rejects(invite(normal,4),/vinculados/);
  await respond(normal,3);
  await approve(normal,2);
  await login(0);
  assert.equal(await scalar('SELECT count(*) FROM operational_assignments WHERE job_id=$1',[normal]),1);
  assert.equal(await available(normal),false);
  await assert.rejects(approve(normal,3),/contratação/);
  await login(0);
  await assert.rejects(rows("UPDATE jobs SET status='open' WHERE id=$1",[normal]),/reaberto/);

  const urgent = await job(2,0);
  assert.equal(await available(urgent),true);
  assert.equal(await scalar('SELECT recruitment_closes_at(j)=operational_start(j) FROM jobs j WHERE id=$1',[urgent]),true);
  await apply(urgent,2);
  await invite(urgent,3);
  await shift(urgent,-0.1);
  await assert.rejects(apply(urgent,4),/recrutamento|row-level security/);
  await assert.rejects(respond(urgent,3),/participações/);
  await assert.rejects(approve(urgent,2),/contratação/);
  await login(1);
  assert.equal((await rows('SELECT id FROM jobs WHERE id=$1',[urgent])).length,1);

  const urgentHired = await job(2,0);
  await invite(urgentHired,5);
  await respond(urgentHired,5);
  await login(0);
  assert.equal(await scalar("SELECT status FROM applications WHERE job_id=$1 AND worker_id=$2",[urgentHired,id(5)]),'pending');
  await approve(urgentHired,5);
  await login(0);
  assert.equal(await scalar("SELECT status FROM jobs WHERE id=$1",[urgentHired]),'filled');
  assert.equal(await available(urgentHired),false);
  assert.equal(await scalar(`SELECT recruitment_closes_at(jsonb_populate_record(NULL::jobs,to_jsonb(j) ||
    jsonb_build_object('created_at',operational_start(j)-interval '5 hours')))=operational_start(j)
    FROM jobs j WHERE id=$1`,[urgentHired]),true);

  const atCutoff = await job(5);
  assert.equal(await available(atCutoff),false);
  const justBefore = await job(5.01);
  assert.equal(await available(justBefore),true);
  await login(1);
  const cutoff = await scalar('SELECT recruitment_closes_at(j) FROM jobs j WHERE id=$1',[justBefore]);
  await login(0);
  assert.equal(await scalar('SELECT recruitment_closes_at(j)=operational_start(j)-interval \'5 hours\' FROM jobs j WHERE id=$1',[justBefore]),true);
  assert.ok(cutoff);
  await rows('UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1',[id(5)]);
  await assert.rejects(apply(justBefore,5),/indisponível/);
  await login(0);
  await rows('UPDATE users SET deleted_at=NULL WHERE id=$1',[id(5)]);
  await assert.rejects(rows("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'approved')",
    [justBefore,id(5)]),/aguardar aprovação/);
  await assert.rejects(job(-1),/antes do horário/);

  const racing = await job();
  await apply(racing,2); await apply(racing,3);
  await login(1);
  const attempts = await Promise.allSettled([
    rows('SELECT approve_application($1,$2)',[racing,id(2)]),
    rows('SELECT approve_application($1,$2)',[racing,id(3)]),
  ]);
  assert.equal(attempts.filter(result => result.status==='fulfilled').length,1);
  await login(0);
  assert.equal(await scalar('SELECT count(*) FROM operational_assignments WHERE job_id=$1',[racing]),1);

  const absent = await job();
  await apply(absent,2); await apply(absent,3); await approve(absent,2);
  await shift(absent,-1);
  await login(2);
  await assert.rejects(rows("SELECT interrupt_operational_assignment($1,'absent')",[absent]),/Somente a empresa/);
  await login(1);
  await rows("SELECT interrupt_operational_assignment($1,'absent')",[absent]);
  assert.equal((await scalar('SELECT operational_context($1)',[absent])).phase,'absent');
  await shift(absent,-9);
  await login(1);
  await assert.rejects(rows("SELECT manage_restaurant_demand($1,'seek_replacement')",[absent]),/encerrado/);
  await rows("SELECT manage_restaurant_demand($1,'close_interrupted')",[absent]);
  await login(0);
  assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[absent]),'cancelled');
  assert.equal(await scalar('SELECT count(*) FROM applications WHERE job_id=$1',[absent]),2);

  const cancelled = await job();
  await apply(cancelled,2); await apply(cancelled,3); await approve(cancelled,2);
  await login(2);
  await rows("SELECT interrupt_operational_assignment($1,'cancelled')",[cancelled]);
  await login(0);
  assert.equal(await available(cancelled),false);
  assert.equal(await scalar('SELECT count(*) FROM jobs WHERE demand_id=$1',[cancelled]),1);
  await login(1);
  await rows("SELECT manage_restaurant_demand($1,'seek_replacement')",[cancelled]);
  await invite(cancelled,3); await respond(cancelled,3,true);
  await login(1);
  await rows("SELECT manage_restaurant_demand($1,'close_interrupted')",[cancelled]);
  await assert.rejects(approve(cancelled,3),/contratação|reserva aceita/);
  await assert.rejects(invite(cancelled,4),/vinculados/);

  const replacement = await job();
  await apply(replacement,2); await apply(replacement,3); await apply(replacement,4);
  await invite(replacement,3); await respond(replacement,3);
  await approve(replacement,2);
  await login(2);
  const oldMessage = await scalar("INSERT INTO messages(job_id,sender_id,content) VALUES($1,$2,'Conversa anterior') RETURNING id",[replacement,id(2)]);
  await shift(replacement,-1);
  if (repairGps) await checkGpsSql(replacement,2);
  await login(2);
  if (gps || repairGps) {
    await assert.rejects(scalar("SELECT issue_operational_code($1,'checkin')",[replacement]),/GPS/);
    await assert.rejects(scalar("SELECT issue_operational_code($1,'checkin',1,1)",[replacement]),/100 metros/);
  }
  const code = await issueCheckin(replacement);
  await login(1);
  await rows("SELECT validate_operational_code($1,'checkin',$2)",[replacement,code.code]);
  assert.equal(await scalar("SELECT interrupt_operational_assignment($1,'abandoned')",[replacement]),replacement);
  await login(0);
  assert.equal(await scalar('SELECT count(*) FROM jobs WHERE demand_id=$1',[replacement]),1);
  assert.equal(await available(replacement),false);
  await assert.rejects(invite(replacement,3),/vinculados/);
  await login(1);
  await rows("SELECT manage_restaurant_demand($1,'seek_replacement')",[replacement]);
  await assert.rejects(invite(replacement,5),/vinculados/);
  await invite(replacement,3);
  await assert.rejects(approve(replacement,3),/contratação/);
  await respond(replacement,3,true);
  await login(0);
  assert.equal(await scalar("SELECT count(*) FROM applications WHERE job_id=$1 AND status='approved'",[replacement]),0);
  await approve(replacement,3);
  await login(0);
  assert.equal(await scalar('SELECT count(*) FROM operational_assignments WHERE job_id=$1',[replacement]),2);
  assert.equal(await scalar("SELECT count(*) FROM operational_assignments WHERE job_id=$1 AND interruption='abandoned'",[replacement]),1);
  await login(2);
  assert.equal((await scalar('SELECT operational_context($1)',[replacement])).phase,'abandoned');
  await assert.rejects(issueCheckin(replacement),/indisponível/);
  await login(3);
  assert.equal((await rows('SELECT id FROM messages WHERE job_id=$1',[replacement])).length,0);
  await assert.rejects(rows('SELECT get_chat_message_preview($1)',[oldMessage]),/autorizada/);
  await rows("INSERT INTO messages(job_id,sender_id,content) VALUES($1,$2,'Conversa da reserva')",[replacement,id(3)]);
  await login(1);
  const directory = await rows('SELECT * FROM demand_talent_directory($1)',[replacement]);
  assert.equal(directory.filter(person => person.id===id(3)).length,1);
  const inbox = await rows('SELECT * FROM restaurant_operational_message_inbox()');
  assert.equal(inbox.find(item => item.job_id===replacement).latest_message,'Conversa da reserva');
  assert.equal(inbox.find(item => item.job_id===replacement).unread_count,1);
  if (repairGps) await checkGpsSql(replacement,3);
  await login(3);
  const successorCode = await issueCheckin(replacement);
  await login(1);
  await rows("SELECT validate_operational_code($1,'checkin',$2)",[replacement,successorCode.code]);
  await login(0);
  assert.equal(await scalar('SELECT count(*) FROM checkins WHERE job_id=$1',[replacement]),2);
  await shift(replacement,-9);
  await login(1);
  await rows("SELECT record_operational_payment($1,'paid')",[replacement]);
  await login(3);
  await rows("SELECT record_operational_payment($1,'received')",[replacement]);
  await login(1);
  const checkout = await scalar("SELECT issue_operational_code($1,'checkout')",[replacement]);
  if (repairGps) {
    const checkoutWithGps = await scalar(`SELECT issue_operational_code(
      p_job_id=>$1,p_stage=>'checkout',p_latitude=>'NaN'::float8,p_longitude=>'Infinity'::float8)`,[replacement]);
    assert.deepEqual(checkoutWithGps,checkout,'checkout ignores GPS and reuses the legacy two-argument token');
  }
  await login(3);
  assert.equal((await scalar("SELECT validate_operational_code($1,'checkout',$2)",[replacement,checkout.code])).phase,'completed');
  await login(0);
  assert.equal(await scalar("SELECT count(*) FROM operational_assignments WHERE job_id=$1 AND interruption='abandoned'",[replacement]),1);
  assert.equal(await available(replacement),false);
  await login(2);
  assert.equal((await scalar('SELECT worker_operational_reputation($1)',[id(2)])).abandonments_180d,1);
  await login(3);
  assert.equal((await scalar('SELECT worker_operational_reputation($1)',[id(3)])).completed,1);
  if (repairGps) {
    await login(0);
    const reviewCompleted = async key => {
      await login(0);
      await rows(`INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again)
        VALUES($1,$2,$3,$2,$3,5,true),($1,$2,$3,$3,$2,5,true)`,[key,id(1),id(3)]);
    };
    await reviewCompleted(replacement);
    await db.exec(`
      ALTER TABLE jobs ADD COLUMN location_status text NOT NULL DEFAULT 'ready',
        ADD COLUMN work_number text, ADD COLUMN work_postal_code text, ADD COLUMN work_location_id uuid,
        ADD COLUMN event_id uuid, ADD COLUMN location_source text DEFAULT 'catalog';
    `);
    await db.exec(source('20261015060000_work_locations_catalog.sql'));
    await db.exec(source('20261104040000_reconcile_geocoded_locations.sql'));
    await db.exec(source('20261104200000_geocoding_cache.sql'));
    await db.exec(source('20261104210000_operational_location_readiness.sql'));
    const secured = await job();
    await apply(secured,2); await apply(secured,3); await approve(secured,2);
    await login(2);
    await rows("SELECT interrupt_operational_assignment($1,'cancelled')",[secured]);
    await login(1);
    await rows("SELECT manage_restaurant_demand($1,'seek_replacement')",[secured]);
    await invite(secured,3); await respond(secured,3,true); await approve(secured,3);
    await shift(secured,-1);
    await login(3);
    await assert.rejects(scalar("SELECT issue_operational_code($1,'checkin',1,1)",[secured]),/100 metros/);
    const securedCode = await issueCheckin(secured);
    await login(1);
    await rows("SELECT validate_operational_code($1,'checkin',$2)",[secured,securedCode.code]);
    await shift(secured,-9);
    await login(1); await rows("SELECT record_operational_payment($1,'paid')",[secured]);
    await login(3); await rows("SELECT record_operational_payment($1,'received')",[secured]);
    await login(1);
    const securedCheckout = await scalar("SELECT issue_operational_code($1,'checkout')",[secured]);
    await login(3);
    assert.equal((await scalar("SELECT validate_operational_code($1,'checkout',$2)",
      [secured,securedCheckout.code])).phase,'completed');
    await reviewCompleted(secured);
    const invalid = await job();
    await apply(invalid,2); await apply(invalid,3);
    // Simulate an existing pre-migration invalid job without changing real data.
    await login(0);
    await db.exec('ALTER TABLE jobs DISABLE TRIGGER jobs_guard_operational_location');
    await rows("UPDATE jobs SET work_latitude=NULL,work_longitude=NULL,location_status='pending_coordinates' WHERE id=$1",[invalid]);
    await db.exec('ALTER TABLE jobs ENABLE TRIGGER jobs_guard_operational_location');
    await assert.rejects(approve(invalid,2),/contratação|coordenadas|reserva aceita/);
    await assert.rejects(invite(invalid,4),/vinculados|coordenadas/);
    await assert.rejects(apply(invalid,4),/recrutamento|row-level security|coordenadas/);
    await login(0);
    await assert.rejects(rows("UPDATE applications SET status='approved' WHERE job_id=$1 AND worker_id=$2",[invalid,id(2)]),
      /coordenadas válidas/);
    await rows("UPDATE jobs SET status='cancelled' WHERE id=$1",[invalid]);
  }
});
}
}
