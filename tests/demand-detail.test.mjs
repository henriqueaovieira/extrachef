import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports);
  return exports;
}
const domain = load('../lib/demands.ts');
const helpers = load('../lib/demand-detail.ts', { '@/lib/demands': domain });
const operations = load('../lib/operations.ts');
const ui = load('../app/components/ui/index.tsx', { '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts') });
const shared = {
  '@/app/components/operation-flow': { default: load('../app/components/operation-flow.tsx', {
    '@/app/components/ui': ui,
    '@/lib/operations': operations,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  }).default },
  '@/app/components/professional-verification': { default: () => null },
  '@/app/components/ui': ui,
  '@/lib/supabase/client': { createClient: () => { throw new Error('Unexpected database access during render'); } },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/image': { default: ({ src, alt, className }) => React.createElement('img', { src, alt, className }) },
};
const Person = load('../app/components/demand-person.tsx', shared).default;
const Nav = load('../app/components/mobile-bottom-nav.tsx', {
  ...shared,
  'next/navigation': { usePathname: () => '/restaurant/demands/operation' },
  '@/app/components/communication-state': { useCommunication: () => ({ counts: { messages: 0, notifications: 0 }, error: '', chatError: '' }) },
}).default;
const cards = load('../app/components/demand-card.tsx', { ...shared, '@/lib/demands': domain, '@/lib/demand-detail': helpers });
const person = (id, extra = {}) => ({ id, name: `Profissional ${id}`, specialties: ['Garçom'], score: 4.7, photo_path: null, experience: null, categories: [], completed_operations: 0, invitation_status: null, ...extra });
export function fixture() {
  const jobs = Array.from({ length: 4 }, (_, i) => ({
    id: `job${i}`, demand_id: 'operation', demand_revision: 0, title: 'Festival Gastronômico', description: 'Uniforme preto\nChegar 15 minutos antes',
    job_date: '2099-11-12', start_time: '10:00:00', end_time: '23:00:00', status: i < 2 ? 'filled' : 'open', value: 150,
    location_name: 'Centro de Eventos', location_status: 'ready', work_address: 'Rua A', work_number: '123', work_city: 'São Paulo', work_state: 'SP', work_latitude: -23.55, work_longitude: -46.63,
  }));
  const applications = [
    { job_id: 'job0', worker_id: 'h1', status: 'approved' },
    { job_id: 'job1', worker_id: 'h2', status: 'in_progress' },
    ...[1, 2, 3, 4].map(i => ({ job_id: 'job2', worker_id: `c${i}`, status: 'pending', created_at: `2026-01-0${i}T12:00:00Z` })),
    { job_id: 'job3', worker_id: 'c4', status: 'pending', created_at: '2026-01-01T12:00:00Z' },
  ];
  return { jobs, applications, reserves: [{ demand_id: 'operation', worker_id: 'c3' }] };
}
export function mount(file, { data = fixture(), params = '', canInvite = true, people = ['h1', 'h2', 'c1', 'c2', 'c3', 'c4'].map(id => person(id)), talentRows = [], history = [{ id: 'event1', kind: 'created', worker_id: null, occurred_at: '2026-01-01T12:00:00Z' }], historyFailure = false, coreFailure = false, profileFailure = false, rpcFailure = false, rpcFailures = [], invitations = [], assignments = [], assignmentFailure = { value: false }, reviews = [], reviewFailure = { value: false } } = {}) {
  let dirty = true, cursor = 0, effectCursor = 0, tree;
  const state = [], effects = [], calls = [], reviewLoads = [];
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({ focus() {} }) };
  const timers = new Map();
  const windowListeners = new Map();
  let timerId = 0;
  globalThis.window = { setInterval(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearInterval(id) { timers.delete(id); },
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name) { windowListeners.delete(name); } };
  const db = {
    from(table) {
      if (table === 'demand_invitations') {
        const query = { select: () => query, eq: () => query, order: () => query,
          in: async () => ({ data: invitations, error: null }),
          range: async () => ({ data: invitations, error: null }) };
        return query;
      }
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        range() { return Promise.resolve({ data: historyFailure ? null : history, error: historyFailure ? { message: 'offline' } : null }); },
      };
      assert.equal(table, 'demand_events');
      return query;
    },
    rpc(name, args) {
      calls.push({ name, args });
      if (rpcFailures.includes(name)) return Promise.resolve({ error: { message: 'Serviço indisponível' }, data: null });
      if (name === 'restaurant_talent_directory') return Promise.resolve({ data: talentRows, error: null });
      if ((profileFailure && name === 'demand_talent_directory') || (rpcFailure && !['demand_talent_directory', 'worker_demand_invites'].includes(name))) return Promise.resolve({ error: { message: 'Serviço indisponível' }, data: null });
      if (name === 'demand_talent_directory') return Promise.resolve({ data: args.p_worker_id ? people.filter(person => person.id === args.p_worker_id) : people, error: null });
      if (name === 'worker_demand_invites') return Promise.resolve({ data: invitations, error: null });
      if (name === 'restaurant_talent_reviews') return Promise.resolve({ data: [], error: null });
      if (name === 'restaurant_talent_history') return Promise.resolve({ data: [], error: null });
      if (name === 'invite_demand_worker') invitations.push({ demand_id: args.p_demand_id, worker_id: args.p_worker_id, status: 'pending' });
      if (name === 'approve_demand_candidate') {
        const application = data.applications.find(item => item.worker_id === args.p_worker_id && item.status === 'pending');
        application.status = 'approved';
        data.jobs.find(item => item.id === application.job_id).status = 'filled';
        data.reserves = data.reserves.filter(item => item.worker_id !== application.worker_id);
      }
      if (name === 'set_demand_reserve') data.reserves = args.p_enabled ? [...data.reserves, { demand_id: 'operation', worker_id: args.p_worker_id }] : data.reserves.filter(item => item.worker_id !== args.p_worker_id);
      return Promise.resolve({ data: null, error: null });
    },
  };
  const Component = load(file, {
    ...shared,
    react: {
      ...React,
      useMemo: callback => callback(),
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; dirty = true; }];
      },
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((dep, i) => dep !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { callback, deps, pending: true };
        }
      },
    },
    'next/navigation': { useSearchParams: () => new URLSearchParams(params), useRouter: () => ({ push() {}, refresh() {} }) },
    '@/lib/supabase/client': { createClient: () => db },
    '@/lib/demands': { ...domain, loadDemands: async () => { if (coreFailure) throw new Error('offline'); return data; } },
    '@/lib/demand-detail': helpers,
    '@/lib/talent-board': load('../lib/talent-board.ts'),
    '@/lib/specialties': load('../lib/specialties.ts'),
    '@/lib/operations': { ...operations, loadOperationalAssignments: async () => {
      if (assignmentFailure.value) throw new Error('offline');
      return assignments;
    }, loadPendingReviews: async () => {
      reviewLoads.push({ failed: reviewFailure.value });
      if (reviewFailure.value) throw new Error('reviews offline');
      return reviews;
    } },
    '@/app/components/operational-reputation': load('../app/components/operational-reputation.tsx', shared),
    '@/app/components/demand-card': { DemandSituation: cards.DemandSituation, DemandActions: cards.DemandActions },
    '@/app/components/demand-person': { default: Person },
    '@/app/components/demand-talent-network': { default: () => React.createElement('p', null, 'Rede de Talentos') },
    '@/app/components/mobile-bottom-nav': { default: Nav },
  }).default;
  function render() {
    cursor = effectCursor = 0; dirty = false;
    tree = Component({ demandId: 'operation', canInvite });
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
  }
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children), ...elements(node.props?.action)];
  }
  return {
    calls,
    reviewLoads,
    render,
    tick: delay => [...timers.values()].filter(timer => delay === undefined || timer.delay === delay).forEach(timer => timer.callback()),
    focus: () => windowListeners.get('focus')?.(),
    async flush() {
      for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); }
      assert.equal(dirty, false);
    },
    html: () => renderToStaticMarkup(tree),
    elements: () => elements(tree),
    find: text => elements(tree).find(item => item.type === ui.Button && item.props.children === text),
    close() { effects.forEach(effect => effect.cleanup?.()); globalThis.window = oldWindow; globalThis.document = oldDocument; },
  };
}
const detailFile = '../app/restaurant/demands/[demandId]/demand-detail.tsx';
const talentFile = '../app/restaurant/candidates/talent-center.tsx';
const talent = (id, extra = {}) => ({
  ...person(id), city: 'São Paulo', state: 'SP', bio: null, review_count: 0, reviews: [],
  restaurant_operations: 0, last_hired_at: null, history: [], reputation: null, ...extra,
});
const tabCount = (app, id) => app.elements().find(node => node.props?.id === `talent-tab-${id}`).props.children.at(-1).props.children;
const cardNames = app => [...app.html().matchAll(/<article\b[^]*?<\/article>/g)].map(match => match[0]);

