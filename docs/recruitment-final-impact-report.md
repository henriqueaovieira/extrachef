# Relatorio final de impacto: disponibilidade para recrutamento

Data: 2026-11-04.

Atualizacao: a [revisao de compatibilidade](./recruitment-schema-compatibility.md)
documenta a assinatura produtiva de emissao com dois argumentos e a migration
revisada, que preserva GPS somente onde ele ja existe. Essa nota substitui a
suposicao de assinatura GPS obrigatoria nas secoes abaixo.

## Status e escopo

A implementacao local foi aprovada pelo responsavel pelo produto. Este documento
consolida o impacto para **planejamento da implantacao**, nao autoriza aplicacao
remota e nao certifica a base principal.

Nesta revisao foram feitas somente leituras locais e a criacao deste relatorio.
Nao houve conexao remota, uso de sessoes de usuarios, migration aplicada,
`db push`, deploy, commit ou push. Nenhum codigo ou SQL foi modificado nesta revisao.

O worktree contem alteracoes de diversas tarefas anteriores. Diferenciam-se:

- **Escopo aprovado de recrutamento:** uma migration e os consumidores/testes
  listados abaixo.
- **Lote local acumulado:** 13 migrations novas, incluindo funcionalidades e
  reconciliacoes anteriores. Arquivo novo no Git nao significa migration pendente
  no banco. O historico remoto nao foi consultado.
- **Outras alteracoes do worktree:** nao sao automaticamente parte deste pacote
  nem devem entrar em um deploy por conveniencia.

As evidencias executadas anteriormente estao no
[relatorio de validacao local](./recruitment-local-validation.md):
81 testes aprovados, typecheck, lint focal e diff-check. Nao foram repetidos
testes nesta revisao exclusivamente documental.

## 1. Migrations criadas ou alteradas

No inventario Git atual, as 13 migrations abaixo sao **novas/nao rastreadas**.
Nao ha migration ja rastreada com alteracao no worktree. Dentro deste lote, somente
a ultima foi criada e refinada para a disponibilidade de recrutamento.

| Ordem local | Migration | Finalidade / impacto |
|---|---|---|
| 1 | [20261103000000_verified_profile.sql](../supabase/migrations/20261103000000_verified_profile.sql) | Verificacao de perfil, funcoes, indice, trigger, policies de Storage e diretorio publico. Trabalho anterior. |
| 2 | [20261103010000_optional_operation_geocoding.sql](../supabase/migrations/20261103010000_optional_operation_geocoding.sql) | Remove a obrigatoriedade de geocodificacao via trigger/funcao de jobs; nao remove os dados de endereco. Trabalho anterior. |
| 3 | [20261104000000_reconcile_checkin_gps.sql](../supabase/migrations/20261104000000_reconcile_checkin_gps.sql) | Reconcilia emissao de codigo com GPS; remove assinatura antiga de dois argumentos. |
| 4 | [20261104010000_reconcile_verified_profile.sql](../supabase/migrations/20261104010000_reconcile_verified_profile.sql) | Reconcilia funcoes, indice, trigger, policies e view da verificacao. |
| 5 | [20261104020000_reconcile_worker_earnings.sql](../supabase/migrations/20261104020000_reconcile_worker_earnings.sql) | Reconcilia RPC de ganhos estimados do profissional. |
| 6 | [20261104030000_reconcile_operational_inbox.sql](../supabase/migrations/20261104030000_reconcile_operational_inbox.sql) | Reconcilia inbox operacional paginada do restaurante. |
| 7 | [20261104040000_reconcile_geocoded_locations.sql](../supabase/migrations/20261104040000_reconcile_geocoded_locations.sql) | Reconcilia salvamento de local com coordenadas, sem restaurar geocodificacao obrigatoria. |
| 8 | [20261104050000_reconcile_restaurant_demand_location.sql](../supabase/migrations/20261104050000_reconcile_restaurant_demand_location.sql) | Reconcilia criacao de demanda com endereco do restaurante; assinatura anterior com quantidade. |
| 9 | [20261104060000_reconcile_talent_interest.sql](../supabase/migrations/20261104060000_reconcile_talent_interest.sql) | **Somente SELECT diagnostico** de categorias e contagens; nao restaura Interesse nem altera schema/dados. |
| 10 | [20261104070000_reconcile_operational_schedule.sql](../supabase/migrations/20261104070000_reconcile_operational_schedule.sql) | Instala/reutiliza pg_cron e reconfigura o job operacional nominal por minuto. |
| 11 | [20261104080000_single_vacancy_operations.sql](../supabase/migrations/20261104080000_single_vacancy_operations.sql) | Substitui criacao com quantidade por assinatura de 11 argumentos, uma vaga. |
| 12 | [20261104090000_restore_talent_interest.sql](../supabase/migrations/20261104090000_restore_talent_interest.sql) | Ajusta constraint e RPC de Interesse/Favoritos. Esta e a restauracao efetiva de Interesse. |
| 13 | [20261104180000_recruitment_availability.sql](../supabase/migrations/20261104180000_recruitment_availability.sql) | Corte, urgencia, elegibilidade backend, substituicao no mesmo job e chat por contratacao. **Escopo desta implementacao.** |

