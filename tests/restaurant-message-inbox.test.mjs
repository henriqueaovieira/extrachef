import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRestaurantMessageInbox } from '../lib/restaurant-message-inbox.ts';

function mockClient({ rpcFailure = { code: 'PGRST202', message: 'Could not find the function public.restaurant_operational_message_inbox(p_offset, p_limit) in the schema cache' }, talentRows, extraRows = {} } = {}) {
  const calls = [];
  const rows = {
    operational_assignments: [{ job_id: 'job-1', worker_id: 'worker-1' }, ...(extraRows.operational_assignments ?? [])],
    jobs: [{ id: 'job-1', demand_id: 'demand-1', title: 'Evento', job_date: '2026-10-18', start_time: '18:00:00', end_time: '23:00:00' }, ...(extraRows.jobs ?? [])],
    applications: [{ job_id: 'job-1', worker_id: 'worker-1' }, ...(extraRows.applications ?? [])],
    users: [{ id: 'restaurant-1', role: 'restaurant' }, { id: 'worker-1', role: 'worker' }, ...(extraRows.users ?? [])],
  };
  const client = {
    calls,
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (name === 'restaurant_operational_message_inbox') return Promise.resolve({ data: null, error: rpcFailure });
      if (name === 'demand_talent_directory') return Promise.resolve({ data: talentRows ?? [{
        id: 'worker-1',
        name: 'Camila Rocha',
        specialties: ['Garçonete'],
        score: 4.8,
        photo_path: 'camila.jpg',
        completed_operations: 9,
        reputation: { average_rating: 4.9, completed: 12 },
      }], error: null });
      if (name === 'operational_context') return Promise.resolve({ data: {
        job_id: 'job-1',
        phase: 'working',
        location: 'São Paulo/SP',
      }, error: null });
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      const query = { table, head: false, filters: {} };
      const builder = {
        select(_fields, options) { query.head = Boolean(options?.head); return this; },
        eq(field, value) { query.filters[field] = value; return this; },
        neq(field, value) { query.filters[`not_${field}`] = value; return this; },
        is(field, value) { query.filters[field] = value; return this; },
        in(field, value) { query.filters[field] = value; return this; },
        order() { return this; },
        range() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve(resolve(query, true)); },
        then(onFulfilled, onRejected) { return Promise.resolve(resolve(query, false)).then(onFulfilled, onRejected); },
      };
      calls.push(['from', table]);
      return builder;
    },
  };
  function resolve(query, single) {
    if (query.table === 'messages' && query.head) return { data: null, count: 2, error: null };
    if (query.table === 'messages') return { data: { content: 'Chego às 17h40', created_at: '2026-10-18T16:00:00Z' }, error: null };
    const data = rows[query.table] ?? [];
    return { data: single ? data[0] ?? null : data, error: null };
  }
  return client;
}

test('missing inbox RPC falls back to privacy-safe, approved operation records', async () => {
  const client = mockClient();
  const conversations = await loadRestaurantMessageInbox(client, 'restaurant-1');

  assert.equal(conversations.length, 1);
  assert.deepEqual(conversations[0], {
    job_id: 'job-1',
    demand_id: 'demand-1',
    worker_id: 'worker-1',
    worker_name: 'Camila Rocha',
    worker_specialty: 'Garçonete',
    worker_score: 4.9,
    worker_photo_path: 'camila.jpg',
    completed_operations: 12,
    demand_title: 'Evento',
    job_date: '2026-10-18',
    start_time: '18:00:00',
    end_time: '23:00:00',
    location: 'São Paulo/SP',
    operational_status: 'Em operação',
    latest_message: 'Chego às 17h40',
    latest_message_at: '2026-10-18T16:00:00Z',
    unread_count: 2,
  });
  assert.ok(client.calls.some(([type, name]) => type === 'rpc' && name === 'operational_context'));
});

test('inbox RPC errors other than a missing function remain explicit', async () => {
  const client = mockClient({ rpcFailure: { code: '42501', message: 'Access denied' } });
  await assert.rejects(loadRestaurantMessageInbox(client, 'restaurant-1'), /Access denied/);
  assert.equal(client.calls.some(([type]) => type === 'from'), false);
});

test('fallback skips an inconsistent operation and logs which object is missing', async (t) => {
  const logged = [];
  t.mock.method(console, 'warn', (...args) => logged.push(args));
  const conversations = await loadRestaurantMessageInbox(mockClient({ talentRows: [] }), 'restaurant-1');
  assert.deepEqual(conversations, []);
  assert.equal(logged.length, 1);
  const details = logged[0][1];
  assert.equal(details.job_id, 'job-1');
  assert.equal(details.demand_id, 'demand-1');
  assert.deepEqual(details.worker, { encontrado: false, worker_name: null, resposta_tipo: 'array', linhas: 0 });
  assert.equal(details.operationalContext.encontrado, true);
  assert.equal(details.operationalContext.phase, 'working');
  assert.equal(details.operationalContext.location, 'São Paulo/SP');
});

test('fallback ignores assignments whose worker is a restaurant account or the restaurant itself', async () => {
  const client = mockClient({ extraRows: {
    operational_assignments: [
      { job_id: 'job-2', worker_id: 'other-restaurant' },
      { job_id: 'job-3', worker_id: 'restaurant-1' },
    ],
    jobs: [
      { id: 'job-2', demand_id: 'demand-2', title: 'Inválida', job_date: '2026-10-19', start_time: '18:00:00', end_time: '23:00:00' },
      { id: 'job-3', demand_id: 'demand-3', title: 'Inválida', job_date: '2026-10-19', start_time: '18:00:00', end_time: '23:00:00' },
    ],
    applications: [
      { job_id: 'job-2', worker_id: 'other-restaurant' },
      { job_id: 'job-3', worker_id: 'restaurant-1' },
    ],
    users: [{ id: 'other-restaurant', role: 'restaurant' }],
  } });
  const conversations = await loadRestaurantMessageInbox(client, 'restaurant-1');

  assert.deepEqual(conversations.map((conversation) => conversation.job_id), ['job-1']);
  const directoryCalls = client.calls.filter(([type, name]) => type === 'rpc' && name === 'demand_talent_directory');
  assert.deepEqual(directoryCalls.map(([, , args]) => args.p_worker_id), ['worker-1']);
});

test('fallback returns no conversations when the signed-in account is not a restaurant', async () => {
  const client = mockClient({ extraRows: { users: [{ id: 'restaurant-1', role: 'worker' }] } });
  assert.deepEqual(await loadRestaurantMessageInbox(client, 'restaurant-1'), []);
});