test('talent search and function, city and relationship filters cover recommendations and related groups', async () => {
  for (const criterion of ['search', 'specialty', 'city', 'relationship']) {
    const data = fixture();
    data.applications = [{ job_id: 'job2', worker_id: 'candidate', status: 'pending' }];
    const rows = ['candidate', 'invited', 'suggested', 'other'].map(id => talent(id, {
      name: id === 'other' ? 'Outro' : `Alvo ${id}`,
      specialties: id === 'other' ? ['Cozinha'] : ['Garçom'],
      city: id === 'other' ? 'Santos' : 'São Paulo',
      categories: id === 'other' ? [] : ['favorite', 'interest'],
    }));
    const app = mount(talentFile, { data, talentRows: rows, invitations: [{ demand_id: 'operation', worker_id: 'invited', status: 'pending' }] });
    try {
      await app.flush();
      if (criterion === 'search') app.elements().find(node => node.props?.type === 'search').props.onChange({ target: { value: 'Alvo' } });
      else if (criterion === 'relationship') {
        app.elements().find(node => node.props?.['aria-haspopup'] === 'dialog').props.onClick(); await app.flush();
        const checkbox = app.elements().find(node => node.type === 'label' && node.props.children?.[0] === 'Apenas Favoritos').props.children[1];
        checkbox.props.onChange({ target: { checked: true } });
      } else {
        app.elements().find(node => node.props?.['aria-haspopup'] === 'dialog').props.onClick(); await app.flush();
        app.elements().find(node => node.props?.id === `talent-${criterion}`).props.onChange({ target: { value: criterion === 'city' ? 'São Paulo/SP' : 'Garçom' } });
      }
      await app.flush();
      assert.equal(cardNames(app).length, 3);
      assert.equal(tabCount(app, 'all'), 3);
      for (const id of ['candidate', 'invited', 'suggested']) assert.ok(cardNames(app).some(card => card.includes(`Alvo ${id}`)));
      assert.equal(cardNames(app).some(card => card.includes('Outro')), false);
      app.elements().find(node => node.props?.id === 'talent-tab-interests').props.onClick(); await app.flush();
      assert.equal(tabCount(app, 'interests'), cardNames(app).length);
      assert.equal(cardNames(app).some(card => card.includes('Outro')), false);
      assert.equal(app.calls.some(call => call.name === 'approve_demand_candidate'), false);
    } finally { app.close(); }
  }
});

test('talent counts match rendered cards, invitations preserve people and other recommendations, ranking is unchanged', async () => {
  const data = { ...fixture(), applications: [], reserves: [] };
  const app = mount(talentFile, { data, talentRows: ['a', 'b', 'c', 'd'].map(id => talent(id)) });
  try {
    await app.flush();
    assert.equal(cardNames(app).length, 3);
    assert.equal(tabCount(app, 'all'), 3);
    const invite = app.find('Convidar para operação');
    await invite.props.onClick(); await app.flush();
    for (const name of ['Profissional a', 'Profissional b', 'Profissional c']) assert.ok(cardNames(app).some(card => card.includes(name)), name);
    assert.equal(cardNames(app).length, 4);
    assert.equal(tabCount(app, 'all'), 4);
    assert.equal(tabCount(app, 'invited'), 1);
    assert.match(app.html(), /Convite enviado · Aguardando resposta/);
    assert.equal(app.calls.filter(call => call.name === 'invite_demand_worker').length, 1);
    assert.equal(app.calls.some(call => call.name === 'approve_demand_candidate'), false);
  } finally { app.close(); }
});

test('talent empty search state clears criteria and private reputation never becomes zero operations', async () => {
  const app = mount(talentFile, { data: { ...fixture(), applications: [], reserves: [] }, talentRows: [talent('private', { review_count: null, completed_operations: 3 })] });
  try {
    await app.flush();
    assert.match(app.html(), /Operações: sem dados compartilhados/);
    assert.match(app.html(), /Avaliações privadas/);
    assert.doesNotMatch(app.html(), />0 operações concluídas</);
    app.elements().find(node => node.props?.type === 'search').props.onChange({ target: { value: 'impossível' } });
    await app.flush();
    assert.equal(cardNames(app).length, 0);
    assert.equal(tabCount(app, 'all'), 0);
    assert.match(app.html(), /Nenhum profissional encontrado para os critérios atuais/);
    app.find('Limpar filtros').props.onClick(); await app.flush();
    assert.equal(cardNames(app).length, 1);
  } finally { app.close(); }
});

