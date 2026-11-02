# Fase 2: eventos com snapshot do catalogo

> Contrato historico preservado. A interface Agenda/Eventos foi descontinuada.
> Demandas novas usam automaticamente o endereco principal do restaurante,
> sem evento. Ver [relatorio e implantacao](./agenda-retirement-report.md).
> As instrucoes abaixo sobre a entrega original nao autorizam reaplicar migrations.

## Escopo e arquitetura

Implementacao preparada, **sem execucao de SQL nesta entrega**, nem mesmo em
banco local de testes. Aplicacao no Supabase depende de revisao e autorizacao.

Dependencias efetivas:

1. Schema de `users` e eventos equivalente a
   [restaurant_events](../supabase/migrations/20261015010000_restaurant_events.sql).
2. Catalogo e RPCs da
   [Fase 1](../supabase/migrations/20261015060000_work_locations_catalog.sql),
   ja confirmada pelo responsavel como aplicada.
3. Nova migration
   [event_location_snapshots](../supabase/migrations/20261015070000_event_location_snapshots.sql).

Nao reaplicar as duas primeiras migrations se os contratos ja estiverem presentes.
Nao depender de todo o historico. Nao aplicar a proposta operacional suspensa
`20261015050000`. Ela conflita com estas colunas e nao pertence a esta fase.

Modelo:

```text
users (restaurante)
  |-- work_locations (catalogo mutavel)
  |     |-- events.work_location_id (origem opcional)
  |-- events (dados basicos + COPIA independente do local)
```

`work_location_id` identifica a origem, mas a interface exibe exclusivamente o
snapshot salvo em `events`. Nao ha join para atualizar o endereco exibido.
Editar, arquivar ou trocar o padrao do catalogo nao altera eventos existentes.
Tambem nao ha propagacao futura de coordenadas: resolver o catalogo futuramente
nao resolvera silenciosamente os snapshots antigos.

Nao altera jobs, applications, checkins, checkouts, regras de presenca,
geocodificador, GPS, notificacoes ou push. Nao adiciona variaveis de ambiente.
O componente de eventos deixa de usar o formulario/geocodificador da proposta
suspensa e nao oferece o atalho de heranca evento -> vaga. O codigo anterior
de vagas no worktree nao foi integrado/revisado nesta fase.

## Colunas e constraints

Todas as colunas de snapshot sao anulaveis, sem valores padrao, salvo onde indicado.

| Coluna | Tipo | Finalidade |
|---|---|---|
| work_location_id | uuid | FK opcional para a origem no catalogo |
| location_name | text | Nome copiado |
| event_address | text | Logradouro copiado |
| event_number | text | Numero copiado, inclusive vazio |
| event_neighborhood | text | Bairro copiado, inclusive vazio |
| event_city | text | Cidade copiada |
| event_state | text | UF copiada |
| event_postal_code | text | CEP copiado, inclusive vazio |
| event_country_code | text | Pais copiado, BR |
| event_latitude / event_longitude | double precision | Coordenadas copiadas, opcionais |
| location_status | text NOT NULL DEFAULT not_set | Estado consistente do snapshot |
| location_snapshot_at | timestamptz | Momento da copia |
| location_source_version | integer | address_version da origem no momento da copia |
| revision | integer NOT NULL DEFAULT 1 | Concorrencia de edicao do evento |

Constraints novas:

- `events_revision_check`: revisao positiva.
- `events_location_status_check`: somente not_set, pending_coordinates ou ready.
- `events_location_snapshot_check`: sem local exige todos os campos nulos;
  com local exige FK, endereco completo conforme o contrato do catalogo,
  data de copia e versao positiva. Campos opcionais do endereco podem ser vazios.
  pending_coordinates exige ambas as coordenadas nulas;
  ready exige ambas presentes e dentro dos limites geograficos.
- FK para catalogo `ON DELETE NO ACTION`: nao permite apagar definitivamente
  uma origem ainda referenciada. Nao existe cascade de local para evento.
  NO ACTION, em vez de RESTRICT, permite verificar a integridade ao fim da
  instrucao, preservando a possibilidade de cascade de exclusao da conta
  quando eventos e locais do proprietario sao removidos na mesma instrucao.
  Exclusao de conta continua destrutiva como antes; nao e fluxo desta entrega.

