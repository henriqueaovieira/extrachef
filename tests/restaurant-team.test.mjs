import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeHire, formatClock, formatHireDay, hireTimeline, isActiveAssignment, loadRestaurantTeam, sortTeam } from '../lib/restaurant-team.ts';

const now = new Date('2026-10-16T20:18:00Z'); // Friday 17:18 in São Paulo
const context = (phase, extra = {}) => ({
  job_id: `job-${phase}-${extra.suffix ?? ''}`, demand_id: 'd', title: 'Garçom', location: 'Salão', role: 'restaurant',
  starts_at: '2026-10-16T21:00:00Z', ends_at: '2026-10-17T02:00:00Z', worker_name: 'Carlos Mendes', phase, amount: 200,
  checkin_at: null, paid_at: null, receipt_confirmed_at: null, checkout_at: null, code: null, code_expires_at: null,
  has_code: false, review_pending: false, ...extra,
});

test('maps existing phases to Equipe states and next actions', () => {
  assert.equal(describeHire(context('completed', { review_pending: true, checkout_at: 'x' }), now).label, '⭐ Avaliação obrigatória');
  assert.equal(describeHire(context('payment_disputed'), now).label, '💰 Pagamento pendente');
  assert.equal(describeHire(context('receipt'), now).label, '⏳ Aguardando confirmação do pagamento');
  const checkout = describeHire(context('checkout', { code: 'AB12CD34', code_expires_at: '2026-10-16T20:25:00Z' }), now);
  assert.equal(checkout.state, 'checkout_code');
  assert.equal(describeHire(context('checkout'), now).action.label, 'Gerar código de checkout');
  assert.equal(describeHire(context('checkin', { has_code: true }), now).label, '🔑 Código de check-in disponível');
  const waiting = describeHire(context('checkin'), now);
  assert.equal(waiting.label, '🕒 Aguardando início');
  assert.equal(waiting.detail, 'Começa em 42 min');
  assert.match(describeHire(context('working', { checkin_at: '2026-10-16T20:58:00Z' }), now).detail, /Check-in realizado às 17:58/);
  assert.equal(describeHire(context('absent'), now).label, '⚠ Ausência reportada');
  assert.equal(describeHire(context('abandoned'), now).label, '⚠ Abandono reportado');
});

test('future hires become "Aguardando início" within 24 hours', () => {
  assert.equal(describeHire(context('confirmed', { starts_at: '2026-10-17T15:00:00Z' }), now).state, 'waiting');
  assert.equal(describeHire(context('confirmed', { starts_at: '2026-10-18T21:00:00Z' }), now).state, 'future');
});

test('sorts hires by operational priority', () => {
  const order = sortTeam([
    describeHire(context('confirmed', { starts_at: '2026-10-20T21:00:00Z' }), now),
    describeHire(context('working', { checkin_at: 'x' }), now),
    describeHire(context('checkin'), now),
    describeHire(context('checkin', { has_code: true, suffix: 'code' }), now),
    describeHire(context('checkout'), now),
    describeHire(context('receipt'), now),
    describeHire(context('payment'), now),
    describeHire(context('completed', { review_pending: true }), now),
  ]).map((hire) => hire.state);
  assert.deepEqual(order, ['review', 'payment', 'receipt', 'checkout', 'checkin_code', 'working', 'waiting', 'future']);
});

test('builds the hire timeline and archive rules', () => {
  const timeline = hireTimeline(describeHire(context('receipt', { checkin_at: 'x', paid_at: 'y' }), new Date('2026-10-17T03:00:00Z')), new Date('2026-10-17T03:00:00Z'));
  assert.deepEqual(timeline.map((step) => step.status), ['done', 'done', 'done', 'current', 'pending', 'pending']);
  const pending = new Set(['a']);
  assert.equal(isActiveAssignment({ job_id: 'a', checkout_at: 'x', interruption: null }, pending, now), true);
  assert.equal(isActiveAssignment({ job_id: 'b', checkout_at: 'x', interruption: null }, pending, now), false);
  assert.equal(isActiveAssignment({ job_id: 'c', checkout_at: null, interruption: 'cancelled' }, pending, now), false);
  assert.equal(isActiveAssignment({ job_id: 'd', checkout_at: null, interruption: 'absent', interrupted_at: '2026-10-16T10:00:00Z' }, pending, now), true);
  assert.equal(isActiveAssignment({ job_id: 'e', checkout_at: null, interruption: 'absent', interrupted_at: '2026-10-14T10:00:00Z' }, pending, now), false);
});

test('formats card day and hours', () => {
  assert.equal(formatClock('2026-10-16T21:00:00Z'), '18h');
  assert.equal(formatClock('2026-10-16T21:30:00Z'), '18h30');
  assert.equal(formatHireDay('2026-10-16T21:00:00Z', now), 'Hoje');
  assert.equal(formatHireDay('2026-10-17T21:00:00Z', now), 'Amanhã');
  assert.equal(formatHireDay('2026-10-18T21:00:00Z', now), 'Domingo');
});

test('loads only valid active hires and skips inconsistent operations', async () => {
  const assignments = [
    { job_id: 'active', worker_id: 'w1', checkout_at: null, interruption: null, interrupted_at: null },
    { job_id: 'reviewed', worker_id: 'w1', checkout_at: 'x', interruption: null, interrupted_at: null },
    { job_id: 'review', worker_id: 'w1', checkout_at: 'x', interruption: null, interrupted_at: null },
    { job_id: 'self', worker_id: 'r', checkout_at: null, interruption: null, interrupted_at: null },
    { job_id: 'wrong-role', worker_id: 'r2', checkout_at: null, interruption: null, interrupted_at: null },
    { job_id: 'broken', worker_id: 'w1', checkout_at: null, interruption: null, interrupted_at: null },
  ];
  const roles = { r: 'restaurant', w1: 'worker', r2: 'restaurant' };
  const contexts = {
    active: context('working', { job_id: 'active', checkin_at: 'x' }),
    review: context('completed', { job_id: 'review', review_pending: true }),
  };
  const calls = [];
  const query = (table) => {
    const state = { ids: null };
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      in: (_, ids) => { state.ids = ids; return builder; },
      range: async () => ({ data: assignments, error: null }),
      then: (resolve) => resolve({ data: state.ids.map((id) => ({ id, role: roles[id] })), error: null }),
    };
    calls.push(table);
    return builder;
  };
  const client = {
    from: query,
    rpc: async (name, args) => name === 'pending_operational_reviews'
      ? { data: [{ job_id: 'review' }], error: null }
      : contexts[args.p_job_id] ? { data: contexts[args.p_job_id], error: null } : { data: { error: 'Operação indisponível.' }, error: null },
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const hires = await loadRestaurantTeam(client, 'r', now);
    assert.deepEqual(hires.map((hire) => hire.context.job_id), ['review', 'active']);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][1].job_id, 'broken');
  } finally {
    console.warn = warn;
  }
});