test('remote acceptance refreshes on focus and interval without hiring or changing RPC arguments', async () => {
  for (const refresh of ['focus', 'timer']) {
    const data = { ...fixture(), applications: [], reserves: [] };
    const invitations = [{ demand_id: 'operation', worker_id: 'a', status: 'pending' }];
    const app = mount(talentFile, { data, invitations, talentRows: [talent('a')] });
    try {
      await app.flush();
      assert.equal(app.find('Confirmar contratação'), undefined);
      invitations[0].status = 'accepted';
      data.applications.push({ job_id: 'job2', worker_id: 'a', status: 'pending' });
      if (refresh === 'focus') app.focus(); else app.tick(30_000);
      await app.flush();
      assert.match(app.html(), /Convite aceito · Pronto para avaliação/);
      assert.ok(app.find('Avaliar candidatura'));
      assert.ok(app.find('Confirmar contratação'));
      assert.equal(app.calls.filter(call => call.name === 'restaurant_talent_directory').length, 2);
      assert.equal(app.calls.some(call => call.name === 'approve_demand_candidate'), false);
    } finally { app.close(); }
  }
});

test('talent hiring failure is inside confirmation and retry reuses the explicit approval action', async () => {
  const data = { ...fixture(), applications: [{ job_id: 'job2', worker_id: 'a', status: 'pending' }] };
  const failures = ['approve_demand_candidate'];
  const app = mount(talentFile, { data, talentRows: [talent('a')], rpcFailures: failures });
  try {
    await app.flush();
    app.find('Confirmar contratação').props.onClick(); await app.flush();
    const confirmation = () => app.elements().filter(node => node.props?.children === 'Confirmar contratação').at(-1);
    await confirmation().props.onClick(); await app.flush();
    const modal = app.html().split('aria-labelledby="approve-heading"')[1].split('</dialog>')[0];
    assert.match(modal, /role="alert"/);
    assert.match(modal, /Não foi possível concluir a contratação/);
    assert.match(modal, /Serviço indisponível/);
    assert.doesNotMatch(app.html().split('aria-labelledby="approve-heading"')[0], /role="alert"/);
    failures.pop();
    await app.find('Tentar novamente').props.onClick(); await app.flush();
    assert.match(app.html(), /Contratação concluída/);
    assert.equal(app.calls.filter(call => call.name === 'approve_demand_candidate').length, 2);
  } finally { app.close(); }
});

test('directory recovery removes its residual error on focus and automatic refresh', async () => {
  for (const refresh of ['focus', 'timer']) {
    const failures = ['restaurant_talent_directory'];
    const app = mount(talentFile, { data: { ...fixture(), applications: [], reserves: [] }, talentRows: [talent('a')], rpcFailures: failures });
    try {
      await app.flush();
      assert.match(app.html(), /role="alert"/);
      assert.equal(cardNames(app).length, 0);
      failures.pop();
      if (refresh === 'focus') app.focus(); else app.tick(30_000);
      await app.flush();
      assert.equal(cardNames(app).length, 1);
      assert.doesNotMatch(app.html(), /role="alert"|Não foi possível carregar os talentos|Serviço indisponível/);
    } finally { app.close(); }
  }
});

test('retry after cancelling a failed hire reopens confirmation and never hires until explicit confirmation', async () => {
  const data = { ...fixture(), applications: [{ job_id: 'job2', worker_id: 'a', status: 'pending' }] };
  data.jobs.push({ ...data.jobs[2], id: 'other-job', demand_id: 'other-operation', title: 'Outra operação' });
  const failures = ['approve_demand_candidate'];
  const app = mount(talentFile, { data, talentRows: [talent('a')], rpcFailures: failures });
  try {
    await app.flush();
    app.find('Confirmar contratação').props.onClick(); await app.flush();
    await app.elements().filter(node => node.props?.children === 'Confirmar contratação').at(-1).props.onClick(); await app.flush();
    assert.match(app.html(), /Não foi possível concluir a contratação/);
    app.find('Voltar').props.onClick(); await app.flush();
    assert.doesNotMatch(app.html(), /aria-labelledby="approve-heading"/);
    app.tick(30_000); await app.flush();
    assert.match(app.html(), /Não foi possível concluir a contratação/);
    window.location = { href: 'http://localhost/restaurant/candidates' };
    window.history = { replaceState() {} };
    app.elements().find(node => node.props?.id === 'talent-operation').props.onChange({ target: { value: 'other-operation' } });
    await app.flush();
    const count = app.calls.filter(call => call.name === 'approve_demand_candidate').length;
    failures.pop();
    await app.find('Tentar novamente').props.onClick(); await app.flush();
    assert.match(app.html(), /aria-labelledby="approve-heading"/);
    assert.equal(app.elements().find(node => node.props?.id === 'talent-operation').props.value, 'operation');
    assert.equal(app.calls.filter(call => call.name === 'approve_demand_candidate').length, count);
    assert.equal(data.applications[0].status, 'pending');
    await app.elements().filter(node => node.props?.children === 'Confirmar contratação').at(-1).props.onClick(); await app.flush();
    assert.equal(app.calls.filter(call => call.name === 'approve_demand_candidate').length, count + 1);
    assert.deepEqual(app.calls.filter(call => call.name === 'approve_demand_candidate').at(-1).args, { p_demand_id: 'operation', p_worker_id: 'a' });
    assert.equal(data.applications[0].status, 'approved');
    assert.match(app.html(), /Contratação concluída/);
  } finally { app.close(); }
});

test('successful directory refresh does not erase unrelated invitation errors', async () => {
  const app = mount(talentFile, {
    data: { ...fixture(), applications: [], reserves: [] },
    talentRows: [talent('a')],
    rpcFailures: ['invite_demand_worker'],
  });
  try {
    await app.flush();
    await app.find('Convidar para operação').props.onClick(); await app.flush();
    assert.match(app.html(), /Não foi possível enviar o convite/);
    app.focus(); await app.flush();
    assert.equal(cardNames(app).length, 1);
    assert.match(app.html(), /Não foi possível enviar o convite/);
    assert.match(app.html(), /role="alert"/);
  } finally { app.close(); }
});

test('last vacancy keeps successful hiring context and links to the actually approved job, team and operation', async () => {
  const data = fixture();
  data.jobs = [{ ...data.jobs[0], status: 'open' }];
  data.applications = [{ job_id: 'job0', worker_id: 'a', status: 'pending' }];
  const app = mount(talentFile, { data, talentRows: [talent('a')] });
  try {
    await app.flush();
    app.find('Confirmar contratação').props.onClick(); await app.flush();
    await app.elements().filter(node => node.props?.children === 'Confirmar contratação').at(-1).props.onClick(); await app.flush();
    assert.match(app.html(), /Contratação concluída/);
    for (const href of ['/restaurant/team', '/restaurant/demands/operation', '/chat/job0']) assert.ok(app.html().includes(`href="${href}"`), href);
    assert.doesNotMatch(app.html(), /Nenhuma operação ativa/);
    assert.deepEqual(app.calls.find(call => call.name === 'approve_demand_candidate').args, { p_demand_id: 'operation', p_worker_id: 'a' });
  } finally { app.close(); }
});

