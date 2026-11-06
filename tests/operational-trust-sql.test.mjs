import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('operational codes, trust and learning geolocation rules execute in PostgreSQL', async (t) => {
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
      ('${id(3)}','restaurant','Outra',NULL),('${id(4)}','worker','Bruno',NULL),
      ('${id(98)}','restaurant','Terceira',NULL),('${id(99)}','worker','Carla',NULL);
    CREATE TYPE job_status AS ENUM('open','filled','completed','cancelled');
    CREATE TYPE application_status AS ENUM('pending','approved','in_progress','completed','rejected');
    CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),demand_id uuid DEFAULT gen_random_uuid(),
      restaurant_id uuid REFERENCES users(id),title text,job_date date,start_time time,end_time time,
      value numeric,status job_status,location_name text,work_address text,created_at timestamptz DEFAULT now(),demand_archived_at timestamptz,
      work_latitude double precision DEFAULT 0,work_longitude double precision DEFAULT 0,
      latitude double precision DEFAULT 60,longitude double precision DEFAULT 60);
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
  await db.exec(source('20261019030000_checkin_gps.sql'));
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];
  const login = async (n) => db.exec(`RESET ROLE; SET request.jwt.claim.sub='${n ? id(n) : ''}'; SET ROLE authenticated;`);
  const reviewPending = async (job) => scalar(
    'SELECT EXISTS(SELECT 1 FROM pending_operational_reviews() WHERE job_id=$1)',
    [job],
  );
  const reviewedRating = async (job) => scalar(
    'SELECT existing_rating FROM get_review_context_with_participants($1)',
    [job],
  );
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
  const issue = (job, stage) => stage === 'checkin'
    ? scalar('SELECT issue_operational_code($1,$2,$3,$4)', [job,stage,0,0])
    : scalar('SELECT issue_operational_code($1,$2)', [job,stage]);
  const issueAt = (job, latitude, longitude) =>
    scalar("SELECT issue_operational_code($1,'checkin',$2,$3)", [job,latitude,longitude]);
  const validate = (job, stage, code) => scalar('SELECT validate_operational_code($1,$2,$3)', [job,stage,code]);
  const pay = (job, action) => scalar('SELECT record_operational_payment($1,$2)', [job,action]);
  const reputation = (worker = 2) => scalar('SELECT worker_operational_reputation($1)', [id(worker)]);
  const first = await hire({ date:'yesterday' });
  await login(2);
  assert.equal((await reputation()).score,70);
  assert.equal(await scalar("SELECT to_regprocedure('public.issue_operational_code(uuid,text)')"), null);
  const notificationsBeforeGps = await scalar('SELECT count(*) FROM notifications');
  await assert.rejects(scalar("SELECT issue_operational_code($1,'checkin')", [first]), /localização válida/);
  for (const [latitude, longitude] of [
    [null, 0], [0, null], [91, 0], [-91, 0], [0, 181], [0, -181],
    [NaN, 0], [0, NaN], [Infinity, 0], [-Infinity, 0], [0, Infinity], [0, -Infinity],
  ]) {
    await assert.rejects(issueAt(first, latitude, longitude), /localização válida/);
  }
  const latitudeAt = (meters) => meters / 6371000 * 180 / Math.PI;
  await assert.rejects(issueAt(first, latitudeAt(100.001), 0), /raio de 100 metros/);
  await assert.rejects(issueAt(first, latitudeAt(300), 0), /raio de 100 metros/);
  for (const [latitude, longitude] of [[null, 0], [0, null], [NaN, 0], [0, Infinity], [91, 0], [0, 181]]) {
    await db.exec('RESET ROLE');
    await query('UPDATE jobs SET work_latitude=$2,work_longitude=$3 WHERE id=$1', [first,latitude,longitude]);
    await login(2);
    await assert.rejects(issueAt(first, 0, 0), /operação não possui coordenadas válidas/);
  }
  assert.equal(await scalar('SELECT count(*) FROM notifications'), notificationsBeforeGps);
  assert.equal((await context(first)).has_code, false);
  assert.equal((await context(first)).checkin_at, null);
  await db.exec('RESET ROLE');
  assert.equal(await scalar('SELECT count(*) FROM operational_codes'), 0);
  await query('UPDATE jobs SET work_latitude=0,work_longitude=0 WHERE id=$1', [first]);
  await login(2);
  const boundaryCode = (await issueAt(first, latitudeAt(100), 0)).code;
  assert.match(boundaryCode, /^[A-F0-9]{8}$/);
  assert.equal((await issueAt(first, latitudeAt(99.999), 0)).code, boundaryCode);
  await assert.rejects(issueAt(first, latitudeAt(100.001), 0), /raio de 100 metros/);
  const checkin = await issue(first,'checkin');
  assert.equal(checkin.code, boundaryCode);
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
  await db.exec('RESET ROLE');
  await query('UPDATE jobs SET work_latitude=NULL,work_longitude=NULL WHERE id=$1', [first]);
  await query("UPDATE operational_codes SET expires_at=now()-interval '1 second' WHERE stage='checkout'");
  await login(1);
  const renewedCheckout = await issue(first, 'checkout');
  assert.match(renewedCheckout.code, /^[A-F0-9]{8}$/);
  assert.equal((await scalar("SELECT issue_operational_code($1,'checkout',$2,$3)", [first,NaN,Infinity])).code, renewedCheckout.code);
  await assert.rejects(validate(first,'checkout',checkout.code),/recebimento/);
  await login(2);
  const finished = await validate(first,'checkout',renewedCheckout.code);
  assert.equal(finished.phase,'completed');
  assert.equal(finished.review_pending,true);
  assert.equal((await query('SELECT * FROM pending_operational_reviews()')).length,1);
  await assert.rejects(query("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'pending')",[first,id(2)]),/Antes de se candidatar/);
  await login(1);
  await assert.rejects(query("INSERT INTO jobs(restaurant_id,value) VALUES($1,100)",[id(1)]),/Antes de criar/);
  assert.ok((await context(first)).checkout_at);
  assert.equal((await context(first)).review_pending, true);
  assert.equal(await reviewPending(first), true);
  assert.equal(await reviewedRating(first), null);
  await login(3);
  await assert.rejects(query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$4,$3,5,true)',[first,id(1),id(2),id(3)]),/row-level security/);
  await login(2);
  await assert.rejects(query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating) VALUES($1,$2,$3,$3,$2,5)',[first,id(1),id(2)]),/trabalharia novamente/);
  await query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$3,$2,5,true)',[first,id(1),id(2)]);
  assert.equal((await context(first)).review_pending, false);
  assert.equal(await reviewPending(first), false);
  assert.equal(await reviewedRating(first), 5);
  await assert.rejects(
    query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$3,$2,4,true)',[first,id(1),id(2)]),
    /duplicate key value violates unique constraint/,
  );
  await login(1);
  assert.equal((await context(first)).review_pending, true);
  assert.equal(await reviewPending(first), true);
  assert.equal(await reviewedRating(first), null);
  await query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$2,$3,4,true)',[first,id(1),id(2)]);
  assert.equal((await context(first)).review_pending, false);
  assert.equal(await reviewPending(first), false);
  assert.equal(await reviewedRating(first), 4);
  assert.equal(await scalar('SELECT count(*) FROM reviews WHERE job_id=$1',[first]), 2);
  await assert.rejects(
    query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$2,$3,3,true)',[first,id(1),id(2)]),
    /duplicate key value violates unique constraint/,
  );
  await login(2);
  assert.equal((await context(first)).review_pending, false);
  assert.equal(await reviewPending(first), false);
  assert.equal(await reviewedRating(first), 5);
  assert.equal((await query('SELECT * FROM pending_operational_reviews()')).length,0);
  assert.equal((await reputation()).completed,1);
  assert.equal((await reputation()).classification,'Em Desenvolvimento');
  const restaurantOnly = await hire({ worker:99, restaurant:98, date:'yesterday' });
  await db.exec('RESET ROLE');
  await query(`UPDATE operational_assignments SET checkin_at=now()-interval '1 hour',checkout_at=now()
    WHERE job_id=$1`, [restaurantOnly]);
  await query("UPDATE applications SET status='completed' WHERE job_id=$1", [restaurantOnly]);
  await query("UPDATE jobs SET status='completed' WHERE id=$1", [restaurantOnly]);
  await query('INSERT INTO checkouts(job_id,worker_id,checkout_time) VALUES($1,$2,now())', [restaurantOnly,id(99)]);
  await login(98);
  assert.equal((await context(restaurantOnly)).review_pending, true);
  assert.equal(await reviewPending(restaurantOnly), true);
  assert.equal(await reviewedRating(restaurantOnly), null);
  await query('INSERT INTO reviews(job_id,restaurant_id,worker_id,reviewer_id,reviewed_id,rating,would_work_again) VALUES($1,$2,$3,$2,$3,4,true)',[restaurantOnly,id(98),id(99)]);
  assert.equal((await context(restaurantOnly)).review_pending, false);
  assert.equal(await reviewPending(restaurantOnly), false);
  assert.equal(await reviewedRating(restaurantOnly), 4);
  await login(99);
  assert.equal((await context(restaurantOnly)).review_pending, true);
  assert.equal(await reviewPending(restaurantOnly), true);
  assert.equal(await reviewedRating(restaurantOnly), null);
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

  await db.exec('RESET ROLE');
  await db.exec(`
    INSERT INTO users(id,role,name,deleted_at) VALUES
      ('${id(20)}','restaurant','Local de teste',NULL),
      ('${id(5)}','worker','Profissional 5',NULL),('${id(6)}','worker','Profissional 6',NULL),
      ('${id(7)}','worker','Profissional 7',NULL),('${id(8)}','worker','Profissional 8',NULL),
      ('${id(9)}','worker','Profissional 9',NULL),('${id(10)}','worker','Profissional 10',NULL);
    INSERT INTO privacy_preferences(user_id,show_score)
      VALUES('${id(5)}',true),('${id(6)}',true),('${id(7)}',true),('${id(8)}',true),('${id(9)}',true),('${id(10)}',true);
    ALTER TABLE jobs ADD COLUMN work_location_id uuid,
      ADD COLUMN location_source_version integer,
      ADD COLUMN location_source text NOT NULL DEFAULT 'catalog',
      ADD COLUMN location_status text NOT NULL DEFAULT 'ready';
    CREATE TABLE work_locations(
      id uuid PRIMARY KEY, restaurant_id uuid, name text, address text, number text, neighborhood text,
      city text, state text, postal_code text, is_default boolean DEFAULT false, kind text DEFAULT 'permanent',
      valid_until date, archived_at timestamptz, address_version integer NOT NULL DEFAULT 1,
      revision integer NOT NULL DEFAULT 1, geocoding_status text NOT NULL, geocoding_precision text,
      coordinate_source text, latitude double precision, longitude double precision,
      candidate_latitude double precision, candidate_longitude double precision, candidate_accuracy double precision,
      candidate_sample_count integer DEFAULT 0, candidate_worker_count integer DEFAULT 0,
      candidate_job_count integer DEFAULT 0, device_verified_at timestamptz, geocoded_address jsonb,
      geocoding_error_code text, confirmed_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE ON work_locations TO authenticated;
    CREATE TABLE events(
      id uuid PRIMARY KEY, restaurant_id uuid, revision integer, work_location_id uuid,
      location_status text, location_source_version integer, event_latitude double precision,
      event_longitude double precision
    );
    CREATE FUNCTION participant_assignment(p_job_id uuid) RETURNS public.operational_assignments
      LANGUAGE sql STABLE AS $$
        SELECT * FROM public.operational_assignments WHERE job_id=p_job_id LIMIT 1
      $$;
    CREATE FUNCTION create_restaurant_job(
      p_title text,p_description text,p_job_date date,p_start_time time,p_end_time time,
      p_value numeric,p_location_source text,p_work_location_id uuid,p_location_revision integer,
      p_event_id uuid,p_event_revision integer
    ) RETURNS public.jobs LANGUAGE plpgsql AS $$
    DECLARE location public.work_locations; saved public.jobs;
    BEGIN
      SELECT * INTO STRICT location FROM public.work_locations WHERE id=p_work_location_id;
      INSERT INTO public.jobs(restaurant_id,title,job_date,start_time,end_time,value,status,location_name,
        work_address,work_location_id,location_source,location_status,location_source_version,
        work_latitude,work_longitude)
      VALUES(auth.uid(),p_title,p_job_date,p_start_time,p_end_time,p_value,'open',location.name,
        location.address,location.id,p_location_source,'pending_coordinates',location.address_version,
        location.latitude,location.longitude) RETURNING * INTO saved;
      RETURN saved;
    END $$;
  `);
  await db.exec(source('20261105030000_learning_operational_geolocation.sql'));

  const streetLocation = id(80);
  const calibrationLocation = id(81);
  const houseLocation = id(82);
  const pendingLocation = id(83);
  await query(`INSERT INTO work_locations(id,restaurant_id,name,address,number,neighborhood,city,state,postal_code,
    is_default,geocoding_status,geocoding_precision,candidate_latitude,candidate_longitude)
    VALUES($1,$3,'Rua provisória','Rua das Flores','120','Centro','São Paulo','SP','01001000',true,'needs_review','street',0,0),
      ($2,$3,'Rua de calibração','Avenida Central','200','Centro','São Paulo','SP','01001000',false,'resolved','street',1,1)`,
  [streetLocation,calibrationLocation,id(20)]);
  await query(`INSERT INTO work_locations(id,restaurant_id,name,address,number,neighborhood,city,state,postal_code,
    is_default,geocoding_status,geocoding_precision,candidate_latitude,candidate_longitude)
    VALUES($1,$3,'Imóvel localizado','Rua das Flores','120','Centro','São Paulo','SP','01001000',false,'needs_review','house',2,2),
      ($2,$3,'Local pendente','Rua sem resultado','10','Centro','São Paulo','SP','01001000',false,'needs_review',NULL,NULL,NULL)`,
  [houseLocation,pendingLocation,id(20)]);
  const todayDate = await scalar("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text");
  await login(20);
  const publishedDemand = await scalar(`SELECT create_restaurant_demand(
    'Garçom','Detalhes',$1::date,'00:00','23:59',150,'catalog',$2,1,NULL,NULL)`,[todayDate,streetLocation]);
  const publishedJob = await scalar('SELECT id FROM jobs WHERE demand_id=$1',[publishedDemand]);
  const publishedSnapshot = await query('SELECT location_status,work_latitude,work_longitude FROM jobs WHERE id=$1',[publishedJob]);
  assert.equal(publishedSnapshot[0].location_status,'ready');
  assert.equal(publishedSnapshot[0].work_latitude,0);
  assert.equal((await scalar('SELECT geocoding_status FROM work_locations WHERE id=$1',[streetLocation])),'needs_review');
  const houseDemand = await scalar(`SELECT create_restaurant_demand(
    'Cozinheiro','Detalhes',$1::date,'00:00','23:59',150,'catalog',$2,1,NULL,NULL)`,[todayDate,houseLocation]);
  const housePublishedJob = await scalar('SELECT id FROM jobs WHERE demand_id=$1',[houseDemand]);
  const housePublishedSnapshot = await query('SELECT location_status,work_latitude,work_longitude FROM jobs WHERE id=$1',[housePublishedJob]);
  assert.equal(housePublishedSnapshot[0].location_status,'ready');
  assert.equal(housePublishedSnapshot[0].work_latitude,2);
  assert.equal(housePublishedSnapshot[0].work_longitude,2);
  const legacyStreetDemand = await scalar(`SELECT create_restaurant_demand(
    'Auxiliar','Detalhes',$1::date,'00:00','23:59',150,'catalog',$2,1,NULL,NULL)`,[todayDate,calibrationLocation]);
  const legacyStreetJob = await scalar('SELECT id FROM jobs WHERE demand_id=$1',[legacyStreetDemand]);
  const legacyStreetSnapshot = await query('SELECT location_status,work_latitude,work_longitude FROM jobs WHERE id=$1',[legacyStreetJob]);
  assert.equal(legacyStreetSnapshot[0].location_status,'ready');
  assert.equal(legacyStreetSnapshot[0].work_latitude,1);
  assert.equal(legacyStreetSnapshot[0].work_longitude,1);
  await assert.rejects(scalar(`SELECT create_restaurant_demand(
    'Garçom','Detalhes',$1::date,'00:00','23:59',150,'catalog',$2,1,NULL,NULL)`,[todayDate,pendingLocation]),
  /não possui coordenadas operacionais/);
  assert.equal(await scalar('SELECT geocoding_status FROM work_locations WHERE id=$1',[houseLocation]),'needs_review');
  await db.exec('RESET ROLE');

  const makeLearningJob = async (worker, locationId, counterValue) => {
    const job = id(counterValue);
    await db.exec('RESET ROLE');
    await query(`INSERT INTO jobs(id,demand_id,restaurant_id,title,job_date,start_time,end_time,value,status,
      location_name,work_address,work_location_id,location_source,location_status,location_source_version,
      work_latitude,work_longitude)
      SELECT $1,$1,$2,'Operação de teste',$3::date,'00:00','23:59',150,'filled',name,address,id,'catalog',
        'pending_coordinates',address_version,candidate_latitude,candidate_longitude
      FROM work_locations WHERE id=$4`,[job,id(20),todayDate,locationId]);
    await query("INSERT INTO applications(job_id,worker_id,status) VALUES($1,$2,'pending')",[job,id(worker)]);
    await query("UPDATE applications SET status='approved' WHERE job_id=$1",[job]);
    return job;
  };
  const issueLearning = async (job, latitude, longitude, accuracy = 20, speed = null, isMock = false) => {
    const result = await scalar("SELECT issue_operational_code($1,'checkin',$2,$3,$4,$5,$6)",
      [job,latitude,longitude,accuracy,speed,isMock]);
    if (result?.error) throw new Error(result.error);
    return result;
  };
  const confirmLearning = async (worker, job, code) => {
    await login(20);
    await validate(job,'checkin',code);
    await login(worker);
  };
  const learningLatitudeAt = meters => meters / 6371000 * 180 / Math.PI;
  const radiusJob = await makeLearningJob(5,streetLocation,1000);
  await login(5);
  const issued = await issueLearning(radiusJob,learningLatitudeAt(299),0);
  const repeated = await issueLearning(radiusJob,0,0,10);
  assert.equal(repeated.code,issued.code,'repeated requests return the existing code');
  await confirmLearning(5,radiusJob,issued.code);
  await db.exec('RESET ROLE');
  assert.equal(await scalar('SELECT count(*) FROM work_location_evidence WHERE job_id=$1 AND worker_id=$2',[radiusJob,id(5)]),1);
  assert.equal(await scalar('SELECT candidate_sample_count FROM work_locations WHERE id=$1',[streetLocation]),1);
  assert.equal(await scalar('SELECT latitude FROM work_locations WHERE id=$1',[streetLocation]),null,
    'official coordinates stay unchanged before promotion');

  const outsideStreetJob = await makeLearningJob(6,streetLocation,1003);
  await login(6);
  await assert.rejects(issueLearning(outsideStreetJob,learningLatitudeAt(600),0),/distante do local/);
  await db.exec('RESET ROLE');
  assert.equal(await scalar('SELECT count(*) FROM operational_codes WHERE assignment_id=(SELECT id FROM operational_assignments WHERE job_id=$1)',[outsideStreetJob]),0);

  const houseRadiusJob = await makeLearningJob(9,houseLocation,1004);
  await login(9);
  const houseCode = await issueLearning(houseRadiusJob,2 + learningLatitudeAt(99.9),2);
  await confirmLearning(9,houseRadiusJob,houseCode.code);
  const outsideHouseJob = await makeLearningJob(10,houseLocation,1005);
  await login(10);
  await assert.rejects(issueLearning(outsideHouseJob,2 + learningLatitudeAt(100.1),2),/distante do local/);

  const limitedJob = await makeLearningJob(5,streetLocation,1001);
  await login(5);
  const invalidAttempts = [
    { latitude: 0, accuracy: 51, speed: null, isMock: false, error: /localização mais precisa/ },
    { latitude: 0, accuracy: 10, speed: null, isMock: true, error: /Não foi possível validar/ },
    { latitude: 0, accuracy: 10, speed: 101 / 3.6, isMock: false, error: /inconsistente/ },
    { latitude: 91, accuracy: 10, speed: null, isMock: false, error: /Não foi possível validar/ },
    { latitude: null, accuracy: 10, speed: null, isMock: false, error: /Ative sua localização/ },
  ];
  for (const attempt of invalidAttempts) {
    await assert.rejects(issueLearning(limitedJob,attempt.latitude,0,attempt.accuracy,attempt.speed,attempt.isMock),attempt.error);
  }
  await assert.rejects(issueLearning(limitedJob,0,0),/Muitas tentativas detectadas/);
  await db.exec('RESET ROLE');
  assert.equal(await scalar('SELECT count(*) FROM checkin_attempts WHERE job_id=$1',[limitedJob]),5);
  const userLimitJob = await makeLearningJob(5,streetLocation,1002);
  await db.exec('RESET ROLE');
  await query(`INSERT INTO checkin_attempts(job_id,worker_id)
    SELECT $1,$2 FROM generate_series(1,30)`,[limitedJob,id(5)]);
  await login(5);
  await assert.rejects(issueLearning(userLimitJob,0,0),/Muitas tentativas detectadas/);

  const calibrationJobs = [];
  for (let index = 0; index < 10; index++) {
    const worker = 6 + (index % 5);
    const job = await makeLearningJob(worker,calibrationLocation,1100 + index);
    calibrationJobs.push(job);
    await login(worker);
    const center = await query('SELECT candidate_latitude,candidate_longitude FROM work_locations WHERE id=$1',[calibrationLocation]);
    const code = await issueLearning(job,center[0].candidate_latitude,center[0].candidate_longitude,20);
    await confirmLearning(worker,job,code.code);
    if (index === 2) {
      assert.equal(await scalar('SELECT geocoding_precision FROM work_locations WHERE id=$1',[calibrationLocation]),'street',
        'three successful check-ins never promote a street-level location');
    }
  }
  assert.equal(await scalar('SELECT candidate_sample_count FROM work_locations WHERE id=$1',[calibrationLocation]),10);
  assert.equal(await scalar('SELECT geocoding_precision FROM work_locations WHERE id=$1',[calibrationLocation]),'street',
    'ten same-day check-ins do not satisfy the three-day rule');
  await db.exec('RESET ROLE');
  await query(`UPDATE work_location_evidence SET recorded_at=now()-interval '3 days' WHERE job_id=ANY($1::uuid[])`,[calibrationJobs.slice(0,3)]);
  await query(`UPDATE work_location_evidence SET recorded_at=now()-interval '2 days' WHERE job_id=ANY($1::uuid[])`,[calibrationJobs.slice(3,6)]);
  await query(`UPDATE work_location_evidence SET recorded_at=now()-interval '1 day' WHERE job_id=ANY($1::uuid[])`,[calibrationJobs.slice(6)]);
  const assignmentId = await scalar('SELECT id FROM operational_assignments WHERE job_id=$1',[calibrationJobs[0]]);
  await query("UPDATE operational_codes SET consumed_at=NULL WHERE assignment_id=$1 AND stage='checkin'",[assignmentId]);
  await query("UPDATE operational_codes SET consumed_at=now() WHERE assignment_id=$1 AND stage='checkin'",[assignmentId]);
  const promoted = await query(`SELECT geocoding_status,geocoding_precision,coordinate_source,latitude,longitude,
    device_verified_at,candidate_sample_count,candidate_worker_count,candidate_job_count
    FROM work_locations WHERE id=$1`,[calibrationLocation]);
  assert.equal(promoted[0].geocoding_status,'resolved');
  assert.equal(promoted[0].geocoding_precision,'device');
  assert.equal(promoted[0].coordinate_source,'device');
  assert.ok(promoted[0].device_verified_at);
  assert.equal(promoted[0].candidate_sample_count,10);
  assert.equal(promoted[0].candidate_worker_count,5);
  assert.equal(promoted[0].candidate_job_count,10);

  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(context(first),/permission denied/);
  await assert.rejects(issueAt(first, 0, 0), /permission denied/);
  await assert.rejects(query('SELECT process_operational_schedule()'),/permission denied/);
});
