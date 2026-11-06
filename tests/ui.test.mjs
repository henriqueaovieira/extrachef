import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadTs(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const { formatInput } = loadTs('../lib/ui/input-masks.ts');
const { getProfileProgress } = loadTs('../lib/ui/profile-progress.ts');
const ui = loadTs('../app/components/ui/index.tsx', { '@/lib/ui/input-masks': { formatInput } });
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('password control starts hidden, preserves autocomplete and never submits the form', () => {
  const markup = renderToStaticMarkup(createElement(ui.PasswordInput, {
    id: 'password', autoComplete: 'current-password', required: true, value: 'example', onChange() {},
  }));
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="current-password"/);
  assert.match(markup, /aria-controls="password"/);
  assert.match(markup, /aria-label="Mostrar senha"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /type="button"/);
});

test('busy buttons keep their action label and expose disabled and busy states', () => {
  const markup = renderToStaticMarkup(createElement(ui.Button, {
    type: 'submit', busy: true,
  }, 'Salvando evento'));
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /type="submit"/);
  assert.match(markup, /Salvando evento/);
});

test('Toast supports EVC tones and preserves the legacy error contract', () => {
  for (const tone of ['success', 'info', 'warning', 'danger', 'error']) {
    const html = renderToStaticMarkup(createElement(ui.Toast, { tone }, 'Mensagem de teste'));
    assert.match(html, new RegExp(`ec-toast--${tone}`));
    assert.match(html, new RegExp(`role="${['danger', 'error'].includes(tone) ? 'alert' : 'status'}"`));
    assert.match(html, /aria-atomic="true"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /Mensagem de teste/);
  }
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.ec-toast--error,\s*\.ec-toast--danger\s*\{/);
  assert.match(css, /\.ec-toast--warning\s*\{[^}]*var\(--ec-warning-bg\)[^}]*var\(--ec-warning-text\)/);
  const dangerStyle = css.match(/\.ec-toast--danger\s*\{([^}]+)\}/)[1];
  const dangerBackground = dangerStyle.match(/background:\s*(#[a-f\d]{6})/i)[1];
  const dangerText = dangerStyle.match(/;\s*color:\s*(#[a-f\d]{6})/i)[1];
  assert.ok(contrast(dangerText, dangerBackground) >= 4.5);
});

test('date and number controls preserve native types, constraints and payload values', () => {
  const date = renderToStaticMarkup(createElement(ui.TextInput, {
    type: 'date', value: '2026-12-20', min: '2026-10-15', required: true, onChange() {},
  }));
  assert.match(date, /type="date"/);
  assert.match(date, /value="2026-12-20"/);
  assert.match(date, /min="2026-10-15"/);
  const number = renderToStaticMarkup(createElement(ui.TextInput, {
    type: 'number', min: 1, max: 100000, step: 1, value: 30, onChange() {},
  }));
  assert.match(number, /type="number"/);
  assert.match(number, /min="1"/);
  assert.match(number, /max="100000"/);
  assert.match(number, /step="1"/);
});

test('masks support empty, partial, pasted and already formatted input', () => {
  const examples = [
    ['cpf', '12345678901', '123.456.789-01'],
    ['cpf', '1234', '123.4'],
    ['cnpj', '12345678000190', '12.345.678/0001-90'],
    ['cnpj', '123456789', '12.345.678/9'],
    ['postal-code', '01310930', '01310-930'],
    ['phone', '1134567890', '(11) 3456-7890'],
    ['phone', '11987654321', '(11) 98765-4321'],
    ['phone', '+55 (11) 98765-4321', '+55 (11) 98765-4321'],
  ];
  for (const [mask, input, expected] of examples) {
    assert.equal(formatInput(input, mask), expected, `${mask}: ${input}`);
    assert.equal(formatInput(expected, mask), expected, `idempotent ${mask}`);
  }
  for (const mask of ['cpf', 'cnpj', 'phone', 'postal-code']) {
    assert.equal(formatInput('', mask), '');
    assert.equal(formatInput('letters', mask), '');
  }
});

test('document masks limit digits without changing their order', () => {
  assert.equal(formatInput('123456789012345', 'cpf').replace(/\D/g, ''), '12345678901');
  assert.equal(formatInput('123456780001901234', 'cnpj').replace(/\D/g, ''), '12345678000190');
  assert.equal(formatInput('01310930123', 'postal-code'), '01310-930');
});

test('worker profile hides retired fields while keeping identity and restaurant contact', () => {
  const overview = readFileSync(new URL('../app/components/profile-overview.tsx', import.meta.url), 'utf8');
  const workerDetails = overview.slice(overview.indexOf('details: ['), overview.indexOf('} else {'));
  for (const label of ['CPF', 'RG', 'Nascimento', 'Telefone', 'Endereço', 'Experiência', 'Especialidades']) {
    assert.ok(workerDetails.includes(`['${label}',`), `Worker overview keeps ${label}`);
  }
  for (const label of ['WhatsApp', 'Currículo', 'Certificados']) {
    assert.ok(!workerDetails.includes(`['${label}',`), `Worker overview hides ${label}`);
  }
  assert.match(overview, /<ProfileVerification profile=\{profile.verification\}/);
  assert.match(overview, /<VerifiedProfileBadge \/>/);
  assert.match(overview, /role === 'worker' && <div id="confidence"><OperationalReputationView \/>/);
  assert.match(overview.slice(overview.indexOf('} else {')), /\['WhatsApp', data.whatsapp\]/);

  const editor = readFileSync(new URL('../app/components/profile-editor.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(editor, /input\('WhatsApp', workerProfile.whatsapp/);
  assert.doesNotMatch(editor, /curr[ií]cul|resume|certificate|certificado|application\/pdf/i);
  assert.match(editor, /input\('Telefone', workerProfile.phone/);
  assert.match(editor, /input\('WhatsApp', restaurantProfile.whatsapp/);
  for (const file of ['../app/components/profile-verification.tsx', '../app/privacy/page.tsx', '../lib/ui/profile-progress.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /whatsapp|resume|curriculum|certificate|curr[ií]culo|certificado/i);
  }
});

test('confirmed unused components are absent and application has no static or runtime references', () => {
  const removed = [
    ['communication-navigation', 'CommunicationNavigation'],
    ['job-presence-location', 'JobPresenceLocation'],
    ['work-location-fields', 'WorkLocationFields'],
  ];
  for (const [file] of removed) {
    assert.equal(existsSync(new URL(`../app/components/${file}.tsx`, import.meta.url)), false);
  }
  for (const directory of ['../app/', '../lib/']) {
    const root = new URL(directory, import.meta.url);
    for (const file of readdirSync(root, { recursive: true })) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const content = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8');
      for (const [module, symbol] of removed) {
        assert.ok(!content.includes(module) && !content.includes(symbol), `${file} references ${module}`);
      }
    }
  }
});

test('profile screens do not load or store unused score but retain operational reputation', () => {
  for (const file of ['../app/components/profile-overview.tsx', '../app/profile/page.tsx']) {
    const content = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /\bscore\b/);
    assert.match(content, file.includes('profile-overview') ? /<OperationalReputationView \/>/ : /<WorkerProfileRedirect \/>/);
  }
  const reputation = readFileSync(new URL('../app/components/operational-reputation.tsx', import.meta.url), 'utf8');
  assert.match(reputation, /reputation\.score/);
});

async function mountProfileEditor({ role = 'worker', existing = true, saveError = null } = {}) {
  const React = require('react');
  const states = [], effects = [], calls = [];
  let cursor = 0, tree;
  const historical = {
    whatsapp: 'legacy-contact',
    resume_pdf_path: 'worker/legacy-document.pdf',
    certificates: ['worker/legacy-certificate.pdf'],
  };
  let stored = existing ? {
    cpf: '52998224725', rg: 'RG', date_of_birth: '1990-01-01', phone: '11999999999',
    address: 'Street', city: 'City', state: 'SP', postal_code: '01000000',
    bio: '', experience: '', specialties: ['Cozinha'], profile_photo_path: 'worker/photo.jpg',
    cnpj: '11222333000181', legal_name: 'Restaurant', trade_name: 'Restaurant',
    description: '', logo_path: '', company_photos: [],
    ...historical,
  } : null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'worker' } }, error: null }) },
    from(table) {
      return {
        select(columns) {
          calls.push({ kind: 'select', table, columns });
          return {
            eq() { return this; },
            async single() { return { data: { name: 'Name', role, city: 'City' }, error: null }; },
            async maybeSingle() {
              const data = !stored ? null : columns === '*' ? stored
                : Object.fromEntries(columns.split(', ').map((field) => [field, stored[field]]));
              return { data, error: null };
            },
          };
        },
        async upsert(payload, options) {
          calls.push({ kind: 'upsert', table, payload, options });
          if (!saveError) stored = { ...stored, ...payload };
          return { error: saveError };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      return { error: null };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, file) {
            calls.push({ kind: 'upload', bucket, path, file });
            return { data: { path }, error: null };
          },
          async remove() { assert.fail('Editing a profile must not delete historical uploads'); },
        };
      },
    },
  };
  const Camera = () => null;
  const Component = loadTs('../app/components/profile-editor.tsx', {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
        }];
      },
      useEffect(callback) { if (!effects.length) effects.push(callback); },
    },
    '@/app/components/ui': ui,
    '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/camera-capture': { default: Camera },
    '@/lib/validations/br-documents': loadTs('../lib/validations/br-documents.ts'),
    '@/lib/ui/profile-progress': { getProfileProgress },
    '@/app/components/profile-progress': loadTs('../app/components/profile-progress.tsx', { '@/app/components/ui': ui }),
    '@/app/components/dashboard-identity': { DashboardLogo: () => null },
    'next/link': { default: ({ children, ...props }) => createElement('a', props, children) },
  }).default;
  const render = () => {
    cursor = 0;
    tree = Component({ role });
    return renderToStaticMarkup(tree);
  };
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
  }
  render();
  effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  render();
  return {
    calls, historical, render, stored: () => stored,
    files: () => elements(tree).filter((node) => node.props?.type === 'file'),
    async save() {
      await elements(tree).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
      return render();
    },
    fill(label, value) {
      const field = elements(tree).find((node) => node.type === 'label'
        && elements(node.props.children).some((child) => child.type === 'span' && child.props.children === label));
      assert.ok(field, `Missing field: ${label}`);
      const control = elements(field.props.children).find((node) => node.props?.onValueChange || node.props?.onChange);
      if (control.props.onValueChange) control.props.onValueChange(value);
      else control.props.onChange({ target: { value } });
      render();
    },
  };
}

