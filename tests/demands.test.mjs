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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports);
  return exports;
}
const domain = load('../lib/demands.ts');
const ui = load('../app/components/ui/index.tsx', { '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts') });
const job = (id, extra = {}) => ({
  id, demand_id: 'demand', title: 'Festival Gastronômico', description: 'Reforço de operação',
  job_date: '2026-11-12', start_time: '10:00:00', end_time: '23:00:00',
  status: 'open', value: 180, location_name: 'Centro de Eventos', work_address: 'Rua A', work_city: 'São Paulo',
  location_status: 'ready', work_latitude: -23.55, work_longitude: -46.63, ...extra,
});
const before = new Date('2026-11-01T10:00:00-03:00');
const build = (jobs, applications = [], reserves = [], now = before) => domain.buildDemands(jobs, applications, reserves, now);
const application = (job_id, worker_id, status = 'pending') => ({ job_id, worker_id, status });

test('invalid operational coordinates block recruitment and hiring without hiding historical applications', () => {
  for (const changes of [
    { work_latitude: null }, { work_longitude: null }, { work_latitude: NaN },
    { work_longitude: Infinity }, { work_latitude: 91 }, { location_status: 'pending_coordinates' },
  ]) {
    const invalid = job('a', changes);
    const [demand] = build([invalid], [application('a', 'worker')]);
    assert.equal(domain.canRecruitJob(invalid, before), false);
    assert.equal(domain.canHireDemand(demand, before), false);
    assert.equal(demand.applications.length, 1);
  }
});

test('recruitment closes at five hours exactly, while existing candidates remain hireable until start', () => {
  const regular = job('a', { created_at: '2026-11-11T00:00:00-03:00' });
  const at = time => new Date(`2026-11-12T${time}-03:00`);
  assert.equal(domain.recruitmentWindow(regular).cutoff.toISOString(),at('05:00:00').toISOString());
  for (const [time, open, hire] of [
    ['04:59:59',true,true],['05:00:00',false,true],['05:00:01',false,true],
    ['09:59:59',false,true],['10:00:00',false,false],['10:00:01',false,false],['23:00:00',false,false],
  ]) {
    const [demand] = build([regular], [application('a','worker')], [], at(time));
    assert.equal(domain.canRecruitJob(regular,at(time)),open,time);
    assert.equal(domain.canRecruitDemand(demand,at(time)),open,time);
    assert.equal(domain.canHireDemand(demand,at(time)),hire,time);
    assert.equal(domain.filterDemands([demand],'hiring',at(time)).length,Number(open));
    assert.equal(demand.applications.length,1);
  }
  const urgent = { ...regular,created_at: at('07:00:00').toISOString() };
  assert.equal(domain.recruitmentWindow(urgent).urgent,true);
  assert.equal(domain.canRecruitJob(urgent,at('09:59:59')),true);
  assert.equal(domain.canRecruitJob(urgent,at('10:00:00')),false);
  assert.equal(domain.canRecruitJob({...urgent,status:'filled'},at('09:00:00')),false);
  assert.equal(domain.canRecruitJob({...urgent,recruitment_blocked:true},at('09:00:00')),false);
  assert.equal(domain.canRecruitJob({...urgent,demand_archived_at: at('08:00:00').toISOString()},at('09:00:00')),false);
});

test('explicit identity preserves distinct operations with identical names and represents 1, 2, 20 and 50 professionals identically', () => {
  for (const quantity of [1, 2, 20, 50]) {
    const jobs = Array.from({ length: quantity }, (_, i) => job(String(i)));
    const demands = build(jobs);
    assert.equal(demands.length, 1);
    assert.equal(demands[0].required, quantity);
    assert.equal(demands[0].hired, 0);
    assert.equal(demands[0].status, 'Buscando Profissionais');
  }
  assert.equal(build([job('a'), job('b', { demand_id: 'other' })]).length, 2);
});

