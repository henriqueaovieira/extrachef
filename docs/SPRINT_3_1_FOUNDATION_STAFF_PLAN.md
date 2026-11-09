# ExtraChef — Sprint 3.0.1: Foundation Staff

**Plano técnico de implementação — não é uma autorização para iniciar migrations**  
**Data-base documental: 9 de novembro de 2026**

## 1. Objetivo e escopo

Estabelecer a identidade, o ciclo de vida, a autorização e a auditoria mínima de operadores internos do ExtraChef, mantendo intactos os papéis de marketplace `worker` e `restaurant`.

Esta entrega prepara as fases seguintes (Verification Review Panel, suporte e auditoria operacional), mas **não inclui** a fila de verificações, visualização de selfie, decisão `verified/rejected`, gestão geral de usuários, moderação, MFA obrigatório ou dashboard de métricas.

> **Gate de bloqueio:** `DATABASE_CANONICAL_SCHEMA.md` e `SCHEMA_DIFF_REPORT.md` continuam parciais. O DDL remoto e a migration history não foram reconciliados. Este plano descreve a arquitetura e o trabalho que deverá ocorrer após a Fase 0; não se deve criar nem aplicar migration enquanto o critério de desbloqueio da Fase 0 não for satisfeito.

## 2. Arquitetura final proposta

### 2.1 Identidade e fluxo de autorização

```text
Supabase Auth (auth.users.id)
       │
       ├── Conta de marketplace opcional/independente
       │       └── public.users.role = worker | restaurant (inalterado)
       │
       └── private.staff_members
                 └── admin | reviewer | support
                         │
                         ├── guard server-side das páginas /admin
                         ├── guard individual de cada /api/admin/*
                         └── RPCs estreitas de administração, validadas no banco
                                   └── private.admin_audit_log
```

- **Fonte de identidade:** sessão Supabase Auth; derivar o ator exclusivamente de `auth.uid()`/usuário validado no servidor. Nunca aceitar `actor_id` como autorização do payload.
- **Fonte de papel Staff:** tabela `private.staff_members`, separada de `public.users`; não colocar `admin`, `reviewer` ou `support` em `users.role`, `AccountRole`, metadata editável, nem em claims JWT no MVP.
- **Schema privado:** armazenar tabelas e helpers sensíveis em schema `private` não exposto pelo PostgREST. O nome/schema e a configuração de exposição só podem ser confirmados depois de revisar o catálogo real e o `db-extra-search-path`/schemas expostos no ambiente.
- **Política de papel:** um papel Staff ativo por identidade no MVP. Papéis são `admin`, `reviewer` ou `support`; o único nível autorizado a conceder/revogar qualquer papel é `admin`. `reviewer` e `support` não administram memberships.
- **Negação por padrão:** falha de Auth, consulta de membership, RPC ou banco resulta em negar acesso; não há fallback para usuário autenticado nem para `public.users.role`.
- **Sem claims/cache de autorização:** conferir a membership vigente nos pontos de decisão. A revogação deve afetar a próxima requisição sem depender de refresh de JWT; sessão Auth e membership Staff são conceitos separados.
- **Credenciais privilegiadas:** `service_role` não é papel de operador. Pode ser usada apenas por tarefa server-to-server ou bootstrap único, restrito e auditado; não pode ser enviada ao browser, usada em uma API como identidade humana ou substituir a validação de Staff.

### 2.2 Modelo de dados planejado

Os nomes abaixo são nomes lógicos do plano. DDL final, tipos, FKs, ownership e naming de constraints dependem do snapshot real e do padrão encontrado no catálogo.

#### `private.staff_members`

Uma linha por identidade Staff, sem linha pública de usuário exigida.

| Campo lógico | Necessidade |
|---|---|
| `user_id` | PK e FK a `auth.users.id`; impedir concessão a identidade Auth inexistente |
| `role` | Check/enum limitado a `admin`, `reviewer`, `support` |
| `granted_at`, `granted_by` | Autoria/tempo de concessão; `granted_by` pode ser nulo somente para bootstrap inicial documentado |
| `grant_reason` | Motivo obrigatório para concessão |
| `revoked_at`, `revoked_by`, `revoke_reason` | Revogação rastreável; estado ativo é derivado de `revoked_at IS NULL` |
| `updated_at` | Auditoria técnica de alteração, se adotado no padrão real do projeto |

Constraints/regras:

