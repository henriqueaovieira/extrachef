import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261018010000_restaurant_operational_message_inbox.sql', import.meta.url), 'utf8');
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

test('restaurant message inbox is operation-scoped, precise about unread counts and respects profile privacy', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE users(id uuid PRIMARY KEY, role text, name text, score numeric, deleted_at timestamptz);
    CREATE TABLE worker_profiles(user_id uuid PRIMARY KEY, specialties text[], profile_photo_path text);
    CREATE TABLE privacy_preferences(user_id uuid, show_experience boolean, show_score boolean, show_photos boolean);
    CREATE TABLE jobs(
      id uuid PRIMARY KEY, demand_id uuid, restaurant_id uuid, title text, job_date date,
      start_time time, end_time time, status text, location_name text, work_address text,
      work_neighborhood text, work_city text, work_state text
    );
    CREATE TABLE applications(id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text);
    CREATE TABLE operational_assignments(
      job_id uuid, worker_id uuid, hired_at timestamptz, amount numeric, checkin_at timestamptz,
      paid_at timestamptz, receipt_confirmed_at timestamptz, checkout_at timestamptz, interruption text
    );
    CREATE TABLE messages(
      id uuid PRIMARY KEY, job_id uuid, sender_id uuid, content text, created_at timestamptz, read_at timestamptz
    );
    CREATE FUNCTION public.is_approved_chat_participant(p_job_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS(
          SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
          WHERE a.job_id=p_job_id AND a.status IN ('approved','in_progress','completed')
            AND auth.uid() IN (a.worker_id,j.restaurant_id)
        )
      $$;
    CREATE FUNCTION public.operational_start(p_job public.jobs) RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT (p_job.job_date+p_job.start_time) AT TIME ZONE 'UTC' $$;
    CREATE FUNCTION public.operational_end(p_job public.jobs) RETURNS timestamptz
      LANGUAGE sql IMMUTABLE AS $$ SELECT (p_job.job_date+p_job.end_time) AT TIME ZONE 'UTC' $$;
    INSERT INTO users VALUES
      ('${id(1)}','restaurant','Empresa',NULL,NULL),
      ('${id(2)}','worker','Ana',4.8,NULL),
      ('${id(3)}','worker','Bruno',4.6,NULL),
      ('${id(4)}','restaurant','Outra empresa',NULL,NULL);
    INSERT INTO worker_profiles VALUES
      ('${id(2)}',ARRAY['Garçom'],'ana.jpg'),('${id(3)}',ARRAY['Cozinheiro'],'bruno.jpg');
    INSERT INTO privacy_preferences VALUES
      ('${id(2)}',true,true,true),('${id(3)}',false,false,false);
    INSERT INTO jobs VALUES
      ('${id(10)}','${id(20)}','${id(1)}','Casamento Vista Bella',current_date + 1,'18:00','23:00','filled',NULL,'Av. das Flores, 123',NULL,'São Paulo','SP'),
      ('${id(11)}','${id(21)}','${id(1)}','Jantar Executivo',current_date + 1,'18:00','23:00','filled','Salão Central',NULL,NULL,NULL,NULL),
      ('${id(12)}','${id(22)}','${id(4)}','Operação privada',current_date + 1,'18:00','23:00','filled',NULL,NULL,NULL,NULL,NULL),
      ('${id(13)}','${id(23)}','${id(1)}','Operação inconsistente',current_date + 1,'18:00','23:00','filled',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO applications VALUES
      ('${id(30)}','${id(10)}','${id(2)}','approved'),
      ('${id(31)}','${id(11)}','${id(3)}','approved'),
      ('${id(32)}','${id(12)}','${id(2)}','approved'),
      ('${id(33)}','${id(10)}','${id(3)}','pending'),
      ('${id(34)}','${id(13)}','${id(4)}','approved'),
      ('${id(35)}','${id(13)}','${id(1)}','approved');
    INSERT INTO operational_assignments VALUES
      ('${id(10)}','${id(2)}',now(),150,NULL,NULL,NULL,NULL,NULL),
      ('${id(11)}','${id(3)}',now(),150,now(),NULL,NULL,NULL,NULL),
      ('${id(13)}','${id(4)}',now(),150,NULL,NULL,NULL,NULL,NULL);
    INSERT INTO messages VALUES
      ('${id(40)}','${id(10)}','${id(2)}','Chego às 17h40',now() - interval '2 minutes',NULL),
      ('${id(41)}','${id(10)}','${id(1)}','Ótimo, até já!',now() - interval '1 minute',NULL),
      ('${id(42)}','${id(11)}','${id(3)}','Estou a caminho',now(),NULL);
  `);
  await db.exec(migration);
  await db.exec(`SET request.jwt.claim.sub='${id(1)}'; SET ROLE authenticated;`);
  const rows = (await db.query('SELECT * FROM public.restaurant_operational_message_inbox(0, 100)')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => row.job_id === id(13)), false);
  const ana = rows.find((row) => row.job_id === id(10));
  const bruno = rows.find((row) => row.job_id === id(11));
  assert.equal(ana.worker_name, 'Ana');
  assert.equal(ana.worker_specialty, 'Garçom');
  assert.equal(Number(ana.worker_score), 4.8);
  assert.equal(ana.worker_photo_path, 'ana.jpg');
  assert.equal(ana.demand_title, 'Casamento Vista Bella');
  assert.equal(ana.location, 'Av. das Flores, 123, São Paulo, SP');
  assert.equal(ana.operational_status, 'Contratado');
  assert.equal(ana.latest_message, 'Ótimo, até já!');
  assert.equal(ana.unread_count, 1);
  assert.equal(bruno.worker_specialty, null);
  assert.equal(bruno.worker_score, null);
  assert.equal(bruno.worker_photo_path, null);
  assert.equal(bruno.operational_status, 'Em operação');
  assert.equal(bruno.unread_count, 1);
  await assert.rejects(db.query('SELECT * FROM public.restaurant_operational_message_inbox(-1, 100)'), /Página inválida/);
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub='${id(4)}'; SET ROLE authenticated;`);
  const otherRestaurant = (await db.query('SELECT * FROM public.restaurant_operational_message_inbox(0, 100)')).rows;
  assert.deepEqual(otherRestaurant.map((row) => row.job_id), [id(12)]);
});
