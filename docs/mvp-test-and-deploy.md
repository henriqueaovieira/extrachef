# ExtraChef MVP: testes e deploy

## Comunicação e privacidade

Antes deste release, seguir `docs/push-privacy-runbook.md` e aplicar as migrations pendentes até `20261015090000_privacy_account_rights.sql` em homologação. Confirmar os registros próprios em `push_deliveries`, teste em aparelhos reais e revisão jurídica dos documentos-base de `/privacy` e `/terms`. A nova migration torna `restaurant-assets` privado e deve ser publicada junto com o cliente atualizado.

## Checklist de testes

Para a fundacao de autenticacao, ordem de implantacao e testes de redirects/sessoes, consulte
[Fundacao de autenticacao](./foundation-auth.md).
Para padroes visuais, componentes e checklist mobile/acessibilidade, consulte
[Design System e auditoria UX](./design-system.md).

### Restaurante

- [ ] Criar uma vaga com dados válidos; confirmar status `open`.
- [ ] Ver candidaturas da vaga e confirmar que os registros correspondem à diária.
- [ ] Aprovar uma candidatura; confirmar status `approved` e vaga `filled`.
- [ ] Tentar aprovar outra candidatura na mesma vaga; confirmar que a operação é recusada.
- [ ] Abrir o chat e enviar uma mensagem; confirmar recebimento em tempo real na sessão do trabalhador.
- [ ] Receber notificações de aprovação, mensagem, check-in, check-out e avaliação.
- [ ] Após o checkout, avaliar o trabalhador; confirmar que a nota aparece e que não é possível duplicá-la.
- [ ] Conferir total de vagas, estados, profissionais contratados e média das avaliações no dashboard.
- [ ] Aplicar a migration de [localização automática](./agenda-retirement-report.md) antes de publicar o frontend sem Agenda.
- [ ] Confirmar ausência de Agenda no menu e HTTP 404 na antiga rota `/restaurant/events`.
- [ ] Publicar demandas de 1, 2, 20 e 50 profissionais sem evento ou cadastro manual de local.
- [ ] Confirmar snapshot do endereço principal do restaurante, `event_id` nulo e origem interna `catalog`.
- [ ] Perfil sem endereço válido: erro explícito, sem publicar demanda sem localização.
- [ ] Alterar o endereço no perfil e publicar novamente; preservar snapshots de demandas e eventos antigos.
- [ ] Confirmar que URLs antigas com `?event=` não selecionam evento nem preenchem data.
- [ ] Preservar o [contrato histórico de eventos](./event-location-snapshots.md) e os caminhos legados das RPCs.

### Trabalhador

- [ ] Candidatar-se a uma vaga aberta; confirmar status `pending`.
- [ ] Confirmar que vaga preenchida não aparece como aberta e que candidatura direta é recusada.
- [ ] Receber a aprovação e trocar mensagens no chat em duas sessões.
- [ ] Abrir check-in antes da aprovação; confirmar acesso negado.
- [ ] Fazer check-in; confirmar registro único, status `in_progress` e notificação ao restaurante.
- [ ] Tentar repetir check-in; confirmar que não cria novo registro.
- [ ] Fazer check-out; confirmar status `completed` em candidatura e vaga, com notificação ao restaurante.
- [ ] Tentar repetir check-out; confirmar que não cria novo registro.
- [ ] Avaliar o restaurante; confirmar atualização do score e bloqueio de duplicidade.
- [ ] Conferir candidaturas, diárias concluídas, média, score e histórico no dashboard.
- [ ] Completar/editar perfil com CPF, RG, foto, selfie, certificados e currículo; confirmar validação e upload privado.
- [ ] Recusar GPS e confirmar que somente a emissão do código de check-in é bloqueada, sem impedir busca, candidatura, pagamento ou check-out.
- [ ] Testar emissão dentro do raio, exatamente a 100 m e acima de 100 m do snapshot `jobs.work_latitude/work_longitude`; confirmar cálculo e bloqueio no backend.
- [ ] Confirmar captura pontual apenas ao solicitar o código de check-in, sem rastreamento, polling GPS ou monitoramento em segundo plano.
- [ ] Confirmar que GPS indisponível, timeout ou coordenadas ausentes da operação impedem emissão com erro explícito; a empresa continua confirmando chegada pelo código, sem solicitar GPS.
- [ ] Compartilhar uma vaga pelo menu nativo; testar também o fallback de cópia.
- [ ] Ativar Push no Perfil e confirmar recebimento/clique após aprovação, mensagem e avaliação.

### Perfil do restaurante

