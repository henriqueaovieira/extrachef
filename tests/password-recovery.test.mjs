import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadTs(file) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(require, exports);
  return exports;
}
const recovery = loadTs('../lib/auth/password-recovery.ts');
const routes = loadTs('../lib/auth/routes.ts');

test('recovery e-mail links back through the existing callback to the reset page for both roles', () => {
  const url = new URL(recovery.recoveryRedirectUrl('https://app.extrachef.test'));
  assert.equal(url.origin, 'https://app.extrachef.test');
  assert.equal(url.pathname, '/auth/callback');
  assert.equal(url.searchParams.get('redirect'), '/settings/password');
  assert.equal(url.searchParams.get('flow'), 'recovery');
  for (const role of ['restaurant', 'worker']) {
    assert.equal(routes.sanitizeRedirect(url.searchParams.get('redirect'), role), '/settings/password');
  }
  assert.equal(routes.isProtectedPath('/settings/password'), true);
});

test('requesting recovery sends the e-mail via Supabase with a generic confirmation', async () => {
  const calls = [];
  const auth = { resetPasswordForEmail: async (...args) => { calls.push(args); return { data: {}, error: null }; } };
  const message = await recovery.requestPasswordRecovery(auth, '  ana@extrachef.test ', 'https://app.extrachef.test');
  assert.equal(message, recovery.RECOVERY_SENT_MESSAGE);
  assert.equal(calls[0][0], 'ana@extrachef.test');
  assert.equal(calls[0][1].redirectTo, 'https://app.extrachef.test/auth/callback?redirect=%2Fsettings%2Fpassword&flow=recovery');

  await assert.rejects(recovery.requestPasswordRecovery(auth, '   ', 'https://x.test'), /Informe o e-mail/);
  const failing = { resetPasswordForEmail: async () => ({ data: null, error: { message: 'Muitas tentativas' } }) };
  await assert.rejects(recovery.requestPasswordRecovery(failing, 'a@b.c', 'https://x.test'), /Muitas tentativas/);
});

test('new password is validated, saved, the recovery session ends and the user returns to login', async () => {
  assert.match(recovery.validateNewPassword('123', '123'), /pelo menos 6/);
  assert.match(recovery.validateNewPassword('123456', '1234567'), /não coincidem/);
  assert.equal(recovery.validateNewPassword('123456', '123456'), '');

  const calls = [];
  const auth = {
    updateUser: async (attrs) => { calls.push(['updateUser', attrs]); return { data: {}, error: null }; },
    signOut: async () => { calls.push(['signOut']); return { error: null }; },
  };
  await assert.rejects(recovery.updatePasswordAndSignOut(auth, 'abc', 'abc'), /pelo menos 6/);
  assert.equal(calls.length, 0);
  const next = await recovery.updatePasswordAndSignOut(auth, 'novaSenha1', 'novaSenha1');
  assert.deepEqual(calls, [['updateUser', { password: 'novaSenha1' }], ['signOut']]);
  assert.equal(next, '/login?reason=password_updated');
  assert.equal(routes.authMessages[new URL(next, 'https://x.test').searchParams.get('reason')], 'Senha redefinida. Entre com sua nova senha.');

  const failing = { updateUser: async () => ({ data: null, error: { message: 'Link expirado' } }), signOut: async () => ({ error: null }) };
  await assert.rejects(recovery.updatePasswordAndSignOut(failing, 'novaSenha1', 'novaSenha1'), /Link expirado/);
});

test('login keeps its form and adds a discreet recovery entry point', () => {
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.ok(login.includes('Esqueceu sua senha?'));
  assert.ok(login.includes('signInWithPassword'));
  assert.ok(login.includes('requestPasswordRecovery'));
  assert.ok(login.includes('← Voltar ao login'));
  assert.ok(login.indexOf('field-login-page-tsx-2') < login.indexOf('Esqueceu sua senha?'));
});
test('callback failures distinguish signup from recovery and expired from invalid links', () => {
  const flow = (query) => recovery.authCallbackFlow(new URLSearchParams(query));
  assert.equal(flow('redirect=%2Frestaurant%2Fdashboard'), 'signup');
  assert.equal(flow(''), 'signup');
  assert.equal(flow('flow=recovery'), 'recovery');
  assert.equal(flow('redirect=%2Fsettings%2Fpassword'), 'recovery');

  const reason = recovery.authCallbackFailureReason;
  assert.equal(reason('signup', 'otp_expired'), 'confirmation_expired');
  assert.equal(reason('signup', 'flow_state_expired'), 'confirmation_expired');
  assert.equal(reason('signup', 'access_denied', 'Email link is invalid or has expired'), 'confirmation_expired');
  assert.equal(reason('signup'), 'confirmation_invalid');
  assert.equal(reason('signup', 'flow_state_not_found'), 'confirmation_invalid');
  assert.equal(reason('recovery', 'otp_expired'), 'recovery_expired');
  assert.equal(reason('recovery', 'bad_code_verifier'), 'recovery_invalid');
  assert.equal(reason('recovery'), 'recovery_invalid');

  for (const key of ['confirmation_expired', 'confirmation_invalid', 'confirmation_failed']) {
    assert.match(routes.authMessages[key], /cadastro/, key);
    assert.doesNotMatch(routes.authMessages[key], /senha/, key);
  }
  for (const key of ['recovery_expired', 'recovery_invalid', 'recovery_failed']) {
    assert.match(routes.authMessages[key], /recuperação de senha/, key);
    assert.doesNotMatch(routes.authMessages[key], /cadastro|confirma/, key);
  }
  assert.match(routes.authMessages.confirmation_expired, /expirou/);
  assert.match(routes.authMessages.recovery_expired, /expirou/);
  assert.match(routes.authMessages.confirmation_invalid, /inválido/);
  assert.match(routes.authMessages.recovery_invalid, /inválido/);
  assert.equal(recovery.isRecoveryReason('recovery_expired'), true);
  assert.equal(recovery.isRecoveryReason('confirmation_expired'), false);
  assert.equal(recovery.isRecoveryReason(null), false);
});

