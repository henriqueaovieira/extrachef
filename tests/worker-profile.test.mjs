import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

function load(file, dependencies) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}

const Link = ({ children, ...props }) => React.createElement('a', props, children);
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts', {}),
});

test('one worker profile composition selects the existing editor or overview without duplicate forms', () => {
  let query = new URLSearchParams();
  const Editor = () => null;
  const Overview = () => null;
  const Experience = load('../app/components/worker-profile-experience.tsx', {
    'next/navigation': { useSearchParams: () => query },
    '@/app/components/profile-editor': { default: Editor },
    '@/app/components/profile-overview': { default: Overview },
  }).default;
  for (const [search, expected] of [
    ['', Overview], ['edit=1', Editor], ['edit=0', Overview], ['from=menu', Overview],
  ]) {
    query = new URLSearchParams(search);
    const tree = Experience();
    assert.equal(tree.type, expected);
    assert.equal(tree.props.role, 'worker');
  }
  const page = read('../app/worker/profile/page.tsx');
  assert.match(page, /<Suspense/);
  assert.match(page, /<WorkerProfileExperience \/>/);
});

test('legacy navigation replaces history and preserves queries, anchors and edit intent on the same canonical route', () => {
  let effect;
  const destinations = [];
  const router = { replace: (href) => destinations.push(href) };
  const Redirect = load('../app/components/worker-profile-redirect.tsx', {
    react: { ...React, useEffect: (callback) => { effect = callback; } },
    'next/navigation': { useRouter: () => router },
    'next/link': { default: Link },
    '@/app/components/ui': ui,
  }).default;
  const oldWindow = globalThis.window;
  try {
    for (const [search, hash, edit, expected] of [
      ['', '', false, '/worker/profile'],
      ['?from=menu', '#verification', false, '/worker/profile?from=menu#verification'],
      ['?from=login', '#confidence', false, '/worker/profile?from=login#confidence'],
      ['', '', true, '/worker/profile?edit=1'],
      ['?from=old&edit=0', '#verification', true, '/worker/profile?from=old&edit=1#verification'],
      ['?edit=1', '', false, '/worker/profile?edit=1'],
    ]) {
      globalThis.window = { location: { search, hash } };
      const markup = renderToStaticMarkup(Redirect({ edit }));
      assert.match(markup, /Abrir meu perfil/);
      effect();
      assert.equal(destinations.at(-1), expected);
    }
  } finally { globalThis.window = oldWindow; }
  for (const [file, edit] of [
    ['../app/worker/profile/details/page.tsx', false],
    ['../app/worker/profile/edit/page.tsx', true],
  ]) {
    const Page = load(file, {
      '@/app/components/worker-profile-redirect': { default: Redirect },
    }).default;
    const tree = Page();
    assert.equal(tree.type, Redirect);
    assert.equal(Boolean(tree.props.edit), edit);
  }
});

function mount(file, dependencies, props = {}) {
  const states = [], effects = [], cleanups = [];
  let cursor = 0, effectCursor = 0, dirty = true, tree;
  const Component = load(file, {
    ...dependencies,
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
        const previous = effects[index];
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
          effects[index] = { callback, deps, pending: true };
        }
      },
    },
  }).default;
  return {
    async flush() {
      for (let iteration = 0; iteration < 10; iteration++) {
        if (dirty) {
          dirty = false;
          cursor = effectCursor = 0;
          tree = Component(props);
          for (const [index, effect] of effects.entries()) {
            if (!effect.pending) continue;
            effect.pending = false;
            cleanups[index]?.();
            cleanups[index] = effect.callback();
          }
        }
        await new Promise((resolve) => setImmediate(resolve));
        if (!dirty) return tree;
      }
      assert.fail('Profile did not settle');
    },
    markup: () => renderToStaticMarkup(tree),
    cleanup: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

const progress = load('../lib/ui/profile-progress.ts', {});
const verification = load('../lib/profile-verification.ts', {});
const reputation = {
  score: 85, classification: 'Confiável', completed: 8, rehires: 2,
  checkins: 9, checkouts: 8, early: 1, on_time: 8, late: 1, absences: 1,
  cancellations_90d: 0, abandonments_180d: 0, punctuality: 90, average_rating: 4.5,
};
const { ReputationDetails } = load('../app/components/operational-reputation.tsx', {
  '@/app/components/ui': ui,
  '@/lib/supabase/client': { createClient: () => ({}) },
});
const profile = {
  cpf: '52998224725', rg: 'RG123', date_of_birth: '1990-01-01', phone: '11999999999',
  address: 'Rua Teste', city: 'Campinas', state: 'SP', postal_code: '01000000',
  experience: 'Cozinha', specialties: ['Cozinheiro'], profile_photo_path: null,
  selfie_verification_path: 'worker/selfie.jpg', verification_status: 'verified',
  whatsapp: 'legacy-contact', resume_pdf_path: 'legacy-resume', certificates: ['legacy-certificate'],
};

function clientFor(role, { missing = false, error = null } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } }, error: null }) },
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        single: async () => ({ data: { id: 'user', name: 'Nome Teste', city: 'Campinas', role }, error: null }),
        maybeSingle: async () => ({ data: table === 'worker_profiles' && !missing ? profile : null, error }),
      };
    },
  };
}

