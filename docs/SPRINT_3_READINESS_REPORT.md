# ExtraChef — Sprint 3.0 Readiness Report

Auditoria final de prontidão. Somente leitura: nenhum código, migration ou arquivo existente foi alterado.
Legenda: ✅ Confirmado · ⚠ Parcialmente conhecido · ❌ Desconhecido. Risco: BAIXO / MÉDIO / ALTO / CRÍTICO.
Documentos base: `docs/EXTRACHEF_MASTER_ARCHITECTURE.md`, `docs/ADMIN_ARCHITECTURE.md`.

---

## ETAPA 1 — Inventário de incertezas

| # | Área | O que sabemos | O que não sabemos | Risco de seguir sem saber |
|---|------|---------------|-------------------|---------------------------|
| 1 | Origem de `users`/`jobs`/`applications` | ✅ Nenhum `CREATE TABLE users` nas 55 migrations; só `ALTER ... ENABLE RLS` (`20261014051000_core_rls.sql:1`) e `ADD COLUMN deleted_at` (`20261015090000_privacy_account_rights.sql:3`) | ❌ DDL real (colunas, CHECK de `role`, FKs, triggers de criação a partir de `auth.users`) | **CRÍTICO** |
| 2 | Reprodutibilidade do banco | ✅ Migrations dependem de tabelas ausentes | ❌ Se existe dump/baseline fora do repo; ❌ drift prod × staging × repo | **CRÍTICO** |
| 3 | CHECK de `users.role` | ✅ Policies `users_insert_self` e `users_insert_self_restrictive` restringem a `worker`/`restaurant` | ❌ Se há CHECK/enum na tabela | ALTO |
| 4 | Máquina de estados de verificação | ✅ Valores `pending/verified/rejected` (`20261014050000_profiles_and_geo.sql:99`) | ⚠ Reenvio após `rejected`; comportamento ao trocar documentos | ALTO |
| 5 | Matcher do `proxy.ts` | ✅ Lido integralmente (Etapa 8) | ❌ Proteção efetiva de `/api/**` por guard próprio em cada rota (não revisado rota a rota nesta etapa) | ALTO |
| 6 | Push: fila/retry | ✅ `push_deliveries`, `record_push_delivery`, rotas `app/api/push/*` | ⚠ Política de retry e monitoramento do dispatch | MÉDIO |
| 7 | Cron operacional | ✅ `process_operational_schedule()` com grant a `service_role` (`20261017030000_operational_trust.sql:530`) | ❌ Alerta em falha; histórico de execuções acessível | MÉDIO |
| 8 | Dados sensíveis para o revisor | ✅ CPF em `worker_profiles` (CHECK `is_valid_cpf`, índice único) | ❌ Armazenamento de RG; ❌ política de mascaramento | ALTO |
| 9 | Volume real de pendências | ✅ Não há view/paginação de fila | ❌ Quantidade atual de `pending` em produção | MÉDIO |
| 10 | Debug em produção | ✅ `app/api/debug/env/route.ts` usa admin client (linha 11) | ❌ Valor de `PUSH_DIAGNOSTICS_ENABLED` em produção | ALTO |
| 11 | Auditoria de ações | ✅ Não existe log administrativo genérico | ❌ Retenção dos logs da Vercel/Supabase | ALTO |

---

## ETAPA 2 — Identidade e papéis

1. **Onde nasce a identidade?** ✅ `auth.users` (Supabase Auth). `proxy.ts` chama `supabase.auth.getUser()`. Espelho em `public.users` (origem do DDL ❌ desconhecida).
2. **Onde o papel é armazenado?** ✅ `public.users.role`, lido em `proxy.ts` (`from('users').select('role')`) e nas policies. Não há `auth.jwt()`/`app_metadata`.
3. **Quem define `worker`/`restaurant`?** ✅ O próprio usuário no cadastro; a policy `users_insert_self` exige `role IN ('worker','restaurant') AND verified=false AND score=5` (`20261014051000_core_rls.sql` ~50–66). ⚠ A atualização posterior do papel não foi confirmada.
4. **Suporta papéis adicionais?** ⚠ No banco, apenas se o CHECK não existir (❌ desconhecido); no app, **não**: `lib/auth/routes.ts` define `AccountRole = 'restaurant' | 'worker'`, e `isAccountRole` redireciona qualquer outro valor para o login com `reason=profile_unavailable` (`proxy.ts`).
5. **Assume obrigatoriamente dois papéis?** ✅ Sim (app, policies, `canAccessPath`).
6. **Dependências da suposição (matriz):**

