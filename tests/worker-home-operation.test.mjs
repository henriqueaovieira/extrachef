import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}

const demands = load('../lib/demands.ts');
const operations = load('../lib/operations.ts', { '@/lib/demands': demands });

const now = new Date('2099-01-01T12:00:00-03:00');
const operation = (jobId, start, end, extra = {}) => ({
  job_id: jobId,
  worker_id: 'worker',
  checkin_at: null,
  paid_at: null,
  payment_disputed_at: null,
  receipt_confirmed_at: null,
  checkout_at: null,
  interruption: null,
  interrupted_at: null,
  replacement_job_id: null,
  job: {
    title: 'Garçom',
    job_date: start.slice(0, 10),
    start_time: `${start.slice(11, 16)}:00`,
    end_time: `${end.slice(11, 16)}:00`,
    restaurant: { name: 'Restaurante Teste' },
  },
  ...extra,
});

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts'),
});
const Link = ({ children, ...props }) => React.createElement('a', props, children);
const identity = load('../app/components/dashboard-identity.tsx', { 'next/link': { default: Link } });
const navigation = load('../app/components/mobile-bottom-nav.tsx', {
  'next/link': { default: Link },
  'next/navigation': { usePathname: () => '/worker/dashboard' },
  '@/app/components/communication-state': {
    useCommunication: () => ({ counts: { messages: 3 }, chatError: '' }),
  },
  '@/app/components/ui': ui,
}).default;

export const homeFixtures = {
  empty: {},
  future: { operations: [operation('future', '2099-01-01T14:15', '2099-01-01T18:00')] },
  checkin: { operations: [operation('checkin', '2099-01-01T11:58', '2099-01-01T18:00')] },
  absence: { operations: [operation('absence', '2099-01-01T10:00', '2099-01-01T18:00')] },
  working: { operations: [operation('working', '2099-01-01T09:00', '2099-01-01T20:00', { checkin_at: '2099-01-01T09:00:00-03:00' })] },
  payment: { operations: [operation('payment', '2099-01-01T08:00', '2099-01-01T11:00', { checkin_at: '2099-01-01T08:00:00-03:00' })] },
  checkout: { operations: [operation('checkout', '2099-01-01T08:00', '2099-01-01T11:00', {
    checkin_at: '2099-01-01T08:00:00-03:00', receipt_confirmed_at: '2099-01-01T11:05:00-03:00',
  })] },
  loading: { loading: true },
  signedOut: { signedIn: false },
  errors: { jobsError: 'Não foi possível carregar as oportunidades.', reviewsError: 'Não foi possível conferir as avaliações pendentes.' },
};
homeFixtures.multiple = { operations: [...homeFixtures.checkin.operations, ...homeFixtures.checkout.operations] };
homeFixtures.longContent = {
  operations: homeFixtures.working.operations.map(item => ({
    ...item, job: { ...item.job, title: 'ProfissionalDeCozinhaComTituloExtenso'.repeat(3),
      restaurant: { name: 'RestauranteComNomeExtenso'.repeat(4) } },
  })),
  name: 'ProfissionalComNomeMuitoLongoSemEspacos'.repeat(4),
  jobs: [{
    id: 'opportunity', title: 'AuxiliarDeCozinhaComTituloMuitoLongo'.repeat(3),
    description: 'Plantão de atendimento e preparação de alimentos. '.repeat(5),
    job_date: '2099-01-02', start_time: '10:00:00', end_time: '18:00:00', value: 180,
    status: 'open', work_address: 'Avenida de Testes com nome extenso', work_number: '100',
    work_city: 'Cidade de Testes', work_state: 'SP', location_name: 'Salão de Eventos',
    restaurant: { name: 'Restaurante de Testes' }, location_status: 'ready', work_latitude: -23.5, work_longitude: -46.6,
  }],
  reviews: [{ job_id: 'review', reviewed_name: 'RestauranteComNomeExtenso'.repeat(4), title: 'Plantão de teste' }],
  history: [{ job_id: 'past', title: 'Plantão anterior', restaurant_name: 'RestauranteComNomeExtenso'.repeat(4),
    job_date: '2098-12-30', start_time: '08:00:00', end_time: '16:00:00', status: 'completed', value: 180 }],
};
homeFixtures.allApplied = { jobs: homeFixtures.longContent.jobs, appliedIds: ['opportunity'] };

