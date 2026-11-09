# ExtraChef — Sprint 3.0.2 Authorization Layer

**Patch plan executável — sem implementação nesta etapa**  
**Branch:** `sprint-3.0.2-authorization-layer`  
**Pré-condições:** código Foundation Staff 3.0.1 confirmado no HEAD; reconciliação read-only do banco-alvo ainda pendente.

## 1. Objetivo e decisão de escopo

Evoluir a Foundation, que atualmente autoriza por papel Staff, para RBAC por capability em páginas, APIs e funções SQL, mantendo `public.users.role` limitado a `worker`/`restaurant`.

O patch entrega:

- catálogo central/versionado de permissions e role assignments;
- permission engine validado no banco sem cache de autorização;
- autorização por capability em páginas/API/RPC;
- gestão de Staff e consulta/exportação controlada de audit trail;
- contratos e backend do escopo de verificação/usuários/settings que forem aprovados na matriz abaixo;
- testes de autorização negativos/positivos e regressão dos fluxos Worker/Restaurant.

Não dar acesso genérico de Staff a tabelas de domínio, Storage, `service_role`, nem claims JWT. Nenhuma capability substitui guard por endpoint ou validação dentro da RPC.

**Gate remoto:** não criar/aplicar migrations até obter snapshot read-only do banco-alvo e reconciliar catálogo, migration history, RLS, grants, owners e funções. A Foundation no Git não comprova que está aplicada remotamente.

## 2. Matriz role → permissions proposta

Implementar as permissions definidas no Prompt Mestre, após normalizar nomes e fechar as semânticas indicadas na seção 3.

| Capability | Admin | Reviewer | Support | Descrição/limite |
|---|---:|---:|---:|---|
| `staff.view` | ✅ | ❌ | ❌ | Listar memberships e dados mínimos Staff |
| `staff.manage` | ✅ | ❌ | ❌ | Criar/alterar/revogar membership, motivo obrigatório; proteção do último Admin |
| `verification.view` | ✅ | ✅ | ✅ | Consultar fila/projeção minimizada; não implica ler selfie nem documento integral |
| `verification.review` | ✅ | ✅ | ❌ | Atuar no caso de revisão, sem incluir implicitamente aprovação/rejeição; definir se inclui claim/assignment antes de implementar |
| `verification.approve` | ✅ | ✅ | ❌ | Decidir aprovação pela RPC auditada |
| `verification.reject` | ✅ | ✅ | ❌ | Decidir rejeição pela RPC auditada e motivo obrigatório |
| `audit.view` | ✅ | ❌ | ❌ | Consultar audit trail paginado/minimizado |
| `audit.export` | ✅ | ❌ | ❌ | Exportar somente campos allowlisted, dentro de limites aprovados |
| `user.view` | ✅ | ✅ | ✅ | Consultar dados mínimos e mascarados; não equivale a leitura irrestrita |
| `user.flag` | ✅ | ✅ | ❌ | Registrar sinalização investigativa; não suspender, banir ou alterar conta |
| `system.settings` | ✅ | ❌ | ❌ | Acessar/alterar apenas configurações concretas allowlisted |
| `system.bootstrap` | ✅* | ❌ | ❌ | Somente procedure controlada de bootstrap/recuperação fora de banda; não expor endpoint de autoelevação |

`staff.authenticated` é precondição de acesso ao shell `/admin`, derivada da membership Staff ativa; não é permission para recursos e não deve ser adicionada como papel de marketplace.

**Conflito documental resolvido provisoriamente:** `SPRINT_3_2_AUTHORIZATION_LAYER_PLAN.md` e `ADMIN_ARCHITECTURE.md` anteriores dão a Support acesso de suporte minimizado e não de verificação, e não atribuem `user.view/user.flag` a Reviewer. O Prompt Mestre mais recente especifica Support `verification.view` e `user.view`, e Reviewer `user.view/user.flag`; este patch plan segue essa matriz explícita, mas restringe os campos e ações. A matriz final deve ser assinada antes da migration.

