import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? require(name), exports);
  return exports;
}
const locations = load('../lib/work-locations.ts');
const snapshots = load('../lib/event-locations.ts');
const location = (overrides = {}) => ({
  id: 'venue', restaurant_id: 'owner', name: 'Hotel Fazenda', address: 'Rodovia SP-304',
  number: 'km 20', neighborhood: '', city: 'Piracicaba', state: 'SP', country_code: 'BR', postal_code: '',
  latitude: null, longitude: null, geocoding_status: 'pending', archived_at: null,
  revision: 3, address_version: 2, is_default: false, ...overrides,
});
const record = (overrides = {}) => ({
  id: 'event', restaurant_id: 'owner', title: 'Casamento Silva', description: '',
  event_date: '2099-01-01', start_time: '10:00', end_time: '18:00', expected_people: 80,
  status: 'scheduled', revision: 5, location_status: 'not_set', work_location_id: null,
  location_name: null, event_address: null, event_number: null, event_neighborhood: null,
  event_city: null, event_state: null, event_postal_code: null, event_country_code: null,
  event_latitude: null, event_longitude: null, location_snapshot_at: null, location_source_version: null,
  ...overrides,
});
const withSnapshot = () => record({
  location_status: 'pending_coordinates', work_location_id: 'venue',
  location_name: 'Local original', event_address: 'Rua original',
  event_city: 'Piracicaba', event_state: 'SP', event_number: '10',
  event_neighborhood: '', event_postal_code: '', event_country_code: 'BR',
  location_source_version: 1, location_snapshot_at: '2026-10-15T12:00:00Z',
});

test('snapshot parameters separate keep, clear and explicit copy with catalog revision', () => {
  assert.deepEqual(snapshots.eventLocationParameters('keep', []), {
    p_location_action: 'keep', p_work_location_id: null, p_location_revision: null,
  });
  assert.equal(snapshots.eventLocationParameters('none', []).p_location_action, 'clear');
  assert.deepEqual(snapshots.eventLocationParameters('venue', [location()]), {
    p_location_action: 'set', p_work_location_id: 'venue', p_location_revision: 3,
  });
  assert.throws(() => snapshots.eventLocationParameters('venue', []), /local ativo/);
  assert.throws(() => snapshots.eventLocationParameters('venue', [location({ archived_at: 'archived' })]), /local ativo/);
  assert.deepEqual(Object.values(snapshots.eventLocationLabels), [
    'Local não definido', 'Coordenadas pendentes', 'Coordenadas disponíveis',
  ]);
});

