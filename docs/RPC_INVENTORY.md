# ExtraChef — RPC Inventory

**Status: INVENTÁRIO PARCIAL DE ENDPOINTS EXPOSTOS**

O PostgREST OpenAPI autenticado expôs 89 nomes em `/rpc/*`. Isso comprova apenas a superfície RPC exposta no momento da coleta. Não revela todas as funções PostgreSQL, assinaturas completas, overloads, ACLs, `SECURITY DEFINER`, `search_path`, owner ou se a implementação implantada coincide com Git.

O histórico local contém 185 declarações brutas `CREATE FUNCTION`; há redefinições e migrations `reconcile_*`/`restore_*`, portanto a contagem não equivale a 185 funções únicas. A lista de endpoints expostos está em `database_snapshot/functions.csv`.

## Classificação possível

| Classe | Resultado |
|---|---|
| RPC exposta pelo PostgREST | ✅ 89 nomes observados |
| Implementação correspondente em migration | ⚠ Deve ser comparada por nome, assinatura e definição efetiva |
| RPC exposta mas não versionada | ❔ Não determinável sem cruzamento de todas as assinaturas com o catálogo e o histórico ordenado |
| Função existente mas não exposta | ❔ Não visível pelo OpenAPI |
| Grants/roles efetivos | ❌ Não consultados |
| `SECURITY DEFINER`/`search_path` efetivos em produção | ❌ Não consultados |

## RPCs de prioridade de segurança

| RPC | Evidência Git | Verificação remota necessária |
|---|---|---|
| `review_profile_verification` | `verified_profile` e `reconcile_verified_profile`; `SECURITY DEFINER`, revoke de `PUBLIC`/`anon`/`authenticated`, grant para `service_role` | Conferir assinatura, corpo, grants e owner ativos; mudança de grant sem check interno do ator é bloqueada |
| `submit_own_profile_verification` | `verified_profile`; valida Worker autenticado, documentos e selfie | Comparar definição e grant para `authenticated` |
| `ensure_account_profile` | `auth_foundation`; whitelist de `worker`/`restaurant` | Comparar definição e grant; não aceitar Staff via metadata |
| `is_submitted_verification_photo` | `verified_profile`; helper de proteção da selfie | Comparar `SECURITY DEFINER`, ACL e policy que o invoca |
| `process_operational_schedule` | Migrations operacionais e reconciliação de schedule; rotina de sistema | Comparar cron, owner, assinatura e ACL |
| `anonymize_account` | Migrations de privacidade; operação privilegiada de privacidade | Comparar ACL e consumidor |
| RPCs de aprovação/demandas/reviews | Migrations de recrutamento e confiança | Comparar por assinatura, predicates de ownership/role e ACL |

## Próxima coleta necessária

Exportar todas as rotinas com schema, nome, argumentos, tipo de retorno, `prosecdef`, `proconfig`/`search_path`, owner e ACL; comparar contra o estado final de cada função nas migrations. Registrar também rotinas não expostas pelo PostgREST e funções ausentes no Git.

**Conclusão:** não classificar como “versionada”, “divergente” ou “não versionada” apenas pelo nome no OpenAPI. A reconciliação integral continua bloqueada.