test('rendered worker editor hides retired data and saving preserves historical fields and uploads', async () => {
  const editor = await mountProfileEditor();
  const markup = editor.render();
  assert.doesNotMatch(markup, /whatsapp|resume|curriculum|certificate|curr[ií]culo|certificado|Não enviado|arquivo\(s\)|legacy-/i);
  for (const label of ['CPF', 'RG', 'Data de nascimento', 'Telefone', 'Endereço', 'Especialidades', 'Perfil Verificado']) {
    assert.ok(markup.includes(label), `Keeps ${label}`);
  }
  assert.match(markup, /100% preenchido/);
  assert.match(markup, /href="\/worker\/profile"[^>]*>Cancelar<\/a>/);
  assert.match(markup, /href="\/worker\/profile#verification"/);
  assert.equal(editor.files().length, 1);
  assert.equal(editor.files()[0].props.accept, 'image/jpeg,image/png,image/webp');
  editor.fill('Telefone', '11888888888');
  assert.match(await editor.save(), /Perfil salvo com sucesso/);
  assert.match(editor.render(), /href="\/worker\/profile"[^>]*>Cancelar<\/a>/);
  const saved = editor.calls.find((call) => call.kind === 'upsert');
  assert.equal(saved.table, 'worker_profiles');
  assert.equal(saved.payload.phone, '11888888888');
  assert.equal(saved.payload.whatsapp, editor.historical.whatsapp);
  for (const key of ['resume_pdf_path', 'certificates']) {
    assert.equal(Object.hasOwn(saved.payload, key), false);
    assert.deepEqual(editor.stored()[key], editor.historical[key]);
  }
  assert.equal(editor.calls.some((call) => call.kind === 'upload'), false);
});

