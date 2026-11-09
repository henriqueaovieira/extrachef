# ExtraChef — Authorization Layer Discovery Report

**Branch inspecionada:** `sprint-3.0.2-authorization-layer`  
**Commit HEAD observado:** `dd4b821` — merge de `sprint-3.0.1-foundation-staff`  
**Data-base:** 9 de novembro de 2026  
**Modo:** inspeção do checkout e dos documentos; nenhuma migration, dado, teste ou código foi alterado.

## 1. Resultado executivo

A Foundation Staff 3.0.1 **está presente no checkout atualizado**. O HEAD registra o merge da branch `sprint-3.0.1-foundation-staff`, e a árvore contém os arquivos de Staff, APIs, guards, migrations e testes esperados. O relatório anterior que indicava ausência local está obsoleto e é substituído por esta descoberta.

A Foundation já implementa identidade Staff separada de `public.users.role`, acesso às páginas `/admin` por membership ativa, APIs de gestão Staff protegidas por papel Admin e auditoria transacional das concessões/revogações. **Ela ainda não é um RBAC por permissões:** não há catálogo role→permission, autorizações específicas por rota/recurso, menu por capability, leitura de audit trail, telas Staff/Audit/Verification/Settings, nem APIs de verificação/audit/settings/users.

**Pré-requisito de repositório:** confirmado.  
**Pré-requisito de banco remoto:** não confirmado. `docs/DATABASE_BASELINE.md` e `docs/DATABASE_CANONICAL_SCHEMA.md` continuam registrando ausência de acesso ao catálogo PostgreSQL/histórico aplicado e falta de reprodutibilidade do schema base. A presença das migrations no Git não prova que foram aplicadas nem que o banco remoto corresponde a elas. O gate de reconciliação permanece obrigatório antes de novas migrations ou mudança de grants/RLS.

## 2. Estado da branch e escopo observado

- Branch: `sprint-3.0.2-authorization-layer`.
- HEAD: `dd4b821`, merge de `sprint-3.0.1-foundation-staff`.
- A árvore contém artefatos Playwright não rastreados (`playwright-artifacts/`, `playwright-report/`, `playwright/`, `test-results/`); eles não foram alterados.
- Inventário confirmado no checkout:
  - `app/admin/layout.tsx`, `app/admin/page.tsx`;
  - `app/api/admin/staff/route.ts`, `app/api/admin/staff/me/route.ts`, `app/api/admin/staff/[id]/revoke/route.ts`;
  - `lib/auth/staff-access.ts`, `lib/auth/staff-api.ts`;
  - migrations `20261110010000_staff_foundation.sql`, `20261110020000_admin_audit_log.sql`, `20261110030000_staff_functions.sql`;
  - `tests/staff-members.sql.test.mjs`, `tests/admin-api.test.mjs`, `tests/e2e/admin-access.spec.ts`, além dos testes de auth existentes.

## 3. Mapa atual de autorização

