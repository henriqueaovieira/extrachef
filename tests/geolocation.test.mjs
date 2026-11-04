import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const geo = load('../lib/work-location.ts');
const device = load('../lib/geolocation.ts');
const address = () => ({
  ...geo.emptyWorkLocation, address: 'Rua das Flores', number: '120', neighborhood: 'Centro',
  city: 'Piracicaba', state: 'SP', postal_code: '13400-000', location_name: 'Casamento Silva',
});

test('device GPS is a fresh one-shot request and reports permission, timeout and availability errors', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const navigator = {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  });
  await assert.rejects(device.getDeviceCoordinates(), /não oferece acesso/);
  let requests = 0;
  navigator.geolocation = {
    getCurrentPosition(success, failure, options) {
      requests++;
      assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      success({ coords: { latitude: -23.5, longitude: -46.6, accuracy: 10 } });
    },
  };
  assert.deepEqual(await device.getDeviceCoordinates(), { latitude: -23.5, longitude: -46.6, accuracy: 10 });
  assert.equal(requests, 1);
  for (const [code, message] of [[1, /Permita o acesso/], [2, /Verifique o GPS/], [3, /a tempo/]]) {
    navigator.geolocation.getCurrentPosition = (success, failure) =>
      failure({ code, PERMISSION_DENIED: 1, TIMEOUT: 3 });
    await assert.rejects(device.getDeviceCoordinates(), message);
  }
});

test('coordinate validation rejects null, NaN, infinity and out-of-range values', () => {
  for (const lat of [null, undefined, NaN, Infinity, -91, 91, '0']) assert.equal(geo.validCoordinates(lat, 0), false);
  for (const lng of [null, undefined, NaN, Infinity, -181, 181, '0']) assert.equal(geo.validCoordinates(0, lng), false);
  assert.equal(geo.validCoordinates(0, 0), true);
  assert.equal(geo.validCoordinates(-90, 180), true);
});

test('Haversine measures the actual geofence thresholds and antipodes', () => {
  for (const radius of [100, 200, 300, 500]) {
    const latitude = radius / 6371000 * 180 / Math.PI;
    assert.ok(Math.abs(geo.distanceMeters(0, 0, latitude, 0) - radius) < 0.000001);
    assert.ok(geo.distanceMeters(0, 0, latitude * 0.999, 0) < radius);
    assert.ok(geo.distanceMeters(0, 0, latitude * 1.001, 0) > radius);
  }
  assert.equal(geo.distanceMeters(0, 0, 0, 0), 0);
  assert.ok(Number.isFinite(geo.distanceMeters(0, 0, 0, 180)));
  assert.throws(() => geo.distanceMeters(NaN, 0, 0, 0), /inválidas/);
  assert.equal(geo.estimatedDistance(120), '120 m');
  assert.match(geo.estimatedDistance(12000), /12.*km/);
});

test('address validation and serializers preserve distinct job and event fields', () => {
  const location = { ...address(), latitude: -22.7, longitude: -47.6 };
  assert.doesNotThrow(() => geo.validateWorkAddress(location));
  assert.doesNotThrow(() => geo.validateWorkAddress({ ...location, postal_code: '' }));
  assert.throws(() => geo.validateWorkAddress({ ...location, city: '' }), /cidade/);
  assert.throws(() => geo.validateWorkAddress({ ...location, postal_code: '123' }), /CEP/);
  assert.throws(() => geo.validateWorkAddress({ ...location, state: 'sp' }), /UF/);
  const job = geo.jobLocationValues(location);
  const event = geo.eventLocationValues(location);
  assert.equal(job.work_postal_code, '13400000');
  assert.equal(job.work_number, '120');
  assert.equal(job.work_latitude, -22.7);
  assert.equal(event.event_address, 'Rua das Flores, 120, Centro');
  assert.equal(event.event_longitude, -47.6);
  assert.ok(!Object.hasOwn(job, 'latitude'));
  assert.ok(!Object.hasOwn(event, 'work_address'));
});

test('event inheritance creates an editable snapshot, including legacy events', () => {
  const event = geo.eventLocationValues({ ...address(), latitude: -22, longitude: -47 });
  const snapshot = geo.locationFromEvent(event);
  snapshot.address = 'Outro local';
  assert.equal(event.event_address, 'Rua das Flores, 120, Centro');
  assert.equal(snapshot.latitude, -22);
  assert.deepEqual(geo.locationFromEvent({
    location_name: null, event_address: null, event_city: null, event_state: null,
    event_postal_code: null, event_latitude: null, event_longitude: null,
  }), geo.emptyWorkLocation);
});

