# ExtraChef: Auditoria QA da comunicação

## Compatibilidade de navegacao apos consolidacao

A entrada oficial da caixa restaurante e `/restaurant/messages`, inclusive no
atalho Mensagens da Central. Candidates com `?view=messages` ou `#chats` agora
encaminha no cliente com `replace`, preservando demais parametros; o hash
legado e consumido. Candidates normal e `?demand=` permanecem em Talentos.
Nao ha segunda montagem da caixa em candidatos. Avisos/SQL antigos continuam
intactos; a compatibilidade nao altera Push, leitura, contadores ou contratacao.

Regressao: `node --test tests/message-navigation.test.mjs tests/restaurant-message-ui.test.mjs tests/communication.test.mjs`.
Mapa atual: [routes.md](./routes.md). O restante deste arquivo conserva a
auditoria historica e nao comprova o estado atual do ambiente remoto.

Data da auditoria local: 15/10/2026

## Resultado executivo

- A separação de Chat/Central remove o sino flutuante global. A navegação mantém acessos estáticos, com badges somente para contagens positivas confirmadas.
- Causas confirmadas no código anterior: `NotificationExperience` renderizava o sino por autenticação, contava todas as categorias; `MobileBottomNav` contava notificações de mensagem; a Central contava apenas os registros carregados (até 100). Abrir o chat não persistia leitura e não encerrava o popup.
- `NotificationBell` não estava montado; foi reutilizado como link para a Central, sem outra listagem/dropdown. `PushNotificationControl` não era origem de badges ou popups e foi preservado.
- O estado compartilhado usa contagens exatas: `messages.sender_id <> auth.uid()` com `read_at IS NULL`, sob RLS, e `notifications` próprias, não lidas, excluindo `category = message`. Uma falha torna os indicadores desconhecidos; não preserva números antigos nem apresenta zero fictício.
- Validação no navegador conectado ao Supabase confirmou pendências de schema: `notification_preferences` ausente no schema cache (`PGRST205`) e coluna `notifications.url` ausente (`42703`). Portanto a configuração remota não está pronta; não houve aplicação automática de SQL nesta entrega.
- O código contém o caminho de trigger de mensagem para `notifications`, subscriptions autenticadas, dispatcher VAPID, Service Worker, recebimento/recibo HMAC, Realtime e central de notificações.
- Foi encontrada e corrigida divergência de nome da chave VAPID pública do lado do servidor: o cliente usa `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`; o servidor agora aceita também esse nome, além de `WEB_PUSH_VAPID_PUBLIC_KEY`.
- No workspace local, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, as chaves VAPID e `PUSH_WEBHOOK_SECRET` não estão configuradas. Não imprimir nem compartilhar seus valores; configurar na Vercel.
- O webhook de Database do Supabase é uma configuração de painel e não é verificável pelo código local.
- Android/iPhone físicos e delivery pelo serviço Push externo não foram testados nesta auditoria.
- Não considerar o fluxo 100% validado até completar as seções Android/iOS e comprovar `push_deliveries.status = 'received'`.

## Fluxo esperado

```text
messages INSERT
  -> trigger public.messages_notify_recipient
  -> notifications INSERT (category = message, message_id, url = /chat/<job_id>)
  -> Realtime: badge Chat a partir de messages; prévia autenticada com foto/nome/texto
  -> Supabase Database Webhook (INSERT public.notifications)
  -> POST /api/push/dispatch com header secreto
  -> lookup de preferências e subscriptions do usuário
  -> provedor Web Push (VAPID)
  -> push_deliveries.status = sent
  -> Service Worker recebe push
  -> se app visível: postMessage; mesma mensagem é deduplicada por ID com Realtime
  -> mensagem nova fora do chat ativo: toast + popup; aviso operacional: somente Central
  -> sem janela visível: showNotification (inclui categoria operacional)
  -> POST /api/push/receipt com HMAC
  -> push_deliveries.status = received
  -> abrir chat visível / responder / marcar mensagem como lida
  -> RPC mark_chat_messages_read: messages.read_at e notifications.read vinculadas
  -> badge Chat atualiza, popup/toast encerram
```

