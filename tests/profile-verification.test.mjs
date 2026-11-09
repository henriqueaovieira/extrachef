import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const verification = load('../lib/profile-verification.ts');
const { getProfileProgress } = load('../lib/ui/profile-progress.ts');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts'),
});
const Badge = load('../app/components/verified-profile-badge.tsx', { '@/app/components/ui': ui }).default;
const ProfileVerification = load('../app/components/profile-verification.tsx', {
  '@/lib/profile-verification': verification,
  '@/lib/supabase/client': { createClient: () => ({}) },
  '@/app/components/camera-capture': { default: () => null },
  '@/app/components/verified-profile-badge': { default: Badge },
  '@/app/components/ui': ui,
  'next/link': { default: ({ children, ...props }) => createElement('a', props, children) },
  'next/image': { default: () => null },
}).default;
const profile = {
  cpf: '52998224725', rg: 'RG', phone: '11999999999',
  selfie_verification_path: null, verification_status: 'pending',
};

test('official states depend on the existing status and selfie, not resume or certificates', () => {
  assert.equal(verification.getVerificationState(profile), 'not_started');
  assert.equal(verification.getVerificationState({ ...profile, verification_status: 'verified' }), 'not_started');
  assert.equal(verification.getVerificationState({ ...profile, selfie_verification_path: 'selfie' }), 'pending');
  assert.equal(verification.getVerificationState({ ...profile, selfie_verification_path: 'selfie', verification_status: 'verified' }), 'verified');
  assert.equal(verification.getVerificationState({ ...profile, selfie_verification_path: 'selfie', verification_status: 'rejected' }), 'rejected');
  assert.throws(() => verification.getVerificationState({ ...profile, selfie_verification_path: 'selfie', verification_status: 'invalid' }), /inválido/);
  assert.equal(verification.getVerificationRequirements(profile).every((item) => item.complete), true);
  for (const field of ['cpf', 'rg', 'phone']) {
    assert.equal(verification.getVerificationRequirements({ ...profile, [field]: ' ' }).every((item) => item.complete), false);
  }
  assert.equal(getProfileProgress('worker', 'Name', {
    city: 'City', phone: '11999999999', cpf: '52998224725', rg: 'RG', profile_photo_path: 'photo',
  }).percentage, 100);
});

test('verification screen renders all official states and permits requests only with saved prerequisites', () => {
  const render = (value) => renderToStaticMarkup(createElement(ProfileVerification, { profile: value, onSubmitted() {} }));
  const start = render(profile);
  assert.match(start, /Perfil não verificado/);
  assert.match(start, /Verificar Perfil/);
  assert.doesNotMatch(start, /disabled=""/);
  assert.match(render({ ...profile, rg: '' }), /disabled=""/);
  assert.match(render({ ...profile, selfie_verification_path: 'selfie' }), /Verificação em análise/);
  const approved = render({ ...profile, selfie_verification_path: 'selfie', verification_status: 'verified' });
  assert.match(approved, /aria-label="Perfil Verificado"/);
  assert.doesNotMatch(approved, /Verificar Perfil/);
  const rejected = render({ ...profile, selfie_verification_path: 'selfie', verification_status: 'rejected' });
  assert.match(rejected, /Revisão necessária/);
  assert.match(rejected, /Enviar nova selfie/);
  assert.doesNotMatch(rejected, /disabled=""/);
});