- [ ] Completar/editar perfil com CNPJ, endereço, logo e fotos; confirmar rejeição de CNPJ inválido.
- [ ] Capturar foto pela câmera traseira e testar substituição dos arquivos.
- [ ] Validar a [remoção de Meus Locais](./work-locations.md): sem página ou atalhos; manter o catálogo interno e o local principal automático na publicação.
- [ ] Não aplicar a proposta operacional suspensa nem reaplicar migrations históricas.

### GPS exclusivo do check-in

Para novas operacoes, o GPS depende de snapshot geocodificado valido.
Seguir o [rollout Photon/cache/prontidao](./geolocation-monitoring.md) e o
[plano de recuperacao dos legados](./geolocation-recovery-plan.md).
Nao aplicar migrations automaticamente nem preencher coordenadas em massa.

Para restaurar GPS **apos a implantacao do recrutamento**, usar somente a nova
[migration corretiva](../supabase/migrations/20261104190000_restore_operational_checkin_gps.sql),
nao reaplicar as migrations historicas de GPS: elas selecionam assignment apenas
por job e nao preservam o historico de substituicoes instalado pelo recrutamento.
A corretiva preserva `participant_assignment`, locks, autorizacao, notificacoes,
tokens e checkout do recrutamento; apenas restaura a validacao GPS da emissao.
Nao altera frontend, recrutamento, substituicao, pagamento nem tabelas/dados.

A aplicacao e **manual e ainda nao foi realizada**. Antes dela, conferir
`jobs.work_latitude/work_longitude` (`double precision`) e as dependencias do
preflight. A ausencia de coordenadas no snapshot de uma operacao continua sendo
erro explicito; nao ha preenchimento ou geocodificacao automatica.
A assinatura fisica passa a ser apenas a de quatro argumentos, com dois defaults
nulos: chamadas legadas de dois argumentos continuam resolvendo sem ambiguidade.
Checkout continua sem exigir GPS; check-in legado sem coordenadas recebe erro
`22023`, nunca um codigo sem validacao de distancia.
O `NOTIFY pgrst` transacional solicita recarga do schema cache apos o commit.
Dependencias inesperadas da assinatura antiga abortam a migration, sem `CASCADE`.

Validacao local, sem conectar ao Supabase:

```sh
node --test tests/recruitment-sql.test.mjs tests/operational-trust-sql.test.mjs
```

O runner executa os [testes SQL](../supabase/tests/operational_checkin_gps.sql)
em PGlite isolado, com fixtures identificadas por configuracoes `test.*` e rollback.
Nao executar esse arquivo em producao. Sao testados os dois estados de origem
(assinatura legada ou GPS), preflight, reaplicacao, preservacao de dados e funcoes,
ACLs, argumentos nomeados, GPS invalido/ausente, snapshots invalidos, 99.999 m,
100 m e 100.001 m, reutilizacao sem bypass e ciclo completo de substituicao,
pagamento e checkout por dois argumentos.
PGlite nao valida o cache HTTP do PostgREST nem concorrencia multi-sessao.
Apos eventual aplicacao autorizada, conferir a assinatura com `pg_proc` e testar
manualmente o RPC pelo cliente autenticado, dentro e fora do raio.

A descricao abaixo registra a implantacao historica anterior ao recrutamento:

A migration [20261019030000_checkin_gps.sql](../supabase/migrations/20261019030000_checkin_gps.sql)
substitui `issue_operational_code(uuid,text)` por
`issue_operational_code(uuid,text,double precision,double precision)`.
Os parâmetros `p_latitude/p_longitude` têm default nulo para preservar chamadas de
check-out com dois argumentos; check-in sem coordenadas é recusado no backend.
Não há overload antigo que permita emitir código de check-in sem GPS.

Aplicar somente após conferir as dependências já implantadas: fluxo de códigos
operacionais e snapshot `jobs.work_latitude/work_longitude`. Publicar o frontend
compatível junto da migration; clientes antigos não poderão emitir check-in sem
enviar coordenadas. A migration não altera tabelas nem registros existentes.
Não foi aplicada automaticamente ao Supabase.

A distância Haversine é comparada sem arredondamento com 100 metros. Coordenadas
legadas `jobs.latitude/longitude`, endereço atual do restaurante e distância
calculada pelo navegador não são usados como autoridade. Operações sem snapshot
válido ficam bloqueadas, sem fallback ou ampliação do raio pela precisão do GPS.

A posição é consultada uma vez por solicitação do profissional e não é persistida
por esta alteração. Códigos já emitidos continuam com a validade original; nova
emissão, renovação ou solicitação de reutilização pela RPC exige GPS no check-in.
A confirmação bilateral, os horários oficiais, pagamento, check-out, notificações
e reputação permanecem com as regras anteriores. GPS do navegador não é prova
contra falsificação e não comprova permanência após a emissão.

### Segurança e interface