## 3. Decisões de contrato que bloqueiam endpoints específicos

1. **`verification.review`:** não há hoje entidade de caso, claim/assignment, endpoint ou estado de “reviewing”. Definir se a permission autoriza apenas abrir o caso, iniciar uma revisão exclusiva ou registrar nota; não a tratar como sinônimo de approve/reject. Se não existir operação separada, remover a capability redundante antes do seed.
2. **Dados vistos por Support/Reviewer:** definir colunas exatas de `verification.view` e `user.view`. Support recebe projeção mínima; selfie, CPF/RG, telefone/e-mail integral, GPS e mensagens não denunciadas permanecem negados por padrão. `verification.document.read` não consta da matriz atual; portanto a selfie não será visível nesta entrega sem nova decisão e controle dedicado.
3. **`user.flag`:** limitar a registrar um evento investigativo auditado. Não alterar `users`, estado da conta ou perfil. Definir formato/motivo e se basta o `admin_audit_log` ou se uma entidade de flags é necessária para consultar estado ativo.
4. **`system.settings`:** listar settings concretas, owners e validação. Não criar editor genérico nem endpoint que aceite chave/valor arbitrário. Se não houver settings concretas nesta Sprint, manter a capability no catálogo, mas não publicar tela/API até haver objeto de escopo aprovado.
5. **`system.bootstrap`:** fluxo fora de banda, operado sob runbook e credencial de deployment controlada; nunca aceitar promoção de si próprio por endpoint autenticado. `Admin possui todas` não torna bootstrap self-service.
6. **`audit.export`:** definir campos exportáveis, formatos, filtros, limite, retenção e armazenamento/destino. Nunca serializar `old_data/new_data` sem allowlist. Não iniciar export assíncrono sem controle de acesso ao artefato.
7. **`PERMISSION_DENIED`:** persistir negações sem possibilitar flood do log. Definir rate limit/limite de retenção e não executar o insert dentro de uma transação que será abortada pela exceção de autorização. A identidade vem de `auth.uid()`, nunca de payload.
8. **`PERMISSION_GRANTED`:** distinguir mudança de mapeamento versionada por migration (ator operacional identificável ou NULL com release/motivo) de grant humano. Não fabricar ator humano para seed automatizado.

Sem decisão para um desses itens, não implementar a superfície dependente; manter a capability negada e o endpoint/tela ausente.

## 4. Estado de entrada da Foundation e correções obrigatórias

### Já presente e a preservar

- `private.staff_members`, enums `staff_role`/`staff_status`, RLS e grants diretos revogados.
- `private.admin_audit_log`, append-only para UPDATE/DELETE e grants diretos revogados.
- `is_staff`, `is_admin`, `is_reviewer`, `is_support`, `get_staff_membership`, `list_staff_members`, `grant_staff_role`, `revoke_staff_role`.
- `proxy.ts` e `SessionGuard` validam membership Staff em separado do `AccountRole`.
- `/api/admin/staff/me`, listagem, grant/alteração e revoke; tela base `/admin`.
- Testes PGlite/API/E2E existentes.

### Corrigir no patch RBAC

1. **Bloquear rebaixamento do último Admin:** em `grant_staff_role`, ao alterar role de Admin ativo para Reviewer/Support, contar Admins ativos e impedir transição se deixar zero. Lock/concorrência devem manter a invariável atômica.
2. **Erro estável:** mapear a proteção do último Admin a HTTP 403 e body/código `LAST_ADMIN_PROTECTION`; não responder 409 genérico.
3. **Policies Staff:** confirmar estado remoto de grants/RLS. Manter DML direto negado; mutations via RPC. Remover ou ajustar policies INSERT/UPDATE que não são necessárias e podem sugerir que Admin possui escrita direta, sem ampliar privilégios.
4. **RBAC na fonte de verdade:** substituir guardas por array de papel por permission check no banco; manter helpers de papel existentes por compatibilidade e não remover RPCs.
5. **Sem cache:** validar Auth, membership e permission atual em cada request/API/RPC sensível; `staff/me` apenas informa a UI. Ação após revogação deve falhar na chamada seguinte.