test('new worker profile saves without retired inputs and restricts photo uploads to images', async () => {
  const editor = await mountProfileEditor({ existing: false });
  for (const [label, value] of [
    ['CPF', '52998224725'], ['RG', 'RG'], ['Data de nascimento', '1990-01-01'],
    ['Telefone', '11999999999'], ['CEP', '01000000'], ['Estado', 'SP'],
    ['Endereço', 'Street'], ['Especialidades (separadas por vírgula)', 'Cozinha'],
  ]) editor.fill(label, value);
  const fileInput = editor.files()[0];
  fileInput.props.onChange({ target: { files: [{ type: 'application/pdf', size: 10 }] } });
  editor.render();
  assert.match(await editor.save(), /Formato de arquivo não permitido/);
  assert.equal(editor.calls.some((call) => call.kind === 'upload' || call.kind === 'upsert'), false);
  fileInput.props.onChange({ target: { files: [{ type: 'image/jpeg', size: 10 }] } });
  editor.render();
  assert.match(await editor.save(), /Perfil salvo com sucesso/);
  const saved = editor.calls.find((call) => call.kind === 'upsert');
  assert.equal(saved.payload.whatsapp, '');
  assert.equal(Object.hasOwn(saved.payload, 'resume_pdf_path'), false);
  assert.equal(Object.hasOwn(saved.payload, 'certificates'), false);
  const uploads = editor.calls.filter((call) => call.kind === 'upload');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].bucket, 'worker-private');
  assert.match(uploads[0].path, /^worker\/profile-photo-.*\.jpg$/);
});

