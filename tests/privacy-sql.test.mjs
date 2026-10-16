import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const worker = '11111111-1111-4111-8111-111111111111';
const restaurant = '22222222-2222-4222-8222-222222222222';
const job = '33333333-3333-4333-8333-333333333333';

test('privacy migration executes in PostgreSQL: isolation, consent, export, media and deleted-account guards', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb);
      CREATE TABLE public.users (id uuid PRIMARY KEY, name text, email text, phone text, city text, score numeric, role text, verified boolean);
      CREATE TABLE public.jobs (id uuid PRIMARY KEY, restaurant_id uuid, status text);
      CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, worker_id uuid, status text);
      CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, sender_id uuid, content text, read_at timestamptz);
      CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewer_id uuid, reviewed_id uuid, rating integer, comment text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, category text, url text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.push_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, auth_secret text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.worker_profiles (user_id uuid PRIMARY KEY, phone text, experience text, profile_photo_path text, resume_pdf_path text, selfie_verification_path text, certificates text[]);
      CREATE TABLE public.restaurant_profiles (user_id uuid PRIMARY KEY, phone text, address text, logo_path text, company_photos text[]);
      CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
      CREATE TABLE public.checkins (worker_id uuid);
      CREATE TABLE public.checkouts (worker_id uuid);
      CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean);
      CREATE TABLE storage.objects (bucket_id text, name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON storage.objects TO authenticated;
      CREATE POLICY original_media_read ON storage.objects FOR SELECT TO authenticated USING (true);
      CREATE FUNCTION storage.foldername(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
        $$ SELECT (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1) - 1] $$;
      GRANT SELECT (id, name, role, verified, city, score) ON public.users TO authenticated;
      INSERT INTO public.users VALUES
        ('${worker}', 'Profissional', 'worker@example.invalid', '123456789', 'Cidade', 4.5, 'worker', false),
        ('${restaurant}', 'Restaurante', 'restaurant@example.invalid', '123456789', 'Cidade', 5, 'restaurant', false);
      INSERT INTO auth.users VALUES ('${worker}', '{}'), ('${restaurant}', '{}');
      INSERT INTO public.jobs VALUES ('${job}', '${restaurant}', 'completed');
      INSERT INTO public.applications (job_id, worker_id, status) VALUES ('${job}', '${worker}', 'completed');
      INSERT INTO public.worker_profiles VALUES ('${worker}', '123456789', 'Experiência privada', '${worker}/profile-photo-one.jpg', '${worker}/resume.pdf', '${worker}/selfie.jpg', '{}');
      INSERT INTO storage.buckets VALUES ('restaurant-assets', true), ('worker-private', false);
      INSERT INTO storage.objects VALUES ('worker-private', '${worker}/profile-photo-one.jpg'), ('worker-private', '${worker}/resume.pdf');
    `);
    const migration = readFileSync(new URL('../supabase/migrations/20261015090000_privacy_account_rights.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const asUser = async (id) => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec('SET ROLE authenticated');
    };
    await asUser(worker);
    await db.exec(`INSERT INTO public.privacy_preferences (user_id) VALUES ('${worker}')`);
    await assert.rejects(db.exec(`INSERT INTO public.privacy_preferences (user_id) VALUES ('${restaurant}')`), /row-level security/);
    await db.exec('SELECT public.accept_current_legal_documents(); SELECT public.accept_current_legal_documents()');
    assert.equal((await db.query('SELECT count(*)::int AS total FROM public.legal_acceptances')).rows[0].total, 1);
    const exported = (await db.query('SELECT public.export_own_account_data() AS result')).rows[0].result;
    assert.equal(exported.account.id, worker);
    assert.equal(exported.worker_profile.resume_pdf_path, `${worker}/resume.pdf`);
    await assert.rejects(db.exec(`SELECT public.anonymize_account('${restaurant}')`), /permission denied/);
    const ownView = (await db.query(`SELECT city FROM public.public_user_directory WHERE id = '${worker}'`)).rows[0];
    assert.equal(ownView.city, 'Cidade');
    await asUser(restaurant);
    const otherView = (await db.query(`SELECT city, score FROM public.public_user_directory WHERE id = '${worker}'`)).rows[0];
    assert.equal(otherView.city, null); assert.equal(otherView.score, null);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM storage.objects')).rows[0].total, 0);
    await asUser(worker);
    await db.exec(`UPDATE public.privacy_preferences SET show_photos = true WHERE user_id = '${worker}'`);
    await asUser(restaurant);
    const visibleFiles = (await db.query('SELECT name FROM storage.objects')).rows;
    assert.equal(visibleFiles.length, 1); assert.match(visibleFiles[0].name, /profile-photo/);
    const visibleProfile = (await db.query(`SELECT public.get_visible_profile('${worker}') AS profile`)).rows[0].profile;
    assert.equal(visibleProfile.phone, null); assert.equal(visibleProfile.experience, null);
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    await db.exec('SET ROLE service_role');
    await db.exec(`SELECT public.anonymize_account('${worker}')`);
    await asUser(worker);
    assert.equal((await db.query('SELECT public.account_is_active() AS active')).rows[0].active, false);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM public.privacy_preferences')).rows[0].total, 0);
    await assert.rejects(db.exec(`INSERT INTO public.messages (job_id, sender_id, content) VALUES ('${job}', '${worker}', 'test')`), /permission denied|excluída/);
  } finally { await db.close(); }
});