## 5. Permission Engine e migrations propostas

Os nomes finais/timestamps devem seguir a CLI e o fluxo imperative do repositório depois de resolver o gate remoto. Os rótulos abaixo são planejamento, não nomes de arquivos a serem criados agora.

### Migration A — catálogo e matriz role-permission

- Criar tabelas privadas, por exemplo `private.staff_permissions` e `private.staff_role_permissions`, com PK/FK/unique constraints e chaves exatamente allowlisted.
- Seed versionado das capabilities e mapeamentos aprovados na seção 2.
- Sem grants diretos de leitura/escrita a `anon`/`authenticated`; sem exposição PostgREST do schema/tabelas.
- Preservar ENUM `private.staff_role`; não introduzir novos papéis nem mudar `public.users.role`.
- Se a equipe preferir matriz estática em função SQL, documentar por que não há catálogo consultável/versionado; não manter duas fontes diferentes.

### Migration B — helpers, context e RPCs RBAC

- `private.has_staff_permission(text)` ou equivalente deriva ator por `auth.uid()`, exige membership `active` e consulta a matriz vigente.
- RPC de contexto atual devolve somente role/status e permissions daquele usuário para UI; sem cache e sem listar outros membros.
- Adaptar `list_staff_members`, `grant_staff_role` e `revoke_staff_role` para verificar `staff.view`/`staff.manage` dentro da própria função; preservar atomicidade e validações existentes.
- Completar proteção de último Admin para revoke e mudança de papel, com erro de domínio estável.
- Criar RPC Admin-only paginada para leitura audit com filtros allowlisted; export requer contrato e limite separados.
- Não revogar nem substituir RPCs atuais. Se a função existente precisar de nova implementação, usar `CREATE OR REPLACE` compatível e manter assinatura/contrato até migração coordenada.

### Migration C — operações de domínio aprovadas

- Para decisões de verificação, criar RPC nova, por exemplo `review_profile_verification_staff(...)`, com capability interna `verification.approve` ou `verification.reject`, ator `auth.uid()`, motivo, optimistic concurrency (`expected_updated_at`) e audit event na mesma transação.
- Preservar `review_profile_verification(...)` e o grant existente de `service_role`; não conceder essa função existente a `authenticated` isoladamente.
- Criar RPC read-model paginada de verificação para `verification.view`, com projeção de campos definida por papel e sem acesso amplo a `worker_profiles`.
- Para `user.flag`, criar RPC que valide `user.flag` e registre evento allowlisted; não alterar estado da conta.
- Para `PERMISSION_DENIED`, adicionar mecanismo de evento de segurança com limite de taxa e actor derivado do banco, sem permitir escrita arbitrária na tabela de audit.
- Implementar tabela/settings RPC somente após aprovar nomes e limites de cada setting. Não criar generic KV arbitrário.

### Segurança obrigatória das funções

- Preferir `SECURITY INVOKER`. Quando necessário `SECURITY DEFINER`, validar ator/capability dentro da função, qualificar objetos, fixar `search_path`, conferir owner e revogar `EXECUTE` de `PUBLIC`/`anon` antes de grants mínimos.
- `SECURITY DEFINER` público é superfície de API; testar chamada direta como `anon`, usuário sem Staff e papel insuficiente.
- Não confiar em papel/capability/actor recebido do cliente.
- Confirmar privileges/default privileges no PostgreSQL remoto; policy RLS sem `GRANT` não concede acesso, e `GRANT` sem RLS não é autorização suficiente.

## 6. RLS e acesso a dados

