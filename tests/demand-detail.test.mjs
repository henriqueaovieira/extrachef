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
const cards = load('../app/components/demand-card.tsx', { ...shared, '@/lib/demands': domain, '@/lib/demand-detail': helpers }).DemandSituation;
const person = (id, extra = {}) => ({ id, name: `Profissional ${id}`, specialties: ['Garçom'], score: 4.7, photo_path: null, experience: null, categories: [], completed_operations: 0, invitation_status: null, ...extra });
export function fixture() {
  const jobs = Array.from({ length: 4 }, (_, i) => ({
    id: `job${i}`, demand_id: 'operation', demand_revision: 0, title: 'Festival Gastronômico', description: 'Uniforme preto\nChegar 15 minutos antes',
    job_date: '2099-11-12', start_time: '10:00:00', end_time: '23:00:00', status: i < 2 ? 'filled' : 'open', value: 150,
    location_name: 'Centro de Eventos', work_address: 'Rua A', work_number: '123', work_city: 'São Paulo', work_state: 'SP', work_latitude: -23.55, work_longitude: -46.63,
  }));
  const applications = [
    { job_id: 'job0', worker_id: 'h1', status: 'approved' },
    { job_id: 'job1', worker_id: 'h2', status: 'in_progress' },
    ...[1, 2, 3, 4].map(i => ({ job_id: 'job2', worker_id: `c${i}`, status: 'pending', created_at: `2026-01-0${i}T12:00:00Z` })),
    { job_id: 'job3', worker_id: 'c4', status: 'pending', created_at: '2026-01-01T12:00:00Z' },
  ];
  return { jobs, applications, reserves: [{ demand_id: 'operation', worker_id: 'c3' }] };
}
export function mount(file, { data = fixture(), params = '', people = ['h1', 'h2', 'c1', 'c2', 'c3', 'c4'].map(id => person(id)), historyFailure = false, coreFailure = false, profileFailure = false, rpcFailure = false, invitations = [], assignments = [], reviews = [] } = {}) {
  let dirty = true, cursor = 0, effectCursor = 0, tree;
  const state = [], effects = [], calls = [];
  const oldWindow = globalThis.window;
  globalThis.window = { setInterval() { return 1; }, clearInterval() {} };
  const db = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        range() { return Promise.resolve({ data: historyFailure ? null : [{ id: 'event1', kind: 'created', worker_id: null, occurred_at: '2026-01-01T12:00:00Z' }], error: historyFailure ? { message: 'offline' } : null }); },
      };
      assert.equal(table, 'demand_events');
      return query;
    },
    rpc(name, args) {
      calls.push({ name, args });
      if ((profileFailure && name === 'demand_talent_directory') || (rpcFailure && !['demand_talent_directory', 'worker_demand_invites'].includes(name))) return Promise.resolve({ error: { message: 'Serviço indisponível' }, data: null });
      if (name === 'demand_talent_directory') return Promise.resolve({ data: args.p_worker_id ? people.filter(person => person.id === args.p_worker_id) : people, error: null });
      if (name === 'worker_demand_invites') return Promise.resolve({ data: invitations, error: null });
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
    '@/lib/operations': { ...operations, loadOperationalAssignments: async () => assignments, loadPendingReviews: async () => reviews },
    '@/app/components/operational-reputation': load('../app/components/operational-reputation.tsx', shared),
    '@/app/components/demand-card': { DemandSituation: cards, DemandActions: () => React.createElement('span', null, 'Editar · Duplicar · Compartilhar · Cancelar · Arquivar') },
    '@/app/components/demand-person': { default: Person },
    '@/app/components/demand-talent-network': { default: () => React.createElement('p', null, 'Rede de Talentos') },
    '@/app/components/mobile-bottom-nav': { default: Nav },
  }).default;
  function render() {
    cursor = effectCursor = 0; dirty = false;
    tree = Component({ demandId: 'operation' });
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
  }
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
  }
  return {
    calls,
    render,
    async flush() {
      for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); }
      assert.equal(dirty, false);
    },
    html: () => renderToStaticMarkup(tree),
    elements: () => elements(tree),
    find: text => elements(tree).find(item => item.type === ui.Button && item.props.children === text),
    close() { effects.forEach(effect => effect.cleanup?.()); globalThis.window = oldWindow; },
  };
}
const detailFile = '../app/restaurant/demands/[demandId]/demand-detail.tsx';