`sent` quer dizer que o serviço Push aceitou a requisição; não garante entrega ao dispositivo. `received` quer dizer que o Service Worker processou o evento e enviou recibo; não prova leitura humana. Mensagens usam `messages.read_at`. Avisos operacionais usam `notifications.read` e são gerenciados exclusivamente em `/notifications`. Avisos `message` continuam no banco para o webhook Push, mas não entram na Central nem no seu badge.

## Migration e compatibilidade

### Nova candidatura recebida pelo restaurante

A auditoria do repositório encontrou `applications_notify_approved` (UPDATE de status), mas nenhum trigger para notificar a chegada de uma candidatura. Não havia criação desse aviso no fluxo do profissional. A correção é a migration aditiva `20261015040000_notify_application_received.sql`, aplicada após as migrations anteriores de comunicação.

O novo trigger `applications_notify_received` executa AFTER INSERT somente para status `pending`. Busca o restaurante dono da vaga e os nomes no banco; grava uma notificação `application`, não lida pelo default existente, com título “Nova candidatura recebida”, texto “<profissional> se candidatou para <vaga>” e URL `/restaurant/candidates`. Não faz backfill nem altera status, aprovação, mensagens, grants das tabelas ou policies. Reaplicar a migration substitui o mesmo trigger, sem duplicá-lo ou gerar avisos históricos.

O INSERT da notificação participa da mesma transação da candidatura: uma falha não é ignorada e impede uma candidatura confirmada sem o aviso correspondente. Essa dependência deve ser exercitada em homologação. A função de trigger não é exposta para execução direta por `anon` ou `authenticated`.

Badge, contexto, Realtime e dispatcher já suportam `application` e foram reutilizados sem alterações. Na Central, apenas o texto da ação desse destino passa a “Ver candidatura”; aprovação continua abrindo seu destino anterior com “Abrir”. Push continua condicionado a `applications_enabled`, subscription, VAPID e webhook existente de INSERT em `notifications`; não criar outro webhook em `applications` para enviar o mesmo aviso.

#### Aplicação e validação

1. Backup e homologação; confirmar as tabelas `users`, `jobs`, `applications` e `notifications` e as colunas `notifications.url/category/read`.
2. Aplicar somente a nova migration integralmente, após as anteriores. Ela já inclui `BEGIN/COMMIT`.
3. Conferir ambos os triggers sem substituir o de aprovação:

```sql
SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t
WHERE t.tgrelid = 'public.applications'::regclass
  AND NOT t.tgisinternal
  AND t.tgname IN (
    'applications_notify_received', 'applications_notify_approved'
  )
ORDER BY t.tgname;

SELECT pg_get_functiondef(
  'public.notify_application_received()'::regprocedure
);
```

4. Com contas de homologação, candidatar profissional a vaga aberta. Confirmar uma candidatura e exatamente um aviso para o restaurante dono, nenhum aviso de recebimento para o profissional ou outro restaurante:

```sql
SELECT id, user_id, title, message, category, url, read, created_at
FROM public.notifications
WHERE title = 'Nova candidatura recebida'
ORDER BY created_at DESC
LIMIT 20;
```

5. Com restaurante já no dashboard/Central, confirmar incremento do badge de avisos e atualização em Realtime, sem incremento do Chat ou popup de mensagem.
6. Clicar “Ver candidatura”: abre `/restaurant/candidates`, marca o aviso como lido, preserva candidatura pendente até aprovação explícita.
7. Aprovar: confirmar o aviso “Candidatura aprovada” ao profissional e preenchimento da vaga pelo fluxo anterior, sem outro aviso “Nova candidatura recebida”.
8. Tentar candidatura duplicada ou vaga fechada: se rejeitada pelo fluxo existente, não deixar notificação órfã. Alterar status não deve executar o novo trigger.
9. Validar Push background com preferências ativadas e dispositivo registrado; conferir `push_deliveries`. Preferência desativada suprime Push, não a criação do aviso na Central.

Se houver necessidade de desativar apenas este recurso, remover `applications_notify_received` em uma migration corretiva revisada; preservar notificações já geradas e o trigger de aprovação. Não reexecutar migrations históricas como rollback.

