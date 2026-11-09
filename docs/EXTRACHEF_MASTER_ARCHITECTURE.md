# EXTRACHEF — Master Architecture (Discovery 3.0)

Auditoria somente-leitura. Legenda: ✅ Confirmado · ⚠ Inferência provável · ❌ Não encontrado.
Stack: Next.js 16.4.5 (App Router, `proxy.ts`), Supabase (Auth, Postgres, Storage, Realtime, pg_cron), Web Push (VAPID), PGlite para testes SQL, Playwright + axe.
Migrations: 55 arquivos em `supabase/migrations/` (20261014000000 → 20261106040000).

---

## ETAPA 1 — Inventário estrutural

### 1.1 Estrutura geral

| Diretório | Status | Responsabilidade |
|---|---|---|
| `app/` | ✅ | Rotas (páginas, APIs), componentes (`app/components/`, 33 arquivos), clientes colados às rotas |
| `lib/` | ✅ | Regras de domínio, auth, supabase, geocoding, locations, postal-code, validations |
| `supabase/migrations/` | ✅ | Schema, RLS, RPCs, triggers, storage, cron |
| `tests/` | ✅ | `*.test.mjs` (unit/SQL via PGlite), `tests/e2e` (Playwright) |
| `docs/` | ✅ | 30 documentos + `homologation/` |
| `public/` | ✅ | Assets, `sw.js` (service worker de push) — não auditado linha a linha |
| `proxy.ts` | ✅ | Substitui `middleware.ts` (Next 16) |
| `components/`, `hooks/`, `contexts/`, `providers/` na raiz | ❌ | Não existem. Não há React Context/provider global; layout único `app/layout.tsx` |
| `middleware.ts` | ❌ | Ausente (função cumprida por `proxy.ts`) |
| `app/error.tsx`, `loading.tsx`, `not-found.tsx`, `global-error.tsx` | ❌ | Nenhum encontrado em `app/` |
| Migration `CREATE TABLE` de `users`, `jobs`, `applications` | ❌ | Nenhuma migration cria essas tabelas (apenas ALTER/RLS em `20261014051000_core_rls.sql`). O schema base vive fora do repositório → **não reproduzível a partir do repo** |

### 1.2 Árvore da arquitetura

```
proxy.ts ──► lib/auth/routes.ts, lib/supabase/request.ts
app/
 ├─ layout.tsx, manifest.ts
 ├─ (públicas) page, login, register, privacy, terms, auth/callback
 ├─ restaurant/{dashboard,demands,candidates,history,locations,messages,more,profile,team}
 ├─ worker/{applications,dashboard,invitations,messages,profile}
 ├─ chat|checkin|checkout|payment|reviews/[jobId], notifications, profile, settings/*
 ├─ api/{account,checkin,debug,geocode,locations,postal-code,push}
 └─ components/ (33)  + clientes por rota
lib/ auth, supabase(admin|client|request), geocoding, locations, postal-code, validations,
     domínio: demands, operations, communication, profile-verification, push-*, talent-board...
supabase/migrations → tabelas, RPCs (SECURITY DEFINER), RLS, triggers, cron
```

### 1.3 Separação de responsabilidades

- ✅ Autorização de rota por papel: `proxy.ts` + `lib/auth/routes.ts`.
- ✅ Regras de negócio críticas no banco (RPCs/triggers), não no front: `approve_application`, `register_worker_checkin`, `record_operational_payment`, `guard_recruitment_job`.
- ✅ Service role isolado em `lib/supabase/admin.ts` (`server-only`).
- ⚠ Acoplamento: diagnósticos de push dentro de `admin.ts` (`admin-env-v2`).
- ⚠ Componentes provavelmente redundantes: `professional-verification.tsx` × `profile-verification.tsx`; `worker-profile-experience.tsx` (12 linhas) e `worker-profile-redirect.tsx` (23 linhas).

### 1.4 Mapa de dependências (resumo)

