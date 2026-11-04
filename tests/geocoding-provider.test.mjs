import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', code)(name => {
      if (name === 'server-only') return {};
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === '@/lib/work-location') return load('../lib/work-location.ts');
      if (name.startsWith('./')) return load(`../lib/geocoding/${name.slice(2)}.ts`);
      return require(name);
    }, exports);
    return exports;
  }
  return load;
}
const load = loader();
const { PhotonProvider } = load('../lib/geocoding/photon.ts');
const { GeocodingError, normalizeAddress } = load('../lib/geocoding/types.ts');
const { GeocodingCache, hash } = load('../lib/geocoding/cache.ts');
const address = { address: 'Rua das Flores', number: '120', city: 'São Paulo', state: 'SP', neighborhood: '', postal_code: '' };
const feature = (overrides = {}, coordinates = [-46.63, -23.55]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {
    street: address.address, housenumber: '120', city: 'São Paulo', state: 'São Paulo',
    countrycode: 'BR', ...overrides,
  },
});
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('Photon forward and reverse use configured base URL, GeoJSON order and server-only namespace', async t => {
  const provider = new PhotonProvider('https://geo.example/base', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://geo.example');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return Response.json(collection(feature()));
  });
  const result = await provider.geocode(address);
  assert.equal(result.latitude, -23.55);
  assert.equal(result.longitude, -46.63);
  assert.equal(result.address.state, 'SP');
  assert.match(fetch.mock.calls[0].arguments[0].pathname, /base\/api$/);
  assert.match(fetch.mock.calls[0].arguments[0].searchParams.get('q'), /120.*São Paulo/);
  await provider.reverseGeocode({ latitude: -23.55, longitude: -46.63 });
  const reverse = fetch.mock.calls[1].arguments[0];
  assert.equal(reverse.pathname, '/base/reverse');
  assert.equal(reverse.searchParams.get('lat'), '-23.55');
  assert.notEqual(provider.namespace, new PhotonProvider('https://other.example', 1000).namespace);
});

test('Photon rejects imprecise, wrong country/state/city, mismatched and ambiguous addresses', async t => {
  const provider = new PhotonProvider('https://geo.example', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(collection()));
  for (const properties of [
    {}, { countrycode: 'US' }, { state: 'Rio de Janeiro' }, { city: 'Campinas' },
    { street: '' }, { housenumber: '' }, { housenumber: '121' },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(collection(
      ...(Object.keys(properties).length ? [feature(properties)] : []))));
    await assert.rejects(provider.geocode(address), error => error.code === 'not_found');
  }
  fetch.mock.mockImplementation(async () => Response.json(collection(feature(), feature({}, [-46.64, -23.55]))));
  await assert.rejects(provider.geocode(address), error => error.code === 'ambiguous');
  await assert.rejects(provider.geocode({ ...address, number: '' }), error => error.code === 'invalid_address');
  await assert.rejects(provider.reverseGeocode({ latitude: null, longitude: 0 }), error => error.code === 'invalid_coordinates');
});

test('Photon classifies timeout, offline, 429, 5xx, invalid JSON/shape and coordinates', async t => {
  const provider = new PhotonProvider('https://geo.example', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(collection(feature())));
  for (const [implementation, code] of [
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 'timeout'],
    [async () => { throw new TypeError('network'); }, 'offline'],
    [async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }), 'rate_limited'],
    [async () => new Response('', { status: 500 }), 'provider_error'],
    [async () => new Response('{'), 'invalid_response'],
    [async () => Response.json({ features: [] }), 'invalid_response'],
    [async () => Response.json(collection({ type: 'Feature' })), 'invalid_response'],
    [async () => Response.json(collection(feature({}, [0, 91]))), 'invalid_coordinates'],
    [async () => Response.json(collection(feature({}, ['-46', '-23']))), 'invalid_coordinates'],
    [async () => ({
      ok: true, json: async () => { throw new DOMException('body timeout', 'TimeoutError'); },
    }), 'timeout'],
  ]) {
    fetch.mock.mockImplementation(implementation);
    await assert.rejects(provider.geocode(address), error => error.code === code);
  }
  fetch.mock.mockImplementation(async () => new Response('', {
    status: 429, headers: { 'Retry-After': new Date(Date.now() + 120000).toUTCString() },
  }));
  await assert.rejects(provider.geocode(address), error =>
    error.code === 'rate_limited' && error.retryAfter >= 118 && error.retryAfter <= 120);
});

function dbMock() {
  const db = { data: null, error: null, rpcData: true, writes: [], calls: [], owner: null };
  db.from = () => {
    const query = {
      select() { return this; },
      eq(key, value) { if (key === 'restaurant_id') db.owner = value; return this; },
      maybeSingle: async () => ({ data: db.data, error: db.error }),
      upsert: async value => { db.writes.push(value); return { error: db.error }; },
      delete() { return this; },
      then(resolve) { return resolve({ error: db.error }); },
    };
    return query;
  };
  db.rpc = async (name, args) => { db.calls.push({ name, args }); return { data: db.rpcData, error: db.error }; };
  return db;
}
const cached = () => ({
  latitude: -23.55, longitude: -46.63, result_address: address,
  provider_response_hash: 'a'.repeat(64), expires_at: new Date(Date.now() + 60000).toISOString(),
});

