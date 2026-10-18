import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Mais lists Histórico Operacional right after Agenda with an empty-state route', () => {
  const more = read('../app/restaurant/more/page.tsx');
  const order = ['Meu perfil', 'Agenda', 'Histórico Operacional', 'Meus locais', 'Notificações', 'Privacidade e preferências']
    .map((label) => more.indexOf(`label: '${label}'`));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(more.includes("href: '/restaurant/history'"));
  assert.ok(more.includes('Operações concluídas e avaliações'));

  const history = read('../app/restaurant/history/page.tsx');
  assert.ok(history.includes('Ainda não houve nenhuma operação concluída.'));
  assert.ok(history.includes('As operações finalizadas aparecerão aqui.'));
  assert.ok(history.includes('EmptyState'));
});
test('every page reached from Mais offers a visible ← Mais back link for restaurants', () => {
  for (const file of [
    '../app/components/profile-overview.tsx',
    '../app/components/restaurant-events.tsx',
    '../app/restaurant/history/page.tsx',
    '../app/components/restaurant-locations.tsx',
    '../app/components/notification-center.tsx',
    '../app/components/privacy-settings.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /href="\/restaurant\/more"[^>]*>← Mais<\/Link>/, file);
  }
});