export const feedbackCases = [
  ['Candidatura enviada com sucesso.', 'success'],
  ['Detalhes do plantão copiados para compartilhar.', 'success'],
  ['O recrutamento desta operação foi encerrado.', 'info'],
  ['Antes de se candidatar novamente, avalie sua última experiência.', 'warning'],
  ['Compartilhamento não está disponível neste navegador.', 'warning'],
  ['Não foi possível conferir suas avaliações pendentes. Atualize a página.', 'danger'],
  ['Sua sessão expirou. Entre novamente.', 'danger'],
  ['Você já se candidatou a esta vaga.', 'danger'],
  ['Não foi possível enviar sua candidatura. Tente novamente.', 'danger'],
  ['Não foi possível compartilhar este plantão.', 'danger'],
];

export function renderHome(options = {}, markup = true) {
  const states = [
    options.jobs ?? [], options.appliedIds ?? [], { name: options.name ?? 'Profissional Teste', role: options.role ?? 'worker' },
    null, { total_applications: 2, completed_jobs: 1, history: options.history ?? [] }, 180,
    options.loading ?? false, options.signedIn ?? true, options.applyingId ?? null, options.feedback ?? '',
    {}, null, false, options.locationError ?? '', options.jobsError ?? '',
    options.applicationsError ?? '', options.pageError ?? '', options.profileError ?? '', options.statsError ?? '',
    options.reviews ?? [], options.operations ?? [], options.reviewsError ?? '', options.reviewsReady ?? true, now,
  ];
  let cursor = 0;
  const reputationStates = [{}, { score: 80, classification: 'Confiável' }, '', false, 0];
  let reputationCursor = 0;
  const reputation = load('../app/components/operational-reputation.tsx', {
    react: { ...React, useEffect() {}, useState: () => [reputationStates[reputationCursor++], () => {}] },
    '@/app/components/ui': ui, '@/lib/supabase/client': { createClient() { throw new Error('Unexpected database access'); } },
  }).default;
  const Home = load('../app/worker/dashboard/page.tsx', {
    react: { ...React, useEffect() {}, useState: () => [states[cursor++], () => {}] },
    '@/app/components/ui': ui,
    '@/lib/supabase/client': { createClient() { throw new Error('Unexpected database access'); } },
    'next/link': { default: Link },
    '@/app/components/mobile-bottom-nav': { default: navigation },
    '@/app/components/notification-bell': { default: () => React.createElement(ui.Button, { 'aria-label': 'Notificações' }, '●') },
    '@/app/components/dashboard-identity': identity,
    '@/lib/geolocation': {}, '@/lib/work-location': {},
    '@/lib/operations': operations,
    '@/app/components/operational-reputation': { default: reputation },
    '@/lib/demands': demands,
  }).default;
  const tree = Home();
  return markup ? renderToStaticMarkup(tree) : tree;
}

test('home preserves direct operational destinations, actions and semantic status text', () => {
  for (const [fixture, tone] of [['future', 'info'], ['checkin', 'warning'], ['absence', 'warning'],
    ['working', 'info'], ['payment', 'warning'], ['checkout', 'success']]) {
    const options = homeFixtures[fixture];
    const expected = operations.selectWorkerHomeOperation(options.operations, now);
    const html = renderHome(options);
    const card = html.slice(html.indexOf('aria-label="Operações"'), html.indexOf('id="vagas"'));
    assert.ok(card.includes(`href="${expected.href}"`), fixture);
    assert.ok(card.includes(expected.action), fixture);
    assert.ok(card.includes(expected.status), fixture);
    assert.ok(card.includes(`ec-badge--${tone}`), fixture);
    assert.match(card, /ec-button--primary/);
    assert.doesNotMatch(card, /<button/);
  }
  const multiple = renderHome(homeFixtures.multiple);
  assert.match(multiple, /href="\/worker\/applications" aria-label="[^"]*Ver todas as operações"/);
  assert.match(multiple, /\+1 operação/);
  const empty = renderHome();
  assert.match(empty, /Ver Minhas Operações/);
  assert.match(empty, /Consulte suas candidaturas e operações/);
});