test('migration source guards optional authoritative snapshots without jobs, GPS or geocoding dependencies', () => {
  const sql = source('../supabase/migrations/20261015070000_event_location_snapshots.sql');
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(sql, /DEFAULT 'not_set'/);
  assert.match(sql, /REFERENCES public\.work_locations\(id\) ON DELETE NO ACTION/);
  assert.match(sql, /CREATE INDEX events_work_location_idx/);
  assert.match(sql, /REVOKE INSERT, UPDATE ON TABLE public\.events FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /id = owner_id AND role = 'restaurant' FOR UPDATE/);
  assert.match(sql, /p_expected_revision IS DISTINCT FROM target.revision/);
  assert.match(sql, /p_location_revision IS DISTINCT FROM selected.revision/);
  assert.match(sql, /restaurant_id = owner_id AND archived_at IS NULL/);
  assert.match(sql, /IF p_location_action = 'set' THEN/);
  assert.match(sql, /target\.event_address := selected\.address/);
  assert.match(sql, /target\.location_source_version := selected\.address_version/);
  assert.match(sql, /ELSIF p_location_action = 'clear'/);
  assert.doesNotMatch(sql, /public\.(jobs|applications|checkins|checkouts)|CREATE TRIGGER|http|geocode\(/i);
  const ui = source('../app/components/restaurant-events.tsx');
  assert.doesNotMatch(ui, /resolveWorkLocation|getCurrentPosition|WorkLocationFields|\/api\/geocode|jobs\/create|from\('events'\)\.(insert|update)/);
  assert.match(ui, /supabase\.rpc\('save_restaurant_event'/);
  assert.match(ui, /setLocationChoice\('keep'\)/);
});

function mount({ events = [], catalog = [], failure = '' } = {}) {
  const db = { events: structuredClone(events), catalog: structuredClone(catalog), calls: [], failure, user: 'owner', confirm: true, returned: null };
  const client = {
    auth: { getUser: async () => ({ data: { user: db.user ? { id: db.user } : null }, error: null }) },
    from(table) {
      let deleting = false;
      const filters = {};
      const chain = {
        select() { return chain; }, eq(key, value) { filters[key] = value; return chain; },
        is() { return chain; }, order() { return chain; }, delete() { deleting = true; return chain; },
        maybeSingle: async () => ({ data: { role: 'restaurant' }, error: null }),
        range: async (start, end) => ({
          data: (table === 'events' ? db.events : db.catalog).slice(start, end + 1),
          error: db.failure === table ? { message: 'offline' } : null,
        }),
        single: async () => {
          assert.ok(deleting);
          if (db.failure === 'delete') return { data: null, error: { message: 'delete rejected' } };
          const found = db.events.find((event) => event.id === filters.id && event.revision === filters.revision);
          db.events = db.events.filter((event) => event !== found);
          return { data: found, error: found ? null : { message: 'stale revision' } };
        },
      };
      assert.ok(['events', 'work_locations', 'users'].includes(table));
      return chain;
    },
    rpc(name, args) {
      db.calls.push({ name, args });
      return { single: async () => {
        if (db.failure === 'save') return { data: null, error: { message: 'revision conflict' } };
        const result = db.returned ?? record({ id: args.p_id ?? 'new-event', title: args.p_title });
        db.events = [...db.events.filter((event) => event.id !== result.id), structuredClone(result)];
        return { data: structuredClone(result), error: null };
      } };
    },
  };
  const slots = [];
  let cursor = 0, dirty = false, root;
  let effects = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestAnimationFrame: (callback) => { callback(); return 1; },
    cancelAnimationFrame() {}, scrollTo() {}, confirm: () => db.confirm,
  } });
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const component = load('../app/components/restaurant-events.tsx', {
    react, 'next/link': { default: 'Link' }, '@/lib/work-locations': locations,
    '@/lib/event-locations': snapshots, '@/lib/supabase/client': { createClient: () => client },
    '@/app/components/mobile-bottom-nav': { default: 'Navigation' },
    '@/app/components/ui': Object.fromEntries(['Badge', 'Button', 'Card', 'EmptyState', 'LoadingSkeleton', 'Select', 'TextArea', 'TextInput', 'Toast'].map((name) => [name, name])),
  });
  const tree = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(tree)];
  const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
  function render() {
    cursor = 0; dirty = false; root = component.default();
    const queued = effects; effects = []; queued.forEach((effect) => effect());
  }
  render();
  return {
    db, nodes: () => tree(root), text: () => text(root),
    async flush() {
      for (let i = 0; i < 12; i++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty) render(); }
    },
    async click(label) {
      const button = tree(root).find((node) => node.type === 'Button' && text(node) === label);
      assert.ok(button, `Missing ${label}`); assert.ok(!button.props.disabled, `Disabled ${label}`);
      button.props.onClick(); await this.flush();
    },
    async change(id, value) {
      const input = tree(root).find((node) => node.props.id === id);
      assert.ok(input, `Missing ${id}`);
      input.props.onChange({ target: { value } }); await this.flush();
    },
    async fill() {
      for (const [id, value] of Object.entries({ title: 'Festa externa', date: '2099-01-01', people: '80', start: '10:00', end: '18:00' })) {
        await this.change(`event-${id}`, value);
      }
    },
    async save() {
      const form = tree(root).find((node) => node.type === 'form');
      assert.ok(form); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
      await this.flush();
    },
    unmount() {
      slots.forEach((slot) => slot.cleanup?.());
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else delete globalThis.window;
    },
  };
}

test('actual event component creates without location despite catalog failure, preventing double submission', async () => {
  const app = mount({ failure: 'work_locations' });
  try {
    await app.flush(); await app.click('Criar evento'); await app.fill(); await app.save();
    assert.equal(app.db.calls.length, 1);
    assert.equal(app.db.calls[0].name, 'save_restaurant_event');
    assert.equal(app.db.calls[0].args.p_location_action, 'clear');
    assert.match(app.text(), /Local não definido/);
    assert.match(app.text(), /Evento criado/);
  } finally { app.unmount(); }
});

test('new event suggests default, can clear it, and renders only the snapshot returned by RPC', async () => {
  const app = mount({ catalog: [location({ is_default: true })] });
  try {
    await app.flush(); await app.click('Criar evento'); await app.fill();
    assert.equal(app.nodes().find((node) => node.props.id === 'event-location').props.value, 'venue');
    assert.match(app.text(), /Coordenadas pendentes/);
    await app.change('event-location', 'none');
    assert.equal(app.nodes().find((node) => node.props.id === 'event-location').props.value, 'none');
    await app.change('event-location', 'venue');
    app.db.returned = withSnapshot(); await app.save();
    assert.equal(app.db.calls[0].args.p_location_action, 'set');
    assert.equal(app.db.calls[0].args.p_location_revision, 3);
    assert.match(app.text(), /Local original/);
    assert.doesNotMatch(app.text(), /Hotel Fazenda/);
  } finally { app.unmount(); }
});