| Recurso | Tratamento planejado |
|---|---|
| `private.staff_members` | Manter schema privado, RLS e grants diretos negados; consultar/alterar só por RPCs estreitas. Policies atuais Admin SELECT/INSERT/UPDATE não substituem grants nem autorização por capability |
| `private.admin_audit_log` | Manter append-only e sem SELECT direto; leitura/export exclusivamente por RPC/API `audit.view`/`audit.export`, paginada e allowlisted |
| Catálogo RBAC | Schema privado, grants diretos negados, seed em migration; somente helpers de banco resolvem roles→permissions |
| `public.users` | Não mudar `role`; `user.view` por projection/API específica, seleção de colunas permitidas e mascaramento; respeitar grants por coluna e validar remote RLS |
| `worker_profiles` | RLS atual é owner; não adicionar policy geral `is_staff()`. Acessar fila via RPC read-model específica |
| `storage.objects`/`worker-private` | Preservar policies do dono e restrições da selfie. Nenhuma permissão de Support para documentos; acesso Reviewer/Admin a selfie requer aprovação explícita e endpoint de URL assinada curta, finalidade e log |
| Jobs, applications, chat, pagamentos, reviews | Não adicionar autorização ampla Staff; usar flows e RLS de domínio atuais |

Testar grants efetivos e RLS separadamente. A mudança RBAC não pode ampliar a política de `users_select_authenticated_directory` nem os grants de colunas por conveniência.

## 7. Guards de rota, APIs e telas

### Rotas de página

| Página | Regra |
|---|---|
| `/admin` | Sessão válida + membership Staff ativa; não consulta `users.role` para identificar Staff |
| `/admin/staff` | `staff.view`; ações grant/change/revoke exigem `staff.manage` |
| `/admin/audit` | `audit.view`; export da página também exige `audit.export` |
| `/admin/verifications` | `verification.view`; botões e endpoints de decisão verificam capabilities independentes |
| `/admin/settings` | `system.settings`; implementar somente settings concretas aprovadas |
| `/admin/users` | `user.view`; listagem mínima/mascarada; sinalização exige `user.flag` |

`proxy.ts` deve continuar sendo gate de autenticação/membership para o namespace e pode fazer gating de capability por pathname se isso não criar lógica divergente; além disso, cada página protegida deve ter guard server-side ou fonte de dados que revalide a capability. O menu é uma conveniência de UX, nunca a barreira de segurança. `SessionGuard` não deve receber Staff como `AccountRole`.

### APIs

| Endpoint | Capability | Observação |
|---|---|---|
| `GET /api/admin/staff/me` | Staff ativa (contexto próprio) | Estender retorno para capabilities allowlisted |
| `GET /api/admin/staff` | `staff.view` | Paginação limitada e campos mínimos |
| `POST /api/admin/staff` | `staff.manage` | Origem validada, motivo e role allowlisted |
| `POST /api/admin/staff/[id]/revoke` | `staff.manage` | Motivo; proteção de self/último Admin e erro estável |
| `GET /api/admin/verifications` | `verification.view` | RPC read-model; projeção por papel, sem documento |
| `POST /api/admin/verifications/[id]/approve` | `verification.approve` | Nova RPC segura, motivo/concorrência/audit |
| `POST /api/admin/verifications/[id]/reject` | `verification.reject` | Nova RPC segura, motivo obrigatório/audit |
| `GET /api/admin/audit` | `audit.view` | Paginação/filtros allowlisted, sem cache |
| `POST /api/admin/audit/export` | `audit.export` | Aguardar política de formato/campos/destino/limites |
| `GET /api/admin/users` | `user.view` | Campos mínimos e mascarados por papel |
| `POST /api/admin/users/[id]/flag` | `user.flag` | Registra sinalização auditada; sem mudar conta |
| `/api/admin/settings` (método a definir) | `system.settings` | Só depois de inventariar settings concretas; sem endpoint genérico |

Todas as APIs validam sessão, membership/capability no backend, entrada, limites e origem em mutações. Erro de Auth/DB é fail-closed; indisponibilidade não vira success-shaped fallback. `proxy.ts` não protege APIs por si só.

### Telas/componentes

