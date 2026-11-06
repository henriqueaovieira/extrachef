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
const demandDomain = load('../lib/demands.ts');
const coreAssignment = (changes = {}) => ({
  id: 'assignment0', job_id: 'job0', worker_id: 'worker0', checkin_at: null,
  paid_at: null, payment_disputed_at: null, receipt_confirmed_at: null, checkout_at: null,
  interruption: null, interrupted_at: null, replacement_job_id: null, ...changes,
});
function coreInput({ assignments = [coreAssignment()], required = 1, now = '2026-10-17T15:00:00Z', completed = false, ...changes } = {}) {
  const jobs = Array.from({ length: required }, (_, index) => ({
    id: `job${index}`, demand_id: 'operation', demand_revision: 0, title: 'Operação',
    job_date: '2026-10-17', start_time: '10:00:00', end_time: '18:00:00',
    status: completed ? 'completed' : assignments.some((item) => item.job_id === `job${index}` && !item.interruption) ? 'filled' : 'open',
    location_status: 'ready', work_latitude: -23, work_longitude: -46, value: 150,
  }));
  const applications = assignments.filter((item) => jobs.some((job) => job.id === item.job_id))
    .map((item) => ({ job_id: item.job_id, worker_id: item.worker_id, status: item.interruption ? item.interruption : completed ? 'completed' : 'approved' }));
  return {
    demand: demandDomain.buildDemands(jobs, applications, [], new Date(now))[0], assignments,
    windows: new Map(jobs.map((job) => [job.id, demandDomain.demandWindow(job)])),
    now: new Date(now), canHire: true, canRecruit: true, ...changes,
  };
}
const checkedIn = { checkin_at: '2026-10-17T13:00:00Z' };
const received = { ...checkedIn, paid_at: '2026-10-17T21:00:00Z', receipt_confirmed_at: '2026-10-17T21:01:00Z' };
const finished = { ...received, checkout_at: '2026-10-17T21:02:00Z' };
const ended = '2026-10-17T22:00:00Z';

for (const [name, options, expected] of [
  ['future', { now: '2026-10-17T12:00:00Z' }, 'Planejada'],
  ['incomplete', { required: 2 }, 'Preparação'],
  ['active checkin', { assignments: [coreAssignment(checkedIn)] }, 'Em andamento'],
  ['checkout pending', { now: ended, assignments: [coreAssignment(received)] }, 'Encerramento'],
  ['financial pending', { now: ended, assignments: [coreAssignment(checkedIn)] }, 'Financeiro'],
  ['completed', { now: ended, completed: true, assignments: [coreAssignment(finished)] }, 'Finalizada'],
  ['financial beats checkout', { now: ended, required: 2, assignments: [
    coreAssignment(received), coreAssignment({ ...checkedIn, id: 'assignment1', job_id: 'job1', worker_id: 'worker1' }),
  ] }, 'Financeiro'],
  ['completed beats residual financial data', { now: ended, completed: true, assignments: [
    coreAssignment({ ...checkedIn, checkout_at: finished.checkout_at }),
  ] }, 'Finalizada'],
]) test(`operation core state: ${name}`, () => {
  const input = coreInput(options);
  const original = structuredClone(input);
  assert.equal(operations.getOperationState(input), expected);
  assert.deepEqual(input, original);
});

for (const [name, options, kind, href] of [
  ['financial beats checkout', { now: ended, required: 2, assignments: [
    coreAssignment(received), coreAssignment({ ...checkedIn, id: 'assignment1', job_id: 'job1', worker_id: 'worker1' }),
  ] }, 'financial', '/payment/job1'],
  ['checkout beats checkin', { now: ended, required: 2, assignments: [
    coreAssignment(received), coreAssignment({ id: 'assignment1', job_id: 'job1', worker_id: 'worker1' }),
  ] }, 'checkout', '/checkout/job0'],
  ['checkin beats hiring', { required: 2 }, 'checkin', '/checkin/job0'],
]) test(`operation core action priority: ${name}`, () => {
  const input = coreInput(options);
  const action = operations.getOperationContinuation(input);
  assert.equal(action.kind, kind);
  assert.equal(action.action.href, href);
  assert.deepEqual(action, operations.getOperationContinuation({ ...input, assignments: [...input.assignments].reverse() }));
});

