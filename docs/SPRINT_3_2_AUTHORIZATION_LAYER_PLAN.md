# ExtraChef — Sprint 3.0.2: Authorization Layer

**Plano técnico — não implementar nem aplicar migrations como parte deste documento**  
**Data-base: 9 de novembro de 2026**

## 1. Objetivo

Evoluir a Foundation Staff da Sprint 3.0.1 para uma autorização administrativa baseada em capacidades, com separação explícita entre `admin`, `reviewer` e `support`. A autorização deve ser aplicada em cada API, RPC e operação de dados; a proteção de páginas em `proxy.ts` é uma camada adicional, não substitui controles de backend.

Esta Sprint define a infraestrutura RBAC e os limites das interfaces administrativas. Não inclui a implementação do painel de verificação, gestão geral de usuários, moderação, disputas, exclusão assistida ou concessão de acesso irrestrito às tabelas de marketplace.

## 2. Estado-base e limites conhecidos

A implementação Foundation existente estabelece:

- `private.staff_members`, com um papel Staff por usuário e estados `active`, `disabled` e `revoked`; `public.users.role` permanece separado e restrito ao marketplace (`worker`/`restaurant`). Ver `supabase/migrations/20261110010000_staff_foundation.sql`.
- `private.admin_audit_log`, RLS habilitada e proteção contra `UPDATE`/`DELETE`; sem leitura direta concedida a papéis da aplicação. Ver `supabase/migrations/20261110020000_admin_audit_log.sql`.
- Helpers `is_staff`, `is_admin`, `is_reviewer`, `is_support`, `get_staff_membership`, `list_staff_members`, `grant_staff_role` e `revoke_staff_role`. As RPCs de concessão/revogação validam Admin e gravam evento na mesma transação. Ver `supabase/migrations/20261110030000_staff_functions.sql`.
- `/admin` usa membership Staff em `proxy.ts`; `/api/admin/staff/**` valida sessão e papel individualmente; as rotas atuais permitem gestão de memberships somente a Admin. Ver `lib/auth/staff-api.ts`, `app/api/admin/staff/**` e `app/admin/**`.
- A tela atual é apenas uma página de estado da membership. Não é um painel operacional.

**Gate de banco:** `docs/DATABASE_CANONICAL_SCHEMA.md` registra que o baseline remoto e o histórico aplicado continuam parciais. Antes de qualquer migration desta Sprint, reconciliar o ambiente-alvo e validar existência, grants, RLS, ownership e assinaturas das funções já implantadas. Não presumir que a branch ou o histórico local comprovam o estado do banco remoto.

## 3. Princípios de autorização

1. **Negação por padrão:** uma capacidade não concedida explicitamente é negada.
2. **Identidade humana:** derivar o ator da sessão validada e `auth.uid()`; nunca aceitar `actor_user_id`, papel ou capability do corpo HTTP como prova de autorização.
3. **Isolamento de papéis:** não alterar `public.users.role`, `AccountRole`, políticas de cadastro de contas ou regras de Worker/Restaurant para representar Staff.
4. **Checagem em cada camada:** página, API e RPC/consulta privilegiada validam o escopo necessário. Não confiar apenas em middleware, ocultação de componentes ou no cliente.
5. **Menor privilégio e minimização:** dados pessoais e documentos não são liberados pela simples condição de Staff. Cada campo sensível e cada ação de leitura exigem uma capacidade própria, finalidade e trilha de auditoria.
6. **Sem autorização via claims editáveis ou cache de papel:** a membership/capability efetiva é conferida no banco no momento da operação, de modo que revogações produzam efeito na próxima requisição.
7. **Service role não é RBAC:** operações humanas continuam vinculadas à sessão e ao ator; credencial privilegiada, se indispensável no backend, não substitui a validação do Staff.
8. **Auditoria transacional:** mutação administrativa e evento correspondente devem confirmar ou falhar juntos. A leitura de dados sensíveis também gera evento antes de emitir ou devolver o dado.

## 4. Modelo RBAC proposto

### 4.1 Capacidades

Usar capabilities estáveis e específicas da ação, em vez de espalhar verificações de nomes de papéis pelo código:

| Capability | Finalidade | Disponibilidade nesta Sprint |
|---|---|---|
| `staff.access.self` | Consultar papel/estado próprios | Já existe como comportamento de `/api/admin/staff/me`; formalizar no RBAC |
| `staff.members.read` | Listar memberships Staff | Já existe em `GET /api/admin/staff`; restringir a Admin |
| `staff.members.manage` | Conceder, alterar ou revogar papel Staff | Já existe nas RPCs/APIs atuais; restringir a Admin e manter proteção contra autoalteração e remoção do último Admin |
| `admin.audit.read` | Consultar eventos de auditoria administrativa | Nova capacidade, Admin apenas; leitura paginada via RPC/API |
| `verification.queue.read` | Consultar fila de verificações pendentes | Definir permissão para Reviewer e Admin; API/painel de verificação ficam para sprint posterior |
| `verification.case.read` | Ver dados mínimos de um caso de verificação | Admin e Reviewer, com minimização |
| `verification.decision.write` | Aprovar/rejeitar uma verificação | Admin e Reviewer, via operação auditada e controle de concorrência |
| `verification.document.read` | Acessar selfie/documento original para revisão | Admin e Reviewer; finalidade obrigatória, URL curta e evento de acesso |
| `support.case.read` | Consultar dados mínimos necessários para suporte | Support e Admin; sem acesso a selfie, CPF/RG completos ou conteúdo de chat não denunciado |
| `support.case.note.write` | Registrar nota interna em atendimento, sem alterar dados do usuário | Support e Admin; somente se o modelo de casos for aprovado e criado em outra fase |

O catálogo acima é uma proposta para governar o desenvolvimento subsequente, não afirma que essas operações já existem. Capacidades de verificação e suporte só podem ser atribuídas a endpoints quando estes forem implementados e tiverem seus contratos de dados aprovados.

### 4.2 Matriz de autorização

| Área/ação | Admin | Reviewer | Support | Worker/Restaurant/anônimo |
|---|---:|---:|---:|---:|
| Consultar a própria membership (`staff.access.self`) | Sim | Sim | Sim | Não |
| Listar memberships Staff (`staff.members.read`) | Sim | Não | Não | Não |
| Conceder, alterar e revogar memberships (`staff.members.manage`) | Sim | Não | Não | Não |
| Consultar audit trail (`admin.audit.read`) | Sim | Não | Não | Não |
| Consultar fila e dados mínimos de verificação | Sim | Sim | Não | Não |
| Decidir verificação (aprovar/rejeitar) | Sim | Sim | Não | Não |
| Visualizar selfie/documento original (`verification.document.read`) | Sim, com finalidade/log | Sim, com finalidade/log | Não | Não |
| Consultar dados mínimos para suporte | Sim | Não | Sim, com escopo limitado | Não |
| Alterar perfil, papel de marketplace ou situação de conta | Não nesta Sprint | Não | Não | Conforme fluxos atuais do próprio usuário |
| Ler/alterar dados de jobs, applications, chat, pagamentos ou avaliações por acesso genérico de Staff | Não | Não | Não | Conforme RLS de domínio atual |

**Regra de segregação:** Admin é capaz de administrar a camada Staff e possui as capacidades operacionais acima para continuidade; Reviewer opera exclusivamente em verificações; Support opera somente em uma futura superfície de atendimento minimizada. Nenhum papel recebe `service_role`, acesso SQL ou leitura ampla a tabelas pelo fato de ser Staff.

### 4.3 Representação no banco

Adicionar catálogo controlado de capabilities e relação role-capability em schema privado, ou mecanismo equivalente aprovado após a reconciliação. O catálogo e as atribuições devem ser versionados em migration, com constraints/keys que impeçam capabilities desconhecidas e duplicadas.

- A fonte de verdade de RBAC deve ser o banco; não manter uma matriz diferente e independente na UI.
- Um helper privado, por exemplo `private.has_staff_permission(text)`, deve derivar a identidade por `auth.uid()`, exigir membership ativa e resolver a capability atribuída ao papel.
- Uma RPC de contexto atual pode devolver o papel e uma lista allowlisted de capabilities próprias para renderização da interface. A lista é apenas UX; endpoints repetem a checagem no banco.
- Não aceitar capability, role ou target user informado pelo browser como condição suficiente.
- Toda RPC `SECURITY DEFINER` nova ou alterada deve ter owner, `search_path` vazio/fixo, `EXECUTE` revogado de `PUBLIC`/`anon`, grants mínimos e teste de chamada direta. Preferir `SECURITY INVOKER` quando a operação não exigir acesso controlado a schema privado.
- Verificar como o PostgREST expõe schemas e como o cliente da aplicação invoca funções existentes. Não tornar tabelas do catálogo acessíveis pelo Data API para evitar enumerar ou modificar permissões diretamente.

