# ExtraChef — Foundation Staff & Database Discovery

**Auditoria de fundação, governança e controle de acesso — 9 de novembro de 2026**

Este relatório separa fatos observáveis no repositório, inferências fundamentadas e perguntas que exigem acesso ao Supabase de cada ambiente. Não foram executadas consultas no banco remoto nem alterados código, migrations ou outros arquivos. O único artefato desta Discovery é este documento.

**Legenda:** ✅ Confirmado no repositório · ⚠ Inferência fundamentada ou parcialmente conhecido · ❌ Não encontrado / desconhecido. “Não encontrado” significa ausência de evidência pesquisada no repositório, não prova de inexistência no ambiente implantado.

## Decisão executiva

| Pergunta | Resposta sustentada por evidência |
|---|---|
| Qual é o schema real e canônico do banco? | ❌ **Não é possível determinar o schema atualmente implantado**: não há baseline das tabelas centrais, `supabase/config.toml` ou conexão com um projeto Supabase disponível nesta auditoria. ✅ O schema descrito pelas migrations do repositório é **não reproduzível do zero**, pois estas pressupõem `public.users`, `public.jobs` e `public.applications`. |
| Como introduzir Staff sem quebrar os papéis existentes? | ⚠ **Recomendação: manter `users.role` estritamente `worker`/`restaurant` e usar uma identidade de Staff separada, vinculada ao mesmo `auth.users.id`, com autorização por papel e operação.** Não conceder acesso administrativo por inclusão de terceiro valor em `users.role`, nem por `GRANT` amplo a `authenticated`. |
| O que precisa existir antes da implementação? | ✅ Recuperar e versionar um baseline fiel do schema, comparar produção/staging/desenvolvimento e resolver a estratégia de bootstrap e revogação de Staff. Sem esses dados, uma migration de fundação seria especulativa e sujeita a falha. |
| Primeira migration / primeira funcionalidade | ⚠ **Não é seguro fechar a migration enquanto o baseline estiver desconhecido.** Após confirmar o schema, a primeira mudança administrativa deve estabelecer a identidade/permissões Staff e o registro de auditoria antes de expor qualquer ação. A primeira funcionalidade operacional que se encaixa no domínio é revisão de verificação, mas somente depois desses controles. |

### Limite da conclusão sobre “banco canônico”

O banco implantado seria a fonte do estado corrente; o histórico de migrations é a fonte versionada disponível neste checkout. O relatório não acessou produção, staging, catálogo Postgres, histórico `supabase_migrations.schema_migrations`, dump, backup ou Dashboard. Portanto, **não afirma** que o banco remoto esteja ausente, nem que sua estrutura corresponda ao código. Um snapshot apenas de schema de cada ambiente é necessário para fechar essa lacuna.

## ETAPA 1 — Identificação do schema canônico

### Evidências de fundação

| Objeto | Evidência encontrada | Resultado |
|---|---|---|
| `public.users` | Nenhum `CREATE TABLE public.users` nas 55 migrations. `20261014051000_core_rls.sql:1` executa `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`; `20261015090000_privacy_account_rights.sql:3` adiciona `deleted_at`. | ✅ Pré-existente às migrations versionadas; ❌ origem/DDL inicial desconhecidos. |
| `public.jobs` | Nenhum `CREATE TABLE public.jobs`. `20261014051000_core_rls.sql:2` altera RLS; migrations operacionais seguintes consultam e alteram a tabela. | ✅ Pré-existente; ❌ origem/DDL inicial desconhecidos. |
| `public.applications` | Nenhum `CREATE TABLE public.applications`. `20261014051000_core_rls.sql:3` altera RLS; `20261014000000_approve_application_and_block_closed_jobs.sql` e outras migrations já pressupõem a tabela. | ✅ Pré-existente; ❌ origem/DDL inicial desconhecidos. |
| `worker_profiles` e `restaurant_profiles` | Criadas com `CREATE TABLE IF NOT EXISTS` em `20261014050000_profiles_and_geo.sql`, referenciando `public.users(id)`. | ✅ Versionadas, mas dependem da tabela base não versionada. |
| Criação de perfil de conta | `ensure_account_profile()` em `20261015020000_auth_foundation.sql`: usa `public.users.role%TYPE`, lê `auth.users.raw_user_meta_data`, valida apenas `worker`/`restaurant` e insere em `public.users`. | ✅ A migration documenta que `users` já deve existir; metadata de cadastro não é uma fonte segura para privilégio Staff. |
| Baseline / projeto local | Não há `supabase/config.toml`, `supabase/schemas/` ou arquivo de seed/baseline na pasta `supabase` observada; há `migrations/`, `diagnostics/`, `proposals/`, `tests/` e `.temp/`. | ✅ Nenhum baseline local encontrado; ❌ não sabemos se existe fora do checkout. |

**Classificação solicitada:** **NÃO REPRODUZÍVEL** a partir somente do repositório. As migrations podem reproduzir objetos que elas próprias criam/alteram quando suas dependências existem, mas não recriam integralmente a base.

**Confiabilidade das migrations:** ⚠ **Parcial.** São evidência útil e versionada sobre objetos adicionados, grants e regras. Não são uma fonte completa do schema de partida; tampouco foram comparadas com os catálogos reais dos ambientes. A existência de arquivos `reconcile` ou `restore`, isoladamente, não comprova divergência entre produção e staging.

### Perguntas ainda sem resposta

- ❌ Quem criou as três tabelas base: migration omitida, SQL manual, dump, projeto anterior ou outro processo.
- ❌ Quais são no banco corrente todas as colunas, tipos, defaults, constraints, índices, triggers, owners, grants e policies dessas tabelas.
- ❌ Se `users.role` tem CHECK/enum no banco real, além das restrictions nas policies e RPCs versionadas.
- ❌ Se há migrations executadas fora do repositório, migrations aplicadas manualmente ou ambientes em versões diferentes.
- ❌ Se o banco pode ser restaurado a partir de um baseline, dump ou processo documentado não presente neste checkout.

## ETAPA 2 — Linha do tempo do banco e migrations de reconciliação

### Linha do tempo observável

