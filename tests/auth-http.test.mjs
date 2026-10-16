import assert from 'node:assert/strict';
import { test } from 'node:test';

const origin = process.env.EXTRACHEF_TEST_URL;

test('unauthenticated protected pages redirect without cache or loss of deep link', { skip: !origin }, async (t) => {
  for (const path of [
    '/restaurant/events', '/worker/dashboard', '/chat/123?from=push',
    '/checkin/123', '/checkout/123', '/reviews/123',
    '/notifications', '/settings/privacy', '/profile',
  ]) {
    await t.test(path, async () => {
      const response = await fetch(new URL(path, origin), { redirect: 'manual' });
      assert.equal(response.status, 307);
      const destination = new URL(response.headers.get('location'), origin);
      assert.equal(destination.origin, new URL(origin).origin);
      assert.equal(destination.pathname, '/login');
      assert.equal(destination.searchParams.get('redirect'), path);
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
    });
  }
});

test('confirmation callback without a code fails explicitly and keeps the destination', { skip: !origin }, async () => {
  const response = await fetch(new URL('/auth/callback?redirect=%2Fchat%2F123', origin), { redirect: 'manual' });
  assert.equal(response.status, 307);
  const destination = new URL(response.headers.get('location'), origin);
  assert.equal(destination.pathname, '/login');
  assert.equal(destination.searchParams.get('reason'), 'confirmation_failed');
  assert.equal(destination.searchParams.get('redirect'), '/chat/123');
  assert.match(response.headers.get('cache-control'), /no-store/);
});