test('talent invitation errors retry the invitation without approving, and optional detail failures are warnings', async () => {
  for (const kind of ['invite', 'reviews', 'history']) {
    const failures = [kind === 'invite' ? 'invite_demand_worker' : `restaurant_talent_${kind}`];
    const app = mount(talentFile, { data: { ...fixture(), applications: [], reserves: [] }, talentRows: [talent('a', { restaurant_operations: 2, review_count: 4 })], rpcFailures: failures });
    try {
      await app.flush();
      if (kind === 'invite') {
        await app.find('Convidar para operação').props.onClick(); await app.flush();
        assert.match(app.html(), /Não foi possível enviar o convite/);
        failures.pop();
        await app.find('Tentar novamente').props.onClick(); await app.flush();
        assert.match(app.html(), /Convite enviado/);
      } else {
        app.find('Ver perfil').props.onClick(); await app.flush();
        const button = app.elements().find(node => typeof node.props?.children === 'string' && node.props.children.startsWith(kind === 'reviews' ? 'Ver todas avaliações' : 'Ver histórico'));
        await button.props.onClick(); await app.flush();
        assert.match(app.html(), /ec-toast--warning/);
        assert.ok(app.find(kind === 'reviews' ? 'Recarregar avaliações' : 'Recarregar histórico'));
      }
      assert.equal(app.calls.some(call => call.name === 'approve_demand_candidate'), false);
    } finally { app.close(); }
  }
});

test('an open detail screen stops inviting at cutoff and stops ordinary hiring at start without losing candidates', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T04:59:59-03:00') });
  const data = fixture();
  data.jobs = [{ ...data.jobs[2],job_date:'2026-11-12',created_at:'2026-11-11T00:00:00-03:00' }];
  data.applications = data.applications.filter(application => application.job_id==='job2');
  const app = mount(detailFile,{data});
  try {
    await app.flush();
    assert.ok(app.find('Contratar'));
    app.find('Contratar').props.onClick(); await app.flush();
    assert.equal(app.find('Confirmar Contratação').props.disabled,false);
    assert.match(app.html(),/>Convidar profissionais</);
    t.mock.timers.setTime(new Date('2026-11-12T05:00:00-03:00').getTime());
    app.tick(); await app.flush();
    assert.ok(app.find('Contratar'));
    assert.doesNotMatch(app.html(),/>Convidar profissionais</);
    assert.match(app.html(),/Recrutamento encerrado/);
    t.mock.timers.setTime(new Date('2026-11-12T10:00:00-03:00').getTime());
    app.tick(); await app.flush();
    assert.equal(app.find('Contratar'),undefined);
    assert.equal(app.find('Confirmar Contratação').props.disabled,true);
    assert.match(app.html(),/Profissional c4|Candidatos/);
    assert.equal(app.calls.filter(call => call.name==='approve_demand_candidate').length,0);
  } finally { app.close(); }
});

test('closed recruiting disables invitations but retains relationship controls', async () => {
  const app = mount('../app/components/demand-talent-network.tsx',{canInvite:false,people:[person('one')]});
  try {
    await app.flush();
    assert.equal(app.find('Recrutamento encerrado').props.disabled,true);
    const category = app.elements().filter(item => item.type===ui.Button && item.props.children==='Favoritos')[1];
    await category.props.onClick(); await app.flush();
    assert.ok(app.calls.some(call => call.name==='set_talent_connection'));
    assert.equal(app.calls.some(call => call.name==='invite_demand_worker'),false);
  } finally { app.close(); }
});

test('detail helpers deduplicate latest candidates, calculate exact progress and validate map coordinates', () => {
  const data = fixture(), demand = domain.buildDemands(data.jobs, data.applications, data.reserves)[0];
  assert.deepEqual(helpers.uniqueDemandCandidates(demand).map(item => item.worker_id), ['c4', 'c3', 'c2', 'c1']);
  for (const [hired, expected] of [[0, 0], [1, 25], [3, 75], [4, 100], [5, 100]]) assert.equal(helpers.demandProgress({ ...demand, hired }), expected);
  assert.match(helpers.demandMapLinks(demand).map, /openstreetmap/);
  demand.job.work_latitude = 95;
  assert.equal(helpers.demandMapLinks(demand).map, null);
  assert.match(helpers.demandMapLinks(demand).route, /Rua%20A/);
});

test('detail shows real people and requires hiring confirmation without changing candidate selection', async () => {
  const data = fixture();
  data.applications = data.applications.filter(application => application.status === 'pending');
  const app = mount(detailFile, { data });
  try {
    app.render(); assert.match(app.html(), /Carregando operação/);
    await app.flush();
    const html = app.html();
    for (const text of ['Status atual', 'Informações administrativas', 'Candidatos', 'Linha do tempo', 'Uniforme preto', 'R$ 150,00', '4,7 / 5', 'Contratar', 'Pagamento', 'Check-in', 'Checkout']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /posições preenchidas|<progress|id="reserve-heading"|Adicionar à reserva/);
    const recent = html.split('id="candidates-heading"')[1];
    for (const id of ['c4', 'c3', 'c2']) assert.ok(recent.includes(`Profissional ${id}`));
    assert.ok(!recent.includes('Profissional c1'));
    assert.equal((recent.match(/>Contratar</g) || []).length, 3);
    assert.doesNotMatch(html, /<iframe|94|Pagamento confirmado|<table/);
    app.find('Carregar mapa').props.onClick(); await app.flush();
    assert.match(app.html(), /<iframe/);
    await app.find('Contratar').props.onClick(); await app.flush();
    assert.equal(app.calls.some(call=>call.name==='approve_demand_candidate'),false);
    assert.match(app.html(), /Confirmar Contratação/);
    await app.find('Confirmar Contratação').props.onClick(); await app.flush();
    assert.ok(app.calls.some(call=>call.name==='approve_demand_candidate' && call.args.p_worker_id==='c4'));
    assert.match(app.html(), /Profissional contratado\./);
    assert.match(app.html(), /Profissional da Operação/);
    assert.doesNotMatch(app.html(), /id="candidates-heading"/);
  } finally { app.close(); }
});

test('detail failures remain explicit and optional history/profile failure never hides operational data', async () => {
  for (const options of [{ coreFailure: true }, { historyFailure: true, profileFailure: true }]) {
    const app = mount(detailFile, options);
    try {
      await app.flush();
      if (options.coreFailure) { assert.match(app.html(), /Não foi possível carregar esta operação/); assert.ok(app.find('Tentar Novamente')); }
      else {
        assert.match(app.html(), /Não foi possível carregar a linha do tempo/);
        assert.match(app.html(), /Não foi possível carregar os perfis/);
        assert.match(app.html(), /Profissional da Operação/);
      }
    } finally { app.close(); }
  }
});

