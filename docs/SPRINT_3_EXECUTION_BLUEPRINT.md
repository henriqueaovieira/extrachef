# ExtraChef — Sprint 3.0 Execution Blueprint

**Foundation Staff, Controle de Acesso, Audit Trail e Verification Review Panel**  
**Base documental consultada em 9 de novembro de 2026**

## 1. Objetivo e decisão arquitetural

Este blueprint define a sequência de implementação, superfícies impactadas, validação e rollback da Sprint 3.0. É um plano; **nenhum código, migration ou dado será alterado por este documento**.

**Decisão:** manter `public.users.role` restrito aos papéis de marketplace `worker` e `restaurant`. Criar uma identidade Staff separada, vinculada ao mesmo `auth.users.id`, com papéis iniciais `admin`, `reviewer` e `support`, autorização negada por padrão e checagem no servidor/banco. A `service_role` continuará exclusiva a tarefas de sistema e a integrações estritamente privilegiadas; nunca representará um operador humano.

**Primeira entrega funcional:** revisão profissional com fila paginada, decisões atribuídas a Reviewer/Admin e acesso à selfie com finalidade e registro de emissão do link. Nenhuma operação de painel deve ficar disponível antes da camada de autorização e trilha de auditoria.

### Limite importante do baseline

`docs/DATABASE_BASELINE.md` confirma acesso autenticado ao PostgREST e Storage, mas não ao catálogo PostgreSQL nem ao histórico de migrations aplicadas. O API expõe `users`, `jobs` e `applications`; isso não revela suas definições completas. Também foi observada uma diferença entre a migration (`restaurant-assets` público) e o ambiente (`restaurant-assets` privado).

Por isso, a Sprint deve começar com um gate de schema: obter um snapshot autorizado e somente leitura dos catálogos e do histórico de migrations do ambiente-alvo, compará-los com as 55 migrations e documentar as diferenças. **Não criar migration para recriar as tabelas base já existentes, não presumir que o banco remoto corresponde ao repositório e não corrigir a visibilidade do bucket dentro desta Sprint sem decisão explícita.**

O documento `docs/SPRINT_3_IMPLEMENTATION_PLAN.md`, listado como entrada, **não existe no checkout verificado**. O plano abaixo usa como fontes os outros cinco documentos pedidos, além do código e das migrations que eles citam; se surgir um plano aprovado com requisitos diferentes, ele deve ser reconciliado antes do início da implementação.

## 2. Critérios de entrada e saída

### Gates obrigatórios antes da primeira migration

1. Obter snapshot do schema e da tabela de histórico de migrations do ambiente de destino; identificar produção, staging e desenvolvimento sem misturá-los.
2. Confirmar colunas, tipos, constraints, FKs, grants, RLS e triggers de `users`, `worker_profiles` e `storage.objects` no ambiente-alvo. Resolver dependências que impeçam a criação das tabelas Staff.
3. Comparar objetos versionados com os implantados, inclusive migrations `reconcile_*`/`restore_*`; definir tratamento do drift antes de aplicar novas mudanças.
4. Confirmar o modelo de autenticação usado no painel (cookie de sessão Next.js) e os requisitos disponíveis para MFA/AAL. O MVP não pode assumir MFA já ativo: se a política exigir MFA, habilitá-lo e testar recuperação de acesso antes de liberar operadores.
5. Designar o primeiro Admin por identidade `auth.users.id` já autenticada e aprovada fora do cadastro público. Sem identidade/bootstrap aprovados, não prosseguir para rollout.
6. Definir motivo obrigatório, mascaramento e retenção para revisão/acesso a dados de verificação. Validar com os responsáveis de privacidade; este blueprint não certifica conformidade LGPD.
7. Corrigir ou retirar de produção o endpoint de diagnóstico `app/api/debug/env/route.ts` antes do piloto administrativo e confirmar a configuração do flag em produção.

### Critérios de saída da Sprint