test('detail helpers deduplicate latest candidates, calculate exact progress and validate map coordinates', () => {
  const data = fixture(), demand = domain.buildDemands(data.jobs, data.applications, data.reserves)[0];
  assert.deepEqual(helpers.uniqueDemandCandidates(demand).map(item => item.worker_id), ['c4', 'c3', 'c2', 'c1']);
  for (const [hired, expected] of [[0, 0], [1, 25], [3, 75], [4, 100], [5, 100]]) assert.equal(helpers.demandProgress({ ...demand, hired }), expected);
  assert.match(helpers.demandMapLinks(demand).map, /openstreetmap/);
  demand.job.work_latitude = 95;
  assert.equal(helpers.demandMapLinks(demand).map, null);
  assert.match(helpers.demandMapLinks(demand).route, /Rua%20A/);
});

test('detail shows real people, hides unnecessary reserve and counters, and requires hiring confirmation', async () => {
  const app = mount(detailFile);
  try {
    app.render(); assert.match(app.html(), /Carregando operação/);
    await app.flush();
    const html = app.html();
    for (const text of ['Informações da Operação', 'Candidatos recentes', 'Equipe contratada', 'Linha do tempo', 'Uniforme preto', 'R$ 150,00', 'Profissional h1', 'Profissional h2', '4,7 / 5', 'Contratar', 'Pagamento', 'Check-in', 'Checkout']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /posições preenchidas|<progress|id="reserve-heading"|Adicionar à reserva/);
    const recent = html.split('id="candidates-heading"')[1].split('aria-labelledby="hired-heading"')[0];
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
        assert.match(app.html(), /Equipe contratada/);
      }
    } finally { app.close(); }
  }
});

test('empty and complete candidate views are full pages; talent profile lookup is not limited to applicants', async () => {
  for (const [options, expected] of [
    [{ data: { ...fixture(), applications: [], reserves: [] } }, 'Ainda não há candidatos.'],
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

test('talent network filters real categories/recurrence and persists invitations without automatic hiring', async () => {
  const app = mount('../app/components/demand-talent-network.tsx', { people: [person('one', { categories: ['favorite'] }), person('two', { completed_operations: 2 })] });
  try {
    await app.flush();
    app.find('Recorrentes').props.onClick(); await app.flush();
    assert.match(app.html(), /Profissional two/); assert.doesNotMatch(app.html(), /Profissional one/);
    await app.find('Convidar').props.onClick(); await app.flush();
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
    const app = mount('../app/worker/invitations/page.tsx', { rpcFailure, invitations: [{ id: 'invite', title: 'Garçom Extra', job_date: '2099-11-12', start_time: '18:00', end_time: '23:00', value: 150, status: 'pending' }] });
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
  for (const options of [{ data: ended }, { rpcFailure: true }]) {
    const app = mount(detailFile, options);
    try {
      await app.flush();
      if (options.data) {
        assert.equal(app.find('Contratar'), undefined);
        assert.equal(app.find('Adicionar à reserva'), undefined);
        assert.match(app.html(), /Checkout Pendente/);
      } else {
        await app.find('Contratar').props.onClick(); await app.flush();
        await app.find('Confirmar Contratação').props.onClick(); await app.flush();
        assert.match(app.html(), /Serviço indisponível/);
        assert.match(app.html(), /Equipe contratada/);
        assert.doesNotMatch(app.html(), /Profissional contratado\./);
      }
    } finally { app.close(); }
  }
});

test('photo signing failures are explicit and private or unshared fields are not requested', async () => {
  await assert.rejects(helpers.signDemandPhotos({ storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } }, [person('one', { photo_path: 'one/photo.jpg' })]), /todas as fotos/);
  const html = renderToStaticMarkup(React.createElement(Person, { person: person('one', { score: null, specialties: [] }) }));
  assert.doesNotMatch(html, /4,7|94|cpf|telefone/i);
});