## 5. RLS e privilégios

### 5.1 Tabelas Staff e audit trail

- Preservar RLS em `private.staff_members` e `private.admin_audit_log`.
- Manter revogados os grants diretos de `anon`, `authenticated` e `service_role` nas tabelas privadas, salvo privilégio estritamente necessário validado no desenho final.
- Rever as policies existentes de `staff_members` (Admin SELECT/INSERT/UPDATE): policies não conferem privilégio de tabela. Como o desenho Foundation já canaliza mudanças pelas RPCs auditadas, preferir retirar policies de mutação direta ou restringi-las ao padrão efetivamente suportado, sem habilitar DML direto para `authenticated`.
- Não criar policy de escrita no audit log. Inserções continuam somente por operação controlada no banco; nenhuma rota atual deve permitir edição/exclusão.
- Para leitura de audit log, disponibilizar RPC paginada, limitada a Admin, com filtros allowlisted e campos minimizados. Não conceder `SELECT` direto à tabela.
- Confirmar que tabelas e funções do schema `private` não são expostas por configuração PostgREST.

### 5.2 Dados de verificação e domínio

- Não adicionar policy ampla `USING (is_staff())` a `worker_profiles`, `storage.objects`, `jobs`, `applications`, chat, pagamentos ou avaliações.
- Não conceder `SELECT` direto a `authenticated` sobre selfie ou documentos. Acesso à mídia deve usar endpoint server-side de emissão de URL assinada curta, protegido por `verification.document.read`, com registro do ator, alvo, motivo e identificador do objeto.
- Leitura de CPF/RG deve retornar máscara por padrão. Se for aprovada a exibição integral em casos específicos, tratar como uma capability separada, exigir justificativa e auditar cada revelação.
- A fila deve retornar apenas os campos necessários, sem selfie, CPF/RG, telefone ou e-mail em forma integral.
- Reutilizar RPCs e policies de domínio sem expandir suas autorizações implicitamente. A RPC de decisão de verificação e a guarda que hoje limita a decisão ao contexto `service_role` requerem desenho próprio de autorização/auditoria antes de serem habilitadas para usuários Staff.
- Não alterar policies de Worker/Restaurant em operações de marketplace. Registrar snapshot anterior/posterior e executar testes de regressão RLS em tabelas afetadas.

## 6. Migrations e RPCs

### 6.1 Migrations previstas

Os nomes abaixo são rótulos de planejamento, não nomes finais. O fluxo imperative de migrations deve gerar timestamps/nome conforme o padrão do repositório, após o gate de schema.

| Ordem | Conteúdo | Observações |
|---|---|---|
| A | Catálogo de capabilities e relação de capabilities por papel | Seed versionado das permissões aprovadas; restrições de unicidade e FKs; nenhuma mudança em `public.users.role` |
| B | Helpers/RPCs de contexto e verificação de capability | `has_staff_permission` e contexto mínimo do ator; ACLs explícitas, `auth.uid()` e fail-closed |
| C | RPC de leitura paginada de audit trail | Admin-only, filtros permitidos, limite máximo, sem payloads secretos; leitura registrada se a política final exigir auditoria de consultas |
| D | RPCs de negócio administrativo autorizadas para o escopo aprovado | Converter a autorização da operação de verificação para capabilities apenas quando o contrato de decisão for implementado; alteração separada/revisada, não conceder `EXECUTE` aberto |

Não reaplicar as migrations Foundation. Verificar no ambiente se objetos equivalentes já existem e comparar definições/grants antes de qualquer `CREATE` ou `ALTER`.

### 6.2 RPCs a preservar e avaliar

- Preservar `get_staff_membership`, `list_staff_members`, `grant_staff_role` e `revoke_staff_role`; devem passar a usar capabilities equivalentes sem enfraquecer as validações transacionais e de último Admin.
- Preservar `is_staff`, `is_admin`, `is_reviewer`, `is_support` como helpers de compatibilidade enquanto houver consumidores. Não basear decisões novas apenas no nome do papel.
- Inventariar todas as funções existentes que consultam `staff_members`, `worker_profiles`, `storage.objects` ou alteram `verification_status`. As assinaturas e grants efetivos devem ser verificados no catálogo remoto após resolver o baseline.
- Não remover, renomear ou trocar permissões de RPCs existentes sem plano de migração compatível e testes de contrato.