Validação local: testes de contrato do SQL, evento `application` no provider real com banco simulado e envio pelo dispatcher com provedor simulado. Não equivalem à execução PostgreSQL nem ao Push físico. A nova migration não foi aplicada remotamente nesta entrega.

Aplicar as migrations pendentes em ordem de timestamp, antes de publicar o cliente atualizado. Não recriar tabelas ou substituir o pipeline de Push.

1. Conferir as migrations base de chat, candidaturas e notificações.
2. Aplicar `20261014060000_notification_deep_links.sql` se pendente: adiciona `notifications.url`.
3. Aplicar `20261015000000_notification_delivery_and_preferences.sql` se pendente: categorias, preferências, recibos e políticas.
4. Preservar as migrations existentes de Eventos e autenticação na sequência.
5. Aplicar `20261015030000_chat_read_state.sql`: `messages.read_at`, vínculo opcional `notifications.message_id`, índice de não lidas, RPCs de leitura/prévia e acesso restrito à foto do interlocutor.
6. Confirmar publicação Realtime para INSERT/UPDATE de `messages` e `notifications`, recarregamento do schema cache e só então publicar.

A nova migration não cria tabelas. O trigger existente continua criando uma notificação por mensagem; notificações antigas não recebem vínculos inventados. **Decisão confirmada com o responsável:** mensagens antigas permanecem sem recibo (`read_at = NULL`) até abrir a conversa; o badge pode mostrar esse histórico real pendente. Não se presume que mensagens antigas foram lidas.

A RPC de leitura exige autenticação e participação autorizada, limita cada lote a 1000 IDs, atualiza apenas mensagens recebidas da conversa indicada e suas notificações vinculadas. O cliente envia IDs efetivamente carregados, não um UPDATE irrestrito de toda a conversa; novas mensagens concorrentes não são reconhecidas por engano. INSERT força `read_at = NULL` para impedir que o remetente fabrique leitura.

Para foto privada, a policy libera apenas o caminho cadastrado como foto do trabalhador de uma candidatura autorizada ao restaurante. Exige pasta do próprio trabalhador e prefixo `profile-photo-`; não libera currículo, selfie, certificado ou o bucket inteiro. Sem foto, usa inicial. Erro ao obter foto é informado.

O popup não é reconstruído ao entrar no app: só nasce de mensagem nova, recebida, não lida e com app visível fora da conversa correspondente. Fecha ao abrir a conversa, confirmar leitura, responder ou fechar manualmente. Fechar manualmente **não** altera leitura. Ao voltar do background/reconectar, os contadores são reconciliados; mensagens antigas não geram novos popups.

## Arquivos da separação

- Estado e contagens: `lib/communication.ts`, `app/components/communication-state.tsx`, `app/components/notification-experience.tsx`, `app/layout.tsx`.
- Navegação: `notification-bell.tsx`, `mobile-bottom-nav.tsx` em `app/components`, headers dos dashboards, candidaturas e chat. O componente sem consumidores `communication-navigation.tsx` foi removido na [sprint de consolidação](./consolidation-report.md).
- Central: `app/components/notification-center.tsx` (filtros sem mensagens, mutações restritas, contador global, carregar mais, falhas explícitas).
- Leitura: `app/chat/[jobId]/chat-client.tsx`.
- Push: `app/api/push/dispatch/route.ts` (confirma registro atual, não envia aviso lido/excluído), `public/sw.js` (app visível vs. background e tag por notificação).
- Banco: `supabase/migrations/20261015030000_chat_read_state.sql`.
- Testes: `tests/communication.test.mjs`.

### Validação automatizada local

#### Correção específica do badge Chat

A contagem do Chat já consultava `messages` recebidas com `read_at IS NULL`, mas seu carregamento estava bloqueado até `SUBSCRIBED` e compartilhava sucesso/falha com a consulta de notificações. Uma falha em `notifications` descartava também uma contagem válida de mensagens.

O provider agora consulta o Chat independentemente da conexão inicial Realtime e das falhas de notificações. A consulta de mensagens usa GET, contagem exata e `limit(1)`: retorna no máximo um ID, mas usa o total do banco, nunca o tamanho da lista. A consulta de notificações conserva seus filtros e sua condição de conexão; Central, Push, SQL e regras de leitura não foram alterados nesta correção.