- `users.role` e o fluxo de cadastro continuam limitados a `worker`/`restaurant`.
- Nenhum Staff obtém acesso a dados ou ações por pertencer apenas a `authenticated`; páginas, APIs, RPCs e Storage validam a permissão necessária.
- Concessões/revogações de Staff, decisões de verificação e acesso operacional à selfie têm autoria e finalidade registradas; a escrita da decisão e do evento correspondente é atômica.
- A fila não expõe CPF/RG/selfie por consultas genéricas; respostas aplicam minimização e mascaramento por padrão.
- Testes demonstram acesso permitido e negado para `worker`, `restaurant`, `support`, `reviewer`, `admin`, usuário anônimo e sessão revogada.
- Há runbook de bootstrap, rollout, observação e rollback revisado; nenhum rollback apaga trilhas de auditoria.

## 3. Sequência de execução

```text
Fase 0 — Gate de schema, segurança e operação
  → Fase 1 — Foundation Staff e estruturas de auditoria
    → Fase 2 — Controle de acesso e administração de Staff
      → Fase 3 — Audit Trail operacional e acesso a dados sensíveis
        → Fase 4 — Backend de revisão profissional
          → Fase 5 — Verification Review Panel, piloto e rollout
```

Uma fase só avança após seus critérios de aceite. O primeiro uso de ações administrativas reais ocorre na Fase 5, com uma equipe pequena e identidades previamente bootstrapadas.

## 4. Fase 0 — Gate de schema, segurança e operação

**Objetivo:** eliminar as incertezas que tornam insegura a primeira migration e evitar que o blueprint seja aplicado ao ambiente errado.

| Superfície | Plano |
|---|---|
| Arquivos impactados | Produção: nenhum arquivo de aplicação. Atualizar `docs/DATABASE_BASELINE.md` apenas após obter evidência adicional. |
| Migrations | Nenhuma. Não executar SQL de escrita nem aplicar migrations durante a coleta do snapshot. |
| RLS | Inventariar estado efetivo de RLS, policies permissivas/restritivas e grants em `users`, `worker_profiles`, `storage.objects` e schemas relevantes. |
| RPCs | Inventariar assinaturas, `prosecdef`, `search_path`, owners e ACLs das RPCs citadas, em especial `review_profile_verification` e `submit_own_profile_verification`. |
| APIs | Confirmar guards por rota em `app/api/**`, principalmente `debug/env`, `account/*` e qualquer futura rota administrativa. |
| Componentes | Nenhum. |
| Testes | Revisar o resultado com snapshot reproduzível; confirmar por ambiente as 55 migrations e anotar objetos não versionados, divergentes ou não expostos pela API. |
| Rollback | Não aplicável: fase de descoberta sem escrita. |

**Risco de não concluir:** crítico. Uma migration feita sem DDL real pode conflitar com objetos já implantados, preservar permissões inesperadas ou falhar parcialmente.

## 5. Fase 1 — Foundation Staff

**Objetivo:** estabelecer identidade Staff separada, permissões explícitas e bootstrap sem tocar nos papéis de marketplace.