test('save geocodes automatically, reuses coordinates and falls back to the address on geocoding failures', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/geocode');
    assert.equal(JSON.parse(options.body).city, 'Piracicaba');
    return Response.json({ latitude: -22, longitude: -47 });
  });
  const resolved = await geo.resolveWorkLocation(address());
  assert.equal(resolved.latitude, -22);
  await geo.resolveWorkLocation(resolved);
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => Response.json({
    error: 'Geocodificação não configurada. Solicite a configuração do serviço ao administrador.',
  }, { status: 503 }));
  const unresolved = await geo.resolveWorkLocation(address());
  assert.equal(unresolved.address, 'Rua das Flores');
  assert.equal(unresolved.latitude, null);
  assert.equal(unresolved.longitude, null);
  fetch.mock.mockImplementation(async () => Response.json({ latitude: 100, longitude: -47 }));
  assert.equal((await geo.resolveWorkLocation(address())).latitude, null);
  fetch.mock.mockImplementation(async () => { throw new Error('Sem conexão'); });
  assert.equal((await geo.resolveWorkLocation(address())).address, 'Rua das Flores');
});

function route({ user = { id: 'restaurant' }, authError = null, role = 'restaurant', roleError = null } = {}) {
  return load('../app/api/geocode/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/work-location': geo,
    '@/lib/supabase/request': {
      createRequestClient: () => ({
        supabase: {
          auth: { getUser: async () => ({ data: { user }, error: authError }) },
          from: () => ({
            select() { return this; }, eq() { return this; },
            single: async () => ({ data: { role }, error: roleError }),
          }),
        },
        finish: (response) => { response.headers.set('Cache-Control', 'private, no-store'); return response; },
      }),
    },
  }).POST;
}
const request = (body = address()) => new Request('http://localhost/api/geocode', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
function configure(t, endpoint) {
  const oldEndpoint = process.env.GEOCODING_ENDPOINT;
  const oldKey = process.env.GEOCODING_API_KEY;
  if (endpoint === undefined) delete process.env.GEOCODING_ENDPOINT;
  else process.env.GEOCODING_ENDPOINT = endpoint;
  process.env.GEOCODING_API_KEY = 'test-key';
  t.after(() => {
    if (oldEndpoint === undefined) delete process.env.GEOCODING_ENDPOINT;
    else process.env.GEOCODING_ENDPOINT = oldEndpoint;
    if (oldKey === undefined) delete process.env.GEOCODING_API_KEY;
    else process.env.GEOCODING_API_KEY = oldKey;
  });
}

test('geocoder authenticates the restaurant and rejects invalid address/configuration', async (t) => {
  configure(t);
  assert.equal((await route({ user: null })(request())).status, 401);
  assert.equal((await route({ role: 'worker' })(request())).status, 403);
  assert.equal((await route({ roleError: new Error('db') })(request())).status, 503);
  assert.equal((await route()(request({ ...address(), city: '' }))).status, 400);
  assert.equal((await route()(request())).status, 503);
  process.env.GEOCODING_ENDPOINT = 'http://provider.invalid';
  assert.equal((await route()(request())).status, 503);
});

test('geocoder uses server-only endpoint/key and validates provider response', async (t) => {
  configure(t, 'https://provider.invalid/geocode');
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.toString(), 'https://provider.invalid/geocode');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.country, 'BR');
    assert.equal(body.number, '120');
    return Response.json({ latitude: -22, longitude: -47 });
  });
  const response = await route()(request({ ...address(), endpoint: 'https://attacker.invalid' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual(await response.json(), { latitude: -22, longitude: -47 });
  assert.equal((await route()(request({
    address: 'Rua das Flores', number: '120', city: 'Piracicaba', state: 'SP',
    location_name: 'Operação', neighborhood: '',
  }))).status, 200);
  fetch.mock.mockImplementation(async () => Response.json({ latitude: '0', longitude: '0' }));
  assert.equal((await route()(request())).status, 502);
  fetch.mock.mockImplementation(async () => new Response('', { status: 429 }));
  assert.equal((await route()(request())).status, 502);
  fetch.mock.mockImplementation(async () => { throw new Error('timeout'); });
  t.mock.method(console, 'error', () => {});
  assert.equal((await route()(request())).status, 502);
});

test('job creation no longer captures publisher GPS and worker applications have no GPS gate', () => {
  const create = source('../app/restaurant/dashboard/jobs/create/page.tsx');
  assert.doesNotMatch(create, /getDeviceCoordinates|navigator\.geolocation/);
  assert.match(create, /resolveWorkLocation/);
  assert.match(create, /rpc\('save_geocoded_work_location'/);
  assert.match(create, /rpc\('create_restaurant_demand'/);
  assert.match(create, /p_location_source: 'catalog'/);
  assert.match(create, /p_latitude: location\.latitude/);
  assert.match(create, /p_longitude: location\.longitude/);
  const worker = source('../app/worker/dashboard/page.tsx');
  const application = worker.slice(worker.indexOf('const handleApply'), worker.indexOf('const shareJob'));
  assert.match(application, /from\('applications'\)\.insert/);
  assert.doesNotMatch(application, /workerLocation|getDeviceCoordinates|distanceMeters/);
  assert.match(create, /validCoordinates\(location\.latitude, location\.longitude\)/);
  assert.match(create, /p_work_location_id: savedLocation\.id/);
});
