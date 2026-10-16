import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createECDH } from 'node:crypto';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, dependencies = {}, browser = {}) {
  const output = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, Response, URL, Uint8Array, atob, process: { env: {} }, ...browser });
  return exports;
}

test('Push renewal requires explicit account opt-in and never requests permission', async () => {
  let choice = null;
  let permission = 'granted';
  let subscriptions = 0;
  const subscription = { endpoint: 'test' };
  const registration = { active: true, pushManager: {
    getSubscription: async () => null,
    subscribe: async () => { subscriptions++; return subscription; },
  } };
  const device = load('../lib/push-device.ts', {}, {
    localStorage: { getItem: () => choice, setItem: (_key, value) => { choice = value; } },
    navigator: { serviceWorker: { getRegistration: async () => registration } },
    window: { PushManager: {}, Notification: {} },
    Notification: { get permission() { return permission; }, requestPermission() { throw new Error('Unexpected permission prompt'); } },
  });
  assert.equal(await device.reconcileDeviceSubscription('user', 'AQID'), null);
  device.rememberPushChoice('user', true);
  assert.equal(await device.reconcileDeviceSubscription('user', 'AQID'), subscription);
  assert.equal(subscriptions, 1);
  device.rememberPushChoice('user', false);
  assert.equal(await device.reconcileDeviceSubscription('user', 'AQID'), null);
  permission = 'denied'; device.rememberPushChoice('user', true);
  assert.equal(await device.reconcileDeviceSubscription('user', 'AQID'), null);
  assert.equal(subscriptions, 1);
});

test('account export requires auth and never caches personal JSON', async () => {
  let authenticated = false;
  const route = load('../app/api/account/export/route.ts', {
    '@/lib/auth/api-user': { authenticatedApiUser: async () => authenticated ? {
      client: { rpc: async (name) => { assert.equal(name, 'export_own_account_data'); return { data: { format_version: 1 }, error: null }; } },
    } : null },
  });
  const request = new Request('https://extrachef.invalid/api/account/export');
  assert.equal((await route.GET(request)).status, 401);
  authenticated = true;
  const response = await route.GET(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal((await response.json()).format_version, 1);
});

test('privacy migration enforces owner policies, hides identity documents and limits erasure RPC', () => {
  const sql = source('../supabase/migrations/20261015090000_privacy_account_rights.sql');
  assert.match(sql, /privacy_preferences AS RESTRICTIVE/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.anonymize_account\(uuid\) TO service_role/);
  assert.match(sql, /REVOKE SELECT \(city, score\)/);
  assert.match(sql, /UPDATE storage\.buckets SET public = false/);
  assert.match(sql, /accepted_at timestamptz NOT NULL DEFAULT now\(\)/);
  const visible = sql.slice(sql.indexOf('FUNCTION public.get_visible_profile'));
  assert.doesNotMatch(visible, /'cpf'|'rg'|'selfie_verification_path'|'resume_pdf_path'/);
});

test('VAPID checks reject mismatched server/browser keys and invalid pairs', () => {
  const first = createECDH('prime256v1'); first.generateKeys();
  const second = createECDH('prime256v1'); second.generateKeys();
  const config = load('../lib/push-config.ts', { 'node:crypto': { createECDH } }, { Buffer });
  const publicKey = first.getPublicKey().toString('base64url');
  const privateKey = first.getPrivateKey().toString('base64url');
  assert.equal(config.validateVapidPair(publicKey, privateKey, publicKey), true);
  assert.equal(config.validateVapidPair(publicKey, second.getPrivateKey().toString('base64url')), false);
  assert.equal(config.validateVapidPair(publicKey, privateKey, second.getPublicKey().toString('base64url')), false);
  assert.equal(config.validateVapidPair('', ''), false);
});

test('account deletion checks password and active work before touching Storage', async () => {
  let validPassword = false;
  let allowDeletion = false;
  const operations = [];
  const user = { id: 'worker', email: 'worker@example.invalid' };
  const admin = {
    storage: { from: (bucket) => ({
      list: async (prefix) => { operations.push(['list', bucket, prefix]); return { data: [{ id: 'file', name: 'photo.jpg' }], error: null }; },
      remove: async (paths) => { operations.push(['remove', bucket, ...paths]); return { error: null }; },
    }) },
    rpc: async (name, params) => { operations.push([name, params.p_user_id]); return { error: null }; },
    auth: { admin: {
      signOut: async () => ({ error: null }),
      deleteUser: async (id, soft) => { operations.push(['auth-delete', id, soft]); return { error: null }; },
    } },
  };
  const route = load('../app/api/account/delete/route.ts', {
    '@supabase/supabase-js': { createClient: () => ({ auth: {
      signInWithPassword: async () => ({ data: { user: validPassword ? user : null }, error: validPassword ? null : new Error('invalid') }),
      signOut: async (options) => { assert.equal(options.scope, 'local'); return { error: null }; },
    } }) },
    '@/lib/auth/api-user': { authenticatedApiUser: async () => ({ user, token: 'test-token', client: { rpc: async () => ({ error: allowDeletion ? null : new Error('active') }) } }) },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  });
  const request = () => new Request('https://extrachef.invalid/api/account/delete', { method: 'POST', body: JSON.stringify({ confirmation: 'EXCLUIR', password: 'fixture' }) });
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(operations.length, 0);
  validPassword = true;
  assert.equal((await route.POST(request())).status, 409);
  assert.equal(operations.length, 0);
  allowDeletion = true;
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(operations.filter(([name]) => name === 'remove').length, 2);
  assert.deepEqual(operations.at(-1), ['auth-delete', 'worker', true]);
});