1. **2026-10-14:** a sequência começa com operações sobre `jobs`/`applications`; cria objetos dependentes dessas tabelas. `20261014050000_profiles_and_geo.sql` cria perfis, enquanto `20261014051000_core_rls.sql` ativa RLS em `users`, `jobs`, `applications`.
2. **2026-10-15:** `20261015020000_auth_foundation.sql` instala `ensure_account_profile()` e reforça a premissa da tabela `users` pré-existente. `20261015090000_privacy_account_rights.sql` adiciona `deleted_at`, preferências e funções de privacidade.
3. **2026-10-17 a 2026-10-19:** entram demandas operacionais, confiança/pagamento, agenda, talento, localizações e geocoding.
4. **2026-11-03:** `20261103000000_verified_profile.sql` instala o fluxo de verificação profissional e protege o caminho da selfie.
5. **2026-11-04:** há uma concentração de arquivos `reconcile_*`/`restore_*`, mas eles não têm um único propósito: incluem restauração de RPCs, alteração de regras operacionais, extensão/schedule do cron e um arquivo de consulta manual.
6. **2026-11-05 a 2026-11-06:** seguem migrations de localização, confirmação presencial/geográfica, aprendizagem operacional de geolocalização e remoção de unicidade legada de review.

### Arquivos `reconcile_*` / `restore_*`

| Migration | Evidência de intenção/objeto | Impacto e risco revelado |
|---|---|---|
| `20261104000000_reconcile_checkin_gps.sql` | Comentário declara restaurar validação GPS na emissão; substitui `issue_operational_code(uuid,text)` pela variante com latitude/longitude e raio de 100 m. | ✅ Altera check-in/checkout; chamadas sem GPS deixam de passar no check-in. Há risco de incompatibilidade em clientes antigos, explicitado no arquivo. |
| `20261104010000_reconcile_verified_profile.sql` | Recria `guard_worker_verification`, `submit_own_profile_verification`, `review_profile_verification`, view, índice, trigger e policies de selfie. Preflight exige dependências existentes. | ✅ Reaplica proteções do fluxo de verificação; compatibilidade com objetos e dados já existentes é pré-requisito. Evidência de possível divergência histórica é ⚠, não prova de drift entre ambientes. |
| `20261104020000_reconcile_worker_earnings.sql` | Comentário declara restaurar `get_worker_estimated_earnings()`; valida trabalhador e limita ganhos a operações elegíveis do mês. | ✅ Restauração da RPC de domínio; risco explícito de filtro/timezone produzir totais errados. |
| `20261104030000_reconcile_operational_inbox.sql` | Comentário declara restaurar `restaurant_operational_message_inbox(offset,limit)`; paginação máxima 100, filtros de privacidade e validação de role `restaurant`. | ✅ RPC de leitura operacional com dados de trabalhadores; mudanças podem expor dados se os controles forem alterados. |
| `20261104040000_reconcile_geocoded_locations.sql` | Comentário declara salvar local geocodificado por RPC. O arquivo afirma expressamente que **não** restaura o trigger/função de geocoding obrigatório. | ✅ Reconcilia comportamento de localização; mostra que nome “reconcile” não significa simplesmente restaurar todo o comportamento anterior. |
| `20261104050000_reconcile_restaurant_demand_location.sql` | Recria `create_restaurant_demand()` com seleção de origem/local, checagem de role `restaurant` e dependências de localização. | ✅ Afeta publicação de demandas e associação a local; regressão pode bloquear publicação ou salvar local errado. |
| `20261104060000_reconcile_talent_interest.sql` | Arquivo de 96 bytes com `SELECT category, count(*) FROM public.talent_connections ...`. | ✅ Consulta de diagnóstico somente leitura; não é uma migration de DDL nem evidencia, por si, reparo ou drift. |
| `20261104070000_reconcile_operational_schedule.sql` | Instala `pg_cron`, remove schedule de mesmo nome e agenda `process_operational_schedule()` a cada minuto. | ✅ Operação cron/load e necessidade de monitorar run history; não prova por si que ambientes divergiram. |
| `20261104090000_restore_talent_interest.sql` | Altera `talent_connections_category_check` para incluir `interest` e redefine `set_talent_connection()`. | ✅ Restaura categoria de relacionamento; scan de constraint e dados existentes pode falhar, como o comentário alerta. |
| `20261104190000_restore_operational_checkin_gps.sql` | Reinstala `issue_operational_code` com GPS, preflight de tabelas/funções/colunas, e substitui a assinatura antiga. | ✅ Alteração operacional e de compatibilidade de RPC; o título “restore” não demonstra qual ambiente executou qual versão. |

**`repair_*`, `fix_*`, `hotfix_*`:** ✅ Nenhum arquivo com esses prefixos foi encontrado no diretório versionado. Isso não exclui SQL manual ou migrations fora do checkout.

**Conclusão sobre drift:** ⚠ Os preflights e reimplementações demonstram dependências e necessidade de ordem/compatibilidade. Alguns arquivos intitulados `restore` são evidência de comportamento que se desejava reinstalar no histórico do repositório. ❌ Não foi possível concluir se produção está divergente de staging, se migrations foram perdidas ou quais objetos estão implantados. Para isso é necessário comparar inventários/versionamento de cada projeto Supabase.

## ETAPA 3 — Dependências de `users`

### Grafo de dependências

```text
auth.users (id, email, raw_user_meta_data)
   ├─ ensure_account_profile() [SECURITY DEFINER]
   │    └─ valida metadados para worker|restaurant e cria public.users
   └─ auth.uid() / sessão
        ├─ public.users [role, identidade, score/verified, deleted_at]
        │    ├─ FKs de perfis e entidades operacionais
        │    ├─ policies RLS e guards de conta ativa/excluída
        │    ├─ RPCs de cadastro, demanda, candidatura, check-in,
        │    │  reputação, chat, notificação e verificação
        │    ├─ public_user_directory / diretórios e dashboards
        │    └─ proxy.ts, session-guard, login, register, callback
        └─ RPCs autenticadas [auth.uid()] e APIs [Bearer/cookie]
```

### Dependentes identificados no conteúdo das migrations