Indice novo: `events_work_location_idx`, parcial para origens nao nulas.
O indice existente de restaurante/data continua em uso.

Historico preservado: eventos antigos recebem apenas `revision=1` e
`location_status=not_set`; local nulo. Nao se copia endereco cadastral,
local padrao ou GPS. Nao se altera status, data, descricao ou timestamps
de eventos anteriores via UPDATE de backfill. Nenhum dado de presenca e tocado.

## Backend: RPC autoritativa

`save_restaurant_event` recebe os campos basicos do evento, id/revisao quando
editando, e uma acao explicita:

| Acao | Resultado |
|---|---|
| keep | Preserva integralmente o snapshot existente; na criacao, deixa sem local |
| clear | Remove o vinculo e todo o snapshot |
| set | Valida e copia a versao atual de um local ativo do proprio restaurante |

Para set, recebe `p_work_location_id` e `p_location_revision`. A revisao precisa
coincidir com a que a interface mostrou; se mudou, falha explicitamente, sem
copiar uma versao que o usuario nao conferiu. Selecionar novamente o mesmo
local e uma substituicao explicita, nao uma atualizacao automatica.

Fluxo transacional:

1. `auth.uid()` precisa corresponder a `users.role=restaurant`.
2. Bloqueia a linha do restaurante, na mesma ordem de locks das RPCs do catalogo.
3. Em edicao, verifica propriedade e `p_expected_revision` do evento.
4. Em set, verifica propriedade, local ativo e revisao da origem.
5. Copia nome, endereco, coordenadas, versao e data no banco.
6. Insere/atualiza evento, incrementa revisao de edicao e retorna o registro salvo.

Catalogo pending/failed/needs_review resulta em Coordenadas pendentes.
Catalogo resolved resulta em Coordenadas disponiveis, copiando coordenadas ja
existentes. Nao chama servico externo. Falha de geocodificacao nunca bloqueia
este fluxo; nao ha geocodificacao nesta fase.

RLS/permissoes:

- Mantem todas as policies existentes de eventos, inclusive as restritivas.
- Mantem SELECT e DELETE para authenticated sob as policies de propriedade.
- Revoga INSERT/UPDATE diretos de PUBLIC, anon e authenticated em events.
- Concede EXECUTE da nova RPC somente a authenticated.
- RPC SECURITY DEFINER usa search_path vazio e valida identidade, papel e
  propriedade internamente; nao recebe proprietario nem snapshot do navegador.
- Nenhuma permissao nova de catalogo para worker ou anon. Nenhum admin e criado.
- Escritas privilegiadas/service_role continuam exigindo disciplina: obedecer
  constraints, propriedade e incremento de revisao. Nao foi criado trigger
  generico para clientes privilegiados.

## Frontend e navegacao apos descontinuacao

- A rota visual `/restaurant/events`, seu componente e atalhos foram removidos.
- A criacao de demandas nao consulta eventos nem aceita sua pre-selecao por URL.
- A RPC `save_restaurant_event`, revisoes, RLS, FKs e snapshots continuam intactos.
- Clientes legados com origem event/catalog/none continuam compativeis.
- O dashboard atual e baseado em demandas/vagas; nao exibe uma agenda de eventos.
- O contrato de snapshots abaixo permanece documentado para dados historicos.

## Aplicacao futura: ordem segura

1. Revisar migration, grants reais, policies e dependencias em staging.
2. Confirmar backup/PITR; exportar eventos e catalogo antes de alterar producao.
3. Verificar que a proposta suspensa nao foi aplicada. Se houver colunas
   coincidentes, **parar**: nao usar IF NOT EXISTS para esconder divergencias.
4. Registrar os grants/policies/definicoes atuais para rollback.
5. Pausar gravacoes de eventos durante a troca de versao.
6. Quando autorizado, executar **somente a nova migration**, integralmente,
   numa sessao limpa, sem outra transacao aberta.
7. Validar schema, grants e RPCs. Confirmar reload do schema PostgREST.
8. Publicar frontend correspondente e reabrir gravacoes apos teste de fumaca.
9. Atualizar/reabrir abas antigas: versoes antigas que escrevem diretamente
   em events serao recusadas apos a revogacao de INSERT/UPDATE.

