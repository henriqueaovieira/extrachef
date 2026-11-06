import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/api/checkin/route.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

function route({ user = { id: 'worker' }, rpcError = null, data = { code: 'A1B2C3D4' } } = {}) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data, error: rpcError };
    },
  };
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => name === '@/lib/auth/api-user'
      ? { authenticatedApiUser: async () => user ? { user, client } : null }
      : require(name),
    exports,
  );
  return { POST: exports.POST, calls };
}

const request = body => new Request('https://extrachef.test/api/checkin', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('check-in API authenticates, forwards GPS metadata to the existing operational RPC and avoids caching', async () => {
  const handler = route({ data: { phase: 'checkin', location_precision: 'street' } });
  const response = await handler.POST(request({
    jobId: '00000000-0000-0000-0000-000000000001',
    latitude: -23.5, longitude: -46.6, accuracy: 10, speed: 2, isMock: false,
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { phase: 'checkin', location_precision: 'street' });
  assert.deepEqual(handler.calls, [{
    name: 'issue_operational_code',
    args: {
      p_job_id: '00000000-0000-0000-0000-000000000001',
      p_stage: 'checkin',
      p_latitude: -23.5,
      p_longitude: -46.6,
      p_accuracy: 10,
      p_speed: 2,
      p_is_mock: false,
    },
  }]);
});

test('check-in API requires authentication and delegates missing GPS to rate-limited validation', async () => {
  const unauthenticated = route({ user: null });
  assert.equal((await unauthenticated.POST(request({}))).status, 401);
  const handler = route({ data: { error: 'Ative sua localização para registrar presença.' } });
  const response = await handler.POST(request({
    jobId: '00000000-0000-0000-0000-000000000001',
    latitude: null, longitude: -46.6, accuracy: 10, speed: null, isMock: false,
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Ative sua localização para registrar presença.');
  assert.equal(handler.calls.length, 1);
  assert.equal(handler.calls[0].args.p_latitude, null);
});

test('check-in rate limiting returns the specified HTTP status and message', async () => {
  const handler = route({ rpcError: { code: 'P0001', message: 'Muitas tentativas detectadas. Aguarde alguns minutos e tente novamente.' } });
  const response = await handler.POST(request({
    jobId: '00000000-0000-0000-0000-000000000001',
    latitude: -23.5, longitude: -46.6, accuracy: 10, speed: null, isMock: false,
  }));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /Muitas tentativas detectadas/);
});