- **Tabelas com FKs explícitas para `public.users(id)`**: `messages`, `checkins`, `checkouts`, `reviews`, `notifications`, `worker_profiles`, `restaurant_profiles`, `push_subscriptions`, `notification_preferences`, `events`, `work_locations`, `privacy_preferences`, `legal_acceptances`, `demand_events`, `demand_invitations`, `demand_reserves`, `talent_connections`, `operational_assignments`, `geocoding_cache`, `geocoding_requests`, `checkin_attempts` e `work_location_evidence`. Evidência representativa: `20261014010000_job_chat.sql`, `20261014050000_profiles_and_geo.sql`, `20261017010000_operational_demands.sql`, `20261105030000_learning_operational_geolocation.sql`.
- **Migrations de base que pressupõem `users/jobs/applications`**: `20261014051000_core_rls.sql`; `20261015020000_auth_foundation.sql`; `20261015090000_privacy_account_rights.sql`; `20261104030000_reconcile_operational_inbox.sql`. A listagem é histórica, não inventário do banco remoto.
- **Funções e views:** a busca estática consolidou 55 nomes de funções cujos corpos nas migrations fazem referência a `public.users` (definições repetidas em migrations foram consolidadas; não é inventário do catálogo remoto): `accept_current_legal_documents`, `account_is_active`, `acquire_geocoding_request`, `anonymize_account`, `apply_work_location_geocode`, `approve_application`, `approve_demand_candidate`, `archive_restaurant_demand`, `confirm_work_location`, `create_restaurant_demand`, `create_restaurant_job`, `demand_talent_directory`, `demand_talent_directory_before_trust`, `ensure_account_profile`, `export_own_account_data`, `get_approved_chat_context`, `get_chat_message_preview`, `get_restaurant_dashboard_stats`, `get_review_context`, `get_review_context_with_participants`, `get_review_context_with_worker`, `get_visible_profile`, `get_worker_dashboard_stats`, `get_worker_estimated_earnings`, `internal_operational_trust_score`, `interrupt_operational_assignment`, `invite_demand_worker`, `manage_restaurant_demand`, `manage_work_location`, `may_view_profile_media`, `notify_application_received`, `operational_context`, `pending_operational_reviews`, `record_signup_legal_acceptance`, `record_work_location_geocoding_failure`, `reject_deleted_account_write`, `request_push_test`, `require_open_job_for_application`, `require_operational_reviews`, `respond_demand_invitation`, `restaurant_operational_message_inbox`, `restaurant_talent_directory`, `restaurant_talent_history`, `restaurant_talent_reviews`, `review_profile_verification`, `save_restaurant_event`, `save_work_location`, `set_demand_reserve`, `set_talent_connection`, `submit_own_profile_verification`, `update_own_profile_summary`, `update_user_score_from_review`, `worker_demand_invites`, `worker_has_applied_for_job`, `worker_operational_reputation`.
- **Views:** `public_user_directory` projeta campos selecionados e o sinal `profile_verified`; é redefinida por migrations de privacidade/verificação. Não foi encontrada outra view com role condicionada nesta busca.
- **Policies:** `users_insert_self` e versão RESTRICTIVE, políticas de perfil, vagas/candidaturas, eventos e locais; a verificação de papel e ownership ocorre na policy/RPC, não no tipo de sessão de Staff.
- **Aplicação e APIs:** `lib/auth/account.ts` e `lib/auth/routes.ts` consultam/validam role; `proxy.ts` e `app/components/session-guard.tsx` fazem validações de sessão/rota; login, registro e callback determinam o dashboard; `app/api/account/{delete,export}` e `app/api/checkin` validam identidade; `app/api/push/*` usa funções/clientes privilegiados para operações próprias de push.
- **Telas/dashboards:** os 23 arquivos `app/` com comparação literal de role localizam-se em `app/components/{dashboard-identity,mobile-bottom-nav,more-navigation,profile-editor,profile-overview,settings-components,worker-profile-experience}.tsx`, `app/restaurant/{candidates/talent-center.tsx,dashboard/jobs/create/page.tsx,dashboard/page.tsx,demands/[demandId]/demand-detail.tsx,demands/page.tsx,history/page.tsx,locations/page.tsx,messages/message-center.tsx,more/page.tsx,profile/edit/page.tsx,profile/page.tsx,team/team-center.tsx}` e `app/worker/{applications/page.tsx,dashboard/page.tsx,invitations/page.tsx,messages/page.tsx}`. Login, registro, callback e guards consomem o tipo/helper de role; RPCs de dashboard são separadas por papel.

**Impacto:** **CRÍTICO** para alterar/remover/recriar `users`: é raiz de identidade, foreign keys, autorização e perfil. **ALTO** para alterar `role` ou semântica de `deleted_at`; os efeitos propagam por RLS/RPCs e sessões.

## ETAPA 4 — Dependências de `role`

### Frequência no repositório (não no banco implantado)

Uma busca estática em `supabase/migrations/*.sql` encontrou **103 linhas** com os predicados exatos de role pesquisados, distribuídas em 29 migrations: **20 nomes únicos de policies**, **31 nomes únicos de funções** e **1 view** com predicado de role. Na aplicação, a busca encontrou **38 linhas** de comparação role/worker/restaurant em 23 arquivos de `app/`; o contrato central é `lib/auth/routes.ts`. As contagens são de linhas/definições do histórico, não o número de policies ativas ou de chamadas no catálogo Postgres. Definições repetidas em migrations contam como histórico, não como objetos simultâneos.

### Policies encontradas com verificação explícita de role

| Grupo | Policies | Efeito se Staff for cadastrado em `users.role` |
|---|---|---|
| Perfil/identidade | `users_insert_self`, `users_insert_self_restrictive` | INSERT só aceita `worker`/`restaurant`; Staff não consegue provisionar o perfil por este fluxo. |
| Trabalhador | `applications_insert_worker_open_job`, `applications_insert_worker_open_job_restrictive`, `worker_profiles_insert_owner`, `worker_profiles_update_owner` | Operações continuam exclusivas de worker; papel Staff não satisfaz as predicates. |
| Restaurante | `jobs_insert_restaurant_open`, `jobs_insert_restaurant_open_restrictive`, `restaurant_profiles_insert_owner`, `restaurant_profiles_update_owner`, `events_{select,insert,update,delete}_own_restaurant` e suas versões `_restrictive`, `work_locations_select_owner`, `work_locations_select_owner_restrictive` | Operações continuam exclusivas de restaurant; o papel Staff não herda acesso operacional. |