for (const [name, assignment, expected] of [
  ['on time', checkedIn, 'present'],
  ['late', { checkin_at: '2026-10-17T13:05:01Z' }, 'late'],
  ['pending is not absent', {}, 'pending'],
  ['confirmed absence', { interruption: 'absent', interrupted_at: '2026-10-17T13:10:00Z' }, 'absent'],
  ['checkout overrides arrival', finished, 'finished'],
]) test(`operation core presence: ${name}`, () => {
  const summary = operations.getOperationSummary(coreInput({ assignments: [coreAssignment(assignment)], now: ended }));
  assert.equal(summary.available, true);
  assert.equal(summary.participants.length, 1);
  assert.equal(summary.participants[0].presence, expected);
  assert.equal(summary.absences, expected === 'absent' ? 1 : 0);
});

for (const [name, options, label] of [
  ['no team', { assignments: [] }, 'Contratar profissionais'],
  ['incomplete team', { required: 2, now: '2026-10-17T12:00:00Z' }, 'Completar equipe'],
  ['pending checkin', {}, 'Realizar check-ins'],
  ['active', { assignments: [coreAssignment(checkedIn)] }, 'Acompanhar operação'],
  ['pending checkout', { now: ended, assignments: [coreAssignment(received)] }, 'Finalizar participantes'],
  ['pending financial', { now: ended, assignments: [coreAssignment(checkedIn)] }, 'Regularizar pagamentos'],
  ['completed', { now: ended, completed: true, assignments: [coreAssignment(finished)] }, 'Encerrar acompanhamento'],
]) test(`operation core continuation: ${name}`, () => {
  assert.equal(operations.getOperationContinuation(coreInput(options)).label, label);
});

test('operation core summary preserves replacements, scopes rows and counts real zero without duplication', () => {
  const previous = coreAssignment({ id: 'previous', worker_id: 'previous', interruption: 'absent', interrupted_at: '2026-10-17T13:10:00Z' });
  const current = coreAssignment(checkedIn);
  const input = coreInput({ assignments: [previous, current, { ...current }, coreAssignment({ job_id: 'foreign' })] });
  const summary = operations.getOperationSummary(input);
  assert.equal(summary.available, true);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.present, 1);
  assert.equal(summary.arrivalsPending, 0);
  assert.equal(summary.absences, 1);
  assert.equal(summary.checkouts, 0);
  assert.equal(summary.participants.length, 2);
  assert.equal(operations.getOperationState(input), 'Em andamento');
  assert.equal(operations.getOperationContinuation(input).kind, 'working');
});

test('operation core respects exact tolerance and does not infer absence or active work from the clock', () => {
  const onBoundary = coreInput({ now: '2026-10-17T13:05:00Z' });
  assert.equal(operations.getOperationSummary(onBoundary).arrivalsPending, 0);
  onBoundary.now = new Date('2026-10-17T13:05:00.001Z');
  assert.equal(operations.getOperationSummary(onBoundary).arrivalsPending, 1);
  assert.equal(operations.getOperationSummary(onBoundary).absences, 0);
  assert.equal(operations.getOperationState(onBoundary), 'Preparação');
  assert.equal(operations.getOperationSummary(coreInput({ assignments: [
    coreAssignment({ checkin_at: '2026-10-17T13:05:00Z' }),
  ] })).participants[0].presence, 'present');
  const completedLate = operations.getOperationSummary(coreInput({ now: ended, assignments: [
    coreAssignment({ ...finished, checkin_at: '2026-10-17T13:05:01Z' }),
  ] }));
  assert.equal(completedLate.participants[0].presence, 'finished');
  assert.equal(completedLate.participants[0].late, true);
  assert.equal(completedLate.present, 0);
  const interrupted = operations.getOperationSummary(coreInput({ assignments: [
    coreAssignment({ ...checkedIn, interruption: 'abandoned', interrupted_at: '2026-10-17T14:00:00Z' }),
  ] }));
  assert.equal(interrupted.participants[0].presence, 'interrupted');
  assert.equal(interrupted.present, 0);
  assert.equal(interrupted.absences, 0);
});

test('operation core fails closed for missing, conflicting or unavailable operational data', () => {
  const missing = coreInput();
  missing.assignments = [];
  for (const input of [
    missing, coreInput({ unavailable: true }),
    coreInput({ windows: new Map() }),
    coreInput({ now: 'invalid' }),
    coreInput({ assignments: [coreAssignment({ checkin_at: 'invalid' })] }),
    coreInput({ assignments: [coreAssignment(), coreAssignment(checkedIn)] }),
    coreInput({ assignments: [coreAssignment(), coreAssignment({ id: 'another', worker_id: 'another' })] }),
  ]) {
    assert.equal(operations.getOperationSummary(input).available, false);
    assert.equal(operations.getOperationState(input), null);
    assert.equal(operations.getOperationContinuation(input).kind, 'unavailable');
    assert.equal(operations.getOperationContinuation(input).action, null);
  }
});

