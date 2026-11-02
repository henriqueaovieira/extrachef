import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
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

test('profile progress is presentational, deterministic and counts only nonblank fields', () => {
  assert.equal(getProfileProgress('worker', '', {}).percentage, 0);
  assert.equal(getProfileProgress('worker', 'Name', { city: 'City', phone: ' ' }).percentage, 33);
  const worker = getProfileProgress('worker', 'Name', {
    city: 'City', phone: '123', cpf: '123', resume_pdf_path: 'resume', profile_photo_path: 'photo',
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
  assert.match(dashboard, /max-w-6xl grid-cols-2 gap-2 px-4 pt-10 sm:gap-4 sm:px-6 lg:grid-cols-4/);
  assert.match(dashboard, /header className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12"/);
  assert.match(dashboard, /profile\?\.name \|\| 'Profissional'/);
  assert.match(dashboard, /sm:pb-\[calc\(12rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(dashboard, /Encontre operações e acompanhe suas candidaturas\./);
  assert.match(dashboard, /DashboardLogo role="worker"/);
  assert.match(dashboard, /DashboardAvatar role="worker"/);
  assert.match(dashboard, /OperationalReputationView summary/);
  assert.match(dashboard, /Bem-vindo 👋/);
  assert.match(dashboard, /Encontre operações e acompanhe suas candidaturas\./);
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
  assert.match(navigation, /whitespace-normal text-\[10px\]/);
  const reputation = readFileSync(new URL('../app/components/operational-reputation.tsx', import.meta.url), 'utf8');
  assert.match(reputation, /Confiança<\/p>/);
  assert.doesNotMatch(reputation.slice(reputation.indexOf('if (summary)'), reputation.indexOf('return loading ?')), /Confiança operacional/);

  for (const path of ['../app/components/profile-overview.tsx', '../app/profile/page.tsx']) {
    const profile = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(profile, /Number\(profile\.score \?\? 0\)/);
    assert.doesNotMatch(profile, /profile\.score\.toFixed/);
    assert.match(profile, /OperationalReputationView/);
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
    '../app/worker/profile/page.tsx',
    '../app/worker/profile/details/page.tsx',
  ];
  for (const path of screens) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(/DashboardLogo|MoreNavigation role=|ProfileOverview role=/.test(source), path);
  }

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
  assert.doesNotMatch(navigation, /worker\/applications#chats|useSyncExternalStore/);
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
  const communicationNavigation = readFileSync(new URL('../app/components/communication-navigation.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(communicationNavigation, /worker\/applications#chats/);
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