- FK deve impedir a concessão para um `auth.users.id` inexistente. A exclusão de Auth não deve apagar silenciosamente a concessão ou o histórico; a regra de `ON DELETE` deve ser aprovada no gate e a revogação auditada deve preceder a exclusão.
- Não permitir auto-concessão, auto-promoção para Admin nem troca de papel do próprio ator. A remoção do último Admin ativo deve ser bloqueada transacionalmente; manter um caminho operacional de break-glass fora da API de usuário, com evento de auditoria.
- Reconcessões após revogação atualizam o estado operacional segundo decisão do DDL, sem perder o histórico de concessões/revogações registrado no audit log.
- A estrutura não deve armazenar senha, segredo, documento, selfie, e-mail desnecessário ou cópia de claims JWT.

#### `private.admin_audit_log`

Registro append-only do escopo Foundation Staff: bootstrap inicial, concessões, revogações e falhas/negações de ações de administração de membership quando implementadas.

Campos lógicos mínimos: identificador, instante (`timestamptz`), ator Auth nullable apenas para bootstrap controlado, papel/contexto do ator, tipo de ação, identidade alvo, papel anterior/novo, motivo, resultado, request/correlation ID opcional. Evitar IP/UA e payloads que contenham PII sem necessidade e política aprovada.

- Inserção realizada somente pelos caminhos controlados no banco; não conceder `INSERT`, `UPDATE` ou `DELETE` diretamente a `anon`/`authenticated`.
- Nenhum endpoint de leitura amplo nesta entrega. Leitura operacional do log será adicionada em fase posterior, após definir a capacidade de auditoria.
- Evento de concessão/revogação e alteração de `staff_members` devem ser atômicos: falha ao persistir o evento cancela a alteração.
- “Append-only” para os papéis da aplicação não significa imutabilidade contra owner/superuser/administrador do projeto. A limitação e o acesso de emergência devem constar no runbook.

### 2.3 Matriz inicial de capacidades

| Ação | `admin` | `reviewer` | `support` |
|---|---:|---:|---:|
| Consultar a própria autorização de acesso | Sim | Sim | Sim |
| Conceder, alterar ou revogar membership Staff | Sim | Não | Não |
| Acessar funcionalidades do futuro painel de verificação | Sim | Sim | Não |
| Aprovar/rejeitar verificação profissional | Sim, se habilitado na fase do painel | Sim, se habilitado na fase do painel | Não |
| Ver selfie/CPF/RG | Não nesta Foundation; definição na fase de verificação | Não nesta Foundation; definição na fase de verificação | Não |
| Ler audit log completo | Não nesta Foundation; capacidade futura explícita | Não | Não |
| Gerir usuários, pagamentos ou suporte geral | Fora do escopo | Fora do escopo | Fora do escopo |

A tabela de memberships concede identidade e papel, não autorização automática para dados. O painel e cada capacidade posterior precisam de guard próprio, política de minimização e teste negativo.

## 3. Gates de entrada

Antes de criar a primeira migration, todos os itens abaixo devem estar fechados:

1. Obter snapshot read-only identificado do ambiente-alvo com `information_schema`, `pg_catalog`, `pg_policies`, grants, schemas expostos pelo PostgREST, Storage e `supabase_migrations.schema_migrations` (ou export equivalente).
2. Concluir `DATABASE_CANONICAL_SCHEMA.md`, `SCHEMA_DIFF_REPORT.md`, `POLICY_DIFF_REPORT.md`, `RPC_INVENTORY.md` e `STORAGE_DIFF_REPORT.md` como comparação real, sem inventários vazios tratados como “nenhum objeto”.
3. Confirmar no banco o uso de `auth.users`, permissões de criação/uso de schema privado, owners, `search_path`, policies, grants e práticas de naming/ordem de migrations.
4. Confirmar a distinção dos ambientes e o histórico aplicado; não usar uma chave de API para inferir catálogo, grants ou ledger de migrations.
5. Resolver os findings que possam interferir no rollout: drift de migrations, acesso ao schema privado, visibilidade de `restaurant-assets` e risco de `app/api/debug/env/route.ts`. A divergência do bucket não é corrigida por esta Sprint, mas precisa de decisão registrada.
6. Aprovar papéis, capacidades, política de bootstrap, motivo de concessão/revogação, proteção do último Admin e procedimento break-glass.
7. Identificar a conta Auth do primeiro Admin por canal operacional aprovado. Não gravar identificador pessoal em migration ou repositório.
8. Garantir ambiente de teste isolado e restauração viável; não usar produção para testar permissões negativas.