## 7. APIs e rotas

### 7.1 APIs existentes a adaptar

| Endpoint | Regra proposta |
|---|---|
| `GET /api/admin/staff/me` | Autenticado; retorna papel/status e capabilities para UI, sem enumerar outros membros |
| `GET /api/admin/staff` | Requer `staff.members.read`; apenas Admin; manter paginação limitada e sem e-mail/PII desnecessária |
| `POST /api/admin/staff` | Requer `staff.members.manage`; apenas Admin; origem validada, papel allowlisted, razão obrigatória, RPC revalida o ator |
| `POST /api/admin/staff/[id]/revoke` | Requer `staff.members.manage`; apenas Admin; preservar proteções de auto-revogação e último Admin |

O helper de API `authorizeStaffApi` deve aceitar uma capability concreta em vez de uma lista ad hoc de papéis, preservando uma transição compatível para os endpoints existentes. Falhas de resolução de sessão ou permissão devem responder sem conteúdo sensível e falhar fechadas.

### 7.2 APIs novas do escopo de autorização

- `GET /api/admin/audit`: lista paginada de audit events para Admin, com intervalo temporal/ator/ação allowlisted; não aceitar filtros SQL livres nem retornar dados sensíveis em `old_data`/`new_data`.
- `GET /api/admin/authorization/me` ou extensão equivalente de `/staff/me`: contexto para navegação e controle de visibilidade da UI. Evitar endpoints duplicados se `/staff/me` já puder cumprir o contrato.
- APIs da fila, decisão e emissão de URL de documentos **não fazem parte da entrega funcional desta Sprint**. O plano fixa suas exigências para a sprint que implementar o Verification Review Panel: cada rota deve aplicar respectivamente `verification.queue.read`, `verification.decision.write` e `verification.document.read`, com validação duplicada na RPC/servidor e trilha apropriada.
- APIs de Support dependem de um modelo/casos de atendimento aprovado. Não criar endpoints de gestão de contas por inferência do papel `support`.

Todas as APIs administrativas validam autorização própria, sessão, origem em mutações, formato/tamanho de entrada, paginação, respostas sem cache e tratamento explícito de erro. O matcher do `proxy.ts` não protege `/api/**`.

## 8. Telas e UX

### Incluídas nesta Sprint

1. **Admin shell (`/admin`)**: navegação baseada em capabilities recebidas do servidor; páginas/links não autorizados não são renderizados, mas permanecem protegidos no servidor.
2. **Acesso Staff**: ampliar a página atual para mostrar papel e estado, com estados explícitos de carregamento/erro e sem transformar `staff/me` em endpoint público.
3. **Gestão de Staff**: interface Admin para listar membros, conceder/alterar e revogar papel, com confirmação e motivo obrigatório; operação deve ser idempotente ou apresentar conflito claramente.
4. **Audit trail**: página Admin somente leitura com paginação, filtros limitados, timestamps e ator/ação/alvo; ocultar dados brutos que possam conter PII.
5. **Acesso negado**: página/mensagem consistente para Staff sem capability e resposta 403 apropriada para usuário autenticado sem Staff; falhas de dependência diferenciadas como indisponibilidade, não como sucesso vazio.

### Preparadas, mas adiadas

- **Verification Review Panel**: fila, detalhe minimizado, visualização temporária da selfie/documento, decisão/rejeição e estados de concorrência. Depende de `verification.*` e de uma política de retenção/acesso revisada.
- **Support workspace**: busca de atendimento e registro de notas; depende de entidade de caso, escopo de dados e retenção definidos. Não habilitar consulta ampla de usuários.
- Não criar dashboard de métricas, moderação, disputas ou gestão geral de usuários nesta Sprint.

## 9. Plano de testes

### 9.1 Matriz de autorização

Executar cada capability sob `anon`, `worker`, `restaurant`, Admin, Reviewer, Support e Staff revogado/desabilitado:

- validar positivos somente para combinações aprovadas na matriz;
- testar acesso direto a página, API, RPC e consulta Storage, não apenas controles da UI;
- confirmar que mudar `staff_role`/`status` no payload, query string ou headers não altera o resultado;
- confirmar que usuário autenticado sem Staff obtém 403 nas superfícies Staff, enquanto usuário sem sessão recebe 401/redirect coerente;
- simular RPC/Auth indisponível e confirmar negação (503), sem fallback para `users.role`.

### 9.2 Banco/RLS/RPC