test('empty and complete candidate views are full pages; talent profile lookup is not limited to applicants', async () => {
  for (const [options, expected] of [
    [{ data: { ...fixture(), applications: [], reserves: [] } }, 'Nenhum candidato ainda'],
    [{ params: 'view=candidates' }, 'Profissional c1'],
    [{ params: 'view=profile&person=new', people: [person('new')] }, 'Profissional new'],
  ]) {
    const app = mount(detailFile, options);
    try {
      await app.flush(); assert.ok(app.html().includes(expected));
      if (options.params?.includes('profile')) assert.equal(app.calls[0].args.p_participants_only, false);
    } finally { app.close(); }
  }
});

test('detail prioritizes the existing flow and presents hired professionals without the candidate list', async () => {
  const app = mount(detailFile, { assignments: [
    { job_id: 'job0', worker_id: 'h1', checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null },
    { job_id: 'job1', worker_id: 'h2', checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null },
  ] });
  try {
    await app.flush();
    const html = app.html();
    const summary = html.indexOf('aria-labelledby="summary-heading"');
    const flow = html.indexOf('aria-labelledby="operation-flow-heading"');
    const people = html.indexOf('aria-labelledby="people-heading"');
    assert.ok(summary < flow && flow < people);
    const participants = html.slice(people);
    assert.doesNotMatch(participants, /id="candidates-heading"|Profissional c[1-4]|>Contratar</);
    assert.match(participants, /id="hired-heading"/);
    assert.match(participants, /Profissional da Operação/);
    for (const id of ['h1', 'h2']) assert.ok(participants.includes(`Profissional ${id}`));
    assert.doesNotMatch(html, />Contratados</);
    assert.equal((html.match(/<dt[^>]*>Equipe Confirmada<\/dt>/g) ?? []).length, 1);
    assert.equal((html.match(/href="\/restaurant\/demands\/operation\?view=talents"/g) ?? []).length, 0);
    for (const id of ['job0', 'job1']) {
      assert.equal((html.match(new RegExp(`href="/chat/${id}"`, 'g')) ?? []).length, 1);
      assert.equal((html.match(new RegExp(`href="/checkin/${id}"`, 'g')) ?? []).length, 1);
    }
    assert.ok(app.find('Atualizar operação'));
    assert.ok(app.find('Compartilhar Operação'));
    assert.doesNotMatch(html, /pointer-events-none fixed|O que fazer agora/);
    assert.match(html, /Valor da diária/);
    assert.match(html, /dateTime="2099-11-12"/i);
    assert.match(html, /Local da Operação/);
    assert.match(html, /<address[^>]*>.*Rua A, 123.*São Paulo \/ SP/);
    assert.match(html, /https:\/\/www.google.com\/maps\/dir\/\?api=1/);
  } finally { app.close(); }
});

test('one-vacancy operation switches from candidates to its selected professional without changing data', async () => {
  for (const status of [null, 'approved', 'in_progress', 'completed']) {
    const data = fixture();
    data.jobs = [{ ...data.jobs[0], status: status ? 'filled' : 'open' }];
    data.applications = [
      { job_id: 'job0', worker_id: 'c1', status: 'pending' },
      ...(status ? [{ job_id: 'job0', worker_id: 'h1', status }] : []),
    ];
    const original = structuredClone(data);
    const app = mount(detailFile, { data });
    try {
      await app.flush();
      const html = app.html();
      const section = html.slice(html.indexOf('id="team-heading"'));
      if (status) {
        assert.match(section, /Profissional da Operação/);
        assert.match(section, /Profissional h1/);
        assert.doesNotMatch(section, /Profissional c1|id="candidates-heading"|>Contratar</);
        assert.equal((section.match(/<article\b/g) ?? []).length, 1);
      } else {
        assert.match(section, /id="people-heading"[^>]*>Candidatos</);
        assert.match(section, /Profissional c1/);
        assert.doesNotMatch(section, /Profissional h1|id="hired-heading"/);
      }
      assert.doesNotMatch(html, />Contratados</);
      assert.equal((html.match(/<dt[^>]*>Equipe Confirmada<\/dt>/g) ?? []).length, 1);
      assert.deepEqual(data, original);
      assert.equal(app.calls.some(call => ['approve_demand_candidate', 'set_demand_reserve', 'invite_demand_worker'].includes(call.name)), false);
    } finally { app.close(); }
  }
});

test('detail highlights existing payment, receipt, checkout and review responsibilities before administrative data', async () => {
  for (const [changes, text, responsible] of [
    [{}, 'Aguardando pagamento', 'Restaurante · confirmar pagamento'],
    [{ paid_at: '2026-01-01T22:00:00Z' }, 'Aguardando confirmação de recebimento', 'Profissional confirma recebimento; restaurante acompanha'],
    [{ paid_at: '2026-01-01T22:00:00Z', receipt_confirmed_at: '2026-01-01T22:01:00Z' }, 'Recebimento confirmado. Checkout liberado.', 'Restaurante gera código; profissional realiza checkout'],
    [{ payment_disputed_at: '2026-01-01T22:00:00Z' }, 'Pagamento não recebido', 'Restaurante · regularizar pagamento'],
  ]) {
    const data = fixture();
    data.jobs = data.jobs.map(job => ({ ...job, job_date: '2026-01-01' }));
    const assignments = [{ job_id: 'job0', worker_id: 'h1', checkin_at: '2026-01-01T12:00:00Z',
      paid_at: null, receipt_confirmed_at: null, checkout_at: null, ...changes },
    { job_id: 'job1', worker_id: 'h2', checkin_at: '2026-01-01T12:00:00Z',
      paid_at: '2026-01-02T03:00:00Z', receipt_confirmed_at: '2026-01-02T03:01:00Z', checkout_at: '2026-01-02T03:02:00Z' }];
    const app = mount(detailFile, { data, assignments });
    try {
      await app.flush();
      const html = app.html();
      const summary = html.slice(html.indexOf('aria-labelledby="summary-heading"'), html.indexOf('aria-labelledby="presence-heading"'));
      assert.ok(summary.includes(text), text);
      assert.ok(summary.includes(responsible), responsible);
      assert.match(summary, /ec-badge--warning/);
      assert.ok(html.indexOf('Próxima ação:') < html.indexOf('Valor da diária'));
      if (changes.receipt_confirmed_at) assert.match(summary, /Gerar código de Checkout/);
      assert.equal(app.calls.some(call => ['record_operational_payment', 'validate_operational_code'].includes(call.name)), false);
    } finally { app.close(); }
  }
  const data = fixture();
  data.jobs = [{ ...data.jobs[0], job_date: '2026-01-01', status: 'completed' }];
  data.applications = [{ job_id: 'job0', worker_id: 'h1', status: 'completed' }];
  const app = mount(detailFile, { data, assignments: [{
    job_id: 'job0', worker_id: 'h1', checkin_at: '2026-01-01T13:00:00Z',
    paid_at: '2026-01-02T03:00:00Z', receipt_confirmed_at: '2026-01-02T03:01:00Z', checkout_at: '2026-01-02T03:02:00Z',
  }], reviews: [{ job_id: 'job0' }] });
  try {
    await app.flush();
    const html = app.html();
    assert.match(html, /Avaliação pendente/);
    assert.match(html, /Restaurante · avaliar profissional/);
    assert.match(html, /href="\/reviews\/job0"/);
  } finally { app.close(); }
});

