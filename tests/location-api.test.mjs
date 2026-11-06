import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const workLocations = load('../lib/work-locations.ts');
const { GeocodingError } = load('../lib/geocoding/types.ts');
const postal = load('../lib/postal-code/index.ts', { 'server-only': {} });
const quiet = t => ['info', 'warn', 'error'].forEach(level => t.mock.method(console, level, () => {}));
const id = '11111111-1111-4111-8111-111111111111';
const row = (overrides = {}) => ({
  id, restaurant_id: 'restaurant', name: 'Matriz', address: 'Rua das Flores', number: '120', neighborhood: 'Centro',
  city: 'São Paulo', state: 'SP', postal_code: '01001000', country_code: 'BR', latitude: null, longitude: null,
  geocoding_status: 'pending', geocoding_precision: null, geocoding_error_code: null, candidate_latitude: null,
  candidate_longitude: null, kind: 'permanent', valid_until: null, confirmed_at: null, address_version: 2,
  revision: 4, is_default: true, archived_at: null, created_at: '', updated_at: '', ...overrides,
});
const input = (overrides = {}) => ({
  name: 'Matriz', address: 'Rua das Flores', number: '120', neighborhood: 'Centro', city: 'São Paulo',
  state: 'sp', postal_code: '01001-000', kind: 'permanent', valid_until: null, make_default: true, ...overrides,
});