Além dessas 20 policies com teste role explícito, há policies de ownership/participação e guards RESTRICTIVE sem papel de Staff. Uma policy permissiva nova **não** remove o efeito de policies RESTRICTIVE existentes. Acesso do operador a dados sensíveis deve ser tratado como superfície própria, não como liberação generalizada de leitura nas tabelas do marketplace.

### Funções com regras explícitas de role

`acquire_geocoding_request`, `apply_work_location_geocode`, `approve_application`, `approve_demand_candidate`, `archive_restaurant_demand`, `confirm_work_location`, `create_restaurant_demand`, `create_restaurant_job`, `demand_talent_directory`, `demand_talent_directory_before_trust`, `get_chat_message_preview`, `get_restaurant_dashboard_stats`, `get_worker_dashboard_stats`, `get_worker_estimated_earnings`, `internal_operational_trust_score`, `invite_demand_worker`, `manage_restaurant_demand`, `manage_work_location`, `may_view_profile_media`, `record_work_location_geocoding_failure`, `require_open_job_for_application`, `respond_demand_invitation`, `restaurant_operational_message_inbox`, `restaurant_talent_directory`, `restaurant_talent_history`, `restaurant_talent_reviews`, `save_restaurant_event`, `save_work_location`, `set_demand_reserve`, `set_talent_connection`, `submit_own_profile_verification`.

**View:** `public_user_directory` calcula dados de perfil e `profile_verified`, com comportamento específico para `worker`. **Função adicional:** `get_chat_message_preview` contém `CASE WHEN role='worker' THEN ... ELSE 'Restaurante'`; novo role cairia no ramo “Restaurante”.

### Matriz de impacto de papel

| Componente | Evidência | Impacto de incluir Staff em `users.role` |
|---|---|---|
| Cadastro | `app/register/page.tsx`; `ensure_account_profile()`; policies `users_insert_self*` | **CRÍTICO:** UI, metadata whitelist, RPC e policy aceitam somente dois papéis. |
| Tipos/guards | `lib/auth/routes.ts:1,16`; `lib/auth/account.ts`; `session-guard.tsx` | **CRÍTICO:** `AccountRole` é uma união de dois papéis; role desconhecido falha a resolução e login/dashboard. |
| Proxy | `proxy.ts` | **ALTO:** `isAccountRole` rejeita Staff; matcher não inclui `/admin`. |
| RLS/RPCs | 20 policies e 31 funções role-conditioned no histórico | **ALTO/CRÍTICO:** acesso Staff falha por padrão; relaxar regras amplia acesso dos usuários errados. |
| Diretório/chat | `public_user_directory`; `get_chat_message_preview()` em `20261015030000_chat_read_state.sql` | **MÉDIO/ALTO:** staff pode aparecer como pessoa de marketplace ou ser categorizado como Restaurante. |
| UI | 38 linhas em 23 arquivos de `app/`; áreas worker/restaurant e navegação | **ALTO:** componentes/telas assumem papéis operacionais e não definem navegação/permissões administrativas. |
| APIs | `lib/auth/api-user.ts`; `app/api/**` | **ALTO:** identidade autenticada não equivale a papel Staff; APIs fora do matcher precisam autorizar cada operação. |

## ETAPA 5 — Estratégias de Staff

As opções abaixo são **decisões de arquitetura**, não funcionalidades existentes. Recomendação marcada como ⚠ porque a fonte de schema implantado ainda não foi inspecionada.

| Critério | A — Novos valores em `users.role` | B — Camada paralela de contas Staff | C — Híbrido (papel paralelo + claim/cache em JWT) |
|---|---|---|---|
| Preservação dos dois papéis de produto | ❌ Altera semântica de uma coluna usada pelo marketplace | ✅ `worker`/`restaurant` permanecem intactos | ✅ Se a coluna de produto continuar intocada |
| RLS/RPC atual | **CRÍTICO:** migrations/policies/RPCs hardcoded e `ELSE` do chat precisam de revisão; cadastro nega terceiro role | **BAIXO para regressão**, **ALTO para criar novos caminhos protegidos** de Staff; não reutilizar acesso comum | **MÉDIO/ALTO:** além de novas permissões, precisa sincronizar claim com fonte de verdade |
| Segurança | Risk de role Staff ser tratado como ator de produto; não há modelo de permissão granular | Permite negar por padrão e separar reviewer/support; exige check explícito em cada RPC/API | JWT pode estar desatualizado até refresh; sincronização e revogação ficam mais complexas |
| Migrations | Pode exigir alterar muitos objetos e descobrir CHECK/base primeiro | Exige objeto novo e grants/RLS próprios, dependentes do baseline | Exige base Staff e fluxo de emissão/atualização/expiração de claims |
| Manutenção | Alta devido aos consumidores existentes | Menor acoplamento com regras atuais; novo domínio isolado | Maior complexidade operacional e duplicação de estado |

**Escolha recomendada: Opção B.** Manter a role de usuário de marketplace em `public.users.role` e representar Staff em uma relação separada ao mesmo `auth.users.id`, com papéis/estado revogável e checagem server/database para cada capacidade. Evidências: policy `users_insert_self*` limita os dois roles, a função de provisionamento valida a mesma lista, `AccountRole` só aceita os dois, 20 policies e 31 funções têm condições role explícitas. O caminho B contém o blast radius de mudanças e não converte Support/Reviewer em Restaurante ou Trabalhador.

**Limite importante:** B não torna Staff automaticamente autorizado. Uma linha em tabela paralela não deve liberar leitura global nem acesso amplo a RPCs `SECURITY DEFINER`. A tabela não existe hoje; atribuição, bootstrap inicial, grants, RLS, revogação de sessão e política de auditoria são requisitos a decidir e validar após recuperar o schema base. A Opção C pode ser reavaliada apenas se houver requisito comprovado de claims; não há role JWT de Staff nem infraestrutura correspondente no repositório.

## ETAPA 6 — Auditoria de RLS