| Superfície | Impacto planejado |
|---|---|
| Arquivos existentes | `proxy.ts` (somente a integração da rota será na Fase 2); `lib/auth/routes.ts` deve continuar modelando apenas papéis de conta. Não adicionar Staff a `AccountRole`. |
| Arquivos novos | Migration versionada de Staff; opcionalmente tipos/repositorio server-only em `lib/auth/` para leitura da autorização, depois de definido o contrato. Runbook de bootstrap e revogação. |
| Migrations necessárias | Uma migration aditiva, com nome/timestamp gerado pelo fluxo oficial do repositório após o gate. Criar relação de Staff ligada a `auth.users.id`, papéis permitidos, estado habilitado/revogado, autoria de concessão/revogação, instante e motivo. Criar a estrutura append-only de audit log antes de habilitar qualquer escrita administrativa. Não criar ou alterar `public.users`, `jobs` ou `applications` nesta migration. |
| RLS impactadas | RLS própria para Staff e audit log. Leitura de membership limitada ao próprio ator e a funções administrativas específicas; mutações somente por RPCs de administração. Audit log sem leitura/escrita direta geral por `authenticated`; sem policies permissivas que exponham a tabela. Não alterar as policies atuais de Worker/Restaurant. |
| RPCs impactadas | Criar helper de autorização por ator/capacidade, com `auth.uid()`, `search_path` fixo, grants explícitos e sem aceitar identidade de ator enviada pelo cliente. Se função `SECURITY DEFINER` for necessária, restringir schema/exposição e validar permissões no corpo. Criar fluxo controlado de bootstrap/concessão/revogação que audite a alteração. |
| APIs impactadas | Nenhuma rota pública nesta fase. Definir contrato interno de autorização para reutilizar depois em endpoints admin. |
| Componentes impactados | Nenhum componente de produto. |
| Ordem exata | 1) Revisar snapshot/gate; 2) aprovar papéis e matriz de capacidades; 3) aplicar migration aditiva em ambiente de teste; 4) validar RLS/ACL; 5) bootstrap inicial controlado no ambiente de teste; 6) validar revogação; 7) promover migration; 8) bootstrap do Admin de produção com identidade já aprovada. |
| Testes | Novo `tests/staff-authorization-sql.test.mjs`: membros ativos/inativos, papel desconhecido, usuário sem membership, autoatribuição, escalada para Admin, usuário excluído, tentativas diretas de INSERT/UPDATE/DELETE e isolamento de leitura. Testar vínculo com Auth e comportamento em membership revogada. Executar contra PostgreSQL/Supabase de teste além do PGlite onde recursos/ACLs não forem equivalentes. |
| Riscos | Bootstrap indevido do primeiro Admin; divergência de `auth.users` e `users`; função privilegiada publicada; revogação não refletida em sessão/caches; RLS anterior mais restritiva do que a migration presume. |
| Rollback | Primeiro desabilitar o acesso à superfície administrativa e revogar memberships de teste/produção pelo procedimento auditado. Revogar grants de RPCs e deixar as tabelas vazias/inativas. Não apagar linhas de auditoria nem executar `DROP` automático. Se a migration falhar antes do rollout, não prosseguir; corrigir com migration forward após diagnóstico. |

**Aceite:** `users.role` não muda; o signup não aceita Staff; o primeiro Admin não pode ser criado pelo cliente, por metadata editável do usuário ou por chamada pública.

## 6. Fase 2 — Controle de Acesso

**Objetivo:** proteger a nova área administrativa em páginas, APIs e banco com negação por padrão, sem transformar Staff em um terceiro papel de conta.

| Superfície | Impacto planejado |
|---|---|
| Arquivos existentes | `proxy.ts`, `lib/auth/routes.ts`, `lib/auth/api-user.ts` (somente se o padrão de identidade escolhido precisar de integração). Preservar `AccountRole`, `isAccountRole`, `dashboardFor` e redirecionamentos Worker/Restaurant existentes. |
| Arquivos novos | Guard server-only específico de Staff/capacidade; `app/admin/layout.tsx`; página inicial mínima protegida; endpoint administrativo de gestão de Staff, se necessário para o MVP. |
| Migrations necessárias | Ajustes aditivos de grants/RPCs de concessão e revogação, caso ainda não estejam na migration da Fase 1. Nenhum `GRANT` amplo a `authenticated`. |
| RLS impactadas | Policies próprias de Staff e auditoria. As regras de negócio em `core_rls`, `profiles_and_geo`, `restaurant_events`, `dashboards_notifications`, `worker_estimated_earnings` e Storage permanecem restritas ao papel/ownership atual. Não conceder SELECT de `worker_profiles` para fazer a UI funcionar. |
| RPCs impactadas | RPCs de gestão de Staff validam `admin` no banco e registram concessão/revogação na mesma transação. As RPCs de negócio de worker/restaurant permanecem sem acesso Staff implícito. |
| APIs impactadas | Novas rotas `app/api/admin/**` devem invocar um guard comum e validar a capacidade em cada operação. APIs não são protegidas pelo matcher existente; não depender do proxy como única barreira. O padrão atual de `authenticatedApiUser` aceita Bearer, enquanto várias rotas usam sessão/cookie: escolher e testar um fluxo consistente para o painel. |
| Componentes impactados | Shell/layout administrativo mínimo, navegação e tela de acesso negado/erro; sem dados sensíveis nesta fase. |
| Ordem exata | 1) Implementar autorização server-side; 2) proteger matcher `/admin` e layout; 3) proteger cada endpoint admin; 4) validar RPC/RLS; 5) testar sessão revogada e acesso direto; 6) deploy sem links públicos; 7) liberar apenas ao Admin bootstrapado. |
| Testes | Ampliar `tests/auth-proxy.test.mjs` e `tests/auth-routes.test.mjs`; adicionar testes de guard/API para sem sessão, papel marketplace, Support, Reviewer, Admin e membership revogada. E2E: URL direta `/admin`, chamadas diretas a API, redirecionamento e fail-closed em indisponibilidade de auth/banco. |
| Riscos | Matcher do Next.js incompleto; confiar apenas em esconder botões; cache de membership ou JWT desatualizado; rotas API permanecerem abertas; MFA assumido mas não configurado. |
| Rollback | Retirar o link/rota administrativa ou reverter o deploy da aplicação; revogar execução dos RPCs sensíveis; manter policies antigas intactas. Não adicionar a `/admin` a uma allowlist genérica de sessão autenticada. |

