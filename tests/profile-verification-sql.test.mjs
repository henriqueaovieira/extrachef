import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const worker = '11111111-1111-4111-8111-111111111111';
const restaurant = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('existing verification flow: submission, administrative decisions, resubmission and selfie isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE TABLE public.users (
        id uuid PRIMARY KEY, name text, email text, role text, city text,
        phone text, score numeric, verified boolean, deleted_at timestamptz
      );
      GRANT SELECT (id, name, role, city, score, verified, deleted_at) ON public.users TO authenticated;
      CREATE TABLE public.privacy_preferences (user_id uuid PRIMARY KEY, show_city boolean, show_score boolean);
      ALTER TABLE public.privacy_preferences ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.privacy_preferences TO authenticated;
      CREATE POLICY privacy_owner ON public.privacy_preferences TO authenticated USING (user_id = auth.uid());
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb DEFAULT '{}', PRIMARY KEY(bucket_id, name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
      CREATE FUNCTION storage.foldername(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
        $$ SELECT (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1) - 1] $$;
      INSERT INTO public.users (id, name, role, city, phone, score, verified) VALUES
        ('${worker}', 'Worker', 'worker', 'City', '11999999999', 5, false),
        ('${restaurant}', 'Restaurant', 'restaurant', 'City', '', 5, false),
        ('${other}', 'Other', 'worker', 'City', '', 5, false);
    `);
    const original = source('../supabase/migrations/20261014050000_profiles_and_geo.sql');
    await db.exec(original.slice(0, original.indexOf('ALTER TABLE public.jobs')));
    await db.exec(source('../supabase/migrations/20261015020000_auth_foundation.sql'));
    const privacy = source('../supabase/migrations/20261015090000_privacy_account_rights.sql');
    await db.exec(privacy.slice(privacy.indexOf('REVOKE SELECT (city, score)'), privacy.indexOf('CREATE OR REPLACE FUNCTION public.export_own_account_data')));
    // Even a permissive profile-media policy must never publish verification evidence.
    await db.exec(`CREATE POLICY adversarial_media_read ON storage.objects FOR SELECT TO authenticated USING (true)`);
    await db.exec(source('../supabase/migrations/20261103000000_verified_profile.sql'));
    const login = async (id, role = 'authenticated') => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
      await db.exec(`SET ROLE ${role}`);
    };
    const value = async (sql, parameters = []) => Object.values((await db.query(sql, parameters)).rows[0])[0];
    const submit = (path) => db.query('SELECT public.submit_own_profile_verification($1)', [path]);
    let reviewedAt = null;
    const review = (path, status, expected = reviewedAt) => db.query(
      'SELECT public.review_profile_verification($1, $2, $3, $4)', [worker, path, status, expected],
    );
    const photo = `${worker}/profile-photo-one.jpg`;
    const selfie = `${worker}/selfie-one.jpg`;
    const second = `${worker}/selfie-two.jpg`;

    await login(worker);
    await db.query(`INSERT INTO public.worker_profiles
      (user_id, cpf, rg, date_of_birth, phone, whatsapp, address, city, state, postal_code, profile_photo_path)
      VALUES ($1, '52998224725', 'RG', '1990-01-01', '11999999999', '', 'Street', 'City', 'SP', '01000000', $2)`, [worker, photo]);
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'pending');
    assert.equal(await value('SELECT selfie_verification_path FROM public.worker_profiles'), null);
    assert.equal(await value('SELECT resume_pdf_path FROM public.worker_profiles'), null);
    assert.equal(await value('SELECT profile_verified FROM public.public_user_directory WHERE id = $1', [worker]), false);
    await assert.rejects(submit(null), /selfie válida/);
    await assert.rejects(submit(`${other}/selfie-one.jpg`), /selfie válida/);
    await db.query(`INSERT INTO storage.objects VALUES
      ('worker-private', $1, '{"mimetype":"image/jpeg"}'),
      ('worker-private', $2, '{"mimetype":"image/jpeg"}'),
      ('worker-private', $3, '{"mimetype":"application/pdf"}')`, [photo, selfie, `${worker}/selfie-pdf.pdf`]);
    await assert.rejects(submit(`${worker}/selfie-pdf.pdf`), /selfie válida/);
    await db.exec(`UPDATE public.worker_profiles SET rg = ''`);
    await assert.rejects(submit(selfie), /CPF, RG e telefone/);
    await db.exec(`UPDATE public.worker_profiles SET rg = 'RG'`);
    await submit(selfie);
    reviewedAt = await value('SELECT updated_at::text FROM public.worker_profiles');
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'pending');
    assert.equal(await value('SELECT selfie_verification_path FROM public.worker_profiles'), selfie);
    await assert.rejects(submit(selfie), /em análise/);
    await assert.rejects(db.exec(`UPDATE public.worker_profiles SET verification_status = 'verified'`), /permission denied/);
    await assert.rejects(db.query('UPDATE public.worker_profiles SET selfie_verification_path = $1', [second]), /permission denied/);
    await assert.rejects(review(selfie, 'verified'), /permission denied/);
    await assert.rejects(db.query('UPDATE public.worker_profiles SET profile_photo_path = $1', [selfie]), /foto pública/);
    assert.equal((await db.query('DELETE FROM storage.objects WHERE name = $1 RETURNING name', [selfie])).rows.length, 0);
    assert.equal((await db.query(`UPDATE storage.objects SET metadata = '{}' WHERE name = $1 RETURNING name`, [selfie])).rows.length, 0);

    await login('', 'service_role');
    await assert.rejects(review(selfie, 'invalid'), /inválido/);
    await assert.rejects(review(second, 'verified'), /indisponível/);
    await assert.rejects(review(selfie, 'verified', '2000-01-01'), /dados alterados/);
    await review(selfie, 'verified');
    await login(worker);
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'verified');
    await assert.rejects(submit(second), /verificado/);
    await login(restaurant);
    assert.equal(await value('SELECT profile_verified FROM public.public_user_directory WHERE id = $1', [worker]), true);
    assert.equal((await db.query('SELECT * FROM public.worker_profiles')).rows.length, 0);
    const files = (await db.query(`SELECT name FROM storage.objects WHERE bucket_id = 'worker-private'`)).rows.map((row) => row.name);
    assert.deepEqual(files, [photo]);
    const directory = (await db.query('SELECT * FROM public.public_user_directory WHERE id = $1', [worker])).rows[0];
    assert.equal(Object.hasOwn(directory, 'selfie_verification_path'), false);
    assert.equal(Object.hasOwn(directory, 'cpf'), false);
    await login(other);
    assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [selfie])).rows.length, 0);

    await login(worker);
    await db.exec(`UPDATE public.worker_profiles SET phone = '11888888888'`);
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'pending');
    const staleReview = reviewedAt;
    reviewedAt = await value('SELECT updated_at::text FROM public.worker_profiles');
    await login('', 'service_role');
    await assert.rejects(review(selfie, 'verified', staleReview), /dados alterados/);
    await review(selfie, 'rejected');
    await login(worker);
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'rejected');
    await assert.rejects(submit(selfie), /nova selfie/);
    await db.query(`INSERT INTO storage.objects VALUES ('worker-private', $1, '{"mimetype":"image/jpeg"}')`, [second]);
    await submit(second);
    reviewedAt = await value('SELECT updated_at::text FROM public.worker_profiles');
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'pending');
    assert.equal(await value('SELECT selfie_verification_path FROM public.worker_profiles'), second);
    assert.equal((await db.query('DELETE FROM storage.objects WHERE name = $1 RETURNING name', [selfie])).rows.length, 1);
    await login('', 'service_role');
    await assert.rejects(review(selfie, 'verified'), /substituída/);
    await review(second, 'verified');
    await login(worker);
    assert.equal(await value('SELECT verification_status FROM public.worker_profiles'), 'verified');
    await login('', 'service_role');
    await db.exec('RESET ROLE');
    await db.query('UPDATE public.users SET deleted_at = now() WHERE id = $1', [worker]);
    await login(worker);
    await assert.rejects(submit(second), /conta profissional/);
    await login(restaurant);
    assert.equal((await db.query('SELECT * FROM public.public_user_directory WHERE id = $1', [worker])).rows.length, 0);
    await login('', 'anon');
    await assert.rejects(db.exec('SELECT * FROM public.public_user_directory'), /permission denied/);
    await assert.rejects(submit(second), /permission denied/);
  } finally { await db.close(); }
});
