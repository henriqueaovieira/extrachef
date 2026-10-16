import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
function loadTs(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name]
      : name === '@/lib/push-config' ? { validateVapidPair: () => true }
      : name === '@/lib/push-device' ? loadTs('../lib/push-device.ts') : require(name), exports,
  );
  return exports;
}
const communication = loadTs('../lib/communication.ts');
async function readCounts(db, userId) {
  const [messages, notifications] = await Promise.all([
    communication.readUnreadMessageCount(db, userId),
    communication.readUnreadNotificationCount(db, userId),
  ]);
  return { messages, notifications };
}
const incoming = (id, extra = {}) => ({
  id, job_id: 'job-a', sender_id: 'worker', content: `Message ${id}`, read_at: null, ...extra,
});

function database() {
  const db = {
    messages: [], notifications: [], push_subscriptions: [], push_deliveries: [],
    failure: '', previewCalls: 0, channels: [],
    holdCounts: false, pendingCounts: [], autoSubscribe: true,
    async rpc(name, parameters) {
      if (name === 'get_chat_message_preview') {
        db.previewCalls++;
        const message = db.messages.find((item) => item.id === parameters.p_message_id);
        return { data: message ? [{ ...message, sender_name: 'Worker', photo_path: null, photo_bucket: null }] : [], error: null };
      }
      if (name === 'mark_chat_messages_read') {
        if (db.failure === 'read') return { error: new Error('unavailable') };
        for (const message of db.messages) {
          if (message.job_id === parameters.p_job_id && parameters.p_message_ids.includes(message.id) && message.sender_id !== 'restaurant') {
            message.read_at = '2026-10-15T10:00:00Z';
            db.emit('messages', 'UPDATE', { ...message });
          }
        }
        return { error: null };
      }
      if (name === 'record_push_delivery') {
        db.push_deliveries.push(parameters);
        return { error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      let filters = [];
      let head = false;
      let exactCount = false;
      let limit = Infinity;
      let single = false;
      const query = {
        select(_columns, options) { head = Boolean(options?.head); exactCount = options?.count === 'exact'; return query; },
        limit(value) { limit = value; return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        neq(key, value) { filters.push((row) => row[key] !== value); return query; },
        is(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        maybeSingle() { single = true; return query; },
        insert(row) {
          if (db.failure === 'send') return Promise.resolve({ error: new Error('unavailable') });
          const message = incoming(`sent-${db.messages.length}`, row);
          db.messages.push(message);
          db.emit('messages', 'INSERT', { ...message });
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          const rows = table === 'notification_preferences' ? [{ messages_enabled: true, user_id: 'restaurant' }] : db[table];
          const data = rows.filter((row) => filters.every((filter) => filter(row)));
          const result = {
            data: head ? null : single ? data[0] ?? null : data.slice(0, limit).map((row) => ({ ...row })),
            count: exactCount ? data.length : null,
            error: db.failure === table ? new Error('unavailable') : null,
          };
          const ready = exactCount && db.holdCounts
            ? new Promise((release) => db.pendingCounts.push(() => release(result)))
            : Promise.resolve(result);
          return ready.then(resolve, reject);
        },
      };
      return query;
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'restaurant' } }, error: null }),
      onAuthStateChange(listener) {
        db.authListener = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    channel() {
      const channel = {
        handlers: [],
        on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
        subscribe(callback) { channel.status = callback; if (db.autoSubscribe) queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
      };
      db.channels.push(channel);
      return channel;
    },
    removeChannel: async (channel) => { db.channels = db.channels.filter((item) => item !== channel); },
    emit(table, eventType, row) {
      for (const channel of db.channels) {
        for (const { filter, callback } of channel.handlers) {
          if (filter.table === table) callback({ eventType, new: row, old: { id: row.id } });
        }
      }
    },
  };
  return db;
}

test('exact unread counts use messages independently from notification receipts and list limits', async () => {
  const db = database();
  db.messages = [incoming('1'), incoming('2'), incoming('3', { read_at: 'read' }), incoming('4', { sender_id: 'restaurant' })];
  db.notifications = [
    { user_id: 'restaurant', category: 'message', read: false },
    ...Array.from({ length: 125 }, () => ({ user_id: 'restaurant', category: 'operational', read: false })),
    { user_id: 'restaurant', category: 'review', read: true },
    { user_id: 'other', category: 'event', read: false },
  ];
  assert.deepEqual(await readCounts(db, 'restaurant'), { messages: 2, notifications: 125 });
  db.notifications = [];
  assert.deepEqual(await readCounts(db, 'restaurant'), { messages: 2, notifications: 0 });
  db.messages = [];
  assert.deepEqual(await readCounts(db, 'restaurant'), { messages: 0, notifications: 0 });
});

test('failed count queries reject instead of returning a stale or fabricated zero', async () => {
  for (const table of ['messages', 'notifications']) {
    const db = database();
    db.failure = table;
    await assert.rejects(readCounts(db, 'restaurant'), /não foi possível/i);
  }
});

test('chat badge loads before Realtime subscribes and reconciles messages on subscription', async () => {
  const db = database();
  db.autoSubscribe = false;
  db.messages = [incoming('before-connection')];
  const app = mountProvider(db);
  try {
    await app.flush();
    assert.equal(app.context.counts.messages, 1);
    assert.equal(app.context.counts.notifications, null);
    db.messages.push(incoming('during-connection'));
    db.channels[0].status('SUBSCRIBED');
    await app.flush();
    assert.equal(app.context.counts.messages, 2);
    assert.equal(app.context.counts.notifications, 0);
  } finally { app.unmount(); }
});

test('notification count failure cannot suppress Chat; Realtime INSERT and read UPDATE keep its count exact', async () => {
  const db = database();
  db.failure = 'notifications';
  db.messages = [incoming('existing')];
  const app = mountProvider(db);
  try {
    await app.flush();
    assert.deepEqual(app.context.counts, { messages: 1, notifications: null });
    assert.equal(app.context.chatError, '');
    assert.match(app.context.error, /indicadores/);
    const message = incoming('received');
    db.messages.push(message);
    db.emit('messages', 'INSERT', message);
    await app.flush();
    assert.equal(app.context.counts.messages, 2);
    await app.context.markRead('job-a', ['existing', 'received']);
    await app.flush();
    assert.equal(app.context.counts.messages, 0);
    assert.equal(app.context.counts.notifications, null);
    assert.equal(app.context.chatError, '');
  } finally { app.unmount(); }
});

test('message query requests an exact total with only one ID returned, never a list-length approximation', async () => {
  const db = database();
  db.messages = Array.from({ length: 125 }, (_, index) => incoming(`message-${index}`));
  assert.equal(await communication.readUnreadMessageCount(db, 'restaurant'), 125);
  const code = source('../lib/communication.ts');
  const messageQuery = code.slice(code.indexOf('export async function readUnreadMessageCount'), code.indexOf('export async function readUnreadNotificationCount'));
  assert.match(messageQuery, /count: 'exact'/);
  assert.match(messageQuery, /neq\('sender_id', userId\)\.is\('read_at', null\)\.limit\(1\)/);
  assert.doesNotMatch(messageQuery, /head: true|from\('notifications'\)/);
});

test('read operations acknowledge only snapshot IDs, chunk the RPC bound and surface failures', async () => {
  const calls = [];
  const ids = Array.from({ length: 1001 }, (_, index) => `id-${index}`);
  await communication.markChatRead({ rpc: async (name, args) => { calls.push([name, args]); return { error: null }; } }, 'job-a', ids);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'mark_chat_messages_read');
  assert.equal(calls[0][1].p_message_ids.length, 1000);
  assert.deepEqual(calls[1][1], { p_job_id: 'job-a', p_message_ids: ['id-1000'] });
  await assert.rejects(communication.markChatRead(databaseWithReadFailure(), 'job-a', ['1']), /registrar a leitura/);
  function databaseWithReadFailure() { const db = database(); db.failure = 'read'; return db; }
});

test('conversation detection and unread checks reject own/read messages and unrelated routes', () => {
  assert.equal(communication.isIncomingUnread(incoming('1'), 'restaurant'), true);
  assert.equal(communication.isIncomingUnread(incoming('1', { read_at: 'read' }), 'restaurant'), false);
  assert.equal(communication.isIncomingUnread(incoming('1', { sender_id: 'restaurant' }), 'restaurant'), false);
  assert.equal(communication.isOpenConversation('/chat/job-a/', 'job-a'), true);
  assert.equal(communication.isOpenConversation('/chat/job-ab', 'job-a'), false);
});

// Execute the actual provider's hooks with controlled browser/Supabase boundaries.
function mountProvider(db) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let root;
  let pathname = '/restaurant/dashboard';
  const descriptors = ['document', 'window', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const window = new EventTarget();
  window.setTimeout = setTimeout;
  const worker = new EventTarget();
  for (const [key, value] of Object.entries({ document, window, navigator: { serviceWorker: worker } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
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
  const { default: Provider } = loadTs('../app/components/notification-experience.tsx', {
    react,
    'next/navigation': { usePathname: () => pathname },
    'next/image': { default: 'image' },
    'next/link': { default: 'link' },
    '@/lib/supabase/client': { createClient: () => db },
    '@/lib/communication': communication,
    '@/app/components/communication-state': { CommunicationContext: { Provider: 'provider' } },
    '@/app/components/ui': { Button: 'button', TextInput: 'input', Toast: 'toast' },
  });
  function render() {
    cursor = 0; dirty = false;
    root = Provider({ children: 'application' });
    const queued = effects; effects = [];
    for (const effect of queued) effect();
  }
  const tree = (element) => !element || typeof element !== 'object' ? [] : [
    element, ...[element.props?.children].flat(Infinity).flatMap(tree),
  ];
  render();
  return {
    get context() { return root.props.value; },
    get popup() { return tree(root).find((node) => node.type === 'aside' && node.props['aria-label'] === 'Nova mensagem'); },
    get toast() { return tree(root).find((node) => node.type === 'aside' && !node.props['aria-label']); },
    document, worker,
    async flush() {
      for (let iteration = 0; iteration < 8; iteration++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (dirty) render();
      }
    },
    async navigate(path) { pathname = path; render(); await this.flush(); },
    async reply(text) {
      const nodes = tree(this.popup);
      nodes.find((node) => node.type === 'input').props.onChange({ target: { value: text } });
      await this.flush();
      tree(this.popup).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
      await this.flush();
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('provider shows nothing floating at startup; Realtime and Push share message-ID deduplication', async () => {
  const db = database();
  db.messages.push(incoming('old'));
  const app = mountProvider(db);
  try {
    await app.flush();
    assert.equal(app.context.counts.messages, 1);
    assert.equal(app.popup, undefined);
    assert.equal(app.toast, undefined);
    const message = incoming('new');
    db.messages.push(message);
    db.notifications.push({ id: 'notice', message_id: message.id, user_id: 'restaurant', category: 'message', read: false });
    db.emit('messages', 'INSERT', message);
    await app.flush();
    assert.equal(app.context.counts.messages, 2);
    assert.ok(app.popup);
    assert.ok(app.toast);
    app.worker.dispatchEvent(new MessageEvent('message', { data: { type: 'PUSH_RECEIVED', payload: { category: 'message', notificationId: 'notice' } } }));
    await app.flush();
    assert.equal(db.previewCalls, 1);
    await app.navigate('/chat/job-a');
    assert.equal(app.popup, undefined);
    assert.equal(app.toast, undefined);
    const activeMessage = incoming('active');
    db.messages.push(activeMessage);
    db.emit('messages', 'INSERT', activeMessage);
    await app.flush();
    assert.equal(db.previewCalls, 1);
  } finally { app.unmount(); }
});

test('provider closes read popups across tabs and successful quick replies persist the original read receipt', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    const first = incoming('first');
    db.messages.push(first);
    db.emit('messages', 'INSERT', first);
    await app.flush();
    assert.ok(app.popup);
    first.read_at = 'read';
    db.emit('messages', 'UPDATE', first);
    await app.flush();
    assert.equal(app.popup, undefined);
    const second = incoming('second');
    db.messages.push(second);
    db.emit('messages', 'INSERT', second);
    await app.flush();
    await app.reply('Reply');
    assert.equal(app.popup, undefined);
    assert.equal(app.toast, undefined);
    assert.ok(second.read_at);
    assert.equal(db.messages.at(-1).content, 'Reply');
    assert.equal(app.context.counts.messages, 0);
  } finally { app.unmount(); }
});

test('own, read and background messages do not open popups; errors clear counts rather than leaving stale badges', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    for (const message of [incoming('own', { sender_id: 'restaurant' }), incoming('read', { read_at: 'read' })]) {
      db.messages.push(message); db.emit('messages', 'INSERT', message);
    }
    app.document.visibilityState = 'hidden';
    const hidden = incoming('hidden'); db.messages.push(hidden); db.emit('messages', 'INSERT', hidden);
    await app.flush();
    assert.equal(app.popup, undefined);
    assert.equal(db.previewCalls, 0);
    assert.equal(app.context.counts.messages, 1);
    db.failure = 'messages';
    await app.context.refresh();
    await app.flush();
    assert.deepEqual(app.context.counts, { messages: null, notifications: 0 });
    assert.match(app.context.chatError, /mensagens não lidas/);
    db.failure = '';
    await app.context.refresh();
    await app.flush();
    assert.equal(app.context.counts.messages, 1);
    db.authListener('SIGNED_OUT', null);
    await app.flush();
    assert.deepEqual(app.context.counts, { messages: null, notifications: null });
    assert.equal(app.popup, undefined);
  } finally { app.unmount(); }
});

test('quick reply failure keeps the preview and does not acknowledge the received message', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    const message = incoming('failed-reply');
    db.messages.push(message); db.emit('messages', 'INSERT', message);
    await app.flush();
    db.failure = 'send';
    await app.reply('Cannot send');
    assert.ok(app.popup);
    assert.equal(message.read_at, null);
    assert.equal(db.messages.length, 1);
  } finally { app.unmount(); }
});

test('acknowledging an earlier snapshot does not close a newer unread popup', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    const first = incoming('earlier');
    db.messages.push(first); db.emit('messages', 'INSERT', first);
    await app.flush();
    const next = incoming('later');
    db.messages.push(next); db.emit('messages', 'INSERT', next);
    await app.flush();
    await app.context.markRead('job-a', [first.id]);
    await app.flush();
    assert.ok(app.popup);
    assert.equal(first.read_at !== null, true);
    assert.equal(next.read_at, null);
    assert.equal(app.context.counts.messages, 1);
  } finally { app.unmount(); }
});