- Estender `app/admin/layout.tsx` com shell/nav por capability, sem ser a fronteira de segurança.
- Atualizar `app/admin/page.tsx` para usar contexto de autorização e links permitidos.
- Criar `app/admin/staff/page.tsx`, `app/admin/audit/page.tsx`, `app/admin/verifications/page.tsx`, `app/admin/settings/page.tsx` e `app/admin/users/page.tsx` apenas para superfícies aprovadas.
- Implementar confirmação/motivo para mutações; mensagem distinta para 401, 403, 409 de concorrência e 503 de dependência.
- Evitar que tabelas/listas ou exportação apresentem `old_data/new_data` integral, CPF/RG, selfie, contato completo ou conteúdo não necessário.

## 8. Lista final de arquivos a alterar/criar

Esta é a lista consolidada de patch planejado. Paths de migration usam `<timestamp>` até a CLI gerar o nome. Testes serão alterados/criados somente durante implementação futura; nenhum teste foi modificado nesta etapa.

### Modificar

1. `proxy.ts` — membership do shell e integração de guards por sub-rota.
2. `app/components/session-guard.tsx` — somente se necessário para alinhar UX/revalidação; não transformar em autorização principal.
3. `app/admin/layout.tsx` — shell e menu filtrado por permissions.
4. `app/admin/page.tsx` — contexto de permissions e navegação.
5. `lib/auth/staff-access.ts` — tipo/normalização do catálogo e contexto Staff.
6. `lib/auth/staff-api.ts` — guard por capability, código estável de erro e no-cache.
7. `app/api/admin/staff/me/route.ts` — devolver contexto próprio incluindo permissions.
8. `app/api/admin/staff/route.ts` — GET `staff.view`, POST `staff.manage`.
9. `app/api/admin/staff/[id]/revoke/route.ts` — `staff.manage`, contrato de erro último Admin.
As migrations 3.0.1 existentes — em especial `supabase/migrations/20261110030000_staff_functions.sql` — são baseline a inspecionar, não arquivos a editar. Toda correção de comportamento deve ser forward-only em uma migration nova; nunca reescrever migration já aplicada.

### Criar — UI/APIs

10. `app/admin/staff/page.tsx`
11. `app/admin/audit/page.tsx`
12. `app/admin/verifications/page.tsx`
13. `app/admin/settings/page.tsx` (condicional à definição de settings)
14. `app/admin/users/page.tsx`
15. `app/api/admin/verifications/route.ts`
16. `app/api/admin/verifications/[id]/approve/route.ts`
17. `app/api/admin/verifications/[id]/reject/route.ts`
18. `app/api/admin/audit/route.ts`
19. `app/api/admin/audit/export/route.ts` (condicional à política de export)
20. `app/api/admin/users/route.ts`
21. `app/api/admin/users/[id]/flag/route.ts`
22. `app/api/admin/settings/route.ts` (condicional a settings concretas)
23. Opcional `app/admin/components/admin-navigation.tsx` se a navegação não couber no layout existente.

### Criar — banco

24. `supabase/migrations/<timestamp>_staff_permissions_catalog.sql`
25. `supabase/migrations/<timestamp>_staff_permission_functions.sql`
26. `supabase/migrations/<timestamp>_staff_admin_audit_read.sql`
27. `supabase/migrations/<timestamp>_staff_verification_authorization.sql`
28. `supabase/migrations/<timestamp>_staff_user_flags.sql` (somente se a decisão de `user.flag` exigir persistência além do evento append-only)
29. `supabase/migrations/<timestamp>_staff_settings.sql` (somente após catálogo concreto de settings)

Cada migration depende do gate de schema e deve ser gerada pelo procedimento/CLI do projeto, revisada e aplicada em ambiente isolado/staging antes de produção. Não duplicar `staff_members` ou `admin_audit_log`.

### Criar/modificar — testes

30. `tests/staff-members.sql.test.mjs` — ampliar matriz da Foundation, incluindo rebaixamento do último Admin.
31. `tests/admin-api.test.mjs` — capability por rota, erros estáveis, export/users/settings quando habilitados.
32. `tests/auth-proxy.test.mjs` — page gating por capability e acesso não Staff.
33. `tests/auth-routes.test.mjs` — regras de path `/admin` sem alterar papel de conta.
34. `tests/staff-rbac.sql.test.mjs` — novo teste de catálogo, permission helper, grants/RLS, decisão verificação e audit (separar responsabilidades se ficar grande).
35. `tests/e2e/admin-access.spec.ts` — acrescentar Reviewer, Support, acesso direto a sub-rotas e menus por papel.
36. `tests/e2e/admin-authorization.spec.ts` — novo teste da matriz completa, concessão/revogação e negações.