test('status and action precede stages, team and secondary administrative context without duplicating history', async () => {
  const created = { id: 'created', kind: 'created', worker_id: null, occurred_at: '2026-01-01T12:00:00Z' };
  const hired = { id: 'hired', kind: 'hired', worker_id: 'h1', occurred_at: '2026-01-02T12:00:00Z' };
  for (const history of [[], [created], [hired], [created, hired]]) {
    const app = mount(detailFile, { history });
    try {
      await app.flush();
      const html = app.html();
      const summary = html.slice(html.indexOf('aria-labelledby="summary-heading"'), html.indexOf('aria-labelledby="operation-flow-heading"'));
      const admin = html.slice(html.indexOf('aria-labelledby="administrative-heading"'));
      for (const text of ['Local da Operação', 'Rua A, 123', 'São Paulo / SP', 'Abrir rota', 'Observações', 'Uniforme preto']) {
        assert.ok(admin.includes(text), text);
        assert.ok(!summary.includes(text), text);
      }
      for (const text of ['Status atual', 'Responsável:', 'Próxima ação:', 'Agenda:', 'Quando agir:', 'Resumo Operacional', 'Ação Necessária', 'Central de Presença', 'Próxima Etapa']) assert.ok(summary.includes(text), text);
      assert.ok(html.indexOf('aria-labelledby="administrative-heading"') > html.indexOf('aria-labelledby="people-heading"'));
      assert.equal((html.match(/aria-labelledby="location-heading"/g) ?? []).length, 1);
      assert.equal((html.match(/aria-labelledby="notes-heading"/g) ?? []).length, 1);
      assert.equal((html.match(/aria-labelledby="timeline-heading"/g) ?? []).length, 1);
      const separate = history.length > 1 || history[0]?.kind === 'hired';
      assert.equal(admin.includes('aria-labelledby="timeline-heading"'), !separate);
      if (separate) assert.ok(html.indexOf('aria-labelledby="timeline-heading"') > html.indexOf('aria-labelledby="people-heading"'));
      for (const event of history) assert.ok(html.includes(`dateTime="${event.occurred_at}"`));
      if (!history.length) assert.match(admin, /Nenhum evento registrado/);
    } finally { app.close(); }
  }
});

function completedOperation() {
  const data = fixture();
  data.jobs = [{ ...data.jobs[0], job_date: '2026-01-01', status: 'completed' }];
  data.applications = [{ job_id: 'job0', worker_id: 'h1', status: 'completed' }];
  return { data, assignments: [{
    job_id: 'job0', worker_id: 'h1', checkin_at: '2026-01-01T13:00:00Z',
    paid_at: '2026-01-02T03:00:00Z', receipt_confirmed_at: '2026-01-02T03:01:00Z',
    checkout_at: '2026-01-02T03:02:00Z', interruption: null,
  }] };
}

test('H02-001: failed pending reviews make the operational core unavailable', async () => {
  const app = mount(detailFile, { ...completedOperation(), reviewFailure: { value: true } });
  try {
    await app.flush();
    assert.match(app.html(), /Estado operacional indisponível/);
    assert.match(app.html(), /Não foi possível conferir as avaliações pendentes/);
    assert.equal(app.reviewLoads.length, 1);
    assert.ok(app.find('Recarregar dados operacionais'));
  } finally { app.close(); }
});

test('H02-002: focus and timer partial refresh preserve the review error without consulting reviews', async () => {
  const failure = { value: true };
  const app = mount(detailFile, { ...completedOperation(), reviewFailure: failure });
  try {
    await app.flush();
    failure.value = false;
    for (const refresh of [() => app.focus(), () => app.tick(15_000)]) {
      refresh(); await app.flush();
      assert.equal(app.reviewLoads.length, 1);
      assert.match(app.html(), /Estado operacional indisponível/);
      assert.match(app.html(), /Não foi possível conferir as avaliações pendentes/);
    }
  } finally { app.close(); }
});

test('H02-003: a full retry that fails reviews again does not clear the review error', async () => {
  const app = mount(detailFile, { ...completedOperation(), reviewFailure: { value: true } });
  try {
    await app.flush();
    app.find('Recarregar dados operacionais').props.onClick(); await app.flush();
    assert.equal(app.reviewLoads.length, 2);
    assert.ok(app.reviewLoads.every(load => load.failed));
    assert.match(app.html(), /Estado operacional indisponível/);
    assert.match(app.html(), /Não foi possível conferir as avaliações pendentes/);
    app.focus(); await app.flush();
    assert.match(app.html(), /Estado operacional indisponível/);
  } finally { app.close(); }
});

test('H02-004: only a successful full review reload clears the error and restores the review action', async () => {
  for (const reviews of [[], [{ job_id: 'job0' }]]) {
    const failure = { value: true };
    const app = mount(detailFile, { ...completedOperation(), reviewFailure: failure, reviews });
    try {
      await app.flush();
      failure.value = false;
      app.find('Recarregar dados operacionais').props.onClick(); await app.flush();
      assert.deepEqual(app.reviewLoads.map(load => load.failed), [true, false]);
      assert.doesNotMatch(app.html(), /Estado operacional indisponível|Não foi possível conferir as avaliações pendentes/);
      const html = app.html();
      const primary = html.slice(html.indexOf('aria-labelledby="pending-heading"'), html.indexOf('aria-labelledby="presence-heading"'));
      assert.match(primary, /Encerrar acompanhamento/);
      assert.match(primary, reviews.length ? /href="\/reviews\/job0"/ : /#timeline-heading/);
    } finally { app.close(); }
  }
});

test('H02-005: an unresolved review source blocks closing follow-up after partial refresh', async () => {
  const app = mount(detailFile, { ...completedOperation(), reviewFailure: { value: true } });
  try {
    await app.flush();
    app.focus(); await app.flush();
    app.tick(15_000); await app.flush();
    const html = app.html();
    const primary = html.slice(html.indexOf('aria-labelledby="pending-heading"'), html.indexOf('aria-labelledby="presence-heading"'));
    assert.match(primary, /Atualizar operação/);
    assert.doesNotMatch(primary, /Encerrar acompanhamento|Ver conclusão|<a /);
    assert.doesNotMatch(html, />Finalizada</);
    assert.equal(app.reviewLoads.length, 1);
  } finally { app.close(); }
});

test('H-01 integration: active incomplete operation shares an executable recommendation across Action Center and continuation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T15:00:00Z') });
  const data = fixture();
  data.jobs = data.jobs.slice(0, 2).map((job, index) => ({
    ...job, job_date: '2026-11-05', start_time: '10:00:00', end_time: '18:00:00', status: index ? 'open' : 'filled',
  }));
  data.applications = [{ job_id: 'job0', worker_id: 'h1', status: 'in_progress' }];
  const app = mount(detailFile, { data, assignments: [{
    job_id: 'job0', worker_id: 'h1', checkin_at: '2026-11-05T13:00:00Z',
    paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null,
  }] });
  try {
    await app.flush();
    const html = app.html();
    const primary = html.slice(html.indexOf('aria-labelledby="pending-heading"'), html.indexOf('aria-labelledby="presence-heading"'));
    const continuation = html.slice(html.indexOf('aria-labelledby="continuation-heading"'), html.indexOf('aria-labelledby="operation-flow-heading"'));
    assert.match(html, />Em andamento</);
    assert.match(primary, /Próxima ação: Acompanhar operação/);
    assert.match(primary, /href="\/restaurant\/demands\/operation#operation-flow-heading"/);
    assert.doesNotMatch(primary, /Completar equipe|Contratar profissionais|\?view=(talents|candidates)/);
    assert.match(continuation, /No término da agenda/);
    assert.equal((primary.match(/<a /g) ?? []).length, 1);
    assert.equal(app.calls.some(call => call.name === 'approve_demand_candidate'), false);
  } finally { app.close(); }
});