test('home prioritizes operations and blocking reviews before discovery and secondary information', () => {
  const html = renderHome(homeFixtures.longContent);
  const markers = ['aria-label="Operações"', 'Avaliação pendente', 'id="vagas"', 'aria-label="Resumo profissional"', 'id="historico"'];
  for (let i = 1; i < markers.length; i++) assert.ok(html.indexOf(markers[i - 1]) < html.indexOf(markers[i]));
  assert.match(html, /href="\/reviews\/review"/);
  assert.match(html, /disabled=""[^>]*>Candidatar-se/);
  assert.match(html, /02\/01\/2099/);
  assert.match(html, /10:00 às 18:00/);
  assert.match(html, /scope="col"/);
  assert.match(html, /tabindex="0" role="region"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Compartilhar vaga/);
});

test('home retains loading, auth, errors, empty, candidature and permission states', () => {
  assert.match(renderHome(homeFixtures.loading), /Carregando operações e oportunidades/);
  assert.match(renderHome(homeFixtures.signedOut), /href="\/login"/);
  assert.match(renderHome(homeFixtures.errors), /role="alert"/);
  assert.match(renderHome(), /Nenhuma oportunidade disponível no momento/);
  assert.doesNotMatch(renderHome({ role: 'restaurant' }), /aria-label="Operações"/);
  const available = { jobs: homeFixtures.longContent.jobs };
  assert.doesNotMatch(renderHome(available), /disabled=""[^>]*>Candidatar-se/);
  assert.match(renderHome({ ...available, reviewsReady: false }), /disabled=""[^>]*>Candidatar-se/);
  assert.doesNotMatch(renderHome({ ...available, appliedIds: ['opportunity'] }), /Candidatar-se/);
  assert.match(renderHome({ ...available, applyingId: 'opportunity' }), /disabled=""[^>]*>Enviando/);
  assert.match(renderHome({ feedback: 'Candidatura enviada com sucesso.' }), /ec-toast--success/);
  assert.match(renderHome({ feedback: 'Detalhes do plantão copiados para compartilhar.' }), /ec-toast--success/);
});

