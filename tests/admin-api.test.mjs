import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const nextServer = require('next/server');
const { NextRequest } = nextServer;

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

const state = {
  user: { id: '00000000-0000-4000-8000-000000000001' },
  authError: null,
  membership: { role: 'admin', status: 'active' },
  membershipError: null,
  rpcResults: {},
  calls: [],
};
const requestClient = {
  createRequestClient: () => ({
    supabase: {
      auth: { getUser: async () => ({ data: { user: state.user }, error: state.authError }) },
      rpc: async (name, args) => {
        state.calls.push([name, args]);
        if (name === 'get_staff_membership') return { data: state.membership, error: state.membershipError };
        return state.rpcResults[name] ?? { data: null, error: null };
      },
    },
    finish: (response) => response,
  }),
};

const staffAccess = loadTs('../lib/auth/staff-access.ts');
const staffApi = loadTs('../lib/auth/staff-api.ts', {
  'server-only': {},
  'next/server': { ...nextServer, connection: async () => {} },
  '@/lib/auth/staff-access': staffAccess,
  '@/lib/supabase/request': requestClient,
});
const routes = {
  ...loadTs('../app/api/admin/staff/route.ts', { '@/lib/auth/staff-api': staffApi }),
};
const revokeRoute = loadTs('../app/api/admin/staff/[id]/revoke/route.ts', {
  '@/lib/auth/staff-api': staffApi,
});
const url = 'https://app.test/api/admin/staff';
const jsonRequest = (target, method = 'POST', body = {}, headers = {}) => new NextRequest(target, {
  method,
  headers: { origin: new URL(target).origin, 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const json = (response) => response.json();

test.beforeEach(() => {
  state.user = { id: '00000000-0000-4000-8000-000000000001' };
  state.authError = null;
  state.membership = { role: 'admin', status: 'active' };
  state.membershipError = null;
  state.rpcResults = {};
  state.calls = [];
});

test('staff API requires authentication and active authorized membership', async () => {
  state.user = null;
  assert.equal((await routes.GET(new NextRequest(url))).status, 401);

  state.user = { id: 'worker-id' };
  state.membership = null;
  assert.equal((await routes.GET(new NextRequest(url))).status, 403);

  state.membership = { role: 'reviewer', status: 'active' };
  assert.equal((await routes.GET(new NextRequest(url))).status, 403);
});

test('staff self endpoint returns only the current membership', async () => {
  const { GET } = loadTs('../app/api/admin/staff/me/route.ts', { '@/lib/auth/staff-api': staffApi });
  const response = await GET(new NextRequest('https://app.test/api/admin/staff/me'));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { role: 'admin', status: 'active' });
});

test('staff authorization waits for a request before initializing Supabase', async () => {
  let acceptRequest;
  const pendingRequest = new Promise((resolve) => { acceptRequest = resolve; });
  let clientCreated = false;
  const { authorizeStaffApi } = loadTs('../lib/auth/staff-api.ts', {
    'server-only': {},
    'next/server': { ...nextServer, connection: () => pendingRequest },
    '@/lib/auth/staff-access': staffAccess,
    '@/lib/supabase/request': {
      createRequestClient: () => {
        clientCreated = true;
        return requestClient.createRequestClient();
      },
    },
  });

  const authorization = authorizeStaffApi(new NextRequest(url));
  assert.equal(clientCreated, false);
  acceptRequest();
  const context = await authorization;
  assert.equal(clientCreated, true);
  assert.equal(context.ok, true);
});

test('admin can list members through bounded pagination RPC', async () => {
  state.rpcResults.list_staff_members = { data: [{ user_id: 'target', staff_role: 'reviewer' }], error: null };
  const response = await routes.GET(new NextRequest(`${url}?limit=500&offset=-2`));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { staff: [{ user_id: 'target', staff_role: 'reviewer' }] });
  assert.deepEqual(state.calls.at(-1), ['list_staff_members', { p_limit: 100, p_offset: 0 }]);
});

test('staff grant validates origin, target, role and reason before invoking the RPC', async () => {
  const foreignOrigin = await routes.POST(jsonRequest(url, 'POST', {
    user_id: '00000000-0000-4000-8000-000000000002',
    staff_role: 'reviewer',
    reason: 'Approved onboarding',
  }, { origin: 'https://attacker.test' }));
  assert.equal(foreignOrigin.status, 403);
  assert.equal(state.calls.length, 1);

  const invalid = await routes.POST(jsonRequest(url, 'POST', {
    user_id: 'not-a-uuid', staff_role: 'owner', reason: '',
  }));
  assert.equal(invalid.status, 400);

  state.rpcResults.grant_staff_role = { data: { role: 'reviewer', status: 'active' }, error: null };
  const granted = await routes.POST(jsonRequest(url, 'POST', {
    user_id: '00000000-0000-4000-8000-000000000002',
    staff_role: 'reviewer',
    reason: 'Approved onboarding',
  }));
  assert.equal(granted.status, 200);
  assert.deepEqual(state.calls.at(-1), ['grant_staff_role', {
    p_user_id: '00000000-0000-4000-8000-000000000002',
    p_staff_role: 'reviewer',
    p_reason: 'Approved onboarding',
  }]);
});

test('revocation route validates membership, UUID, origin and reason', async () => {
  state.rpcResults.revoke_staff_role = { data: { role: 'reviewer', status: 'revoked' }, error: null };
  const target = 'https://app.test/api/admin/staff/00000000-0000-4000-8000-000000000002/revoke';
  const response = await revokeRoute.POST(
    jsonRequest(target, 'POST', { reason: 'Role no longer required' }),
    { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000002' }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.at(-1), ['revoke_staff_role', {
    p_user_id: '00000000-0000-4000-8000-000000000002',
    p_reason: 'Role no longer required',
  }]);

  state.membership = { role: 'support', status: 'active' };
  const denied = await routes.POST(jsonRequest(url, 'POST', {
    user_id: '00000000-0000-4000-8000-000000000002',
    staff_role: 'reviewer',
    reason: 'Denied role change',
  }));
  assert.equal(denied.status, 403);
});