test('badge is icon-only with accessible description and mouse, touch and keyboard tooltip handlers', () => {
  const markup = renderToStaticMarkup(createElement(Badge));
  assert.match(markup, /<svg/);
  assert.match(markup, /type="button"/);
  assert.match(markup, /aria-label="Perfil Verificado"/);
  assert.match(markup, /aria-describedby=/);
  assert.match(markup, /A identidade deste profissional foi validada pelo ExtraChef\./);
  assert.doesNotMatch(markup, /<button[^>]*>[^<]*Perfil Verificado/);
  const badge = source('../app/components/verified-profile-badge.tsx');
  for (const event of ['onClick', 'onMouseEnter', 'onFocus', 'onBlur', 'Escape']) assert.ok(badge.includes(event));
  assert.match(badge, /createPortal/);
  assert.match(badge, /max-w-\[calc\(100vw-1rem\)\]/);
  assert.match(badge, /translateY\(min\(0px, calc\(100dvh/);
  assert.match(badge, /100% - 8px/);
});

test('badge consumes Escape only for an open tooltip and then permits native dialog cancellation', () => {
  const React = require('react');
  const state = [];
  let cursor = 0;
  const container = {};
  const InteractiveBadge = load('../app/components/verified-profile-badge.tsx', {
    react: {
      ...React,
      useId: () => 'verification-tooltip',
      useRef: () => ({ current: {
        getBoundingClientRect: () => ({ right: 200, bottom: 60 }),
        closest: () => container,
      } }),
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
      },
      useEffect() {},
    },
    'react-dom': { createPortal: node => node },
    '@/app/components/ui': ui,
  }).default;
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 375, innerHeight: 812 };
  const render = () => { cursor = 0; return InteractiveBadge(); };
  try {
    for (const trigger of ['onFocus', 'onMouseEnter', 'onClick']) {
      let button = render().props.children[0];
      button.props[trigger]({ preventDefault() {}, stopPropagation() {} });
      let tree = render();
      assert.ok(tree.props.children.at(-1), `${trigger}: tooltip opened`);
      let dialogOpen = true;
      const escape = () => {
        let prevented = false, stopped = false;
        button = render().props.children[0];
        button.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
        if (!prevented) dialogOpen = false;
        return { prevented, stopped };
      };
      assert.deepEqual(escape(), { prevented: true, stopped: true });
      tree = render();
      assert.equal(tree.props.children.at(-1), null);
      assert.equal(dialogOpen, true);
      assert.deepEqual(escape(), { prevented: false, stopped: false });
      assert.equal(dialogOpen, false);
    }
  } finally { globalThis.window = previousWindow; }
});

test('camera flow requires preview confirmation and never sends status from the frontend', () => {
  const screen = source('../app/components/profile-verification.tsx');
  assert.match(screen, /CameraCapture/);
  assert.match(screen, /Pré-visualização privada da selfie/);
  assert.match(screen, /Confirmar e enviar selfie/);
  assert.match(screen, /submit_own_profile_verification/);
  assert.match(screen, /allowFileFallback=\{false\}/);
  assert.doesNotMatch(screen, /\.update\(|\.upsert\(|review_profile_verification/);
  const editor = source('../app/components/profile-editor.tsx');
  assert.doesNotMatch(editor, /selfie_verification_path|verification_status/);
  assert.doesNotMatch(editor, /Currículo|Certificados/);
  assert.doesNotMatch(screen, /whatsapp|resume|curriculum|certificate|curr[ií]culo|certificado/i);
});

function mountBadgeProvider(t) {
  const React = require('react');
  const states = [], effects = [], timers = [], calls = [];
  let cursor = 0, effectCursor = 0, tree, interval;
  let response = { data: [], error: null };
  const client = {
    from(table) {
      return {
        select(columns) {
          return {
            async in(column, ids) {
              calls.push({ table, columns, column, ids });
              return response;
            },
          };
        },
      };
    },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  };
  t.mock.method(console, 'error', () => {});
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout(callback) { timers.push(callback); return timers.length; },
    setInterval(callback) { interval = callback; return 1; },
    clearTimeout() {},
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  };
  t.after(() => {
    for (const effect of effects) effect.cleanup?.();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const { ProfessionalVerificationProvider } = load('../app/components/professional-verification.tsx', {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
        }];
      },
      useCallback: (callback) => callback,
      useMemo: (callback) => callback(),
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: callback() };
        }
      },
    },
    'next/navigation': { usePathname: () => '/restaurant/candidates' },
    '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/ui': ui,
    '@/app/components/verified-profile-badge': { default: Badge },
  });
  function render() {
    cursor = 0;
    effectCursor = 0;
    tree = ProfessionalVerificationProvider({ children: 'Talentos preservados' });
  }
  render();
  tree.props.value.register('worker');
  render();
  return {
    calls,
    async refresh(next) {
      response = next;
      render();
      const callbacks = timers.splice(0);
      if (!callbacks.length) interval();
      for (const callback of callbacks) await callback();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    verified: () => tree.props.value.verified,
    html: () => renderToStaticMarkup(createElement('div', null, tree.props.children)),
  };
}

