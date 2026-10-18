import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('operational codes, payment, interruptions, review gates and reputation execute in PostgreSQL', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE users(id uuid PRIMARY KEY,role text,name text,deleted_at timestamptz);
    INSERT INTO users VALUES ('${id(1)}','restaurant','Empresa',NULL),('${id(2)}','worker','Ana',NULL),
      ('${id(3)}','restaurant','Outra',NULL),('${id(4)}','worker','Bruno',NULL);
    CREATE TYPE job_status AS ENUM('open','filled','completed','cancelled');
    CREATE TYPE application_status AS ENUM('pending','approved','in_progress','completed','rejected');
    CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid DEFAULT gen_random_uuid(),
      restaurant_id uuid REFERENCES users(id),title text,job_date date,start_time time,end_time time,
      value numeric,status job_status,location_name text,work_address text,created_at timestamptz DEFAULT now(),demand_archived_at timestamptz);
    CREATE TABLE applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid REFERENCES jobs(id),
      worker_id uuid REFERENCES users(id),status application_status,UNIQUE(job_id,worker_id));
    CREATE TABLE checkins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid UNIQUE REFERENCES jobs(id),worker_id uuid,checkin_time timestamptz);
    CREATE TABLE checkouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid UNIQUE REFERENCES jobs(id),worker_id uuid,checkout_time timestamptz);
    ALTER TABLE users ADD COLUMN score numeric;
    CREATE TABLE privacy_preferences(user_id uuid,show_score boolean);
    INSERT INTO privacy_preferences VALUES('${id(2)}',true),('${id(4)}',false);
    CREATE TABLE demand_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid,kind text,
      worker_id uuid,source_key text UNIQUE,occurred_at timestamptz);
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,message text,category text,url text);
    CREATE FUNCTION record_demand_event(uuid,text,uuid,text,timestamptz DEFAULT now()) RETURNS void LANGUAGE sql AS
      $$ INSERT INTO public.demand_events(demand_id,kind,worker_id,source_key,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING $$;
    CREATE FUNCTION register_worker_checkin(uuid,double precision,double precision) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION register_worker_checkout(uuid,double precision,double precision) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION export_own_account_data() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE FUNCTION demand_talent_directory(uuid,uuid DEFAULT NULL,integer DEFAULT 0,integer DEFAULT 50,boolean DEFAULT false)
      RETURNS TABLE(id uuid,name text,specialties text[],score numeric,photo_path text,experience text,categories text[],completed_operations bigint,invitation_status text)
      LANGUAGE sql AS $$ SELECT id,name,ARRAY[]::text[],NULL::numeric,NULL::text,NULL::text,ARRAY[]::text[],0::bigint,NULL::text FROM users WHERE role='worker' $$;
    GRANT SELECT,INSERT ON jobs,applications TO authenticated;
    GRANT SELECT ON checkins,checkouts,demand_events,notifications TO authenticated;
  `);
  await db.exec(source('20261014035000_job_reviews.sql'));
  await db.exec(source('20261017030000_operational_trust.sql'));
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];
  const login = async (n) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${n ? id(n) : ''}'; SET ROLE authenticated;`);
  let counter = 10;
  const hire = async ({ worker = 2, restaurant = 1, date = 'today', start = '00:00', end = '00:01' } = {}) => {
    await db.exec('RESET ROLE');
    const job = id(counter++);
    await query(`INSERT INTO jobs(id,demand_id,restaurant_id,title,job_date,start_time,end_time,value,status)
      VALUES($1,$1,$2,'Operação', (now() AT TIME ZONE 'America/Sao_Paulo')::date + $3::integer,$4,$5,150,'filled')`,
    [job,id(restaurant), date === 'tomorrow' ? 1 : date === 'yesterday' ? -1 : 0,start,end]);
    await query("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'pending')", [job,id(worker)]);
    await query("UPDATE applications SET status='approved' WHERE job_id=$1", [job]);
    return job;
  };
  const context = (job) => scalar('SELECT operational_context($1)', [job]);
  const issue = (job, stage) => scalar('SELECT issue_operational_code($1,$2)', [job,stage]);
  const validate = (job, stage, code) => scalar('SELECT validate_operational_code($1,$2,$3)', [job,stage,code]);
  const pay = (job, action) => scalar('SELECT record_operational_payment($1,$2)', [job,action]);
  const reputation = (worker = 2) => scalar('SELECT worker_operational_reputation($1)', [id(worker)]);
  const first = await hire({ date:'yesterday' });
  await login(2);
  assert.equal((await reputation()).score,70);
  const checkin = await issue(first,'checkin');
  assert.match(checkin.code,/^[A-F0-9]{8}$/);
  assert.equal((await issue(first,'checkin')).code,checkin.code);
  await assert.rejects(validate(first,'checkin',checkin.code),/Somente a empresa/);
  await login(3);
  await assert.rejects(context(first),/indisponível/);
  await assert.rejects(issue(first,'checkin'),/indisponível/);
  await login(1);
  assert.equal((await context(first)).code,null);
  assert.match((await validate(first,'checkin','WRONG')).error,/incorreto/);
  for (let i=0;i<4;i++) await validate(first,'checkin','WRONG');
  assert.match((await validate(first,'checkin',checkin.code)).error,/tentativas/);
  await db.exec("RESET ROLE; UPDATE operational_codes SET blocked_until=now()-interval '1 second',attempts=0");
  await login(1);
  await db.exec("RESET ROLE; UPDATE operational_codes SET expires_at=now()-interval '1 second'");
  await login(1);
  assert.match((await validate(first,'checkin',checkin.code)).error,/expirado/);
  await login(2);
  const renewed = await issue(first,'checkin');
  assert.match(renewed.code,/^[A-F0-9]{8}$/);
  await login(1);
  const arrived = await validate(first,'checkin',renewed.code);
  assert.ok(arrived.checkin_at);
  assert.equal(await scalar('SELECT count(*) FROM checkins WHERE job_id=$1',[first]),1);
  await assert.rejects(validate(first,'checkin',checkin.code),/Somente a empresa/);
  await login(2);
  await assert.rejects(issue(first,'checkout'),/após o profissional/);
  await assert.rejects(pay(first,'received'),/não autorizada/);
  await login(1);
  await pay(first,'paid');
  await login(2);
  const disputed = await pay(first,'not_received');
  assert.equal(disputed.phase,'payment_disputed');
  await assert.rejects(issue(first,'checkout'),/após o profissional/);
  await login(1);
  await pay(first,'paid');
  await login(2);
  const received = await pay(first,'received');
  assert.equal(received.phase,'checkout');
  assert.equal(received.code,null);
  assert.equal((await context(first)).code,null);
  await login(1);
  const checkout = await context(first);
  assert.match(checkout.code,/^[A-F0-9]{8}$/);
  await assert.rejects(validate(first,'checkout',checkout.code),/recebimento/);
  await login(2);
  const finished = await validate(first,'checkout',checkout.code);
  assert.equal(finished.phase,'completed');
  assert.equal(finished.review_pending,true);
  assert.equal((await query('SELECT * FROM pending_operational_reviews()')).length,1);
  await assert.rejects(query("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'pending')",[first,id(2)]),/Antes de se candidatar/);
  await login(1);
  await assert.rejects(query("INSERT INTO jobs(restaurant_id,value) VALUES($1,100)",[id(1)]),/Antes de criar/);
  assert.ok((await context(first)).checkout_at);
  await login(3);
  await assert.rejects(query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$4,$3,5,true)',[first,id(1),id(2),id(3)]),/row-level security/);
  await login(2);
  await assert.rejects(query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating) VALUES($1,$2,$3,$3,$2,5)',[first,id(1),id(2)]),/trabalharia novamente/);
  await db.exec('RESET ROLE');
  await query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$3,$2,$3,$2,5,true),($1,$3,$2,$2,$3,5,true)',[first,id(2),id(1)]);
  await login(2);
  assert.equal((await query('SELECT * FROM pending_operational_reviews()')).length,0);
  assert.equal((await reputation()).completed,1);
  assert.equal((await reputation()).classification,'Em Desenvolvimento');
  await assert.rejects(query('SELECT * FROM operational_codes'),/permission denied/);
  await assert.rejects(query("UPDATE operational_assignments SET receipt_confirmed_at=now()"),/permission denied/);
  await assert.rejects(query('SELECT register_worker_checkout($1,0,0)',[first]),/permission denied/);
  const tomorrow = await hire({ date:'tomorrow' });
  await login(2);
  assert.equal((await context(tomorrow)).phase,'confirmed');
  await assert.rejects(issue(tomorrow,'checkin'),/no dia/);
  const absence = await hire({ date:'yesterday' });
  await login(1);
  assert.equal((await context(absence)).phase,'absence_pending');
  await db.exec('RESET ROLE');
  await query('SELECT process_operational_schedule()');
  const notices = await scalar('SELECT count(*) FROM notifications');
  await query('SELECT process_operational_schedule()');
  assert.equal(await scalar('SELECT count(*) FROM notifications'),notices);
  await login(1);
  const replacement = await scalar("SELECT interrupt_operational_assignment($1,'absent')",[absence]);
  assert.notEqual(replacement,absence);
  assert.equal(await scalar('SELECT status FROM jobs WHERE id=$1',[replacement]),'open');
  assert.equal(await scalar('SELECT demand_id FROM jobs WHERE id=$1',[replacement]),absence);
  await login(2);
  await assert.rejects(issue(absence,'checkin'),/indisponível/);
  assert.equal((await reputation()).absences,1);
  const late = await hire({ date:'yesterday' });
  await login(2);
  const lateCode = (await issue(late,'checkin')).code;
  await login(1);
  await validate(late,'checkin',lateCode);
  assert.equal((await context(late)).phase,'payment');
  const pending = await scalar("SELECT count(*) FROM demand_events WHERE kind='late'");
  assert.ok(pending>0);
  const overnight = await hire({ start:'23:00',end:'00:00', date:'tomorrow' });
  await login(2);
  const overnightContext = await context(overnight);
  assert.equal(new Date(overnightContext.ends_at)-new Date(overnightContext.starts_at),3600000);
  await login(4);
  assert.equal(await reputation(2) !== null,true);
  await login(1);
  assert.equal(await reputation(4),null);
  await login(4);
  assert.equal((await reputation(4)).score,70);
  const completions = [];
  for (let i=0;i<5;i++) {
    const job = await hire({ worker:4,restaurant:3,date:'yesterday',start:'12:00',end:'13:00' });
    await db.exec('RESET ROLE');
    await query(`UPDATE operational_assignments SET
      checkin_at=(SELECT operational_start(j) FROM jobs j WHERE j.id=$1)+$2::interval,
      paid_at=now()-interval '1 minute',receipt_confirmed_at=now()-interval '30 seconds',checkout_at=now()
      WHERE job_id=$1`,[job,i===0 ? '-10 minutes' : i===1 ? '5 minutes' : i===2 ? '6 minutes' : '0 minutes']);
    await query("UPDATE applications SET status='completed' WHERE job_id=$1",[job]);
    await query("UPDATE jobs SET status='completed' WHERE id=$1",[job]);
    await query('INSERT INTO checkouts(job_id,worker_id,checkout_time) VALUES($1,$2,now())',[job,id(4)]);
    await query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$2,$3,5,true),($1,$2,$3,$3,$2,5,true)',[job,id(3),id(4)]);
    completions.push(job);
    await login(4);
    if (i<4) assert.equal((await reputation(4)).score,70);
  }
  await login(4);
  const full = await reputation(4);
  assert.equal(full.completed,5);
  assert.equal(full.early,1);
  assert.equal(full.on_time,3);
  assert.equal(full.late,1);
  assert.equal(full.punctuality,80);
  assert.equal(full.rehires,4);
  assert.equal(full.score,96.5);
  assert.equal(full.classification,'Excelente');
  const abandonedJobs = [];
  for (let total=1;total<=5;total++) {
    const job = await hire({worker:4,restaurant:3,date:'yesterday'});
    abandonedJobs.push(job);
    await db.exec('RESET ROLE');
    await query("UPDATE operational_assignments SET checkin_at=(SELECT operational_start(j) FROM jobs j WHERE j.id=$1)+interval '6 minutes',interruption='abandoned',interrupted_at=now() WHERE job_id=$1",[job]);
    await login(4);
    const result = await reputation(4);
    const expected = Math.round((5/(5+total)*35 + (470+total*70)/(5+total)*0.25 + 5/(5+total)*15 + 10 + 10 + 5 - Math.min(total,3)*10)*100)/100;
    assert.equal(result.score,expected);
    assert.equal(result.abandonments_180d,total);
  }
  await db.exec('RESET ROLE');
  await query("UPDATE operational_assignments SET interrupted_at=now()-interval '181 days' WHERE job_id=ANY($1::uuid[])",[abandonedJobs]);
  await login(4);
  assert.equal((await reputation(4)).abandonments_180d,0);
  await db.exec('RESET ROLE');
  await query('DELETE FROM applications WHERE job_id=ANY($1::uuid[])',[abandonedJobs]);
  await query('DELETE FROM jobs WHERE id=ANY($1::uuid[])',[abandonedJobs]);
  for (const count of [2,3,4,5,6,7]) {
    await db.exec('RESET ROLE');
    const current = Number(await scalar("SELECT count(*) FROM operational_assignments WHERE worker_id=$1 AND job_id<>ALL($2::uuid[])",[id(4),completions]));
    for (let i=current;i<count;i++) {
      const job = await hire({worker:4,restaurant:3,date:'yesterday'});
      await login(3);
      await scalar("SELECT interrupt_operational_assignment($1,'cancelled')",[job]);
    }
    await login(4);
    const rep = await reputation(4);
    assert.equal(rep.cancellations_90d,count);
    const cancellationComponent = count<=2 ? 100 : count<=4 ? 80 : count<=6 ? 60 : 40;
    const expected = Math.round((5/(5+count)*35 + 470/(5+count)*0.25 + 5/(5+count)*15 + 10 + 10 + cancellationComponent*0.05)*100)/100;
    assert.equal(rep.score,expected);
  }
  await db.exec('RESET ROLE');
  await query("UPDATE operational_assignments SET interrupted_at=now()-interval '91 days' WHERE worker_id=$1 AND interruption='cancelled'",[id(4)]);
  await login(4);
  assert.equal((await reputation(4)).cancellations_90d,0);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(context(first),/permission denied/);
  await assert.rejects(query('SELECT process_operational_schedule()'),/permission denied/);
});