test('operation core does not hide an open participant behind a terminal demand snapshot', () => {
  const input = coreInput({ now: ended, completed: true, assignments: [coreAssignment(checkedIn)] });
  assert.equal(operations.getOperationState(input), 'Financeiro');
  assert.equal(operations.getOperationContinuation(input).kind, 'financial');
  input.assignments[0].checkout_at = finished.checkout_at;
  assert.equal(operations.getOperationSummary(input).financial.length, 1);
  assert.equal(operations.getOperationState(input), 'Finalizada');
  assert.equal(operations.getOperationContinuation(input).kind, 'completed');
});

test('operation core preserves incidents, closed hiring gates, reviews and payment ownership', () => {
  const incident = coreInput({ assignments: [coreAssignment({ interruption: 'absent', interrupted_at: '2026-10-17T13:10:00Z' })] });
  assert.equal(operations.getOperationContinuation(incident).kind, 'incident');
  assert.match(operations.getOperationContinuation(incident).action.href, /#reserve-heading$/);
  const closed = coreInput({ assignments: [], canHire: false, canRecruit: false });
  assert.match(operations.getOperationContinuation(closed).action.href, /#team-heading$/);
  const review = coreInput({ now: ended, completed: true, assignments: [coreAssignment(finished)], reviews: [{ job_id: 'job0' }] });
  assert.equal(operations.getOperationContinuation(review).action.href, '/reviews/job0');
  const payment = coreInput({ now: ended, assignments: [coreAssignment({ ...checkedIn, paid_at: received.paid_at })] });
  assert.match(operations.getOperationContinuation(payment).responsible, /Profissional confirma/);
  payment.assignments[0].payment_disputed_at = ended;
  assert.equal(operations.getOperationContinuation(payment).action.label, 'Confirmar Pagamento');
  assert.match(operations.getOperationContinuation(payment).responsible, /regularizar/);
  payment.demand.cancelled = true;
  assert.equal(operations.getOperationState(payment), null);
  assert.equal(operations.getOperationContinuation(payment).kind, 'cancelled');
  const candidate = coreInput({ now: '2026-10-17T12:00:00Z' });
  candidate.demand.candidates = 1;
  assert.equal(operations.getOperationContinuation(candidate).kind, 'candidates');
  candidate.canHire = false;
  assert.equal(operations.getOperationContinuation(candidate).kind, 'working');
});

test('H01-001: active incomplete operation recommends monitoring when hiring and recruiting are blocked', () => {
  const input = coreInput({ required: 2, assignments: [coreAssignment(checkedIn)], canHire: false, canRecruit: false });
  assert.equal(operations.getOperationState(input), 'Em andamento');
  const continuation = operations.getOperationContinuation(input);
  assert.equal(continuation.label, 'Acompanhar operação');
  assert.match(continuation.action.href, /#operation-flow-heading$/);
  assert.match(continuation.description, /Trabalho em andamento/);
});

test('H01-002: blocked hiring never produces a recruitment CTA or recommendation', () => {
  for (const assignments of [[], [coreAssignment(checkedIn)]]) {
    const input = coreInput({ required: 2, assignments, canHire: false, canRecruit: false });
    const original = structuredClone(input);
    const continuation = operations.getOperationContinuation(input);
    assert.doesNotMatch(continuation.label, /Completar equipe|Contratar profissionais/);
    assert.doesNotMatch(continuation.action.label, /Convidar|Contratar|Completar|Analisar candidatos/);
    assert.doesNotMatch(continuation.action.href, /\?view=(talents|candidates)/);
    assert.deepEqual(input, original);
  }
});

test('H01-003: an incomplete active operation can recommend completing the team when hiring is allowed', () => {
  const input = coreInput({ required: 2, assignments: [coreAssignment(checkedIn)], canHire: true, canRecruit: false });
  input.demand.candidates = 1;
  assert.equal(operations.getOperationContinuation(input).label, 'Completar equipe');
  assert.match(operations.getOperationContinuation(input).action.href, /\?view=candidates$/);
});

test('H01-004: a complete active operation keeps monitoring and higher priorities stay intact', () => {
  const active = coreInput({ assignments: [coreAssignment(checkedIn)], canHire: false, canRecruit: false });
  assert.equal(operations.getOperationContinuation(active).label, 'Acompanhar operação');
  for (const [assignment, now, kind] of [
    [coreAssignment(), '2026-10-17T15:00:00Z', 'checkin'],
    [coreAssignment(checkedIn), ended, 'financial'],
    [coreAssignment(received), ended, 'checkout'],
  ]) {
    assert.equal(operations.getOperationContinuation(coreInput({
      required: 2, assignments: [assignment], now, canHire: false, canRecruit: false,
    })).kind, kind);
  }
});

test('operation core action destinations agree with the existing flow and Team contracts', () => {
  const { describeHire } = load('../lib/restaurant-team.ts');
  for (const [phase, assignment, now] of [
    ['payment', coreAssignment(checkedIn), ended],
    ['receipt', coreAssignment({ ...checkedIn, paid_at: received.paid_at }), ended],
    ['payment_disputed', coreAssignment({ ...checkedIn, paid_at: received.paid_at, payment_disputed_at: ended }), ended],
    ['checkout', coreAssignment(received), ended],
    ['absence_pending', coreAssignment(), '2026-10-17T15:00:00Z'],
  ]) {
    const input = coreInput({ assignments: [assignment], now });
    const window = input.windows.get('job0');
    const flow = operations.getOperationFlow({ jobId: 'job0', role: 'restaurant', hired: true,
      assignment, startsAt: window.start, endsAt: window.end, now: input.now });
    const team = describeHire({ ...context(), ...assignment, role: 'restaurant', phase,
      starts_at: window.start.toISOString(), ends_at: window.end.toISOString() }, input.now);
    const continuation = operations.getOperationContinuation(input);
    assert.equal(continuation.action.href, flow.action.href, phase);
    assert.equal(continuation.action.href, team.action.href, phase);
  }
});
const ui = load('../app/components/ui/index.tsx', {
  '@/lib/ui/input-masks': load('../lib/ui/input-masks.ts'),
});
const OperationFlow = load('../app/components/operation-flow.tsx', {
  '@/app/components/ui': ui,
  '@/lib/operations': operations,
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
}).default;
const workLocations = load('../lib/work-locations.ts');
const LocationFormStub = () => React.createElement('div', { 'data-testid': 'location-form' });
const primaryLocation = (overrides = {}) => ({
  id: 'primary', restaurant_id: 'company', name: 'Matriz', address: 'Rua das Flores', number: '120',
  neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postal_code: '01001000', country_code: 'BR',
  latitude: -23.5, longitude: -46.6, geocoding_status: 'resolved', geocoding_precision: 'device',
  geocoding_error_code: null, candidate_latitude: null, candidate_longitude: null, kind: 'permanent',
  valid_until: null, confirmed_at: '2026-01-01T00:00:00Z', address_version: 1, revision: 3, is_default: true,
  archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides,
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
  const previousFetch = globalThis.fetch;
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
    value: initial, failure: null, rpcError: null, calls: [], queries: [], pendingReviews: [], navigation: [], locationLoads: [],
    locations: [primaryLocation()], locationsError: null,
    fetchCalls: [], apiError: null,
    gpsCalls: 0, gpsError: null, coordinates: { latitude: -23.5, longitude: -46.6, accuracy: 10, speed: null, isMock: false },
    auth: {
      getUser: async () => ({ data: { user: { id: 'company' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'session-token' } }, error: null }),
    },
    from: (table) => {
      db.queries.push(table);
      return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    },
    async rpc(name, args) {
      db.calls.push({ name, args });
      if (name === 'pending_operational_reviews') return { data: db.pendingReviews, error: null };
      if (db.rpcError) return { data: null, error: db.rpcError };
      if (name === 'create_restaurant_demand') return { data: 'published-demand', error: null };
      return name === 'operational_context' ? { data: db.value, error: null }
        : db.failure ? { data: db.failure, error: null } : { data: db.value, error: null };
    },
  };
  globalThis.fetch = async (url, options) => {
    db.fetchCalls.push({ url, options });
    return Response.json(db.apiError ? { error: db.apiError.message } : db.value,
      { status: db.apiError ? db.apiError.status ?? 400 : 200 });
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
    '@/lib/work-locations': workLocations,
    '@/lib/locations/client': {
      loadWorkLocations: async (client, owner) => {
        db.locationLoads.push(owner);
        if (db.locationsError) throw new Error(db.locationsError);
        return db.locations;
      },
      manageLocation: async (client, location, action) => { db.calls.push({ name: 'manage_work_location', args: { id: location.id, action } }); },
      confirmLocation: async (client, location, method) => { db.calls.push({ name: 'confirm_work_location', args: { id: location.id, method } }); },
      retryLocation: async id => { db.calls.push({ name: 'retry_location', args: { id } }); return { location: primaryLocation({ id }) }; },
    },
    '@/app/components/location-form': { default: LocationFormStub },
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
      globalThis.fetch = previousFetch;
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

test('operational presentation shares semantic tones without changing stages or actions', async () => {
  const end = new Date('2026-10-18T03:00:00-03:00');
  const cases = [
    ['confirmed', 'info', {}],
    ['checkin', 'warning', {}],
    ['absence_pending', 'warning', {}],
    ['working', 'info', { checkin_at: end.toISOString() }],
    ['payment', 'warning', { checkin_at: end.toISOString() }],
    ['receipt', 'warning', { checkin_at: end.toISOString(), paid_at: end.toISOString() }],
    ['payment_disputed', 'danger', { checkin_at: end.toISOString(), payment_disputed_at: end.toISOString() }],
    ['checkout', 'warning', { checkin_at: end.toISOString(), receipt_confirmed_at: end.toISOString() }],
    ['completed', 'success', { checkin_at: end.toISOString(), receipt_confirmed_at: end.toISOString(), checkout_at: end.toISOString() }],
    ['cancelled', 'neutral', { interruption: 'cancelled' }],
    ['absent', 'danger', { interruption: 'absent' }],
    ['abandoned', 'danger', { interruption: 'abandoned' }],
  ];
  for (const role of ['worker', 'restaurant']) {
    for (const [phase, tone, changes] of cases) {
      const input = { jobId: 'job', role, hired: true, assignment: context(changes),
        endsAt: end, now: phase === 'working' ? new Date(end.getTime() - 1) : end, phase };
      const flow = operations.getOperationFlow(input);
      const html = renderToStaticMarkup(React.createElement(OperationFlow, input));
      assert.match(html, new RegExp(`ec-badge--${tone} ec-operation-status`), `${role}: ${phase}`);
      assert.equal((html.match(/data-state="/g) ?? []).length, 6);
      assert.match(html, /Responsável pela próxima etapa/);
      assert.match(html, /Quando agir/);
      assert.match(html, new RegExp(`role="${tone === 'danger' ? 'alert' : 'status'}"`));
      if (flow.action) assert.ok(html.includes(`href="${flow.action.href}"`));
      const app = mount(context({ ...changes, role, phase }));
      try {
        await app.flush();
        const panel = app.html();
        assert.match(panel, new RegExp(`ec-badge--${tone} ec-operation-status`), `${role}: panel ${phase}`);
        assert.match(panel, /<article[^>]*ec-operational-panel/);
        if (phase === 'payment' && role === 'restaurant') {
          assert.ok(panel.indexOf('Confirmar Pagamento') < panel.indexOf('Etapas da operação'));
        }
        if (phase === 'checkin') {
          assert.ok(panel.indexOf(role === 'worker' ? 'Realizar Check-in' : 'Confirmar Check-in') < panel.indexOf('Etapas da operação'));
        }
      } finally { app.unmount(); }
    }
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

test('flow responsibility follows existing stage truth without changing actions or timeline', () => {
  const end = new Date('2026-10-17T23:00:00-03:00');
  for (const role of ['worker', 'restaurant']) {
    for (const [changes, phase, responsible] of [
      [{}, 'checkin', 'Profissional apresenta o código; restaurante confirma o check-in'],
      [{ checkin_at: 'x' }, 'payment', 'Restaurante · confirmar pagamento'],
      [{ checkin_at: 'x', paid_at: 'x' }, 'receipt', 'Profissional · confirmar recebimento'],
      [{ checkin_at: 'x', paid_at: 'x', payment_disputed_at: 'x' }, 'payment_disputed', 'Restaurante · confirmar pagamento'],
      [{ checkin_at: 'x', receipt_confirmed_at: 'x' }, 'checkout', 'Restaurante gera o código; profissional realiza o checkout'],
    ]) {
      const input = { role, phase, jobId: 'job', hired: true, assignment: context(changes), endsAt: end, now: end };
      const expected = operations.getOperationFlow(input);
      const html = renderToStaticMarkup(React.createElement(OperationFlow, input));
      assert.ok(html.includes(responsible), `${role}: ${phase}`);
      assert.ok(html.indexOf('Responsável pela próxima etapa') < html.indexOf('<ol'));
      assert.ok(html.includes(`href="${expected.action.href}"`));
      assert.deepEqual([...html.matchAll(/data-stage="([^"]+)"/g)].map(match => match[1]), expected.steps.map(step => step.label));
    }
    const unknown = renderToStaticMarkup(React.createElement(OperationFlow, { role, jobId: 'job', hired: true, assignment: null, endsAt: end, now: end }));
    assert.match(unknown, /role="alert"[^>]*ec-badge--danger/);
    assert.doesNotMatch(unknown, /href="\/(?:checkin|payment|checkout)\//);
  }
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
    assert.equal(app.db.gpsCalls, 1);
    assert.equal(app.db.fetchCalls.at(-1).url, '/api/checkin');
    assert.equal(app.db.fetchCalls.at(-1).options.headers.Authorization, 'Bearer session-token');
    assert.deepEqual(JSON.parse(app.db.fetchCalls.at(-1).options.body), {
      jobId: 'job', latitude: -23.5, longitude: -46.6, accuracy: 10, speed: null, isMock: false,
    });
    assert.match(app.html(), /Presença validada\. Código operacional liberado/);
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
    'Ative sua localização para registrar presença.',
    'Aguardando uma localização mais precisa. Tente novamente em alguns segundos.',
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
      app.db.apiError = { message: 'Você parece estar distante do local da operação.' };
      app.button('Realizar Check-in').props.onClick();
      await app.flush();
      assert.match(app.html(), /distante do local da operação/);
      assert.doesNotMatch(app.html(), /Código operacional liberado/);
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
    assert.doesNotMatch(app.html(), /Realizar Checkout/);
    app.db.value = context({ phase: 'payment_disputed', paid_at: '2026-10-18T02:00:00Z' });
    app.button('Não Recebi').props.onClick();
    await app.flush();
    assert.match(app.html(), /checkout permanece bloqueado/);
    assert.doesNotMatch(app.html(), /Realizar Checkout/);
    app.db.value = context({ phase: 'checkout', receipt_confirmed_at: '2026-10-18T02:05:00Z', has_code: true });
    app.button('Confirmar Recebimento').props.onClick();
    await app.flush();
    assert.equal(app.db.gpsCalls, 0);
    assert.match(app.html(), /Recebimento confirmado. Checkout liberado/);
    assert.match(app.html(), /Realizar Checkout/);
    assert.doesNotMatch(app.html(), /Gerar código de Checkout/);
  } finally { app.unmount(); }
});

test('interrupted work has a return path but no unauthorized chat or active operations', async () => {
  const app = mount(context({ phase: 'absent' }));
  try {
    await app.flush();
    assert.match(app.html(), /href="\/worker\/applications"/);
    assert.doesNotMatch(app.html(), /href="\/chat\/job"|Realizar Check-in|Confirmar Pagamento|Realizar Checkout/);
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
        'operation-daily-rate':'150','operation-details':'Operação urgente',
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

const fillOperation = (app, overrides = {}) => {
  const fields = {
    'operation-role': 'Garçom', 'operation-date': '2099-01-01', 'operation-start-time': '18:00',
    'operation-end-time': '23:00', 'operation-daily-rate': '150', 'operation-details': 'Detalhes do plantão', ...overrides,
  };
  for (const [id, value] of Object.entries(fields)) {
    const input = app.elements().find(node => node.props.id === id);
    assert.ok(input, id);
    input.props.onChange({ target: { value } });
  }
};
const submitOperation = async app => {
  await app.elements().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await app.flush();
};

test('publication persists before optional invitations and skipping never republishes or hires', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  try {
    await app.flush();
    fillOperation(app);
    await app.flush();
    assert.match(app.html(), /Publicar Operação/);
    await submitOperation(app);
    assert.match(app.html(), /Operação publicada com sucesso/);
    assert.match(app.html(), /href="\/restaurant\/demands\/published-demand\?view=talents"/);
    assert.match(app.html(), /Convidar Agora/);
    app.button('Pular').props.onClick();
    assert.deepEqual(app.db.navigation, ['/restaurant/demands/published-demand']);
    assert.deepEqual(app.db.calls.map(call => call.name), ['pending_operational_reviews', 'create_restaurant_demand']);
    assert.deepEqual(app.db.locationLoads, ['company']);
    const args = app.db.calls.at(-1).args;
    assert.equal(args.p_value, 150);
    assert.equal(Object.hasOwn(args, 'p_quantity'), false);
    assert.equal(args.p_title, 'Garçom');
    assert.equal(args.p_description, 'Detalhes do plantão');
    assert.equal(args.p_location_source, 'catalog');
    assert.equal(args.p_work_location_id, 'primary');
    assert.equal(args.p_location_revision, 3);
    assert.equal(Object.hasOwn(args, 'p_event_id'), false);
    assert.equal(Object.hasOwn(args, 'p_latitude'), false);
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

test('operation publication uses the primary operational location without typing an address', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  globalThis.window.location.search = '?event=old-event&event_id=old-event';
  app.db.locations = [
    primaryLocation({ id: 'branch', name: 'Filial', is_default: false, revision: 7 }),
    primaryLocation(),
    primaryLocation({ id: 'pending', name: 'Sem confirmação', is_default: false, geocoding_status: 'needs_review', latitude: null, longitude: null }),
    primaryLocation({ id: 'old', name: 'Arquivado', is_default: false, archived_at: '2026-01-02T00:00:00Z' }),
  ];
  try {
    await app.flush();
    const html = app.html();
    assert.doesNotMatch(html, />[^<]*(?:Evento|Agenda|demanda|Demanda|Profissionais necessários|quantidade de profissionais)/);
    assert.match(html, /Publique uma oportunidade e receba candidaturas de profissionais disponíveis/);
    assert.match(html, /Quando\?/);
    assert.match(html, /Onde\?/);
    assert.match(html, /Local da operação/);
    assert.doesNotMatch(html, /operation-street|operation-number|operation-city|Latitude|Longitude/);
    const select = app.elements().find(node => node.props.id === 'operation-location');
    assert.equal(select.props.value, 'primary', 'primary location is preselected');
    assert.match(html, /Matriz \(principal\)/);
    assert.match(html, /Rua das Flores, 120 · Centro · São Paulo\/SP · CEP 01001-000/);
    assert.doesNotMatch(html, /Sem confirmação<\/option>|Arquivado<\/option>/);
    assert.match(html, /1 local aguarda localização/);
    assert.match(html, /href="\/restaurant\/locations"/);
    const date = app.elements().find(node => node.type === ui.TextInput && node.props.type === 'date');
    assert.equal(date.props.value, '');
    select.props.onChange({ target: { value: 'branch' } });
    fillOperation(app, { 'operation-start-time': '22:00', 'operation-end-time': '03:00', 'operation-daily-rate': '180', 'operation-details': 'Informações da operação' });
    await app.flush();
    await submitOperation(app);
    assert.deepEqual(app.db.calls.at(-1), { name: 'create_restaurant_demand', args: {
      p_title: 'Garçom', p_description: 'Informações da operação', p_job_date: '2099-01-01',
      p_start_time: '22:00', p_end_time: '03:00', p_value: 180,
      p_location_source: 'catalog', p_work_location_id: 'branch', p_location_revision: 7,
    } });
    assert.deepEqual(app.db.queries, []);
    assert.match(app.html(), /Operação publicada com sucesso/);
  } finally { app.unmount(); }
});

test('publication errors remain visible and publication requires operational coordinates', async () => {
  const app = mount(null, '../app/restaurant/dashboard/jobs/create/page.tsx');
  app.db.rpcError = { message: 'Confirme a localização do local antes de publicar a operação.' };
  try {
    await app.flush();
    fillOperation(app);
    await app.flush();
    await submitOperation(app);
    assert.match(app.html(), /Confirme a localização do local antes de publicar a operação/);
    assert.doesNotMatch(app.html(), /Operação publicada com sucesso/);
    assert.equal(app.elements().find(node => node.props.id === 'operation-details').props.value, 'Detalhes do plantão');
    assert.equal(app.elements().find(node => node.type === 'fieldset').props.disabled, false);
  } finally { app.unmount(); }

  const empty = mount(null, '../app/restaurant/dashboard/jobs/create/page.tsx');
  empty.db.locations = [primaryLocation({ geocoding_status: 'failed', latitude: null, longitude: null })];
  try {
    await empty.flush();
    assert.match(empty.html(), /Nenhum local com coordenadas operacionais disponível/);
    fillOperation(empty);
    await empty.flush();
    assert.match(empty.html(), /Nenhum local com coordenadas operacionais disponível para esta data/);
    await submitOperation(empty);
    assert.match(empty.html(), /Selecione um local com coordenadas operacionais antes de publicar/);
    assert.equal(empty.db.calls.some(call => call.name === 'create_restaurant_demand'), false);
  } finally { empty.unmount(); }
});

test('a new or one-off location is selected inline as soon as it has operational coordinates', async () => {
  const app = mount('published-demand', '../app/restaurant/dashboard/jobs/create/page.tsx');
  app.db.locations = [];
  try {
    await app.flush();
    fillOperation(app, { 'operation-date': '2099-01-01' });
    await app.flush();
    app.button('+ Novo local').props.onClick();
    await app.flush();
    const form = app.elements().find(node => node.type === LocationFormStub);
    assert.ok(form, 'inline location form');
    assert.equal(form.props.temporaryUntil, '2099-01-01');
    assert.equal(form.props.allowTemporary, true);
    assert.equal(form.props.makeDefault, true, 'first location becomes the primary address');
    form.props.onSaved(primaryLocation({ id: 'event-hall', is_default: false, kind: 'temporary', valid_until: '2099-01-01',
      geocoding_status: 'needs_review', geocoding_precision: null, latitude: null, longitude: null }));
    await app.flush();
    assert.ok(app.elements().find(node => node.type === LocationFormStub), 'form stays open while coordinates are pending');
    app.elements().find(node => node.type === LocationFormStub).props.onSaved(primaryLocation({
      id: 'event-hall', name: 'Salão de festas', is_default: false, kind: 'temporary', valid_until: '2099-01-01', revision: 5,
      geocoding_status: 'needs_review', geocoding_precision: 'street', latitude: null, longitude: null,
      candidate_latitude: -23.5, candidate_longitude: -46.6,
    }));
    await app.flush();
    assert.equal(app.elements().find(node => node.type === LocationFormStub), undefined);
    assert.equal(app.elements().find(node => node.props.id === 'operation-location').props.value, 'event-hall');
    assert.match(app.html(), /Salão de festas \(temporário\)/);
    app.elements().find(node => node.props.id === 'operation-date').props.onChange({ target: { value: '2099-01-02' } });
    await app.flush();
    assert.match(app.html(), /Nenhum local com coordenadas operacionais disponível para esta data/, 'temporary locations expire after their date');
    app.elements().find(node => node.props.id === 'operation-date').props.onChange({ target: { value: '2099-01-01' } });
    await app.flush();
    await submitOperation(app);
    assert.equal(app.db.calls.at(-1).args.p_work_location_id, 'event-hall');
    assert.equal(app.db.calls.at(-1).args.p_location_revision, 5);
  } finally { app.unmount(); }
});

test('locations page manages primary, temporary and archived locations through catalog helpers', async () => {
  const app = mount(null, '../app/restaurant/locations/page.tsx');
  app.db.locations = [
    primaryLocation(),
    primaryLocation({ id: 'branch', name: 'Filial', is_default: false, geocoding_status: 'needs_review',
      geocoding_precision: 'street', latitude: null, longitude: null, candidate_latitude: -23.5, candidate_longitude: -46.6 }),
    primaryLocation({ id: 'hall', name: 'Salão', is_default: false, kind: 'temporary', valid_until: '2099-01-01' }),
    primaryLocation({ id: 'legacy', name: 'Antigo', is_default: false, postal_code: '', geocoding_status: 'pending', latitude: null, longitude: null }),
    primaryLocation({ id: 'old', name: 'Arquivado', is_default: false, archived_at: '2026-01-02T00:00:00Z' }),
  ];
  try {
    await app.flush();
    const html = app.html();
    assert.match(html, /Locais operacionais/);
    assert.match(html, /Principal/);
    assert.match(html, /Temporário até 01\/01\/2099/);
    assert.match(html, /Endereço aproximado · raio de 300 m/);
    assert.match(html, /Completar endereço \(CEP\)/, 'legacy rows without CEP must be completed before use');
    assert.doesNotMatch(html, /Arquivado<\/h2>/);
    assert.equal(app.elements().filter(node => node.type === ui.Button && node.props.children === 'Tornar principal').length, 2,
      'only permanent non-primary locations can become primary');
    app.button('Tornar principal').props.onClick();
    await app.flush();
    assert.deepEqual(app.db.calls.at(-1), { name: 'manage_work_location', args: { id: 'branch', action: 'set_default' } });
    assert.match(app.html(), /Endereço principal atualizado/);
    assert.equal(app.db.locationLoads.length, 2, 'catalog reloads after each change');
    assert.doesNotMatch(html, /Confirmar no local \(GPS\)/);
    app.button('Ver arquivados (1)').props.onClick();
    await app.flush();
    app.button('Restaurar').props.onClick();
    await app.flush();
    assert.deepEqual(app.db.calls.at(-1), { name: 'manage_work_location', args: { id: 'old', action: 'restore' } });
    app.button('+ Novo local').props.onClick();
    await app.flush();
    const form = app.elements().find(node => node.type === LocationFormStub);
    assert.equal(form.props.makeDefault, false);
    assert.equal(form.props.location, null);
  } finally { app.unmount(); }
});