test('badge provider surfaces missing-column errors, clears stale badges and recovers when the column returns', async (t) => {
  const app = mountBadgeProvider(t);
  await app.refresh({ data: [{ id: 'worker', profile_verified: true }], error: null });
  assert.equal(app.verified().has('worker'), true);
  assert.deepEqual(app.calls[0], {
    table: 'public_user_directory', columns: 'id, profile_verified', column: 'id', ids: ['worker'],
  });
  const missing = { code: '42703', message: 'column public_user_directory.profile_verified does not exist' };
  await app.refresh({ data: null, error: missing });
  assert.equal(app.verified().size, 0);
  assert.match(app.html(), /Não foi possível atualizar os selos/);
  assert.match(app.html(), /Talentos preservados/);
  assert.deepEqual(console.error.mock.calls.at(-1).arguments, [
    'Falha ao carregar selos de perfil verificado:', missing.message,
  ]);
  await app.refresh({ data: [{ id: 'worker', profile_verified: true }], error: null });
  assert.equal(app.verified().has('worker'), true);
});

test('badge provider keeps all database failures visible', async (t) => {
  const app = mountBadgeProvider(t);
  for (const error of [
    { code: '42501', message: 'permission denied for view public_user_directory' },
    { code: '42703', message: 'column public_user_directory.id does not exist' },
    { code: '42P01', message: 'relation public_user_directory does not exist' },
    { code: '42703', message: 'column "profile_verified" does not exist' },
  ]) {
    await app.refresh({ data: null, error });
    assert.match(app.html(), /Não foi possível atualizar os selos/);
  }
  assert.equal(app.verified().size, 0);
});

function mountVerification(initialProfile, { uploadError = null, submissionError = null, removalError = null } = {}) {
  const React = require('react');
  const states = [], effects = [], calls = [];
  let cursor = 0, effectCursor = 0, dirty = true, tree, currentProfile = initialProfile;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'worker' } }, error: null }) },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'worker-private');
        return {
          async upload(path, file, options) {
            calls.push({ kind: 'upload', path, file, options });
            return { error: uploadError };
          },
          async remove(paths) {
            calls.push({ kind: 'remove', paths });
            return { error: removalError };
          },
        };
      },
    },
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      assert.equal(name, 'submit_own_profile_verification');
      assert.deepEqual(Object.keys(args), ['p_selfie_path']);
      return { error: submissionError };
    },
  };
  const camera = () => null;
  const Component = load('../app/components/profile-verification.tsx', {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
          dirty = true;
        }];
      },
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { callback, deps, pending: true };
        }
      },
    },
    '@/lib/profile-verification': verification,
    '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/camera-capture': { default: camera },
    '@/app/components/verified-profile-badge': { default: () => null },
    '@/app/components/ui': ui,
    'next/link': { default: 'a' },
    'next/image': { default: 'img' },
  }).default;
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
  }
  function render() {
    cursor = effectCursor = 0; dirty = false;
    tree = Component({
      profile: currentProfile,
      onSubmitted(path) {
        calls.push({ kind: 'submitted', path });
        currentProfile = { ...currentProfile, selfie_verification_path: path, verification_status: 'pending' };
        dirty = true;
      },
    });
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
  }
  render();
  return {
    calls,
    get profile() { return currentProfile; },
    find(predicate) { return elements(tree).find(predicate); },
    click(label) {
      const button = elements(tree).find((node) => node.type === ui.Button && node.props.children === label);
      assert.ok(button, label);
      button.props.onClick();
    },
    capture() {
      elements(tree).find((node) => node.type === camera).props.onCapture(
        new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'selfie.jpg', { type: 'image/jpeg' }),
      );
    },
    async flush() {
      for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise((resolve) => setImmediate(resolve)); }
      assert.equal(dirty, false);
    },
    dispose() { for (const effect of effects) effect.cleanup?.(); },
  };
}