**Aceite:** os caminhos `worker`/`restaurant` e o fluxo de login não mudam; qualquer erro ao consultar Staff resulta em bloqueio (fail-closed), não em permissões padrão.

## 7. Fase 3 — Audit Trail

**Objetivo:** fazer com que operações administrativas e acessos sensíveis sejam atribuíveis, pesquisáveis e resistentes a alteração por operadores comuns.

| Superfície | Impacto planejado |
|---|---|
| Arquivos existentes | Guard/admin API da Fase 2; `lib/supabase/admin.ts` somente se for necessário separar e restringir seu uso. |
| Arquivos novos | Tipos/serviço de auditoria server-only; rotas de leitura do audit log; página de auditoria administrativa somente para Admin na primeira versão. |
| Migrations necessárias | Completar índices/constraints e RPCs de gravação/leitura estritamente necessários. O evento crítico deve ser inserido dentro da mesma transação da mutação correspondente. Não armazenar selfie, CPF/RG completos, tokens ou payloads desnecessários no log. |
| RLS impactadas | Audit log sem UPDATE/DELETE concedidos a usuários de aplicação. Inserção apenas pelo caminho controlado de RPC. SELECT apenas por capacidade explícita (Admin; papel Auditor fica fora do MVP até ser aprovado). RLS não deve permitir que o ator escolha um `actor_id` arbitrário. |
| RPCs impactadas | Toda concessão/revogação de Staff; futuras mutações administrativas; leitura de eventos filtrada/paginada. RPC deve derivar ator/papel da sessão autenticada. Falhas ao gravar auditoria abortam a operação crítica. |
| APIs impactadas | Endpoints de gestão de Staff e de audit log. Uma leitura administrativa de dados sensíveis também gera evento de acesso antes da resposta. |
| Componentes impactados | Página/tabela de eventos com filtros por intervalo, ator, ação e entidade; valores sensíveis redigidos/mascarados. |
| Ordem exata | 1) Definir taxonomia de ações e política de minimização/retenção; 2) validar append-only/ACL; 3) envolver mutações de Staff em transação auditada; 4) registrar emissão de acesso a dados sensíveis; 5) criar leitura paginada; 6) testar impossibilidade de alterar/apagar log; 7) liberar leitura à função autorizada. |
| Testes | Novo `tests/admin-audit-sql.test.mjs`: atomicidade (mutação e evento juntos ou nenhum), autoria não falsificável, motivo obrigatório nas ações previstas, negação de UPDATE/DELETE, acesso de leitura autorizado/negado, paginação/ordenação estável e ausência de PII/secrets nos eventos. |
| Riscos | PII replicada no histórico; eventos sem correlação; transação crítica deixa de falhar se a gravação falhar; acesso a selfie registrado como “visualização” sem evidência de que a imagem foi efetivamente aberta. |
| Rollback | Desabilitar as APIs administrativas e manter eventos existentes. Em caso de bug de gravação, bloquear a operação correspondente até reparar; não tornar audit best-effort para ações críticas nem apagar eventos. |