Nao usar `db push` indiscriminado neste worktree com outras migrations pendentes.
O arquivo e transacional e nao idempotente. Um erro antes do COMMIT exige
ROLLBACK da sessao; nao repetir sobre estado parcialmente desconhecido.
NOTIFY esta apos COMMIT: falha nele nao significa que a migration foi revertida.
ALTER TABLE/validacao de constraints demanda locks e pode varrer eventos;
usar janela de baixo movimento. lock_timeout=5s evita espera indefinida e
statement_timeout=5min limita cada instrucao, nao a transacao inteira.

### Preflight SQL (para revisao; nao executado nesta entrega)

```sql
SELECT to_regclass('public.events') AS events,
       to_regclass('public.work_locations') AS work_locations;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('events','work_locations')
ORDER BY table_name, ordinal_position;

SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('events','work_locations');

SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='events';
-- Inspecionar tambem grants por coluna ou papeis herdados customizados.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='events';

SELECT to_regprocedure('public.save_restaurant_event(text,text,date,time without time zone,time without time zone,integer,text,uuid,integer,text,uuid,integer)')
       AS new_rpc_must_be_null;
SELECT pg_get_functiondef('public.set_event_updated_at()'::regprocedure);
```

### Validacao SQL apos aplicacao autorizada

```sql
SELECT location_status, count(*) FROM public.events GROUP BY location_status;
-- Antes de novos cadastros: todos os anteriores devem estar em not_set.

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.events'::regclass;

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='events';

SELECT has_table_privilege('authenticated','public.events','SELECT') AS read_true,
       has_table_privilege('authenticated','public.events','DELETE') AS delete_true,
       has_any_column_privilege('authenticated','public.events','INSERT') AS insert_false,
       has_any_column_privilege('authenticated','public.events','UPDATE') AS update_false;

SELECT has_function_privilege('authenticated',
  'public.save_restaurant_event(text,text,date,time,time,integer,text,uuid,integer,text,uuid,integer)',
  'EXECUTE') AS execute_true,
  has_function_privilege('anon',
  'public.save_restaurant_event(text,text,date,time,time,integer,text,uuid,integer,text,uuid,integer)',
  'EXECUTE') AS anon_false;

SELECT e.id FROM public.events e
JOIN public.work_locations l ON l.id=e.work_location_id
WHERE e.restaurant_id<>l.restaurant_id;
-- Nenhuma linha.

SELECT id FROM public.events WHERE
  (location_status='not_set' AND work_location_id IS NOT NULL)
  OR (location_status='ready' AND (event_latitude IS NULL OR event_longitude IS NULL))
  OR (location_status='pending_coordinates' AND (event_latitude IS NOT NULL OR event_longitude IS NOT NULL));
-- Nenhuma linha. Nao comparar endereco com catalogo como regra de igualdade:
-- diferencas apos edicao do catalogo sao intencionais.
```

## Checklist de staging/funcional

- [ ] Eventos preexistentes preservados, sem local atribuido automaticamente.
- [ ] Criar evento sem local e recarregar: Local nao definido.
- [ ] Criar evento selecionando local sem coordenadas: Coordenadas pendentes.
- [ ] Nome/endereco/numero/bairro/cidade/UF/CEP iguais ao preview da selecao.
- [ ] Em fixture de staging com local ja resolvido, copiar e exibir Coordenadas disponiveis.
      Nao habilitar geocoder/GPS nem forcar coordenadas pelo navegador para este teste.
- [ ] Editar catalogo: evento continua com nome/endereco/coordenadas originais.
- [ ] Editar somente titulo/status do evento: snapshot e data da copia preservados.
- [ ] Selecionar novamente a mesma origem: copia sua versao atual explicitamente.
- [ ] Trocar para outro local: substitui somente o snapshot deste evento.
- [ ] Remover local: FK e todos os campos de snapshot ficam nulos, estado not_set.
- [ ] Arquivar origem: evento continua exibindo/permitindo manter snapshot; origem
      nao aparece para novas selecoes.
