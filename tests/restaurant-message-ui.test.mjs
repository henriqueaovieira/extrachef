import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('restaurant messages stay operational, linked to approved jobs, and use the official navigation', () => {
  const inbox = read('../app/restaurant/messages/message-center.tsx');
  const inboxData = read('../lib/restaurant-message-inbox.ts');
  const chat = read('../app/chat/[jobId]/chat-client.tsx');
  const navigation = read('../app/components/mobile-bottom-nav.tsx');

  for (const text of [
    'Acompanhe suas operações e converse com profissionais já contratados.',
    'Buscar profissionais ou operações...',
    'worker_name',
    'demand_title',
    'job_date',
    'latest_message',
    'operational_status',
    'unread_count',
  ]) assert.ok(inbox.includes(text), text);
  assert.ok(inboxData.includes('restaurant_operational_message_inbox'));
  assert.ok(inbox.includes('Nenhuma conversa disponível.'));
  assert.ok(inbox.includes('As mensagens serão criadas automaticamente após uma contratação.'));
  assert.ok(inbox.includes('Ver Operações'));
  assert.ok(inbox.includes('<Card as="article"'));
  assert.doesNotMatch(inbox, /Filtrar conversas|filterConversation|aria-pressed/);
  assert.doesNotMatch(inbox, /Nova mensagem|nova conversa/i);
  assert.doesNotMatch(inbox, /\.from\(['"]messages['"]\)\s*\.insert/);

  for (const text of [
    'get_approved_chat_context',
    'operational_context',
    'Ver Perfil',
    'Ver Operação',
    'Ver Operação',
    'Profissional contratado.',
    'Check-in realizado. Operação iniciada.',
    'Pagamento informado.',
    'Pagamento confirmado.',
    'Checkout concluído.',
    'Operação encerrada.',
  ]) assert.ok(chat.includes(text), text);
  assert.match(inbox, /href=\{`\/chat\/\$\{conversation\.job_id\}`\}/);
  for (const label of ['Home', 'Operações', 'Talentos', 'Mensagens', 'Equipe', 'Mais']) assert.ok(navigation.includes(`label: '${label}'`), label);
  const restaurantOrder = ['Home', 'Operações', 'Talentos', 'Equipe', 'Mensagens', 'Mais'].map((label) => navigation.indexOf(`label: '${label}'`));
  assert.deepEqual(restaurantOrder, [...restaurantOrder].sort((a, b) => a - b));
  assert.ok(navigation.includes("href: '/restaurant/messages'"));
  assert.doesNotMatch(navigation, /sidebar|menu lateral/i);
});
