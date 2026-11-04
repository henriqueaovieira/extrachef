import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts'),
});
const components = load('../app/components/settings-components.tsx', {
  '@/app/components/ui': ui,
  '@/app/components/dashboard-identity': { DashboardLogo: () => null },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
});
const verification = load('../lib/profile-verification.ts');
const AccountRights = load('../app/components/account-rights.tsx', {
  '@/app/components/ui': ui,
  '@/app/components/settings-components': components,
  '@/lib/supabase/client': { createClient: () => ({}) },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
}).default;

test('account cards remove legal acceptance, retain export and require explicit deletion confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(AccountRights, { embedded: true }));
  assert.match(html, /Seus dados/);
  assert.match(html, /Solicite uma cópia dos dados vinculados à sua conta\./);
  assert.match(html, />Exportar dados<\/button>/);
  assert.match(html, /Zona de Perigo/);
  assert.match(html, /A exclusão da conta é permanente e não poderá ser desfeita\./);
  assert.match(html, /Alguns registros poderão ser mantidos conforme exigências legais\./);
  assert.match(html, /<summary[^>]*>Excluir minha conta<\/summary>/);
  assert.match(html, /Digite EXCLUIR/);
  assert.match(html, /autoComplete="current-password"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Excluir minha conta definitivamente<\/button>/);
  assert.doesNotMatch(html, /Li e aceito|Registrar aceite|Baixar meus dados|type="checkbox"/);
  assert.doesNotMatch(source('../app/components/account-rights.tsx'), /accept_current_legal_documents|recordAcceptance/);
});

const notifications = {
  messages_enabled: false, applications_enabled: true, reviews_enabled: true, operations_enabled: true, events_enabled: false,
};
const privacy = {
  show_city: true, show_score: true, show_reviews: true, show_experience: true,
  show_phone: false, show_address: true, show_photos: true,
};

function mount(t, role, { loadError = false, writeError = false, rejectWrite = false, authenticated = true } = {}) {
  const states = [], writes = [], events = [], effects = [];
  let cursor = 0, tree;
  const previousWindow = globalThis.window;
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  t.mock.method(console, 'error', () => {});
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'owner' } : null }, error: null }) },
    from(table) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async single() { return { data: { role }, error: null }; },
        async maybeSingle() {
          if (table === 'worker_profiles') return { data: { cpf: 'cpf', rg: 'rg', phone: 'phone', verification_status: 'verified', selfie_verification_path: 'selfie' }, error: null };
          return {
            data: table === 'privacy_preferences' ? privacy : notifications,
            error: loadError ? { message: 'permission denied' } : null,
          };
        },
        async upsert(payload, options) {
          writes.push({ table, payload, options });
          if (rejectWrite) throw new Error('network unavailable');
          return { error: writeError ? { message: 'write failed' } : null };
        },
      };
      return builder;
    },
  };
  const Screen = load('../app/components/privacy-settings.tsx', {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect(callback) { if (!effects.length) effects.push(callback); },
    },
    '@/app/components/ui': ui,
    '@/app/components/settings-components': components,
    '@/lib/profile-verification': verification,
    '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/mobile-bottom-nav': { default: () => null },
    '@/app/components/account-rights': { default: () => React.createElement('div', null, 'Direitos da conta preservados') },
  }).default;
  const render = () => { cursor = 0; tree = Screen(); };
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((item) => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  render();
  const loaded = effects[0]();
  t.after(() => loaded?.());
  return {
    writes, events,
    async ready() { await new Promise((resolve) => setImmediate(resolve)); render(); },
    switch(label) { return nodes(tree).find((node) => node.type === components.PreferenceSwitch && node.props.label === label); },
    bar() { return nodes(tree).find((node) => node.type === components.SavePreferencesBar); },
    async save() { this.bar().props.onSave(); await new Promise((resolve) => setImmediate(resolve)); render(); },
    change(label, value) { this.switch(label).props.onChange(value); render(); },
    html: () => renderToStaticMarkup(tree),
    render,
  };
}

