import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadTs(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exports,
  );
  return exports;
}
const { formatInput } = loadTs('../lib/ui/input-masks.ts');
const { getProfileProgress } = loadTs('../lib/ui/profile-progress.ts');
const ui = loadTs('../app/components/ui/index.tsx', { '@/lib/ui/input-masks': { formatInput } });
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('password control starts hidden, preserves autocomplete and never submits the form', () => {
  const markup = renderToStaticMarkup(createElement(ui.PasswordInput, {
    id: 'password', autoComplete: 'current-password', required: true, value: 'example', onChange() {},
  }));
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="current-password"/);
  assert.match(markup, /aria-controls="password"/);
  assert.match(markup, /aria-label="Mostrar senha"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /type="button"/);
});

test('busy buttons keep their action label and expose disabled and busy states', () => {
  const markup = renderToStaticMarkup(createElement(ui.Button, {
    type: 'submit', busy: true,
  }, 'Salvando evento'));
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /type="submit"/);
  assert.match(markup, /Salvando evento/);
});

test('date and number controls preserve native types, constraints and payload values', () => {
  const date = renderToStaticMarkup(createElement(ui.TextInput, {
    type: 'date', value: '2026-12-20', min: '2026-10-15', required: true, onChange() {},
  }));
  assert.match(date, /type="date"/);
  assert.match(date, /value="2026-12-20"/);
  assert.match(date, /min="2026-10-15"/);
  const number = renderToStaticMarkup(createElement(ui.TextInput, {
    type: 'number', min: 1, max: 100000, step: 1, value: 30, onChange() {},
  }));
  assert.match(number, /type="number"/);
  assert.match(number, /min="1"/);
  assert.match(number, /max="100000"/);
  assert.match(number, /step="1"/);
});

test('masks support empty, partial, pasted and already formatted input', () => {
  const examples = [
    ['cpf', '12345678901', '123.456.789-01'],
    ['cpf', '1234', '123.4'],
    ['cnpj', '12345678000190', '12.345.678/0001-90'],
    ['cnpj', '123456789', '12.345.678/9'],
    ['postal-code', '01310930', '01310-930'],
    ['phone', '1134567890', '(11) 3456-7890'],
    ['phone', '11987654321', '(11) 98765-4321'],
    ['phone', '+55 (11) 98765-4321', '+55 (11) 98765-4321'],
  ];
  for (const [mask, input, expected] of examples) {
    assert.equal(formatInput(input, mask), expected, `${mask}: ${input}`);
    assert.equal(formatInput(expected, mask), expected, `idempotent ${mask}`);
  }
  for (const mask of ['cpf', 'cnpj', 'phone', 'postal-code']) {
    assert.equal(formatInput('', mask), '');
    assert.equal(formatInput('letters', mask), '');
  }
});

test('document masks limit digits without changing their order', () => {
  assert.equal(formatInput('123456789012345', 'cpf').replace(/\D/g, ''), '12345678901');
  assert.equal(formatInput('123456780001901234', 'cnpj').replace(/\D/g, ''), '12345678000190');
  assert.equal(formatInput('01310930123', 'postal-code'), '01310-930');
});

test('profile progress is presentational, deterministic and counts only nonblank fields', () => {
  assert.equal(getProfileProgress('worker', '', {}).percentage, 0);
  assert.equal(getProfileProgress('worker', 'Name', { city: 'City', phone: ' ' }).percentage, 33);
  const worker = getProfileProgress('worker', 'Name', {
    city: 'City', phone: '123', cpf: '123', resume_pdf_path: 'resume', profile_photo_path: 'photo',
  });
  assert.equal(worker.percentage, 100);
  assert.equal(worker.items.length, 6);
  assert.equal(getProfileProgress('restaurant', 'Name', {
    city: 'City', phone: '123', cnpj: '123', address: 'Street', logo_path: 'logo',
  }).percentage, 100);
});

function luminance(hex) {
  const values = hex.match(/[a-f\d]{2}/gi).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('actual CSS tokens meet AA for field text, placeholders, primary buttons and boundaries', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const token = name => css.match(new RegExp(`${name}:\\s*(#[a-f\\d]{6})`, 'i'))[1];
  assert.ok(contrast(token('--ec-muted'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--foreground'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--ec-brand'), '#ffffff') >= 4.5);
  assert.ok(contrast(token('--ec-border'), '#ffffff') >= 3);
});

test('all application input, textarea, select and button elements use shared primitives', () => {
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      return entry.isDirectory() ? walk(url) : entry.name.endsWith('.tsx') ? [url] : [];
    });
  }
  for (const file of walk(new URL('../app/', import.meta.url))) {
    if (file.pathname.includes('/components/ui/')) continue;
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /<(?:input|textarea|select|button)\b/, file.pathname);
  }
});

test('worker home and profile screens do not invent scores or replace failed reads with zero', () => {
  const dashboard = readFileSync(new URL('../app/worker/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /profile\?\.score\s*\|\|\s*5/);
  assert.doesNotMatch(dashboard, /average_rating\s*\?\?\s*0|current_score\s*\?\?.*0/);
  assert.match(dashboard, /stats\.average_rating > 0/);
  assert.match(dashboard, /statsError && <Toast/);
  assert.match(dashboard, /earningsError && <Toast/);

  for (const path of ['../app/components/profile-overview.tsx', '../app/profile/page.tsx']) {
    const profile = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(profile, /Number\(profile\.score \?\? 0\)/);
    assert.doesNotMatch(profile, /profile\.score\.toFixed/);
    assert.match(profile, /OperationalReputationView/);
  }
});