test('operational counts deduplicate people, exclude stale pending applications and keep reserves distinct from hires', () => {
  const jobs = [job('a', { status: 'filled' }), job('b')];
  const apps = [application('a', 'ana', 'approved'), application('b', 'ana'),
    application('a', 'bruno'), application('b', 'bruno'), application('b', 'carla')];
  const [demand] = build(jobs, apps, [{ demand_id: 'demand', worker_id: 'bruno' }]);
  assert.equal(demand.hired, 1);
  assert.equal(demand.candidates, 2);
  assert.equal(demand.reserve, 1);
  assert.equal(demand.status, 'Equipe em formação');
  assert.equal(demand.canEdit, false);
  assert.equal(demand.canCancel, false);
});

test('25-person example yields required 25, hired 18, reserve 3, candidates 42 without changing card structure', () => {
  const jobs = Array.from({ length: 25 }, (_, i) => job(`slot-${i}`, { status: i < 18 ? 'filled' : 'open' }));
  const apps = [
    ...Array.from({ length: 18 }, (_, i) => application(`slot-${i}`, `hired-${i}`, 'approved')),
    ...Array.from({ length: 42 }, (_, i) => application(`slot-${18 + i % 7}`, `candidate-${i}`)),
  ];
  const reserves = Array.from({ length: 3 }, (_, i) => ({ demand_id: 'demand', worker_id: `candidate-${i}` }));
  const [demand] = build(jobs, apps, reserves);
  assert.deepEqual([demand.required, demand.hired, demand.reserve, demand.candidates], [25, 18, 3, 42]);
});

test('health is based on staffing and timing, never requires a permanent reserve', () => {
  const full = [job('a', { status: 'filled' })];
  const apps = [application('a', 'ana', 'approved'), application('a', 'bruno')];
  assert.equal(build(full, apps, [{ demand_id: 'demand', worker_id: 'bruno' }])[0].health, 'safe');
  assert.equal(build(full, apps)[0].health, 'safe');
  assert.equal(build([job('a')])[0].health, 'warning');
  assert.equal(build([job('a')], [], [], new Date('2026-11-11T10:00:00-03:00'))[0].health, 'risk');
  assert.equal(build([job('a')], [], [], new Date('2026-11-11T09:59:59-03:00'))[0].health, 'warning');
  const completed = build([job('a', { status: 'completed' })], apps)[0];
  assert.equal(completed.health, 'neutral');
  assert.equal(completed.attention, false);
});

test('states reflect attendance and checkout rather than inventing payment data or silently completing ended operations', () => {
  assert.equal(build([job('a')], [application('a', 'ana')])[0].status, 'Recebendo Candidaturas');
  assert.equal(build([job('a', { status: 'filled' })], [application('a', 'ana', 'approved')])[0].status, 'Profissional Contratado');
  const jobs = [job('a', { status: 'filled' }), job('b', { status: 'filled' })];
  assert.equal(build(jobs, [application('a', 'ana', 'approved'), application('b', 'bruno', 'approved')])[0].status, 'Equipe Completa');
  assert.equal(build(jobs, [application('a', 'ana', 'in_progress')])[0].status, 'Em Andamento');
  const ended = build(jobs, [application('a', 'ana', 'approved')], [], new Date('2026-11-13T00:00:00-03:00'))[0];
  assert.equal(ended.status, 'Checkout Pendente');
  assert.equal(ended.completed, false);
  assert.equal(ended.attention, true);
  assert.equal(build([job('a', { status: 'cancelled' })])[0].status, 'Cancelada');
  assert.equal(build([job('a', { status: 'completed' })])[0].status, 'Concluída');
});

