import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('operational location management page reuses the work_locations catalog', () => {
  assert.equal(existsSync(new URL('../app/components/restaurant-locations.tsx', import.meta.url)), false);
  const page = source('../app/restaurant/locations/page.tsx');
  assert.match(page, /Locais operacionais/);
  assert.match(page, /loadWorkLocations/);
  assert.match(page, /manageLocation\(supabase, location, '(set_default|archive|restore)'\)/);
  assert.doesNotMatch(page, /Confirmar no local \(GPS\)|confirmLocation/);
  assert.doesNotMatch(page, /restaurant_locations/);
  assert.match(source('../app/components/more-navigation.tsx'), /href: '\/restaurant\/locations', label: 'Locais operacionais'/);
  assert.match(source('../app/components/profile-editor.tsx'), /href="\/restaurant\/locations"/);
});

test('application never introduces a separate restaurant_locations entity or legacy labels', () => {
  for (const directory of ['../app/', '../lib/']) {
    const root = new URL(directory, import.meta.url);
    for (const file of readdirSync(root, { recursive: true })) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const path = new URL(file.replaceAll('\\', '/'), root);
      if (!statSync(path).isFile()) continue;
      const content = readFileSync(path, 'utf8');
      assert.doesNotMatch(content, /restaurant_locations|Meus locais|restaurant-locations/i, file);
    }
  }
  for (const file of readdirSync(new URL('../supabase/migrations/', import.meta.url))) {
    if (!statSync(new URL(`../supabase/migrations/${file}`, import.meta.url)).isFile()) continue;
    assert.doesNotMatch(source(`../supabase/migrations/${file}`), /CREATE TABLE (public\.)?restaurant_locations/i, file);
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