test('out-of-order count responses and logout cannot restore stale badges', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    db.holdCounts = true;
    db.messages.push(incoming('one'));
    const first = app.context.refresh();
    await app.flush();
    db.messages.push(incoming('two'));
    const second = app.context.refresh();
    await app.flush();
    db.pendingCounts[2](); db.pendingCounts[3]();
    await second; await app.flush();
    assert.equal(app.context.counts.messages, 2);
    db.pendingCounts[0](); db.pendingCounts[1]();
    await first; await app.flush();
    assert.equal(app.context.counts.messages, 2);
    const beforeLogout = app.context.refresh();
    await app.flush();
    db.authListener('SIGNED_OUT', null);
    db.pendingCounts[4](); db.pendingCounts[5]();
    await beforeLogout; await app.flush();
    assert.deepEqual(app.context.counts, { messages: null, notifications: null });
  } finally { app.unmount(); }
});

test('a successful reply is not offered for resending when recording its read receipt fails', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    const message = incoming('reply-read-failure');
    db.messages.push(message); db.emit('messages', 'INSERT', message);
    await app.flush();
    db.failure = 'read';
    await app.reply('Sent only once');
    assert.equal(app.popup, undefined);
    assert.equal(db.messages.length, 2);
    assert.equal(message.read_at, null);
  } finally { app.unmount(); }
});