test('filters separate hiring, today, running, completed and cancelled, including overnight shifts', () => {
  const now = new Date('2026-11-13T01:00:00-03:00');
  const data = build([
    job('a', { demand_id: 'overnight', start_time: '22:00:00', end_time: '03:00:00', status: 'filled' }),
    job('b', { demand_id: 'next', job_date: '2026-11-14' }),
    job('c', { demand_id: 'done', status: 'completed' }),
    job('d', { demand_id: 'cancel', status: 'cancelled' }),
  ], [application('a', 'ana', 'approved')], [], now);
  assert.equal(domain.filterDemands(data, 'all', now).length, 4);
  assert.deepEqual(domain.filterDemands(data, 'today', now).map(demand => demand.id), ['overnight']);
  assert.deepEqual(domain.filterDemands(data, 'running', now).map(demand => demand.id), ['overnight']);
  assert.equal(domain.filterDemands(data, 'completed', now)[0].id, 'done');
  assert.equal(domain.filterDemands(data, 'cancelled', now)[0].id, 'cancel');
  assert.equal(domain.demandDate('2026-11-13', now), 'Hoje');
  assert.equal(domain.demandDate('2026-11-14', now), 'Amanhã');
});

test('paginated reads do not cap large companies or turn query failures into zero counts', async () => {
  const records = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const offsets = [];
  const result = await domain.readDemandPages(async (offset) => {
    offsets.push(offset);
    return { data: records.slice(offset, offset + 500), error: null };
  });
  assert.equal(result.length, 1201);
  assert.deepEqual(offsets, [0, 500, 1000]);
  await assert.rejects(domain.readDemandPages(async () => ({ data: null, error: { message: 'offline' } })), /offline/);
  await assert.rejects(domain.readDemandPages(async () => ({ data: null, error: null })), /não retornou/);
});

const components = load('../app/components/demand-card.tsx', {
  '@/app/components/ui': ui, '@/lib/demands': domain,
  '@/lib/demand-detail': load('../lib/demand-detail.ts', { '@/lib/demands': domain }),
  '@/lib/supabase/client': { createClient: () => { throw new Error('No database mutations during render'); } },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
});
test('cards are accessible full-page links with the same operational structure at all team sizes and no tables', () => {
  for (const quantity of [1, 2, 20, 50]) {
    const [demand] = build(Array.from({ length: quantity }, (_, i) => job(String(i))));
    const html = renderToStaticMarkup(React.createElement(components.default, { demand, onChanged() {} }));
    for (const text of ['Equipe contratada', 'Candidatos', 'Ver Detalhes', 'Editar', 'Duplicar', 'Compartilhar', 'Cancelar', 'Centro de Eventos']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, />Reserva</);
    assert.match(html, /href="\/restaurant\/demands\/demand"/);
    assert.doesNotMatch(html, /<table|<dialog|<canvas/);
    assert.equal((html.match(/<dd[^>]*>0<\/dd>/g) ?? []).length,2);
  }
});