test('every feedback emitted by existing handlers has an explicit accessible semantic classification', () => {
  const source = readFileSync(new URL('../app/worker/dashboard/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const messages = new Set();
  function collect(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'setFeedbackMessage') {
      function literals(child) {
        if (ts.isConditionalExpression(child)) {
          literals(child.whenTrue);
          literals(child.whenFalse);
          return;
        }
        if (ts.isStringLiteral(child) && child.text) messages.add(child.text);
        ts.forEachChild(child, literals);
      }
      node.arguments.forEach(literals);
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  assert.deepEqual([...messages].sort(), feedbackCases.map(([message]) => message).sort());
  for (const [message, tone] of [...feedbackCases, ['Falha inesperada de teste.', 'danger']]) {
    const html = renderHome({ feedback: message });
    const toast = html.match(/<div[^>]*role="(alert|status)"[^>]*class="ec-toast ec-toast--(\w+)"/);
    assert.ok(toast, message);
    assert.equal(toast[1], tone === 'danger' ? 'alert' : 'status', message);
    assert.equal(toast[2], tone, message);
    assert.ok(html.includes(message), message);
  }
});

test('all existing home error surfaces render danger and alert, not info or status', () => {
  for (const field of ['pageError', 'profileError', 'applicationsError', 'statsError', 'reviewsError', 'jobsError', 'locationError']) {
    const html = renderHome({ [field]: 'Falha de teste.' });
    assert.match(html, /role="alert"[^>]*class="ec-toast ec-toast--danger"/, field);
    assert.doesNotMatch(html, /ec-toast--(?:info|warning|success|error)/, field);
  }
});

test('opportunity empty states distinguish no recruitable jobs, all applied, loading failure and mixed results', () => {
  const titleA = 'Nenhuma oportunidade disponível no momento.';
  const titleB = 'Você já se candidatou para todas as oportunidades disponíveis.';
  const titleC = 'Não foi possível carregar as oportunidades.';
  const jobs = homeFixtures.longContent.jobs;
  for (const options of [{}, { jobs: [{ ...jobs[0], status: 'completed' }] },
    { jobs: [{ ...jobs[0], location_status: 'pending' }] },
    { jobs: [{ ...jobs[0], job_date: '2098-12-30' }] }]) {
    const html = renderHome(options);
    assert.ok(html.includes(titleA));
    assert.match(html, /Novas operações aparecerão aqui assim que forem publicadas\./);
    assert.ok(!html.includes(titleB));
    assert.ok(!html.includes(titleC));
  }
  const allApplied = renderHome({ ...homeFixtures.allApplied, appliedIds: ['opportunity', 'unrelated'] });
  assert.ok(allApplied.includes(titleB));
  assert.match(allApplied, /Acompanhe suas candidaturas em Minhas Operações\./);
  assert.ok(!allApplied.includes(titleA));
  for (const options of [{}, homeFixtures.allApplied, { jobs }]) {
    const html = renderHome({ ...options, jobsError: 'Mensagem antiga do loader.' });
    assert.ok(html.includes(titleC));
    assert.match(html, /Tente novamente\./);
    assert.match(html, /role="alert"[^>]*class="ec-toast ec-toast--danger"/);
    assert.ok(!html.includes(titleA));
    assert.ok(!html.includes(titleB));
    assert.doesNotMatch(html, /Candidatar-se|Mensagem antiga do loader/);
  }
  const mixed = renderHome({ jobs: [...jobs, { ...jobs[0], id: 'other', title: 'Outra oportunidade' }], appliedIds: ['opportunity'] });
  assert.match(mixed, /Outra oportunidade/);
  assert.equal((mixed.match(/>Candidatar-se</g) ?? []).length, 1);
  assert.ok(!mixed.includes(titleA));
  assert.ok(!mixed.includes(titleB));
  assert.doesNotMatch(mixed, /Não há plantões abertos agora/);
});

test('selects the most urgent active worker operation and its direct action', () => {
  const next = operation('next', '2099-01-01T14:15', '2099-01-01T18:00');
  const checkin = operation('checkin', '2099-01-01T11:58', '2099-01-01T18:00');
  const absence = operation('absence', '2099-01-01T10:00', '2099-01-01T18:00');
  const working = operation('working', '2099-01-01T09:00', '2099-01-01T20:00', {
    checkin_at: '2099-01-01T09:00:00-03:00',
  });
  const checkout = operation('checkout', '2099-01-01T08:00', '2099-01-01T11:00', {
    checkin_at: '2099-01-01T08:00:00-03:00',
    receipt_confirmed_at: '2099-01-01T11:05:00-03:00',
  });

  assert.equal(operations.selectWorkerHomeOperation([], now), null);
  assert.deepEqual(
    [next, checkin, absence, working, checkout].map((item) => operations.selectWorkerHomeOperation([item], now)?.title),
    ['Próxima Operação', 'Check-in Disponível', 'Pendência Operacional', 'Operação em Andamento', 'Checkout Disponível'],
  );

  const selected = operations.selectWorkerHomeOperation([next, checkin, absence, working, checkout], now);
  assert.equal(selected?.jobId, 'checkout');
  assert.equal(selected?.href, '/checkout/checkout');
  assert.equal(selected?.action, 'Realizar Checkout');
});
