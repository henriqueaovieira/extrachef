# ExtraChef — Arquitetura Administrativa (Admin Foundation Discovery)

> Documento de projeto. Nenhum código, migration ou componente foi criado. Complementa `docs/EXTRACHEF_MASTER_ARCHITECTURE.md`.
> Legenda: ✅ Confirmado (evidência no repositório) · ⚠ Inferência · ❌ Ausente.
> Itens rotulados "Recomendação" são decisões de projeto, não fatos do código.

---

## ETAPA 1 — Estado atual das permissões

### 1.1 Como o papel é definido

✅ **Confirmado** — o papel vive na coluna `public.users.role`, com valores `worker` | `restaurant`.
- Arquivo: `lib/auth/routes.ts` — `type AccountRole = 'restaurant' | 'worker'`, `canAccessPath`.
- Migration: `20261014051000_core_rls.sql` (linhas ~50–66) — policies `users_insert_self` e `users_insert_self_restrictive` (RESTRICTIVE) com `WITH CHECK (role IN ('worker','restaurant') AND verified=false AND score=5)`.
- Migration: `20261015020000_auth_foundation.sql:13` — `account_role public.users.role%TYPE`.
- Evidence: o papel é escolhido no cadastro e travado por policy de INSERT.

✅ **Confirmado** — o papel é lido do banco, não de claims JWT.
- Evidence: nenhuma ocorrência de `auth.jwt()`, `app_metadata` ou `raw_app_meta` nas migrations (❌ claims). Cada RLS faz `EXISTS (SELECT 1 FROM public.users WHERE id=(SELECT auth.uid()) AND role='…')`.
- Migrations: `core_rls` (linhas 98, 112, 146, 162), `profiles_and_geo` (122, 131, 170, 179), `restaurant_events` (40–140), `dashboards_notifications` (233, 293), `worker_estimated_earnings` (13). Cerca de 69 referências a `role = 'worker'|'restaurant'` em migrations.

### 1.2 Consumidores

| Camada | Evidência | Dependência do papel |
|---|---|---|
| Middleware | `proxy.ts` | ✅ lê `users.role` a cada request e aplica `canAccessPath` (bloqueia só o prefixo do outro papel) |
| Rotas | `lib/auth/routes.ts` | ✅ prefixos worker/restaurant; não há `/admin` |
| APIs | `lib/auth/api-user.ts`, `app/api/**` | ✅ autenticação por cookie/Bearer; autorização por RLS/RPC |
| Policies/RPCs | migrations acima | ✅ hardcode de dois papéis |
| Triggers | `20261015030000_chat_read_state.sql:108` | ✅ `CASE WHEN u.role='worker' THEN 'Profissional' ELSE 'Restaurante'` — qualquer papel novo cairia em "Restaurante" |

### 1.3 Fluxograma

```
Cadastro (callback Auth) ──► INSERT public.users (role ∈ {worker,restaurant}; policy RESTRICTIVE)
                                   │
Request ──► proxy.ts ──► supabase.auth.getUser ──► SELECT users.role ──► canAccessPath(role,path)
                                   │                                         │
                                   ▼                                         ▼
                          Server Components / API ──► RLS (subselect em users.role) ──► dados
                                   │
                  Operação privilegiada ──► lib/supabase/admin.ts (service_role) ──► RPC *_service_role
```

### 1.4 Respostas

1. **Como o papel é determinado hoje?** ✅ Por `users.role` consultado no banco em middleware e em cada policy.
2. **Existe suporte indireto a novos papéis?** ❌ Não. A policy de INSERT só aceita 2 valores, `AccountRole` é uma união de 2, e o `ELSE` do chat trata o resto como restaurante. ⚠ Não foi possível verificar CHECK na tabela `users` (a tabela base não está nas migrations — ver Master Architecture, Etapa 4).
3. **Limitações:** (a) papel único por usuário; (b) lookup por request/policy (custo e acoplamento); (c) sem claims; (d) `users` base fora do versionamento; (e) misturar staff em `users.role` quebraria dashboards, `public_user_directory` e notificações que assumem 2 papéis.

---

## ETAPA 2 — Operações administrativas atuais