- [ ] Abrir chat, check-in, check-out e avaliação sem autenticação; confirmar acesso negado.
- [ ] Tentar acessar uma diária de outro usuário; confirmar bloqueio por RLS/RPC.
- [ ] Testar estados vazios, erros de rede e sessão expirada.
- [ ] Testar layout em viewport móvel e desktop, inclusive tabelas com rolagem horizontal.
- [ ] Testar 360, 390 e 430 px, safe area com notch e teclado mobile aberto.
- [ ] Testar permissão de câmera e GPS recusada, arquivo com MIME incorreto e limite acima de 10 MB.
- [ ] Confirmar que notificações chegam em tempo real e a leitura persiste após recarregar.
- [ ] Executar `npm run lint`, `npm run typecheck` e `npm run build` antes de publicar.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` em desenvolvimento e preencha:

- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave publicável/anon do projeto.
- `NEXT_PUBLIC_APP_URL`: origem pública HTTPS do ExtraChef, sem barra final.
- `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`: chave pública VAPID usada pelo navegador.
- `WEB_PUSH_VAPID_PUBLIC_KEY`: a mesma chave pública, disponível também no servidor para validar a configuração do dispatcher.
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada usada somente nas rotas server-side de push.
- `WEB_PUSH_VAPID_PRIVATE_KEY`: chave privada VAPID, somente no servidor.
- `WEB_PUSH_SUBJECT`: contato VAPID, por exemplo `mailto:suporte@seudominio.com`.
- `PUSH_WEBHOOK_SECRET`: segredo aleatório compartilhado com o Database Webhook.

Não exponha `SUPABASE_SERVICE_ROLE_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` ou `PUSH_WEBHOOK_SECRET` no navegador nem em variáveis `NEXT_PUBLIC_*`. A chave pública VAPID pode ser pública; use a mesma chave nos dois nomes acima.

## Vercel

- [ ] Importar o repositório e manter o preset Next.js detectado.
- [ ] Configurar as variáveis de ambiente necessárias em Development, Preview e Production; após alterá-las, criar novo deployment.
- [ ] Confirmar o comando de build `npm run build`.
- [ ] Fazer deploy de Preview e testar login, dashboards, notificações e o fluxo completo de uma diária.
- [ ] Configurar domínio de produção e HTTPS.
- [ ] Adicionar domínio de produção e URLs de Preview às URLs permitidas de autenticação do Supabase.
- [ ] Confirmar que `.env.local`, `.env.production` e chaves privadas não foram commitadas.

## Supabase

- [ ] Confirmar backup e projeto/ambiente correto antes de executar SQL.
- [ ] Aplicar migrations em ordem cronológica, após o schema-base de `users`, `jobs` e `applications`.
- [ ] Confirmar que o schema-base e suas policies RLS estão versionados/aplicados; as migrations deste MVP não criam `users`, `jobs` e `applications`.
- [ ] Aplicar migrations nesta ordem: `20261014000000`, `20261014010000`, `20261014015000`, `20261014020000`, `20261014025000`, `20261014030000`, `20261014035000`, `20261014040000`, `20261014050000_profiles_and_geo.sql`, `20261014051000_core_rls.sql`, `20261014055000_profile_summary_push.sql`, `20261014059000_worker_estimated_earnings.sql`, `20261014060000_notification_deep_links.sql`, `20261015000000_notification_delivery_and_preferences.sql`.
- [ ] Aplicar `20261015010000_restaurant_events.sql` após o schema-base de `public.users`.
- [ ] Para a Fase 2, após revisão/autorização, aplicar somente `20261015070000_event_location_snapshots.sql`, verificando o contrato real de events e a Fase 1 já aplicada (`20261015060000_work_locations_catalog.sql`). Não reaplicar dependências confirmadas nem todo o histórico. Seguir o [roteiro específico](./event-location-snapshots.md) e publicar o frontend compatível em janela controlada.
- [ ] Aplicar `20261015020000_auth_foundation.sql` antes de publicar o novo fluxo de cadastro; configurar `/auth/callback` nas Redirect URLs do Supabase.
- [ ] Executar as migrations `20261014015000` e `20261014025000` separadamente das migrations que usam os novos valores de enum; aguardar commit entre execuções.
- [ ] Confirmar RLS e policies nas tabelas usadas pela aplicação.
- [ ] Em **Database > Publications**, confirmar `messages` e `notifications` em `supabase_realtime`.
- [ ] Configurar Auth Site URL e Redirect URLs para produção e Preview.
- [ ] Em Database > Webhooks, criar webhook `INSERT` em `public.notifications` apontando para `POST https://SEU_DOMINIO/api/push/dispatch` com header `x-extra-chef-webhook-secret: <PUSH_WEBHOOK_SECRET>`. O endpoint aceita o payload padrão do Database Webhook e retorna 401, 400, 500/502 ou 503 explicitamente quando há falha.
- [ ] Gerar chaves com `npx web-push generate-vapid-keys`; configurar a chave pública como `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` e `WEB_PUSH_VAPID_PUBLIC_KEY`, a privada como `WEB_PUSH_VAPID_PRIVATE_KEY`.
- [ ] Acessar `/api/push/status` com sessão autenticada para verificar presença das variáveis server-side e quantidade de dispositivos inscritos; o endpoint não retorna valores secretos.
- [ ] Em perfil, ativar Push no dispositivo. Ao voltar ao app em foreground, a subscription existente é sincronizada/renovada no servidor.
- [ ] Consultar `public.push_deliveries` para distinguir envios, subscriptions expiradas e falhas por status HTTP; consultar os logs da Function na Vercel pelo `notificationId` para o erro do provedor.
- [ ] Em `push_deliveries`, `sent` significa que o serviço Push aceitou o pedido; `received` significa que o Service Worker recebeu/processou o Push e confirmou ao backend. Isso não comprova que o usuário visualizou ou tocou na notificação.
- [ ] Em um dispositivo de teste inscrito, criar uma notificação de teste no SQL Editor usando o UUID do próprio usuário:

```sql
INSERT INTO public.notifications (user_id, title, message, category, url)
VALUES (
  '<UUID_DO_USUARIO_DE_TESTE>'::uuid,
  'Teste de Push',
  'Notificação de validação do ExtraChef.',
  'event',
  '/notifications'
)
RETURNING id;
```

- [ ] No navegador/PWA, confirmar `Notification.permission === 'granted'` e verificar:

```js
const registration = await navigator.serviceWorker.getRegistration('/');
({
  serviceWorker: Boolean(registration?.active),
  subscription: Boolean(await registration?.pushManager.getSubscription()),
  permission: Notification.permission,
});
```

- [ ] Se `notifications` recebe a linha, mas `push_deliveries` não: verificar o Database Webhook e a migration de entrega/preferências.
- [ ] Se `push_deliveries.status = 'failed'`: consultar HTTP `status_code` e logs da rota `/api/push/dispatch` na Vercel.
- [ ] Se `status = 'sent'` sem `received`: o serviço Push aceitou, mas o navegador/SW não confirmou; validar permissão, subscription, instalação PWA e execução do Service Worker.
- [ ] Se `status = 'received'`, o Service Worker processou o evento; se a notificação visual não apareceu, verificar se o app estava focado (nesse estado o Push vira toast in-app) e as configurações de notificações do sistema.
- [ ] Confirmar que o Database Webhook tem sucesso nas chamadas a `/api/push/dispatch`; resposta 200 com `subscriptions: 0` significa que o destinatário não tem dispositivos inscritos, não que o Push foi entregue.
- [ ] Para diagnosticar dados, execute:

```sql
SELECT id, user_id, category, title, read, created_at
FROM public.notifications
ORDER BY created_at DESC
LIMIT 25;

SELECT id, user_id, endpoint, created_at, updated_at
FROM public.push_subscriptions
ORDER BY updated_at DESC
LIMIT 25;

SELECT notification_id, subscription_id, status, status_code, updated_at
FROM public.push_deliveries
ORDER BY updated_at DESC
LIMIT 50;

SELECT user_id, messages_enabled, applications_enabled, reviews_enabled, operations_enabled, events_enabled
FROM public.notification_preferences;

SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('messages_notify_recipient');
```
- [ ] Revisar logs de Database, Auth e API após o primeiro deploy.

## Segurança de produção

- [ ] Manter somente chaves publicáveis no cliente; segredos devem ficar no servidor.
- [ ] Confirmar que RPCs `SECURITY DEFINER` usam `search_path` restrito, validam `auth.uid()` e limitam `EXECUTE` a `authenticated`.
- [ ] Testar policies RLS com contas de restaurante, trabalhador e usuário não relacionado.
- [ ] Validar no banco IDs e status sensíveis; não confiar apenas nos campos enviados pelo navegador.
- [ ] Confirmar unicidade de candidatura, check-in, check-out e avaliação no banco.
- [ ] Manter CPF, RG, data de nascimento, selfie e currículo privados; definir consentimento, retenção e exclusão conforme LGPD antes de usuários reais.
- [ ] Confirmar que o webhook de Push usa segredo forte e que a chave `service_role`/VAPID privada existe apenas no servidor.
- [ ] Não registrar tokens, chaves ou dados pessoais em logs do navegador ou da Vercel.
- [ ] Ativar MFA nas contas administrativas do Supabase e da Vercel.