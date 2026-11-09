# ExtraChef — Schema Diff: Git × Ambiente Supabase

**Status: PARCIAL — comparação integral bloqueada**  
**Data: 2026-11-09**

## Método e legenda

Git foi inspecionado em `supabase/migrations/` (55 arquivos). No ambiente, foram consultados apenas `GET /rest/v1/` (OpenAPI/PostgREST) e `GET /storage/v1/bucket`. Não houve acesso a `information_schema`, `pg_catalog` ou ao histórico de migrations aplicadas.

- ✅ Alinhado: evidência compatível observada nos dois lados.
- ⚠ Divergente/parcial: sinais concretos não coincidem ou a comparação não é completa.
- ❌ Ausente: ausência confirmada no lado indicado; **não usar para inferir ausência no outro lado**.
- ❔ Indeterminado: APIs disponíveis não mostram o objeto/atributo em questão.

## Objetos centrais

| Objeto | Git/migrations | Supabase remoto observado | Status | Conclusão |
|---|---|---|---|---|
| `public.users` | Nenhum `CREATE TABLE`; migrations posteriores assumem tabela existente | Endpoint `/users` exposto | ⚠ Parcial | A relação está exposta, mas DDL/origem e igualdade entre schemas são desconhecidos |
| `public.jobs` | Nenhum `CREATE TABLE`; migrations posteriores alteram/consultam | Endpoint `/jobs` exposto | ⚠ Parcial | A relação está exposta, mas DDL/origem e igualdade entre schemas são desconhecidos |
| `public.applications` | Nenhum `CREATE TABLE`; migrations posteriores alteram/consultam | Endpoint `/applications` exposto | ⚠ Parcial | A relação está exposta, mas DDL/origem e igualdade entre schemas são desconhecidos |
| `worker_profiles` | Criada/alterada por migrations, incluindo `profiles_and_geo` e `verified_profile` | Endpoint `/worker_profiles` exposto | ⚠ Parcial | Presença de endpoint confirmada; colunas, constraints, triggers e policies remotas não comparadas |
| `restaurant_profiles` | Criada/alterada por migrations | Endpoint `/restaurant_profiles` exposto | ⚠ Parcial | Presença de endpoint confirmada; definição remota não comparada |
| `operational_assignments` | Criada/alterada por migrations operacionais | Endpoint `/operational_assignments` exposto | ⚠ Parcial | Presença de endpoint confirmada; definição remota não comparada |
| `reviews` | Criada/alterada por migrations de reviews | Endpoint `/reviews` exposto | ⚠ Parcial | Presença de endpoint confirmada; definição remota não comparada |
| `work_location_evidence` | Migration local cria a relação | Não há endpoint na lista OpenAPI | ❔ | Não estar exposta na API não significa que esteja ausente do banco |
| `profiles`, `todos` | Nenhuma criação base encontrada no scan de DDL das migrations | Endpoints expostos | ⚠ Parcial | Origem e tipo remoto desconhecidos |

## Comparação dos recursos expostos

O baseline remoto possui 29 caminhos de relação PostgREST e 89 caminhos `/rpc/*`, listados em `database_snapshot/tables.csv`, `views.csv` e `functions.csv`. A primeira lista é de **recursos expostos**, não de tabelas confirmadas. A presença em uma migration não prova que o objeto exista remotamente; ausência do OpenAPI não prova que esteja ausente no banco.

## Migrations e reconstrução

- ✅ Há 55 migrations no checkout consultado.
- ❌ Nenhuma migration cria as relações-base `users`, `jobs`, `applications`.
- ❌ Não foi consultada a tabela de migrations aplicadas do ambiente remoto.
- ⚠ Os arquivos `reconcile_*`/`restore_*` evidenciam reaplicação/restauração de definições no histórico versionado; não provam, isoladamente, drift entre os ambientes atuais.
- `docs/MIGRATION_RECONCILIATION_INVENTORY.md` classifica os 10 arquivos identificados pelo conteúdo/documentação; a classificação não indica se foram aplicados em produção.
- ❌ Não é possível afirmar que `supabase db reset` ou execução ordenada das migrations chegue ao schema remoto atual. A reconstrução completa não é demonstrada pelo checkout.

## Diferenças confirmadas / pendentes

| Item | Status | Evidência | Ação para fechar |
|---|---|---|---|
| Bucket `restaurant-assets.public` | ⚠ Divergência observada | Migration `20261014050000_profiles_and_geo.sql` define `public = true`; Storage API reportou `public = false` | Confirmar intenção e consultar estado/policies Storage antes de qualquer alteração |
| DDL base `users/jobs/applications` | ❌ Não versionado no Git; ✅ endpoint remoto | Scan de migrations e OpenAPI | Exportar DDL/catálogos e recuperar baseline de criação |
| Policies/triggers/índices | ❔ Remoto não inventariado | REST/Storage API não fornece catálogo completo | Consultar `pg_policies`, `pg_trigger`, `pg_indexes` e grants |
| RPCs completas/ACLs | ❔ Remoto parcialmente visível | OpenAPI expõe 89 RPCs, sem catálogo completo/ACLs confiáveis | Consultar rotinas, assinaturas, `prosecdef`, `search_path`, owners e grants |

**Decisão:** não gerar migration de reconciliação a partir deste diff parcial. O conjunto de diferenças confirmadas é insuficiente para decidir correções de schema com segurança.