function harness({ user = { id: 'restaurant' }, role = 'restaurant', active = true, roleError = null, activeError = null,
  saved = row(), saveError = null, applied = row({ geocoding_status: 'resolved', latitude: -23.5, longitude: -46.6, geocoding_precision: 'house' }),
  stored = row(), geocode = async () => ({ latitude: -23.5, longitude: -46.6 }) } = {}) {
  const calls = [];
  const geocoded = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'account_is_active') return { data: active, error: activeError };
      if (name === 'save_restaurant_location') return saveError ? { data: null, error: saveError } : { data: saved, error: null };
      if (name === 'apply_work_location_geocode') return { data: applied, error: null };
      if (name === 'record_work_location_geocoding_failure') {
        return { data: row({ geocoding_status: 'failed', geocoding_error_code: args.p_code }), error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: table => ({
      select() { return this; }, eq() { return this; },
      single: async () => { assert.equal(table, 'users'); return { data: { role }, error: roleError }; },
      maybeSingle: async () => { assert.equal(table, 'work_locations'); return { data: stored, error: null }; },
    }),
  };
  const server = load('../lib/locations/server.ts', {
    'server-only': {},
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/supabase/request': { createRequestClient: () => ({ supabase, finish: response => response }) },
    '@/lib/geocoding': {
      createGeocodingService: (owner, requestId) => {
        assert.equal(owner, 'restaurant');
        assert.match(requestId, /^[0-9a-f-]{36}$/);
        return { geocode: async address => { geocoded.push(address); return geocode(address); } };
      },
    },
    '@/lib/geocoding/types': { GeocodingError },
    '@/lib/work-locations': workLocations,
  });
  const routes = { '@/lib/locations/server': server, '@/lib/work-locations': workLocations };
  return {
    calls, geocoded,
    POST: load('../app/api/locations/route.ts', routes).POST,
    PATCH: load('../app/api/locations/[id]/route.ts', routes).PATCH,
    CEP: load('../app/api/postal-code/[cep]/route.ts', {
      ...routes, '@/lib/postal-code': { ...postal, lookupPostalCode: cep => postal.lookupPostalCode(cep, async url => {
        geocoded.push(url);
        return cep === '99999999' ? Response.json({ erro: true })
          : Response.json({ logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' });
      }, { endpoint: 'https://cep.example/ws', timeout: 1000 }) },
    }).GET,
  };
}
const json = (method, body, url = 'http://localhost/api/locations') => new Request(url, {
  method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const params = value => ({ params: Promise.resolve(value) });

test('location API authenticates an active restaurant before touching the catalog', async t => {
  quiet(t);
  for (const [options, status] of [
    [{ user: null }, 401], [{ role: 'worker' }, 403], [{ active: false }, 403],
    [{ roleError: new Error('db') }, 503], [{ activeError: new Error('db') }, 503],
  ]) {
    const app = harness(options);
    const response = await app.POST(json('POST', input()));
    assert.equal(response.status, status, JSON.stringify(options));
    assert.equal(app.calls.some(call => call.name === 'save_restaurant_location'), false);
    assert.match(response.headers.get('X-Request-Id'), /^[0-9a-f-]{36}$/);
  }
});

test('location API requires CEP and number and never accepts client coordinates', async t => {
  quiet(t);
  const app = harness();
  for (const body of [input({ postal_code: '' }), input({ postal_code: '0100' }), input({ number: ' ' }),
    input({ state: 'XX' }), input({ kind: 'temporary' }), input({ kind: 'other' }), null]) {
    assert.equal((await app.POST(json('POST', body))).status, 400, JSON.stringify(body));
  }
  assert.equal(app.calls.some(call => call.name === 'save_restaurant_location'), false);

  const response = await app.POST(json('POST', { ...input(), latitude: 1, longitude: 2, coordinate_source: 'manual' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const save = app.calls.find(call => call.name === 'save_restaurant_location');
  assert.deepEqual(save.args, {
    p_name: 'Matriz', p_address: 'Rua das Flores', p_number: '120', p_neighborhood: 'Centro', p_city: 'São Paulo',
    p_state: 'SP', p_postal_code: '01001000', p_kind: 'permanent', p_valid_until: null, p_make_default: true,
    p_id: null, p_expected_revision: null,
  });
  assert.deepEqual(app.geocoded, [{
    address: 'Rua das Flores', number: '120', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postal_code: '01001000',
  }], 'geocodes the saved row, not the request body');
  assert.deepEqual(app.calls.at(-1), { name: 'apply_work_location_geocode', args: { p_id: id, p_address_version: 2 } });
  const body = await response.json();
  assert.equal(body.location.geocoding_status, 'resolved');
  assert.equal(body.geocodingError, undefined);
});

test('definitive geocoding failures are recorded; transient ones keep the location pending', async t => {
  quiet(t);
  for (const [code, recorded] of [['not_found', true], ['ambiguous', true], ['rate_limited', false], ['timeout', false],
    ['configuration', false], ['cache_error', false]]) {
    const app = harness({ geocode: async () => { throw new GeocodingError(code, `falha ${code}`, 422, 10); } });
    const response = await app.POST(json('POST', input()));
    assert.equal(response.status, 200, code);
    const body = await response.json();
    assert.equal(body.geocodingError.code, code);
    assert.equal(body.geocodingError.message, `falha ${code}`);
    assert.equal(app.calls.some(call => call.name === 'apply_work_location_geocode'), false);
    const failure = app.calls.find(call => call.name === 'record_work_location_geocoding_failure');
    assert.equal(Boolean(failure), recorded, code);
    if (recorded) {
      assert.deepEqual(failure.args, { p_id: id, p_address_version: 2, p_code: code });
      assert.equal(body.location.geocoding_status, 'failed');
    } else assert.equal(body.location.geocoding_status, 'pending');
  }
  const internal = harness({ geocode: async () => { throw new Error('boom'); } });
  const body = await (await internal.POST(json('POST', input()))).json();
  assert.equal(body.geocodingError.code, 'internal');
});

test('unchanged confirmed locations are not geocoded again and save conflicts map to HTTP status', async t => {
  quiet(t);
  const confirmed = harness({ saved: row({ geocoding_status: 'resolved', latitude: -23.5, longitude: -46.6 }) });
  assert.equal((await confirmed.PATCH(json('PATCH', { revision: 4, location: input() }), params({ id }))).status, 200);
  assert.deepEqual(confirmed.geocoded, []);
  assert.deepEqual(confirmed.calls.find(call => call.name === 'save_restaurant_location').args.p_id, id);
  assert.equal(confirmed.calls.find(call => call.name === 'save_restaurant_location').args.p_expected_revision, 4);
  const review = harness({ saved: row({ geocoding_status: 'needs_review', candidate_latitude: -23.5, candidate_longitude: -46.6 }) });
  assert.equal((await (await review.POST(json('POST', input()))).json()).location.geocoding_status, 'needs_review');
  assert.deepEqual(review.geocoded, []);
  for (const [code, status] of [['40001', 409], ['P0002', 404], ['42501', 403], ['22023', 400]]) {
    const app = harness({ saveError: { code, message: `erro ${code}` } });
    const response = await app.POST(json('POST', input()));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: `erro ${code}` });
  }
});

test('PATCH validates id and revision and retries geocoding of the stored address', async t => {
  quiet(t);
  const app = harness({ stored: row({ geocoding_status: 'failed', address: 'Rua Gravada' }) });
  assert.equal((await app.PATCH(json('PATCH', { action: 'locate' }), params({ id: 'not-a-uuid' }))).status, 404);
  assert.equal((await app.PATCH(json('PATCH', { location: input() }), params({ id }))).status, 400);
  assert.equal((await app.PATCH(json('PATCH', { revision: 1.5, location: input() }), params({ id }))).status, 400);
  assert.equal((await app.PATCH(json('PATCH', { revision: 1, location: input({ postal_code: '' }) }), params({ id }))).status, 400);
  const retry = await app.PATCH(json('PATCH', { action: 'locate', address: 'Injetada' }), params({ id }));
  assert.equal(retry.status, 200);
  assert.equal(app.geocoded[0].address, 'Rua Gravada');
  assert.equal(app.calls.some(call => call.name === 'save_restaurant_location'), false);
  assert.equal((await retry.json()).location.geocoding_status, 'resolved');
});

test('postal-code lookup fills the form only, through an authenticated ViaCEP-compatible adapter', async t => {
  quiet(t);
  const app = harness();
  const found = await app.CEP(new Request('http://localhost/api/postal-code/01001000'), params({ cep: '01001-000' }));
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), { address: {
    postal_code: '01001000', address: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP',
  } });
  assert.equal(app.geocoded[0], 'https://cep.example/ws/01001000/json/');
  assert.equal((await app.CEP(new Request('http://localhost'), params({ cep: '99999999' }))).status, 404);
  assert.equal((await app.CEP(new Request('http://localhost'), params({ cep: '123' }))).status, 400);
  assert.equal((await harness({ user: null }).CEP(new Request('http://localhost'), params({ cep: '01001000' }))).status, 401);

  const config = { endpoint: 'https://cep.example/ws', timeout: 1000 };
  await assert.rejects(postal.lookupPostalCode('01001000', async () => { throw new TypeError('offline'); }, config),
    error => error.code === 'unavailable' && error.status === 503);
  await assert.rejects(postal.lookupPostalCode('01001000', async () => new Response('x', { status: 500 }), config),
    error => error.code === 'unavailable');
  await assert.rejects(postal.lookupPostalCode('01001000', async () => Response.json({ uf: 'S', localidade: '' }), config),
    error => error.code === 'not_found');
  assert.deepEqual(postal.postalCodeConfiguration({}), { endpoint: 'https://viacep.com.br/ws', timeout: 4000 });
  assert.throws(() => postal.postalCodeConfiguration({ POSTAL_CODE_ENDPOINT: 'http://cep.example' }), /indisponível/);
  assert.throws(() => postal.postalCodeConfiguration({ POSTAL_CODE_TIMEOUT: '50' }), /indisponível/);
});

test('shared location helpers enforce CEP, primary and temporary validity rules', () => {
  const { validateLocationInput, locationSelectable, locationStatusLabel, formatLocationAddress, todayInSaoPaulo } = workLocations;
  const valid = { ...input(), state: 'SP' };
  assert.doesNotThrow(() => validateLocationInput(valid));
  assert.throws(() => validateLocationInput({ ...valid, postal_code: '01001-00' }), /CEP/);
  assert.throws(() => validateLocationInput({ ...valid, number: '' }), /número/);
  assert.throws(() => validateLocationInput({ ...valid, kind: 'temporary', make_default: false }), /até quando/);
  assert.throws(() => validateLocationInput({ ...valid, kind: 'temporary', valid_until: '2099-01-01' }), /principal/);
  assert.throws(() => validateLocationInput({ ...valid, valid_until: '2099-01-01' }), /temporários/);
  assert.equal(todayInSaoPaulo(new Date('2026-01-01T02:00:00Z')), '2025-12-31');
  const resolved = row({ geocoding_status: 'resolved', geocoding_precision: 'device', latitude: -23.5,
    longitude: -46.6, confirmed_at: '2026-01-01T00:00:00Z' });
  assert.equal(locationSelectable(resolved, '2099-01-01', '2026-01-01'), true);
  assert.equal(locationSelectable(row({ geocoding_status: 'needs_review' }), '', '2026-01-01'), false);
  assert.equal(locationSelectable(row({ geocoding_status: 'needs_review', geocoding_precision: 'street',
    candidate_latitude: -23.5, candidate_longitude: -46.6 }), '', '2026-01-01'), true);
  assert.equal(locationSelectable(row({ geocoding_status: 'resolved', geocoding_precision: 'street',
    latitude: -23.5, longitude: -46.6 }), '', '2026-01-01'), true);
  assert.equal(locationSelectable(row({ geocoding_status: 'resolved', geocoding_precision: 'house',
    latitude: -23.5, longitude: -46.6 }), '', '2026-01-01'), true);
  const houseCandidate = row({ geocoding_status: 'needs_review', geocoding_precision: 'house',
    candidate_latitude: -23.5, candidate_longitude: -46.6 });
  assert.equal(locationSelectable(houseCandidate, '', '2026-01-01'), true);
  assert.equal(locationStatusLabel(houseCandidate), 'Endereço localizado · raio de 100 m');
  assert.equal(locationSelectable({ ...resolved, archived_at: 'x' }, '', '2026-01-01'), false);
  const temporary = { ...resolved, kind: 'temporary', valid_until: '2026-02-01' };
  assert.equal(locationSelectable(temporary, '2026-02-01', '2026-01-01'), true);
  assert.equal(locationSelectable(temporary, '2026-02-02', '2026-01-01'), false);
  assert.equal(locationSelectable(temporary, '', '2026-02-02'), false);
  assert.equal(formatLocationAddress(resolved), 'Rua das Flores, 120 · Centro · São Paulo/SP · CEP 01001-000');
});
