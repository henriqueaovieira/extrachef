# ExtraChef — RLS / Policy Diff Report

**Status: BLOQUEADO — policies remotas não consultadas**

## Evidência disponível

- O repositório contém policies em migrations, incluindo `20261014051000_core_rls.sql`, `20261014050000_profiles_and_geo.sql`, `20261103000000_verified_profile.sql` e `20261104010000_reconcile_verified_profile.sql`.
- A busca local encontrou 86 declarações `CREATE POLICY` brutas nas migrations. Esse número inclui substituições/reconciliações e não representa policies únicas.
- O baseline da API não expõe o catálogo `pg_policies`; portanto não há diff confiável entre Git e produção.
- O Storage API confirma dois buckets privados, mas não retorna a definição de policies de `storage.objects`.

## Policies e invariantes que precisam de comparação

| Área | Regra versionada observada | Resultado remoto |
|---|---|---|
| `users`, `jobs`, `applications` | `core_rls` ativa RLS e define regras de negócio que assumem `worker`/`restaurant` | ❔ Não consultado |
| `worker_profiles` | Acesso de proprietário e controle de dados de verificação | ❔ Não consultado |
| `restaurant_profiles`/eventos | Ownership e papel `restaurant` | ❔ Não consultado |
| `storage.objects` — `worker-private` | Proprietário acessa; selfie submetida recebe restrições de leitura/alteração/exclusão (`verified_profile`) | ❔ Policies remotas não consultadas |
| `storage.objects` — `restaurant-assets` | Migration define leitura pública; bucket remoto está configurado como privado | ⚠ Bucket diverge; efeito efetivo exige leitura das policies remotas |
| Policies RESTRICTIVE | Há guards de selfie e outras regras no histórico | ❔ Não consultadas em produção nem combinadas com permissivas |

## Requisito para fechar

Coletar no mesmo ambiente e snapshot:

1. `pg_policies` com `schemaname`, `tablename`, `policyname`, `permissive`, `roles`, `cmd`, `qual`, `with_check`.
2. Estado `relrowsecurity`/`relforcerowsecurity` e grants das relações envolvidas.
3. Policies de Storage junto com `storage.buckets.public`, permissões e comportamento efetivo de acesso.
4. Comparação de cada policy remota com a última definição aplicável em ordem nas migrations.
5. Testes negativos com `anon`, `authenticated`, Worker, Restaurant e service role em ambiente de teste.

**Conclusão:** a política de segurança remota não está reconciliada. A Fase 0 permanece aberta; não adicionar permissões Staff antes de fechar esta comparação.