**Se qualquer item estiver aberto, a Sprint fica em estado “planejada/bloqueada”; somente discovery e teste local sem conexão de escrita podem avançar.**

## 4. Migrations necessárias e ordem

Os arquivos de migration não devem ser nomeados manualmente neste plano. Depois do gate, criar cada arquivo com o gerador oficial configurado no repositório (`supabase migration new <nome-descritivo>`), revisar timestamp/ordem e validar com a versão de CLI adotada. O uso de CLI permanece condicionado a confirmar sua instalação/configuração e conexão ao ambiente correto.

### Migration A — Fundação de identidade e audit log

**Conteúdo lógico:**

1. Criar/validar schema privado não exposto; não alterar schemas/tabelas base existentes.
2. Criar `private.staff_members` com FK, papéis, timestamps, motivos, constraints e índice para consulta por `user_id`/estado.
3. Criar `private.admin_audit_log` com campos mínimos, índices para ator/alvo/tempo e proteção contra alteração por roles de aplicação.
4. Ativar RLS nas tabelas privadas como defesa em profundidade; conceder somente o necessário às funções donas/controladas. Sem policy genérica para `authenticated`.
5. Definir owners e grants mínimos explicitamente; verificar que objetos não aparecem como endpoints REST.
6. Nenhuma membership de pessoa real embutida em DDL versionado.

**Pré-condição:** catálogos e grants do ambiente reconciliados; disponibilidade de schema não exposto e suporte a FK para `auth.users` confirmados.

### Migration B — Autorização e operações de membership

**Conteúdo lógico:**

1. Helper de checagem de Staff/papel, não recursivo, com `auth.uid()` como ator e sem confiar em claims de `user_metadata`.
2. Funções/RPCs mínimas para leitura da própria autorização e gestão de Staff (conceder/alterar/revogar), com autorização Admin dentro do banco, `search_path` fixo, validação de payload e ACLs explícitas.
3. A função de gestão insere o evento de auditoria e altera membership na mesma transação; falha de qualquer etapa aborta ambas.
4. Proteções contra autoatribuição, escalada, papel fora da allowlist, identidade Auth inexistente, motivo vazio e remoção concorrente do último Admin.
5. Execução revogada de `PUBLIC`/`anon` por padrão. A execução da operação autenticada é concedida somente ao papel de banco necessário e validada pelo próprio corpo da função. Funções internas privadas não ficam expostas pelo PostgREST.
6. Se uma função pública de fachada for necessária para chamadas via sessão Auth, ela deve expor apenas a operação estrita, sem leitura genérica da tabela, com checagem de `auth.uid()` e autorização no corpo.

### Bootstrap inicial — procedimento operacional, não seed público

- Não inserir um Admin pelo cadastro do cliente, `raw_user_meta_data`, endpoint de autoatendimento, variável `NEXT_PUBLIC_*` ou migration com UUID hardcoded.
- Usar procedimento único, restrito ao operador autorizado do ambiente, que valide que a identidade existe em `auth.users`, crie a membership `admin` e grave evento explícito de bootstrap com identidade do responsável operacional e motivo.
- Se a política de banco não permitir identificar o operador humano pelo `auth.uid()`, o evento inicial deve distinguir claramente `bootstrap` e registrar o principal operacional por meio aprovado, sem fingir que foi uma ação de sessão Staff.
- Rotacionar/encerrar o mecanismo de bootstrap após sucesso; guardar comprovante operacional sem token/segredo.

### Ordem de aplicação

1. Gate de entrada aprovado e snapshot arquivado.
2. Migration A em banco local/isolado; validar schema, grants, RLS e ausência de exposição REST.
3. Migration B em banco local/isolado; executar suíte de segurança e atomicidade.
4. `supabase db reset` somente em banco local descartável, depois de resolver a fundação ausente de `users/jobs/applications`; não executar contra produção e não tratar reset parcial como teste de schema final.
5. Aplicar A e B em staging controlado; comparar snapshot pós-migration; bootstrap de identidade de teste.
6. Testar concessão, uso, revogação, sessão ativa após revogação e proteção contra remoção do último Admin.
7. Revisão independente de security/RLS e aprovação de rollback.
8. Aplicar em produção em janela aprovada; executar bootstrap inicial; validar eventos e negar acesso a todos os demais.

