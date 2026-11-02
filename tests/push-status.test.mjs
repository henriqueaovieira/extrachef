import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createECDH, randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createClient as createRealClient } from '@supabase/supabase-js';

function load(file, dependencies, environment, logs) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Buffer, process: { env: environment },
    console: Object.fromEntries(['info', 'warn', 'error'].map((level) => [
      level, (...args) => logs.push({ level, args }),
    ])),
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

function loadAdmin(environment, createClient = () => ({}), logs = []) {
  return load('../lib/supabase/admin.ts', {
    'server-only': {},
    '@supabase/supabase-js': { createClient },
  }, environment, logs);
}

test('admin rejects missing/blank credentials before initializing the SDK and logs only presence', () => {
  for (const environment of [
    {},
    { NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid', SUPABASE_SERVICE_ROLE_KEY: '   ' },
    { NEXT_PUBLIC_SUPABASE_URL: ' ', SUPABASE_SERVICE_ROLE_KEY: 'private-test-value' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-value' },
  ]) {
    const logs = [];
    const admin = loadAdmin(environment, () => assert.fail('Unexpected SDK initialization'), logs);
    assert.throws(() => admin.createAdminClient({ requestId: 'test-request' }), (error) => {
      assert.ok(error instanceof admin.AdminConfigurationError);
      assert.equal(error.code, 'missing_credentials');
      return true;
    });
    assert.equal(logs[0].args[0], 'supabase_admin_configuration_failed');
    assert.equal(logs[0].args[1].requestId, 'test-request');
    assert.doesNotMatch(JSON.stringify(logs), /private-test-value|public-test-value|https:\/\/project/);
  }
});

test('admin keeps legacy precedence, trims values, and supports server-only secret aliases', () => {
  const calls = [];
  const logs = [];
  const client = {};
  const createClient = (...args) => { calls.push(args); return client; };
  const admin = loadAdmin({
    NEXT_PUBLIC_SUPABASE_URL: ' https://primary.invalid ',
    SUPABASE_URL: 'https://secondary.invalid',
    SUPABASE_SERVICE_ROLE_KEY: ' primary-private-value ',
    SUPABASE_SECRET_KEY: 'secondary-private-value',
  }, createClient, logs);
  assert.equal(admin.createAdminClient(), client);
  assert.equal(calls[0][0], 'https://primary.invalid');
  assert.equal(calls[0][1], 'primary-private-value');
  assert.equal(calls[0][2].auth.persistSession, false);
  assert.equal(calls[0][2].auth.autoRefreshToken, false);
  assert.equal(logs[0].args[1].environment.SUPABASE_SERVICE_ROLE_KEY.padded, true);

  const fallback = loadAdmin({
    NEXT_PUBLIC_SUPABASE_URL: ' ', SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_URL: 'https://secondary.invalid', SUPABASE_SECRET_KEY: 'secondary-private-value',
  }, createClient, logs);
  assert.equal(fallback.createAdminClient(), client);
  assert.equal(calls[1][0], 'https://secondary.invalid');
  assert.equal(calls[1][1], 'secondary-private-value');
  assert.equal(logs[1].args[1].keySource, 'SUPABASE_SECRET_KEY');
  assert.doesNotMatch(JSON.stringify(logs), /primary-private-value|secondary-private-value|https:\/\//);
});

test('admin distinguishes malformed URL and SDK initialization errors without leaking raw exceptions', () => {
  for (const url of ['invalid-url', 'ftp://project.invalid', 'https://user:password@project.invalid', 'https://project.invalid?secret=value']) {
    const logs = [];
    const admin = loadAdmin({
      NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'private-test-value',
    }, () => assert.fail('Unexpected SDK initialization'), logs);
    assert.throws(() => admin.createAdminClient(), { code: 'invalid_url' });
    assert.equal(logs[0].args[1].code, 'invalid_url');
    assert.doesNotMatch(JSON.stringify(logs), /password|private-test-value|secret=value/);
  }
  const logs = [];
  const admin = loadAdmin({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid', SUPABASE_SERVICE_ROLE_KEY: 'private-test-value',
  }, () => { throw new Error('SDK failure with private-test-value'); }, logs);
  assert.throws(() => admin.createAdminClient(), { code: 'initialization_failed' });
  assert.doesNotMatch(JSON.stringify(logs), /SDK failure|private-test-value/);
});

const vapid = createECDH('prime256v1');
vapid.generateKeys();
function configuredEnvironment() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'private-admin-test-value',
    WEB_PUSH_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
    WEB_PUSH_VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
    WEB_PUSH_SUBJECT: 'mailto:push@example.invalid',
    NEXT_PUBLIC_APP_URL: 'https://app.invalid',
    PUSH_WEBHOOK_SECRET: 'private-webhook-test-value',
  };
}

function harness(environment = configuredEnvironment(), options = {}) {
  const logs = [];
  const calls = [];
  const results = {
    push_subscriptions: { count: 2, error: null },
    notifications: { data: [{ id: 'owned-notification' }], error: null },
    push_deliveries: { data: [{ notification_id: 'owned-notification', status: 'received' }], error: null },
    ...options.results,
  };
  const db = {
    auth: { async getUser(token) {
      calls.push(['getUser', token]);
      if (options.authThrows) throw new Error('transport failed with private-admin-test-value');
      return options.authResult ?? { data: { user: { id: 'test-user' } }, error: null };
    } },
    from(table) {
      calls.push(['from', table]);
      const query = {
        select() { return query; },
        eq(column, value) {
          assert.equal(column, 'user_id');
          assert.equal(value, 'test-user');
          return query;
        },
        in(column, ids) {
          assert.equal(column, 'notification_id');
          assert.deepEqual(Array.from(ids), ['owned-notification']);
          return query;
        },
        order() { return query; },
        limit() { return query; },
        then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject); },
      };
      return query;
    },
  };
  const admin = loadAdmin(environment, () => { calls.push(['createClient']); return db; }, logs);
  if (options.adminThrows) admin.createAdminClient = () => { throw new Error('private-admin-test-value'); };
  const route = load('../app/api/push/status/route.ts', {
    'node:crypto': { randomUUID },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/admin': admin,
    '@/lib/push-config': load('../lib/push-config.ts', { 'node:crypto': { createECDH } }, environment, logs),
  }, environment, logs);
  return {
    logs, calls, route,
    async request(authenticated = true) {
      const response = await route.GET(new Request('https://app.invalid/api/push/status', {
        headers: authenticated ? { Authorization: 'Bearer private-access-test-value' } : {},
      }));
      const body = await response.json();
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-request-id'), body.requestId);
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      const completed = logs.findLast(({ args }) => args[0] === 'push_status_completed').args[1];
      assert.equal(completed.status, response.status);
      assert.ok(completed.durationMs >= 0);
      return { response, body };
    },
  };
}