| Camada | Local | Quantidade / evidência | Efeito de um 3º papel |
|--------|-------|------------------------|-----------------------|
| Policies | `core_rls`, `profiles_and_geo`, `restaurant_events`, `dashboards_notifications`, `worker_estimated_earnings` | ≈ 69 referências a `'worker'`/`'restaurant'` | Staff sem acesso ou comportamento indefinido |
| SQL funções | `20261015030000_chat_read_state.sql:108` | `CASE WHEN role='worker' THEN 'Profissional' ELSE 'Restaurante'` | Staff rotulado "Restaurante" (✅) |
| App | `lib/auth/routes.ts` | `AccountRole`, `canAccessPath`, `dashboardFor` | Tipagem e redirecionamento |
| Middleware | `proxy.ts` | `isAccountRole` | Staff expulso para login |
| Views | `public_user_directory` (redefinida 3×) | ⚠ Contagem por role não levantada | Provável impacto baixo |
| Rotas | `/restaurant/**`, `/worker/**` | Bloqueio por prefixo do papel oposto | `/admin` sem regra |

---

## ETAPA 3 — Tabela `users`

| Pergunta | Resposta |
|----------|----------|
| Onde é criada? | ❌ Desconhecido. Nenhum `CREATE TABLE` no repo |
| Onde é alterada? | ✅ `20261014051000_core_rls.sql:1` (RLS) e `20261015090000_privacy_account_rights.sql:3` (`deleted_at`) |
| Migration inicial? | ❌ Não existe (a mais antiga é de `20261014…`) |
| Dependência externa? | ⚠ Provável criação via Supabase Dashboard/baseline fora do repo (inferência) |
| Reconstrução do zero? | ❌ Não confirmada |
| Divergências migrations × estrutura? | ⚠ As migrations `reconcile_*` indicam divergência real |

**Classificação: ❌ Não reproduzível** (`users`, `jobs`, `applications` — mesma situação).

---

## ETAPA 4 — Migrations de correção (reconcile/restore)

Total ✅ 55 migrations. Encontradas ✅: 10 do tipo reconcile/restore; nenhuma `repair_*`/`fix_*`/`hotfix`.

| Linha do tempo (prefixo) | Migration | Tema |
|--------------------------|-----------|------|
| 20261104000000 | reconcile_checkin_gps | Check-in GPS |
| 20261104010000 | reconcile_verified_profile | Verificação (reaplica `20261103000000`) |
| 20261104020000 | reconcile_worker_earnings | Ganhos estimados |
| 20261104030000 | reconcile_operational_inbox | Caixa operacional |
| 20261104040000 | reconcile_geocoded_locations | Geocoding |
| 20261104050000 | reconcile_restaurant_demand_location | Localização de demanda |
| 20261104060000 | reconcile_talent_interest | Interesse em talentos (96 bytes — arquivo praticamente vazio) |
| 20261104070000 | reconcile_operational_schedule | Agenda operacional |
| 20261104090000 | restore_talent_interest | Restaura talentos |
| 20261104190000 | restore_operational_checkin_gps | Restaura check-in |

Respostas:
1. **Por quê?** ⚠ Provável: migrations anteriores foram aplicadas parcialmente/manualmente em algum ambiente. Todas concentradas em `20261104*`, em um único dia.
2. **O que corrigem?** ✅ Recriam funções/colunas/policies de módulos já migrados (ex.: `reconcile_verified_profile` redefine `review_profile_verification`, linhas 166/182).
3. **Divergência entre ambientes?** ⚠ Provável; ❌ não comprovada sem comparar bancos.
4. **Bugs históricos?** ⚠ `restore_*` sugere remoção/regressão acidental (ex.: check-in GPS restaurado em `20261104190000`).
5. **Risco de drift?** **ALTO** — ✅ evidência indireta; ❌ sem verificação automatizada de schema.

---