## 5. Tabelas e objetos impactados

| Objeto | Tipo de impacto | Escopo |
|---|---|---|
| `auth.users` | Referência; não modificar | Fonte da identidade e FK de Staff |
| `private.staff_members` | Nova tabela | Papéis/estado de acesso a Staff |
| `private.admin_audit_log` | Nova tabela | Eventos de bootstrap e alterações Staff, sem painel de leitura nesta fase |
| `public.users` | Sem alteração | Preservar papel e regras de conta Marketplace |
| `public.jobs`, `public.applications` | Sem alteração | Nenhuma relação com Foundation Staff |
| `worker_profiles`, `restaurant_profiles`, `storage.objects` | Sem alteração de dados/policies nesta fase | Não liberar documentos/selfies |
| `private` schema e grants | Novo/ajustado após inspeção | Garantir não exposição e execução mínima |

Não criar FK de Staff para `public.users`: isso faria Staff depender do modelo de conta Marketplace e impediria identidade administrativa independente. A FK planejada é para Auth e precisa ser validada no schema real.

## 6. RLS e políticas impactadas

### Novas políticas

- Habilitar RLS nas duas tabelas novas, caso compatível com os padrões e owners observados.
- Nenhum `SELECT` direto às tabelas Staff/audit para `anon`/`authenticated`.
- Nenhum `INSERT`/`UPDATE`/`DELETE` direto por `authenticated`; mutações por RPC estrita.
- A checagem do próprio Staff ocorre por função controlada, sem criar policy recursiva em `staff_members`.
- Audit log não recebe update/delete policy. Operações privilegiadas de banco/owner permanecem fora do limite de proteção RLS e precisam de controle operacional.

### Políticas existentes preservadas

- Não alterar policies de `users`, `jobs`, `applications`, perfis, notificações, chat, eventos ou Storage para incluir `admin`, `reviewer` ou `support`.
- Não expandir a whitelist `worker`/`restaurant` da policy de INSERT de `users` nem da função `ensure_account_profile()`.
- Não alterar `worker_selfie_private`, `worker_selfie_no_update` ou `worker_selfie_no_delete`; a leitura da selfie é fase futura.
- A estimativa documental de aproximadamente 69 referências de papéis em migrations reforça o isolamento; não usar essa contagem como inventário exato sem reconciliação e busca reproduzível.

**Risco principal:** uma função `SECURITY DEFINER` pode contornar RLS. Não a usar como correção genérica de permissão. Se inevitável para helper privado, limitar schema/ACL/`search_path`, validar ator/capacidade no corpo e testar chamada direta e indireta.

## 7. RPCs impactadas

### Novas, previstas

- `get_my_staff_access()` (nome lógico): devolve apenas se o ator autenticado tem membership ativa e seu papel; não revela outros membros nem permite enumerar Staff.
- Operação de concessão/alteração de membership para Admin.
- Operação de revogação de membership para Admin.
- Helper privado de autorização (`has_staff_role`/equivalente) para uso por RPCs e guards, com assinatura escolhida após verificar o catálogo.

Nomes são indicativos e devem ser ajustados para evitar colisão com as 89 RPCs já expostas e com todas as funções existentes no catálogo.

### Existentes preservadas

- `ensure_account_profile()`: manter apenas `worker`/`restaurant`; Staff não se cria a partir de metadata.
- RPCs de domínio (`approve_application`, demandas, chat, check-in/out, reviews, reputação, etc.): não conceder a Staff por inclusão de novo papel.
- `review_profile_verification(...)`: permanece inalterada nesta entrega; não conceder sua execução a `authenticated`. Migrar autorização/autoria da revisão é trabalho da fase do painel.
- Rotinas de sistema `service_role`/cron/push/geocoding: fora do fluxo de identidade humana.

### Contratos e privilégios

- Derivar o sujeito de `auth.uid()`.
- Validar papel e estado ativo dentro de cada RPC mutável.
- `SECURITY DEFINER` somente se necessário, com owner explícito, `search_path` seguro e grants revogados explicitamente de roles não autorizados.
- Usar `SECURITY INVOKER` quando possível.
- Não aceitar ação/capacidade arbitrária nem SQL/identificadores fornecidos pelo chamador.
- A concessão não pode produzir um usuário Staff por meio de RPC pública se o ator não for Admin ativo.