test('actual navigation badges hide zero/unknown counts and show independent positive values', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let counts = { messages: 0, notifications: 0 };
  const dependencies = {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { usePathname: () => '/notifications' },
    '@/app/components/communication-state': { useCommunication: () => ({ counts, error: '' }) },
  };
  const { default: Nav } = loadTs('../app/components/mobile-bottom-nav.tsx', dependencies);
  const { default: Bell } = loadTs('../app/components/notification-bell.tsx', dependencies);
  for (const value of [0, null]) {
    counts = { messages: value, notifications: value };
    const markup = renderToStaticMarkup(React.createElement(Nav, { role: 'worker' }));
    assert.doesNotMatch(markup, /bg-red-600/);
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(Bell)), /bg-red-600/);
  }
  counts = { messages: 3, notifications: 125 };
  const markup = renderToStaticMarkup(React.createElement(Nav, { role: 'restaurant' }));
  assert.match(markup, /aria-label="Chat: 3 não lidas"/);
  assert.match(markup, /aria-label="Avisos: 125 não lidas"/);
  assert.match(markup, /99\+/);
  assert.match(renderToStaticMarkup(React.createElement(Bell)), /Notificações: 125 não lidas/);
});

test('center scopes every query/mutation away from message notifications and uses shared exact count', () => {
  const center = source('../app/components/notification-center.tsx');
  assert.equal((center.match(/\.neq\('category', 'message'\)/g) ?? []).length, 4);
  assert.match(center, /const unreadCount = counts\.notifications/);
  assert.doesNotMatch(center, /value: 'message'/);
  const experience = source('../app/components/notification-experience.tsx');
  assert.doesNotMatch(experience, /href="\/notifications"/);
});