test('operation core refresh changes one primary action and preserves the five-block hierarchy without mutations', async () => {
  const data = fixture();
  data.jobs = [{ ...data.jobs[0], job_date: '2026-01-01' }];
  data.applications = [{ job_id: 'job0', worker_id: 'h1', status: 'approved' }];
  const assignments = [{ job_id: 'job0', worker_id: 'h1', checkin_at: null,
    paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null }];
  const app = mount(detailFile, { data, assignments });
  try {
    await app.flush();
    const headings = ['summary-heading', 'operational-summary-heading', 'pending-heading', 'presence-heading', 'continuation-heading'];
    const initial = app.html();
    const positions = headings.map(id => initial.indexOf(`aria-labelledby="${id}"`));
    assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
    const action = () => {
      const html = app.html();
      return html.slice(html.indexOf('aria-labelledby="pending-heading"'), html.indexOf('aria-labelledby="presence-heading"'));
    };
    assert.match(action(), /Realizar check-ins/);
    assert.equal((action().match(/<a /g) ?? []).length, 1);
    assignments[0].checkin_at = '2026-01-01T13:00:00Z';
    app.tick(15_000); await app.flush();
    assert.match(action(), /Regularizar pagamentos/);
    assert.match(action(), /href="\/payment\/job0"/);
    assignments[0].paid_at = '2026-01-02T03:00:00Z';
    app.focus(); await app.flush();
    assert.match(action(), /Profissional confirma recebimento/);
    assignments[0].receipt_confirmed_at = '2026-01-02T03:01:00Z';
    app.tick(15_000); await app.flush();
    assert.match(action(), /Finalizar participantes/);
    assert.match(action(), /href="\/checkout\/job0"/);
    assignments[0].checkout_at = '2026-01-02T03:02:00Z';
    app.tick(15_000); await app.flush();
    assert.match(action(), /Encerrar acompanhamento/);
    assert.match(app.html(), /Finalizados \(1\)/);
    assert.equal((action().match(/<a /g) ?? []).length, 1);
    assert.equal(app.calls.some(call => ['approve_demand_candidate', 'record_operational_payment',
      'validate_operational_code', 'manage_operation_interruption'].includes(call.name)), false);
  } finally { app.close(); }
});

test('operation core renders unavailable instead of zero or completion and recovers after focus refresh', async () => {
  const data = fixture();
  data.jobs = [{ ...data.jobs[0] }];
  data.applications = [{ job_id: 'job0', worker_id: 'h1', status: 'approved' }];
  const assignments = [];
  const failure = { value: false };
  const app = mount(detailFile, { data, assignments, assignmentFailure: failure });
  try {
    await app.flush();
    const metrics = () => {
      const html = app.html();
      return html.slice(html.indexOf('aria-labelledby="operational-summary-heading"'), html.indexOf('aria-labelledby="pending-heading"'));
    };
    assert.equal((metrics().match(/>Indisponível<\/dd>/g) ?? []).length, 5);
    assert.doesNotMatch(metrics(), />0<\/dd>/);
    assignments.push({ job_id: 'job0', worker_id: 'h1', checkin_at: null,
      paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null });
    app.focus(); await app.flush();
    assert.match(metrics(), /Equipe Confirmada<\/dt><dd[^>]*>1<\/dd>/);
    assert.match(metrics(), /Presentes<\/dt><dd[^>]*>0<\/dd>/);
    failure.value = true;
    app.focus(); await app.flush();
    assert.match(app.html(), /Estado operacional indisponível/);
    assert.equal((metrics().match(/>Indisponível<\/dd>/g) ?? []).length, 5);
    assert.doesNotMatch(metrics(), /Equipe Confirmada<\/dt><dd[^>]*>1<\/dd>/);
    failure.value = false;
    app.focus(); await app.flush();
    assert.match(metrics(), /Equipe Confirmada<\/dt><dd[^>]*>1<\/dd>/);
    assert.doesNotMatch(metrics(), /Indisponível<\/dd>/);
  } finally { app.close(); }
});

test('operation core presence separates a confirmed historical absence from the active replacement', async () => {
  const data = fixture();
  data.jobs = [{ ...data.jobs[0], job_date: '2026-01-01' }];
  data.applications = [
    { job_id: 'job0', worker_id: 'h1', status: 'absent' },
    { job_id: 'job0', worker_id: 'h2', status: 'approved' },
  ];
  const assignments = [
    { job_id: 'job0', worker_id: 'h1', checkin_at: null, paid_at: null, receipt_confirmed_at: null,
      checkout_at: null, interruption: 'absent', interrupted_at: '2026-01-01T13:10:00Z' },
    { job_id: 'job0', worker_id: 'h2', checkin_at: '2026-01-01T13:05:01Z',
      paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null },
  ];
  const app = mount(detailFile, { data, assignments: [...assignments, { ...assignments[1] }] });
  try {
    await app.flush();
    const html = app.html();
    const presence = html.slice(html.indexOf('aria-labelledby="presence-heading"'), html.indexOf('aria-labelledby="continuation-heading"'));
    assert.match(presence, /Atrasados \(1\)/);
    assert.match(presence, /Ausentes \(1\)/);
    assert.match(presence, /Presentes \(0\)/);
    assert.match(presence, /Pendentes \(0\)/);
    assert.equal((presence.match(/Profissional h1/g) ?? []).length, 1);
    assert.equal((presence.match(/Profissional h2/g) ?? []).length, 1);
    assert.match(html, /Equipe Confirmada<\/dt><dd[^>]*>1<\/dd>/);
    assert.match(html, /Ausências Confirmadas<\/dt><dd[^>]*>1<\/dd>/);
  } finally { app.close(); }
});