test('restaurant editor keeps WhatsApp and worker save failures remain explicit', async () => {
  const restaurant = await mountProfileEditor({ role: 'restaurant' });
  assert.match(restaurant.render(), /WhatsApp/);
  assert.equal(restaurant.files().length, 2);
  const worker = await mountProfileEditor({ saveError: { message: 'Save failed' } });
  assert.match(await worker.save(), /Save failed/);
  assert.doesNotMatch(worker.render(), /Perfil salvo com sucesso/);
});

test('profile progress is presentational, deterministic and counts only nonblank fields', () => {
  assert.equal(getProfileProgress('worker', '', {}).percentage, 0);
  assert.equal(getProfileProgress('worker', 'Name', { city: 'City', phone: ' ' }).percentage, 33);
  const worker = getProfileProgress('worker', 'Name', {
    city: 'City', phone: '123', cpf: '123', rg: '456', profile_photo_path: 'photo',
  });
  assert.equal(worker.percentage, 100);
  assert.equal(worker.items.length, 6);
  assert.equal(getProfileProgress('restaurant', 'Name', {
    city: 'City', phone: '123', cnpj: '123', address: 'Street', logo_path: 'logo',
  }).percentage, 100);
});

function luminance(hex) {
  const values = hex.match(/[a-f\d]{2}/gi).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('actual CSS tokens meet AA for field text, placeholders, primary buttons and boundaries', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const token = name => css.match(new RegExp(`${name}:\\s*(#[a-f\\d]{6})`, 'i'))[1];
  assert.ok(contrast(token('--ec-muted'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--foreground'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--ec-brand'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--ec-border'), '#ffffff') >= 3);
});

test('EVC semantic badge tokens preserve readable text and shared info presentation', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const token = name => css.match(new RegExp(`${name}:\\s*(#[a-f\\d]{6})`, 'i'))[1];
  for (const tone of ['success', 'info', 'warning', 'danger', 'neutral']) {
    assert.ok(contrast(token(`--ec-${tone}-text`), token(`--ec-${tone}-bg`)) >= 4.5, tone);
  }
  assert.ok(contrast('#ffffff', token('--ec-info-text')) >= 4.5, 'unread badge');
  const html = renderToStaticMarkup(createElement(ui.Badge, { tone: 'info' }, 'Em andamento'));
  assert.match(html, /ec-badge--info/);
  assert.match(html, /Em andamento/);
  assert.match(css, /\.ec-mobile-nav__item\[aria-current="page"\]/);
  assert.match(css, /\.ec-demand-card__title:focus-visible::after/);
  for (const [name, value] of [['sm', '0.5'], ['md', '0.75'], ['lg', '1'], ['xl', '1.25']]) {
    assert.ok(css.includes(`--ec-radius-${name}: ${value}rem`));
  }
});
test('all application input, textarea, select and button elements use shared primitives', () => {
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      return entry.isDirectory() ? walk(url) : entry.name.endsWith('.tsx') ? [url] : [];
    });
  }
  for (const file of walk(new URL('../app/', import.meta.url))) {
    if (file.pathname.includes('/components/ui/')) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /<(?:input|textarea|select|button)\b/, file.pathname);
  }
});