| Objeto/policy | Regra observada | Requisito para Staff | Impacto |
|---|---|---|---|
| `users_insert_self*` | `id=auth.uid()`, role em `worker/restaurant`, score/verified iniciais | Nunca usar este caminho para conceder Staff; provisionamento separado e controlado | **CRÍTICO** se expandido sem bootstrap protegido |
| `worker_profiles_*_owner` | Owner é o `auth.uid()` e papel `worker` para insert/update | Reviewer não satisfaz ownership; precisa de acesso especificamente autorizado e limitado | **ALTO** |
| `restaurant_profiles_*_owner`, `events_*_own_restaurant`, `work_locations_*` | Ownership + `restaurant` | Staff Support/Admin não deve herdar escrita de Restaurante | **ALTO** |
| `applications_insert_worker_open_job` | Usuário autenticado, `worker_id=auth.uid()`, papel worker, vaga aberta | Acesso Staff não necessário para candidatura; manter intacta | **MÉDIO** (não mudar por causa de Admin) |
| `jobs_insert_restaurant_open` | `restaurant_id=auth.uid()`, status/location válidos, role restaurant | Acesso Staff não necessário para publicar como restaurante | **MÉDIO** |
| `users_select_authenticated_directory` e versão RESTRICTIVE | `USING (true)` combinado com grants por coluna | Não aumentar grants da tabela para satisfazer painel; manter e projetar dado mínimo | **ALTO** |
| `worker_selfie_private`, `worker_selfie_no_update`, `worker_selfie_no_delete` | Selfie submetida privada; dono permitido; update/delete bloqueados para usuário | Acesso do reviewer não está presente; serviço que assina URL deve autenticar reviewer e registrar o motivo/acesso | **CRÍTICO** |
| Guards RESTRICTIVE de conta ativa | `account_is_active()` nas tabelas e storage | Verificar que novas políticas não tentem contornar conta inativa/excluída | **ALTO** |

**Quais precisam reconhecer Staff?** Nenhuma regra de negócio worker/restaurant deve ser alterada só para permitir o painel. As operações Staff precisam de policy/RPC/API própria, com finalidade e dados mínimos. A interface de Staff não deve obter `service_role` nem confiar em esconder botões. **Risco crítico:** adicionar um papel no tipo ou uma policy permissiva não basta: o cadastro pode continuar bloqueando-o, policies RESTRICTIVE continuam aplicáveis, e o acesso a Storage permanece separado.

## ETAPA 7 — RPCs, `SECURITY DEFINER` e `service_role`

| RPC/área | Evidência e permissão atual | Usuário atual / futuro esperado | Risco |
|---|---|---|---|
| `review_profile_verification(uuid,text,text,timestamptz)` | `SECURITY DEFINER`, `search_path=''`, REVOKE de `PUBLIC/anon/authenticated`, EXECUTE apenas a `service_role` (`20261103000000_verified_profile.sql`, redefinida em `20261104010000_reconcile_verified_profile.sql`). Não valida nem grava ator Reviewer. | Hoje serviço privilegiado; futuro: operação atribuída e autorizada a Reviewer/Admin; registrar ator e decisão. | **CRÍTICO** se simplesmente conceder EXECUTE a `authenticated`: função não tem check interno de `auth.uid()`/Staff. |
| `submit_own_profile_verification(text)` | `SECURITY DEFINER`; EXECUTE `authenticated`; exige `auth.uid()` com role `worker`, perfil/dados/selfie válidos. | Worker que envia próprio pedido; manter autocadastro separado da revisão. | **ALTO** se a checagem de ownership/role for enfraquecida. |
| `ensure_account_profile()` | `SECURITY DEFINER`; EXECUTE `authenticated`; lê `raw_user_meta_data`, whitelist de dois papéis, cria `users`. | Ator de cadastro; nunca deve criar/grant Staff a partir de user metadata. | **CRÍTICO** se a whitelist for expandida para roles privilegiados sem processo de concessão confiável. |
| `process_operational_schedule()` | `SECURITY DEFINER`; EXECUTE `service_role`; chamado por `pg_cron` (`20261017030000_operational_trust.sql`, schedule em `20261104070000_reconcile_operational_schedule.sql`). | Rotina de sistema, não pessoa da equipe. | **ALTO** se confundido com autorização Admin ou executado sem monitoramento/idempotência. |
| `anonymize_account(uuid)` | EXECUTE concedido a `service_role` em migrations de privacidade/continuidade operacional; consumidor em exclusão de conta. | Ação técnica de privacidade; solicitação pode ser do titular ou assistida, mas execução privilegiada precisa de contexto/auditoria apropriados. | **ALTO** por irreversibilidade/impacto de privacidade. |
| `approve_application`, `create_restaurant_demand`, `invite_demand_worker`, estatísticas e funções operacionais | RPCs de domínio com checagens de usuário/role e chamadas por `authenticated`; várias são `SECURITY DEFINER` com `search_path=''`. | Worker/Restaurant participante, conforme regra da RPC; não devem tornar-se ações Staff por acidente. | **ALTO** se concedidas ao Staff sem preservar predicates de negócio e ownership. |
| Push/geocoding | `record_push_delivery`, tabelas de delivery/subscriptions e funções de geocoding têm grants para `service_role`; rotas `app/api/push/*` e `lib/geocoding/index.ts` usam cliente privilegiado. | Serviços de backend; não requerem role humano de Admin. | **MÉDIO/ALTO**: separar credencial de sistema de autorização de usuários Staff. |

✅ As RPCs verificadas acima qualificam `search_path=''` e há revokes/grants explícitos em funções críticas. Isso não substitui auditoria por função de todo o catálogo implantado. ❌ O catálogo completo de funções e ACLs de produção não foi consultado. ❌ `is_staff()`/equivalente, grants administrativos e RPCs admin não foram encontrados.

**Diretriz:** `service_role` continua apropriada para rotinas internas de sistema que precisam bypassar RLS; não é identidade de Admin/Reviewer. Uma ação iniciada por pessoa exige associação Staff autenticada e autorização validada no servidor/banco. Não basta trocar o grant da RPC atual: o corpo de `review_profile_verification` precisa reconhecer um ator autorizado e persistir autoria de forma atômica.

## ETAPA 8 — Verificação profissional

### Fluxo existente