| Operação | Responsável atual | Método atual | Evidência | Risco | Frequência (⚠ estimada) |
|---|---|---|---|---|---|
| Aprovar/rejeitar verificação | Desenvolvedor | SQL manual / `service_role` chamando `review_profile_verification(p_user_id,p_selfie_path,p_status,p_expected_updated_at)` | `20261103000000_verified_profile.sql:71–92`, reconciliada em `20261104010000`; `GRANT … TO service_role` | **CRÍTICO** | 1 por profissional cadastrado |
| Ver selfie para revisar | Desenvolvedor | Supabase Dashboard (bucket `worker-private`) | policies `worker_selfie_private/no_update/no_delete` | **CRÍTICO** (dado biométrico sem log) | igual à anterior |
| Gestão de usuários (suspender/bloquear) | — | ❌ Ausente; só `account_is_active`, `reject_deleted_account_write` | `20261015090000_privacy_account_rights.sql` | **ALTO** | esporádica |
| Auditoria | Desenvolvedor | SQL em `demand_events`, `push_deliveries`, `checkin_attempts`, `work_location_evidence`, `legal_acceptances` | tabelas existentes, sem UI | **ALTO** | sob demanda |
| Moderação (chat/avaliações) | — | ❌ Ausente (sem denúncia, sem ocultar/remover) | `reviews_update_user_score`, chat sem tabela de reports | **ALTO** | crescente |
| Push | Desenvolvedor | `push_deliveries` via SQL; `/api/push/status` é por usuário | `app/api/push/*` | **MÉDIO** | por incidente |
| Storage | Desenvolvedor | Dashboard / `service_role` (`worker-private`, `restaurant-assets`) | `account/delete` usa admin client p/ storage | **ALTO** | por exclusão |
| Monitoramento | Desenvolvedor | `console.*`, logs Vercel/Supabase; cron `extrachef-operational-minute` sem alerta | Master Architecture, Etapa 13 | **ALTO** | contínua |
| Exclusões (LGPD) | Usuário + `service_role` | `/api/account/delete` (não atômico): `can_request_account_deletion`, `anonymize_account`, storage, `deleteUser` | `app/api/account/delete/route.ts` | **ALTO** (falha parcial sem reparo) | rara |
| Privacidade (exportação) | Usuário | `/api/account/export` → `export_own_account_data` | ✅ | **BAIXO** | rara |
| Contestações / disputas | — | ❌ Ausente; `record_operational_payment` só registra | migrations operational trust | **ALTO** | crescente |
| Suporte geral | Fundador/dev | Contato externo + SQL | ❌ sem ferramenta | **MÉDIO** | diária |
| Diagnóstico | Dev | `/api/debug/env` sem auth quando `PUSH_DIAGNOSTICS_ENABLED=true` | `app/api/debug/env/route.ts` | **ALTO** | n/a |

---

## ETAPA 3 — Futuras operações administrativas (inevitáveis)

| Categoria | Operações |
|---|---|
| **Aprovação** | verificação de profissional (selfie/CPF/RG); verificação de restaurante (CNPJ, responsável legal — ❌ hoje inexistente, `restaurant_profiles_cnpj_unique` só garante unicidade); reativação de conta |
| **Revisão** | selfie inválida/borrada; documento divergente; recorte reprovado; reenvio após rejeição |
| **Moderação** | avaliação abusiva; mensagem de chat ofensiva/assédio; spam de candidaturas ou convites; perfil falso; foto imprópria |
| **Investigação** | check-in suspeito (`checkin_attempts`, `work_location_evidence`); CPF/CNPJ duplicado; múltiplas contas; abandono de serviço (no-show) |
| **Suporte** | recuperação de acesso; correção de dados; falha de push; erro de geocoding; exportação/exclusão assistida |
| **Auditoria** | quem aprovou, quando, valor antigo/novo; acessos a dados sensíveis; mudanças de papel; uso de `service_role` |
| **Escalonamento** | disputa de pagamento; denúncia grave (assédio, fraude); incidente de dados (LGPD); admin comprometido |

---

## ETAPA 4 — Cenários de papéis

| Critério | A — Admin único | B — Admin / Reviewer / Support | C — Admin / Support / Reviewer / Moderator / Auditor |
|---|---|---|---|
| Complexidade | Mínima | Baixa-média | Alta |
| Governança | Fraca (sem segregação) | Boa (segregação revisão × suporte) | Excelente |
| Segurança | Pior: um comprometimento expõe tudo (selfie, CPF, exclusões) | Moderada: privilégio mínimo por função | Melhor, mas superfície maior |
| Manutenção | Simples | Simples | Custosa (matriz de permissões, UI por papel) |
| Escalabilidade | Não escala além de 1 operador | Escala até times pequenos | Escala para equipe grande |