test('capture is private until confirmation; confirmed submission enters pending and replaces a rejected selfie', async () => {
  for (const initial of [profile, { ...profile, selfie_verification_path: 'worker/selfie-old.jpg', verification_status: 'rejected' }]) {
    const app = mountVerification(initial);
    try {
      app.click(initial.selfie_verification_path ? 'Enviar nova selfie' : 'Verificar Perfil');
      await app.flush();
      app.capture();
      await app.flush();
      assert.ok(app.find((node) => node.props?.alt === 'Pré-visualização privada da selfie'));
      assert.equal(app.calls.length, 0);
      app.click('Confirmar e enviar selfie');
      await app.flush();
      assert.equal(app.calls[0].kind, 'upload');
      assert.match(app.calls[0].path, /^worker\/selfie-[\w-]+\.jpg$/);
      assert.equal(app.calls[0].options.upsert, false);
      assert.equal(app.profile.verification_status, 'pending');
      assert.equal(app.profile.selfie_verification_path, app.calls[0].path);
      assert.equal(app.calls.some((call) => call.kind === 'submitted'), true);
      assert.deepEqual(app.calls.filter((call) => call.kind === 'remove').flatMap((call) => call.paths),
        initial.selfie_verification_path ? [initial.selfie_verification_path] : []);
    } finally { app.dispose(); }
  }
});

test('failed submissions clean incomplete uploads, keep the previous state and report errors', async () => {
  const app = mountVerification(profile, { submissionError: { message: 'Solicitação bloqueada.' } });
  try {
    app.click('Verificar Perfil'); await app.flush();
    app.capture(); await app.flush();
    app.click('Confirmar e enviar selfie'); await app.flush();
    assert.equal(app.profile.selfie_verification_path, null);
    assert.equal(app.calls.some((call) => call.kind === 'submitted'), false);
    assert.equal(app.calls.filter((call) => call.kind === 'remove').length, 1);
    assert.ok(app.find((node) => node.type === ui.Toast && node.props.children === 'Solicitação bloqueada.'));
  } finally { app.dispose(); }
});

test('a cancelled preview never uploads; cleanup failure after successful resubmission is explicit', async () => {
  const cancelled = mountVerification(profile);
  try {
    cancelled.click('Verificar Perfil'); await cancelled.flush();
    cancelled.capture(); await cancelled.flush();
    cancelled.click('Cancelar'); await cancelled.flush();
    assert.equal(cancelled.calls.length, 0);
    assert.equal(cancelled.find((node) => node.props?.alt === 'Pré-visualização privada da selfie'), undefined);
  } finally { cancelled.dispose(); }
  const app = mountVerification({ ...profile, selfie_verification_path: 'worker/selfie-old.jpg', verification_status: 'rejected' },
    { removalError: { message: 'Storage indisponível.' } });
  try {
    app.click('Enviar nova selfie'); await app.flush();
    app.capture(); await app.flush();
    app.click('Confirmar e enviar selfie'); await app.flush();
    assert.equal(app.profile.verification_status, 'pending');
    assert.ok(app.find((node) => node.type === ui.Toast && node.props.children.includes('foto substituída')));
  } finally { app.dispose(); }
});