| Camada | Comportamento atual | Evidência |
|---|---|---|
| Marketplace | `AccountRole` permanece `worker | restaurant`; registro também valida somente esses valores | `lib/auth/routes.ts`, `20261015020000_auth_foundation.sql`, `20261014051000_core_rls.sql` |
| `/admin/**` | `proxy.ts` valida JWT/sessão, chama `get_staff_membership()` e deixa passar qualquer membership Staff ativa; não diferencia capacidades por sub-rota | `proxy.ts`, `lib/auth/staff-access.ts` |
| Guard cliente | `SessionGuard` também verifica membership Staff para UX e repete checagem periódica; não valida capabilities e não substitui guard server/API | `app/components/session-guard.tsx` |
| Staff API | `authorizeStaffApi(request, roles?)` valida Auth e membership atual em cada request; restringe operações administrativas por array de papel | `lib/auth/staff-api.ts` |
| Listagem Staff | `GET /api/admin/staff` exige `admin`, usa `list_staff_members` com paginação máxima 100 e não retorna e-mail | `app/api/admin/staff/route.ts` |
| Concessão/alteração | `POST /api/admin/staff` exige `admin`, origem same-origin, UUID, papel permitido e razão | `app/api/admin/staff/route.ts`, `grant_staff_role` |
| Revogação | `POST /api/admin/staff/[id]/revoke` exige `admin`, origem same-origin, UUID e razão | `app/api/admin/staff/[id]/revoke/route.ts`, `revoke_staff_role` |
| Página | `/admin` mostra apenas papel e status obtidos por `/api/admin/staff/me`; não há menus nem páginas de recurso | `app/admin/page.tsx`, `app/admin/layout.tsx` |
| Auditoria | Log privado append-only; concessões, alterações de papel e revogações são registradas pelas funções. Não há API/RPC/tela de leitura | migration `20261110020000_admin_audit_log.sql`, `20261110030000_staff_functions.sql` |
| Verificação | Worker submete selfie; `review_profile_verification(...)` aceita decisão `verified/rejected`, valida timestamp e caminho, mas execução é concedida somente a `service_role`; não há fluxo Staff de revisão | `20261103000000_verified_profile.sql`, `20261104010000_reconcile_verified_profile.sql` |
| RLS Storage/perfil | `worker_profiles` tem políticas de owner; selfie privada é protegida para acesso do proprietário e sem alteração/exclusão; não há acesso Reviewer/Support | `20261014050000_profiles_and_geo.sql`, `20261103000000_verified_profile.sql` |

## 4. Foundation Staff: validação requisito a requisito

| Requisito 3.0.1 | Estado no checkout | Evidência/observação |
|---|---|---|
| `private.staff_members` | ✅ Presente | Migration define um membership por `auth.users.id`, papel `admin/reviewer/support`, status ativo/desabilitado/revogado |
| `private.admin_audit_log` | ✅ Presente | RLS habilitada, grants diretos revogados, trigger impede `UPDATE`/`DELETE` |
| Staff functions | ✅ Presentes | `is_staff`, `is_admin`, `is_reviewer`, `is_support`, `get_staff_membership`, `list_staff_members`, `grant_staff_role`, `revoke_staff_role` |
| `/admin` protegido por Staff, sem usar `users.role` | ✅ Presente | `proxy.ts` usa `get_staff_membership`; `SessionGuard` tem ramo Staff separado |
| APIs Staff com Auth e autorização | ✅ Presente | Guard API valida `getUser()` e membership; gestão/listagem exige papel Admin |
| `public.users.role` intacto | ✅ No código/migrations inspecionados | Account role continua `worker/restaurant`; nenhuma migration Staff altera essa coluna |
| Acesso Reviewer/Support diferenciado por capability | ❌ Ausente | Helpers conhecem o papel, mas não capabilities |
| Guard por página/capability | ❌ Ausente | Proxy só exige membership ativa para todo `/admin/**`; apenas `/admin` existe hoje |
| Testes SQL/API | ✅ Presentes | Cobrem isolamento, funções, grants, audit transacional, Auth e APIs Staff |
| Teste E2E Reviewer/Support | ⚠ Parcial | `tests/e2e/admin-access.spec.ts` testa Worker, Restaurant e Admin; não testa acesso de Reviewer/Support nem gating por página/capability |
| Migration aplicada no ambiente-alvo | ⚠ Não verificável | Baseline não consulta migration history/catalog PostgreSQL remoto |

## 5. Gaps reais para RBAC

### 5.1 Gaps funcionais

1. **Sem catálogo central de permissions:** `staff_role` é um ENUM e cada regra compara diretamente `admin`, `reviewer` ou `support`; não existe tabela/mecanismo versionado de capabilities.
2. **Autorização por papel acoplada às rotas:** APIs recebem lista de papéis; não existe `has_staff_permission(permission)` nem contexto de capabilities para a interface.
3. **Acesso a páginas todo-ou-nada:** qualquer Staff ativo pode passar pelo `proxy.ts` em qualquer caminho `/admin/**`; ainda não há rotas staff/audit/verifications/settings/users nem guards por capability.
4. **Gestão de Staff sem UI dedicada:** há APIs para listar/conceder/revogar e uma página-raiz mínima, mas não uma tela `/admin/staff`.
5. **Audit sem read path:** tabela e eventos existem, mas sem RPC/API paginada, export, filtros allowlisted ou tela `/admin/audit`.
6. **Sem APIs/telas de Verification Review Panel:** endpoint de fila, decisão, atribuição/review, motivo de rejeição e acesso temporário a documentos não existem.
7. **Sem recursos de usuário/settings:** não há endpoint/tela para `user.view`, `user.flag` ou `system.settings`; significado e persistência de flag/configuração precisam de contrato explícito.
8. **`/staff/me` não fornece capabilities:** retorna apenas `{ role, status }`, insuficiente para filtrar menu (o servidor ainda precisa validar cada operação independentemente).

