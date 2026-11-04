import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

function load(file, dependencies) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}

test('legacy message query and hash replace history without mounting talents or a second inbox', () => {
  let hash, params, effect, subscribe, getSnapshot, getServerSnapshot;
  const destinations = [];
  const router = { replace: (href) => destinations.push(href) };
  const Talent = () => null;
  const Page = load('../app/restaurant/candidates/page.tsx', {
    react: {
      ...React,
      useEffect: (callback) => { effect = callback; },
      useSyncExternalStore(subscription, snapshot, serverSnapshot) {
        subscribe = subscription;
        getSnapshot = snapshot;
        getServerSnapshot = serverSnapshot;
        assert.equal(typeof snapshot, 'function');
        return hash;
      },
    },
    'next/navigation': { useRouter: () => router, useSearchParams: () => params },
    'next/link': { default: () => null },
    '@/app/components/ui': { LoadingSkeleton: () => null },
    '@/app/restaurant/candidates/talent-center': { default: Talent },
  }).default;
  for (const [search, anchor, target] of [
    ['view=messages', '', '/restaurant/messages'],
    ['', '#chats', '/restaurant/messages'],
    ['demand=d1&from=notice', '#chats', '/restaurant/messages?demand=d1&from=notice'],
    ['view=messages&from=old', '#conversation', '/restaurant/messages?from=old#conversation'],
    ['view=messages&view=messages', '#chats', '/restaurant/messages'],
  ]) {
    params = new URLSearchParams(search);
    hash = anchor;
    const tree = Page();
    assert.notEqual(tree.type, Talent);
    effect();
    assert.equal(destinations.at(-1), target);
  }
  for (const [search, anchor] of [
    ['', ''], ['demand=d1', ''], ['view=talents&demand=d2', '#candidates-heading'],
  ]) {
    params = new URLSearchParams(search);
    hash = anchor;
    const before = destinations.length;
    const tree = Page();
    effect();
    assert.equal(tree.type, Talent);
    assert.equal(tree.props.initialDemandId, params.get('demand'));
    assert.equal(destinations.length, before);
  }
  hash = null;
  params = new URLSearchParams('demand=d1');
  assert.notEqual(Page().type, Talent, 'SSR must not mount talents before the browser hash is known');
  assert.equal(getServerSnapshot(), null);
  const oldWindow = globalThis.window;
  const events = [];
  try {
    globalThis.window = {
      location: { hash: '#chats' },
      addEventListener: (name, callback) => events.push(['add', name, callback]),
      removeEventListener: (name, callback) => events.push(['remove', name, callback]),
    };
    assert.equal(getSnapshot(), '#chats');
    let updatedHash;
    const callback = () => { updatedHash = getSnapshot(); };
    subscribe(callback)();
    assert.deepEqual(events, [['add', 'hashchange', callback], ['remove', 'hashchange', callback]]);
    globalThis.window.location.hash = '#candidates-heading';
    events[0][2]();
    assert.equal(updatedHash, '#candidates-heading');
  } finally { globalThis.window = oldWindow; }
});

test('only the official restaurant message route mounts the inbox and internal links use it', () => {
  const canonical = read('../app/restaurant/messages/page.tsx');
  assert.match(canonical, /<RestaurantMessageCenter \/>/);
  assert.doesNotMatch(read('../app/restaurant/candidates/page.tsx'), /import RestaurantMessageCenter|<RestaurantMessageCenter/);
  for (const file of readdirSync(new URL('../app/', import.meta.url), { recursive: true })) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = read(`../app/${file.replaceAll('\\', '/')}`);
    assert.doesNotMatch(source, /['"`]\/restaurant\/candidates(?:#chats|\?view=messages)/, file);
  }
  assert.match(read('../app/components/notification-center.tsx'), /role === 'restaurant' \? '\/restaurant\/messages' : '\/worker\/messages'/);
  assert.match(read('../app/components/mobile-bottom-nav.tsx'), /href: '\/restaurant\/messages', label: 'Mensagens'/);
  assert.match(read('../app/chat/[jobId]/chat-client.tsx'), /\? '\/restaurant\/messages'/);
});
