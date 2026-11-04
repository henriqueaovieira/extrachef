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
const quiet = t => Object.fromEntries(['info', 'warn', 'error'].map(level =>
  [level, t.mock.method(console, level, () => {})]));

test('Photon forward and reverse use configured base URL, lang=default, GeoJSON order and server-only namespace', async t => {
  const logs = quiet(t);
  const provider = new PhotonProvider('https://geo.example/base', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://geo.example');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Accept, 'application/json');
    return Response.json(collection(feature()));
  });
  const result = await provider.geocode(address);
  assert.equal(result.latitude, -23.55);
  assert.equal(result.longitude, -46.63);
  assert.equal(result.address.state, 'SP');
  assert.equal('country' in result, false);
  const forward = fetch.mock.calls[0].arguments[0];
  assert.equal(forward.pathname, '/base/api');
  assert.equal(forward.searchParams.get('lang'), 'default');
  assert.equal(forward.searchParams.get('limit'), '5');
  assert.match(forward.searchParams.get('q'), /120.*São Paulo/);
  await provider.reverseGeocode({ latitude: -23.55, longitude: -46.63 });
  const reverse = fetch.mock.calls[1].arguments[0];
  assert.equal(reverse.pathname, '/base/reverse');
  assert.equal(reverse.searchParams.get('lat'), '-23.55');
  assert.equal(reverse.searchParams.get('lang'), 'default');
  await new PhotonProvider('https://geo.example/base/', 1000).geocode(address);
  assert.equal(fetch.mock.calls[2].arguments[0].pathname, '/base/api');
  await new PhotonProvider('https://geo.example', 1000).geocode(address);
  assert.equal(fetch.mock.calls[3].arguments[0].pathname, '/api');
  assert.notEqual(provider.namespace, new PhotonProvider('https://other.example', 1000).namespace);
  const events = logs.info.mock.calls.map(call => call.arguments[1].event);
  assert.ok(events.includes('provider_request') && events.includes('provider_response'));
  const request = logs.info.mock.calls[0].arguments[1];
  assert.equal(request.provider, 'photon');
  assert.match(request.url, /^https:\/\/geo\.example\/base\/api\?q=/);
});

test('Photon street matching tolerates accents, abbreviations and missing house numbers', async t => {
  quiet(t);
  const provider = new PhotonProvider('https://geo.example', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(collection(feature())));
  for (const input of [
    { address: 'R. das Flores' }, { address: 'RUA DAS FLÔRES' }, { address: 'Rua Flores' },
    { city: 'Sao Paulo' }, { address: 'R Das  Flores', number: ' 120 ' },
  ]) {
    assert.equal((await provider.geocode({ ...address, ...input })).latitude, -23.55);
  }
  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ street: 'Avenida Doutor Arnaldo', housenumber: '' }))));
  assert.equal((await provider.geocode({ ...address, address: 'Av. Dr. Arnaldo' })).latitude, -23.55);

  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ street: undefined, housenumber: undefined, type: 'street', name: 'Rua das Flores' }))));
  const street = await provider.geocode(address);
  assert.equal(street.address.address, 'Rua das Flores');
  assert.equal(street.address.number, '');

  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ housenumber: '' }, [-46.70, -23.60]), feature({}, [-46.63, -23.55]))));
  assert.equal((await provider.geocode(address)).latitude, -23.55, 'exact house number wins over street fallback');

  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ housenumber: '' }), feature({ housenumber: '' }, [-46.6305, -23.5505]))));
  assert.equal((await provider.geocode(address)).latitude, -23.55, 'nearby street segments are accepted');

  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ postcode: '' }))));
  assert.equal((await provider.geocode({ ...address, postal_code: '01001-000' })).latitude, -23.55);

  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ postcode: '13520-000', city: 'São Pedro', housenumber: '' }))));
  assert.equal((await provider.geocode({ ...address, city: 'São Pedro', postal_code: '13520-123' })).latitude, -23.55,
    'a city-wide CEP only needs the same 5-digit region');
  await assert.rejects(provider.geocode({ ...address, city: 'São Pedro', postal_code: '13521-123' }),
    error => error.code === 'not_found', 'a city-wide CEP from another region is rejected');
  fetch.mock.mockImplementation(async () => Response.json(collection(feature({ postcode: '01001-001' }))));
  await assert.rejects(provider.geocode({ ...address, postal_code: '01001-002' }), error => error.code === 'not_found',
    'specific CEPs must match exactly');
});

test('Photon rejects imprecise, wrong country/state/city, mismatched and ambiguous addresses', async t => {
  quiet(t);
  const provider = new PhotonProvider('https://geo.example', 1000);
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(collection()));
  for (const properties of [
    {}, { countrycode: 'US' }, { state: 'Rio de Janeiro' }, { city: 'Campinas' },
    { street: '' }, { street: 'Rua das Rosas' }, { housenumber: '121' },
    { street: undefined, type: 'house', name: 'Rua das Flores' }, { postcode: '02002-000' },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(collection(
      ...(Object.keys(properties).length ? [feature(properties)] : []))));
    await assert.rejects(provider.geocode({ ...address, postal_code: '01001-000' }), error => error.code === 'not_found',
      JSON.stringify(properties));
  }
  fetch.mock.mockImplementation(async () => Response.json(collection(feature(), feature({}, [-46.64, -23.55]))));
  await assert.rejects(provider.geocode(address), error => error.code === 'ambiguous');
  fetch.mock.mockImplementation(async () => Response.json(collection(
    feature({ housenumber: '' }), feature({ housenumber: '' }, [-46.70, -23.60]))));
  await assert.rejects(provider.geocode(address), error => error.code === 'ambiguous');
  await assert.rejects(provider.geocode({ ...address, number: '' }), error => error.code === 'invalid_address');
  await assert.rejects(provider.reverseGeocode({ latitude: null, longitude: 0 }), error => error.code === 'invalid_coordinates');
});

test('Photon classifies timeout, offline, 429, 5xx, invalid JSON/shape and coordinates', async t => {
  const logs = quiet(t);
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

  const photon400 = '{"lang":[{"message":"Language is not supported. Supported are: default, de, en, fr","args":{},"value":"pt"}]}';
  for (const [status, body] of [[400, photon400], [502, 'Bad gateway']]) {
    logs.error.mock.resetCalls();
    fetch.mock.mockImplementation(async () => new Response(body, { status }));
    await assert.rejects(provider.geocode(address), error =>
      error.code === 'provider_error' && error.providerStatus === status && error.status === 503
      && !error.message.includes(body));
    const logged = logs.error.mock.calls.find(call => call.arguments[1].event === 'provider_http_error').arguments[1];
    assert.equal(logged.status, status);
    assert.equal(logged.body, body);
    assert.equal(logged.bodyTruncated, false);
    assert.match(logged.url, /^https:\/\/geo\.example\/api\?/);
  }
  logs.error.mock.resetCalls();
  fetch.mock.mockImplementation(async () => new Response('x'.repeat(10_050), { status: 500 }));
  await assert.rejects(provider.geocode(address), error => error.code === 'provider_error');
  const truncated = logs.error.mock.calls[0].arguments[1];
  assert.equal(truncated.body.length, 10_000);
  assert.equal(truncated.bodyTruncated, true);
  fetch.mock.mockImplementation(async () => { throw new DOMException('timeout', 'TimeoutError'); });
  logs.error.mock.resetCalls();
  await assert.rejects(provider.geocode(address));
  assert.equal(logs.error.mock.calls[0].arguments[1].event, 'provider_timeout');
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