test('worker home and profile screens do not invent scores or replace failed reads with zero', () => {
  const dashboard = readFileSync(new URL('../app/worker/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /profile\?\.score\s*\|\|\s*5/);
  assert.doesNotMatch(dashboard, /average_rating\s*\?\?\s*0|current_score\s*\?\?.*0/);
  assert.match(dashboard, /grid grid-cols-2 gap-4 lg:grid-cols-4/);
  assert.match(dashboard, /header className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8"/);
  assert.match(dashboard, /profile\?\.name \|\| 'Profissional'/);
  assert.match(dashboard, /pb-\[calc\(8rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(dashboard, /Confira sua próxima ação e encontre oportunidades\./);
  assert.match(dashboard, /DashboardLogo role="worker"/);
  assert.match(dashboard, /DashboardAvatar role="worker"/);
  assert.match(dashboard, /OperationalReputationView summary/);
  assert.match(dashboard, /Bem-vindo, \{profile/);
  assert.ok(dashboard.indexOf('Sua central operacional</h1>') < dashboard.indexOf('aria-label="Operações"'));
  assert.ok(dashboard.indexOf('aria-label="Operações"') < dashboard.indexOf('aria-label="Resumo profissional"'));
  assert.match(dashboard, /profile\?\.role === 'worker' && <section aria-label="Operações"/);
  assert.match(dashboard, /Acompanhe suas operações, check-ins e histórico de trabalho/);
  assert.match(dashboard, /Ver Minhas Operações/);
  assert.match(dashboard, /Ver todas as operações/);
  assert.doesNotMatch(dashboard, /Não foi possível carregar sua próxima operação|operationsError/);
  assert.match(dashboard, /Worker operational assignments lookup failed/);
  assert.match(dashboard, /setWorkerOperations\(\[\]\)/);
  assert.match(dashboard, /Consulte suas candidaturas e operações para acompanhar as próximas etapas\./);
  assert.doesNotMatch(dashboard, /profile\?\.city|Olá, \{profile/);
  assert.doesNotMatch(dashboard, /CommunicationNavigation|Acompanhar minhas operações/);
  assert.ok(dashboard.indexOf("label: 'Candidaturas'") < dashboard.indexOf("label: 'Diárias concluídas'"));
  assert.ok(dashboard.indexOf("label: 'Diárias concluídas'") < dashboard.indexOf("label: 'Ganhos estimados'"));
  assert.ok(dashboard.indexOf("label: 'Ganhos estimados'") < dashboard.indexOf('<OperationalReputationView summary />'));
  assert.match(dashboard, /useState\(0\)/);
  assert.match(dashboard, /value: `R\$ \$\{estimatedEarnings\.toLocaleString\('pt-BR', \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)\}`/);
  assert.match(dashboard, /lg:grid-cols-4/);
  assert.doesNotMatch(dashboard, /Indisponível|Ganhos estimados.*'—'/);
  assert.doesNotMatch(dashboard, /earningsError|Avaliação média/);
  assert.match(dashboard, /setTimeout\([\s\S]*?,\s*9000\)/);
  assert.match(dashboard, /className="hidden"[\s\S]*Mostrar distâncias estimadas/);
  assert.match(dashboard, /statsError && <Toast/);
  assert.doesNotMatch(dashboard, /earningsError|Ganhos estimados.*Toast/);
  assert.match(dashboard, /Worker estimated earnings lookup failed/);
  assert.doesNotMatch(dashboard, /earningsResult\.error\.message|profileResult\.error\.message|statsResult\.error\.message/);

  const navigation = readFileSync(new URL('../app/components/mobile-bottom-nav.tsx', import.meta.url), 'utf8');
  assert.match(navigation, /showOnDesktop \? '' : 'md:hidden'/);
  assert.match(navigation, /whitespace-normal text-\[10px\][^"]*sm:text-xs/);
  const reputation = readFileSync(new URL('../app/components/operational-reputation.tsx', import.meta.url), 'utf8');
  assert.match(reputation, /Confiança<\/p>/);
  assert.doesNotMatch(reputation.slice(reputation.indexOf('if (summary)'), reputation.indexOf('return loading ?')), /Confiança operacional/);

  for (const path of ['../app/components/profile-overview.tsx', '../app/profile/page.tsx']) {
    const profile = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(profile, /Number\(profile\.score \?\? 0\)/);
    assert.doesNotMatch(profile, /profile\.score\.toFixed/);
    assert.match(profile, path.includes('profile-overview') ? /OperationalReputationView/ : /WorkerProfileRedirect/);
  }
});

test('restaurant and worker dashboards share logo, avatar and notification components', () => {
  const restaurant = readFileSync(new URL('../app/restaurant/dashboard/page.tsx', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../app/worker/dashboard/page.tsx', import.meta.url), 'utf8');
  for (const [source, role] of [[restaurant, 'restaurant'], [worker, 'worker']]) {
    assert.match(source, new RegExp(`<DashboardLogo role="${role}" \\/>`));
    assert.match(source, new RegExp(`<DashboardAvatar role="${role}"`));
    assert.match(source, /<NotificationBell iconOnly \/>/);
  }
});

test('all requested account screens render the shared DashboardLogo component', () => {
  const screens = [
    '../app/restaurant/dashboard/page.tsx',
    '../app/restaurant/demands/page.tsx',
    '../app/restaurant/messages/message-center.tsx',
    '../app/components/more-navigation.tsx',
    '../app/components/profile-overview.tsx',
    '../app/worker/dashboard/page.tsx',
    '../app/worker/applications/page.tsx',
    '../app/worker/messages/page.tsx',
    '../app/components/profile-editor.tsx',
  ];
  for (const path of screens) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(/DashboardLogo|MoreNavigation role=|ProfileOverview role=/.test(source), path);
  }
  const workerPage = readFileSync(new URL('../app/worker/profile/page.tsx', import.meta.url), 'utf8');
  assert.match(workerPage, /<Suspense/);
  assert.match(workerPage, /<WorkerProfileExperience \/>/);
  const experience = readFileSync(new URL('../app/components/worker-profile-experience.tsx', import.meta.url), 'utf8');
  assert.match(experience, /<ProfileEditor role="worker" \/>/);
  assert.match(experience, /<ProfileOverview role="worker" \/>/);

  for (const path of [
    '../app/components/profile-overview.tsx',
    '../app/components/profile-editor.tsx',
    '../app/components/notification-center.tsx',
    '../app/components/privacy-settings.tsx',
    '../app/reviews/[jobId]/review-client.tsx',
    '../app/page.tsx',
    '../app/profile/page.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<p[^>]*>\s*ExtraChef\s*<\/p>/, path);
  }

  const logo = readFileSync(new URL('../app/components/dashboard-identity.tsx', import.meta.url), 'utf8');
  assert.match(logo, /className="text-lg font-bold tracking-\[-0\.06em\]"/);
});

test('worker applications screen reuses shared identity, aligned containers and hides unavailable operations', () => {
  const applications = readFileSync(new URL('../app/worker/applications/page.tsx', import.meta.url), 'utf8');
  assert.match(applications, /DashboardLogo role="worker"/);
  assert.match(applications, /DashboardAvatar[\s\S]*role="worker"/);
  assert.doesNotMatch(applications, /CommunicationNavigation|NotificationBell/);
  assert.match(applications, /max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12/);
  assert.match(applications, /max-w-6xl space-y-6 px-4 sm:px-6/);
  assert.match(applications, /application\.job !== null/);
  assert.match(applications, /visibleApplications\.map/);
  assert.doesNotMatch(applications, /Vaga indisponível|Operação indisponível/);
  assert.match(applications, /← Voltar/);
  assert.match(applications, /<summary[^>]*>Orientações<\/summary>/);
  assert.doesNotMatch(applications, /Orientações e contato|Voltar às vagas/);
  assert.match(applications, /<MobileBottomNav role="worker" showOnDesktop \/>/);
  const navigation = readFileSync(new URL('../app/components/mobile-bottom-nav.tsx', import.meta.url), 'utf8');
  assert.match(navigation, /href: '\/worker\/messages', label: 'Mensagens'/);
  assert.doesNotMatch(navigation, /worker\/applications#chats/);
});

test('worker messages index links only approved applications with existing messages to the existing chat', () => {
  const messages = readFileSync(new URL('../app/worker/messages/page.tsx', import.meta.url), 'utf8');
  assert.match(messages, /\.eq\('status', 'approved'\)/);
  assert.match(messages, /\.from\('messages'\)/);
  assert.match(messages, /\.eq\('job_id', item\.job_id\)/);
  assert.match(messages, /return data \? \{ item, message: data \} : null/);
  assert.match(messages, /href=\{`\/chat\/\$\{conversation\.job_id\}`\}/);
  assert.match(messages, /Ainda não existem conversas\./);
  assert.match(messages, /As mensagens das operações aparecerão aqui\./);
  assert.match(messages, /DashboardLogo role="worker"/);
  assert.match(messages, /DashboardAvatar/);
  assert.match(messages, /DashboardNav role="worker" showOnDesktop/);
  assert.doesNotMatch(messages, /rpc\(|\.insert\(|\.update\(/);
  const navigation = readFileSync(new URL('../app/components/mobile-bottom-nav.tsx', import.meta.url), 'utf8');
  assert.match(navigation, /href: '\/worker\/messages'/);
  assert.doesNotMatch(navigation, /worker\/applications#chats/);
});

test('worker monthly earnings are limited to completed, confirmed payments in the current local month', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261019020000_worker_monthly_paid_earnings.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_worker_estimated_earnings\(\)\s+RETURNS numeric/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /date_trunc\('month', now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.match(migration, /SUM\(assignments\.amount\)/);
  assert.match(migration, /assignments\.checkout_at IS NOT NULL/);
  assert.match(migration, /assignments\.receipt_confirmed_at >= month_start/);
  assert.match(migration, /assignments\.receipt_confirmed_at < month_start \+ interval '1 month'/);
  assert.match(migration, /assignments\.payment_disputed_at IS NULL/);
  assert.match(migration, /COALESCE\(SUM\(assignments\.amount\), 0\)/);
});