test('new application migration notifies the job owner transactionally without changing approval', () => {
  const sql = source('../supabase/migrations/20261015040000_notify_application_received.sql');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /SELECT jobs\.restaurant_id, users\.name, jobs\.title\s+INTO STRICT recipient_id, worker_name, job_title/);
  assert.match(sql, /users\.id = NEW\.worker_id/);
  assert.match(sql, /jobs\.id = NEW\.job_id/);
  assert.match(sql, /AFTER INSERT ON public\.applications/);
  assert.match(sql, /WHEN \(NEW\.status = 'pending'\)/);
  assert.match(sql, /INSERT INTO public\.notifications \(user_id, title, message, url, category\)/);
  assert.match(sql, /recipient_id,\s+'Nova candidatura recebida'/);
  assert.match(sql, /%s se candidatou para %s/);
  assert.match(sql, /'\/restaurant\/candidates',\s+'application'/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /notify_application_approved|approve_application|UPDATE public\.|EXCEPTION WHEN/);
  const center = source('../app/components/notification-center.tsx');
  assert.match(center, /notification\.category === 'application' && notification\.url === '\/restaurant\/candidates'\s+\? 'Ver candidatura' : 'Abrir'/);
});

test('application notification INSERT refreshes the restaurant notification badge, not Chat or message popup', async () => {
  const db = database();
  const app = mountProvider(db);
  try {
    await app.flush();
    assert.deepEqual(app.context.counts, { messages: 0, notifications: 0 });
    const notice = {
      id: 'new-application', user_id: 'restaurant', category: 'application',
      title: 'Nova candidatura recebida', message: 'Worker se candidatou para Cozinha',
      url: '/restaurant/candidates', read: false,
    };
    db.notifications.push(notice);
    db.emit('notifications', 'INSERT', notice);
    await app.flush();
    assert.deepEqual(app.context.counts, { messages: 0, notifications: 1 });
    assert.equal(app.popup, undefined);
    assert.equal(app.toast, undefined);
    notice.read = true;
    db.emit('notifications', 'UPDATE', notice);
    await app.flush();
    assert.equal(app.context.counts.notifications, 0);
  } finally { app.unmount(); }
});