- Testar roles/grants reais e RLS para `staff_members`, catálogo RBAC e `admin_audit_log`; confirmar que policies não criam acesso sem grants.
- Tentar SELECT/INSERT/UPDATE/DELETE diretos como `anon` e `authenticated`; todas as operações não previstas devem falhar.
- Chamar RPCs diretamente, ignorando Next.js, como cada papel e sem sessão.
- Verificar reason obrigatório, role/capability inválida, paginação fora do limite, membro revogado e concorrência de concessão/revogação.
- Confirmar atomicidade de atualização e audit event; provocar falha na escrita de audit e comprovar rollback da operação.
- Confirmar que nenhum papel pode editar/excluir histórico, conceder papel Staff exceto Admin, autoelevar-se ou remover o último Admin.
- Verificar grants/default privileges e `search_path` das funções, inclusive execução anônima e em funções `SECURITY DEFINER`.

### 9.3 APIs/UI e regressão

- Testes unitários da matriz e helper `authorizeStaffApi`; contrato de `/staff/me`, listagem, concessão, revogação e audit.
- API negativa: sem cookie, sessão expirada, usuário sem Staff, papel insuficiente, origem externa, JSON inválido, ID inválido, erro de Auth/RPC.
- E2E por papel para navegação, acesso direto a URL, formulários Admin, confirmação, erro de conflito e estados vazios.
- Verificar mascaramento de PII, ausência de `old_data`/`new_data` sensível no audit API, `Cache-Control: no-store` e ausência de dados em logs.
- Regressão das rotas e fluxos existentes: login, cadastro, Worker, Restaurant, jobs, applications, chat, check-in/out, reviews, privacidade e envio de verificação.
- Executar testes focados, `npm test`, `npm run typecheck`, `npm run build` e testes E2E em staging. Registrar que PGlite não substitui validação das ACL/RLS no PostgreSQL/Supabase real.

## 10. Ordem de execução

1. **Reconciliar schema e branch de destino:** snapshot read-only do ambiente, migration history, grants/RLS/owners e inventário das RPCs; resolver os itens pendentes de `DATABASE_CANONICAL_SCHEMA.md` e `SCHEMA_DIFF_REPORT.md`.
2. **Aprovar matriz e privacidade:** aprovar capacidades, campos visíveis, tratamento de dados sensíveis, logging, retenção e operadores do piloto.
3. **Testar modelo RBAC isoladamente:** fixture de banco local descartável, matriz de roles, privilégios, negações e concorrência.
4. **Aplicar migration A em ambiente isolado:** catálogo e mapeamento de capacidades; verificar que objetos não são expostos.
5. **Aplicar migration B:** helper/contexto e ACL; executar testes de chamadas diretas.
6. **Migrar autorização de APIs existentes:** substituir checks por papel por capabilities equivalentes; preservar contratos e testar chamadas diretas.
7. **Adicionar audit read path:** RPC paginada Admin-only e endpoint; provar que leitura não expõe payloads pessoais nem permite alteração.
8. **Entregar telas de gestão/auditoria:** somente após APIs e permissões estarem validadas; confirmar 403/empty/error states.
9. **Staging/canário:** bootstrap validado, criar Admin/Reviewer/Support de teste; testar concessão/revogação imediata, auditoria, regressão operacional e logs.
10. **Produção:** rollout controlado após aprovação de segurança; monitorar negações/erros, confirmar audit events e plano de retorno antes de ampliar acesso.

## 11. Riscos e mitigação

| Risco | Severidade | Mitigação |
|---|---|---|
| Banco remoto e migrations locais divergentes | Crítica | Não aplicar migration até snapshot e comparação do ambiente-alvo |
| Helper RBAC virar bypass por `SECURITY DEFINER`/grants padrão | Crítica | Schema/owner/search_path/ACL explícitos; validar identidade dentro da função; teste direto por role |
| Policy `authenticated` interpretada como autorização suficiente | Crítica | Grants mínimos mais predicate de capability; provar acesso direto negado |
| Acesso Staff genérico a `worker_profiles`/selfies | Crítica | Sem policy ampla; RPC/API específica, minimização, propósito e audit event |
| Endpoint API confiando somente no `proxy.ts` | Alta | Guard por endpoint e validação no banco; teste de chamada direta |
| Matriz duplicada ou divergente entre UI e banco | Alta | Banco como fonte de verdade; contexto de UI é apenas informativo |
| Revogação não refletida até expirar JWT | Alta | Resolver membership/capability vigente em cada operação sensível; sem autorização por claim cacheada |
| Admin de papel amplo e auditoria sem controle | Alta | Separar `admin.audit.read`, limitar campos, filtros e exportação; monitorar concessão/revogação |
| Audit log guardar PII ou payloads completos | Alta | Eventos com metadados mínimos; allowlist de campos e política de retenção |
| Alterações de autorização afetarem Worker/Restaurant | Alta | Nenhuma mudança em `users.role`; suíte de regressão em políticas/fluxos de marketplace |