**Recomendação:** Cenário B, desenhado para evoluir a C. `moderator` e `auditor` entram como linhas na mesma tabela de papéis quando houver volume (denúncias) ou exigência de conformidade. Justificativa: a equipe atual é mínima (⚠), o dado mais sensível (selfie) exige segregação entre quem revisa e quem presta suporte, e adicionar papéis a um modelo tabular não exige retrabalho.

---

## ETAPA 5 — RBAC

**Arquitetura recomendada (projeto, não existente):**

```
auth.users ─┐
            ├─ public.users (worker|restaurant)   ← inalterado
            └─ staff_members (user_id, role ∈ {admin,support,reviewer,…}, status, granted_by, granted_at, revoked_at)
                    │
   is_staff(role[]) SECURITY DEFINER, search_path fixo, STABLE
                    │
   RLS admin / RPCs admin_* ──► admin_audit_log (append-only)
```

1. **Onde vivem?** Tabela separada `staff_members` (nome ilustrativo). Motivo ✅: `users.role` é restrito a 2 valores por policy, o `ELSE` do chat e ~69 policies assumem 2 papéis. Staff separado evita tocar nas policies atuais. Opcional: espelhar em `app_metadata` via Auth Hook para o middleware (⚠ fonte da verdade continua sendo o banco).
2. **Atribuição:** somente admin, via RPC auditada; o primeiro admin por migration/seed controlado (bootstrap único). Sem auto-atribuição.
3. **Revogação:** `revoked_at` + invalidação de sessão; efeito imediato porque a checagem é no banco.
4. **Auditoria:** toda concessão/revogação grava em `admin_audit_log` (CRÍTICO).
5. **Integração com RLS:** policies adicionais `TO authenticated USING (is_staff(...))`, sem alterar as policies existentes (que continuam restringindo worker/restaurant). Dados sensíveis só via RPC, não por SELECT livre (padrão já usado: `worker_profiles` com REVOKE ALL, ✅).
6. **APIs administrativas:** prefixo `app/api/admin/**`, validação `is_staff` no servidor, nunca confiar no cliente; service_role restrito a casos em que RPC não basta e com audit explícito. Substituir `GRANT … TO service_role` das RPCs de revisão por checagem interna `is_staff('reviewer')` com `auth.uid()`.
7. **Páginas:** matcher `/admin` em `proxy.ts` (negar por padrão), guard em `app/admin/layout.tsx`, MFA obrigatório (⚠ Supabase MFA não usado hoje: ❌ Ausente), `noindex`, headers sem cache.

| Papel | Permissões propostas |
|---|---|
| admin | tudo, gerencia staff, suspensão, exclusões |
| reviewer | fila de verificações, aprovar/rejeitar, ver selfie via URL assinada |
| support | ver dados mínimos, status de push/check-in, assistência de conta; sem selfie/CPF/RG |
| moderator (futuro) | denúncias, ocultar avaliação/mensagem |
| auditor (futuro) | leitura de `admin_audit_log` e logs |

---

## ETAPA 6 — Segurança administrativa

| Cenário | Impacto | Escalada | Mitigação |
|---|---|---|---|
| Admin comprometido | Total: aprovação fraudulenta, concessão de papéis, exclusão | Já é topo | MFA, lista curta, alerta em concessão de papel, 2 admins para ações destrutivas (⚠ opcional) |
| Reviewer comprometido | Aprova perfis falsos; vê selfies | Tentar conceder papel (bloqueado se só admin concede) | RPC com `p_expected_updated_at` (✅ já existe), auditoria, limites por hora |
| Support comprometido | Vazamento de dados de contato | Tentar ver selfie/CPF | Dados mascarados, sem acesso ao bucket privado |

Matriz:

| Risco | Evidência atual | Severidade |
|---|---|---|
| Escalada de privilégio | ❌ não há papéis; hoje o "admin" é quem possui a service key | CRÍTICO |
| Acesso indevido ao bucket | ✅ `worker-private` privado, mas Dashboard sem log próprio | ALTO |
| Vazamento de dados | `/api/debug/env` sem auth em modo diagnóstico | ALTO |
| Alterações não auditadas | ❌ sem `admin_audit_log` | CRÍTICO |
| Uso indevido de `service_role` | ✅ `lib/supabase/admin.ts` (`server-only`, loga `supabase_admin_initialized` a cada criação, mas não por ação); usado em `account/*` e `push/*` | ALTO |
| Rate limit | ❌ ausente em APIs | MÉDIO |