test('status requires a bearer token before inspecting server configuration', async () => {
  const app = harness({});
  const { response } = await app.request(false);
  assert.equal(response.status, 401);
  assert.equal(app.calls.length, 0);
});

test('status returns a traceable 503 for local configuration failure with no outgoing requests', async () => {
  const app = harness({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid' });
  const { response, body } = await app.request();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'PUSH_ADMIN_CONFIGURATION_ERROR');
  assert.equal(body.configured, false);
  assert.equal(app.calls.length, 0);
  const failure = app.logs.find(({ args }) => args[0] === 'supabase_admin_configuration_failed');
  assert.equal(failure.args[1].requestId, body.requestId);
  assert.equal(failure.args[1].code, 'missing_credentials');
});

test('status does not mislabel unexpected failures as missing credentials', async () => {
  for (const options of [{ adminThrows: true }, { authThrows: true }]) {
    const app = harness(configuredEnvironment(), options);
    const { response, body } = await app.request();
    assert.equal(response.status, 500);
    assert.equal(body.code, 'PUSH_STATUS_INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(app.logs), /private-admin-test-value/);
  }
});

test('status distinguishes rejected authentication from an unavailable Auth service', async () => {
  for (const [status, expected] of [[401, 401], [403, 401], [503, 503], [undefined, 503]]) {
    const app = harness(configuredEnvironment(), {
      authResult: { data: { user: null }, error: { status, code: 'test_auth_error', message: 'private-access-test-value' } },
    });
    const { response, body } = await app.request();
    assert.equal(response.status, expected);
    if (expected === 503) assert.equal(body.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.ok(!app.calls.some(([name]) => name === 'from'));
    assert.doesNotMatch(JSON.stringify(app.logs), /private-access-test-value/);
  }
});

test('status preserves the successful response and never logs credentials, tokens or history', async () => {
  const environment = configuredEnvironment();
  const app = harness(environment);
  const { response, body } = await app.request();
  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.registeredDevices, 2);
  assert.equal(body.deliveryHistoryAvailable, true);
  assert.equal(body.deliveries[0].status, 'received');
  assert.equal(body.environment.browserVapidPublicKey, true);
  const serializedLogs = JSON.stringify(app.logs);
  for (const value of Object.values(environment)) assert.ok(!serializedLogs.includes(value));
  assert.doesNotMatch(serializedLogs, /private-access-test-value|owned-notification|test-user/);
  const completion = app.logs.find(({ args }) => args[0] === 'push_status_completed').args[1];
  assert.equal(completion.stage, 'push_configuration');
  assert.ok(Object.hasOwn(completion.timings, 'auth_get_user'));
});

test('legacy VAPID_PUBLIC_KEY alone is not recognized; absent/mismatched browser VAPID is unconfigured', async () => {
  for (const variant of ['legacy', 'missing-browser', 'mismatched-browser']) {
    const environment = configuredEnvironment();
    if (variant === 'legacy') {
      environment.VAPID_PUBLIC_KEY = environment.WEB_PUSH_VAPID_PUBLIC_KEY;
      delete environment.WEB_PUSH_VAPID_PUBLIC_KEY;
      delete environment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    } else if (variant === 'missing-browser') {
      delete environment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    } else {
      environment.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY = 'different-browser-key';
    }
    const app = harness(environment);
    const { response, body } = await app.request();
    assert.equal(response.status, 200);
    assert.equal(body.configured, false);
  }
});

test('status recognizes secret-key fallback and server public VAPID remains optional', async () => {
  const environment = configuredEnvironment();
  environment.SUPABASE_SECRET_KEY = environment.SUPABASE_SERVICE_ROLE_KEY;
  delete environment.SUPABASE_SERVICE_ROLE_KEY;
  delete environment.WEB_PUSH_VAPID_PUBLIC_KEY;
  const app = harness(environment);
  const { body } = await app.request();
  assert.equal(body.configured, true);
  assert.equal(body.environment.serviceRole, true);
});

test('subscription failures are explicit 500s and do not read history', async () => {
  const app = harness(configuredEnvironment(), {
    results: { push_subscriptions: { count: null, error: { code: '42P01', message: 'sensitive database detail' } } },
  });
  const { response } = await app.request();
  assert.equal(response.status, 500);
  assert.ok(!app.calls.some(([, table]) => table === 'notifications'));
  assert.ok(app.logs.some(({ args }) => args[0] === 'push_status_subscriptions_failed' && args[1].code === '42P01'));
  assert.doesNotMatch(JSON.stringify(app.logs), /sensitive database detail/);
});

test('optional history failures stay visible without taking down status', async () => {
  for (const table of ['notifications', 'push_deliveries']) {
    const app = harness(configuredEnvironment(), {
      results: { [table]: { data: null, error: { code: '42P01' } } },
    });
    const { response, body } = await app.request();
    assert.equal(response.status, 200);
    assert.equal(body.deliveryHistoryAvailable, false);
    assert.deepEqual(body.deliveries, []);
    assert.ok(app.logs.some(({ args }) => args[0] === `push_status_${table === 'notifications' ? 'notifications' : 'deliveries'}_failed`));
  }
  const app = harness(configuredEnvironment(), {
    results: { notifications: { data: [], error: null }, push_subscriptions: { count: 0, error: null } },
  });
  const { body } = await app.request();
  assert.equal(body.registeredDevices, 0);
  assert.equal(body.deliveryHistoryAvailable, true);
  assert.deepEqual(body.deliveries, []);
  assert.ok(!app.calls.some(([, table]) => table === 'push_deliveries'));
});

test('temporary admin diagnostics distinguish empty, whitespace, types, sources and valid URLs', () => {
  const logs = [];
  const environment = {
    PUSH_DIAGNOSTICS_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.invalid',
    SUPABASE_SERVICE_ROLE_KEY: '   ',
    SUPABASE_SECRET_KEY: '',
  };
  const admin = loadAdmin(environment, () => assert.fail('Unexpected SDK call'), logs);
  assert.throws(() => admin.createAdminClient(), (error) => {
    const diagnostics = error.diagnostics;
    assert.equal(diagnostics.version, 'admin-env-v2');
    assert.equal(diagnostics.urlValid, true);
    assert.equal(diagnostics.keySource, null);
    assert.equal(diagnostics.hasServiceRole, true);
    assert.equal(diagnostics.serviceRoleLength, 3);
    const role = diagnostics.environment.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(role.type, 'string');
    assert.equal(role.empty, false);
    assert.equal(role.whitespaceOnly, true);
    assert.equal(diagnostics.environment.SUPABASE_SECRET_KEY.empty, true);
    assert.equal(diagnostics.environment.SUPABASE_URL.type, 'undefined');
    return true;
  });
  assert.equal(logs[0].args[1].serviceRoleLength, 3);
  assert.doesNotMatch(JSON.stringify(logs), /https:\/\/project/);
});

test('real installed SDK reproduces synchronous WebSocket failure with zero requests', () => {
  const websocket = globalThis.WebSocket;
  const fetch = globalThis.fetch;
  let outgoing = 0;
  const environment = {
    PUSH_DIAGNOSTICS_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic-project.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
  };
  try {
    globalThis.fetch = () => { outgoing++; throw new Error('Unexpected request'); };
    if (typeof websocket === 'function') {
      const logs = [];
      const admin = loadAdmin(environment, createRealClient, logs);
      assert.ok(admin.createAdminClient());
      assert.ok(logs.some(({ args }) => args[0] === 'supabase_admin_initialized'));
    }
    globalThis.WebSocket = undefined;
    const logs = [];
    const admin = loadAdmin(environment, createRealClient, logs);
    assert.throws(() => admin.createAdminClient(), (error) => {
      assert.equal(error.code, 'initialization_failed');
      assert.equal(error.diagnostics.sdkException, 'native_websocket_missing');
      assert.equal(error.diagnostics.runtime.websocketType, 'undefined');
      assert.equal(error.diagnostics.urlValid, true);
      assert.equal(error.diagnostics.keySource, 'SUPABASE_SERVICE_ROLE_KEY');
      return true;
    });
    assert.equal(outgoing, 0);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-server-key|https:\/\/synthetic/);
  } finally {
    globalThis.WebSocket = websocket;
    globalThis.fetch = fetch;
  }
});

test('temporary status diagnostics expose the exact initialization step only when enabled', async () => {
  const app = harness({ PUSH_DIAGNOSTICS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: '' });
  const { response, body } = await app.request();
  assert.equal(response.status, 503);
  assert.equal(body.step, 'admin_initialization');
  assert.equal(body.reason, 'missing_credentials');
  assert.equal(body.diagnostics.version, 'admin-env-v2');
  assert.equal(body.diagnostics.environment.SUPABASE_SERVICE_ROLE_KEY.empty, true);
  assert.equal(response.headers.get('x-push-diagnostics-version'), 'admin-env-v2');
  assert.ok(body.requestId);
  const disabled = await harness({}).request();
  assert.equal(Object.hasOwn(disabled.body, 'diagnostics'), false);
  assert.equal(Object.hasOwn(disabled.body, 'step'), false);
  assert.equal(disabled.response.headers.get('x-push-diagnostics-version'), null);
});

test('enabled status retains initialization diagnostics when a later Auth operation fails', async () => {
  const app = harness({ ...configuredEnvironment(), PUSH_DIAGNOSTICS_ENABLED: 'true' }, {
    authResult: { data: { user: null }, error: { status: 503, code: 'auth_unavailable' } },
  });
  const { response, body } = await app.request();
  assert.equal(response.status, 503);
  assert.equal(body.step, 'auth_get_user');
  assert.equal(body.reason, 'AUTH_SERVICE_UNAVAILABLE');
  assert.equal(body.diagnostics.urlValid, true);
  assert.equal(body.diagnostics.keySource, 'SUPABASE_SERVICE_ROLE_KEY');
  assert.equal(body.diagnostics.sdkException, null);
});

test('debug env returns exactly four metadata fields and is disabled by default', async () => {
  for (const enabled of [false, true]) {
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic-project.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
      PUSH_DIAGNOSTICS_ENABLED: enabled ? 'true' : 'false',
    };
    const route = load('../app/api/debug/env/route.ts', {
      'next/server': {
        connection: async () => {},
        NextResponse: { json: (body, init) => Response.json(body, init) },
      },
    }, environment, []);
    const response = await route.GET();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(response.status, enabled ? 200 : 404);
    assert.equal(response.headers.get('x-push-diagnostics-version'), enabled ? 'admin-env-v2' : null);
    if (enabled) assert.deepEqual(body, {
      hasSupabaseUrl: true, hasServiceRoleKey: true,
      supabaseUrlLength: environment.NEXT_PUBLIC_SUPABASE_URL.length,
      serviceRoleLength: environment.SUPABASE_SERVICE_ROLE_KEY.length,
    });
    assert.doesNotMatch(JSON.stringify(body), /synthetic-server-key|https:\/\/synthetic/);
  }
});
