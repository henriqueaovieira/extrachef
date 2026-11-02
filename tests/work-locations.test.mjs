import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('manual location management page and component are removed', () => {
  for (const file of [
    '../app/restaurant/locations/page.tsx',
    '../app/components/restaurant-locations.tsx',
  ]) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
  }
});

test('application has no links, labels or imports for manual location management', () => {
  for (const directory of ['../app/', '../lib/']) {
    const root = new URL(directory, import.meta.url);
    for (const file of readdirSync(root, { recursive: true })) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const content = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8');
      assert.doesNotMatch(content, /\/restaurant\/locations\b|Meus locais|restaurant-locations/i, file);
    }
  }
  assert.match(source('../app/components/mobile-bottom-nav.tsx'), /href: '\/restaurant\/more'/);
});

test('internal catalog remains available for automatic restaurant location and historical snapshots', () => {
  const sql = source('../supabase/migrations/20261019000000_demand_restaurant_location.sql');
  assert.match(sql, /public\.save_work_location/);
  assert.match(sql, /public\.manage_work_location/);
  assert.match(sql, /source := 'catalog'/);
  assert.match(source('../lib/work-locations.ts'), /export interface CatalogLocation/);
  assert.match(source('../lib/work-locations.ts'), /latitude, longitude, geocoding_status/);
});

test('catalog migration and internal RPCs remain independent of attendance and geocoding APIs', () => {
  const sql = source('../supabase/migrations/20261015060000_work_locations_catalog.sql');
  assert.match(sql, /CREATE TABLE public\.work_locations/);
  assert.doesNotMatch(sql, /public\.(events|jobs|checkins|checkouts|applications)\b/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public.work_locations FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /WHERE is_default AND archived_at IS NULL/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /p_expected_revision IS DISTINCT FROM/);
  assert.match(sql, /FUNCTION public\.save_work_location/);
  assert.match(sql, /FUNCTION public\.manage_work_location/);
  assert.equal(existsSync(new URL('../supabase/migrations/20261015050000_operational_locations.sql', import.meta.url)), false);
  assert.ok(existsSync(new URL('../supabase/proposals/20261015050000_operational_locations.sql', import.meta.url)));
});