| Módulo | Depende de | Consumido por |
|---|---|---|
| `proxy.ts` | `lib/auth/routes`, `lib/supabase/request`, tabela `users` | Todas as rotas protegidas |
| `lib/supabase/admin.ts` | env `SUPABASE_SERVICE_ROLE_KEY` | `api/account/*`, `api/push/*` |
| `lib/auth/api-user.ts` | Supabase Auth (Bearer) | `api/account/*`, `api/push/subscriptions` |
| `lib/locations/server.ts` | `lib/geocoding`, RPCs | `api/locations`, `api/postal-code` |
| `lib/geocoding/*` | Photon, `geocoding_cache`, `acquire_geocoding_request` | `api/geocode` |
| `lib/profile-verification.ts` | RPC `submit_own_profile_verification`, bucket `worker-private` | `professional-verification`, `profile-verification` |
| `session-guard.tsx` | Supabase client (cliente) | `app/layout.tsx` ⚠ (conferir) |

---

## ETAPA 2 — Mapeamento de rotas

| Classe | Rotas | Proteção |
|---|---|---|
| Pública ✅ | `/`, `/login`, `/register`, `/privacy`, `/terms`, `/auth/callback` | Nenhuma (por design) |
| Autenticada compartilhada ✅ | `/profile`, `/notifications`, `/settings/*`, `/chat|checkin|checkout|payment|reviews/[jobId]` | `proxy.ts` (qualquer papel válido) |
| Restaurant ✅ | `/restaurant/*` | `proxy.ts` + `canAccessPath` |
| Worker ✅ | `/worker/*` | `proxy.ts` + `canAccessPath` |
| Admin ❌ | Nenhuma rota `/admin` | — |
| APIs ✅ | `account/delete`, `account/export`, `checkin`, `debug/env`, `geocode`, `locations(/[id])`, `postal-code/[cep]`, `push/{dispatch,receipt,status,subscriptions}` | **Fora do matcher do proxy**; cada rota autentica por conta própria |

**Proxy (✅ `proxy.ts`)**: `supabase.auth.getUser()`; erro 5xx/sem status → 503 fail-closed; sem usuário → `/login?redirect=…` (+`reason=session_expired`); lê `users.role`; papel inválido → `reason=profile_unavailable`; papel cruzado → `<dashboard>?reason=role_forbidden`. Matcher: `/restaurant, /worker, /chat, /checkin, /checkout, /payment, /reviews, /notifications, /settings, /profile`.