- [ ] Tentar excluir origem arquivada ainda referenciada: FK bloqueia, UI orienta arquivamento.
- [ ] Remover vinculos/excluir eventos em staging permite posterior exclusao do local.
- [ ] Padrao sugerido em evento novo pode ser removido; trocar padrao nao muda eventos existentes.
- [ ] Criar local em nova aba, atualizar catalogo e selecionar sem perder formulario.
- [ ] Falha de catalogo nao impede evento sem local nem edicao keep.
- [ ] Falha de eventos mostra erro, nao lista vazia; Atualizar eventos recupera.
- [ ] Alterar local em outra aba antes de set: conflito de revisao, nenhuma copia silenciosa.
- [ ] Alterar evento em outra aba: edicao/exclusao antiga recusada, sem sobrescrita.
- [ ] Duplo clique envia uma unica gravacao; erro preserva formulario.
- [ ] Restaurante B nao consulta/altera eventos de A nem pode selecionar local de A.
- [ ] Worker/anon nao executam mutacoes de eventos nem consultam catalogo.
- [ ] INSERT/UPDATE direto autenticado e tentativa de enviar snapshot forjado sao recusados.
- [ ] Logout/troca de conta com formulario aberto impede envio com sessao anterior.
- [ ] Dashboard exibe os mesmos tres estados e nome/cidade do snapshot.
- [ ] Criacao, cancelamento, conclusao e exclusao de evento continuam funcionando.
- [ ] Nenhum teste de eventos muda vagas, candidaturas, check-in/out ou pede GPS.
- [ ] Validar layout mobile e desktop, enderecos longos, teclado e labels.

Testes automatizados desta entrega:

```powershell
node --test tests\event-locations.test.mjs tests\work-locations.test.mjs tests\ui.test.mjs
npm run lint
npm run typecheck
npm run build
```

Os testes de eventos executam o componente real com React/Supabase simulados,
validam parametros/estados/erros e verificam contratos no texto da migration.
**Nao executam SQL nem comprovam runtime de PostgreSQL/RLS/concorrencia.**
Os itens de banco acima precisam de staging autorizado antes de producao.

## Rollback futuro (nao executar agora)

Preferir rollback de aplicacao com manutencao ou correcao progressiva, mantendo
as colunas e dados. Um frontend anterior que escreva diretamente precisa de
INSERT/UPDATE restaurados, o que reabre a possibilidade de snapshots
inconsistentes: restaurar grants so junto de uma decisao consciente de rollback.
Nao restaurar o frontend da proposta operacional suspensa, que exige outro schema.

Antes de rollback destrutivo:

1. Pausar gravacoes e verificar backup/exportacao completa dos snapshots.
2. Identificar dependentes adicionados depois desta fase. Se houver, nao usar CASCADE.
3. Implantar versao compativel com schema-base de eventos.
4. Salvar grants/policies originais e confirmar que nenhuma outra fase usa a RPC.
5. Apos autorizacao, o SQL abaixo remove apenas a Fase 2; ele perde snapshots,
   referencias e revisoes, mas mantem os eventos basicos e o catalogo.

```sql
BEGIN;
SET LOCAL lock_timeout='5s';
DROP FUNCTION public.save_restaurant_event(text,text,date,time,time,integer,text,uuid,integer,text,uuid,integer);
DROP INDEX public.events_work_location_idx;
ALTER TABLE public.events
  DROP CONSTRAINT events_location_snapshot_check,
  DROP CONSTRAINT events_location_status_check,
  DROP CONSTRAINT events_revision_check,
  DROP COLUMN work_location_id,
  DROP COLUMN location_name,
  DROP COLUMN event_address,
  DROP COLUMN event_number,
  DROP COLUMN event_neighborhood,
  DROP COLUMN event_city,
  DROP COLUMN event_state,
  DROP COLUMN event_postal_code,
  DROP COLUMN event_country_code,
  DROP COLUMN event_latitude,
  DROP COLUMN event_longitude,
  DROP COLUMN location_status,
  DROP COLUMN location_snapshot_at,
  DROP COLUMN location_source_version,
  DROP COLUMN revision;
-- Correspondente ao contrato-base conhecido. Conferir o registro do preflight.
GRANT INSERT, UPDATE ON TABLE public.events TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
```

Nao apagar work_locations, nao desfazer Fase 1 nem reaplicar migrations antigas.
Validar novamente RLS, CRUD basico e contagem dos eventos; manter exportacao dos
snapshots para eventual restauracao. Os mesmos eventos podem ter sido editados
apos o backup: restauracao integral de banco exige plano proprio para evitar
perda de outras alteracoes.
