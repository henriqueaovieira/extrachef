import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');

function loadTs(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  const resolve = (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  new Function('require', 'exports', outputText)(resolve, exports);
  return exports;
}

const routes = loadTs('../lib/auth/routes.ts');
const { getAccountRole } = loadTs('../lib/auth/account.ts', { './routes': routes });

function accountClient(results, rpcError = null) {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      select: (fields) => ({
        eq: (field, value) => ({
          maybeSingle: async () => {
            calls.push(['read', table, fields, field, value]);
            return results.shift();
          },
        }),
      }),
    }),
    rpc: async (name) => {
      calls.push(['rpc', name]);
      return { error: rpcError };
    },
  };
}

test('existing account role is used without provisioning or overwriting profile data', async () => {
  const client = accountClient([{ data: { role: 'restaurant' }, error: null }]);
  assert.equal(await getAccountRole(client, 'test-user', true), 'restaurant');
  assert.deepEqual(client.calls, [['read', 'users', 'role', 'id', 'test-user']]);
});

test('missing account is provisioned only when explicitly requested after authentication', async () => {
  const client = accountClient([
    { data: null, error: null },
    { data: { role: 'worker' }, error: null },
  ]);
  assert.equal(await getAccountRole(client, 'test-user', true), 'worker');
  assert.deepEqual(client.calls[1], ['rpc', 'ensure_account_profile']);
  const withoutProvision = accountClient([{ data: null, error: null }]);
  await assert.rejects(getAccountRole(withoutProvision, 'test-user'), /perfil válido/);
  assert.equal(withoutProvision.calls.length, 1);
});

test('profile lookup and provisioning errors are explicit, never a worker fallback', async () => {
  const unavailable = accountClient([{ data: null, error: { code: 'unavailable' } }]);
  await assert.rejects(getAccountRole(unavailable, 'test-user', true), /carregar seu perfil/);
  const invalidMetadata = accountClient([{ data: null, error: null }], { code: '22023' });
  await assert.rejects(getAccountRole(invalidMetadata, 'test-user', true), /concluir seu cadastro/);
});

function proxyWith({ user = null, authError = null, role = 'worker', roleError = null, thrown = false } = {}) {
  return loadTs('../proxy.ts', {
    '@/lib/auth/routes': routes,
    '@/lib/supabase/request': {
      createRequestClient: () => ({
        supabase: {
          auth: {
            getUser: async () => {
              if (thrown) throw new TypeError('simulated transport failure');
              return { data: { user }, error: authError };
            },
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: role ? { role } : null, error: roleError }),
              }),
            }),
          }),
        },
        finish: (response = NextResponse.next()) => response,
      }),
    },
  }).proxy;
}

test('proxy preserves the requested route when authentication is absent', async () => {
  const response = await proxyWith()(new NextRequest('https://app.test/chat/123?from=push'));
  const destination = new URL(response.headers.get('location'));
  assert.equal(response.status, 307);
  assert.equal(destination.pathname, '/login');
  assert.equal(destination.searchParams.get('redirect'), '/chat/123?from=push');
  assert.equal(destination.searchParams.has('reason'), false);
});

test('invalid existing session includes session_expired', async () => {
  const request = new NextRequest('https://app.test/restaurant/events', {
    headers: { Cookie: 'sb-example-auth-token.0=expired' },
  });
  const response = await proxyWith({
    authError: { status: 401, name: 'AuthApiError', code: 'bad_jwt' },
  })(request);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('reason'), 'session_expired');
});

test('opposite-role navigation redirects to the correct dashboard with a friendly reason', async () => {
  for (const [role, path, expected] of [
    ['worker', '/restaurant/events', '/worker/dashboard'],
    ['restaurant', '/worker/profile', '/restaurant/dashboard'],
  ]) {
    const response = await proxyWith({ user: { id: 'test-user' }, role })(
      new NextRequest(`https://app.test${path}`),
    );
    const destination = new URL(response.headers.get('location'));
    assert.equal(destination.pathname, expected);
    assert.equal(destination.searchParams.get('reason'), 'role_forbidden');
  }
});

test('valid users can access their role namespace and shared routes', async () => {
  for (const [role, path] of [
    ['worker', '/worker/dashboard'], ['restaurant', '/restaurant/events'],
    ['worker', '/notifications'], ['restaurant', '/chat/123'],
  ]) {
    const response = await proxyWith({ user: { id: 'test-user' }, role })(
      new NextRequest(`https://app.test${path}`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.has('location'), false);
  }
});

test('missing or invalid profile is never silently treated as a worker', async () => {
  for (const role of [null, 'admin']) {
    const response = await proxyWith({ user: { id: 'test-user' }, role })(
      new NextRequest('https://app.test/restaurant/events'),
    );
    assert.equal(new URL(response.headers.get('location')).searchParams.get('reason'), 'profile_unavailable');
  }
});

test('Auth, database and transport outages fail closed without declaring session expiration', async () => {
  for (const options of [
    { authError: { status: 503, name: 'AuthApiError', code: 'unavailable' } },
    { user: { id: 'test-user' }, roleError: { code: 'unavailable' } },
    { thrown: true },
  ]) {
    const response = await proxyWith(options)(new NextRequest('https://app.test/notifications'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.has('location'), false);
  }
});

test('request client forwards refreshed cookies and preserves all updates on redirects', () => {
  let options;
  const { createRequestClient } = loadTs('../lib/supabase/request.ts', {
    '@supabase/ssr': { createServerClient: (_url, _key, suppliedOptions) => { options = suppliedOptions; return {}; } },
  });
  const request = new NextRequest('https://app.test/notifications');
  const { finish } = createRequestClient(request);
  options.cookies.setAll([
    { name: 'sb-test-auth-token.0', value: 'new-token', options: { path: '/', sameSite: 'lax' } },
  ], { 'Cache-Control': 'private, no-store' });
  options.cookies.setAll([
    { name: 'sb-test-auth-token.1', value: '', options: { path: '/', maxAge: 0 } },
  ], {});

  const next = finish();
  assert.match(next.headers.get('x-middleware-request-cookie'), /sb-test-auth-token.0=new-token/);
  assert.equal(options.cookies.getAll().find((cookie) => cookie.name === 'sb-test-auth-token.0').value, 'new-token');
  const redirect = finish(NextResponse.redirect('https://app.test/login'));
  assert.equal(redirect.cookies.get('sb-test-auth-token.0').value, 'new-token');
  assert.equal(redirect.cookies.get('sb-test-auth-token.1').value, '');
  assert.match(redirect.headers.get('cache-control'), /private.*no-store/);
});