```text
worker_profiles INSERT (quando o perfil é criado)
  └─ verification_status = 'pending' (DEFAULT; selfie pode ser NULL)
       └─ submit_own_profile_verification(p_selfie_path) [authenticated/worker]
            ├─ valida CPF, RG, telefone, owner-path e objeto em worker-private
            └─ persiste path e pending
                 └─ review_profile_verification(...) [service_role]
                      ├─ exige status pending, mesmo path e updated_at esperado
                      ├─ verified exige objeto/mimetype válido; rejected não exige objeto
                      └─ atualiza status para verified ou rejected
```

| Questão | Evidência / conclusão |
|---|---|
| Dados e estados | ✅ `worker_profiles` em `20261014050000_profiles_and_geo.sql` contém `cpf`, **`rg`**, `date_of_birth`, `phone`, `whatsapp`, `address`, `selfie_verification_path`, `verification_status`. O CHECK permite `pending`, `verified`, `rejected`; `not_started` não existe. |
| Quem envia | ✅ `submit_own_profile_verification()` exige worker autenticado, CPF/RG/telefone e selfie do próprio diretório em `worker-private` com MIME permitido. |
| Quem revisa | ✅ Hoje somente `service_role` pode executar `review_profile_verification()`; ❌ nenhum Reviewer humano é identificado. |
| Transições | ✅ Revisão aceita só `verified` ou `rejected`, e só de um pedido `pending` com selfie e timestamp/path atuais. ✅ Worker pode reenviar após rejeição, com selfie diferente. `verified` não pode submeter de novo pelo RPC. |
| Mudança de documentos | ✅ `guard_worker_verification` define status `pending` quando CPF/RG/telefone mudam. Isso pode reabrir revisão; precisa ser entendido como regra do domínio, não presumido como erro. |
| Registro e histórico | ❌ Não existe `reviewed_by`, `reviewed_at`, motivo de rejeição ou histórico de decisões na função/tabela observada. |
| Selfie | ✅ Bucket `worker-private`; políticas permitem ao dono ver e impedem update/delete do objeto submetido. ❌ Não existe fluxo próprio de acesso Reviewer nem log de visualização. |
| Apresentação | ✅ `public_user_directory` e `verified-profile-badge.tsx` refletem selo, enquanto `ProfessionalVerification` consulta o diretório. ❌ Não há painel de revisão/fila. |

**Modelo operacional pretendido (⚠):** Worker envia; Reviewer autorizado avalia; Admin pode gerir acesso e tratar exceções; uma ação de revisão registra ator, instante, transição, justificativa e referência do pedido. Selfie/CPF/RG não devem ser acessíveis a Support por conveniência. Esses são requisitos de projeto; não existem no fluxo atual.

## ETAPA 9 — LGPD e acesso administrativo

| Dado | Local/evidência | Sensibilidade operacional | Acesso futuro mínimo recomendado (⚠) |
|---|---|---|---|
| CPF | `worker_profiles.cpf`; CHECK `is_valid_cpf`, índice único normalizado | Dado pessoal de alto impacto | Lista mascarada; visualização integral só por necessidade justificada, perfil restrito e evento auditável. |
| RG | `worker_profiles.rg` (NOT NULL; validado para perfil verificado) | Dado pessoal identificador | Mascarado por padrão; acesso integral apenas no fluxo que comprova identidade, com log. |
| Selfie | `worker_profiles.selfie_verification_path`, objeto no bucket `worker-private` | Imagem de identificação; pode envolver dado biométrico sensível conforme finalidade/processamento. A qualificação jurídica exige análise da finalidade concreta. | Reviewer sob autorização, link temporário e finalidade; registrar solicitação/acesso; nunca expor a Support ou público. |
| Telefone/WhatsApp | `worker_profiles.phone`, `whatsapp`; `users.phone` é referenciado em ACLs | Dado de contato pessoal | Mascaramento em filas; integral apenas para suporte estritamente necessário e auditável. |
| Endereço/CEP/cidade | `worker_profiles.address`, `postal_code`, `city`; perfil de restaurante/localização | Identificação e localização residencial/operacional | Não exibir endereço residencial em suporte genérico; acesso privilegiado e condicionado à tarefa. |
| Data de nascimento | `worker_profiles.date_of_birth` | Dado pessoal identificador | Não necessária para telas gerais; acesso mínimo e mascarado/omitido fora da revisão autorizada. |
| Pagamentos | `operational_assignments` e `record_operational_payment` registram valores/estado operacional; nenhuma evidência de gateway ou credencial bancária neste fluxo | Dado financeiro/operacional; não inferir armazenamento de cartão/conta bancária | Mostrar estado e valor apenas a função que resolve a operação; nunca expor credenciais que não foram encontradas. |
| Histórico operacional/localização | `checkins`, `checkouts`, `checkin_attempts`, `work_location_evidence`, `demand_events`, `operational_assignments` | Pode revelar rotina, local e comportamento | Acesso por caso, retenção definida e trilha de consulta/ação. |

✅ `privacy_preferences`, `legal_acceptances`, exportação e anonimização existem. ❌ No repositório não foi encontrada política administrativa de mascaramento, justificativa de acesso, log de leitura de selfie, matriz de retenção ou MFA. **Não é uma certificação de conformidade LGPD**; bases legais, prazos, avisos e papéis de controlador/operador não podem ser comprovados apenas pelo schema.

## ETAPA 10 — Autoria e auditoria

| Ação | Registro encontrado | Lacuna |
|---|---|---|
| Aprovar/rejeitar verificação | `review_profile_verification` altera status/`updated_at` | ❌ Ator, motivo e histórico de decisão |
| Reenviar/editar dados de verificação | Guard e RPC alteram status/path | ❌ Histórico de valores e ligação à decisão anterior |
| Conceder/revogar papel Staff | ❌ Nenhuma tabela/rota/RPC Staff | ❌ Ator, aprovador, expiração, motivo e revogação |
| Excluir/anonimizar conta | `anonymize_account`, endpoint `/api/account/delete`, `deleted_at` | ⚠ Há fluxo de privacidade e estado; não foi encontrado registro administrativo genérico com ator/motivo/antes/depois |
| Bloquear/suspender usuário | ❌ Nenhum estado/ação de suspensão identificado | ❌ Modelo, autoria, motivo e recurso/contestação |
| Acesso a dados sensíveis | Policies/storage protegidos para usuários finais | ❌ Log de acesso de operador a CPF/RG/selfie |
| Operações de negócio | `demand_events`, `push_deliveries`, `checkin_attempts`, `work_location_evidence`, `legal_acceptances` | ✅ São evidências específicas de domínio; ❌ não substituem trilha de auditoria administrativa |

