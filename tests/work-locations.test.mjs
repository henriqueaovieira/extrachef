import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source('../lib/work-locations.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const catalog = {};
new Function('exports', outputText)(catalog);
const require = createRequire(import.meta.url);
const form = () => ({
  name: ' Hotel Fazenda ', address: ' Rodovia SP-304 km 20 ', number: ' s/n ',
  neighborhood: '', city: ' Piracicaba ', state: 'sp', postal_code: '',
});

test('catalog accepts an address without CEP, coordinates or geocoder', () => {
  assert.deepEqual(catalog.locationParameters(form(), null), {
    p_name: 'Hotel Fazenda', p_address: 'Rodovia SP-304 km 20', p_number: 's/n',
    p_neighborhood: '', p_city: 'Piracicaba', p_state: 'SP', p_postal_code: '',
    p_id: null, p_expected_revision: null,
  });
  assert.equal(catalog.locationParameters({ ...form(), postal_code: '13400-000' }, null).p_postal_code, '13400000');
});

test('catalog validates lengths and partial CEP, preserving concurrency revision on edits', () => {
  for (const field of ['name', 'address', 'city', 'state']) {
    assert.throws(() => catalog.locationParameters({ ...form(), [field]: '' }, null), /Confira/);
  }
  for (const invalid of [{ number: '1'.repeat(31) }, { neighborhood: 'x'.repeat(121) },
    { name: 'x'.repeat(161) }, { address: 'x'.repeat(301) }, { postal_code: '134' }]) {
    assert.throws(() => catalog.locationParameters({ ...form(), ...invalid }, null), /Confira/);
  }
  const parameters = catalog.locationParameters(form(), { id: 'location', revision: 4 });
  assert.equal(parameters.p_id, 'location');
  assert.equal(parameters.p_expected_revision, 4);
  for (const status of ['pending', 'resolved', 'failed', 'needs_review']) assert.ok(catalog.geocodingLabels[status]);
});

test('catalog migration has no dependency on events, jobs, attendance or geocoding API', () => {
  const sql = source('../supabase/migrations/20261015060000_work_locations_catalog.sql');
  assert.doesNotMatch(sql, /public\.(events|jobs|checkins|checkouts|applications)\b/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public.work_locations FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /WHERE is_default AND archived_at IS NULL/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /p_expected_revision IS DISTINCT FROM/);
  const ui = source('../app/components/restaurant-locations.tsx');
  assert.doesNotMatch(ui, /getDeviceCoordinates|resolveWorkLocation|\/api\/geocode/);
  assert.match(ui, /supabase\.rpc\('save_work_location'/);
  assert.match(ui, /supabase\.rpc\('manage_work_location'/);
  assert.match(ui, /mutationLock/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /range\(offset, offset \+ pageSize - 1\)/);
  assert.match(source('../app/restaurant/more/page.tsx'), /href: '\/restaurant\/locations'/);
  assert.match(source('../app/components/mobile-bottom-nav.tsx'), /href: '\/restaurant\/more'/);
  assert.equal(existsSync(new URL('../supabase/migrations/20261015050000_operational_locations.sql', import.meta.url)), false);
  assert.ok(existsSync(new URL('../supabase/proposals/20261015050000_operational_locations.sql', import.meta.url)));
});

function mountCatalog() {
  const db = {
    records: [], calls: [], failure: '', confirm: true, user: 'owner',
    auth: { getUser: async () => ({ data: { user: { id: db.user } }, error: null }) },
    from(table) {
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        single: async () => ({ data: { role: 'restaurant' }, error: null }),
        range: async () => ({
          data: db.failure === 'read' ? null : structuredClone(db.records),
          error: db.failure === 'read' ? { message: 'offline' } : null,
        }),
      };
      assert.ok(['users', 'work_locations'].includes(table));
      return chain;
    },
    async rpc(name, args) {
      db.calls.push({ name, args });
      if (db.failure === 'write') return { error: { message: 'write rejected' } };
      if (name === 'save_work_location') {
        let record = db.records.find((item) => item.id === args.p_id);
        if (!record) {
          record = { id: 'location', revision: 0, is_default: false, archived_at: null, geocoding_status: 'pending' };
          db.records.push(record);
        }
        for (const field of Object.keys(catalog.emptyLocationForm)) record[field] = args[`p_${field}`];
        record.revision++;
      } else {
        const record = db.records.find((item) => item.id === args.p_id);
        if (args.p_action === 'set_default') record.is_default = true;
        if (args.p_action === 'unset_default') record.is_default = false;
        if (args.p_action === 'archive') { record.archived_at = 'archived'; record.is_default = false; }
        if (args.p_action === 'restore') record.archived_at = null;
        if (args.p_action === 'delete') db.records = [];
        record.revision++;
      }
      if (db.failure === 'after-write') db.failure = 'read';
      return { error: null };
    },
  };
  const slots = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let root;
  const globals = ['window', 'requestAnimationFrame'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => db.confirm } });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback) => callback() });
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
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
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies };
        effects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const dependencies = {
    react, 'next/link': { default: 'link' }, '@/lib/work-locations': catalog,
    '@/lib/supabase/client': { createClient: () => db },
    '@/app/components/mobile-bottom-nav': { default: 'navigation' },
    '@/app/components/ui': Object.fromEntries(['Badge', 'Button', 'Card', 'EmptyState', 'LoadingSkeleton', 'MaskedInput', 'Select', 'TextInput', 'Toast'].map((name) => [name, name])),
  };
  const { outputText } = ts.transpileModule(source('../app/components/restaurant-locations.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports);
  function render() {
    cursor = 0; dirty = false; root = exports.default();
    const queued = effects; effects = [];
    for (const effect of queued) effect();
  }
  const tree = (node) => !node || typeof node !== 'object' ? [] : [
    node, ...[node.props?.children].flat(Infinity).flatMap(tree),
  ];
  const text = (node) => typeof node === 'string' ? node : Array.isArray(node)
    ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
  render();
  const app = {
    db,
    nodes: () => tree(root),
    texts: (type) => tree(root).filter((node) => node.type === type).map(text).join(' '),
    async flush() {
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (dirty) render();
      }
    },
    async click(label) {
      const button = tree(root).find((node) => node.type === 'Button' && text(node) === label);
      assert.ok(button, `Missing button ${label}`);
      assert.ok(!button.props.disabled, `Disabled button ${label}`);
      button.props.onClick();
      await this.flush();
    },
    async change(id, value) {
      const input = tree(root).find((node) => node.props.id === id);
      input.props.onChange({ target: { value } });
      await this.flush();
    },
    async fill() {
      for (const [field, value] of Object.entries(form())) {
        if (field !== 'postal_code') await this.change(`catalog-${field}`, value);
      }
    },
    async saveTwice() {
      const handler = tree(root).find((node) => node.type === 'form').props.onSubmit;
      handler({ preventDefault() {} });
      handler({ preventDefault() {} });
      await this.flush();
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
  return app;
}

test('actual catalog component creates once, edits, defaults, archives, restores and deletes', async () => {
  const app = mountCatalog();
  try {
    await app.flush();
    assert.match(app.nodes().find((node) => node.type === 'EmptyState').props.title, /primeiro local/);
    await app.click('Cadastrar local');
    await app.fill();
    await app.saveTwice();
    assert.equal(app.db.calls.length, 1);
    assert.equal(app.db.records[0].postal_code, '');
    assert.match(app.texts('Badge'), /Coordenadas pendentes/);
    await app.click('Definir como padrão');
    assert.match(app.texts('Badge'), /Padrão/);
    await app.click('Editar');
    await app.change('catalog-name', 'Local editado');
    await app.saveTwice();
    assert.equal(app.db.records[0].name, 'Local editado');
    app.db.confirm = false;
    await app.click('Arquivar');
    assert.equal(app.db.records[0].archived_at, null);
    app.db.confirm = true;
    await app.click('Arquivar');
    await app.change('catalog-filter', 'archived');
    assert.match(app.texts('Badge'), /Arquivado/);
    await app.click('Restaurar');
    assert.equal(app.db.records[0].is_default, false);
    await app.change('catalog-filter', 'active');
    await app.click('Arquivar');
    await app.change('catalog-filter', 'archived');
    app.db.confirm = false;
    await app.click('Excluir definitivamente');
    assert.equal(app.db.records.length, 1);
    app.db.confirm = true;
    await app.click('Excluir definitivamente');
    assert.equal(app.db.records.length, 0);
  } finally { app.unmount(); }
});

test('actual catalog component preserves failed form and distinguishes saved-but-refresh-failed', async () => {
  const app = mountCatalog();
  try {
    await app.flush();
    await app.click('Cadastrar local');
    await app.fill();
    app.db.failure = 'write';
    await app.saveTwice();
    assert.match(app.texts('Toast'), /write rejected/);
    assert.ok(app.nodes().some((node) => node.type === 'form'));
    app.db.failure = 'after-write';
    await app.saveTwice();
    assert.equal(app.db.records.length, 1);
    assert.match(app.texts('Toast'), /alteração foi salva/);
    assert.ok(!app.nodes().some((node) => node.type === 'form'));
    assert.ok(app.nodes().find((node) => node.type === 'Button' && node.props.children === 'Cadastrar local').props.disabled);
    app.db.failure = '';
    await app.click('Atualizar lista');
    assert.match(app.texts('Card'), /Hotel Fazenda/);
  } finally { app.unmount(); }
});

test('actual catalog component exposes read errors instead of empty success and refuses changed session writes', async () => {
  const app = mountCatalog();
  try {
    await app.flush();
    app.db.failure = 'read';
    await app.click('Atualizar lista');
    assert.match(app.texts('Toast'), /offline/);
    assert.ok(!app.nodes().some((node) => node.type === 'EmptyState'));
    app.db.failure = '';
    await app.click('Atualizar lista');
    await app.click('Cadastrar local');
    await app.fill();
    app.db.user = 'other';
    await app.saveTwice();
    assert.equal(app.db.calls.length, 0);
    assert.match(app.texts('Toast'), /Sessão expirada ou alterada/);
  } finally { app.unmount(); }
});