**Guards ✅**: `sanitizeRedirect` (`lib/auth/routes.ts`) rejeita `//`, `\`, controles, `%`, prefixos não protegidos.

**Riscos de rota**
- ⚠ MÉDIO — `canAccessPath` só bloqueia o prefixo cruzado; rotas compartilhadas (`/chat/[jobId]`, `/payment/[jobId]`) dependem 100% de RLS/RPC para autorizar o `jobId`.
- ✅ BAIXO — APIs não passam pelo proxy; estratégia mista Bearer (`account`, `push`) × cookie (`geocode`, `locations`, `postal-code`).
- ✅ MÉDIO — `/api/debug/env` sem autenticação quando `PUSH_DIAGNOSTICS_ENABLED=true`.

---

## ETAPA 3 — Autenticação e autorização

1. ✅ **Como funciona**: Supabase Auth (e-mail/senha). Callback `app/auth/callback/route.ts` → `exchangeCodeForSession`; recovery → `PASSWORD_RESET_PATH`; signup → `getAccountRole` + `sanitizeRedirect`. Arquivos: `lib/auth/{routes,account,logout,password-recovery,api-user}.ts`, `lib/supabase/{client,request,admin}.ts`.
2. ✅ **Perfis**: coluna `users.role`; trigger `users_record_legal_acceptance` (`20261015090000_privacy_account_rights.sql`) registra aceite legal.
3. Diferenciação de papéis:

| Papel | Status | Evidência |
|---|---|---|
| worker | ✅ | `AccountRole` em `lib/auth/routes.ts` |
| restaurant | ✅ | idem |
| admin | ❌ | Não existe no tipo, proxy, nem RLS de app |
| moderator | ❌ | — |
| support | ❌ | — |

4. **Suporte a admin**: ❌ no app. Só `service_role` (RPC `review_profile_verification` é `service_role`-only).
5. **Brechas possíveis**:
   - ⚠ MÉDIO: `account/delete` não atômico (storage → `anonymize_account` → signOut → `deleteUser`). Falha parcial retorna 500 "contate o suporte".
   - ⚠ MÉDIO: sem rate limit próprio em `push/subscriptions`, `account/*`, `push/receipt` (público, protegido por HMAC).
   - ✅ BAIXO: `push/status` expõe booleanos de configuração a qualquer usuário autenticado.
   - ⚠ BAIXO: dupla estratégia de sessão (cookie × Bearer).

**Fluxograma**
```
Registro ─► Supabase signUp ─► e-mail ─► /auth/callback?code ─► exchangeCodeForSession
   └► users(role) + legal_acceptances(trigger) ─► sanitizeRedirect ─► dashboard do papel
Login ─► signIn ─► cookie sb-*-auth-token ─► proxy.getUser ─► users.role ─► canAccessPath
Recuperação ─► e-mail ─► /auth/callback(flow=recovery) ─► /settings/password
Sessão expirada ─► proxy: /login?reason=session_expired ; client: session-guard.tsx
```

---

## ETAPA 4 — Inventário do banco

> Fonte: `supabase/migrations/*.sql`. ❌ `users`, `jobs`, `applications` sem `CREATE TABLE` no repo.

### 4.1 Tabelas

| Tabela | Objetivo | Migration | Criticidade |
|---|---|---|---|
| `users` | Identidade/papel | (base) + `20261014051000_core_rls` | CRÍTICA |
| `jobs` | Vagas/turnos | (base) + `…operational_demands` | CRÍTICA |
| `applications` | Candidaturas | (base) + `…approve_application…` | CRÍTICA |
| `worker_profiles` | CPF, RG, selfie, verificação (REVOKE ALL a anon/authenticated) | `20261014050000_profiles_and_geo` / `20261103000000_verified_profile` | CRÍTICA |
| `restaurant_profiles` | CNPJ, dados do restaurante | `20261014050000` | CRÍTICA |
| `operational_assignments` | Contratação operacional | `20261017030000_operational_trust` | CRÍTICA |
| `operational_codes` | Códigos de check-in/out | idem | CRÍTICA |
| `checkins` / `checkouts` | Presença | `…job_checkins`, `…job_checkouts` | ALTA |
| `checkin_attempts`, `work_location_evidence` | Evidência GPS / tentativas | `20261105030000_learning_operational_geolocation` | ALTA |
| `reviews` | Avaliações | `…job_reviews` | ALTA |
| `messages` | Chat | `…job_chat` | ALTA |
| `notifications` | Notificações internas | `…dashboards_notifications` | ALTA |
| `push_subscriptions`, `push_deliveries`, `notification_preferences` | Push | `20261014055000`, `20261015000000` | ALTA / MÉDIA |
| `work_locations` | Locais de trabalho geocodificados | `20261015060000` | ALTA |
| `events` | Eventos do restaurante | `20261015010000` | MÉDIA |
| `demand_reserves`, `demand_events`, `demand_invitations`, `talent_connections` | Demandas e talentos | `20261017010000`, `20261017020000` | ALTA / MÉDIA |
| `privacy_preferences`, `legal_acceptances` | LGPD | `20261015090000` | ALTA |
| `geocoding_cache`, `geocoding_requests` | Cache e quota | `20261104200000` | MÉDIA |

### 4.2 Views
- ✅ `public_user_directory` — redefinida 3× (`20261015090000`, `20261103000000`, `20261104010000`). Consumo: diretório de talentos / selo de verificação. Impacto: ALTO (exposição pública de dados mínimos).

### 4.3 Functions (✅ 171 ocorrências `SECURITY DEFINER`, 185 `SET search_path` nas migrations)
- **Críticas**: `approve_application`, `register_worker_checkin/checkout`, `validate_operational_code`, `record_operational_payment`, `interrupt_operational_assignment`, `anonymize_account`, `export_own_account_data`, `review_profile_verification` (service_role), `submit_own_profile_verification`, `create_restaurant_demand`.
- **Operacionais**: `process_operational_schedule` (pg_cron), `record_push_delivery`, `acquire_geocoding_request`, `account_is_active`, `can_request_account_deletion`, `demand_talent_directory`, `restaurant_talent_directory`, `restaurant_operational_message_inbox`, `worker_operational_reputation`, `recruitment_*`.
- **Auxiliares**: `is_valid_cpf`, `is_valid_cnpj`, `record_demand_activity`, `bind_message_assignment`.
- ⚠ Conferência pendente: cada `SECURITY DEFINER` tem `SET search_path`? (185 ≥ 171 sugere cobertura, mas contagem não prova 1:1).

### 4.4 Triggers (✅ ~38)
Notificação: `applications_notify_{approved,received}`, `messages_notify_recipient`, `checkins/checkouts_notify_restaurant`, `reviews_notify_reviewed_user`. Reputação: `reviews_update_user_score`. Auditoria de demanda: `*_demand_activity` (jobs, applications, reserves, invitations, checkins, checkouts, reviews → `demand_events`). Guardas: `applications_require_open_job`, `jobs_guard_recruitment`, `worker_verification_guard`, `reject_deleted_account_write` (dinâmico por tabela), `jobs_guard_operational_location`, `applications/assignments/invitations_guard_operational_location`, `jobs_require_resolved_location`, `work_locations_attest_geocoding`, `work_locations_require_operational_address`, `reviews_relationship_answer`, `jobs_operational_reviews`, `applications_00_operational_reviews`, `applications_operational_hire`, `jobs_prepare_geocoded_location`, `operational_codes_capture_checkin_evidence`, `messages_bind_assignment`, `messages_initialize_read_state`, `users_record_legal_acceptance`, `events_set_updated_at`.

### 4.5 Índices (✅ ~35)
`messages_job_created_at_idx`, `notifications_user_created_at_idx`, `worker_profiles_cpf_unique`, `restaurant_profiles_cnpj_unique`, `push_subscriptions_user_id_idx`, `work_locations_one_default_idx`, `operational_one_current_assignment`, `demand_invitation_{normal,replacement}`, `geocoding_cache_expiry_idx`, `checkin_attempts_{job,worker}_time_idx`, `worker_profiles_selfie_path_idx`, etc.
Possíveis gargalos (⚠): sem índice localizado para `push_deliveries` (consulta de idempotência por notification+subscription), `applications(job_id/worker_id)` e `jobs(status,job_date)` — podem estar na base externa (não verificável).

### 4.6 Policies / RLS
- ✅ RLS habilitada em: messages, checkins, checkouts, reviews, notifications, worker/restaurant_profiles, users, jobs, applications, push_subscriptions, notification_preferences, push_deliveries, events, work_locations, privacy_preferences, legal_acceptances, demand_reserves, demand_events, talent_connections, demand_invitations, operational_assignments, operational_codes, geocoding_cache, geocoding_requests, work_location_evidence, checkin_attempts.
- ⚠ Sem `ENABLE RLS` localizado: `operational_*` auxiliares criados fora dessa lista; verificar a tabela `profiles` citada em docs (não localizada).
- ✅ Storage: buckets `worker-private` e `restaurant-assets` (este tornado privado em `20261015090000`). Policies owner (select/insert/update/delete), `worker_private_chat_profile_photo`, `profile_media_visibility` (RESTRICTIVE), seletivas de selfie (`worker_selfie_private/no_update/no_delete`).
- ⚠ Policy `restaurant_assets_public_read` criada em `20261014050000` e bucket depois privado — conferir se foi removida (risco BAIXO/MÉDIO).

---

## ETAPA 5 — Matriz de dependências

```
Profile Verification (worker_profiles.selfie_*)
├─ trigger worker_verification_guard ─ impede auto-aprovação
├─ public_user_directory (selo)       impacto ALTO
├─ restaurant_talent_directory / demand_talent_directory
├─ Storage worker-private + policies
└─ review_profile_verification (service_role)  → sem UI
```

| Módulo | Dep. diretas | Dep. indiretas | Consumidores | Impacto de mudança |
|---|---|---|---|---|
| `users.role` | Auth | proxy, RLS, geocode | Todo o app | CRÍTICO |
| `jobs`/`applications` | triggers de guarda/notificação | demand_events, push | restaurante/worker | CRÍTICO |
| `operational_assignments` | approve_application | chat, check-in, reputação, pagamento | operação | CRÍTICO |
| `notifications` | triggers | push dispatch, realtime, bell | todos | ALTO |
| `work_locations` | geocoding | jobs snapshot, check-in GPS | demandas, check-in | ALTO |
| `public_user_directory` | users, worker_profiles | matching/talentos | restaurante | ALTO |
| `geocoding_*` | Photon | work_locations | cadastro de locais | MÉDIO |
| `privacy_*` | users | export/delete | conta | MÉDIO |

---

## ETAPA 6 — Fluxos de negócio

| Fluxo | Páginas | APIs / RPC | Tabelas | Triggers/Notif. |
|---|---|---|---|---|
| Cadastro ✅ | `/register`, `/auth/callback` | Supabase Auth | users, legal_acceptances | `users_record_legal_acceptance` |
| Login ✅ | `/login` | Auth, proxy | users | — |
| Perfil ✅ | `/profile*`, `profile-editor` | RPC/tabela direta | worker/restaurant_profiles | `is_valid_cpf/cnpj` |
| Demanda ✅ | `/restaurant/demands`, `dashboard/jobs/create` | `create_restaurant_demand`, `/api/geocode` | jobs, demand_reserves, work_locations | `jobs_guard_recruitment`, location guards |
| Candidatura ✅ | `/worker/applications` | tabela `applications` | applications | `applications_require_open_job`, `applications_notify_received` |
| Convite ✅ | `/worker/invitations` | RPC | demand_invitations, talent_connections | `invitations_demand_activity` |
| Aprovação ✅ | `/restaurant/demands/[id]` | `approve_application` | operational_assignments | `applications_notify_approved`, `applications_operational_hire` |
| Chat ✅ | `/chat/[jobId]`, `/…/messages` | Realtime (`messages`) | messages | `messages_notify_recipient`, `bind_message_assignment` |
| Check-in ✅ | `/checkin/[jobId]` | `/api/checkin`, `register_worker_checkin` | checkins, checkin_attempts, operational_codes | `checkins_notify_restaurant` (429 e 403/42501 tratados) |
| Checkout ✅ | `/checkout/[jobId]` | RPC | checkouts | `checkouts_notify_restaurant` |
| Pagamento ⚠ | `/payment/[jobId]` | `record_operational_payment` | operational_assignments | Somente **registro** manual; ❌ gateway |
| Avaliação ✅ | `/reviews/[jobId]` | tabela `reviews` | reviews | `reviews_notify_reviewed_user`, `reviews_relationship_answer` |
| Reputação ✅ | `operational-reputation.tsx` | `worker_operational_reputation` | users.score, reviews | `reviews_update_user_score` |
| Verificação ✅/⚠ | `profile-verification.tsx` | `submit_own_profile_verification` | worker_profiles, storage | guard; revisão só service_role |

**Fluxo operacional**
```
Demanda ─► vaga(jobs) ─► candidatura/convite ─► approve_application ─► operational_assignment
 ─► chat ─► código operacional ─► check-in (GPS) ─► check-out ─► pagamento(registro) ─► review ─► reputação
        └─ process_operational_schedule (pg_cron, 1 min) fecha/expira
```

---

## ETAPA 7 — Notificações

- **Nascimento** ✅: triggers SQL inserem em `notifications` (item 4.4).
- **Entrega interna** ✅: Realtime (`supabase_realtime` inclui `notifications` e `messages`) → `notification-bell.tsx`, `notification-center.tsx`, `notification-experience.tsx`.
- **Push** ✅: Database Webhook → `POST /api/push/dispatch` (segredo `x-extra-chef-webhook-secret`, `timingSafeEqual`), checa preferências por categoria (`notification_preferences`), idempotência via `push_deliveries`, VAPID, TTL 300 s/timeout 10 s, remove assinatura em 404/410. Recibo: `/api/push/receipt` (HMAC).
- **Preferências** ✅: `notification_preferences`, `settings-components.tsx`.
- **Histórico** ✅: `notifications`, `push_deliveries`.
- **Leitura** ✅: `read_at`, marcação em UI; `messages_unread_idx`.
- **Falhas** ⚠: status `failed` registrado em `push_deliveries` via `record_push_delivery`; API devolve 502; ❌ sem retry, fila ou dead-letter. Se o webhook falhar antes do handler, nenhum rastro.
- **Rastreabilidade** ✅ parcial: `/api/push/status` com `requestId`/`X-Request-Id`; logs só `console.*`.

---

## ETAPA 8 — Verificação profissional

- ✅ Selfie via `camera-capture.tsx` → bucket privado `worker-private` (`<userId>/…`) → `worker_profiles.selfie_verification_path` (coluna com REVOKE) → `submit_own_profile_verification` → status → `review_profile_verification` (**service_role only**) → selo `verified-profile-badge.tsx` / `public_user_directory`.
- Policies RESTRICTIVE impedem update/delete e leitura por terceiros (`20261103000000`, `20261104010000`).

| Pergunta | Resposta |
|---|---|
| Processo completo? | ⚠ Submissão e armazenamento completos; revisão sem UI |
| Painel administrativo? | ❌ |
| Revisão manual? | ✅ Prevista (RPC), executada via SQL/service_role |
| Risco de fraude | ⚠ Selfie sem comparação com documento nem liveness; ❌ não há OCR/biometria; CPF/CNPJ validados só por dígito verificador |
| Gargalos | ✅ Fila manual sem ferramenta, sem SLA, sem notificação de resultado confirmada |
| Escala | ❌ Não preparada (operacional humano, sem fila) |

---

## ETAPA 9 — Segurança

| # | Achado | Evidência | Severidade |
|---|---|---|---|
| 1 | `debug/env` sem auth com flag ligada; vaza tamanho do service-role | `app/api/debug/env/route.ts` | MÉDIO (BAIXO se flag off) |
| 2 | `// TEMP DEBUG` em geocode: log a cada etapa + header `X-Geocode-Debug-Stage` | `app/api/geocode/route.ts` | MÉDIO |
| 3 | `supabase_admin_initialized` logado a cada instância | `lib/supabase/admin.ts` | BAIXO |
| 4 | `account/delete` não atômico | `app/api/account/delete/route.ts` | MÉDIO |
| 5 | Sem rate limit em APIs (exceto checkin/geocode via RPC) | rotas `push/*`, `account/*`, `postal-code` | MÉDIO |
| 6 | APIs fora do proxy; estratégias mistas | `proxy.ts` matcher | BAIXO |
| 7 | `push/status` expõe config a autenticados | `push/status/route.ts` | BAIXO |
| 8 | Endpoint CEP depende de provedor externo, 503 em falha | `lib/postal-code` | BAIXO |
| 9 | Sem papel admin → operações sensíveis exigem service_role | RPCs | ALTO (operacional) |
| 10 | Policy pública do bucket `restaurant-assets` possivelmente residual | `20261014050000` | ⚠ BAIXO |
| 11 | Mojibake em mensagens (`FaÃ§a`) e `lib/specialties.ts` (`GarÃ§om`) | idem | BAIXO |

✅ Pontos fortes: fail-closed no proxy; `sanitizeRedirect`; `server-only` no admin; allowlist de hosts de push + validação de chaves p256dh/auth; HMAC + `timingSafeEqual`; `.env*` no `.gitignore` (`!.env.example`); REVOKE em `worker_profiles`; RPCs com `SECURITY DEFINER` + `search_path`; `no-store` nas respostas sensíveis; reautenticação por senha na exclusão.
Pendente de verificação: `git ls-files` para `.env*` (✅ ignorados; arquivos não rastreados: `build-error.log`, `baseline-commit.txt`, `diff-stat.txt`, `.agents/`, `.codestudio/`). Sanitização de input de chat/avaliação: ⚠ não confirmada em UI (React escapa por padrão).

---

## ETAPA 10 — Testes

Scripts: `npm test` → `node --test tests/*.test.mjs`; `test:push`; `test:privacy:sql`; Playwright + `@axe-core/playwright`; PGlite.

| Fluxo | Cobertura | Evidência |
|---|---|---|
| Cadastro | ⚠ `auth-*`, `password-recovery`; ❌ e2e de registro | `tests/auth-*.test.mjs` |
| Vagas/demandas | ✅ | `demands`, `demands-sql`, `recruitment-sql` |
| Candidaturas | ✅ SQL | `recruitment-sql`, `operation-core-*` e2e |
| Convites | ✅ | `talent-interest-sql`, `talent-directory-sql` |
| Chat | ⚠ unit (`communication`, `message-navigation`); ❌ e2e/Realtime | — |
| Check-in | ✅ | `checkin-api`, `geolocation(-sql)` |
| Checkout | ⚠ via e2e operação | `operation-core-*` |
| Pagamentos | ⚠ apenas `operational-trust-sql` | ❌ UI/API dedicada |
| Avaliações | ⚠ `review-uniqueness-proposal`, `operational-trust-sql` | — |
| Verificações | ✅ | `profile-verification(-sql)` |
| Push | ⚠ `push-privacy`, `push-status`; ❌ `dispatch`, `receipt`, `subscriptions` | — |
| Conta (delete/export) | ⚠ `privacy-sql`; ❌ rotas HTTP | — |
| Acessibilidade | ✅ `operation-core-accessibility`, `viewports`, `responsive`, `cancelled` | `tests/e2e` |
| Storage policies | ❌ | — |

**Fluxo crítico sem teste**: `/api/push/dispatch` e `account/delete` (HTTP), pagamento, cadastro e2e.
**Risco atual**: MÉDIO-ALTO nos fluxos fora da operação principal; regressão em RLS de storage não detectável.

---

## ETAPA 11 — Dívida técnica

| Item | Evidência | Nível |
|---|---|---|
| Migrations `reconcile_*` / `restore_*` (9) — drift entre ambientes | `20261104010000…20261104090000`, `…190000` | ALTA |
| Schema base ausente do repo | ❌ CREATE TABLE users/jobs/applications | ALTA |
| `public_user_directory` redefinida 3× | migrations | MÉDIA |
| Debug em produção | geocode, debug/env | MÉDIA |
| Diagnóstico push embutido em `admin.ts` | `lib/supabase/admin.ts` | MÉDIA |
| Componentes de verificação duplicados | ⚠ | MÉDIA |
| Mojibake | `specialties.ts`, rotas | MÉDIA |
| Ausência `error.tsx`/`loading.tsx`/`not-found.tsx` | ❌ | MÉDIA |
| Docs sobrepostos (30 arquivos de relatório/plano) | `docs/` | BAIXA |
| Código morto / APIs não usadas | ⚠ não apurado de forma exaustiva | — |
| Tabelas/views órfãs | ⚠ não detectadas; `talent_connections` e `demand_reserves` a confirmar uso | BAIXA |
| `test` script ignora `tests/e2e` e SQL separado | `package.json` | BAIXA |

---

## ETAPA 12 — Operações administrativas

| Operação | Estado | Como é feito hoje |
|---|---|---|
| Revisão de verificação | ❌ | RPC `review_profile_verification` via service_role/SQL |
| Suporte (contas, reativação) | ❌ | SQL manual |
| Moderação (chat, reviews) | ❌ | SQL manual |
| Auditoria | ⚠ | `demand_events`, `push_deliveries`, `checkin_attempts`, `work_location_evidence` — sem UI |
| Bloqueio de usuários | ⚠ | `account_is_active` + `reject_deleted_account_write`; sem ação de bloqueio por admin |
| Gestão de pagamentos | ⚠ | `record_operational_payment` (partes), sem disputa |
| Diagnóstico push | ⚠ | `/api/push/status` (por usuário) |
| Cron operacional | ⚠ | pg_cron `extrachef-operational-minute`, sem monitor |

---

## ETAPA 13 — Observabilidade

✅ Existente: `console.*` (≈22 chamadas em `app/api` e `lib`), `requestId` em push/geocode, `push_deliveries`, `demand_events`, `checkin_attempts`. ❌ Sentry/APM/alertas/dashboards; ❌ métricas.

| Falha | Registra? | Detectável? |
|---|---|---|
| Push | ✅ `push_deliveries` + console | ⚠ só consultando |
| Check-in | ✅ `checkin_attempts`, 429/403 | ⚠ |
| Checkout | ⚠ erro de RPC ao cliente | ❌ |
| RPC | ⚠ console | ❌ |
| Storage | ⚠ cliente | ❌ |
| Geocoding | ✅ `geocoding_requests`, `GeocodingError.code` | ⚠ (`docs/geolocation-monitoring.md`) |
| Notification worker (pg_cron / webhook) | ⚠ `cron.job_run_details` do Supabase | ❌ sem alerta |

---

## ETAPA 14 — Domain map

| Domínio | Entidades | Acoplamento indevido |
|---|---|---|
| Autenticação | users, Auth | Role em `users` consultado no proxy a cada requisição |
| Perfis | worker/restaurant_profiles | CPF/CNPJ e selfie no mesmo registro |
| Recrutamento | jobs, applications, demand_* | Triggers de localização operacional misturados |
| Operações | operational_assignments/codes, checkins/outs | Pagamento embutido |
| Comunicação | messages | `bind_message_assignment` liga chat a operação |
| Reputação | reviews, users.score | trigger síncrono |
| Verificação | worker_profiles.selfie_* | Sem domínio admin |
| Notificações | notifications, push_* | `admin.ts` com diagnóstico |
| Privacidade | privacy_preferences, legal_acceptances, anonymize | `reject_deleted_account_write` em muitas tabelas |
| Localização | work_locations, geocoding_*, evidence | Geocoding + CEP + check-in GPS no mesmo schema |

---

## ETAPA 15 — Escalabilidade

- **Escala bem**: lógica no Postgres com índices direcionados; Realtime por tabela; cache de geocoding (`geocoding_cache`); idempotência de push.
- **Gargalos**: pg_cron de 1 min varrendo `process_operational_schedule`; proxy consulta `users` em toda requisição; push síncrono por webhook sem fila; Realtime em `notifications`/`messages` sem particionamento; Photon (provedor público) como dependência; selfies sem pipeline.
- **Refatoração futura**: fila de notificações, extrair verificação para fila administrativa, cache de role em claims JWT, observabilidade, particionamento de `notifications`/`push_deliveries`.
- **Risco técnico atual**: MÉDIO (drift de migrations, ausência de observabilidade, schema base fora do repo).

---

## ETAPA 16 — Prontidão para evolução

| Iniciativa | Estado | Impacto técnico / módulos | Dependências | Risco |
|---|---|---|---|---|
| Painel Admin | ❌ Inexistente (base parcial: RPC de verificação, `demand_events`) | Novo papel em `users.role`, `AccountRole`, proxy, RLS, rotas `/admin`, RPCs com checagem de papel | Decisão de modelo de papéis | ALTO se sem papel formal |
| Disponibilidade do profissional | ❌ Inexistente (`recruitment_available` é de vagas, não do worker) | Nova tabela, RPCs, notificações, matching | Painel opcional | MÉDIO |
| Matching inteligente | ⚠ Parcial: `restaurant_talent_directory`, `talent_board`, `worker_operational_reputation`, `specialties`, GPS/`work_locations`, selo | Ranking SQL, índices geoespaciais ❌ (sem PostGIS confirmado) | Disponibilidade, reputação | MÉDIO |
| Verificação de restaurantes | ⚠ `restaurant_profiles.cnpj` + `is_valid_cnpj` + unique; ❌ responsável legal, documentos, selo, fluxo | Espelhar padrão de `worker_verification_guard` | Painel admin, storage | MÉDIO |

Ordem recomendada: Correções críticas → Admin base → Verificação operacional → Disponibilidade → Matching → Verificação de restaurantes.

---

## ETAPA 17 — Roadmap técnico

**Sprint 3.0 — Correções críticas + Admin base**
- Remover debug (`geocode`, `debug/env`), reduzir log de `admin.ts`.
- Versionar schema base (`users`, `jobs`, `applications`); consolidar `reconcile_*`.
- Rate limit em APIs; `error.tsx`/`not-found.tsx`; corrigir mojibake.
- Papel `admin`/`support` e `/admin` protegido, em proxy, RLS e RPC.
- Justificativa: sem isso, qualquer evolução apoia-se em service_role e schema irreproduzível.

**Sprint 3.1 — Verificação operacional**
- Fila de revisão sobre `review_profile_verification`, auditoria, notificação de resultado.
- Justificativa: fluxo existente sem operador, gargalo de escala.

**Sprint 3.2 — Disponibilidade**
- Modelo de disponibilidade, notificação, integração com demandas. Justificativa: pré-requisito do matching.

**Sprint 3.3 — Matching inteligente**
- Ranking por localização, reputação, especialidades, selo, histórico. Testes SQL.

**Sprint 3.4 — Verificação de restaurantes**
- CNPJ ativo, responsável legal, documentos, selo; reutiliza fila admin da 3.1.

**Transversal**: testes para push dispatch, conta, pagamento, storage policies; observabilidade (erros + alertas de cron e push).

---

## Limites desta auditoria

- ⚠ Contagens de `SECURITY DEFINER`/`search_path` são agregadas; verificação 1:1 por função não foi feita.
- ⚠ `session-guard.tsx`, `public/sw.js`, `lib/locations/server.ts` e `api/locations/[id]` não foram lidos integralmente.
- ❌ Estado real do banco de produção não é verificável pelo repositório.
