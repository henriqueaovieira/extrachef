import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server');

function loadTsx(relativePath, dependencies = {}) {
  const source = require('node:fs').readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  const resolve = (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  new Function('require', 'exports', outputText)(resolve, exports);
  return exports;
}

const staffAccess = loadTsx('../lib/auth/staff-access.ts');
const staffPermissions = loadTsx('../lib/auth/staff-permissions.ts');
const staffAuthorization = loadTsx('../lib/auth/staff-authorization.ts', {
  '@/lib/auth/staff-access': staffAccess,
  '@/lib/auth/staff-permissions': staffPermissions,
});
let membership;
const AdminLayout = loadTsx('../app/admin/layout.tsx', {
  'next/link': {
    default: ({ href, children, ...props }) => createElement('a', { href, ...props }, children),
  },
  '@/lib/auth/staff-authorization': staffAuthorization,
  '@/lib/auth/staff-page-access': { getStaffPageAccess: async () => membership },
}).default;

async function navigationFor(role) {
  membership = { role, status: 'active' };
  return renderToStaticMarkup(await AdminLayout({ children: createElement('div') }));
}

test('Admin navigation exposes Staff, Audit and Settings', async () => {
  const markup = await navigationFor('admin');
  for (const label of ['Dashboard', 'Staff', 'Users', 'Verification', 'Audit', 'Settings']) {
    assert.match(markup, new RegExp(`>${label}</a>`));
  }
});

test('Reviewer navigation excludes Staff, Audit and Settings', async () => {
  const markup = await navigationFor('reviewer');
  for (const label of ['Dashboard', 'Users', 'Verification']) {
    assert.match(markup, new RegExp(`>${label}</a>`));
  }
  for (const label of ['Staff', 'Audit', 'Settings']) {
    assert.doesNotMatch(markup, new RegExp(`>${label}</a>`));
  }
});

test('Support navigation excludes Staff, Audit and Settings', async () => {
  const markup = await navigationFor('support');
  for (const label of ['Dashboard', 'Users', 'Verification']) {
    assert.match(markup, new RegExp(`>${label}</a>`));
  }
  for (const label of ['Staff', 'Audit', 'Settings']) {
    assert.doesNotMatch(markup, new RegExp(`>${label}</a>`));
  }
});