**Mapa de auditoria necessária (⚠ requisito de arquitetura):**

- **CRÍTICO:** concessão/revogação de Staff; aprovar/rejeitar/retornar verificação; leitura de selfie e exposição de identificadores completos; suspensão/bloqueio; exclusão ou anonimização assistida; mudança de papel e uso excepcional de credencial privilegiada.
- **ALTO:** alteração manual de dados, decisão de suporte/disputa, moderação de review/chat, mudança de status operacional e reenvio administrativo de push.
- **MÉDIO:** consulta de lista/fila e leitura de dados agregados, com atenção ao princípio de minimização.

Para ações mutáveis, a trilha deve responder **quem, quando, qual entidade/ação, estado anterior/novo e motivo**. Para dados sensíveis, também deve registrar **quem acessou e por qual finalidade**. Append-only e política de retenção são decisões futuras; não existem hoje.

## ETAPA 11 — Sessões e guards administrativos

| Camada | Comportamento encontrado | Consequência para Staff |
|---|---|---|
| `proxy.ts` | `getUser()`, consulta `users.role`, falha fechada em 503; role fora de `AccountRole` redireciona ao login. Matcher cobre `/restaurant`, `/worker`, `/chat`, `/checkin`, `/checkout`, `/payment`, `/reviews`, `/notifications`, `/settings`, `/profile`. | ❌ `/admin` não existe nem está no matcher; adicionar apenas uma página não a protege. |
| `lib/auth/routes.ts` | `AccountRole = 'restaurant' | 'worker'`; `canAccessPath` bloqueia o prefixo do outro papel. | ✅ A arquitetura atual não comporta o papel administrativo no guard de conta. |
| `lib/auth/account.ts` | Lê `users.role`, provisiona com `ensure_account_profile` opcional e rejeita role desconhecido. | Staff não deve passar por essa resolução de role de produto. |
| `app/components/session-guard.tsx` | Validação de sessão e role no cliente para caminhos considerados protegidos. | Guard visual/cliente não pode ser a única autorização administrativa. |
| `/api/**` | Não passa pelo matcher. `authenticatedApiUser()` valida bearer token e usuário, sem validar role Staff. | Cada API precisa autorizar sua ação no servidor/RPC; login autenticado não implica Staff. |
| MFA | Nenhuma integração/configuração de MFA encontrada no fluxo ou nas migrations. | ❌ MFA ativo e política de exigência por Staff são desconhecidos; há dependência potencial de configuração Auth fora do repo. |

**Como Admin seria identificado:** ⚠ por `auth.uid()` autenticado associado a uma atribuição Staff em fonte de verdade separada, checada em cada rota/RPC administrativa. Rejeitar por padrão ausência, revogação e erro de lookup. **O que impede bypass:** não o proxy sozinho; também validação server-side por endpoint, privilégio mínimo da RPC, RLS/grants restritos e proibição de ler/expor segredos no cliente. **MFA:** suportar como requisito de segurança, mas a implementação e estado atual não podem ser inferidos do repositório. Claims JWT poderiam ficar desatualizadas; não devem substituir a verificação revogável no banco sem política explícita de refresh.

## ETAPA 12 — Modelo operacional Staff (proposto, não existente)

Papéis mínimos considerados para o estágio atual: `admin`, `reviewer`, `support`. A separação é inferência de privilégio mínimo apoiada nas operações existentes; papéis `moderator`/`auditor` e seus requisitos ainda não foram comprovados por fluxos de produto.

| Fluxo futuro | Permissão mínima | Entidades envolvidas | Auditoria obrigatória | Risco |
|---|---|---|---|---|
| Admin concede/revoga Staff | Gerir papéis, não autoatribuição | Auth user + relação Staff | Concessão, revogação, ator, alvo, motivo e momento; bootstrap inicial controlado | **CRÍTICO:** escalada de privilégio |
| Reviewer decide verificação | Listar pedidos; ver selfie e dados mínimos; chamar operação de decisão | `worker_profiles`, `storage.objects`, função de review e trilha | Acesso aos dados, decisão, status anterior/novo, motivo e versão concorrente (`updated_at`) | **CRÍTICO:** fraude/biometria |
| Support atende conta | Ver somente dados mínimos; sem selfie/CPF/RG integral por padrão | `users`, preferências, notificações e evidências operacionais | Consulta/alteração relevante e caso de suporte | **ALTO:** exposição de dados |
| Admin suspende/reativa | Gestão de conta (ainda sem modelo/ação existente) | `users`/novo estado de conta e entidades dependentes | Motivo, duração, operador, reativação e recurso | **ALTO:** bloqueio indevido e mudança de regra de acesso |
| Support trata disputa | ❌ Fluxo de disputa não encontrado; `record_operational_payment` é registro operacional, não gateway/console de disputa | `operational_assignments`, reviews/evidências, pagamento registrado | Evidências acessadas, decisão, valores/estado anterior/novo | **ALTO:** conflito entre partes/valores |

Esses fluxos não podem ser tratados como implementados. Antes de operacionalizar, cada permissão precisa de definição de escopo, fronteira de dados, caminho de revogação, responsável e tratamento de falha.

## ETAPA 13 — Matriz de implementação e dependências

| Iniciativa | Objetos já existentes relevantes | Lacunas provadas no repositório | Impacto estimado |
|---|---|---|---|
| Foundation Staff | `auth.users`, `public.users`, `AccountRole`, `proxy.ts`, policies de conta ativa | Tabela/papel Staff, bootstrap, revogação, guard `/admin`, MFA e DDL base completo | **ALTO** |
| Verification Panel | `worker_profiles`, bucket `worker-private`, `submit_own_profile_verification`, `review_profile_verification`, `public_user_directory`, `ProfessionalVerification`/badge | Fila/tela/API, acesso reviewer à selfie, autoria/histórico/motivo e leitura limitada | **ALTO** |
| User Management | `users.deleted_at`, `account_is_active`, `anonymize_account`, `/api/account/delete` e export | Suspensão/bloqueio, gestão de conta e trilha administrativa | **ALTO** |
| Support Console | `notifications`, `push_deliveries`, `checkin_attempts`, `work_location_evidence`, `demand_events`, RPC inbox | Entidade de ticket/caso, UI, ações de suporte, controle de acesso e auditoria | **MÉDIO/ALTO** |
| Audit Logs | Tabelas de eventos de negócio existentes | Entidade administrativa, política append-only, acesso, retenção e UI/consulta | **ALTO** |
| Migrations / baseline | `supabase/migrations/*.sql` (55 arquivos) | Tabelas-base, config/baseline e comparação de estado por ambiente | **CRÍTICO / bloqueador** |

