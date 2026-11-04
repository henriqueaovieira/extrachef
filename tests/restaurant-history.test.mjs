import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Mais lists Histórico Operacional after profile without retired navigation items', () => {
  const more = read('../app/components/more-navigation.tsx');
  const order = ['Meu Perfil', 'Histórico Operacional', 'Notificações', 'Privacidade e Preferências']
    .map((label) => more.indexOf(`label: '${label}'`));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(more.includes("href: '/restaurant/history'"));
  assert.ok(more.includes('Operações concluídas e avaliações'));
  assert.doesNotMatch(more, /Agenda|Meus locais|\/restaurant\/events/);
  assert.match(read('../app/restaurant/more/page.tsx'), /MoreNavigation role="restaurant"/);

  const history = read('../app/restaurant/history/page.tsx');
  assert.ok(history.includes('Ainda não houve nenhuma operação concluída.'));
  assert.ok(history.includes('As operações finalizadas aparecerão aqui.'));
  assert.ok(history.includes('EmptyState'));
});

test('worker profile reuses account navigation and legacy routes only redirect', () => {
  const more = read('../app/components/more-navigation.tsx');
  const workerSection = more.split("worker: [")[1].split('],')[0];
  for (const label of ['Meu Perfil', 'Histórico Operacional', 'Confiança', 'Notificações', 'Privacidade e Preferências']) {
    assert.ok(workerSection.includes(`label: '${label}'`), label);
  }
  assert.ok(workerSection.includes("href: '/worker/profile'"));
  assert.ok(workerSection.includes("href: '/worker/dashboard#historico'"));
  assert.ok(workerSection.includes("href: '/worker/profile#confidence'"));
  assert.ok(workerSection.includes("href: '/worker/profile#verification'"));
  assert.match(more, /className="flex min-h-20 items-center justify-between gap-4 py-4"/);
  assert.match(more, /aria-hidden="true" className="text-gray-400">→/);
  assert.match(read('../app/worker/profile/page.tsx'), /<WorkerProfileExperience \/>/);
  assert.match(read('../app/worker/profile/details/page.tsx'), /<WorkerProfileRedirect \/>/);
  assert.match(read('../app/worker/profile/edit/page.tsx'), /<WorkerProfileRedirect edit \/>/);
  assert.match(read('../app/components/profile-overview.tsx'), /<MoreNavigationLinks role="worker" \/>/);
  assert.match(read('../app/components/profile-overview.tsx'), /<ProfileProgress progress=\{progress\} \/>/);
  assert.match(read('../app/components/profile-overview.tsx'), /Completar perfil/);
  assert.match(read('../app/components/profile-overview.tsx'), /id="confidence"/);
  assert.match(read('../app/components/dashboard-identity.tsx'), /role === 'worker' \? '\/worker\/profile'/);
  assert.match(read('../app/components/profile-editor.tsx'), /role === 'worker' \? '\/worker\/profile'/);
});

test('every page reached from Mais retains a labeled return link to the correct destination', () => {
  for (const file of [
    '../app/components/profile-overview.tsx',
    '../app/restaurant/history/page.tsx',
    '../app/components/notification-center.tsx',
    '../app/components/settings-components.tsx',
  ]) {
    const source = read(file);
    const backLink = source.match(/<Link\b[^>]*href="\/restaurant\/more"[^>]*>([\s\S]*?)<\/Link>/);
    assert.ok(backLink, `${file}: return link must target /restaurant/more`);
    assert.ok(backLink[1].replace(/<[^>]*>/g, '').trim(), `${file}: return link must have a label`);
  }
});