test('empty participants stay compact and whitespace-only notes have an explicit empty state', async () => {
  const data = fixture();
  data.applications = [];
  data.reserves = [];
  data.jobs = data.jobs.map(job => ({ ...job, description: ' \n  ' }));
  const app = mount(detailFile, { data });
  try {
    await app.flush();
    const html = app.html();
    assert.match(html, /Nenhum candidato ainda/);
    assert.doesNotMatch(html, /id="hired-heading"|>Contratados</);
    assert.equal((html.match(/<dt[^>]*>Equipe Confirmada<\/dt>/g) ?? []).length, 1);
    assert.match(html, /Nenhuma observação adicionada\./);
    assert.match(html, /Compartilhar Operação/);
    assert.match(html, /Ver todos \(0\)/);
    assert.doesNotMatch(html, /ec-empty|href="\/(?:checkin|payment|checkout|chat)\//);
    assert.equal((html.match(/>Convidar profissionais</g) ?? []).length, 1);
    assert.match(html, /Aguardando contratação/);
    assert.match(html, /Chat bloqueado/);
    assert.equal(app.calls.some(call => ['approve_demand_candidate', 'set_demand_reserve', 'invite_demand_worker'].includes(call.name)), false);
  } finally { app.close(); }
});

test('talent network filters real categories/recurrence and persists invitations without automatic hiring', async () => {
  const app = mount('../app/components/demand-talent-network.tsx', { people: [person('one', { categories: ['favorite'] }), person('two', { completed_operations: 2 })] });
  try {
    await app.flush();
    app.find('Recorrentes').props.onClick(); await app.flush();
    assert.match(app.html(), /Profissional two/); assert.doesNotMatch(app.html(), /Profissional one/);
    await app.find('Convidar para operação').props.onClick(); await app.flush();
    assert.ok(app.calls.some(call=>call.name==='invite_demand_worker' && call.args.p_worker_id==='two'));
    assert.match(app.html(), /não uma contratação automática/);
    app.find('Favoritos').props.onClick(); await app.flush();
    assert.match(app.html(), /Profissional one/);
    const category = app.elements().filter(item=>item.type===ui.Button && item.props.children==='Favoritos')[1];
    await category.props.onClick(); await app.flush();
    assert.ok(app.calls.some(call=>call.name==='set_talent_connection' && call.args.p_enabled===false));
  } finally { app.close(); }
});

test('worker accepts or declines real invitations and failures never display success', async () => {
  for (const [action, rpcFailure] of [['Aceitar convite', false], ['Recusar', false], ['Aceitar convite', true]]) {
    const app = mount('../app/worker/invitations/page.tsx', { rpcFailure, invitations: [{ id: 'invite', title: 'Garçom Extra', job_date: '2099-11-12', start_time: '18:00', end_time: '23:00', value: 150, status: 'pending', can_accept: true, is_replacement: false, expires_at: '2099-11-12T18:00:00-03:00' }] });
    try {
      await app.flush();
      await app.find(action).props.onClick(); await app.flush();
      if (rpcFailure) { assert.match(app.html(), /Serviço indisponível/); assert.doesNotMatch(app.html(), /Convite aceito/); }
      else {
        assert.ok(app.calls.some(call=>call.name==='respond_demand_invitation' && call.args.p_accept===(action==='Aceitar convite')));
        assert.match(app.html(), action==='Aceitar convite' ? /aguarda a aprovação da empresa/ : /Convite recusado/);
      }
    } finally { app.close(); }
  }
});

test('ended operations cannot approve or reserve; failed hire retains the candidate and surfaces the error', async () => {
  const ended = fixture();
  ended.jobs = ended.jobs.map(job => ({ ...job, job_date: '2000-01-01' }));
  const unfilled = fixture();
  unfilled.applications = unfilled.applications.filter(application => application.status === 'pending');
  for (const options of [{ data: ended }, { data: unfilled, rpcFailure: true }]) {
    const app = mount(detailFile, options);
    try {
      await app.flush();
      if (!options.rpcFailure) {
        assert.equal(app.find('Contratar'), undefined);
        assert.equal(app.find('Adicionar à reserva'), undefined);
        assert.match(app.html(), /Estado operacional indisponível/);
      } else {
        await app.find('Contratar').props.onClick(); await app.flush();
        await app.find('Confirmar Contratação').props.onClick(); await app.flush();
        assert.match(app.html(), /Serviço indisponível/);
        assert.match(app.html(), /id="candidates-heading"/);
        assert.doesNotMatch(app.html(), /Profissional contratado\./);
      }
    } finally { app.close(); }
  }
});

test('talent discovery presents operation context, counted chips and richer cards without changing relationships', async () => {
  const data = fixture();
  data.applications = [];
  const talentRows = [{ ...person('one'), city: 'São Paulo', state: 'SP', bio: null, experience: 'Experiência em eventos e atendimento.', reputation: null, review_count: 2, reviews: [], restaurant_operations: 0, last_hired_at: null, history: [] }];
  const app = mount('../app/restaurant/candidates/talent-center.tsx', { data, talentRows });
  try {
    await app.flush();
    const html = app.html();
    for (const text of ['Operação selecionada', 'Festival Gastronômico', 'Recomendações', 'São Paulo/SP', 'Experiência em eventos', 'Avaliação média', 'Ainda não existem candidatos para esta operação', 'Nenhum convite enviado']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /Sugestões para convidar/);
    const tabs = app.elements().filter(item => item.props?.role === 'tab');
    assert.equal(tabs.length, 4);
    assert.ok(tabs.every(item => item.props.className.includes('rounded-full')));
    assert.equal(app.calls.filter(call => call.name === 'set_talent_connection').length, 0);
    const interest = app.elements().find(item => item.props?.['aria-label'] === 'Marcar interesse em Profissional one');
    await interest.props.onClick(); await app.flush();
    assert.ok(app.calls.some(call => call.name === 'set_talent_connection' && call.args.p_category === 'interest' && call.args.p_enabled === true));
    tabs.find(item => item.props.children[0] === 'Convidados').props.onClick(); await app.flush();
    assert.doesNotMatch(app.html(), /Ainda não existem candidatos para esta operação/);
  } finally { app.close(); }
});

test('photo signing failures are explicit and private or unshared fields are not requested', async () => {
  await assert.rejects(helpers.signDemandPhotos({ storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } }, [person('one', { photo_path: 'one/photo.jpg' })]), /todas as fotos/);
  const html = renderToStaticMarkup(React.createElement(Person, { person: person('one', { score: null, specialties: [] }) }));
  assert.doesNotMatch(html, /4,7|94|cpf|telefone/i);
});