**Semântica de acesso:** o backend pode registrar que autorizou/emitiu uma URL assinada para a selfie, não provar que a pessoa visualizou a imagem. TTL curto, sem logar a URL ou a imagem; registrar ator, pedido, finalidade, instante e resultado do pedido de assinatura.

## 8. Fase 4 — Backend de revisão profissional

**Objetivo:** substituir a revisão manual por um fluxo autorizado e concorrente, preservando as validações já existentes e incluindo autoria/histórico.

| Superfície | Impacto planejado |
|---|---|
| Arquivos existentes | `20261103000000_verified_profile.sql` e `20261104010000_reconcile_verified_profile.sql` como referências de comportamento; `lib/profile-verification.ts`; `tests/profile-verification-sql.test.mjs`; `tests/profile-verification.test.mjs`. Não editar migrations históricas aplicadas. |
| Arquivos novos | Migration forward-only de histórico/decisão de verificação; RPCs de fila, detalhe minimizado, emissão autorizada de acesso à selfie e decisão; rotas `app/api/admin/verifications/**`; funções de domínio server-only. |
| Migrations necessárias | Criar tabela de eventos/decisões com FK para perfil/ator, decisão (`verified`/`rejected`), justificativa, instante, versão/timestamp esperado e referência não sensível ao pedido. Índice para fila pendente ordenada e chave de idempotência/concorrência apropriada. Não inventar estado `not_started`: a evidência atual mostra `pending`, `verified`, `rejected`, com `pending` como default inclusive antes de selfie. |
| RLS impactadas | Manter `worker_profiles` e a selfie fora de SELECT genérico para Staff. Expor apenas RPCs de fila/detalhe autorizadas. Não substituir nem enfraquecer as policies `worker_selfie_private`, `worker_selfie_no_update` e `worker_selfie_no_delete`; o fluxo de assinatura deve aplicar autorização Staff explicitamente no servidor/banco. |
| RPCs impactadas | Evoluir a decisão hoje feita por `review_profile_verification(p_user_id,p_selfie_path,p_status,p_expected_updated_at)`: obter ator de `auth.uid()`, exigir `reviewer` ou `admin`, validar usuário ativo, pedido `pending`, path e `updated_at` esperados, motivo quando rejeitar, e inserir decisão + audit log + atualização de status atomicamente. Revogar execução para `service_role` se deixar de ser necessária ao fluxo, após validar consumidores sistêmicos. Preservar `submit_own_profile_verification` para o próprio Worker. |
| APIs impactadas | `GET` paginado da fila; detalhe de verificação com campos mínimos/mascarados; endpoint de selfie autenticado com motivo; `POST` de decisão com operação, motivo e token de concorrência. `GET` não altera estado; decisões devem validar sessão e capacidade em toda chamada. |
| Componentes impactados | Serviços server-side de fila e decisão; nenhum componente do perfil do Worker deve ganhar acesso privilegiado. Notificação do resultado só deve ser incluída se o mecanismo de notificações existente e o template forem identificados e testados; não acoplar o sucesso da revisão a um dispatch externo não transacional. |
| Ordem exata | 1) Testar a regra atual e estado real no ambiente de teste; 2) criar tabela de histórico; 3) criar fila/detail com campos minimizados e paginação; 4) criar operação de acesso à selfie com auditoria e URL de curta duração; 5) criar RPC transacional de decisão; 6) testar conflito de atualização e reenvio; 7) habilitar as APIs somente a Reviewer/Admin; 8) conferir selo e perfil público após decisão. |
| Testes | Expandir `profile-verification-sql.test.mjs` para Reviewer/Admin permitidos, Support/Worker/Restaurant/anon negados, decisão duplicada, timestamp/path obsoleto, perfil apagado, selfie inválida, justificativa, autoria, atomicidade e reenvio após rejeição. Teste Storage real confirma que o usuário comum não passa a ler selfie de terceiros. |
| Riscos | A RPC atual é `SECURITY DEFINER` e aceita somente `service_role`; conceder `EXECUTE` a `authenticated` sem alterar o corpo abre bypass. Trigger reabre revisão quando CPF/RG/telefone mudam. Operador pode decidir sobre pedido alterado. O bucket `restaurant-assets` diverge, mas não deve ser alterado como efeito colateral. |
| Rollback | Desabilitar decisão e emissão de URL no servidor e revogar os novos grants; manter dados e histórico. Se necessário, preservar a RPC antiga somente como acesso emergencial estritamente service-role, sem credencial no cliente, com procedimento operacional temporário auditado. Não fazer rollback para apagar histórico ou aprovações já executadas; correções de decisão devem ser novas ações auditadas. |