test('persistent cache distinguishes hit/miss/refresh, validates data and scopes writes to owner', async () => {
  const db = dbMock(), cache = new GeocodingCache(db, 'owner');
  assert.equal((await cache.read('geocode', 'ns', 'key')).state, 'miss');
  db.data = cached();
  assert.equal((await cache.read('geocode', 'ns', 'key')).state, 'hit');
  assert.equal(db.owner, 'owner');
  db.data.expires_at = '2000-01-01';
  assert.equal((await cache.read('geocode', 'ns', 'key')).state, 'refresh');
  db.data.latitude = null;
  await assert.rejects(cache.read('geocode', 'ns', 'key'), error => error.code === 'cache_error');
  await cache.write('geocode', 'ns', 'key', normalizeAddress(address), {
    latitude: 0, longitude: 0, address, responseHash: 'a'.repeat(64),
  }, 60, 'photon');
  assert.equal(db.writes[0].restaurant_id, 'owner');
  assert.equal(db.writes[0].provider_response_hash, 'a'.repeat(64));
  assert.equal(db.writes[0].provider, 'photon');
  await cache.invalidate('geocode', 'ns', 'key');
  db.error = { message: 'database' };
  await assert.rejects(cache.read('geocode', 'ns', 'key'), error => error.code === 'cache_error');
  await assert.rejects(cache.write('geocode', 'ns', 'key', {}, {}, 60, 'photon'), error => error.code === 'cache_error');
  await assert.rejects(cache.invalidate('geocode', 'ns', 'key'), error => error.code === 'cache_error');
});

test('cache coordination rejects busy or unavailable coordinator and releases only its token', async () => {
  const db = dbMock(), cache = new GeocodingCache(db, 'owner');
  const token = await cache.acquire('namespace', 10000);
  assert.equal(db.calls[0].args.p_seconds, 20);
  await cache.release('namespace', token, 60);
  assert.equal(db.calls[1].args.p_token, token);
  db.rpcData = false;
  await assert.rejects(cache.acquire('namespace', 10000), error => error.code === 'rate_limited');
  db.error = {};
  await assert.rejects(cache.acquire('namespace', 10000), error => error.code === 'cache_error');
  await assert.rejects(cache.release('namespace', token, 1), error => error.code === 'cache_error');
});

test('normalization preserves number, excludes display name and creates deterministic keys', () => {
  const normalized = normalizeAddress({ ...address, address: '  Rua  das Flores ', state: 'SP' });
  assert.equal(normalized.address, 'rua das flores');
  assert.equal(normalized.state, 'sp');
  assert.equal(hash(normalized), hash(normalizeAddress(address)));
  assert.notEqual(hash(normalized), hash(normalizeAddress({ ...address, number: '121' })));
});

test('service uses cache without provider; refreshes once and releases on provider failure', async () => {
  const db = dbMock();
  let requests = 0;
  const config = { endpoint: 'https://geo.example', timeout: 10000, ttl: 60 };
  const serviceLoad = loader({
    '@/lib/supabase/admin': { createAdminClient: () => db },
    './provider': {
      geocodingConfiguration: () => config,
      createGeocodingProvider: () => ({
        name: 'photon', namespace: 'namespace',
        geocode: async () => {
          requests++;
          if (requests > 1) throw new GeocodingError('rate_limited', 'busy', 429, 120);
          return { latitude: -23.55, longitude: -46.63, address, responseHash: 'a'.repeat(64) };
        },
      }),
    },
    './types': { GeocodingError, normalizeAddress },
  });
  const { createGeocodingService } = serviceLoad('../lib/geocoding/index.ts');
  const service = createGeocodingService('owner', 'request');
  await service.geocode(address);
  assert.equal(db.writes.length, 1);
  assert.equal(requests, 1);
  db.data = cached();
  await service.geocode(address);
  assert.equal(requests, 1);
  db.data.expires_at = '2000-01-01';
  await assert.rejects(service.geocode(address), error => error.code === 'rate_limited');
  assert.equal(db.calls.at(-1).args.p_cooldown, 120);
});

test('configuration requires explicit Photon endpoint and bounded timeout/TTL', t => {
  const names = ['GEOCODING_PROVIDER', 'GEOCODING_ENDPOINT', 'GEOCODING_TIMEOUT', 'GEOCODING_CACHE_TTL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => names.forEach(name => {
    if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }));
  const { geocodingConfiguration } = load('../lib/geocoding/provider.ts');
  Object.assign(process.env, {
    GEOCODING_PROVIDER: 'photon', GEOCODING_ENDPOINT: 'https://geo.example/',
    GEOCODING_TIMEOUT: '10000', GEOCODING_CACHE_TTL: '60',
  });
  assert.equal(geocodingConfiguration().endpoint, 'https://geo.example');
  for (const [key, value] of [
    ['GEOCODING_ENDPOINT', 'http://geo.example'], ['GEOCODING_ENDPOINT', ''],
    ['GEOCODING_PROVIDER', 'other'], ['GEOCODING_TIMEOUT', '0'], ['GEOCODING_CACHE_TTL', 'NaN'],
  ]) {
    const old = process.env[key]; process.env[key] = value;
    assert.throws(geocodingConfiguration, /serviço|URL|HTTPS/);
    process.env[key] = old;
  }
});