## 12. Rollback

O rollback primário é **recuar a aplicação**, não apagar histórico:

1. Desabilitar links/telas de gestão RBAC e audit no shell administrativo.
2. Desativar os novos endpoints de audit e as operações que usam capabilities; deixar `staff/me` e a proteção de acesso existente operacionais, salvo se estiverem comprometidos.
3. Revogar os `EXECUTE` grants novos para papéis da aplicação e restringir/fechar endpoints associados; verificar a negação por chamada direta.
4. Revogar memberships potencialmente comprometidas pela RPC existente, preservando o audit trail. Se a RPC estiver indisponível, seguir procedimento de break-glass previamente aprovado e registrar intervenção.
5. Manter tabelas, catálogo e eventos de auditoria. Não executar `DROP`, truncar log ou editar eventos em produção.
6. Corrigir incompatibilidades por migration forward-only após coletar estado. Rollback de migration destrutiva não é o plano padrão.
7. Confirmar que `worker`, `restaurant`, cadastro, envio de verificação e fluxo de autenticação continuam disponíveis.

Antes do rollout, produzir procedimento operacional para bootstrap/recuperação do Admin e designar os responsáveis; não incluir UUID pessoal, token ou credencial no repositório.

## 13. Critérios de aceite

- Matriz Admin/Reviewer/Support aprovada e implementada no banco como RBAC com capabilities específicas.
- `public.users.role` e o tipo `AccountRole` continuam com somente `worker`/`restaurant`.
- Todo endpoint e RPC administrativo valida sessão e capability própria; o acesso direto sem UI/proxy também é testado.
- Reviewer não lista/gerencia Staff nem lê audit log; Support não revisa verificações nem acessa selfie/documento original.
- Admin gerencia memberships e consulta audit trail de modo paginado e minimizado; todas as mutações Staff permanecem auditadas atomicamente.
- Nenhuma tabela de domínio ou Storage recebe policy ampla para Staff; leitura de documentos exige caminho dedicado, finalidade e auditoria.
- Membership revogada/desabilitada perde acesso na próxima requisição sensível.
- Testes negativos demonstram ausência de acesso a `anon`, Worker, Restaurant e papel Staff inadequado.
- Regressão Worker/Restaurant aprovada; migrations validadas em ambiente isolado e staging, com snapshot e rollback operacional revisados.
- Fase de verificação permanece bloqueada até a autorização de revisão, o acesso a documentos e a RPC de decisão terem desenho e teste próprios.

## 14. Fora do escopo

- Implementar ou lançar o Verification Review Panel.
- Alterar status ou dados de verificação por intervenção manual.
- Acesso de suporte a dados completos, documentos, selfie, mensagens ou coordenadas.
- Gestão/suspensão de contas de marketplace, pagamento, moderação ou disputas.
- Adicionar `moderator`/`auditor`, alterar `users.role`, usar claims de papel como fonte de verdade ou introduzir permissões genéricas para todas as tabelas.
- Corrigir divergências de schema/buckets não relacionadas sem análise e decisão próprias.

## 15. Referências

- `docs/SPRINT_3_1_FOUNDATION_STAFF_PLAN.md`
- `docs/SPRINT_3_EXECUTION_BLUEPRINT.md`
- `docs/ADMIN_ARCHITECTURE.md`
- `docs/DATABASE_CANONICAL_SCHEMA.md`
- `supabase/migrations/20261110010000_staff_foundation.sql`
- `supabase/migrations/20261110020000_admin_audit_log.sql`
- `supabase/migrations/20261110030000_staff_functions.sql`
- `lib/auth/staff-access.ts`
- `lib/auth/staff-api.ts`
- `proxy.ts`
- `app/api/admin/staff/**`
- `app/admin/**`
- `tests/staff-members.sql.test.mjs`
- `tests/admin-api.test.mjs`
- `tests/auth-proxy.test.mjs`
- `tests/auth-routes.test.mjs`