## ETAPA 5 — Máquina de estados da verificação

Estados ✅: `pending`, `verified`, `rejected` (CHECK em `20261014050000_profiles_and_geo.sql:99`). `not_started` **não existe** (✅ ausente). Default da coluna é `'pending'` (✅, mesma linha), mesmo sem selfie.

```
(perfil criado: pending, selfie NULL)
        │ submit_own_profile_verification(selfie)   [authenticated]
        ▼
 pending + selfie ──review_profile_verification──► verified
        │             [service_role]  ─────────────► rejected
        │
 verified: submit bloqueado (✅)
 rejected: reenvio ⚠ não confirmado
```

| Pergunta | Resposta |
|----------|----------|
| Transições válidas | ✅ NULL→pending (submit); pending→verified/rejected (review, `p_status IN ('verified','rejected')`, linha 74) |
| Quem altera | ✅ Worker: apenas submit. Revisão: só `service_role` (`20261103000000_verified_profile.sql:92`). Trigger `worker_verification_guard` bloqueia autoaprovação |
| Requisitos p/ `verified` | ✅ telefone, selfie, selfie ≠ foto de perfil, objeto existente em `storage.objects` (`worker-private`), `p_expected_updated_at` (concorrência otimista) |
| Documentos mudam | ⚠ `selfie_verification_path` tem REVOKE de coluna e storage proíbe update/delete (`worker_selfie_no_update/no_delete`); efeito sobre status ao trocar foto de perfil/telefone ❌ não confirmado |
| Rollback | ❌ Não há transição `verified→pending` nem revogação; só via SQL manual |
| Estados órfãos | ⚠ Possíveis: `pending` sem selfie (default); `rejected` sem rota de reenvio; `verified` com selfie apagada (anonimização) |
| Registro do revisor | ❌ Nenhum (sem `reviewed_by`/`reviewed_at`) |

---

## ETAPA 6 — Auditoria de `service_role`

Código (✅):

| Ocorrência | Objetivo | Risco | Alternativa futura | Criticidade |
|-----------|----------|-------|--------------------|-------------|
| `lib/supabase/admin.ts` (`server-only`, loga `supabase_admin_initialized`) | Cliente admin central | ALTO | Manter restrito; remover usos de leitura | ALTO |
| `app/api/account/delete/route.ts` | Excluir conta (não atômico) | ALTO | RPC única transacional | ALTO |
| `app/api/push/dispatch`, `receipt`, `status`, `subscriptions` | Envio, recibos, status, inscrições | MÉDIO | Segredo de cron + RPC com grants mínimos | MÉDIO |
| `app/api/debug/env/route.ts` | Diagnóstico de env | **ALTO** | Remover em produção | ALTO |
| `lib/geocoding/index.ts` | Cache/requests de geocoding | MÉDIO | Manter em server; RPC dedicada | MÉDIO |

SQL (✅ grants a `service_role`): `record_push_delivery`, tabelas `push_deliveries`/`push_subscriptions`/`notification_preferences`, `anonymize_account`, `process_operational_schedule`, `review_profile_verification`, `geocoding_cache`/`geocoding_requests`/`release_geocoding_request`.

Respostas:
1. **Depende de `service_role`:** push, geocoding, exclusão/anonimização, cron operacional, **revisão de verificação**.
2. **Deveria depender de Admin:** anonimização/exclusão acionada por suporte; ações manuais de conta.
3. **Deveria depender de Reviewer:** `review_profile_verification` (hoje sem identificação do ator).
4. **Removível futuramente:** `debug/env`; leituras administrativas feitas por SQL manual. Push, geocoding e cron seguem sistêmicos.

---

## ETAPA 7 — Impacto em RLS

1. ✅ ≈ 69 referências a `worker`/`restaurant` em policies (contagem aproximada, por texto).
2. **Precisarão mudar:** policies de `users`, `worker_profiles`, eventos, notificações, chat, ganhos, e storage privado (selfie só acessível pelo dono, `worker_selfie_private`).
3. **Podem quebrar com Staff:** ⚠ funções como `chat_read_state:108` (rotulagem). Policies com `role='worker'` negam por omissão (falha segura, mas Staff sem acesso).
4. **Isolamento:** ⚠ Princípio de "Staff fora de `users.role`" evita tocar nas ≈ 69 referências; ❌ ainda não validado contra o DDL real de `users`.