test('creation and details wire persistent RPCs and never mutate job columns directly', () => {
  const create = source('../app/restaurant/dashboard/jobs/create/page.tsx');
  assert.match(create, /rpc\('create_restaurant_demand'/);
  assert.doesNotMatch(create, /p_quantity/);
  assert.match(create, /p_location_source: 'catalog'/);
  assert.match(create, /p_work_location_id: selectedLocation\.id/);
  const card = source('../app/components/demand-card.tsx');
  assert.match(card, /p_action: 'cancel'/);
  assert.match(source('../lib/demand-detail.ts'), /navigator\.share/);
  assert.match(source('../lib/demand-detail.ts'), /clipboard\.writeText/);
  const detail = source('../app/restaurant/demands/[demandId]/demand-detail.tsx');
  for (const rpc of ['manage_restaurant_demand', 'approve_demand_candidate', 'set_demand_reserve']) assert.ok(detail.includes(`rpc('${rpc}'`));
  assert.doesNotMatch(detail, /from\('jobs'\)\.(update|insert|delete)/);
  assert.match(source('../app/components/mobile-bottom-nav.tsx'), /pathname\.startsWith\('\/restaurant\/demands\/'\)/);
});

function mountList({ jobs = [], applications = [], reserves = [], failure = false } = {}) {
  const values = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let dirty = true;
  let tree;
  let params = new URLSearchParams();
  let failing = failure;
  const oldWindow = globalThis.window;
  globalThis.window = {
    location: { href: 'http://localhost/restaurant/demands' },
    history: { replaceState(_state, _unused, url) {
      params = new URL(url, 'http://localhost').searchParams;
      globalThis.window.location.href = `http://localhost${url}`;
    } },
    setInterval() { return 1; }, clearInterval() {},
  };
  const Component = load('../app/restaurant/demands/page.tsx', {
    react: { ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; dirty = true; }];
      },
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { callback, deps, pending: true };
        }
      },
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useSearchParams: () => params },
    '@/app/components/ui': ui,
    '@/app/components/mobile-bottom-nav': { default: () => null },
    '@/app/components/dashboard-identity': { DashboardLogo: ({ role }) => React.createElement('a', { href: `/${role}/dashboard` }, 'ExtraChef') },
    '@/app/components/demand-card': { default: components.default },
    '@/lib/supabase/client': { createClient: () => ({}) },
    '@/lib/demands': { ...domain, loadDemands: async () => {
      if (failing) throw new Error('offline');
      return { jobs, applications, reserves };
    } },
  }).default;
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(item => nodes(item));
    return [node, ...nodes(node.props?.children)];
  }
  return {
    async flush() {
      for (let i = 0; i < 10; i++) {
        if (dirty) {
          dirty = false; cursor = 0; effectCursor = 0; tree = Component();
          for (const effect of effects) if (effect.pending) {
            effect.pending = false; effect.cleanup = effect.callback();
          }
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(dirty, false);
    },
    html: () => renderToStaticMarkup(tree),
    tree: () => tree,
    nodes: () => nodes(tree),
    async click(label) {
      const node = nodes(tree).find(node => node.props?.children === label && node.props.onClick);
      assert.ok(node, `action ${label} exists`);
      node.props.onClick();
      await this.flush();
    },
    recover() { failing = false; },
    unmount() { effects.forEach(effect => effect.cleanup?.()); globalThis.window = oldWindow; },
  };
}

test('actual list distinguishes loading, empty and failure; retry recovers without fabricated counters', async () => {
  const app = mountList({ failure: true });
  try {
    await app.flush();
    assert.match(app.html(), /Não foi possível carregar suas operações/);
    assert.match(app.html(), /offline/);
    assert.doesNotMatch(app.html(), /Você ainda não possui operações/);
    assert.match(app.html(), /<dd[^>]*>—<\/dd>/);
    app.recover();
    await app.click('Tentar Novamente');
    assert.match(app.html(), /Você ainda não possui operações/);
    assert.match(app.html(), /Crie sua primeira operação e encontre profissionais rapidamente/);
    assert.match(app.html(), /Criar Operação/);
  } finally { app.unmount(); }
});

test('actual list filters with URL state, keeps archived operations separate and progressively shows all cards', async () => {
  const jobs = Array.from({ length: 25 }, (_, i) => job(String(i), { demand_id: `operation-${i}`, job_date: '2099-01-01' }));
  jobs.push(job('closed', { demand_id: 'closed', status: 'completed' }));
  const app = mountList({ jobs });
  try {
    await app.flush();
    assert.equal(app.nodes().filter(node => node.type === components.default).length, 20);
    await app.click('Mostrar mais');
    assert.equal(app.nodes().filter(node => node.type === components.default).length, 26);
    await app.click('Concluídas');
    assert.equal(app.nodes().filter(node => node.type === components.default).length, 1);
    assert.match(app.html(), /aria-pressed="true"[^>]*>Concluídas/);
    assert.match(globalThis.window.location.href, /filter=completed/);
    await app.click('Canceladas');
    assert.match(app.html(), /Nenhuma operação neste filtro/);
    await app.click('Contratando');
    assert.equal(app.nodes().filter(node => node.type === components.default).length, 20);
  } finally { app.unmount(); }
});