## 8. APIs, rotas e componentes

### APIs planejadas

Todas as rotas abaixo são novas; nenhum endpoint API existente deve ganhar privilégio implicitamente:

- `GET /api/admin/staff/me`: estado mínimo da autorização do ator para navegação; pode ser substituído por leitura server-side equivalente.
- `GET /api/admin/staff`: lista paginada de membros apenas para Admin, com dados mínimos; não incluir e-mail/PII sem necessidade.
- `POST /api/admin/staff`: concede ou altera membership; requer papel e motivo; rate limit/CSRF/origin guard conforme padrão da aplicação.
- `POST /api/admin/staff/[userId]/revoke` ou rota equivalente: revoga membership com motivo e proteção contra auto/último Admin.

As APIs validam a sessão e a capacidade em cada request; não dependem de o proxy ter sido executado. Não usar `SUPABASE_SERVICE_ROLE_KEY` como única barreira de autorização. Se uma rota utilizar cliente privilegiado para operação estritamente necessária, ela primeiro autentica o operador, confere o papel atual e passa ator/razão validados a RPC que repete a checagem transacional.

### Rotas de página

- Incluir `/admin/:path*` no matcher de `proxy.ts` com ramo administrativo independente do papel `users.role`.
- Criar `app/admin/layout.tsx` como server-side boundary e `app/admin/page.tsx` como landing mínima da Foundation, sem funcionalidades futuras visíveis.
- Para rota direta sem membership, responder redirect/acesso negado apropriado; falha de dependência deve falhar fechada, sem redirecionar para uma conta de Worker/Restaurant como se fosse problema de role.
- Proteger APIs individualmente. O matcher atual não inclui `/api/**` e não é substituto de autorização no endpoint.
- Manter `/worker/**` e `/restaurant/**` governadas pelo `AccountRole` atual; não incluir papel Staff em `lib/auth/routes.ts`.

### Arquivos previstos

| Categoria | Arquivos existentes a avaliar/alterar | Arquivos novos possíveis |
|---|---|---|
| Proxy e rotas | `proxy.ts`; nenhum alargamento de `lib/auth/routes.ts` para Staff | Guard específico em `lib/auth/staff.ts` ou `lib/auth/staff-guard.ts` |
| Supabase server | `lib/supabase/request.ts` para preservar cookies e refresh | Serviço server-only para autorização/operações Staff, sem exportar credenciais |
| API | Nenhuma API existente deve passar a confiar no Staff | `app/api/admin/staff/route.ts`, `[userId]/route.ts`/`revoke/route.ts` |
| Páginas | Nenhuma rota existente de Worker/Restaurant | `app/admin/layout.tsx`, `app/admin/page.tsx` minimalista |
| Componentes | Nenhum componente de marketplace | Opcional: `app/admin/components/access-denied.tsx` se o padrão de UX exigir |
| Testes | `tests/auth-proxy.test.mjs`, `tests/auth-routes.test.mjs` | `tests/staff-authorization-sql.test.mjs`, `tests/staff-api.test.mjs`, e2e admin |
| Documentação operacional | Atualizar `docs/DATABASE_CANONICAL_SCHEMA.md` após execução real | Runbook de bootstrap, revogação, break-glass e rollback |

Os nomes de arquivos são alvos sugeridos. O código final deve seguir a estrutura confirmada no momento da implementação, evitando criar camadas duplicadas.

## 9. Estratégia de testes

### Testes SQL / autorização

Criar testes no padrão de `tests/profile-verification-sql.test.mjs`, com schema mínimo controlado e atores Auth diferentes:

1. Usuário sem Staff não consegue obter estado administrativo, chamar RPCs de gestão ou acessar tabelas.
2. Worker/Restaurant permanecem com acesso atual e não ganham privilégios Staff.
3. `support` e `reviewer` não concedem, alteram ou revogam memberships.
4. Admin ativo concede e revoga apenas com motivo não vazio; eventos e estado são escritos na mesma transação.
5. Chamada com `actor_id` forjado não altera o ator de auditoria; `auth.uid()` é a origem.
6. Auto-promoção, concessão de role inválida, alvo Auth inexistente, membro revogado e concorrência de alteração falham sem efeitos parciais.
7. Revogar o último Admin é bloqueado em condições concorrentes; a regra não depende só de verificação prévia no frontend.
8. Falha artificial na escrita do audit log faz rollback da alteração Staff.
9. `anon`, `PUBLIC`, `service_role` e `authenticated` têm exatamente os grants projetados; testar execuções por chamada direta e função wrapper.
10. Tabelas e funções privadas não aparecem como endpoints PostgREST, e não há acesso via Data API direto.

