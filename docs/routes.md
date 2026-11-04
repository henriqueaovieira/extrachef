# Rotas oficiais, legados e responsabilidade tecnica

## Convencoes

Inventario do worktree local, incluindo as consolidacoes de perfil e mensagens.
Nao e uma declaracao de deployment publicado ou de frequencia real de uso.
Responsavel abaixo significa **area tecnica/logica**, nao pessoa designada;
owners individuais ainda precisam ser definidos pelo mantenedor.

Fonte de protecao por papel: [proxy](../proxy.ts),
[regras de acesso/retorno](../lib/auth/routes.ts) e
[SessionGuard](../app/components/session-guard.tsx). Esta sprint nao os altera.
Toda mudanca futura de URL deve preservar query, hash, retorno de login e
consumidores externos. Uma entrada Next.js nao e codigo morto por nao ter imports.

## Rotas oficiais

### Publico e conta

| Rota | Responsavel | Finalidade / fonte |
| --- | --- | --- |
| `/` | Produto / acesso | [Landing](../app/page.tsx). |
| `/login` | Conta | [Entrada e recuperacao](../app/login/page.tsx). |
| `/register` | Conta | [Cadastro](../app/register/page.tsx), termos e retorno autorizado. |
| `/auth/callback` | Conta | [Callback HTTP](../app/auth/callback/route.ts), confirmacao/recuperacao; contrato externo. |
| `/settings/password` | Conta | [Redefinicao de senha](../app/settings/password/page.tsx). |
| `/settings/privacy` | Conta / privacidade | [Preferencias e direitos](../app/settings/privacy/page.tsx). |
| `/privacy` | Privacidade | [Politica](../app/privacy/page.tsx). |
| `/terms` | Produto / juridico | [Termos](../app/terms/page.tsx). |
| `/notifications` | Comunicacao | [Avisos](../app/notifications/page.tsx); nao e caixa de chat. |

### Restaurante

| Rota | Responsavel | Finalidade / fonte |
| --- | --- | --- |
| `/restaurant/dashboard` | Operacoes / apresentacao | [Central operacional](../app/restaurant/dashboard/page.tsx). |
| `/restaurant/demands` | Demandas | [Lista](../app/restaurant/demands/page.tsx). |
| `/restaurant/demands/{demandId}` | Demandas / contratacao | [Detalhe](../app/restaurant/demands/[demandId]/page.tsx), acoes e equipe da demanda. |
| `/restaurant/dashboard/jobs/create` | Demandas | [Criar operacao](../app/restaurant/dashboard/jobs/create/page.tsx). |
| `/restaurant/candidates` | Talentos / contratacao | [Central](../app/restaurant/candidates/page.tsx); `demand` seleciona operacao em Talentos. |
| `/restaurant/team` | Contratacoes / apresentacao | [Equipe global](../app/restaurant/team/page.tsx). |
| `/restaurant/messages` | Comunicacao | [Unica entrada oficial da caixa restaurante](../app/restaurant/messages/page.tsx). |
| `/restaurant/more` | Navegacao / conta | [Mais](../app/restaurant/more/page.tsx). |
| `/restaurant/profile` | Perfil restaurante | [Visualizacao](../app/restaurant/profile/page.tsx). |
| `/restaurant/profile/edit` | Perfil restaurante | [Editor](../app/restaurant/profile/edit/page.tsx). |
| `/restaurant/history` | Historico | [Pagina atual](../app/restaurant/history/page.tsx); manter mesmo que apresente vazio. |

### Profissional

| Rota | Responsavel | Finalidade / fonte |
| --- | --- | --- |
| `/worker/dashboard` | Oportunidades / apresentacao | [Home e historico](../app/worker/dashboard/page.tsx). |
| `/worker/applications` | Contratacoes | [Candidaturas e etapas](../app/worker/applications/page.tsx). |
| `/worker/invitations` | Contratacoes | [Convites](../app/worker/invitations/page.tsx). |
| `/worker/messages` | Comunicacao | [Caixa do profissional](../app/worker/messages/page.tsx), distinta da caixa do restaurante. |
| `/worker/profile` | Perfil profissional | [Entrada unica](../app/worker/profile/page.tsx), aba Perfil. `?edit=1` abre editor existente, sem outra rota de experiencia. |

### Operacao compartilhada

| Rota | Responsavel | Contrato |
| --- | --- | --- |
| `/chat/{jobId}` | Comunicacao operacional | [Chat](../app/chat/[jobId]/page.tsx), acesso depende de contratacao/contexto. |
| `/checkin/{jobId}` | Presenca operacional | [Check-in](../app/checkin/[jobId]/page.tsx), nao modificar nesta sprint. |
| `/payment/{jobId}` | Pagamento operacional | [Pagamento](../app/payment/[jobId]/page.tsx), nao modificar. |
| `/checkout/{jobId}` | Encerramento operacional | [Checkout](../app/checkout/[jobId]/page.tsx), nao modificar. |
| `/reviews/{jobId}` | Avaliacao operacional | [Avaliacao](../app/reviews/[jobId]/page.tsx), preservar obrigacoes existentes. |

