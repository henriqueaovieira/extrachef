import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
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
const demands = loadTs('../lib/demands.ts');
const home = loadTs('../lib/restaurant-home.ts', { '@/lib/demands': demands });
const operations = loadTs('../lib/operations.ts');
const ui = loadTs('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': loadTs('../lib/ui/input-masks.ts'),
});
const job = (id, extra = {}) => ({
  id, title: `Demanda ${id}`, job_date: '2099-10-17', start_time: '18:00:00',
  end_time: '23:00:00', status: 'open', restaurant_id: 'restaurant', value: 150,
  location_name: 'Bella Napoli', work_address: 'Rua Central', work_number: '123',
  work_city: 'São Paulo', work_state: 'SP', location_status: 'ready', work_latitude: -23.55, work_longitude: -46.63, ...extra,
});
const message = (id, jobId, extra = {}) => ({
  id, job_id: jobId, sender_id: 'worker-a', content: `Mensagem ${id}`,
  created_at: `2026-10-17T10:${id.padStart(2, '0')}:00Z`, read_at: null, ...extra,
});
const dateOffset = days => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

test('next demand excludes ended and closed shifts, sorts without mutating and includes overnight work', () => {
  const now = new Date('2026-10-17T01:00:00-03:00');
  const overnight = job('overnight', { job_date: '2026-10-16', start_time: '22:00:00', end_time: '03:00:00', status: 'filled' });
  const ended = job('ended', { job_date: '2026-10-16' });
  const next = job('next', { job_date: '2026-10-17' });
  const cancelled = job('cancelled', { job_date: '2026-10-17', status: 'cancelled' });
  const completed = job('completed', { job_date: '2026-10-17', status: 'completed' });
  const jobs = [next, ended, cancelled, completed, overnight];
  assert.equal(home.nextDemand(jobs, now).id, 'overnight');
  assert.equal(home.nextDemand(jobs, new Date('2026-10-17T03:00:00-03:00')).id, 'next');
  assert.equal(home.nextDemand([ended, cancelled, completed], now), undefined);
  assert.equal(jobs[0], next);
  assert.equal(home.isUpcomingJob(next, new Date('2026-10-17T23:00:00-03:00')), false);
});

test('recent conversations deduplicate by job and keep the latest message in chronological order', () => {
  const recent = home.latestMessagesByJob([
    message('01', 'a'), message('04', 'b'), message('03', 'a'), message('02', 'c'),
  ]);
  assert.deepEqual([...recent.values()].map(item => item.id), ['04', '03', '02']);
});