function loadCallback({ exchange, role = 'restaurant' }) {
  const { outputText } = ts.transpileModule(readFileSync(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exchanged = [];
  const deps = {
    'next/server': { NextResponse: { redirect: (url) => ({ location: new URL(url) }) } },
    '@/lib/supabase/request': {
      createRequestClient: () => ({
        supabase: { auth: { exchangeCodeForSession: async (code) => { exchanged.push(code); return exchange(code); } } },
        finish: (response) => response,
      }),
    },
    '@/lib/auth/account': { getAccountRole: async () => role },
    '@/lib/auth/routes': routes,
    '@/lib/auth/password-recovery': recovery,
  };
  const exports = {};
  new Function('require', 'exports', outputText)((name) => deps[name] ?? require(name), exports);
  return { GET: (path) => exports.GET({ url: `https://app.test${path}`, nextUrl: new URL(`https://app.test${path}`) }), exchanged };
}

test('callback routes each outcome to the right page and message', async () => {
  const errors = console.error;
  console.error = () => {};
  try {
    const ok = loadCallback({ exchange: async () => ({ data: { user: { id: 'u' } }, error: null }) });
    let res = await ok.GET('/auth/callback?code=abc&redirect=%2Frestaurant%2Fdemands');
    assert.equal(res.location.pathname, '/restaurant/demands');
    res = await ok.GET(`/auth/callback?code=abc&${new URL(recovery.recoveryRedirectUrl('https://app.test')).searchParams}`);
    assert.equal(`${res.location.pathname}${res.location.search}`, '/settings/password');

    const recoveryQuery = 'redirect=%2Fsettings%2Fpassword&flow=recovery';
    const cases = [
      ['/auth/callback?redirect=%2Fchat%2F123', 'confirmation_invalid', '/chat/123'],
      ['/auth/callback?redirect=%2Fchat%2F123&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', 'confirmation_expired', '/chat/123'],
      [`/auth/callback?${recoveryQuery}`, 'recovery_invalid', null],
      [`/auth/callback?${recoveryQuery}&error=access_denied&error_code=otp_expired`, 'recovery_expired', null],
    ];
    for (const [path, reason, redirect] of cases) {
      const r = await ok.GET(path);
      assert.equal(r.location.pathname, '/login', path);
      assert.equal(r.location.searchParams.get('reason'), reason, path);
      assert.equal(r.location.searchParams.get('redirect'), redirect, path);
    }
    assert.deepEqual(ok.exchanged, ['abc', 'abc']);

    const used = loadCallback({ exchange: async () => ({ data: {}, error: { code: 'flow_state_not_found', message: 'invalid flow state' } }) });
    assert.equal((await used.GET(`/auth/callback?code=x&${recoveryQuery}`)).location.searchParams.get('reason'), 'recovery_invalid');
    assert.equal((await used.GET('/auth/callback?code=x')).location.searchParams.get('reason'), 'confirmation_invalid');
    const expired = loadCallback({ exchange: async () => ({ data: {}, error: { code: 'flow_state_expired', message: 'expired' } }) });
    assert.equal((await expired.GET(`/auth/callback?code=x&${recoveryQuery}`)).location.searchParams.get('reason'), 'recovery_expired');
    assert.equal((await expired.GET('/auth/callback?code=x')).location.searchParams.get('reason'), 'confirmation_expired');
    const broken = loadCallback({ exchange: async () => { throw new Error('network'); } });
    assert.equal((await broken.GET(`/auth/callback?code=x&${recoveryQuery}`)).location.searchParams.get('reason'), 'recovery_failed');
    assert.equal((await broken.GET('/auth/callback?code=x')).location.searchParams.get('reason'), 'confirmation_failed');
  } finally {
    console.error = errors;
  }
});