---

## ETAPA 7 — Auditoria de ações administrativas

Hoje: ❌ não existe log administrativo. Existem tabelas de evidência de negócio (`demand_events`, `push_deliveries`, `checkin_attempts`, `work_location_evidence`, `legal_acceptances`) que não registram ator administrativo. A função `review_profile_verification` atualiza `worker_profiles.verification_status/updated_at` sem registrar revisor (✅ `20261103000000_verified_profile.sql:77`).

Campos mínimos recomendados: ator (`auth.uid()`), papel, ação, entidade, id, valor antigo, novo, justificativa, IP/UA, timestamp; tabela append-only (sem UPDATE/DELETE, revogados).

| Evento | Classe |
|---|---|
| Aprovar/rejeitar verificação | CRÍTICO |
| Conceder/revogar papel | CRÍTICO |
| Visualizar selfie/CPF/RG | CRÍTICO |
| Suspender/reativar conta | CRÍTICO |
| Exclusão/anonimização assistida | CRÍTICO |
| Uso de `service_role` fora de rotina | CRÍTICO |
| Ocultar avaliação/mensagem | ALTO |
| Alterar dado de usuário | ALTO |
| Registro/ajuste de pagamento (`record_operational_payment`) | ALTO |
| Reenvio manual de push | MÉDIO |
| Consulta de fila/lista | MÉDIO |

---

## ETAPA 8 — Painel de verificações

### Fluxo atual (✅)
1. Profissional captura selfie (`app/components/camera-capture.tsx`, `professional-verification.tsx`, `profile-verification.tsx`) → upload em `worker-private` (path `…/selfie-…`).
2. RPC `submit_own_profile_verification(p_selfie_path)` → `worker_profiles.selfie_verification_path`, `verification_status='pending'`.
3. Trigger `guard_worker_verification` (`worker_verification_guard`) impede auto-aprovação e exige telefone, selfie e demais campos para `'verified'`; selfie diferente da foto de perfil.
4. Revisão: `review_profile_verification(p_user_id, p_selfie_path, p_status, p_expected_updated_at)` — só `service_role`; confere objeto em `storage.objects`.
5. Efeito: `public_user_directory` e `verified-profile-badge.tsx` exibem o selo verificado (view redefinida 3×).

Storage: policies `worker_selfie_private`, `worker_selfie_no_update`, `worker_selfie_no_delete`; função `is_submitted_verification_photo`.

### Limitações (✅/⚠)
- ❌ Sem painel, sem fila, sem revisor registrado, sem motivo de rejeição, sem histórico de revisões (só o último `verification_status`).
- ⚠ Status exatos além de `pending`/`verified` (ex.: `rejected`) não foram todos confirmados; conferir no CHECK da coluna antes da implementação.
- ❌ Sem SLA, sem notificação de resultado documentada neste fluxo.
- Reenvio: bloqueado se `verified` ou já `pending` com selfie (✅ `submit_own_profile_verification`).

### O que o painel precisa exibir
Fila `pending` ordenada por data de envio; selfie via URL assinada de curta duração; telefone mascarado; CPF/RG mascarados (únicos por `worker_profiles_cpf_unique`); data de envio (`updated_at`); histórico de tentativas (⚠ requer nova tabela); motivo da rejeição; ações aprovar/rejeitar com `p_expected_updated_at` para controle de concorrência (✅ já suportado).

### Dependências ocultas
- Ler a selfie exige URL assinada gerada no servidor (hoje a policy só permite o dono).
- `public_user_directory` e `verified_badge` dependem de `verification_status='verified'`.
- Notificação ao profissional após decisão (⚠ via `dashboards_notifications`).
- Trigger `guard` deve permitir a mudança feita por staff (hoje depende do contexto `service_role`).
- Tabela `users` base fora do versionamento.

---

## ETAPA 9 — Moderação e suporte