function database() {
  const db = {
    jobs: [job('a'), job('b', { status: 'filled', job_date: '2099-10-18' }), job('c', { job_date: '2099-10-19' })],
    applications: [
      { job_id: 'a', worker_id: 'worker-a', status: 'pending', created_at: '2026-10-17T12:00:00Z' },
      { job_id: 'a', worker_id: 'worker-b', status: 'pending', created_at: '2026-10-17T11:00:00Z' },
      { job_id: 'b', worker_id: 'worker-b', status: 'approved', created_at: '2026-10-16T10:00:00Z' },
    ],
    messages: [message('05', 'b'), message('04', 'a'), message('03', 'c'), message('02', 'd'), message('01', 'b')],
    public_user_directory: [
      { id: 'restaurant', name: 'Henrique Vieira' }, { id: 'worker-a', name: 'Ana Silva' }, { id: 'worker-b', name: 'Bruno Costa' },
    ],
    restaurant_profiles: [{ user_id: 'restaurant', logo_path: 'logo.png', trade_name: 'Bella Napoli' }],
    operational_assignments: [],
    pending_reviews: [],
    inboxJobs: ['a', 'b', 'c', 'd'],
    failure: '', approvalError: false, calls: [],
    auth: { getUser: async () => ({ data: { user: { id: 'restaurant' } }, error: null }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'http://localhost:3000/icons/icon-192.png' }, error: null }) }) },
    async rpc(name, parameters) {
      db.calls.push({ name, parameters });
      if (db.failure === name) return { data: null, error: { message: 'Serviço indisponível' } };
      if (name === 'pending_operational_reviews') return { data: db.pending_reviews, error: null };
      if (db.approvalError) return { error: { message: 'Vaga indisponível' } };
      db.jobs.find(item => item.id === parameters.p_job_id).status = 'filled';
      db.applications.find(item => item.job_id === parameters.p_job_id && item.worker_id === parameters.p_worker_id).status = 'approved';
      return { error: null };
    },
    from(table) {
      const filters = [];
      const orders = [];
      let limit = Infinity;
      let single = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(item => item[key] === value); return query; },
        neq(key, value) { filters.push(item => item[key] !== value); return query; },
        is(key, value) { filters.push(item => item[key] === value); return query; },
        in(key, values) { filters.push(item => values.includes(item[key])); return query; },
        order(key, { ascending } = { ascending: true }) { orders.push({ key, ascending }); return query; },
        limit(value) { limit = value; return query; },
        range(start, end) { limit = end - start + 1; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const data = db[table].filter(item => filters.every(filter => filter(item))).sort((a, b) => {
            for (const { key, ascending } of orders) {
              const difference = String(a[key]).localeCompare(String(b[key]));
              if (difference) return ascending ? difference : -difference;
            }
            return 0;
          });
          return Promise.resolve({
            data: db.failure === table ? null : single ? data[0] ?? null : data.slice(0, limit).map(item => ({ ...item })),
            count: data.length, error: db.failure === table ? { message: 'Serviço indisponível' } : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return db;
}

function mount(db) {
  const oldWindow = globalThis.window;
  globalThis.window = { setInterval() { return 1; }, clearInterval() {} };
  const state = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let dirty = true;
  let tree;
  const context = { counts: { messages: 4, notifications: 2 }, error: '', chatError: '', refresh: async () => {}, ...db.communication };
  const navigation = { usePathname: () => '/restaurant/dashboard', useSearchParams: () => new URLSearchParams() };
  const shared = {
    '@/app/components/ui': ui,
    '@/app/components/professional-verification': { default: () => null },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/app/components/communication-state': { useCommunication: () => context },
    'next/navigation': navigation,
  };
  const Nav = loadTs('../app/components/mobile-bottom-nav.tsx', shared).default;
  const Bell = loadTs('../app/components/notification-bell.tsx', shared).default;
  const identity = loadTs('../app/components/dashboard-identity.tsx', {
    ...shared,
    'next/image': { default: ({ src, alt, sizes, className }) => React.createElement('img', { src, alt, sizes, className }) },
  });
  const Component = loadTs('../app/restaurant/dashboard/page.tsx', {
    ...shared,
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => {
          state[index] = typeof value === 'function' ? value(state[index]) : value;
          dirty = true;
        }];
      },
      useEffect(callback, deps) {
        const index = effectCursor++;
        if (!effects[index] || deps.some((dep, i) => dep !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { callback, deps, pending: true };
        }
      },
    },
    'next/image': { default: ({ src, alt, sizes, className }) => React.createElement('img', { src, alt, sizes, className }) },
    '@/lib/supabase/client': { createClient: () => db },
    '@/lib/restaurant-home': home,
    '@/lib/demands': demands,
    '@/lib/operations': operations,
    '@/lib/restaurant-message-inbox': {
      async loadRestaurantMessageInbox() {
        if (db.failure === 'messages') throw new Error('Serviço indisponível');
        return db.inboxJobs.map((jobId) => {
          const latest = home.latestMessagesByJob(db.messages.filter(item => item.job_id === jobId)).values().next().value;
          return { job_id: jobId, worker_id: 'worker-a', worker_name: 'Ana Silva', demand_title: `Demanda ${jobId}`,
            latest_message: latest?.content ?? null, latest_message_at: latest?.created_at ?? null };
        });
      },
    },
    '@/app/components/ui': ui,
    '@/app/components/mobile-bottom-nav': { default: Nav },
    '@/app/components/notification-bell': { default: Bell },
    '@/app/components/dashboard-identity': identity,
    '@/app/components/route-feedback': { default: () => null },
  }).default;
  function render() {
    cursor = 0;
    effectCursor = 0;
    dirty = false;
    tree = Component();
    for (const effect of effects) {
      if (effect.pending) {
        effect.pending = false;
        effect.cleanup = effect.callback();
      }
    }
  }
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(item => elements(item));
    return [node, ...elements(node.props?.children)];
  }
  return {
    async flush() {
      for (let i = 0; i < 12; i++) {
        if (dirty) render();
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(dirty, false, 'component should settle');
    },
    html: () => renderToStaticMarkup(tree),
    elements: () => elements(tree),
    unmount: () => { effects.forEach(effect => effect.cleanup?.()); globalThis.window = oldWindow; },
  };
}