Relatório de impacto: Staff **não herdaria** acesso a dados (nega por padrão) — impacto de quebra BAIXO; impacto de *funcionalidade* ALTO (toda leitura administrativa exigiria novas policies/RPCs).

---

## ETAPA 8 — Sessões e guards

Lido integralmente: `proxy.ts`. ✅

- Fluxo: `getUser()` → erro 5xx → 503; sem usuário → redirect login (`session_expired` se havia cookie); consulta `users.role`; erro → 503; papel inválido → login `profile_unavailable`; `canAccessPath` → redirect com `role_forbidden`.
- **Matcher ✅:** `/restaurant`, `/worker`, `/chat`, `/checkin`, `/checkout`, `/payment`, `/reviews`, `/notifications`, `/settings`, `/profile`.

| Pergunta | Resposta |
|----------|----------|
| Como é protegido? | ✅ Proxy + RLS; fail-closed em erros |
| Onde entraria um Admin? | ✅ Novo prefixo no matcher + novo valor em `AccountRole`/`canAccessPath` (ou checagem separada) |
| Risco de bypass | ✅ Qualquer rota fora do matcher **não passa pelo proxy** (ex.: futuro `/admin`) |
| Matcher protege tudo? | ❌ **Não**: `/api/**` e `/account/**` ficam fora |
| APIs protegidas? | ⚠ Dependem de guard próprio (`lib/auth/api-user.ts`); cobertura por rota não verificada exaustivamente |

Classificação: proxy **sólido para o que cobre**; cobertura **PARCIAL** (⚠, risco ALTO para `/api/push/*`, `/api/debug/env`).

---

## ETAPA 9 — Notificações

| Pergunta | Resposta |
|----------|----------|
| Falhas | ✅ `record_push_delivery` registra entrega em `push_deliveries`; ⚠ tratamento por tipo de erro não detalhado |
| Fila | ⚠ `push_deliveries` funciona como registro; ❌ fila dedicada não confirmada |
| Retry | ❌ Não confirmado |
| Monitoramento | ⚠ `app/api/push/status` expõe estado; ❌ sem alerta |
| Painel operacional | ✅ Necessário e ❌ inexistente |

Receipts: ✅ `app/api/push/receipt`. Dispatch: ✅ `app/api/push/dispatch` (service_role).

---

## ETAPA 10 — Logs

1. Eventos: ✅ tabelas `demand_events`, `push_deliveries`, `checkin_attempts`, `work_location_evidence`, `legal_acceptances`, `privacy_preferences`, `geocoding_requests` (sem UI).
2. Logs estruturados: ⚠ `console.error('auth_request_failed', {...})` com chave+objeto, sem coletor; ❌ Sentry/alertas.
3. Logs de auditoria administrativa: ❌ Ausentes.
4. **Quem aprovou verificações?** ❌ Não registrado (`review_profile_verification` só atualiza `verification_status` e `updated_at`).
5. Quem alterou status? ❌ Não registrado.
6. Ações críticas: ❌ Só logs de plataforma (retenção desconhecida).

Lacunas: **CRÍTICA** (autoria de aprovação), ALTA (alertas), MÉDIA (estruturação).

---

## ETAPA 11 — Storage privado

| Pergunta | Resposta |
|----------|----------|
| Itens | ✅ Selfie em bucket `worker-private`; ⚠ foto/currículo (`profile_photo_path`, `resume_pdf_path`) com bucket não confirmado |
| Quem acessa | ✅ Apenas o dono (`worker_selfie_private`); sem update/delete |
| Como acessa | ✅ Path em `selfie_verification_path`, coluna com REVOKE |
| Reviewer | ❌ Sem mecanismo; hoje via Dashboard/`service_role` |
| Rastreabilidade | ❌ Acesso não registrado |
| Risco LGPD | **ALTO** — biometria facial (dado sensível) sem log de acesso nem base documentada de retenção; ❌ política de retenção não localizada |

---

## ETAPA 12 — Operação real