| Problema | Ferramenta existente | Status |
|---|---|---|
| Spam | ❌ sem rate limit | ❌ Não |
| Assédio no chat | ❌ sem denúncia/ocultação | ❌ Não |
| Fraude | ⚠ `checkin_attempts`, `work_location_evidence`, verificação por selfie, unicidade CPF/CNPJ | ⚠ Parcialmente |
| Abandono de serviço | ⚠ `demand_events` registra, sem penalização/UI | ⚠ Parcialmente |
| Perfis falsos | ⚠ selfie + guard trigger; sem painel | ⚠ Parcialmente |
| Avaliações abusivas | ✅ `reviews_relationship_answer` (só quem teve relação avalia); ❌ sem remoção/contestação | ⚠ Parcialmente |
| Bloqueio de usuário | ❌ | ❌ Não |
| Disputa de pagamento | ❌ | ❌ Não |

---

## ETAPA 10 — Privacidade e LGPD

Base existente (✅): `privacy_preferences`, `legal_acceptances`, `export_own_account_data`, `anonymize_account`, `can_request_account_deletion` (`20261015090000_privacy_account_rights.sql`; `app/api/account/export|delete`).

| Dado | Tratamento no Admin |
|---|---|
| Senha, tokens, chaves, `SUPABASE_SERVICE_ROLE_KEY`, endpoints de push (secrets) | **Nunca exibir** |
| Selfie (biométrico, dado sensível LGPD art. 5º II) | Só reviewer/admin, URL assinada curta, **justificativa e log obrigatórios** |
| CPF, RG | Mascarados (ex.: `***.123.***-**`); revelar com justificativa |
| Telefone, e-mail | Mascarados para support; completos com justificativa |
| Coordenadas GPS de check-in | Somente em investigação, com justificativa |
| CNPJ | Visível (dado empresarial) |
| Mensagens de chat | Somente denunciadas, com justificativa |

Riscos: ALTO — acesso a selfie sem registro (hoje via Dashboard); ALTO — ausência de base de retenção/descarte de evidências de verificação (❌ não encontrada política de retenção); MÉDIO — logs `console.*` podem conter dados pessoais (⚠ não auditado integralmente). Exige: finalidade, minimização, trilha, política de retenção, tratamento de incidentes (aviso ANPD).

---

## ETAPA 11 — Observabilidade administrativa

| Pergunta | Hoje | Lacuna |
|---|---|---|
| Push falhou? | ✅ `push_deliveries`, `/api/push/status` (por usuário, `requestId`) | sem agregação/alerta |
| Verificação falhou? | ❌ erros só em retorno/`console` | sem registro de falha de revisão ou upload |
| RPC falhou? | ❌ `console.*` | sem métricas/alertas |
| Cron falhou? | ❌ `extrachef-operational-minute` sem alerta | sem monitor (`cron.job_run_details` não consultado) |
| Geocoding falhou? | ⚠ `geocoding_requests` | rota `geocode` com código de debug |
| Checkout/check-in falhou? | ⚠ `checkin_attempts` | sem dashboard |

Ausentes: Sentry/APM, alertas, dashboards, métricas, eventos críticos centralizados. Recomendação de eventos críticos: falha de cron, taxa de erro de RPC, backlog de verificações, falha de push > limiar, tentativas admin negadas.

---

## ETAPA 12 — Operação diária (⚠ simulação; premissa: 1 verificação por profissional, 5% dos usuários com ocorrência/mês)

| Usuários | Verificações | Ocorrências suporte/mês | Observação |
|---|---|---|---|
| 10 | ~10 | ~1 | SQL manual viável |
| 100 | ~100 | ~5–10 | SQL manual cansativo, risco de erro, sem trilha |
| 1.000 | ~1.000 (≈30/dia em crescimento) | ~50–100 | Painel e RBAC obrigatórios; 1 operador dedicado |
| 10.000 | ~10.000 | ~500–1.000 | Fila com SLA, moderação, observabilidade, equipe 3–6 (⚠) |

Gargalos humanos: revisão de selfie (maior volume), disputas de pagamento, denúncias, exclusões com falha parcial (`account/delete` não atômico). Deixa de escalar já a partir de ~100: aprovação manual por SQL.

---

## ETAPA 13 — Dependências técnicas