### 5.2 Gaps e riscos de segurança na Foundation que o patch RBAC deve corrigir

- **Rebaixamento do último Admin:** `revoke_staff_role` impede remover o último Admin ativo, mas `grant_staff_role` permite alterar o papel de uma membership existente. Um Admin pode trocar o papel do único outro Admin por `reviewer`/`support`, deixando o sistema sem Admin. A checagem do último Admin deve cobrir concessão que cause rebaixamento e outras transições, sob lock transacional.
- **Contrato de erro de último Admin:** a função lança SQLSTATE `23514`; `rpcErrorStatus` mapeia esse estado para 409, e a API devolve erro genérico. Não implementa o requisito `403 LAST_ADMIN_PROTECTION`; o patch deve normalizar o erro de forma estável sem vazar detalhes internos.
- **Policies de DML em `staff_members`:** migration cria SELECT/INSERT/UPDATE policies para Admin, mas a migration Foundation também revoga todos os grants diretos da tabela para papéis de aplicação. Policies não concedem privilégios por si só; manter DML exclusivamente nas RPCs auditadas e avaliar remoção/ajuste das policies redundantes após confirmar grants/owners remotos.
- **Sem audit de negações/permissões:** ações de membership são auditadas, porém não há eventos `PERMISSION_DENIED` ou `PERMISSION_GRANTED` nem concessão de permissões individual no modelo atual. Registrar negações requer controle de volume, rate limit e cuidado para que um erro de autorização não seja perdido por rollback da mesma transação. Seeds RBAC aplicados por migration não têm um ator humano de sessão; não inventar ator.
- **Auto-revogação:** a API/RPC bloqueia sempre a auto-revogação, mais restritivo do que “bloquear somente se restar um Admin”. A decisão deve ser preservada ou deliberadamente ajustada com teste e operação de recuperação. Não relaxar implicitamente.
- **Estado de auditoria:** a tabela é append-only para papéis da aplicação, mas não há RPC de leitura. `old_data/new_data` são JSONB; futura API precisa de allowlist/minimização e não pode exportar conteúdo sensível irrestrito.

### 5.3 Gaps de banco de dados e validação remota

- `DATABASE_BASELINE.md` afirma que não havia credencial de catálogo PostgreSQL nem migration history acessível.
- `DATABASE_CANONICAL_SCHEMA.md` permanece parcial; as tabelas base `public.users`, `jobs`, `applications` não são criadas pelas migrations do repo.
- Não inferir que as três migrations Staff estão aplicadas em staging/produção por estarem versionadas e por existirem testes PGlite.
- Antes da migration RBAC, obter snapshot read-only do ambiente específico, migration history, RLS/grants, owners/search paths, schemas expostos pelo PostgREST e assinaturas reais das funções.

## 6. Reconciliação com os documentos de arquitetura