| Cenário | Evidência | Gargalo |
|---------|-----------|---------|
| 100 pendentes | ✅ Sem view/fila | Dashboard + SQL manual viável, lento; sem autoria |
| 500 | ✅ Sem paginação/priorização/SLA | Revisão humana serial; sem notificação ao worker do resultado ⚠ |
| 5.000 | ✅ Sem filtros, sem atribuição, sem métricas | Inviável manualmente; risco de fraude e de abandono; abrir selfie uma a uma por URL assinada |

Índice parcial `worker_profiles_selfie_path_idx` ✅ existe; ❌ não há índice dedicado a `verification_status='pending'` por data (⚠ não confirmado).

---

## ETAPA 13 — Dependências do painel admin

| Módulo | Tabelas | Views | RPCs | APIs | Componentes |
|--------|---------|-------|------|------|-------------|
| Dashboard | `users`, `worker_profiles`, `push_deliveries`, `demand_events` | ❌ nenhuma de métricas | ❌ | ❌ | ❌ |
| Verificações | `worker_profiles`, `storage.objects` | ❌ fila | ✅ `review_profile_verification` (service_role) | ❌ | ❌ |
| Usuários | `users`, `worker_profiles`, restaurantes | `public_user_directory` (parcial) | ✅ `anonymize_account` | ✅ `account/delete` | ❌ |
| Auditoria | ❌ `admin_audit_log` inexistente | ❌ | ❌ | ❌ | ❌ |
| Suporte | `checkin_attempts`, `work_location_evidence` | ❌ | ❌ | ❌ | ❌ |
| Logs | `push_deliveries`, `geocoding_requests` | ❌ | ✅ `record_push_delivery` | ✅ `push/status` | ❌ |

---

## ETAPA 14 — Roadmap técnico real (ordem baseada em evidência)

1. **Eliminar incertezas críticas:** obter DDL real de `users`/`jobs`/`applications` (baseline) e comparar com produção; ✅ bloqueia tudo.
2. **Corrigir riscos críticos/altos:** `debug/env`, `account/delete` não atômico, cobertura de `/api/**`.
3. **Foundation Staff:** papel/estrutura (sem tocar ≈ 69 policies), guard e matcher para `/admin`.
4. **Auditoria:** autoria obrigatória antes de qualquer ação administrativa (hoje inexistente).
5. **Painel de Verificações:** primeira entrega com valor (RPC já existe; falta ator, fila e acesso à selfie).
6. **Dashboard Admin** e **7. Operações de suporte.**

Justificativa: sem o item 1 não é possível validar migrations; sem o item 4 o painel repetiria a ausência de rastreabilidade.

---

## ETAPA 15 — Decisão final

| Iniciativa | Veredito | Justificativa |
|------------|----------|---------------|
| Foundation Staff | ⚠ | Padrão de role/RLS conhecido; DDL de `users` desconhecido; matcher exige extensão |
| Admin Dashboard | ❌ | Sem métricas, views nem estrutura |
| Verification Review Panel | ⚠ | RPC e storage prontos; faltam ator, fila, acesso à selfie e regras de rejeição/reenvio |
| User Management | ❌ | Só `anonymize_account`/`account/delete`; sem bloqueio/suspensão |
| Support Operations | ❌ | Sem fluxos de denúncia/disputa; dados existentes sem UI |
| Audit Logs | ⚠ | Tabelas de eventos existem; log administrativo ausente |

---

## Checklist de entrada da Sprint 3.0

- [ ] Obter baseline/DDL de `users`, `jobs`, `applications` (❌ → ✅)
- [ ] Confirmar CHECK/enum de `users.role` no banco real
- [ ] Comparar schema produção × staging × migrations (drift)
- [ ] Confirmar `PUSH_DIAGNOSTICS_ENABLED` em produção e remover `debug/env`
- [ ] Definir fluxo de `rejected` → reenvio e efeito de trocar documentos
- [ ] Auditar guard de cada rota `/api/**`
- [ ] Definir política de retenção e acesso à selfie (LGPD)
- [ ] Levantar volume atual de `pending`
- [ ] Confirmar retry do dispatch e alerta do cron

**Primeira entrega administrativa recomendada:** autoria + acesso controlado às verificações (reviewer identificado, `reviewed_by/at`, fila paginada), precedida da resolução do DDL base.