Não editar `package.json` se as ferramentas/scripts existentes atenderem; adicionar tooling só se uma lacuna real for demonstrada.

## 9. Plano de teste e aceitação

### Testes SQL/RLS/RPC

- Matriz para `anon`, Worker, Restaurant, Admin, Reviewer, Support, membership ausente, `disabled` e `revoked`.
- Testar chamada direta de cada RPC e acesso direto às tabelas privadas, sem passar por Next.js.
- `staff.view/manage`, verification view/review/approve/reject, audit view/export, user view/flag, settings/bootstrap: permitido apenas na matriz aprovada.
- Confirmar grants e RLS separadamente, schema privado não exposto, `EXECUTE` de `SECURITY DEFINER` restrito, `search_path` seguro e fail-closed.
- Concessão, mudança de papel e audit event atômicos; erro ao escrever audit cancela mutação.
- Bloquear remoção **ou rebaixamento** do último Admin; endpoint responde `403 LAST_ADMIN_PROTECTION`.
- Verificar `PERMISSION_DENIED`, `PERMISSION_GRANTED`, `STAFF_GRANTED`, `STAFF_REVOKED`, `ROLE_CHANGED` sem falso actor, payload sensível ou flood sem limite.
- Verificar revogação na próxima chamada usando consulta atual, não claims ou cache.
- Verificar funções antigas preservadas, incluindo a chamada service-role existente de revisão.

### API/UI/E2E

- 401 para JWT ausente/inválido; 403 para membership/capability insuficiente; 503 para indisponibilidade de Auth/DB.
- Worker/Restaurant em `/admin` e APIs; Reviewer/Support tentando gerir Staff; Support tentando aprovar/rejeitar; qualquer papel sem permission tentando URL direta/API/RPC.
- Menus escondidos sem permission e backend continua negando chamada direta.
- CSRF/origin, JSON inválido, UUID inválido, paginação, motivo vazio/maior que limite, erro concorrente e resposta no-store.
- Audit view/export minimizados e allowlisted; PII/selfie/dados de `old_data/new_data` não escapam.
- Rodar `npm test`, `npm run typecheck`, `npm run build` e Playwright em staging; status verde é critério de aceite, não resultado presumido.
- Regressão Worker/Restaurant: login/cadastro, perfil, jobs, applications, chat, check-in/out, reviews, envio próprio de verificação e políticas RLS atuais.

## 10. Ordem de execução

1. **Gate de branch e schema:** confirmar commit 3.0.1 aprovado, snapshot remoto read-only, migration history, DDL/grants/RLS/owners e estado aplicado das três migrations Staff.
2. **Revisão do plano:** assinar matriz de permissões; fechar semântica de `verification.review`, user flag, settings/bootstrap, export e auditoria de negações.
3. **Revisão de segurança:** analisar helpers `SECURITY DEFINER`, ACLs, grants diretos/policies Staff, RLS de users/profiles/Storage e correção do último Admin.
4. **Teste RBAC local isolado:** construir fixture e validar matriz/ACL sem aplicar nada em remoto.
5. **Migration A:** catálogo e mappings versionados; testar em banco descartável, depois staging; comparar grants/RLS e confirmar não exposição.
6. **Migration B:** permission helpers/contexto, compatibilidade RPCs e guarda transacional do último Admin.
7. **Staff API e shell:** migrar role checks a `staff.view/manage`, menus e páginas Staff; acesso direto protegido.
8. **Audit read/export:** habilitar somente após allowlist, paginação, limites e retenção aprovados.
9. **Verification/users/settings:** implementar em superfícies separadas; cada uma depende das decisões de seção 3 e validação da RPC no banco.
10. **Testes completos e staging:** API/RPC/E2E, regressões, typecheck/build; testar revogação e recovery/bootstrap.
11. **Rollout canário e PR:** validar logs/eventos e rollback operacional; PR aprovado/mergeado é etapa de entrega posterior, não parte deste documento.