test('home follows the approved order and shows only the three specified summary cards', async () => {
  const app = mount(database());
  try {
    await app.flush();
    const html = app.html();
    assert.match(html, /Sua central operacional/);
    assert.match(html, /Bella Napoli/);
    assert.match(html, /Acompanhe suas pendências e operações\./);
    const approvedOrder = [
      'aria-label="ExtraChef — Home"',
      'href="/notifications"',
      'aria-label="Meu perfil"',
      'Bella Napoli',
      'Sua central operacional',
      'Acompanhe suas pendências e operações.',
      'id="pending-heading"',
      'id="operations-heading"',
      'id="conversations-heading"',
      'aria-label="Resumo operacional"',
      'href="/restaurant/dashboard/jobs/create"',
      'aria-label="Navegação principal"',
    ].map(marker => html.indexOf(marker));
    assert.ok(approvedOrder.every(index => index >= 0));
    assert.deepEqual(approvedOrder, [...approvedOrder].sort((a, b) => a - b));
    assert.doesNotMatch(html, /Bom dia|Boa tarde|Boa noite|Sua operação de hoje/);
    assert.match(html, /Ações pendentes/);
    assert.match(html, /Analisar e contratar/);
    assert.match(html, /Responder/);
    assert.match(html, /Equipe incompleta/);
    assert.match(html, /Operação em evidência/);
    assert.doesNotMatch(html, /Operações ativas|Operações futuras|Próxima ação necessária/);
    assert.match(html, /Operações em andamento/);
    assert.match(html, /Próximas operações/);
    assert.match(html, /Mensagens não lidas/);
    assert.equal((html.match(/Operações em andamento|Próximas operações|Mensagens não lidas/g) ?? []).length, 3);
    assert.doesNotMatch(html, /Receita|Faturamento|Avaliações|Conversões|Bem-vindo/);
    assert.doesNotMatch(html, /posições preenchidas|Acessos rápidos|Conversas importantes/);
    assert.equal(app.elements().filter(item => item.props?.id === 'next-demand').length, 0);
    const recentSection = app.elements().find(item => item.props?.['aria-labelledby'] === 'conversations-heading');
    const recentHtml = renderToStaticMarkup(recentSection);
    assert.equal((recentHtml.match(/href="\/chat\//g) ?? []).length, 3);
    assert.match(recentHtml, /Mensagem 05/);
    assert.match(recentHtml, /Conversa com Ana Silva sobre Demanda b/);
    assert.match(recentHtml, />Demanda b</);
    assert.doesNotMatch(recentHtml, /Mensagem 02/);
    assert.doesNotMatch(recentHtml, /Ainda não existem conversas/);
    for (const label of ['Home', 'Operações', 'Talentos', 'Mensagens', 'Mais', 'Criar Operação']) assert.match(html, new RegExp(label));
    assert.match(html, /href="\/restaurant\/dashboard\/jobs\/create"[^>]*>.*Criar Operação/);
  } finally { app.unmount(); }
});

test('home only shows conversations that also exist in the operational message center', async () => {
  const db = database();
  db.messages.push(message('09', 'legacy', { content: 'Mensagem legada' }));
  const app = mount(db);
  try {
    await app.flush();
    const html = app.html();
    assert.doesNotMatch(html, /Mensagem legada/);
    assert.doesNotMatch(html, /href="\/chat\/legacy"/);
    db.inboxJobs = [];
    const empty = mount(db);
    try {
      await empty.flush();
      const recentSection = empty.elements().find(item => item.props?.['aria-labelledby'] === 'conversations-heading');
      assert.doesNotMatch(renderToStaticMarkup(recentSection), /href="\/chat\//);
      assert.match(renderToStaticMarkup(recentSection), /Ainda não existem conversas/);
      assert.match(renderToStaticMarkup(recentSection), /As mensagens com profissionais contratados aparecerão aqui/);
      assert.doesNotMatch(empty.html(), /Responder/);
    } finally { empty.unmount(); }
  } finally { app.unmount(); }
});

test('home routes hiring to the demand confirmation instead of approving without confirmation', async () => {
  const db = database();
  const app = mount(db);
  try {
    await app.flush();
    const analyze = app.elements().find(item => item.props?.children === 'Analisar e contratar');
    assert.equal(analyze.props.href,'/restaurant/demands/a?view=candidates');
    assert.equal(db.calls.some(call => call.name==='approve_application'),false);
  } finally { app.unmount(); }
});

test('pending reviews remain in actions and the fixed create operation button stays visible', async () => {
  const db = database();
  db.pending_reviews = [{ job_id:'finished',title:'Diária concluída',reviewed_name:'Ana' }];
  const app = mount(db);
  try {
    await app.flush();
    assert.match(app.html(), /Antes de criar uma nova operação/);
    assert.match(app.html(), /href="\/restaurant\/dashboard\/jobs\/create"[^>]*>.*Criar Operação/);
    assert.doesNotMatch(app.html(), /Tudo em dia/);
  } finally { app.unmount(); }
});

test('operation cards prioritize in-progress, today, tomorrow, then later dates', async () => {
  const db = database();
  db.jobs = [
    job('future', { title: 'Cozinheiro', job_date: dateOffset(7) }),
    job('tomorrow', { title: 'Auxiliar', job_date: dateOffset(1) }),
    job('today', { title: 'Garçom', job_date: dateOffset(0), start_time: '22:00:00', end_time: '23:59:00' }),
    job('running', { title: 'Bartender', job_date: dateOffset(0), status: 'in_progress', start_time: '00:00:00', end_time: '23:59:00' }),
  ];
  const app = mount(db);
  try {
    await app.flush();
    const operations = app.elements().find(item => item.props?.['aria-labelledby'] === 'operations-heading');
    const html = renderToStaticMarkup(operations);
    const links = [...html.matchAll(/href="\/restaurant\/demands\/([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(links, ['running', 'today', 'tomorrow', 'future']);
    assert.equal((html.match(/data-priority="primary"/g) ?? []).length, 1);
    assert.match(html, /href="\/restaurant\/demands\/running" data-priority="primary"/);
    assert.match(html, /ec-badge--info[^>]*>Em andamento/);
    assert.doesNotMatch(html, /ec-badge--success|bg-emerald/);
    const first = html.slice(html.indexOf('data-priority="primary"'), html.indexOf('href="/restaurant/demands/today"'));
    const markers = ['Em andamento', 'Bartender', '00:00 às 23:59', 'Rua Central, 123', 'Diária:'];
    assert.ok(markers.every(marker => first.includes(marker)));
    assert.deepEqual(markers.map(marker => first.indexOf(marker)), markers.map(marker => first.indexOf(marker)).sort((a,b) => a-b));
    assert.match(html, /Em andamento/);
    assert.match(html, /Rua Central, 123/);
    assert.match(html, /São Paulo - SP/);
    assert.match(html, /R\$\u00a0150,00/);
  } finally { app.unmount(); }
});

test('operational failures are visible danger alerts before pending actions without changing the loader', async () => {
  for (const failure of ['operational_assignments', 'pending_operational_reviews']) {
    const db = database();
    db.failure = failure;
    const app = mount(db);
    try {
      await app.flush();
      const html = app.html();
      assert.match(html, /role="alert"[^>]*class="ec-toast ec-toast--danger"/);
      assert.ok(html.indexOf('Serviço indisponível') < html.indexOf('id="pending-heading"'));
      assert.doesNotMatch(html, /Tudo em dia/);
      const create = app.elements().find(item => item.props?.href === '/restaurant/dashboard/jobs/create');
      assert.match(create.props.className, /ec-button--secondary/);
    } finally { app.unmount(); }
  }
  for (const field of ['chatError', 'error']) {
    const db = database();
    db.communication = { [field]: 'Falha de comunicação.' };
    const app = mount(db);
    try {
      await app.flush();
      const feedback = app.elements().find(item => item.props?.tone === 'danger' && item.props.children === 'Falha de comunicação.');
      assert.ok(feedback);
      assert.match(renderToStaticMarkup(feedback), /role="alert"/);
      assert.ok(app.html().indexOf('Falha de comunicação.') < app.html().indexOf('id="pending-heading"'));
      assert.match(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'), /\.ec-restaurant-home \.ec-mobile-nav__error\s*\{\s*display: none;/);
    } finally { app.unmount(); }
  }
});

test('pending groups keep reviews, operational actions, recent applications/messages and staffing in their existing order', async () => {
  const db = database();
  db.pending_reviews = [{ job_id:'review', title:'Avaliação de teste', reviewed_name:'Profissional de teste' }];
  db.jobs.push(job('arrival', { job_date: dateOffset(-1), start_time:'08:00:00', end_time:'09:00:00', status:'filled' }));
  db.operational_assignments = [{ id:'assignment', job_id:'arrival', worker_id:'worker', checkin_at:null, checkout_at:null, interruption:null }];
  const app = mount(db);
  try {
    await app.flush();
    const pending = renderToStaticMarkup(app.elements().find(item => item.props?.['aria-labelledby'] === 'pending-heading'));
    assert.ok(pending.indexOf('href="/reviews/review"') < pending.indexOf('href="/checkin/arrival"'));
    assert.ok(pending.indexOf('href="/checkin/arrival"') < pending.indexOf('Analisar e contratar'));
    assert.ok(pending.indexOf('Analisar e contratar') < pending.indexOf('Equipe incompleta'));
    assert.match(pending, /ec-badge--warning/);
    assert.doesNotMatch(pending, /truncate|line-clamp|ec-badge--success/);
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    assert.match(css, /\.ec-restaurant-home__actions > article:first-child\s*\{/);
    assert.match(css, /\.ec-restaurant-home__actions > article:first-child \.ec-button:not\(\.ec-button--ghost\)\s*\{[^}]*var\(--ec-brand\)/);
    const create = app.elements().find(item => item.props?.href === '/restaurant/dashboard/jobs/create');
    assert.match(create.props.className, /ec-button--secondary/);
  } finally { app.unmount(); }
});

test('create operation remains primary only in a confirmed empty home, and operation action is primary without pending items', async () => {
  const db = database();
  db.jobs=[]; db.applications=[]; db.messages=[]; db.inboxJobs=[];
  const empty = mount(db);
  try {
    await empty.flush();
    const create = empty.elements().find(item => item.props?.href === '/restaurant/dashboard/jobs/create');
    assert.match(create.props.className, /ec-button--primary/);
    assert.match(empty.html(), /Tudo em dia/);
  } finally { empty.unmount(); }
  db.jobs=[job('filled', {status:'filled'})];
  const operationOnly = mount(db);
  try {
    await operationOnly.flush();
    const section = operationOnly.elements().find(item => item.props?.['aria-labelledby'] === 'operations-heading');
    const html = renderToStaticMarkup(section);
    assert.match(html, /ec-button[^"]*ec-button--primary[^>]*>Ver operação/);
    assert.match(html, /ec-badge--info[^>]*>Equipe confirmada/);
    const create = operationOnly.elements().find(item => item.props?.href === '/restaurant/dashboard/jobs/create');
    assert.match(create.props.className, /ec-button--secondary/);
  } finally { operationOnly.unmount(); }
});

test('empty home is honest and query failures never masquerade as all caught up', async () => {
  for (const failure of ['', 'applications', 'messages', 'jobs']) {
    const db = database();
    db.jobs = [];
    db.applications = [];
    db.messages = [];
    db.failure = failure;
    if (failure === 'applications') db.jobs = [job('a')];
    const app = mount(db);
    try {
      await app.flush();
      const html = app.html();
      if (!failure) {
        assert.match(html, /Tudo em dia/);
        assert.match(html, /Nenhuma operação agendada/);
        assert.match(html, /As próximas operações aparecerão aqui/);
        assert.match(html, /Nenhuma pendência encontrada\. As próximas ações aparecerão aqui automaticamente\./);
      } else {
        assert.match(html, /role="alert"/);
        assert.doesNotMatch(html, /Tudo em dia/);
      }
    } finally { app.unmount(); }
  }
});

test('missing profile image uses an initial without inventing a profile photo', async () => {
  const db = database();
  db.restaurant_profiles = [];
  const app = mount(db);
  try {
    await app.flush();
    assert.doesNotMatch(app.html(), /alt="Logo do restaurante"/);
    assert.match(app.html(), /aria-label="Meu perfil"/);
  } finally { app.unmount(); }
});

test('all pending actions expand in place instead of sending different action types to the wrong screen', async () => {
  const db = database();
  db.jobs.push(...Array.from({ length: 5 }, (_, i) => job(`extra-${i}`)));
  const app = mount(db);
  try {
    await app.flush();
    const before = app.elements().filter(item => item.type === ui.Card && item.props.as === 'article').length;
    const expand = app.elements().find(item => item.props?.children === 'Ver todas as pendências');
    assert.equal(expand.props['aria-expanded'], false);
    expand.props.onClick();
    await app.flush();
    assert.equal(app.elements().filter(item => item.type === ui.Card && item.props.as === 'article').length, before + 4);
    assert.match(app.html(), /Mostrar menos/);
  } finally { app.unmount(); }
});

test('restaurant navigation has exactly one active destination, including messages and nested creation', () => {
  let pathname = '/restaurant/dashboard';
  const Nav = loadTs('../app/components/mobile-bottom-nav.tsx', {
    '@/app/components/ui': ui,
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { usePathname: () => pathname },
    '@/app/components/communication-state': {
      useCommunication: () => ({ counts: { messages: 0, notifications: 0 }, error: '', chatError: '' }),
    },
  }).default;
  for (const [path, activeItem, expected] of [
    ['/restaurant/dashboard', undefined, 'Home'],
    ['/restaurant/dashboard/jobs/create', undefined, 'Operações'],
    ['/restaurant/demands', undefined, 'Operações'],
    ['/restaurant/demands/example', undefined, 'Operações'],
    ['/restaurant/candidates', 'Talentos', 'Talentos'],
    ['/restaurant/candidates', 'Mensagens', 'Mensagens'],
    ['/restaurant/messages', 'Mensagens', 'Mensagens'],
    ['/chat/a', undefined, 'Mensagens'],
    ['/restaurant/team', undefined, 'Equipe'],
    ['/restaurant/profile/edit', undefined, 'Mais'],
    ['/restaurant/history', undefined, 'Mais'],
  ]) {
    pathname = path;
    const html = renderToStaticMarkup(React.createElement(Nav, { role: 'restaurant', activeItem }));
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1, path);
    assert.match(html, new RegExp(`aria-current="page" aria-label="${expected}"`));
  }
});

test('Home groups staffing alerts and future demands without exposing staffing counters', async () => {
  const db = database();
  db.jobs = Array.from({ length: 20 }, (_, i) => job(`team-${i}`, { demand_id: 'team', status: i < 18 ? 'filled' : 'open' }));
  db.applications = Array.from({ length: 18 }, (_, i) => ({ job_id: `team-${i}`, worker_id: `worker-${i}`, status: 'approved' }));
  db.messages = [];
  const app = mount(db);
  try {
    await app.flush();
    assert.equal((app.html().match(/Equipe incompleta/g) ?? []).length, 1);
    assert.doesNotMatch(app.html(), /18 profissionais confirmados · 20 necessários/);
    assert.match(app.html(), /href="\/restaurant\/demands\/team"/);
    assert.equal((app.html().match(/href="\/restaurant\/demands\/team"/g) ?? []).length,2);
  } finally { app.unmount(); }
});
