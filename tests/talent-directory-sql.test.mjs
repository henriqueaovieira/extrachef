import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261018000000_restaurant_talent_directory.sql', import.meta.url), 'utf8');
const id = (value) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;

test('restaurant talent RPCs honor profile privacy and expose recruiting context', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE users(id uuid PRIMARY KEY, role text, name text, score numeric, deleted_at timestamptz);
    CREATE TABLE worker_profiles(
      user_id uuid PRIMARY KEY, city text, state text, bio text, specialties text[],
      experience text, profile_photo_path text
    );
    CREATE TABLE privacy_preferences(
      user_id uuid PRIMARY KEY, show_city boolean, show_experience boolean, show_score boolean,
      show_photos boolean, show_reviews boolean
    );
    CREATE TABLE talent_connections(restaurant_id uuid, worker_id uuid, category text);
    CREATE TABLE jobs(
      id uuid PRIMARY KEY, demand_id uuid, restaurant_id uuid, title text, job_date date, status text
    );
    CREATE TABLE applications(
      id uuid PRIMARY KEY, job_id uuid, worker_id uuid, status text, created_at timestamptz
    );
    CREATE TABLE demand_invitations(
      demand_id uuid, restaurant_id uuid, worker_id uuid, status text, created_at timestamptz
    );
    CREATE TABLE operational_assignments(
      restaurant_id uuid, worker_id uuid, job_id uuid, hired_at timestamptz,
      interruption text, checkout_at timestamptz
    );
    CREATE TABLE reviews(
      reviewed_id uuid, restaurant_id uuid, rating integer, created_at timestamptz, comment text
    );
    CREATE FUNCTION public.worker_operational_reputation(p_worker_id uuid) RETURNS jsonb
      LANGUAGE sql STABLE AS $$
        SELECT CASE WHEN COALESCE(pref.show_score, false)
          THEN jsonb_build_object('average_rating', 4.8, 'completed', 3, 'punctuality', 96,
            'checkins', 3, 'absences', 0, 'rehires', 2)
          ELSE NULL::jsonb END
        FROM public.users u LEFT JOIN public.privacy_preferences pref ON pref.user_id = u.id
        WHERE u.id = p_worker_id
      $$;
    INSERT INTO users VALUES
      ('${id(1)}','restaurant','Bistrô Central',NULL,NULL),
      ('${id(2)}','worker','Camila Rocha',4.8,NULL),
      ('${id(3)}','worker','Rafael Santos',4.5,NULL);
    INSERT INTO worker_profiles VALUES
      ('${id(2)}','São Paulo','SP','Atendimento em eventos',ARRAY['Garçom','Eventos'],'5 anos','camila.jpg'),
      ('${id(3)}','Rio de Janeiro','RJ','Bio privada',ARRAY['Cozinha'],'3 anos','rafael.jpg');
    INSERT INTO privacy_preferences VALUES
      ('${id(2)}',true,true,true,true,true),
      ('${id(3)}',false,false,false,false,false);
    INSERT INTO jobs VALUES
      ('${id(10)}','${id(20)}','${id(1)}','Evento corporativo',current_date,'open'),
      ('${id(11)}','${id(21)}','${id(1)}','Jantar especial',current_date - 1,'completed');
    INSERT INTO applications VALUES
      ('${id(30)}','${id(10)}','${id(2)}','pending',now()),
      ('${id(31)}','${id(11)}','${id(2)}','completed',now() - interval '1 day');
    INSERT INTO demand_invitations VALUES
      ('${id(20)}','${id(1)}','${id(2)}','pending',now());
    INSERT INTO talent_connections VALUES
      ('${id(1)}','${id(2)}','favorite'),('${id(1)}','${id(2)}','partner');
    INSERT INTO operational_assignments VALUES
      ('${id(1)}','${id(2)}','${id(11)}',now() - interval '1 day',NULL,now());
    INSERT INTO reviews VALUES
      ('${id(2)}','${id(1)}',5,now(),'Excelente profissional');
  `);
  await db.exec(migration);
  await db.exec(`SET request.jwt.claim.sub='${id(1)}'; SET ROLE authenticated;`);

  const directory = (await db.query('SELECT * FROM public.restaurant_talent_directory(0, 100)')).rows;
  assert.equal(directory.length, 2);
  const camila = directory.find((talent) => talent.id === id(2));
  const rafael = directory.find((talent) => talent.id === id(3));
  assert.equal(camila.city, 'São Paulo');
  assert.equal(camila.bio, 'Atendimento em eventos');
  assert.deepEqual(camila.specialties, ['Garçom', 'Eventos']);
  assert.equal(camila.has_pending_application, true);
  assert.equal(camila.has_invitation, true);
  assert.deepEqual(camila.categories, ['favorite', 'partner']);
  assert.equal(camila.restaurant_operations, 1);
  assert.equal(camila.review_count, 1);
  assert.equal(camila.reviews[0].restaurant_name, 'Bistrô Central');
  assert.equal(camila.candidate_count, 1);
  assert.equal(camila.invited_count, 1);
  assert.equal(camila.favorite_count, 1);
  assert.equal(camila.partner_count, 1);
  const history = (await db.query('SELECT * FROM public.restaurant_talent_history($1)', [id(2)])).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'Jantar especial');
  assert.equal(history[0].status, 'Concluída');
  assert.equal(history[0].total_count, 1);

  assert.equal(rafael.city, null);
  assert.equal(rafael.bio, null);
  assert.deepEqual(rafael.specialties, []);
  assert.equal(rafael.score, null);
  assert.equal(rafael.photo_path, null);
  assert.equal(rafael.review_count, null);
  assert.deepEqual(rafael.reviews, []);
  await assert.rejects(
    db.query('SELECT * FROM public.restaurant_talent_reviews($1)', [id(3)]),
    /disponíveis/,
  );
  await assert.rejects(
    db.query('SELECT * FROM public.restaurant_talent_directory(-1, 100)'),
    /Página inválida/,
  );
});