| Área | Impacto | Detalhe |
|---|---|---|
| Banco | **ALTO** | `staff_members`, `admin_audit_log`, tabela de histórico de verificação, funções `is_staff`, RPCs admin |
| RLS | **ALTO** | novas policies de staff; avaliar impacto nas ~69 referências a papéis; usar subselect `(SELECT auth.uid())` |
| APIs | **ALTO** | `app/api/admin/**`, guard comum, rate limit |
| Middleware | **MÉDIO** | `proxy.ts` matcher e `canAccessPath` com novo tipo de acesso; MFA |
| Rotas/Layouts | **MÉDIO** | `app/admin/**` com layout próprio, sem providers do worker/restaurant |
| Componentes | **MÉDIO** | tabelas, visualizador de selfie, diálogos de justificativa |
| Notifications | **MÉDIO** | notificar resultado da verificação; ajustar `chat_read_state` ELSE |
| Storage | **ALTO** | URL assinada para `worker-private` por staff (nova policy ou servidor) |
| Testes | **MÉDIO** | SQL tests de privilégio (padrão `profile-verification-sql`), e2e do painel |
| Legado | **BAIXO** | remover `debug/env`, corrigir reconcile drift |

---

## ETAPA 14 — Roadmap de implantação

| Fase | Conteúdo | Justificativa |
|---|---|---|
| **1 — Admin Foundation** | `staff_members`, `is_staff`, `admin_audit_log`, bootstrap do 1º admin, versionar `users` base | Tudo depende de identidade administrativa e trilha; evita retrabalho |
| **2 — Controle de acesso** | `proxy.ts` `/admin`, layout guard, guard de API, MFA, remover `/api/debug/env` | Fecha superfície antes de expor dados |
| **3 — Painel de verificação** | fila, selfie por URL assinada, aprovar/rejeitar com motivo, histórico, notificação | Maior gargalo e dado mais sensível; substitui SQL manual |
| **4 — Suporte operacional** | busca de usuário (dados mascarados), suspensão/bloqueio, status de push/check-in | Reduz dependência de dev |
| **5 — Auditoria** | visualizador de `admin_audit_log`, relatórios, retenção, papel auditor | Conformidade LGPD |
| **6 — Observabilidade** | Sentry, alertas de cron/push/RPC, dashboard de saúde | Operar com escala |

Moderação (denúncias, ocultar conteúdo) entra entre 4 e 5 conforme volume.

---

## ETAPA 15 — Decisão arquitetural final

1. **Modelo administrativo:** painel interno em `app/admin` (mesmo Next.js), RPCs com checagem de papel no banco, sem usar `service_role` como identidade humana.
2. **Papéis:** `admin`, `reviewer`, `support` (Cenário B) em `staff_members`, extensível a `moderator` e `auditor`.
3. **Segurança:** privilégio mínimo; deny-by-default em `/admin`; MFA; checagem em proxy + layout + API + RPC/RLS; dados sensíveis mascarados, selfie por URL assinada; `service_role` apenas em servidor e justificada.
4. **Auditoria:** `admin_audit_log` append-only, escrito dentro das RPCs na mesma transação, com valor antigo/novo, ator, justificativa; leitura por selfie/CPF também registrada.
5. **Mais simples e escalável hoje:** tabela de staff separada + `is_staff()` + audit log. Não toca em `users.role` nem nas ~69 referências de RLS.
6. **Obrigatório antes da Sprint 3.0:**
   - Decisão final de papéis e tabela de permissões (este documento).
   - Versionar a tabela base `users` (e `jobs`, `applications`) nas migrations — ✅ ausentes hoje.
   - Resolver o drift `reconcile_*`.
   - Remover ou proteger `/api/debug/env` e código de debug em `geocode`.
   - Definir bootstrap seguro do primeiro admin e política de MFA.
   - Confirmar status válidos de `verification_status` (⚠ pendente de confirmação).

**Primeira Sprint administrativa:** Fases 1 + 2 (Foundation + Controle de Acesso), com a Fase 3 (Painel de Verificação) como primeiro entregável funcional.

---

## Resumo de evidências

| Conclusão | Status | Arquivo / Migration |
|---|---|---|
| Papéis só `worker`/`restaurant` | ✅ | `lib/auth/routes.ts`; `20261014051000_core_rls.sql` |
| Papel lido do banco, sem JWT claims | ✅ | `proxy.ts`; ausência de `auth.jwt()` nas migrations |
| Revisão de verificação só `service_role` | ✅ | `20261103000000_verified_profile.sql:91–92` |
| Sem `/admin`, sem painel, sem audit log admin | ❌ | nenhuma ocorrência no repo |
| Sem moderação/denúncia/bloqueio/disputa | ❌ | nenhuma ocorrência no repo |
| Sem MFA | ❌ | nenhuma ocorrência no repo |
| Sem alertas/Sentry | ❌ | observabilidade só `console.*` |
| Status completos de verificação | ⚠ | confirmar no CHECK da coluna |
