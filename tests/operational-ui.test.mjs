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
  globalThis.window = {
    location: { search: '' },
    setInterval: () => 1, clearInterval() {},
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
  };
  const state = [], effects = [];
  let cursor, effectCursor, tree, dirty = true;
  const db = {
    value: initial, failure: null, calls: [], pendingReviews: [], navigation: [],
    auth: { getUser: async () => ({ data: { user: { id: 'company' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    async rpc(name, args) {
      db.calls.push({ name, args });
      if (name === 'pending_operational_reviews') return { data: db.pendingReviews, error: null };
      return name === 'operational_context' ? { data: db.value, error: null }
        : db.failure ? { data: db.failure, error: null } : { data: db.value, error: null };
    },
  };
  const Component = load(file, {
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
  }).default;
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(item => elements(item));
    return [node, ...elements(node.props?.children)];
  }
  return {
    db, elements: () => elements(tree),
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
    app.db.value = context({ code: 'A1B2C3D4', code_expires_at: '2099-01-01T00:00:00Z' });
    app.button('Realizar Check-in').props.onClick();
    await app.flush();
    assert.match(app.html(), /A1B2C3D4/);
    assert.equal(app.db.calls.at(-1).name, 'issue_operational_code');
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
    assert.match(company.html(), /Código incorreto/);
    assert.doesNotMatch(company.html(), /Check-in confirmado/);
  } finally { company.unmount(); }
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

test('publication persists before optional invitations and skipping never republishes or hires', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  try {
    await app.flush();
    const amount = app.elements().find(node => node.type === ui.TextInput && node.props.type === 'number' && node.props.id !== 'demand-quantity');
    assert.ok(amount);
    amount.props.onChange({ target: { value: '150' } });
    await app.flush();
    await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await app.flush();
    assert.match(app.html(), /Demanda publicada com sucesso/);
    assert.match(app.html(), /href="\/restaurant\/demands\/published-demand\?view=talents"/);
    assert.match(app.html(), /Convidar Agora/);
    app.button('Pular').props.onClick();
    assert.deepEqual(app.db.navigation, ['/restaurant/demands/published-demand']);
    assert.deepEqual(app.db.calls.map(call => call.name), ['pending_operational_reviews', 'create_restaurant_demand']);
    assert.equal(app.db.calls.at(-1).args.p_value, 150);
    assert.equal(app.db.calls.at(-1).args.p_quantity, 1);
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