## ETAPA 14 — Critérios de prontidão

| Entrega | Estado | O que precisa ser verdadeiro antes de iniciar implementação |
|---|---|---|
| Fundação do banco | **BLOQUEADO** | DDL/baseline de `users/jobs/applications` recuperado, schema de cada ambiente comparado e migrations ordenadas/reproduzíveis. |
| Foundation Staff | **BLOQUEADO** | Baseline confirmado; estratégia de tabela separada, bootstrap inicial, grant/revogação e caminho de autorização em página/API/RPC definidos. |
| Admin Dashboard | **BLOQUEADO** | Queries/indicadores necessários definidos sobre schema confirmado; endpoints protegidos e projeções de dados mínimos especificados. |
| Verification Review | **PARCIAL** | Máquina de estado e RPC já existem; ainda faltam modelo de ator, histórico/motivo, caminho de leitura de selfie e regras LGPD. O banco remoto e ACLs implantadas precisam ser conferidos. |
| User Management | **BLOQUEADO** | Estado/ações de bloqueio e reativação, limites do Support/Admin, auditoria e semântica independente de `deleted_at` definidos. |
| Audit System | **BLOQUEADO** | Eventos obrigatórios, campos, imutabilidade, retenção, acesso e bootstrap definidos antes de qualquer ação admin. |

### Checklist de saída da Discovery para a Sprint 3.0

- [ ] Exportar **schema-only**, sem dados pessoais, de produção/staging/desenvolvimento.
- [ ] Recuperar a origem/DDL completa de `users`, `jobs`, `applications` e eventuais triggers Auth.
- [ ] Obter histórico de migrations de cada projeto e comparar com os 55 arquivos locais.
- [ ] Validar constraints, FKs, índices, owners, grants, policies e funções ativas no catálogo real.
- [ ] Confirmar por ambiente se as migrations 20261104* foram aplicadas e em que ordem.
- [ ] Aprovar modelo de papéis/permissões, bootstrap inicial e revogação de Staff.
- [ ] Definir política de acesso, mascaramento, retenção e justificativa para CPF/RG/selfie.
- [ ] Especificar eventos e autoria obrigatórios para auditoria antes de autorizar qualquer ação humana.
- [ ] Auditar individualmente APIs e métodos de acesso a dados; o matcher do proxy não as cobre.
- [ ] Definir critério de MFA para Staff com base em configuração Auth real.

## ETAPA 15 — Decisão arquitetural final

1. **Modelo de Staff:** ⚠ relação separada de Staff vinculada à identidade autenticada; manter `users.role` reservado a worker/restaurant.
2. **Autorização:** ⚠ papéis/capacidades com privilégio mínimo; checagem server/database em cada RPC/API; nunca autorizar por role enviada em `user_metadata`, interface ou matcher isolado.
3. **Auditoria:** ⚠ trilha administrativa imutável como pré-requisito da primeira mutação; registrar autoria, motivo, estado anterior/novo e leitura de dados sensíveis.
4. **LGPD:** ⚠ minimização, mascaramento por padrão, acesso de Reviewer separado de Support, acesso temporário a selfie e registro de acesso. ❌ retenção/base jurídica não confirmadas.
5. **`service_role`:** mantê-la somente em rotinas técnicas server-to-server/administrativas estritamente necessárias. Migrar revisão humana para operação que verifique Staff e grave autoria; **não** conceder a função existente diretamente a todos os autenticados. Exclusão Auth/Storage, push e cron podem continuar privilegiados quando restritos a backend, sem transformar credencial de serviço em papel humano.
6. **Primeira migration da Sprint 3.0:** ❌ não existe escolha segura antes de recuperar o baseline. ⚠ Após o baseline, primeira mudança deve estabelecer os objetos Staff e a capacidade de auditoria necessária, sem alterar `users.role`; a ordem exata/atomicidade precisa ser definida contra o schema real.
7. **Primeira funcionalidade:** ⚠ revisão de verificação é o primeiro caso operacional já sustentado por uma RPC e estado existentes. Só deve ser exposta depois de identidade Reviewer, auditoria e leitura privada controlada da selfie estarem definidas.
8. **Riscos que bloqueiam qualquer implementação:** ❌ schema canônico incompleto; ❌ divergência dos ambientes não verificada; ✅ perfil limitado a dois papéis em cadastro/tipos/policies/RPCs; ❌ grants/mecanismo de Staff inexistentes; ❌ decisões de verificação sem autoria; ❌ política administrativa de acesso a dados pessoais e trilha de consulta ausentes.

### Correções importantes em relação ao Readiness Report anterior

- ✅ `rg` **existe** como coluna NOT NULL em `worker_profiles` (`20261014050000_profiles_and_geo.sql`); a afirmação anterior de RG não encontrado estava incorreta.
- ✅ Reenvio após `rejected` é permitido por `submit_own_profile_verification()` quando enviada selfie diferente. A afirmação anterior de reenvio não confirmado estava incorreta.
- ✅ Alteração de CPF, RG ou telefone pelo trigger `guard_worker_verification()` retorna o status a `pending`; a consequência operacional deve ser considerada.
- ✅ `reconcile_*` não é evidência suficiente, por si só, de schema drift entre ambientes. Os arquivos foram analisados por objetivo e objetos: alguns são RPCs restauradas, outro é cron, um não faz DDL e outro explicitamente evita restaurar um guard de geocoding.

**Conclusão final:** o repositório comprova as regras de produto e o acoplamento atual de `worker`/`restaurant`, mas não comprova o schema implantado completo. A Sprint 3.0 pode fechar o desenho Staff, porém a implementação de migration deve aguardar um baseline real; a opção com menor risco para os consumidores atuais é preservar `users.role` e separar a autorização de operadores.