PGlite serve para testes rápidos, mas deve ser complementado por PostgreSQL/Supabase isolado para validar ACLs, RLS, `auth.uid()`, schemas expostos, FK a `auth.users` e eventuais diferenças de extensão/ambiente.

### Testes de aplicação

- `tests/auth-proxy.test.mjs`: `/admin` para Staff ativo; negação para conta comum; erro de Auth/lookup bloqueia; sessão revogada bloqueia imediatamente.
- `tests/auth-routes.test.mjs`: validar que `AccountRole`, redirects e rotas Worker/Restaurant não incluem novos papéis.
- API: acesso sem sessão, papel não autorizado, CSRF/origin, motivo inválido, rate limit quando adotado, erro de banco, resposta sem dados sensíveis.
- E2E: URL direta `/admin`, chamadas diretas a `/api/admin/*`, login/logout, Admin, Reviewer, Support, Worker, Restaurant e identidade revogada.
- Acessibilidade/UX da landing mínima, se houver.
- Regressão: `npm test`, `npm run typecheck`, `npm run build` e testes Playwright configurados; não executar migrations remotas para validar.

### Verificação de rollout

- Comparar catálogo e grants antes/depois em staging.
- Confirmar que `users.role` e políticas de marketplace não mudaram.
- Confirmar ausência de endpoints diretos das tabelas privadas no PostgREST.
- Validar bootstrap e revogação com dois admins de teste, incluindo proteção do último.
- Conferir que logs de aplicação não contêm service key, UUID/PII não necessários, motivo integral sensível ou URLs assinadas.

## 10. Plano de rollback

### Antes do bootstrap em produção

1. Bloquear deploy se migration falhar ou diff não esperado aparecer.
2. Em erro de migration ainda não promovida, reparar em ambiente de teste e preparar uma nova migration forward; não editar migration aplicada.
3. Para rollback funcional, retirar `/admin` e `/api/admin/staff/*` do deploy ou desabilitar essas rotas via mecanismo de rollout aprovado.
4. Revogar `EXECUTE` das RPCs administrativas novas e impedir chamadas; preservar tabelas e trilhas.

### Depois do bootstrap/concessões

1. Desabilitar acesso à UI/API e revogar a membership do operador afetado por procedimento aprovado e registrado.
2. Preservar `staff_members` e `admin_audit_log`; não apagar eventos nem executar `DROP TABLE`.
3. Não apagar auth users nem reverter a fundação de schema automaticamente. Corrigir com migration forward após investigação.
4. Manter um procedimento break-glass documentado e auditado caso a aplicação não consiga revogar Admin; não colocar segredo ou UUID pessoal em Git.
5. Confirmar revogação em nova requisição (não somente no browser já aberto) e verificar acesso direto a endpoints/RPCs.

### Princípios

- Migrations de produção são forward-only; não remover tabelas/constraints com dados por conveniência.
- Rollback da aplicação e revogação de grants são os controles de reversão inicial.
- Eventos de auditoria são retidos conforme política aprovada e nunca apagados como parte do rollback.
- Falha de auditoria bloqueia a mutação de membership.

## 11. Riscos e mitigação

| Risco | Severidade | Mitigação |
|---|---|---|
| Fase 0 não reconciliada | CRÍTICO | Gate obrigatório; não aplicar migration |
| Schema privado exposto inadvertidamente pelo PostgREST | CRÍTICO | Confirmar schemas expostos e testar OpenAPI após migration |
| Escalada via endpoint/RPC ou metadata de cadastro | CRÍTICO | Autorização interna em toda mutação; deny-by-default; testes de chamada direta |
| Primeiro Admin criado por pessoa ou canal incorreto | CRÍTICO | Bootstrap operacional único, identidade validada e evento explícito |
| Remoção concorrente do último Admin | ALTO | Invariante transacional e testes concorrentes |
| Revogação mascarada por cache/claim | ALTO | Fonte de verdade consultada por requisição sensível; sem cache de role no MVP |
| Confusão entre Staff e marketplace | ALTO | Branch de `/admin` independente; `AccountRole` e `users.role` imutáveis |
| Audit log recebe PII/secrets | ALTO | Schema de evento allowlisted; não registrar payload bruto, token, selfie ou URL assinada |
| `SECURITY DEFINER` com ACL/search_path permissivo | CRÍTICO | Preferir invoker; quando necessário, owner/search_path/grants explícitos e review |
| RLS recursiva no lookup da própria membership | ALTO | Helper não recursivo e testes reais do Postgres |