Testes de regressão cobrem carregamento antes de `SUBSCRIBED`, reconciliação na conexão, falha de notificações com Chat válido, INSERT/UPDATE de mensagens, total acima de um registro e renderização de badges positivos/zero. No navegador conectado, a consulta real retornou HTTP 200 e total zero; não foram criadas mensagens reais para fabricar um indicador positivo.

`node --test tests/communication.test.mjs` executa o provider real com limites Supabase/browser simulados, não um banco remoto: fontes independentes e contagem acima de 100, zero/desconhecido, falhas, lotes de leitura, deduplicação Push/Realtime, abertura de chat, leitura em outra aba, resposta rápida, logout, respostas assíncronas fora de ordem e Service Worker aberto/minimizado/fechado.

As verificações SQL automatizadas são de contrato/texto, não execução PostgreSQL. A migration e as políticas precisam ser exercitadas num projeto de homologação, com duas contas e dados de teste; Android/iPhone físicos e webhook real permanecem obrigatórios.

Resultado local desta entrega: 51 testes passaram (com regressões de autenticação/UI e HTTP), lint sem erros/avisos e build de produção com TypeScript passaram. A Central foi inspecionada em 360, 390, 430 e 1280 px: sem overflow horizontal, sem sino flutuante ou popup inicial e sem estado “Tudo em dia” diante de falha de consulta. A validação funcional remota continua bloqueada pelas pendências de schema descritas acima; não foram enviadas mensagens nem alterados registros reais para testar.

## Pré-requisitos de release

- [ ] Aplicar migrations até `20261015030000_chat_read_state.sql`, após as migrations anteriores.
- [ ] Executar `20261014015000` e `20261014025000` em execuções SQL separadas, se ainda não aplicadas.
- [ ] Confirmar `messages` e `notifications` na publicação `supabase_realtime`.
- [ ] Confirmar os triggers `messages_notify_recipient` e `notifications` no schema `public`.
- [ ] Configurar na Vercel para Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`, `PUSH_WEBHOOK_SECRET`.
- [ ] As duas chaves VAPID públicas devem ter o mesmo valor. Não publicar service role, VAPID privada ou webhook secret no cliente.
- [ ] Fazer redeploy após adicionar ou alterar variáveis.
- [ ] Configurar Database Webhook: tabela `public.notifications`, evento `INSERT`, método POST, URL `https://<dominio>/api/push/dispatch`, header `x-extra-chef-webhook-secret: <PUSH_WEBHOOK_SECRET>`, `Content-Type: application/json`.
- [ ] Na conta de teste, abrir Perfil e ativar Push em cada dispositivo/navegador. A permissão do browser deve estar concedida.
- [ ] Salvar consentimento e preferências adequados antes de usar com pessoas externas.

## SQL de diagnóstico

### Mensagens recentes

```sql
SELECT id, job_id, sender_id, created_at, read_at
FROM public.messages
ORDER BY created_at DESC
LIMIT 20;
```

### Notificações e leitura

```sql
SELECT id, user_id, category, title, read, url, message_id, created_at
FROM public.notifications
ORDER BY created_at DESC
LIMIT 50;
```

### Subscriptions sem expor endpoint ou chaves de criptografia

```sql
SELECT id, user_id, created_at, updated_at
FROM public.push_subscriptions
ORDER BY updated_at DESC
LIMIT 50;
```

### Estado de entrega e recibo

```sql
SELECT notification_id, subscription_id, status, status_code, updated_at
FROM public.push_deliveries
ORDER BY updated_at DESC
LIMIT 100;
```

### Triggers

```sql
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('messages', 'applications', 'checkins', 'checkouts', 'reviews')
ORDER BY event_object_table, trigger_name;
```

### Publicação Realtime

```sql
SELECT schemaname, tablename
FROM pg_catalog.pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('messages', 'notifications')
ORDER BY tablename;
```

Não selecionar `endpoint`, `p256dh` ou `auth_secret` no suporte/relatórios; são identificadores/segredos de subscrição.

## Testes funcionais manuais

### A. Criação de notificação