### DDL da migration de recrutamento

- `operational_assignments`: adiciona `replacement_requested_at` e
  `replacement_closed_at`; remove `operational_assignments_job_id_key`.
- Cria `operational_one_current_assignment`, unico por job quando
  `interruption IS NULL`; cria `operational_job_history_idx` e
  `operational_legacy_replacement_idx`.
- Remove `checkins_one_per_job` e `checkouts_one_per_job`. Preserva
  `checkins_one_per_worker_job` e `checkouts_one_per_worker_job`.
- `demand_invitations`: adiciona FK nullable `replacement_assignment_id`;
  remove `demand_invitations_demand_id_worker_id_key`; cria indices unicos
  `demand_invitation_normal` e `demand_invitation_replacement`.
- `messages`: adiciona FK nullable `assignment_id`, realiza backfill por job,
  cria `messages_assignment_idx` e concede leitura da coluna a autenticados.
- Cria/adapta funcoes, policies e triggers discriminados nas secoes seguintes.
- Nao cria tabelas, enums ou status persistidos; nao apaga registros.
- Usa transacao explicita, `lock_timeout = 5s` e `statement_timeout = 5min`.
- Preflight verifica dependencias selecionadas e constraints esperadas.
  Nao e uma certificacao completa do schema de destino nem torna o arquivo
  idempotente: nao reaplicar manualmente uma migration ja concluida.

## 2. Arquivos alterados no escopo de recrutamento

Os caminhos sao relativos a raiz do repositorio; os links identificam cada arquivo.
Alguns arquivos tambem contem trabalho anterior, que nao deve ser revertido ou
atribuido integralmente a esta implementacao.

### Dominio e consumidores

