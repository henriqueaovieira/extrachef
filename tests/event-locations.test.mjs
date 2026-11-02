import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Agenda page, exclusive component and frontend snapshot helper are removed', () => {
  for (const file of [
    '../app/restaurant/events/page.tsx', '../app/components/restaurant-events.tsx',
    '../lib/event-locations.ts',
  ]) assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
});

test('product has no Agenda route or event dependency in operation publication', () => {
  const root = new URL('../app/', import.meta.url);
  for (const file of readdirSync(root, { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8');
    assert.doesNotMatch(text, /\/restaurant\/events\b|restaurant-events|event-locations|label: 'Agenda'/, file);
  }
  const create = source('../app/restaurant/dashboard/jobs/create/page.tsx');
  assert.doesNotMatch(create, /from\('events'\)|p_event_id|p_event_revision|selectedEvent|eventsLoading|URLSearchParams|job-event/);
  assert.match(create, /rpc\('save_geocoded_work_location'/);
  assert.match(create, /p_location_source: 'catalog'/);
  assert.match(create, /p_work_location_id: savedLocation\.id/);
  assert.doesNotMatch(create, /endereço principal do restaurante|p_event_id|job-event/);
});

test('historical event snapshots, RPC and foreign keys remain intact', () => {
  const sql = source('../supabase/migrations/20261015070000_event_location_snapshots.sql');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /DEFAULT 'not_set'/);
  assert.match(sql, /REFERENCES public\.work_locations\(id\) ON DELETE NO ACTION/);
  assert.match(sql, /CREATE INDEX events_work_location_idx/);
  assert.match(sql, /REVOKE INSERT, UPDATE ON TABLE public\.events FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /p_expected_revision IS DISTINCT FROM target.revision/);
  assert.match(sql, /p_location_revision IS DISTINCT FROM selected.revision/);
  assert.match(sql, /target\.event_address := selected\.address/);
  assert.match(sql, /target\.location_source_version := selected\.address_version/);
  assert.doesNotMatch(sql, /public\.(jobs|applications|checkins|checkouts)|CREATE TRIGGER|http|geocode\(/i);
  const jobs = source('../supabase/migrations/20261015080000_job_location_snapshots.sql');
  assert.match(jobs, /REFERENCES public\.events\(id\)\s+ON UPDATE NO ACTION\s+ON DELETE NO ACTION/);
  assert.match(jobs, /source_event public\.events%ROWTYPE/);
  assert.match(jobs, /snapshot\.event_id := source_event\.id/);
});