## 11. Riscos e mitigação

| Risco | Severidade | Mitigação |
|---|---|---|
| Schema remoto e history não reconciliados | Crítica | Não aplicar migration até fechar snapshot/diff |
| Rebaixamento do último Admin por `grant_staff_role` | Crítica | Corrigir invariável transacional e testar alteração de role |
| `SECURITY DEFINER` com capability checada só no Next.js | Crítica | Revalidar permission dentro de cada RPC e limitar ACL |
| Support visualizar selfie/PII por interpretação ampla de `view` | Crítica | Projeções explícitas, mascaramento e nenhuma autorização Storage implícita |
| Export de audit vazar PII/segredos | Alta | Campos allowlisted, limites, razão/log e política de destino |
| `PERMISSION_DENIED` possibilitar flood | Alta | Rate-limit/limite de volume, log estruturado e desenho transacional seguro |
| Tabela `users` ou `worker_profiles` exposta por policy Staff genérica | Crítica | Não criar policy ampla; RPC/read-model específica e regressão RLS |
| Settings/bootstrap genéricos permitirem configuração arbitrária/elevação | Crítica | Settings allowlisted; bootstrap fora de banda, sem endpoint self-service |
| Menu filtrado confundido com autorização | Alta | Guard por rota, API e RPC; testes de acesso direto |
| Documentação anterior contraditória | Média | Atualizar as duas discoveries para considerar arquitetura anterior como histórico, não fonte do estado atual |

## 12. Rollback

1. Reverter deployment de aplicação/admin shell e desabilitar endpoints novos; manter o comportamento de membership Staff 3.0.1 se não comprometido.
2. Revogar grants `EXECUTE` novos de capabilities/read/export/verification/settings; verificar negação por chamada RPC direta.
3. Desabilitar links/telas e interromper emissões de export/URL temporária; deixar usuários Worker/Restaurant e envio de verificação próprios intactos.
4. Preservar `staff_members`, `admin_audit_log`, catálogo e eventos; não executar DROP/TRUNCATE nem apagar evidência.
5. Se o RBAC bloquear o último Admin, usar procedimento de break-glass previamente aprovado, fora da API normal, documentando ator, motivo e intervenção.
6. Corrigir migration com forward-only após novo snapshot; não editar migration já aplicada nem executar rollback destrutivo em produção.
7. Revalidar auth, Worker/Restaurant, APIs não administrativas e `review_profile_verification` service-role.

## 13. Critérios de aceite

- Catálogo central contém permissions aprovadas e mapeamento role→permission coerente entre banco, APIs e UI.
- `public.users.role` continua somente `worker`/`restaurant`; sem alteração em `AccountRole`.
- `/admin` exige sessão e membership; páginas e APIs exigem capability específica; RPCs revalidam permission internamente.
- Admin/Reviewer/Support obedecem matriz; acesso a dados é minimizado por campo e finalidade.
- Último Admin não pode ser revogado nem rebaixado; contrato HTTP é 403 `LAST_ADMIN_PROTECTION`.
- Auth/membership/capabilities sem cache; revogação efetiva na próxima requisição sensível.
- Concessões, revogações, mudanças de papel e operações administrativas são auditadas; leitura/export restritos e audit log append-only.
- Worker/Restaurant não ganham acesso Staff nem sofrem regressões em fluxos/RLS.
- SQL/API/E2E, `npm test`, typecheck e build aprovados; banco-alvo reconciliado e staging validado.
- PR aprovado e mergeado antes de declarar Sprint concluída.

## 14. Estado deste patch plan

Discovery reexecutada no checkout que contém o merge da Sprint 3.0.1. O plano está pronto para implementação **somente após os gates da seção 1/3/10**. Nenhum código, migration ou teste foi alterado ao gerar este documento.