| Arquivo | Impacto |
|---|---|
| [lib/demands.ts](../lib/demands.ts) | Janela de corte/urgencia e elegibilidade reutilizadas; consulta campos computados. |
| [lib/restaurant-home.ts](../lib/restaurant-home.ts) | Apresentacao e disponibilidade na Home do restaurante. |
| [lib/operations.ts](../lib/operations.ts) | Contexto e multiplos assignments historicos por job. |
| [lib/demand-detail.ts](../lib/demand-detail.ts) | Contexto e labels de eventos de substituicao/decisao. |
| [lib/restaurant-team.ts](../lib/restaurant-team.ts) | Diferencia profissional atual de assignments anteriores. |
| [app/worker/dashboard/page.tsx](../app/worker/dashboard/page.tsx) | Descoberta filtrada no SQL e localmente; atualizacao temporal e bloqueio no handler. |
| [app/worker/invitations/page.tsx](../app/worker/invitations/page.tsx) | Limite de aceite, expiracao e convite de substituicao. |
| [app/worker/applications/page.tsx](../app/worker/applications/page.tsx) | Mantem participacao/historico com assignment do proprio profissional. |
| [app/restaurant/dashboard/page.tsx](../app/restaurant/dashboard/page.tsx) | Disponibilidade de recrutamento separada da execucao. |
| [app/restaurant/dashboard/jobs/create/page.tsx](../app/restaurant/dashboard/jobs/create/page.tsx) | Aviso de urgencia e bloqueio de inicio ja atingido. |
| [app/restaurant/candidates/talent-center.tsx](../app/restaurant/candidates/talent-center.tsx) | Descoberta/convites versus contratacao de candidatos existentes. |
| [app/restaurant/demands/[demandId]/demand-detail.tsx](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Decisao explicita, reserva, confirmacao e revalidacao de modal/tela aberta. |
| [app/components/demand-card.tsx](../app/components/demand-card.tsx) | Contexto coerente com elegibilidade. |
| [app/components/demand-talent-network.tsx](../app/components/demand-talent-network.tsx) | Convites condicionados, Interesse/Favoritos preservados. |
| [app/components/operational-panel.tsx](../app/components/operational-panel.tsx) | Mantem execucao sem reabrir recrutamento. |
| [app/chat/[jobId]/chat-client.tsx](../app/chat/[jobId]/chat-client.tsx) | Contratacao atual e limpeza do contexto ao mudar o relacionamento. |

### Migration, testes e documentacao

- Criados: [migration de recrutamento](../supabase/migrations/20261104180000_recruitment_availability.sql)
  e [tests/recruitment-sql.test.mjs](../tests/recruitment-sql.test.mjs).
- Testes alterados neste escopo:
  [tests/demands.test.mjs](../tests/demands.test.mjs),
  [tests/demand-detail.test.mjs](../tests/demand-detail.test.mjs),
  [tests/operational-ui.test.mjs](../tests/operational-ui.test.mjs) e
  [tests/restaurant-team.test.mjs](../tests/restaurant-team.test.mjs).
- Documentacao: [README.md](../README.md),
  [relatorio de validacao local](./recruitment-local-validation.md) e este relatorio.

Os demais arquivos sujos de perfil, configuracoes, navegacao, geocodificacao,
consolidacao e dependencias nao integram automaticamente esta lista de entrega.
O pacote final precisa ser delimitado por diff revisado, e nao por inclusao de
todo o worktree. O componente OperationFlow existente nao foi recriado.

## 3. RPCs e funcoes afetadas

Todas as assinaturas abaixo estao no schema `public`.

| RPC existente | Alteracao |
|---|---|
| `invite_demand_worker(uuid,uuid)` | Convite comum apenas durante recrutamento; substituicao exige decisao e candidato anterior. |
| `respond_demand_invitation(uuid,boolean)` | Aceite comum antes do inicio; reserva antes do termino; aceite nao contrata. |
| `approve_application(uuid,uuid)` | Contratacao comum antes do inicio; substituicao somente dentro das regras e com locks. |
| `approve_demand_candidate(uuid,uuid)` | Reutiliza aprovacao validada; preserva fallback historico entre slots elegiveis. |
| `manage_restaurant_demand(uuid,text,text,text,date,time,time,numeric,integer)` | Wrapper adiciona `seek_replacement` e `close_interrupted`; encaminha a gestao anterior. |
| `interrupt_operational_assignment(uuid,text)` | Registra ocorrencia no mesmo job; nao clona/reabre automaticamente. |
| `worker_demand_invites()` | Drop/recreate para ampliar retorno com `can_accept`, `is_replacement`, `expires_at`. |
| `operational_context(uuid)` | Contexto da contratacao correspondente ao participante. |
| `issue_operational_code(uuid,text,double precision,double precision)` | Emissao para assignment correto, preservando validacoes operacionais/GPS. |
| `validate_operational_code(uuid,text,text)` | Check-in/checkout vinculados a contratacao correta. |
| `record_operational_payment(uuid,text)` | Pagamento da contratacao correta, com fases preservadas. |
| `mark_chat_messages_read(uuid,uuid[])` | Leitura/notificacoes limitadas ao relacionamento autorizado. |
| `get_chat_message_preview(uuid)` | Preview nao expoe conversa do profissional anterior ao sucessor. |
| `restaurant_operational_message_inbox(integer,integer)` | Inbox usa assignment atual e preserva a estrutura de retorno. |

Funcoes auxiliares criadas/adaptadas:

- `recruitment_closes_at(jobs)`, `recruitment_blocked(jobs)`,
  `recruitment_available(jobs)` e `recruitment_hireable(jobs)`: helpers
  compartilhados/computed fields. Nao sao novas RPCs de fluxo operacional.
- `participant_assignment(uuid)`: auxiliar interno sem execucao direta para
  PUBLIC, anon ou authenticated.
- `manage_restaurant_demand_before_recruitment(...)`: funcao existente renomeada,
  preservada internamente e sem execucao direta para esses papeis.
- `demand_talent_directory_before_trust(uuid,uuid,integer,integer,boolean)`:
  auxiliar interno substituido para lidar com multiplos convites por profissional;
  o diretorio publico existente continua sendo o ponto de acesso.
- `guard_recruitment_job()`, `require_open_job_for_application()` e
  `bind_message_assignment()`: funcoes de trigger.

As RPCs adaptadas recebem REVOKE explicito de PUBLIC/anon e GRANT para
authenticated. As auxiliares internas nao devem ser expostas como endpoints de
cliente. Conferir os grants efetivos do destino, inclusive papeis administrativos.

### RPCs do lote anterior, se tambem entrarem no plano

`submit_own_profile_verification`, `review_profile_verification`,
`is_submitted_verification_photo`, `get_worker_estimated_earnings`,
`save_geocoded_work_location`, `create_restaurant_demand` e
`set_talent_connection`; alem das redefinicoes anteriores de
`issue_operational_code` e `restaurant_operational_message_inbox`.

A criacao de demanda passa de 12 para 11 argumentos, sem `p_quantity`.
Esses impactos pertencem ao lote anterior e requerem revisao dos clientes desse
lote, nao apenas do recrutamento.

## 4. Policies afetadas

### Recrutamento

| Tabela / policy | Operacao e impacto |
|---|---|
| `jobs.jobs_select_open_or_owned` | Recriada, SELECT permissiva: descoberta somente recrutavel, com excecoes de dono/candidato/convidado. |
| `jobs.jobs_select_open_or_owned_restrictive` | Recriada, SELECT restritiva com o mesmo limite, evitando que outra permissiva reabra descoberta. |
| `applications.applications_insert_worker_open_job` | Recriada, INSERT permissiva: proprio worker, status pending e job recrutavel. |
| `applications.applications_insert_worker_open_job_restrictive` | Recriada, INSERT restritiva equivalente. |
| `messages.messages_current_relationship` | Nova, SELECT restritiva: assignment vinculado, nao interrompido e usuario participante. |

RLS de convites, assignments, check-ins e checkouts nao e recriada pela migration
de recrutamento. Sua interacao com as funcoes SECURITY DEFINER existentes continua
relevante e precisa ser conferida no destino.

**Atencao ao significado de chat preservado:** mensagens nao sao apagadas.
A nova policy nao oferece leitura da conversa interrompida nem de mensagens sem
assignment. Ela isola o relacionamento atual; nao garante acesso visual irrestrito
a todas as conversas historicas.

### Lote anterior

As migrations de verificacao criam/recriam, em `storage.objects`,
`worker_selfie_private`, `worker_selfie_no_update` e `worker_selfie_no_delete`.
Tambem atualizam a view `public_user_directory`. Nao confundir esses objetos
com as cinco policies de recrutamento acima.

## 5. Triggers afetados

| Trigger | Situacao |
|---|---|
| `jobs.jobs_guard_recruitment` | Novo, BEFORE INSERT ou UPDATE OF status/job_date/start_time/created_at; fixa publicacao, valida inicio e bloqueia reabertura. |
| `messages.messages_bind_assignment` | Novo, BEFORE INSERT; valida participantes e fixa assignment atual. |
| `applications.applications_require_open_job` | Trigger existente mantido; funcao substituida para validar corte, excecao de convite e conta/status. |
| `applications.applications_operational_hire` | Mantido sem redefinicao; depende da aprovacao e registra a contratacao. Preflight exige trigger habilitado. |

Dependencias preservadas, com impacto indireto:
`applications_00_operational_reviews`, `jobs_operational_reviews`, triggers de
atividade de demanda (`jobs_demand_activity`, `applications_demand_activity`,
`invitations_demand_activity`, `reserves_demand_activity`,
`checkins_demand_activity`, `checkouts_demand_activity`, `reviews_demand_activity`),
triggers de notificacoes e `messages_initialize_read_state`.
Nao sao removidos nem recriados pela migration de recrutamento.

No lote anterior, `worker_verification_guard` e criado/reconciliado;
`jobs_require_resolved_location` e removido pela geocodificacao opcional, junto
de sua funcao. Nao o restaurar acidentalmente ao planejar reversao.

## 6. Possiveis incompatibilidades com dados existentes

| Ponto | Risco e providencia antes da liberacao |
|---|---|
| Schema divergente | Constraints com outros nomes, funcoes ausentes, retorno diferente, grants ou triggers desabilitados podem impedir aplicacao. Comparar schema e historico instalados; nao contornar preflight removendo protecoes. |
| Mensagens sem assignment | Backfill nao encontra relacionamento; dados ficam armazenados, mas ocultos. Quantificar e decidir tratamento sem inventar vinculo historico. |
| Conversas de assignments interrompidos | Ficam fora da leitura pela nova policy, mesmo com backfill. Confirmar aceitacao dessa restricao e preservar dados para auditoria. |
| Substituicoes antigas por clone | `replacement_job_id` e preservado e bloqueia descoberta do clone; nao ha conversao automatica para substituicao no mesmo job. Inventariar operacoes ainda ativas nesse formato. |
| Demandas antigas multivaga | Linhas permanecem; nao ha consolidacao automatica. Testar navegacao, candidatos e contratacao do legado em amostra representativa. |
| Datas e criacao historicas | Corte deriva do inicio e de `created_at`; importacoes, nulls ou horarios inconsistentes podem mudar elegibilidade. Auditar especialmente operacoes ativas e virada de dia. |
| Escritas administrativas/importacoes | Trigger fixa `created_at`, impede alteracao e rejeita novo job com inicio passado. Scripts antigos de carga ou correcao podem deixar de funcionar. |
| Reabertura antiga | Transicao de cancelado/preenchido para open e updates open com assignment deixam de ser permitidos, inclusive por consumidores antigos. |
| Suposicao de uma linha por job | Apos substituicao podem existir varios assignments/check-ins/checkouts historicos. Integracoes, exports e consultas externas com singleton precisam filtrar contratacao atual ou proprio worker. Nao foram inspecionadas integracoes externas. |
| Convites historicos | Convite comum e preservado com nova FK nula. Passa a poder coexistir com convites de substituicao; consumidores nao podem presumir um unico convite total por demanda/worker. |
| Dependencias SQL de RPC recriada | `worker_demand_invites()` tem retorno ampliado e e drop/recreate sem CASCADE; objetos dependentes no destino podem bloquear a migration. Capturar dependencias antes. |
| Clientes antigos | Novo frontend usa computed fields/retornos novos; frontend antigo nao apresenta decisao/substituicao corretamente. Criacao sem quantidade tambem exige coordenacao com a migration anterior. |
| Tempo de DDL/backfill | Locks, scan de mensagens/indices e tamanho real podem exceder 5s/5min; janela e volume nao medidos remotamente. |
| Cron operacional | Corte e calculado nas consultas e escritas; nao depende de cron para fechar descoberta. O cron operacional existente e preservado e deve continuar saudavel. |
| Concorrencia real | Locks existem, mas PGlite nao valida conexoes independentes. Testar ordens de locks de worker/job, espera cruzando limites e possiveis deadlocks. |

Nao houve exclusao de dados na implementacao. A fixture populada confirma
preservacao local de IDs/estados, backfill quando ha assignment e continuidade
de operacao concluida. Nao certifica todos os dados ou caminhos da base real.

## 7. Estrategia de rollback

**Nao existe down migration pronta nem rollback de producao ensaiado.**
O plano concreto deve ser preparado depois do inventario do destino, antes da
autorizacao de aplicacao.

### Preparacao obrigatoria

1. Capturar backup recuperavel e testar restauracao no ambiente autorizado.
2. Salvar definicoes e ACL anteriores de funcoes, policies, triggers, constraints,
   indices e versoes de app; registrar contagens e integridade referencial.
3. Definir janela coordenada e mecanismo para suspender escritas afetadas de todos
   os clientes/integracoes. Esconder botoes nao e suspensao de escrita backend.
4. Separar recuperacao de recrutamento da reversao das outras 12 migrations.
   Nao desfazer verificacao, privacidade, geocodificacao opcional ou Interesse
   como efeito colateral.

### Falha durante a transacao

A migration principal usa BEGIN/COMMIT: erro aborta a transacao e deve ser
concluido com rollback pela ferramenta executora. Confirmar que nao ficou
transacao aberta e verificar schema e historico de migrations.
Nao marcar aplicacao como concluida nem publicar frontend dependente.
Nao afirmar atomicidade do lote inteiro: as migrations sao transacoes separadas,
e o arquivo diagnostico e somente SELECT.

### Depois do commit, antes de haver novos registros no modelo

Com escritas suspensas e inventario confirmando ausencia de substituicoes/convites
novos e de historico multiplicado, pode-se preparar **nova migration corretiva**
para restaurar definicoes anteriores e constraints compativeis.
Nao editar ou apagar o historico da migration aplicada.

Mesmo nesse caso, restaurar a implementacao antiga pode reintroduzir o problema
de recrutamento. Preferir correcao forward preservando os bloqueios. Restaurar
app anterior sozinho nao desfaz banco nem garante compatibilidade.

### Depois de substituicoes ou multiplos registros por job

**Nao restaurar cegamente UNIQUE(job_id)** em assignments, check-ins ou checkouts,
nem UNIQUE(demand_id,worker_id) em convites: os dados novos podem viola-las.
Nao apagar assignments, convites, mensagens ou presencas para forcar rollback.

Preferir forward-fix compativel com historico e isolamento do chat. Remover a
policy de mensagens isoladamente pode expor conversa antiga ao sucessor.
Remover helpers antes de policies/funcoes dependentes tambem nao e seguro;
nao usar DROP CASCADE como atalho.

Se recuperacao total for indispensavel, restaurar backup em destino isolado,
planejar conciliacao das escritas posteriores e obter aprovacao para a perda de
janela/RPO e indisponibilidade/RTO. Restauracao de backup nao e garantia de
rollback sem perda de dados.

## 8. Ordem correta de aplicacao

Esta e uma **ordem de planejamento**, nao instrucao para executar agora.

1. Definir pacote revisado e ambiente autorizado; nao publicar todo o worktree.
2. Comparar historico de migrations do destino com o repositorio e inspecionar
   divergencias. Nao decidir reaplicacao pela ausencia de tracking no Git.
3. Garantir as dependencias historicas instaladas em sua ordem cronologica:
   candidaturas/RLS/chat, check-in/checkout/avaliacoes, demandas/controle,
   confianca operacional, locais, diretorio/inbox e GPS.
   As migrations locais nao substituem o schema-base preexistente.
4. Para o **lote acumulado**, aplicar somente as migrations realmente pendentes,
   na ordem 1 a 13 da secao 1. Nao executar 0500 depois de 0800, pois
   reintroduziria a assinatura anterior de criacao; nao executar reconciliacao
   antiga de GPS/inbox depois de 1800, pois substituiria corpos atualizados.
5. O arquivo 0600 e diagnostico, nao dependencia funcional de Interesse.
   Sua inclusao no historico deve ser explicitamente decidida no pacote de
   implantacao; nao o apresentar como correcao de schema nem exclui-lo
   silenciosamente de um historico que ja o tenha registrado.
6. Preflight e aplicacao de 1800 devem ocorrer apos as dependencias necessarias.
   Se as outras funcionalidades ja estiverem reconciliadas no destino, nao
   reaplicar todas as migrations anteriores apenas para chegar a 1800.
7. Conferir commit no banco, grants, dependencias e cache de schema da API.
   O frontend novo **nao pode preceder** a migration de recrutamento.
8. Coordenar a entrega do frontend com a janela de indisponibilidade das
   assinaturas antigas, particularmente criacao de demanda sem `p_quantity`.
9. Executar checklist e observar erros/locks/cron antes de encerrar a janela.

Nao usar `db push` indiscriminado no worktree atual. O comando pode selecionar
migrations de funcionalidades anteriores fora do pacote pretendido.

## 9. Checklist pos-aplicacao para validacao manual

Executar futuramente apenas no ambiente autorizado, com contas/dados de teste
aprovados. Registrar horario, perfis, resultado e evidencia de cada item.

### Banco e API

- [ ] Historico registra somente migrations autorizadas, sem transacao pendente.
- [ ] Preflight, constraints, FKs, indices, triggers habilitados e grants conferidos.
- [ ] Computed fields consultaveis pela API; nenhuma falha de schema cache.
- [ ] RPCs comuns acessiveis ao autenticado autorizado, negadas a anon;
      auxiliares internas sem execucao direta.
- [ ] Contagens/IDs/estados historicos comparados, FKs integras, sem linhas apagadas.
- [ ] Mensagens sem assignment e clones legados inventariados com tratamento aceito.
- [ ] Cron operacional ativo/saudavel, sem jobs duplicados ou erros novos.

### Recrutamento comum e urgente

- [ ] Publicacao antes do corte aparece na Home e Vagas Abertas; permite candidatura e convite.
- [ ] Corte atingido remove descoberta e bloqueia novas participacoes, inclusive INSERT/RPC direto.
- [ ] Candidato existente continua visivel e pode ser contratado apos corte, antes do inicio.
- [ ] Convite comum valido anterior ao corte pode ser aceito antes do inicio.
- [ ] Inicio atingido bloqueia contratacao comum e aceite comum, com/sem contratado.
- [ ] Publicacao urgente exatamente no corte e depois dele, antes do inicio:
      aviso exibido, descoberta/candidatura/convite permitidos ate antes do inicio.
- [ ] No inicio, urgente tambem fecha; nova publicacao com inicio passado e rejeitada.
- [ ] Tela, filtros e modal abertos durante mudanca temporal revalidam o limite.
- [ ] Operacao sem contratado permanece ao restaurante para gestao/historico,
      sem reaparecer em descoberta.
- [ ] Participante anterior acessa Candidaturas/Convites aplicaveis, nao Vagas Abertas.

### Ocorrencias e substituicao

- [ ] Ausencia, abandono e cancelamento preservam registro e nao reabrem vaga.
- [ ] Restaurante escolhe explicitamente encerrar ou buscar substituto.
- [ ] Sem decisao nao ha novo convite de substituicao.
- [ ] Externo ou candidato vinculado depois da ocorrencia nao pode substituir.
- [ ] Candidato anterior recebe convite de reserva e pode aceitar sem ser contratado.
- [ ] Restaurante confirma para efetivar; mesmo job/demanda, historico anterior mantido.
- [ ] Sem aceite, a operacao nao volta a descoberta; termino bloqueia substituicao.
- [ ] Operacoes legadas/clonadas/multivaga amostradas sem perda de gestao.

### Fluxo preservado e interface

- [ ] OperationFlow coerente para restaurante, contratado atual e participante anterior.
- [ ] Chat atual funciona; sucessor nao recebe mensagens/previews/notificacoes da relacao anterior.
- [ ] Restricao de leitura da conversa interrompida corresponde ao comportamento aceito.
- [ ] Check-in com GPS/token/tolerancia, pagamento, confirmacao de recebimento e checkout completos.
- [ ] Historico, avaliacoes, reputacao/confiança e Equipe corretos apos substituicao.
- [ ] Interesse, Favoritos, Talentos, Convites e Candidaturas sem regressao.
- [ ] Desktop/mobile autenticados validados, sem erro bloqueante de consultas.
- [ ] Criacao sem geocodificacao e criacao de uma vaga continuam funcionando,
      se o lote anterior tambem fizer parte da entrega.

### Concorrencia e encerramento da janela

- [ ] Duas conexoes PostgreSQL independentes aprovam candidatos simultaneamente:
      somente uma contratacao atual.
- [ ] Convite/aceite repetidos nao duplicam registros nem contratam automaticamente.
- [ ] Espera por lock cruzando corte/inicio/termino usa horario real ao decidir.
- [ ] Interrupcao concorrente com check-in/pagamento/checkout deixa estado consistente.
- [ ] Candidatura direta versus aceite de convite nao produz deadlock nao tratado;
      falhas/rollback/retentativas verificadas.
- [ ] Logs, latencia, locks, timeouts e cron observados em volume representativo.
- [ ] Responsavel registra resultado, riscos remanescentes e decisao explicita
      para o proximo ambiente.

## Parecer final

**Pronta para planejamento da implantacao, com aprovacao local registrada.**
Nao ha aprovacao automatica de aplicacao remota ou producao.

Antes de executar, permanecem obrigatorios o inventario do destino, a delimitacao
do pacote, o plano de recuperacao e a autorizacao explicita. A concorrencia real,
a interface autenticada e a compatibilidade efetiva com dados/schema remotos
continuam pendentes ate haver ambiente e validacao autorizados.
