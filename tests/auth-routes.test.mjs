import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAccessPath, dashboardFor, isAccountRole, isProtectedPath, loginHref, sanitizeRedirect,
} from '../lib/auth/routes.ts';

test('all requested protected namespaces include their root and descendants', () => {
  for (const root of [
    '/restaurant', '/worker', '/chat', '/checkin', '/checkout', '/payment',
    '/reviews', '/notifications', '/settings', '/profile',
  ]) {
    assert.equal(isProtectedPath(root), true, root);
    assert.equal(isProtectedPath(`${root}/example`), true, root);
    assert.equal(isProtectedPath(`${root}-public`), false, root);
  }
  for (const path of ['/', '/login', '/register', '/auth/callback', '/api/push/receipt', '/sw.js']) {
    assert.equal(isProtectedPath(path), false, path);
  }
});

test('roles have explicit dashboards and cannot access the opposite namespace', () => {
  assert.equal(dashboardFor('restaurant'), '/restaurant/dashboard');
  assert.equal(dashboardFor('worker'), '/worker/dashboard');
  assert.equal(canAccessPath('/restaurant/events', 'worker'), false);
  assert.equal(canAccessPath('/worker/dashboard', 'restaurant'), false);
  assert.equal(canAccessPath('/chat/123', 'restaurant'), true);
  assert.equal(canAccessPath('/notifications', 'worker'), true);
  assert.equal(isAccountRole('admin'), false);
  assert.equal(isAccountRole(null), false);
  assert.equal(isAccountRole('worker'), true);
  assert.equal(isAccountRole('restaurant'), true);
});

test('safe redirects preserve deep links, queries and fragments', () => {
  for (const path of [
    '/restaurant/dashboard', '/restaurant/events',
    '/notifications', '/profile', '/chat/123', '/chat/123?from=push#latest', '/payment/123',
  ]) {
    assert.equal(sanitizeRedirect(path, 'restaurant'), path);
  }
  assert.equal(sanitizeRedirect('/worker/dashboard', 'worker'), '/worker/dashboard');
});

test('external, ambiguous, encoded and public targets fall back to the role dashboard', () => {
  for (const role of ['worker', 'restaurant']) {
    for (const path of [
      undefined, null, '', 'https://google.com', 'http://site-falso.com',
      '//malicioso.com', '///malicioso.com', 'javascript:alert(1)', 'data:text/html',
      '/\\malicioso.com', '\\\\malicioso.com', '/chat/123\n', '/chat/\u0000',
      '/%2f%2fmalicioso.com', '/%252f%252fmalicioso.com',
      '/chat/%5c%5cmalicioso.com', '/chat/%255c%255cmalicioso.com',
      '/restaurant/../login', '/login', '/register', '/api/push/dispatch', '/admin',
    ]) {
      assert.equal(sanitizeRedirect(path, role), dashboardFor(role), String(path));
    }
  }
});

test('wrong-role redirects produce the friendly denial reason', () => {
  assert.equal(
    sanitizeRedirect('/restaurant/events', 'worker'),
    '/worker/dashboard?reason=role_forbidden',
  );
  assert.equal(
    sanitizeRedirect('/worker/profile', 'restaurant'),
    '/restaurant/dashboard?reason=role_forbidden',
  );
});

test('login URL encodes the original route as data, not another navigation target', () => {
  const original = '/chat/123?from=push&message=456#latest';
  const url = new URL(loginHref(original, 'session_expired'), 'https://extrachef.invalid');
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('redirect'), original);
  assert.equal(url.searchParams.get('reason'), 'session_expired');
  assert.equal(url.hash, '');
  assert.equal(new URL(loginHref('/restaurant/events'), url).searchParams.has('reason'), false);
});
