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
  new Function('require', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const operations = load('../lib/operations.ts');
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts'),
});
const OperationFlow = load('../app/components/operation-flow.tsx', {
  '@/lib/operations': operations,
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
}).default;
const context = (overrides = {}) => ({
  job_id: 'job', demand_id: 'demand', title: 'Garçom', location: 'Salão',
  starts_at: '2026-10-17T18:00:00-03:00', ends_at: '2026-10-17T23:00:00-03:00',
  role: 'worker', worker_name: 'Profissional', phase: 'checkin', amount: 150,
  checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null,
  code: null, code_expires_at: null, has_code: false, review_pending: false, ...overrides,
});
function mount(initial, file = '../app/components/operational-panel.tsx') {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  let interval;
  globalThis.window = {
    location: { search: '' },
    setInterval: callback => { interval = callback; return 1; }, clearInterval() {},
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  const state = [], effects = [];
  let cursor, effectCursor, tree, dirty = true;
  const db = {
    value: initial, failure: null, rpcError: null, geocodingError: null, calls: [], queries: [], pendingReviews: [], navigation: [], geocoded: [],
    gpsCalls: 0, gpsError: null, coordinates: { latitude: -23.5, longitude: -46.6, accuracy: 10 },
    auth: { getUser: async () => ({ data: { user: { id: 'company' } }, error: null }) },
    from: (table) => {
      db.queries.push(table);
      return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    },
    async rpc(name, args) {
      db.calls.push({ name, args });
      if (name === 'pending_operational_reviews') return { data: db.pendingReviews, error: null };
      if (db.rpcError) return { data: null, error: db.rpcError };
      if (name === 'save_geocoded_work_location') return { data: {
        id: 'operation-location', revision: 1, geocoding_status: 'resolved', latitude: -23.5, longitude: -46.6,
      }, error: null };
      if (name === 'save_work_location') return { data: {
        id: 'operation-location', revision: 1, geocoding_status: 'pending', latitude: null, longitude: null,
      }, error: null };
      if (name === 'create_restaurant_demand') return { data: 'published-demand', error: null };
      return name === 'operational_context' ? { data: db.value, error: null }
        : db.failure ? { data: db.failure, error: null } : { data: db.value, error: null };
    },
  };
  const Component = load(file, {
    '@/app/components/operation-flow': { default: OperationFlow },
    '@/app/components/professional-verification': { default: () => null },
    react: {
      ...React,
      useState(initialValue) {
        const i = cursor++;
        if (!(i in state)) state[i] = typeof initialValue === 'function' ? initialValue() : initialValue;
        return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; dirty = true; }];
      },
      useEffect(callback, deps) {
        const i = effectCursor++;
        if (!effects[i] || deps.some((value, index) => value !== effects[i].deps[index])) {
          effects[i]?.cleanup?.();
          effects[i] = { callback, deps, pending: true };
        }
      },
    },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useRouter: () => ({ push: url => db.navigation.push(url), refresh() {} }) },
    '@/app/components/ui': ui,
    '@/app/components/mobile-bottom-nav': { default: () => null },
    '@/lib/supabase/client': { createClient: () => db },
    '@/lib/operations': operations,
    '@/lib/demands': load('../lib/demands.ts'),
    '@/lib/geolocation': {
      getDeviceCoordinates: async () => {
        db.gpsCalls++;
        if (db.gpsError) throw new Error(db.gpsError);
        return db.coordinates;
      },
    },
    '@/lib/work-location': {
      emptyWorkLocation: { location_name: '', address: '', number: '', neighborhood: '', city: '', state: '', postal_code: '', latitude: null, longitude: null },
      validCoordinates: (latitude, longitude) => Number.isFinite(latitude) && Math.abs(latitude) <= 90
        && Number.isFinite(longitude) && Math.abs(longitude) <= 180,
      resolveWorkLocation: async location => {
        db.geocoded.push(location);
        if (db.geocodingError) return { ...location, latitude: null, longitude: null };
        return { ...location, latitude: -23.5, longitude: -46.6 };
      },
    },
    '@/lib/specialties': { commonSpecialties: ['Garçom', 'Eventos', 'Bar', 'Buffet', 'Atendimento', 'Cozinha', 'Auxiliar', 'Bartender'] },
  }).default;
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(item => elements(item));
    return [node, ...elements(node.props?.children)];
  }
  return {
    db, elements: () => elements(tree),
    refresh: () => { interval(); listeners.get('focus')(); },
    html: () => renderToStaticMarkup(tree),
    button(label) {
      const button = elements(tree).find(node => node.type === ui.Button && node.props.children === label);
      assert.ok(button, `expected action: ${label}`);
      return button;
    },
    async flush() {
      for (let i = 0; i < 10; i++) {
        if (dirty) {
          dirty = false; cursor = effectCursor = 0;
          tree = Component({ jobId: 'job' });
          effects.forEach(effect => {
            if (effect.pending) { effect.pending = false; effect.cleanup = effect.callback(); }
          });
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(dirty, false);
    },
    unmount() {
      effects.forEach(effect => effect.cleanup?.());
      assert.equal(listeners.size, 0);
      globalThis.window = previousWindow;
    },
  };
}

test('shared operation timeline gates every stage identically for both roles', () => {
  const end = new Date('2026-10-18T03:00:00-03:00');
  const assignment = { checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null };
  for (const role of ['worker', 'restaurant']) {
    const input = { jobId: 'job', role, hired: true, assignment, endsAt: end, now: end };
    const render = (changes = {}) => renderToStaticMarkup(React.createElement(OperationFlow, { ...input, ...changes }));
    let flow = operations.getOperationFlow({ ...input, hired: false });
    assert.equal(flow.chatHref, null);
    assert.equal(flow.action, null);
    assert.deepEqual(flow.steps.map((step) => step.state), ['done', 'current', 'locked', 'locked', 'locked', 'locked']);
    assert.doesNotMatch(render({ hired: false }), /href="\/(?:chat|checkin|payment|checkout)\//);
    flow = operations.getOperationFlow({ ...input, assignment: null });
    assert.equal(flow.action, null);
    assert.match(flow.status, /indisponível/);
    flow = operations.getOperationFlow(input);
    assert.equal(flow.action.href, '/checkin/job');
    assert.equal(flow.chatHref, '/chat/job');
    assert.doesNotMatch(render(), /href="\/(?:payment|checkout)\//);
    const checkedIn = { ...assignment, checkin_at: '2026-10-17T23:00:00-03:00' };
    flow = operations.getOperationFlow({ ...input, assignment: checkedIn, now: new Date(end.getTime() - 1) });
    assert.equal(flow.action.href, '/checkin/job');
    flow = operations.getOperationFlow({ ...input, assignment: checkedIn });
    assert.equal(flow.action.href, '/payment/job');
    const paid = { ...checkedIn, paid_at: end.toISOString() };
    assert.equal(operations.getOperationFlow({ ...input, assignment: paid }).action.href, '/payment/job');
    assert.doesNotMatch(render({ assignment: paid }), /href="\/checkout\//);
    const disputed = { ...paid, payment_disputed_at: end.toISOString() };
    flow = operations.getOperationFlow({ ...input, assignment: disputed });
    assert.equal(flow.status, 'Pagamento não recebido');
    assert.equal(flow.action.href, '/payment/job');
    if (role === 'restaurant') assert.equal(flow.action.label, 'Confirmar Pagamento');
    const received = { ...paid, receipt_confirmed_at: end.toISOString() };
    assert.equal(operations.getOperationFlow({ ...input, assignment: received }).action.href, '/checkout/job');
    assert.equal(operations.getOperationFlow({ ...input, assignment: received }).steps[4].state, 'current');
    const completed = { ...received, checkout_at: end.toISOString() };
    assert.ok(operations.getOperationFlow({ ...input, assignment: completed }).steps.every((step) => step.state === 'done'));
    for (const interruption of ['cancelled', 'absent', 'abandoned']) {
      flow = operations.getOperationFlow({ ...input, assignment: { ...checkedIn, interruption } });
      assert.equal(flow.action, null);
      assert.equal(flow.chatHref, null);
      assert.doesNotMatch(render({ assignment: { ...checkedIn, interruption } }), /href="\/(?:chat|checkin|payment|checkout)\//);
    }
    assert.deepEqual([...render().matchAll(/<li[^>]*>[\s\S]*?<p[^>]*>([^<]+)/g)].map((match) => match[1]),
      ['Operação', 'Contratação', 'Check-in', 'Pagamento', 'Checkout', 'Conclusão']);
  }
});

test('operational context refresh failures remove stale actionable controls', async () => {
  const app = mount(context({ role: 'restaurant', phase: 'payment', checkin_at: '2026-10-17T18:00:00-03:00' }));
  try {
    await app.flush();
    assert.match(app.html(), /Confirmar Pagamento/);
    app.db.rpcError = { message: 'Estado indisponível' };
    app.refresh();
    await app.flush();
    assert.match(app.html(), /Estado indisponível/);
    assert.doesNotMatch(app.html(), /Confirmar Pagamento|href="\/chat\//);
  } finally { app.unmount(); }
});

test('next action respects overnight time boundaries, receipt, checkout and interruptions', () => {
  const start = new Date('2026-10-17T23:00:00-03:00'), end = new Date('2026-10-18T03:00:00-03:00');
  const assignment = { job_id: 'job', checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null, interruption: null };
  const action = (at, changes = {}, role = 'worker') => operations.operationNextAction({ ...assignment, ...changes }, start, end, role, new Date(at));
  assert.equal(action('2026-10-17T22:59:59-03:00').label, 'Ver confirmação');
  assert.equal(action('2026-10-17T23:05:00-03:00').label, 'Realizar Check-in');
  assert.equal(action('2026-10-17T23:05:01-03:00').label, 'Conferir chegada');
  assert.equal(action('2026-10-18T02:59:59-03:00', { checkin_at: start }).label, 'Trabalho em andamento');
  assert.equal(action('2026-10-18T03:00:00-03:00', { checkin_at: start }).label, 'Aguardando pagamento');
  assert.equal(action(end, { checkin_at: start }, 'restaurant').label, 'Confirmar Pagamento');
  assert.equal(action(end, { checkin_at: start, paid_at: end }).label, 'Confirmar recebimento');
  assert.equal(action(end, { checkin_at: start, receipt_confirmed_at: end }).href, '/checkout/job');
  assert.equal(action(end, { checkout_at: end }).label, 'Ver conclusão');
  assert.equal(action(end, { interruption: 'absent' }).href, '/checkin/job');
  assert.throws(() => operations.readOperationalContext({ error: 'Código expirado' }), /Código expirado/);
  assert.throws(() => operations.readOperationalContext(null), /não retornou/);
});

test('worker emits arrival code, company validates it and errors never become success', async () => {
  const app = mount(context());
  try {
    await app.flush();
    assert.doesNotMatch(app.html(), /id="operational-code"/);
    assert.equal(app.db.gpsCalls, 0);
    app.db.value = context({ code: 'A1B2C3D4', code_expires_at: '2099-01-01T00:00:00Z' });
    app.button('Realizar Check-in').props.onClick();
    await app.flush();
    assert.match(app.html(), /A1B2C3D4/);
    assert.equal(app.db.calls.at(-1).name, 'issue_operational_code');
    assert.equal(app.db.gpsCalls, 1);
    assert.deepEqual(app.db.calls.at(-1).args, {
      p_job_id: 'job', p_stage: 'checkin', p_latitude: -23.5, p_longitude: -46.6,
    });
  } finally { app.unmount(); }
  const company = mount(context({ role: 'restaurant', has_code: true }));
  try {
    await company.flush();
    assert.match(company.html(), /id="operational-code"/);
    assert.doesNotMatch(company.html(), /A1B2C3D4/);
    company.db.failure = { error: 'Código incorreto' };
    company.elements().find(node => node.type === ui.TextInput).props.onChange({ target: { value: 'deadbeef' } });
    await company.flush();
    company.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await company.flush();
    assert.equal(company.db.calls.at(-1).args.p_code, 'DEADBEEF');
    assert.equal(company.db.gpsCalls, 0);
    assert.match(company.html(), /Código incorreto/);
    assert.doesNotMatch(company.html(), /Check-in confirmado/);
  } finally { company.unmount(); }
});

test('GPS failure prevents issuing a check-in code and allows a fresh retry', async () => {
  for (const message of [
    'Permita o acesso à localização para utilizar este recurso.',
    'Não foi possível obter sua localização a tempo. Tente novamente.',
    'Não foi possível obter sua localização. Verifique o GPS e tente novamente.',
  ]) {
    const app = mount(context());
    try {
      await app.flush();
      app.db.gpsError = message;
      app.button('Realizar Check-in').props.onClick();
      await app.flush();
      assert.ok(app.html().includes(message));
      assert.equal(app.db.calls.filter(call => call.name === 'issue_operational_code').length, 0);
      assert.equal(app.button('Realizar Check-in').props.busy, false);
      app.db.gpsError = null;
      app.db.rpcError = { message: 'Você está fora do raio de 100 metros do local da operação.' };
      app.button('Realizar Check-in').props.onClick();
      await app.flush();
      assert.match(app.html(), /fora do raio de 100 metros/);
      assert.doesNotMatch(app.html(), /Código gerado/);
      assert.equal(app.db.gpsCalls, 2);
    } finally { app.unmount(); }
  }
});

test('existing check-in codes, refresh and checkout never request GPS', async () => {
  const existing = mount(context({ code: 'A1B2C3D4', code_expires_at: '2099-01-01T00:00:00Z' }));
  try {
    await existing.flush();
    assert.match(existing.html(), /A1B2C3D4/);
    existing.refresh();
    await existing.flush();
    assert.equal(existing.db.gpsCalls, 0);
  } finally { existing.unmount(); }
  const company = mount(context({ role: 'restaurant', phase: 'checkout' }));
  try {
    await company.flush();
    company.db.gpsError = 'GPS indisponível';
    company.button('Gerar código de Checkout').props.onClick();
    await company.flush();
    assert.equal(company.db.gpsCalls, 0);
    assert.deepEqual(company.db.calls.at(-1).args, { p_job_id: 'job', p_stage: 'checkout' });
  } finally { company.unmount(); }
  const worker = mount(context({ phase: 'checkout' }));
  try {
    await worker.flush();
    worker.elements().find(node => node.type === ui.TextInput).props.onChange({ target: { value: 'deadbeef' } });
    await worker.flush();
    worker.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await worker.flush();
    assert.equal(worker.db.gpsCalls, 0);
    assert.deepEqual(worker.db.calls.at(-1).args, {
      p_job_id: 'job', p_stage: 'checkout', p_code: 'DEADBEEF',
    });
  } finally { worker.unmount(); }
});

test('assisted absence confirmation is visible outside collapsed secondary actions', async () => {
  const app = mount(context({ role: 'restaurant', phase: 'absence_pending' }));
  try {
    await app.flush();
    app.button('Confirmar Ausência').props.onClick();
    await app.flush();
    const confirmation = app.elements().find(node => node.props?.role === 'alert' && /Confirmar/.test(renderToStaticMarkup(node)));
    assert.ok(confirmation);
    for (const details of app.elements().filter(node => node.type === 'details')) {
      assert.doesNotMatch(renderToStaticMarkup(details), /Confirmar ocorrência/);
    }
    app.button('Voltar').props.onClick();
    await app.flush();
    assert.doesNotMatch(app.html(), /Confirmar ocorrência/);
    assert.equal(app.db.calls.length, 1, 'opening and cancelling confirmation never interrupts work');
  } finally { app.unmount(); }
});

test('worker receipt confirmation unlocks checkout validation without exposing the company code', async () => {
  const app = mount(context({ phase: 'receipt', paid_at: '2026-10-18T02:00:00Z' }));
  try {
    await app.flush();
    assert.doesNotMatch(app.html(), /Validar Checkout/);
    app.db.value = context({ phase: 'payment_disputed', paid_at: '2026-10-18T02:00:00Z' });
    app.button('Não Recebi').props.onClick();
    await app.flush();
    assert.match(app.html(), /checkout permanece bloqueado/);
    assert.doesNotMatch(app.html(), /Validar Checkout/);
    app.db.value = context({ phase: 'checkout', receipt_confirmed_at: '2026-10-18T02:05:00Z', has_code: true });
    app.button('Recebi').props.onClick();
    await app.flush();
    assert.equal(app.db.gpsCalls, 0);
    assert.match(app.html(), /Recebimento confirmado. Checkout liberado/);
    assert.match(app.html(), /Validar Checkout/);
    assert.doesNotMatch(app.html(), /Gerar código de Checkout/);
  } finally { app.unmount(); }
});

test('interrupted work has a return path but no unauthorized chat or active operations', async () => {
  const app = mount(context({ phase: 'absent' }));
  try {
    await app.flush();
    assert.match(app.html(), /href="\/worker\/applications"/);
    assert.doesNotMatch(app.html(), /href="\/chat\/job"|Realizar Check-in|Confirmar Pagamento|Validar Checkout/);
  } finally { app.unmount(); }
});

test('urgent publication warns about its reduced window, but publication at start is blocked', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T09:00:00-03:00') });
  for (const time of ['09:00:00','10:00:00']) {
    t.mock.timers.setTime(new Date(`2026-11-12T${time}-03:00`).getTime());
    const app = mount('published-demand','../app/restaurant/dashboard/jobs/create/page.tsx');
    try {
      await app.flush();
      const fields = {
        'operation-role':'Garçom','operation-date':'2026-11-12','operation-start-time':'10:00','operation-end-time':'18:00',
        'operation-daily-rate':'150','operation-street':'Rua das Flores','operation-number':'120',
        'operation-city':'São Paulo','operation-state':'SP','operation-details':'Operação urgente',
      };
      for (const [id,value] of Object.entries(fields)) app.elements().find(node => node.props.id===id).props.onChange({target:{value}});
      await app.flush();
      if (time==='09:00:00') assert.match(app.html(),/Publicação urgente.*janela de recrutamento é reduzida/);
      await app.elements().find(node => node.type==='form').props.onSubmit({preventDefault(){}});
      await app.flush();
      assert.equal(app.db.calls.some(call => call.name==='create_restaurant_demand'),time==='09:00:00');
      assert.match(app.html(),time==='09:00:00' ? /Operação publicada com sucesso/ : /antes do horário de início/);
    } finally { app.unmount(); }
  }
});

test('publication persists before optional invitations and skipping never republishes or hires', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  try {
    await app.flush();
    const fields = {
      'operation-role': 'Garçom',
      'operation-date': '2099-01-01',
      'operation-start-time': '18:00',
      'operation-end-time': '23:00',
      'operation-daily-rate': '150',
      'operation-street': 'Rua das Flores',
      'operation-number': '120',
      'operation-city': 'São Paulo',
      'operation-state': 'SP',
      'operation-details': 'Detalhes do plantão',
    };
    for (const [id, value] of Object.entries(fields)) {
      const input = app.elements().find(node => node.props.id === id);
      assert.ok(input, id);
      input.props.onChange({ target: { value } });
    }
    await app.flush();
    assert.match(app.html(), /Publicar Operação/);
    await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await app.flush();
    assert.match(app.html(), /Operação publicada com sucesso/);
    assert.match(app.html(), /href="\/restaurant\/demands\/published-demand\?view=talents"/);
    assert.match(app.html(), /Convidar Agora/);
    app.button('Pular').props.onClick();
    assert.deepEqual(app.db.navigation, ['/restaurant/demands/published-demand']);
    assert.deepEqual(app.db.calls.map(call => call.name), ['pending_operational_reviews', 'save_geocoded_work_location', 'create_restaurant_demand']);
    assert.equal(app.db.calls.at(-1).args.p_value, 150);
    assert.equal(Object.hasOwn(app.db.calls.at(-1).args, 'p_quantity'), false);
    assert.equal(app.db.calls.at(-1).args.p_title, 'Garçom');
    assert.equal(app.db.calls.at(-1).args.p_description, 'Detalhes do plantão');
    assert.equal(app.db.calls.at(-1).args.p_location_source, 'catalog');
    assert.equal(app.db.calls.at(-1).args.p_work_location_id, 'operation-location');
    assert.equal(app.db.calls.at(-1).args.p_location_revision, 1);
    assert.equal(Object.hasOwn(app.db.calls.at(-1).args, 'p_event_id'), false);
    assert.deepEqual(app.db.geocoded, [{
      location_name: 'Local da Operação', address: 'Rua das Flores', number: '120', neighborhood: '',
      city: 'São Paulo', state: 'SP', postal_code: '', latitude: null, longitude: null,
    }]);
    assert.deepEqual(app.db.calls.at(-2).args, {
      p_name: 'Local da Operação', p_address: 'Rua das Flores', p_number: '120',
      p_city: 'São Paulo', p_state: 'SP', p_latitude: -23.5, p_longitude: -46.6,
    });
    assert.deepEqual(app.db.queries, []);
  } finally { app.unmount(); }
});

test('pending reviews block the creation form without blocking access to the evaluation', async () => {
  const app = mount(null, '../app/restaurant/dashboard/jobs/create/page.tsx');
  app.db.pendingReviews = [{ job_id: 'previous', title: 'Turno anterior', reviewed_name: 'Profissional' }];
  try {
    await app.flush();
    assert.match(app.html(), /href="\/reviews\/previous"/);
    assert.doesNotMatch(app.html(), /<form|Convidar Agora/);
    assert.deepEqual(app.db.calls.map(call => call.name), ['pending_operational_reviews']);
  } finally { app.unmount(); }
});

test('operation publication uses existing specialty and work-location contracts for one vacancy', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  globalThis.window.location.search = '?event=old-event&event_id=old-event';
  try {
    await app.flush();
    assert.doesNotMatch(app.html(), />[^<]*(?:Evento|Agenda|demanda|Demanda|Profissionais necessários|quantidade de profissionais)/);
    assert.match(app.html(), /Publique uma oportunidade e receba candidaturas de profissionais disponíveis/);
    assert.match(app.html(), /Quando\?/);
    assert.match(app.html(), /Local da Operação/);
    assert.doesNotMatch(app.html(), /CEP|Bairro|País|Latitude|Longitude|endereço principal/);
    const date = app.elements().find(node => node.type === ui.TextInput && node.props.type === 'date');
    assert.equal(date.props.value, '');
    const fields = {
      'operation-role': 'Garçom',
      'operation-date': '2099-01-01',
      'operation-start-time': '22:00',
      'operation-end-time': '03:00',
      'operation-daily-rate': '180',
      'operation-street': 'Rua das Flores',
      'operation-number': '120',
      'operation-city': 'São Paulo',
      'operation-state': 'SP',
      'operation-details': 'Informações da operação',
    };
    for (const [id, value] of Object.entries(fields)) {
      const input = app.elements().find(node => node.props.id === id);
      assert.ok(input, id);
      input.props.onChange({ target: { value } });
    }
    await app.flush();
    await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await app.flush();
    assert.deepEqual(app.db.calls.at(-2), { name: 'save_geocoded_work_location', args: {
      p_name: 'Local da Operação', p_address: 'Rua das Flores', p_number: '120',
      p_city: 'São Paulo', p_state: 'SP', p_latitude: -23.5, p_longitude: -46.6,
    } });
    assert.deepEqual(app.db.calls.at(-1), { name: 'create_restaurant_demand', args: {
      p_title: 'Garçom', p_description: 'Informações da operação', p_job_date: '2099-01-01',
      p_start_time: '22:00', p_end_time: '03:00', p_value: 180,
      p_location_source: 'catalog', p_work_location_id: 'operation-location', p_location_revision: 1,
    } });
    assert.deepEqual(app.db.queries, []);
    assert.match(app.html(), /Operação publicada com sucesso/);
  } finally { app.unmount(); }
});

test('work-location persistence errors remain visible and never publish without the submitted location', async () => {
  const app = mount(null, '../app/restaurant/dashboard/jobs/create/page.tsx');
  app.db.rpcError = { message: 'Não foi possível salvar o local informado.' };
  try {
    await app.flush();
    const amount = app.elements().find(node => node.type === ui.TextInput && node.props.id === 'operation-daily-rate');
    amount.props.onChange({ target: { value: '150' } });
    await app.flush();
    await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await app.flush();
    assert.match(app.html(), /Não foi possível salvar o local informado/);
    assert.doesNotMatch(app.html(), /Operação publicada com sucesso/);
    assert.equal(app.db.calls.filter(call => call.name === 'create_restaurant_demand').length, 0);
    assert.equal(app.db.calls.at(-1).name, 'save_geocoded_work_location');
    assert.equal(app.elements().find(node => node.type === 'fieldset').props.disabled, false);
  } finally { app.unmount(); }
});

test('operation is published with its address when geocoding fails', async () => {
  const app = mount(null, '../app/restaurant/dashboard/jobs/create/page.tsx');
  app.db.geocodingError = 'Endereço não localizado.';
  try {
    await app.flush();
    const fields = {
      'operation-role': 'Garçom',
      'operation-date': '2099-01-01',
      'operation-start-time': '18:00',
      'operation-end-time': '23:00',
      'operation-daily-rate': '150',
      'operation-street': 'Rua Inexistente',
      'operation-number': '120',
      'operation-city': 'São Paulo',
      'operation-state': 'SP',
      'operation-details': 'Informações da operação',
    };
    for (const [id, value] of Object.entries(fields)) {
      app.elements().find(node => node.props.id === id).props.onChange({ target: { value } });
    }
    await app.flush();
    await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await app.flush();
    assert.match(app.html(), /Operação publicada com sucesso/);
    assert.equal(app.db.calls.filter(call => call.name === 'save_geocoded_work_location').length, 0);
    const saveCall = app.db.calls.find(call => call.name === 'save_work_location');
    assert.deepEqual(saveCall.args, {
      p_name: 'Local da Operação',
      p_address: 'Rua Inexistente',
      p_number: '120',
      p_neighborhood: '',
      p_city: 'São Paulo',
      p_state: 'SP',
      p_postal_code: '',
    });
    const createCall = app.db.calls.find(call => call.name === 'create_restaurant_demand');
    assert.equal(createCall.args.p_location_source, 'catalog');
    assert.equal(createCall.args.p_work_location_id, 'operation-location');
    assert.equal(createCall.args.p_location_revision, 1);
  } finally { app.unmount(); }
});