- [ ] Com duas contas autorizadas numa candidatura aprovada, enviar mensagem A → B.
- [ ] Verificar que a mensagem foi persistida uma vez.
- [ ] Verificar que uma notificação `category = message` foi criada para B, não para A.
- [ ] Verificar URL `/chat/<job_id>` e texto sem conteúdo sensível da mensagem no Push persistente.
- [ ] Repetir B → A.
- [ ] Confirmar que chat, aprovação, check-in, checkout e avaliação geram a notificação esperada.

### B. Central e badges independentes

- [ ] Abrir `/notifications`; confirmar ordenação recente, filtros Todas/Não lidas/Candidaturas/Operacionais/Avaliações/Eventos, sem mensagens.
- [ ] Marcar uma notificação e todas como lidas; verificar `read = true` e badge atualizado em outra aba sem refresh.
- [ ] Marcar todas/excluir avisos operacionais não altera `messages.read_at` nem o badge Chat.
- [ ] Ter mais de 100 avisos não lidos; filtro/limite da lista não altera a contagem exata; “Carregar mais” recupera o restante.
- [ ] Com zero mensagens e zero avisos, nenhum contador aparece; não existe sino flutuante. A navegação estática continua disponível.
- [ ] Interromper rede/Realtime: não manter número antigo nem apresentar zero fictício; reconectar e confirmar contagem reconciliada.
- [ ] Excluir uma notificação; verificar que só o dono consegue excluir.
- [ ] Criar notificação enquanto a central está aberta e verificar atualização em Realtime.
- [ ] Alterar cada preferência em `/settings/privacy`, salvar e verificar que Push/tosts da categoria desabilitada não aparecem.

### C. App em foreground e resposta rápida

- [ ] Com conta B e app visível, enviar mensagem da conta A.
- [ ] Confirmar badge, toast, popup com remetente/última mensagem e link para o chat.
- [ ] Confirmar foto do interlocutor autorizado ou inicial quando não houver foto. Outra conta não pode obter sua foto privada, currículo ou documentos pela nova policy.
- [ ] Receber a mesma mensagem por Realtime e Push: apenas uma apresentação.
- [ ] Receber com chat correspondente já aberto: mensagem na conversa, leitura persistida, sem popup/toast.
- [ ] Abrir conversa a partir do popup: popup some, leitura é persistida somente para IDs carregados e visíveis.
- [ ] Marcar como lida em outra aba: popup some e badge atualiza sem refresh.
- [ ] Fechar popup manualmente: some, mas mensagem continua não lida no banco.
- [ ] Responder no popup; verificar insert em `messages` com `sender_id = B`, atualização do chat via Realtime e notificação para A.
- [ ] Responder com sucesso: popup some e mensagem original recebe `read_at`; falha de envio mantém popup e não confirma leitura.
- [ ] Falhar somente a gravação de leitura após envio: informar falha, preservar mensagem enviada uma vez, não incentivar reenvio duplicado.
- [ ] Enquanto uma leitura está em andamento, inserir outra mensagem; o lote anterior não pode reconhecê-la como lida.
- [ ] Validar conta sem participação, INSERT com `read_at` forjado e tentativa direta de UPDATE: nenhum recibo não autorizado.
- [ ] Testar fechar o popup, abrir conversa, envio vazio, falha de rede e mensagem acima de 4000 caracteres.
- [ ] Confirmar ausência de duplicidade entre o toast do Realtime e o evento Push encaminhado pelo Service Worker.

### D. Push e recibo

- [ ] No Perfil, obter diagnóstico `/api/push/status` autenticado; confirmar `configured = true` e dispositivos > 0.
- [ ] Confirmar no navegador `Notification.permission === 'granted'`, service worker ativo e Push subscription presente.
- [ ] Com app em background/fechado, criar uma mensagem; confirmar uma chamada bem-sucedida no histórico de Database Webhooks.
- [ ] Confirmar `push_deliveries.status = sent`, depois `received`.
- [ ] Tocar no Push; confirmar `/chat/<job_id>` (com login/redirect se necessário). Leitura ocorre ao carregar o chat visível, nunca só pelo recibo do Service Worker.
- [ ] Revogar permissão ou invalidar subscription de teste; enviar novamente e confirmar remoção para status 404/410.
- [ ] Desabilitar uma categoria e confirmar que dispatcher retorna `suppressed = true`.
- [ ] Testar configuração ausente, segredo incorreto, VAPID inválida e provedor indisponível; nenhuma falha deve aparentar sucesso silencioso.