## 12. Critérios de aceite

### Fundação de banco

- [ ] Fase 0 aprovada com snapshot identificado e diff dos catálogos/migration history resolvido.
- [ ] `private.staff_members` e `private.admin_audit_log` criadas sem alteração de `users`, `jobs` ou `applications`.
- [ ] Tabelas privadas não expostas na API; grants e owners documentados; RLS habilitada conforme desenho validado.
- [ ] Constraints e índices cobertos por testes e compatíveis com o DDL real.

### Autorização e ciclo de vida

- [ ] O mesmo `auth.users.id` pode ter Staff sem depender de `public.users.role`.
- [ ] Cadastro público e papel de conta permanecem somente `worker`/`restaurant`.
- [ ] Admin, Reviewer, Support, Worker, Restaurant, anônimo e membership revogada têm permissões distintas e testadas.
- [ ] Só Admin concede/edita/revoga Staff; não há auto-promoção ou papel fora da allowlist.
- [ ] Revogação entra em vigor na requisição seguinte; não depende de refresh de JWT.
- [ ] Não é possível remover o último Admin ativo por corrida ou chamada direta.

### Auditoria

- [ ] Bootstrap é distinguível de concessões ordinárias e não está codificado em migration.
- [ ] Cada concessão/revogação tem ator, alvo, ação, instante, motivo e resultado.
- [ ] Alteração de membership e evento de auditoria são atômicos.
- [ ] Papéis de aplicação não podem alterar/apagar eventos nem falsificar o ator.
- [ ] Nenhum dado pessoal/segredo/URL assinada é registrado sem necessidade e política aprovada.

### Aplicação

- [ ] `/admin` é protegido por branch/guard Staff dedicado e falha fechada.
- [ ] Cada `/api/admin/**` valida Auth e capability individualmente; não depende do matcher como única proteção.
- [ ] Rotas Worker/Restaurant, cadastro e redirects existentes passam nos testes de regressão.
- [ ] Testes unitários, SQL, API, E2E e build/typecheck passam nos comandos configurados pelo projeto.
- [ ] Runbook de bootstrap, revogação, break-glass e rollback foi revisado antes de habilitar o primeiro operador.

## 13. Decisão de prontidão

**Status atual: BLOQUEADO para implementação em Supabase.** A arquitetura Foundation Staff está definida neste plano, mas o baseline remoto não foi reconciliado e a reconstrução integral não está comprovada. A aprovação deste documento não substitui os gates da Fase 0 nem autoriza conexão de escrita, migration ou bootstrap em produção.

Após o fechamento da Fase 0, realizar revisão de segurança do DDL e ACLs finais e então converter este plano em migrations e tarefas de implementação. Mudanças que afetem o escopo ou o modelo de autorização exigem atualizar este documento antes do rollout.

## 14. Referências

- `docs/EXTRACHEF_MASTER_ARCHITECTURE.md`
- `docs/ADMIN_ARCHITECTURE.md`
- `docs/SPRINT_3_READINESS_REPORT.md`
- `docs/FOUNDATION_STAFF_AND_DATABASE_REPORT.md`
- `docs/DATABASE_BASELINE.md`
- `docs/DATABASE_CANONICAL_SCHEMA.md`
- `docs/SCHEMA_DIFF_REPORT.md`
- `docs/SPRINT_3_EXECUTION_BLUEPRINT.md`
- `docs/POLICY_DIFF_REPORT.md`
- `docs/RPC_INVENTORY.md`
- `docs/STORAGE_DIFF_REPORT.md`
- `proxy.ts`, `lib/auth/routes.ts`, `lib/auth/api-user.ts`
- `supabase/migrations/20261014051000_core_rls.sql`
- `supabase/migrations/20261015020000_auth_foundation.sql`
- `supabase/migrations/20261103000000_verified_profile.sql`
- `supabase/migrations/20261104010000_reconcile_verified_profile.sql`
- `tests/auth-proxy.test.mjs`, `tests/auth-routes.test.mjs`, `tests/profile-verification-sql.test.mjs`