test('migration contracts bound authenticated read writes and leave historical read state unknown', () => {
  const sql = source('../supabase/migrations/20261015030000_chat_read_state.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS read_at timestamptz;/);
  assert.match(sql, /NOT public\.is_approved_chat_participant\(p_job_id\)/);
  assert.match(sql, /job_id = p_job_id AND id = ANY\(p_message_ids\)/);
  assert.match(sql, /sender_id <> auth\.uid\(\) AND read_at IS NULL/);
  assert.match(sql, /NEW\.read_at := NULL/);
  assert.match(sql, /REVOKE UPDATE ON TABLE public\.messages FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_chat_messages_read\(uuid, uuid\[\]\) FROM PUBLIC, anon/);
  assert.match(sql, /split_part\(p_path, '\/', 1\) = wp\.user_id::text/);
  assert.match(sql, /split_part\(p_path, '\/', 2\) LIKE 'profile-photo-%'/);
  assert.doesNotMatch(sql, /UPDATE public\.messages SET read_at = now\(\)\s*;/);
});

test('Push dispatcher reloads the actual notification and suppresses read/deleted records', async () => {
  const environment = {
    PUSH_WEBHOOK_SECRET: 'unit-test-webhook',
    WEB_PUSH_VAPID_PUBLIC_KEY: 'unit-test-public',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'unit-test-private',
    WEB_PUSH_SUBJECT: 'mailto:test@extrachef.test',
    NEXT_PUBLIC_APP_URL: 'https://extrachef.test',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const db = database();
  const deliveries = [];
  const { POST } = loadTs('../app/api/push/dispatch/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    'web-push': { default: { setVapidDetails() {}, sendNotification: async (_subscription, payload) => deliveries.push(JSON.parse(payload)) } },
    '@/lib/supabase/admin': { createAdminClient: () => db },
  });
  function dispatch() {
    return POST(new Request('https://extrachef.test/api/push/dispatch', {
      method: 'POST',
      headers: { 'x-extra-chef-webhook-secret': environment.PUSH_WEBHOOK_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'INSERT', record: { id: 'n1', user_id: 'restaurant', title: 'Old title', message: 'Old body' } }),
    }));
  }
  try {
    assert.equal((await (await dispatch()).json()).reason, 'notification_read_or_deleted');
    db.notifications.push({ id: 'n1', user_id: 'restaurant', read: true });
    assert.equal((await (await dispatch()).json()).reason, 'notification_read_or_deleted');
    db.notifications[0] = {
      id: 'n1', user_id: 'restaurant', read: false, category: 'message',
      title: 'Actual title', message: 'Actual body', message_id: 'm1', url: '/chat/job-a',
    };
    db.push_subscriptions.push({ id: 's1', user_id: 'restaurant', endpoint: 'https://fcm.googleapis.com/unit-test', p256dh: 'test', auth_secret: 'test' });
    const response = await dispatch();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent, 1);
    assert.equal(deliveries[0].title, 'Actual title');
    assert.equal(deliveries[0].body, 'Actual body');
    assert.equal(deliveries[0].messageId, 'm1');
    assert.equal(deliveries[0].url, 'https://extrachef.test/chat/job-a');
    assert.equal(db.push_deliveries[0].p_status, 'sent');
    db.notifications[0] = {
      id: 'n2', user_id: 'restaurant', read: false, category: 'application',
      title: 'Nova candidatura recebida', message: 'Worker se candidatou para Cozinha',
      message_id: null, url: '/restaurant/candidates',
    };
    const applicationRequest = new Request('https://extrachef.test/api/push/dispatch', {
      method: 'POST',
      headers: { 'x-extra-chef-webhook-secret': environment.PUSH_WEBHOOK_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'INSERT', record: db.notifications[0] }),
    });
    const applicationResponse = await POST(applicationRequest);
    assert.equal(applicationResponse.status, 200);
    assert.equal((await applicationResponse.json()).sent, 1);
    assert.equal(deliveries[1].category, 'application');
    assert.equal(deliveries[1].title, 'Nova candidatura recebida');
    assert.equal(deliveries[1].body, 'Worker se candidatou para Cozinha');
    assert.equal(deliveries[1].url, 'https://extrachef.test/restaurant/candidates');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Service Worker forwards visible-app Push without OS alert and displays background/closed alerts with a stable tag', async () => {
  const handlers = {};
  let windows = [];
  const alerts = [];
  const forwarded = [];
  let receipts = 0;
  const self = {
    location: { origin: 'https://extrachef.test' },
    clients: { matchAll: async () => windows },
    registration: { showNotification: async (title, options) => alerts.push({ title, options }) },
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  vm.runInNewContext(source('../public/sw.js'), { self, URL, Response, fetch: async () => { receipts++; } });
  const payload = { notificationId: 'n1', subscriptionId: 's1', receiptToken: 'test', title: 'Message', url: '/chat/job-a' };
  async function push() {
    let finished;
    handlers.push({ data: { json: () => payload }, waitUntil: (promise) => { finished = promise; } });
    await finished;
  }
  windows = [{ visibilityState: 'visible', focused: false, postMessage: (message) => forwarded.push(message) }];
  await push();
  assert.equal(alerts.length, 0);
  assert.equal(forwarded[0].type, 'PUSH_RECEIVED');
  windows = [{ visibilityState: 'hidden', focused: false }];
  await push();
  windows = [];
  await push();
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].options.tag, 'n1');
  assert.equal(receipts, 3);
});