### E. Android

- [ ] Chrome Android atualizado; instalar PWA pela opção do navegador.
- [ ] Abrir PWA instalada, ativar permissão Push e confirmar uma subscription.
- [ ] Testar app visível (toast), app minimizado e app fechado (notificação do sistema).
- [ ] Tocar Push com app encerrado e confirmar deep link.
- [ ] Repetir em rede móvel/Wi-Fi e após reiniciar o aparelho.

### F. iPhone/iPad

- [ ] Usar iOS/iPadOS 16.4 ou posterior; abrir o site no Safari e usar “Adicionar à Tela de Início”.
- [ ] Abrir o ícone instalado (Push Web no iOS exige web app adicionada à tela inicial).
- [ ] Ativar permissão a partir de ação explícita do usuário dentro do app instalado.
- [ ] Confirmar subscription, `sent`, `received`, banner do sistema e deep link.
- [ ] Testar app em foreground, background e encerrado; validar Ajustes iOS > Notificações para o ExtraChef.

## Matriz de diagnóstico por camada

| Evidência | Interpretação | Próxima verificação |
|---|---|---|
| Mensagem não existe | Falha antes de notificações | RLS/insert do chat e logs Realtime |
| Mensagem existe, notificação não | Trigger ausente/falhou ou candidatura/status não corresponde | Triggers SQL, status e logs PostgreSQL |
| Notificação existe, sem webhook | Configuração/entrega do Database Webhook | Histórico de Webhooks Supabase |
| Webhook recebe 401 | Header/secret diferente ou segredo ausente | Igualar secret Supabase e Vercel |
| Webhook recebe 503 | Variável/configuração server-side ausente ou VAPID inválida | `/api/push/status`, deployment env e logs Vercel |
| Webhook recebe 400 | Payload não corresponde ao evento esperado | Confirmar INSERT e payload padrão do Database Webhook |
| Webhook recebe 5xx; nenhum delivery | Consulta de preferências/subscriptions ou acesso SQL falhou | Logs Vercel, migrations e grants |
| `sent = 0`, subscriptions = 0 | Destinatário não tem dispositivo registrado | Perfil > ativar Push; conferir usuário no banco |
| delivery `failed` | Provedor rejeitou; `status_code` ajuda a identificar causa | Chaves VAPID, expiração e logs Vercel |
| delivery `expired` | Provedor respondeu 404/410 | Subscription removida; reinscrever dispositivo |
| delivery `sent`, sem `received` | Provedor aceitou, mas SW não confirmou | Browser, permissão, escopo/versão SW, rede e estado do app |
| delivery `received`, sem alerta visual | SW executou, apresentação pode estar suprimida pelo estado visível/sistema | Se app visível, validar toast/popup de mensagem fora do chat; avisos operacionais ficam na Central; caso contrário, verificar SO |
| delivery `received`, mas central não atualiza | Separar Push de Realtime/leitura | Publication, RLS, subscription Realtime e `notifications.read` |

## Critério de aceite antes da Agenda Operacional

- [ ] Todos os gates locais passam: `npm run lint`, `npm run typecheck`, `npm run build`.
- [ ] Cada evento crítico percorre mensagem/notificação → webhook → `sent` → `received` → link/leitura em dispositivos reais.
- [ ] Foreground tem exatamente uma experiência in-app; background/fechado tem Push.
- [ ] Realtime de `messages` e `notifications` funciona em duas contas separadas e após reconnect.
- [ ] Android instalado e iOS/iPadOS instalado passam o teste; evidências incluem horário, ID da notificação (não o conteúdo pessoal) e estado delivery.
- [ ] Nenhum segredo ou endpoint de subscription aparece em logs, consultas compartilhadas ou screenshots.
- [ ] Preferências, exclusão de notificações e RLS foram testadas com usuário próprio e não relacionado.