test('canonical overview keeps identity, verification, operational reputation and all former account shortcuts', async () => {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const scrolled = [];
  globalThis.window = {
    location: { hash: '#confidence' },
    setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  };
  globalThis.document = { getElementById: (id) => ({ scrollIntoView: () => scrolled.push(id) }) };
  const shortcuts = load('../app/components/more-navigation.tsx', {
    'next/link': { default: Link },
    '@/app/components/mobile-bottom-nav': { default: () => null },
    '@/app/components/logout-button': { default: () => null },
    '@/app/components/dashboard-identity': { DashboardLogo: () => null },
  });
  const dependencies = (client) => ({
    '@/app/components/ui': ui,
    'next/link': { default: Link },
    'next/image': { default: () => null },
    '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/mobile-bottom-nav': { default: () => null },
    '@/app/components/push-notification-control': { default: () => null },
    '@/app/components/logout-button': { default: () => React.createElement('button', null, 'Sair') },
    '@/app/components/profile-progress': { default: () => null },
    '@/lib/ui/profile-progress': progress,
    '@/app/components/operational-reputation': {
      default: () => React.createElement(ReputationDetails, { reputation }),
    },
    '@/app/components/dashboard-identity': { DashboardLogo: () => null },
    '@/app/components/profile-verification': {
      default: ({ profile: value }) => React.createElement('section', { id: 'verification' },
        `Perfil Verificado: ${verification.getVerificationState(value)}`),
    },
    '@/app/components/verified-profile-badge': { default: () => React.createElement('span', null, 'Selo de identidade') },
    '@/lib/profile-verification': verification,
    '@/app/components/more-navigation': shortcuts,
  });
  try {
    for (const options of [{}, { missing: true }, { error: { message: 'Falha ao consultar perfil' } }]) {
      const screen = mount('../app/components/profile-overview.tsx', dependencies(clientFor('worker', options)), { role: 'worker' });
      try {
        await screen.flush();
        const markup = screen.markup();
        for (const destination of ['/worker/dashboard#historico', '/notifications', '/settings/privacy']) {
          assert.ok(markup.includes(`href="${destination}"`), destination);
        }
        assert.match(markup, /Sair/);
        if (options.error) assert.match(markup, /Falha ao consultar perfil/);
        else if (options.missing) {
          assert.match(markup, /Completar perfil/);
          assert.match(markup, /href="\/worker\/profile\?edit=1"/);
        } else {
          for (const label of ['CPF', 'RG', 'Nascimento', 'Telefone', 'Endereço', 'Especialidades',
            'Perfil Verificado', 'Confiança operacional', 'Trabalhos concluídos', 'Avaliação média', 'Pontualidade', 'Presença (check-ins)']) {
            assert.ok(markup.includes(label), label);
          }
          assert.match(markup, /href="\/worker\/profile\?edit=1"/);
          assert.match(markup, /id="verification"/);
          assert.match(markup, /id="confidence"/);
          assert.ok(scrolled.includes('confidence'));
          assert.doesNotMatch(markup, /legacy-|WhatsApp|Currículo|Certificados/);
        }
      } finally { screen.cleanup(); }
    }
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test('generic profile redirects only workers and preserves the current restaurant experience', async () => {
  const Redirect = () => React.createElement('p', null, 'Canonical worker profile');
  for (const role of ['worker', 'restaurant']) {
    const screen = mount('../app/profile/page.tsx', {
      '@/app/components/ui': ui,
      'next/link': { default: Link },
      '@/lib/supabase/client': { createClient: () => clientFor(role) },
      '@/app/components/mobile-bottom-nav': { default: () => null },
      '@/app/components/logout-button': { default: () => React.createElement('button', null, 'Sair') },
      '@/app/components/operational-reputation': { default: () => null },
      '@/app/components/dashboard-identity': { DashboardLogo: () => null },
      '@/app/components/professional-verification': { default: () => null },
      '@/app/components/worker-profile-redirect': { default: Redirect },
    });
    try {
      const tree = await screen.flush();
      if (role === 'worker') assert.equal(tree.type, Redirect);
      else {
        assert.notEqual(tree.type, Redirect);
        assert.match(screen.markup(), /Nome Teste/);
        assert.match(screen.markup(), /Restaurante/);
        assert.match(screen.markup(), /Sair/);
      }
    } finally { screen.cleanup(); }
  }
});

test('application links no longer produce legacy worker profile paths', () => {
  for (const file of readdirSync(new URL('../app/', import.meta.url), { recursive: true })) {
    if (!/\.tsx?$/.test(file)) continue;
    const content = read(`../app/${file.replaceAll('\\', '/')}`);
    assert.doesNotMatch(content, /['"`]\/worker\/profile\/(?:details|edit)(?:[?#'"`/]|$)/, file);
  }
  const editor = read('../app/components/profile-editor.tsx');
  assert.match(editor, /role === 'worker' \? '\/worker\/profile' : '\/restaurant\/profile'/);
  assert.match(editor, /href="\/worker\/profile#verification"/);
});
