import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const proposal = readFileSync(new URL('../supabase/proposals/remove_legacy_review_uniqueness.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261106040000_remove_legacy_review_uniqueness.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/proposals/rollback_legacy_review_uniqueness.sql', import.meta.url), 'utf8');

test('removing the legacy constraint allows bilateral reviews but rejects duplicate reviewers', async (t) => {
  assert.equal(migration.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '').replace(/\s+/g, ' ').trim(),
    proposal.replace(/\s+/g, ' ').trim());
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE public.reviews (
      id integer PRIMARY KEY,
      job_id integer NOT NULL,
      worker_id integer NOT NULL,
      restaurant_id integer NOT NULL,
      reviewer_id integer NOT NULL,
      CONSTRAINT unique_job_review_per_author UNIQUE (job_id, worker_id, restaurant_id),
      CONSTRAINT reviews_one_per_user_per_job UNIQUE (job_id, reviewer_id)
    );
    INSERT INTO public.reviews VALUES (1, 10, 20, 30, 20);
  `);

  await assert.rejects(
    db.query('INSERT INTO public.reviews VALUES (2, 10, 20, 30, 30)'),
    (error) => error.code === '23505' && error.constraint === 'unique_job_review_per_author',
  );
  await db.exec(migration);
  await db.query('INSERT INTO public.reviews VALUES (2, 10, 20, 30, 30)');
  const { rows } = await db.query('SELECT id, reviewer_id FROM public.reviews WHERE job_id = 10 ORDER BY id');
  assert.deepEqual(rows, [{ id: 1, reviewer_id: 20 }, { id: 2, reviewer_id: 30 }]);
  for (const [id, reviewer] of [[3, 20], [4, 30]]) {
    await assert.rejects(
      db.query('INSERT INTO public.reviews VALUES ($1, 10, 20, 30, $2)', [id, reviewer]),
      (error) => error.code === '23505' && error.constraint === 'reviews_one_per_user_per_job',
    );
  }
  await assert.rejects(
    db.exec(rollback),
    (error) => error.code === '23505',
  );
  await db.query('DELETE FROM public.reviews WHERE id = 2');
  await db.exec(rollback);
  await assert.rejects(
    db.query('INSERT INTO public.reviews VALUES (2, 10, 20, 30, 30)'),
    (error) => error.code === '23505' && error.constraint === 'unique_job_review_per_author',
  );
});