### Contrato mínimo da fila e da decisão

- Fila ordenada por data do pedido e cursor estável; limites de página definidos e aplicados no servidor.
- Resposta inicial: identificador do pedido, nome estritamente necessário, estado, instante, versão de concorrência e dados mascarados. CPF/RG integrais somente se a política aprovada demonstrar necessidade para a decisão; Support não tem acesso a selfie/CPF/RG.
- Acesso à selfie é uma operação explícita, exige Reviewer/Admin e finalidade; link temporário nunca é persistido no audit log.
- Decisão aceita apenas `verified` ou `rejected`, usa `updated_at`/versão esperada e o path esperado, registra motivo da rejeição e ator autenticado.
- Rejeição e reenvio: as evidências mais recentes indicam que o Worker pode reenviar após `rejected` com nova selfie; confirmar essa semântica no teste do schema-alvo antes de alterar o fluxo.
- `verified` permanece bloqueado para nova submissão conforme a regra atual. Não introduzir reversão silenciosa; eventual revogação de verificação exige requisito e ação administrativa separada.

## 9. Fase 5 — Verification Review Panel e rollout

**Objetivo:** disponibilizar uma interface de baixo privilégio para operar o fluxo já protegido no servidor.

| Superfície | Impacto planejado |
|---|---|
| Arquivos existentes | `app/components/professional-verification.tsx`, `app/components/profile-verification.tsx` e `app/components/verified-profile-badge.tsx` apenas para validar compatibilidade da submissão e do selo; `app/components/notification-*` apenas se houver notificação aprovada. |
| Arquivos novos | `app/admin/verifications/page.tsx`, componentes de fila/filtros, detalhe, visualizador de selfie, diálogo de decisão/motivo, estados de loading/erro/vazio; e2e de acesso e decisão. |
| Migrations necessárias | Nenhuma migration de UI. Só migrations forward adicionais se testes da Fase 4 encontrarem dependência de schema comprovada. |
| RLS impactadas | Nenhuma policy de negócio deve ser aberta para a UI. A UI consome exclusivamente APIs/RPCs da Fase 4. |
| RPCs impactadas | Nenhuma nova superfície direta no browser. Chamadas apenas pelas APIs autenticadas e autorizadas. |
| APIs impactadas | Consumo de fila, detalhe, selfie e decisão. Tratamento explícito de `401`, `403`, `409` (pedido alterado), `5xx` e falha de Storage. Sem cache de conteúdo sensível em CDN/browser; usar cabeçalhos `no-store`. |
| Componentes impactados | Painel responsivo e acessível com paginação, estados claros, motivo obrigatório ao rejeitar e confirmação antes da decisão. Não armazenar selfie em cache local persistente nem em logs de frontend. |
| Ordem exata | 1) Concluir testes de segurança de APIs; 2) construir tela atrás de proteção de rota; 3) testar acessibilidade e mobile; 4) deploy sem liberação ampla; 5) validar com contas de cada papel; 6) piloto com um Reviewer e um Admin; 7) acompanhar erros, backlog e decisões; 8) ampliar acesso após aceite operacional. |
| Testes | Novos testes de API e E2E: `worker`/`restaurant`/`support` não acessam a fila; Reviewer opera; Admin opera; sessão revogada deixa de operar; motivo obrigatório; conflito de versão; link expirado; falha de Storage; estado vazio e paginação; navegação por teclado e axe. Executar `npm test`, `npm run typecheck`, `npm run build` e a suíte Playwright configurada. |
| Riscos | Exposição acidental de CPF/RG em HTML, cache, analytics ou logs; clique repetido; decisão concorrente; link de selfie copiado; painel carrega APIs que confiam apenas no proxy. |
| Rollback | Remover a liberação do painel ou reverter o deploy da aplicação e revogar grants/endpoints de decisão/assinatura. Preservar membros e logs para investigação. Garantir que o fluxo do Worker de submissão continue funcionando mesmo com o painel desligado. |