## Rotas e URLs de compatibilidade

| Entrada legada | Destino / comportamento | Responsavel e mecanismo |
| --- | --- | --- |
| `/profile`, worker | `/worker/profile`, query/hash preservados. | Perfil; [WorkerProfileRedirect](../app/components/worker-profile-redirect.tsx), depois de identificar papel. |
| `/profile`, restaurante | Mantem experiencia generica atual. **Nao e removivel enquanto servir esse papel.** | Perfil restaurante / conta; [pagina](../app/profile/page.tsx). |
| `/worker/profile/details` | `/worker/profile`. | Perfil; redirect cliente, replace no historico, pagina mantida. |
| `/worker/profile/edit` | `/worker/profile?edit=1`. | Perfil; intencao de editar preservada, pagina mantida. |
| `/restaurant/candidates?view=messages` | `/restaurant/messages`, remove somente o seletor `view=messages`; preserva outros parametros e hash nao legado. | Comunicacao; [CandidatesPage](../app/restaurant/candidates/page.tsx). |
| `/restaurant/candidates#chats` | `/restaurant/messages`, consome hash legado; preserva query. | Comunicacao; hash identificado no cliente, inclusive `hashchange`. |

Os redirecionamentos de mensagens usam `router.replace`, mantendo uma unica
entrada no historico e sem montar uma segunda caixa ou Talentos durante o
encaminhamento. A pagina aguarda o hash do navegador antes de montar Talentos;
no servidor ainda nao e possivel distinguir `#chats` de candidatos normais.
Ha link explicito de continuidade quando a entrada legada ja foi identificada.

A protecao existente continua sendo executada antes da compatibilidade.
Sem sessao, login continua recebendo o caminho/query solicitado. Nenhuma
alteracao em autenticacao ou notificacoes persistidas foi necessaria.

SQL historico e avisos antigos ainda podem conter `/restaurant/candidates#chats`:
nao reescrever migrations nem registros para "limpar" URLs. A compatibilidade
atende esses consumidores no frontend.

## Queries e ancoras que nao sao rotas duplicadas

- Perfil: `?edit=1`, `#verification`, `#confidence`.
- Home worker: `#historico`.
- Candidatos: `?demand={id}` seleciona demanda. Nao redirecionar todos os acessos
  de candidatos para mensagens.
- Detalhe de demanda: `?view=talents|candidates|profile`, `person={id}` e
  `?action=edit|duplicate`; nao sao o seletor legado `view=messages`.
- Detalhe: `#team-heading` (secao ampla), `#candidates-heading`,
  `#hired-heading`, `#reserve-heading` e secoes `#chat-heading`,
  `#checkin-heading`, `#payment-heading`, `#checkout-heading`.
- URLs externas de mapas e retorno de autenticacao continuam com seus contratos.

## APIs: manter todas

Responsabilidade indicada por area; nenhum endpoint foi removido ou alterado.

| Endpoint | Area | Consumidor/contrato |
| --- | --- | --- |
| `/api/account/export` | Privacidade | Download autenticado de dados. |
| `/api/account/delete` | Privacidade | Exclusao autenticada de conta e objetos conforme fluxo existente. |
| `/api/geocode` | Localizacao | Geocodificacao usada nos formularios ativos. |
| `/api/debug/env` | Diagnostico | Runbooks/testes operacionais, nao inferir desuso por falta de JSX. |
| `/api/push/subscriptions` | Push | Registro/sincronizacao do dispositivo. |
| `/api/push/status` | Push / diagnostico | Estado do servico/dispositivo. |
| `/api/push/dispatch` | Push | Webhook, nao depende de um link da interface. |
| `/api/push/receipt` | Push | Service worker/confirmacao de entrega. |

## Navegacao e politica futura

Fontes: [MobileBottomNav](../app/components/mobile-bottom-nav.tsx),
[MoreNavigation](../app/components/more-navigation.tsx),
[DashboardAvatar](../app/components/dashboard-identity.tsx),
[NotificationCenter](../app/components/notification-center.tsx).

- Home/cards e menus podem oferecer varios acessos a uma mesma URL:
  acesso contextual util nao e fluxo duplicado.
- Mensagens na navegacao restaurante e em notificacoes aponta diretamente a
  `/restaurant/messages`; voltar do chat tambem. Conversas individuais seguem
  `/chat/{jobId}`; nao obrigar passagem pela caixa.
- A aba Perfil worker reune dados e atalhos de conta. Restaurante conserva Mais.
- So remover compatibilidade depois de medir uso, validar consumidores externos,
  avisos antigos, login/voltar/refresh e aprovar outra sprint. Sem prazo presumido.
- Mudancas nas areas operacionais, autenticacao, permissoes, RPCs e push exigem
  autorizacao propria; nao sao consequencia automatica da governanca de URLs.

Veja [arquitetura](./architecture.md) e
[relatorio de estabilidade](./stability-report.md).