for (const role of ['worker', 'restaurant']) {
  test(`${role}: real preferences load, persist and preserve hidden values`, async (t) => {
    const app = mount(t, role);
    await app.ready();
    assert.equal(app.bar().props.disabled, false);
    assert.equal(app.switch('Mensagens').props.checked, false);
    const html = app.html();
    const headings = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]);
    assert.deepEqual(headings, ['Notificações', 'Privacidade do Perfil', 'Centro de Talentos', 'Perfil Verificado', 'Conta e Segurança']);
    assert.doesNotMatch(html, /Permissões deste dispositivo|Notificações do navegador|Sessões ativas/);
    app.change('Mensagens', true);
    await app.save();
    assert.equal(app.writes.length, 2);
    assert.deepEqual(app.writes[0].options, { onConflict: 'user_id' });
    assert.deepEqual(app.writes[0].payload, {
      user_id: 'owner', ...notifications, messages_enabled: true, updated_at: app.writes[0].payload.updated_at,
    });
    assert.deepEqual(app.writes[1].payload, {
      user_id: 'owner', ...privacy, updated_at: app.writes[1].payload.updated_at,
    });
    assert.match(app.html(), /Preferências atualizadas com sucesso/);
    assert.equal(app.events[0].type, 'extrachef:preferences-updated');
    app.change('Mensagens', false);
    assert.doesNotMatch(app.html(), /Preferências atualizadas com sucesso/);
  });
}

test('failed load never allows overwriting preferences with defaults', async (t) => {
  const app = mount(t, 'worker', { loadError: true });
  await app.ready();
  assert.equal(app.bar().props.disabled, true);
  await app.save();
  assert.equal(app.writes.length, 0);
  assert.match(app.html(), /Não foi possível carregar suas preferências/);
});

test('unauthenticated settings cannot save or expose account controls', async (t) => {
  const app = mount(t, 'worker', { authenticated: false });
  await app.ready();
  await app.save();
  assert.equal(app.writes.length, 0);
  assert.equal(app.bar().props.disabled, true);
  assert.match(app.html(), /Entre na sua conta/);
  assert.doesNotMatch(app.html(), /Direitos da conta preservados/);
});

for (const failure of [{ writeError: true }, { rejectWrite: true }]) {
  test(`save failure is visible, clears busy state and emits no success (${JSON.stringify(failure)})`, async (t) => {
    const app = mount(t, 'restaurant', failure);
    await app.ready();
    await app.save();
    assert.equal(app.bar().props.saving, false);
    assert.equal(app.events.length, 0);
    assert.match(app.html(), /role="alert"/);
    assert.doesNotMatch(app.html(), /Preferências atualizadas com sucesso/);
  });
}

test('verification is status-only, preserves pending review and never invents restaurant verification', () => {
  const render = (role, status) => renderToStaticMarkup(React.createElement(components.VerificationCard, { role, status }));
  assert.match(render('worker', 'verified'), /Sua identidade foi validada por selfie/);
  assert.match(render('worker', 'pending'), /Verificação em análise/);
  assert.doesNotMatch(render('worker', 'pending'), /Verificar agora/);
  assert.match(render('worker', 'not_started'), /Verificar agora/);
  assert.match(render('worker', 'rejected'), /Envie uma nova selfie/);
  assert.match(render('worker', 'unavailable'), /Status indisponível/);
  assert.match(render('restaurant', 'verified'), /ainda não está disponível/);
  assert.doesNotMatch(render('restaurant', 'verified'), /identidade.*foi validada/);
});

test('talent sections provide real destinations, never fake switches', () => {
  for (const role of ['restaurant', 'worker']) {
    const html = renderToStaticMarkup(React.createElement(components.TalentSection, { role }));
    assert.doesNotMatch(html, /type="checkbox"|role="switch"/);
    assert.match(html, role === 'worker' ? /href="\/worker\/invitations"/ : /href="\/restaurant\/candidates"/);
  }
});