## 10. Matriz consolidada de impactos

| Área | Objetos/superfícies | Diretriz |
|---|---|---|
| Identidade marketplace | `public.users.role`, `lib/auth/routes.ts`, `proxy.ts` | Manter `worker`/`restaurant`; Staff não entra em `AccountRole` |
| Staff | Nova tabela vinculada a `auth.users.id`, helpers, RPCs de gestão | Bootstrap explícito; sem autoatribuição; revogação consultada no servidor/banco |
| Audit Trail | Nova tabela append-only, RPCs transacionais, endpoints/tela de leitura | Ação e log atômicos; acesso sensível minimizado; sem segredos/PII desnecessária |
| Verificação | `worker_profiles`, `storage.objects`, `review_profile_verification`, `submit_own_profile_verification` | Sem SELECT amplo; Reviewer/Admin por operação explicitamente autorizada |
| RLS existente | `core_rls`, `profiles_and_geo`, `restaurant_events`, `dashboards_notifications`, `worker_estimated_earnings`, policies de selfie | Não ampliar por conveniência nem adicionar papel de conta; novas permissões isoladas |
| Rotas e APIs | `/admin/**`, `app/api/admin/**`; `proxy.ts` não protege APIs por si só | Guard individual em página/layout/API/RPC; fail-closed |
| Service role | `lib/supabase/admin.ts`, rota de assinatura Storage quando indispensável | Serviço sistêmico não equivale a operador; uso restrito, sem expor chave e com ação humana auditada |
| Notificações | `notifications`, infraestrutura existente de push/dispatch | Fora do critério de sucesso transacional da decisão; incluir apenas após contrato e teste |
| Endpoint de diagnóstico | `app/api/debug/env/route.ts` | Corrigir/remover antes do piloto; fora do escopo de painel, mas gate de segurança |

## 11. Plano de teste e validação por ambiente

1. **Unitário/contrato:** autorização de rotas e guard, validação de input, mascaramento, paginação, erros e motivos.
2. **Banco:** RLS e grants com papéis reais do Postgres; testar tanto permitido quanto negado. PGlite segue o padrão já usado em `tests/profile-verification-sql.test.mjs`, mas não substitui verificação em PostgreSQL/Supabase para recursos não equivalentes.
3. **API:** sessão válida/inválida, papel Staff necessário, usuário excluído/revogado, ausência de cache, rate limit se implementado, erros do Storage e concorrência otimista.
4. **Storage:** bucket privado; usuário dono; outros Workers/Restaurants; Reviewer/Admin pelo caminho aprovado; Support/anônimo negados; URL expirada; sem permissões de update/delete da selfie submetida.
5. **E2E:** acesso direto à URL e à API, login e logout, operação por papel, decisão/rejeição, conflito de atualização, estados vazios e acessibilidade.
6. **Regressão:** executar `npm test`, `npm run typecheck`, `npm run build` e Playwright. Confirmar que os testes de verificação existentes, cadastro, `proxy`, privacidade e rotas de Worker/Restaurant permanecem verdes.
7. **Staging:** aplicar migrations na ordem, validar smoke tests com dados não produtivos e comparar snapshot pós-migration; não usar selfies reais para teste.
8. **Produção:** canário com um Admin/Reviewer, monitorar negações/erros, confirmar autoria no audit log e só então ampliar. Definir procedimento de emergência antes da primeira decisão.

## 12. Estratégia de rollback e recuperação

