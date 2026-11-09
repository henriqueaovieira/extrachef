# ExtraChef — Schema Canônico do Banco de Dados

**Status: BLOQUEADO / BASELINE PARCIAL**  
**Data da coleta: 2026-11-09**

## Conclusão

O schema canônico completo ainda não pode ser declarado. O projeto Supabase configurado respondeu às consultas somente leitura de PostgREST e Storage, mas não foi possível consultar os catálogos PostgreSQL ou o histórico de migrations aplicadas. O inventário disponível neste documento é, portanto, um **baseline de recursos expostos por API mais evidências de migrations**, não um dump/schema canônico de produção.

O ambiente conectado expõe `users`, `jobs`, `applications` e outros 26 recursos por PostgREST, 89 endpoints RPC e dois buckets. A classificação de recursos como tabela, view ou outro tipo não pode ser determinada pela lista OpenAPI. As definições completas de colunas, constraints, FKs, ownership, índices, triggers, policies e grants continuam desconhecidas.

## Respostas de entrada da Sprint 3.0

| Pergunta | Resultado | Evidência |
|---|---|---|
| `users` foi identificado? | ✅ Como endpoint exposto; ❌ DDL real e origem não identificados | PostgREST contém `/users`; nenhuma migration do checkout cria `public.users` |
| `jobs` foi identificado? | ✅ Como endpoint exposto; ❌ DDL real e origem não identificados | PostgREST contém `/jobs`; nenhuma migration cria `public.jobs` |
| `applications` foi identificado? | ✅ Como endpoint exposto; ❌ DDL real e origem não identificados | PostgREST contém `/applications`; nenhuma migration cria `public.applications` |
| Todas as tabelas principais estão versionadas? | ❌ Não comprovado; as três relações centrais acima não têm migration inicial no checkout | 55 migrations verificadas; migrations posteriores pressupõem essas relações |
| O schema atual pode ser reproduzido do zero? | ❌ Não | O histórico Git não cria a fundação completa e seu estado aplicado não foi consultado |
| A Fase 0 está concluída? | ❌ Não | Faltam snapshot do catálogo, DDL, histórico de migrations e comparação integral |
| A Sprint 3.0 pode começar? | ❌ Não deve começar com migrations de Staff/admin | Critério de bloqueio solicitado: DDL central, versionamento e reprodutibilidade ainda indefinidos |

## Fontes e limitações

- `docs/DATABASE_BASELINE.md`: GET autenticado ao PostgREST e Storage, recursos expostos, RPCs listadas e divergência observada no bucket `restaurant-assets`.
- `supabase/migrations/`: 55 arquivos locais. Eles não demonstram por si só quais migrations foram aplicadas ao ambiente consultado.
- `database_snapshot/`: snapshot parcial com os endpoints API, lista de RPCs expostas e metadados de buckets; as demais listas de catálogo permanecem sem dados por não serem observáveis pelas APIs disponíveis.
- `docs/MIGRATION_RECONCILIATION_INVENTORY.md`: classificação documental dos arquivos `reconcile_*`/`restore_*`, sem afirmar estado aplicado em produção.

**Não inferir ausência no banco remoto** a partir da ausência de um objeto na migration ou no PostgREST. Relações não expostas, políticas, índices e funções não expostas podem existir no banco.

## Fontes oficiais por responsabilidade

Até a reconciliação, manter as seguintes distinções:

1. **Estado remoto corrente:** catálogo PostgreSQL e Storage do projeto/ambiente identificado, ainda não coletados integralmente.
2. **Histórico versionado:** `supabase/migrations/` no commit auditado, incompleto para reconstrução do zero.
3. **Superfície da API:** OpenAPI PostgREST e Storage API, coletados em modo somente leitura, não equivalentes ao catálogo.

Não há ainda uma única fonte reproduzível que satisfaça simultaneamente as três responsabilidades.

## Gatilhos para desbloqueio

1. Acesso autorizado, somente leitura, a `information_schema`, `pg_catalog`, `pg_policies`, `storage.buckets` e ao histórico `supabase_migrations.schema_migrations` (ou export de schema equivalente).
2. Confirmação explícita do ambiente/branch de banco consultado e comparação com staging e produção quando aplicável.
3. DDL real de `users`, `jobs`, `applications`, `worker_profiles`, `restaurant_profiles`, `operational_assignments` e `reviews`.
4. Classificação objeto a objeto entre remoto e Git, incluindo funções/RPCs, triggers, índices, RLS, Storage e extensões.
5. Teste teórico de reconstrução revisado com o resultado do item 4; não executar reset/migrations em produção.

Até que todos os itens sejam respondidos, este documento permanece **baseline parcial** e não aprova a primeira migration da Sprint 3.0.