| Documento | Evidência/posição | Reconciliação para a Sprint 3.0.2 |
|---|---|---|
| `docs/SPRINT_3_2_AUTHORIZATION_LAYER_PLAN.md` | Propõe capabilities mais descritivas (`staff.members.*`, `admin.audit.read`, `verification.queue/case/decision/document.*`, `support.case.*`) e limita Support a dados minimizados, sem verificação/selfies | A matriz de permissions pedida no Prompt Mestre é mais específica/diferente. O patch plan toma como requisito a matriz explícita Admin/Reviewer/Support do Prompt Mestre, mas limita campos e operações de Support. Nomeação das capabilities precisa ser normalizada antes da migration para não manter dois catálogos |
| `docs/ADMIN_ARCHITECTURE.md` | Documento de discovery anterior à Foundation; afirma que não existia Admin/Reviewer/Support, nem UI/audit | Histórico de descoberta; essas afirmações estão superadas pela branch mergeada 3.0.1. As constatações sobre papéis de conta, dados sensíveis, `service_role` e lacunas de verificação continuam relevantes |
| `docs/EXTRACHEF_MASTER_ARCHITECTURE.md` | Discovery anterior à Foundation; descreve `/admin` e audit como inexistentes e revisão de verificação como `service_role`-only | A primeira afirmação está superada no código atual. A autorização `service_role`-only para `review_profile_verification` continua sendo fato da migration atual e é uma dependência a alterar com RPC protegida/auditada, não por grant direto |
| `docs/DATABASE_BASELINE.md` / `docs/DATABASE_CANONICAL_SCHEMA.md` | Schema remoto, migration history e reprodutibilidade permanecem sem confirmação | Continua sendo gate de implantação; não é resolvido pelo merge do código da Foundation |

## 7. Conclusão dos pré-requisitos

| Pré-requisito | Estado | Gate |
|---|---|---|
| Branch contém Foundation Staff 3.0.1 | ✅ Confirmado no merge/arquivos | Satisfeito |
| Staff isolado de `public.users.role` | ✅ Confirmado no código/migrations locais | Satisfeito em Git; confirmar remoto |
| Migrations Staff presentes e testadas localmente | ✅ Presentes e cobertas por `tests/staff-members.sql.test.mjs` | Satisfeito como evidência local; teste isolado não prova deploy |
| APIs e membership guard presentes | ✅ Confirmado | Satisfeito para o escopo Staff atual |
| Matriz role→permissions aprovada sem conflito | ⚠ Não | Normalizar nomes e resolver diferença de acesso Support entre o Prompt Mestre e o plano/documentos anteriores |
| Schema/migration history do banco-alvo reconciliados | ❌ Não comprovado | Impede aplicar novas migrations no remoto |
| Bootstrap/recuperação do primeiro/último Admin | ⚠ Parcial | Bloqueia rollout de gestão sem runbook; testar rebaixamento do último Admin |
| Estratégia de auditoria de negações/export e retenção | ❌ Não definida | Bloqueia entrega de audit export/`PERMISSION_DENIED` |
| Semântica de `verification.review`, `user.flag`, settings/bootstrap | ⚠ Ambígua ou sem modelo | Fechar contratos antes das rotas correspondentes |

## 8. Referências inspecionadas

- `proxy.ts`, `app/components/session-guard.tsx`
- `app/admin/layout.tsx`, `app/admin/page.tsx`
- `app/api/admin/staff/route.ts`, `app/api/admin/staff/me/route.ts`, `app/api/admin/staff/[id]/revoke/route.ts`
- `lib/auth/routes.ts`, `lib/auth/staff-access.ts`, `lib/auth/staff-api.ts`
- `supabase/migrations/20261110010000_staff_foundation.sql`
- `supabase/migrations/20261110020000_admin_audit_log.sql`
- `supabase/migrations/20261110030000_staff_functions.sql`
- `supabase/migrations/20261014051000_core_rls.sql`
- `supabase/migrations/20261014050000_profiles_and_geo.sql`
- `supabase/migrations/20261103000000_verified_profile.sql`
- `tests/staff-members.sql.test.mjs`, `tests/admin-api.test.mjs`, `tests/auth-proxy.test.mjs`, `tests/auth-routes.test.mjs`
- `tests/e2e/admin-access.spec.ts`
- `docs/SPRINT_3_2_AUTHORIZATION_LAYER_PLAN.md`
- `docs/ADMIN_ARCHITECTURE.md`
- `docs/EXTRACHEF_MASTER_ARCHITECTURE.md`
- `docs/DATABASE_BASELINE.md`, `docs/DATABASE_CANONICAL_SCHEMA.md`