- **Rollback primário é da aplicação:** retirar o acesso às páginas/APIs administrativas e revogar os grants novos, mantendo o fluxo de Worker para envio de verificação.
- **Migrations são aditivas e forward-only:** não planejar `DROP TABLE`, remoção de histórico, alteração de `users.role` ou reconstrução de tabelas base. Para corrigir schema, aplicar migration corretiva após snapshot e revisão.
- **Revogação de Staff:** usar estado revogado e invalidar/renovar a sessão conforme a estratégia testada; confirmar que a próxima requisição é negada. Não depender apenas de claims JWT cacheadas.
- **Falha de auditoria:** decisões e mudanças críticas falham fechadas se o evento não puder ser persistido. O operador recebe erro e o estado de verificação deve permanecer inalterado.
- **Decisão já executada:** não apagar evento nem “desfazer” silenciosamente. Corrigir com novo evento/ação autorizada, mantendo estado anterior e motivo.
- **Acesso à selfie:** interromper a emissão de links e revogar o caminho administrativo se houver suspeita de vazamento; links previamente emitidos devem expirar em prazo curto. Investigar o evento de emissão.
- **Incidente de migration:** parar o rollout, preservar logs e snapshot, avaliar transação/estado parcial e criar correção forward. Não executar rollback destrutivo em produção sem plano específico aprovado.

## 13. Riscos críticos e mitigação

| Risco | Severidade | Mitigação/gate |
|---|---|---|
| DDL base e migration history não reconciliados | CRÍTICO | Gate de schema antes de qualquer migration; não recriar tabelas já existentes |
| Conceder `authenticated` à RPC `SECURITY DEFINER` atual sem validar ator | CRÍTICO | Nova autorização interna via `auth.uid()`/membership; teste de grants e negação |
| Uso de `service_role` como identidade humana | CRÍTICO | Sessão do operador e papel Staff em cada operação; service role fica no backend técnico |
| Aprovação sem trilha transacional | CRÍTICO | Audit + decisão + mudança de estado na mesma transação |
| Exposição de selfie/CPF/RG a Support ou usuário comum | CRÍTICO | Minimização, RPC/API específica, Storage privado, motivo e evento de acesso |
| `/api/**` presumido protegido pelo proxy | ALTO | Guard obrigatório por rota administrativa e teste por chamada direta |
| Membership revogada ainda aceita por cache/JWT | ALTO | Validar estado atual no caminho de ação; sem depender de claim desatualizada |
| Divergência `restaurant-assets` público/privado | MÉDIO/ALTO | Não alterar no escopo; decidir e reconciliar separadamente antes de mudanças de mídia |
| Retenção/base legal de dados de verificação não definida | ALTO | Aprovação de privacidade e prazo de retenção como condição do piloto |

## 14. Itens explicitamente fora desta entrega

- Gestão geral de usuários, suspensão/bloqueio, exclusões assistidas e suporte operacional.
- Moderação de chat/avaliações, disputas de pagamento e verificação de restaurantes.
- Papel `moderator` ou `auditor`, claims JWT para Staff e cache de autorização.
- Dashboard de métricas amplo, SLA/alertas e observabilidade empresarial.
- Alteração de políticas de `restaurant-assets`, evolução ampla do schema base ou limpeza geral de migrations `reconcile_*`.

Esses itens podem ser priorizados após validação do piloto, sem ampliar as permissões da Sprint 3.0 por antecipação.

## 15. Referências usadas

- `docs/EXTRACHEF_MASTER_ARCHITECTURE.md`
- `docs/ADMIN_ARCHITECTURE.md`
- `docs/SPRINT_3_READINESS_REPORT.md`
- `docs/FOUNDATION_STAFF_AND_DATABASE_REPORT.md`
- `docs/DATABASE_BASELINE.md`
- `proxy.ts`, `lib/auth/routes.ts`, `lib/auth/api-user.ts`
- `supabase/migrations/20261014051000_core_rls.sql`
- `supabase/migrations/20261014050000_profiles_and_geo.sql`
- `supabase/migrations/20261103000000_verified_profile.sql`
- `supabase/migrations/20261104010000_reconcile_verified_profile.sql`
- `tests/profile-verification-sql.test.mjs`