test('editing event keeps historical snapshot despite catalog edits, archive, or catalog outage', async () => {
  const app = mount({ events: [withSnapshot()], catalog: [location({ name: 'Changed catalog' })] });
  try {
    await app.flush(); await app.click('Editar');
    assert.equal(app.nodes().find((node) => node.props.id === 'event-location').props.value, 'keep');
    app.db.catalog = [];
    await app.click('Atualizar catálogo');
    app.db.failure = 'work_locations';
    await app.click('Atualizar catálogo');
    assert.match(app.text(), /Rua original/);
    assert.match(app.text(), /offline/);
    app.db.returned = withSnapshot();
    await app.change('event-title', 'Nome editado'); await app.save();
    const { args } = app.db.calls[0];
    assert.equal(args.p_expected_revision, 5);
    assert.equal(args.p_location_action, 'keep');
    assert.equal(args.p_work_location_id, null);
  } finally { app.unmount(); }
});

test('editing legacy event never adopts a newly configured default automatically; clear is explicit', async () => {
  const app = mount({ events: [record()], catalog: [location({ is_default: true })] });
  try {
    await app.flush(); await app.click('Editar');
    assert.equal(app.nodes().find((node) => node.props.id === 'event-location').props.value, 'keep');
    await app.change('event-location', 'none'); await app.save();
    assert.equal(app.db.calls[0].args.p_location_action, 'clear');
    assert.match(app.text(), /Local não definido/);
  } finally { app.unmount(); }
});

test('same catalog source can be copied again explicitly; ready status comes from persisted coordinates', async () => {
  const app = mount({ events: [withSnapshot()], catalog: [location({ geocoding_status: 'resolved', latitude: -22.7, longitude: -47.6 })] });
  try {
    await app.flush(); await app.click('Editar'); await app.change('event-location', 'venue');
    assert.match(app.text(), /Coordenadas disponíveis/);
    app.db.returned = { ...withSnapshot(), location_status: 'ready', event_latitude: -22.7, event_longitude: -47.6 };
    await app.save();
    assert.equal(app.db.calls[0].args.p_location_action, 'set');
    assert.match(app.text(), /Coordenadas disponíveis/);
  } finally { app.unmount(); }
});

test('write conflict preserves form without success and changed sessions cannot save', async () => {
  const app = mount({ failure: 'save' });
  try {
    await app.flush(); await app.click('Criar evento'); await app.fill(); await app.save();
    assert.match(app.text(), /revision conflict/); assert.doesNotMatch(app.text(), /Evento criado/);
    assert.ok(app.nodes().some((node) => node.type === 'form'));
    app.db.user = 'different-owner';
    await app.save();
    assert.equal(app.db.calls.length, 1); assert.match(app.text(), /Sessão expirada ou alterada/);
  } finally { app.unmount(); }
});

test('event list failure is not rendered as empty success; refresh and deletion remain functional', async () => {
  const app = mount({ events: [record()], failure: 'events' });
  try {
    await app.flush(); assert.match(app.text(), /offline/);
    assert.ok(!app.nodes().some((node) => node.type === 'EmptyState'));
    app.db.failure = ''; await app.click('Atualizar eventos');
    app.db.confirm = false; await app.click('Excluir'); assert.equal(app.db.events.length, 1);
    app.db.confirm = true; app.db.failure = 'delete';
    await app.click('Excluir'); assert.match(app.text(), /delete rejected/);
    app.db.failure = ''; await app.click('Excluir');
    assert.equal(app.db.events.length, 0);
  } finally { app.unmount(); }
});

test('catalog remains paginated; failed/unresolved coordinates do not block choosing an address', async () => {
  const catalog = Array.from({ length: 102 }, (_, index) => location({ id: `venue-${index}`, geocoding_status: 'failed' }));
  const app = mount({ catalog });
  try {
    await app.flush(); await app.click('Criar evento'); await app.fill();
    await app.change('event-location', 'venue-101'); assert.match(app.text(), /Coordenadas pendentes/);
    await app.save();
    assert.equal(app.db.calls[0].args.p_work_location_id, 'venue-101');
  } finally { app.unmount(); }
});

test('a catalog selection removed on refresh is visibly invalid instead of silently saving without a location', async () => {
  const app = mount({ catalog: [location()] });
  try {
    await app.flush(); await app.click('Criar evento'); await app.fill();
    await app.change('event-location', 'venue');
    app.db.catalog = []; await app.click('Atualizar catálogo');
    assert.match(app.text(), /local selecionado não está mais disponível/);
    await app.save();
    assert.equal(app.db.calls.length, 0);
    assert.match(app.text(), /Selecione um local ativo/);
    await app.change('event-location', 'none'); await app.save();
    assert.equal(app.db.calls[0].args.p_location_action, 'clear');
  } finally { app.unmount(); }
});
