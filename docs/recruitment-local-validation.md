# Recrutamento: relatorio de validacao local

## Conclusao e limite da aprovacao

**Implementacao validada localmente; homologacao externa e producao NAO aprovadas.**

Nao foi conectado nenhum banco remoto nesta etapa. Nao foram usadas contas reais,
sessoes existentes ou credenciais. Nao houve criacao de dados remotos, `db push`,
deploy, commit ou push. As fixtures SQL sao sinteticas e executadas em PGlite efemero.

Nao existe ambiente de homologacao separado disponibilizado. Portanto, este documento
nao certifica o schema, os dados, as permissoes ou o comportamento da base principal.
Tambem nao substitui testes autenticados de interface nem concorrencia PostgreSQL
com conexoes independentes.

## Regra confirmada para operacoes urgentes

Exemplo de inicio as 10:00, no fuso operacional America/Sao_Paulo:

| Publicacao | Corte efetivo | Comportamento |
|---|---|---|
| Antes das 05:00 | 05:00 | Recrutamento publico somente antes das 05:00. |
| Exatamente as 05:00 | 10:00 | Publicacao urgente: recrutamento ate antes das 10:00. |
| Depois das 05:00 e antes das 10:00 | 10:00 | Publicacao urgente permitida, com aviso existente na criacao. |
| As 10:00 ou depois | Nenhum novo recrutamento | Publicacao com inicio ja atingido e contratacao comum bloqueadas. |

A classificacao urgente considera `jobs.created_at >= inicio - 5 horas`.
O banco fixa `created_at` na insercao e impede sua alteracao posterior. O limite e
exclusivo: no instante do corte nao entram novas candidaturas nem novos convites.

Encerrar recrutamento nao cancela a operacao nem remove participantes:

- Candidato ja vinculado pode ser contratado depois do corte e antes do inicio.
- Convite comum enviado no periodo permitido pode ser aceito antes do inicio,
  mesmo depois do corte normal. O aceite mantem candidatura pendente; nao contrata.
- Contratacao encerra descoberta publica mesmo antes do corte.
- Depois do inicio, so a excecao explicita de substituicao pode contratar.
- Substituicao usa candidato anterior a ocorrencia, convite especifico aceito,
  confirmacao do restaurante e limite anterior ao termino.
- Ausencia, abandono ou cancelamento do contratado nao reabrem a vaga.
- Buscar substituto e encerrar sao decisoes explicitas; a operacao e o job permanecem
  os mesmos. O aceite da reserva nao realiza contratacao automatica.

## Evidencias executadas

Rodada combinada: **81 testes passaram, zero falhas, zero testes ignorados**.
Tambem passaram `npm run typecheck`, ESLint focal dos 16 arquivos TypeScript/TSX
do escopo e `git diff --check`.

| Cenario | Resultado local | Evidencia / limite |
|---|---|---|
| Antes, exatamente no e depois do corte | Aprovado | Helpers com horario fixo e SQL com candidatura/convite diretos. |
| Publicacao urgente no corte e depois dele | Aprovado | Igualdade SQL do corte efetivo; criacao, aviso e bloqueio no inicio em teste de componente. |
| Candidatura e convite em operacao urgente | Aprovado | SQL aceita antes do inicio; rejeita quando o inicio ja foi atingido. |
| Aceite e contratacao de urgente | Aprovado | Aceite gera candidatura pendente; aprovacao pre-inicio preenche a vaga e encerra descoberta. |
| Candidato existente depois do corte | Aprovado | Aprovacao permitida antes do inicio sem reabrir recrutamento. |
| Convite comum anterior ao corte | Aprovado | Aceite depois do corte e antes do inicio, com validacao backend. |
| Operacao iniciada, com ou sem contratado | Aprovado | Bloqueios de descoberta, candidatura, convite e contratacao comum. |
| Conta inativa e candidatura com status indevido | Aprovado | Trigger e RPC rejeitam os caminhos exercitados. |
| Ausencia, abandono e cancelamento | Aprovado | Historico preservado; job nao volta automaticamente a ser recrutavel. |
| Decisao, convite e aceite de substituto | Aprovado | Apenas candidato vinculado antes da ocorrencia; externo e fora do prazo rejeitados. |
| Confirmacao e ciclo operacional do substituto | Aprovado | Mesmo job, novo assignment, check-in, pagamento e checkout. |
| Chat e mensagens | Aprovado no SQL/mocks | Conversa vinculada ao assignment; sucessor nao recebe mensagens da relacao anterior; inbox e navegacao cobertos. |
| Check-in, pagamento, checkout e historico | Aprovado localmente | Regras de token/GPS/fases e ciclo de substituicao exercitados, sem aparelho ou pagamento externo real. |
| Interesse, Favoritos, Talentos e Equipe | Aprovado localmente | Suites de regressao e apresentacao; sem navegacao autenticada real. |
| Tela aberta cruzando corte/inicio | Aprovado em mocks | Relogio simulado e modal de contratacao bloqueado ao atingir o inicio. |
| Duas aprovacoes concorrentes no harness | Uma aceita, outra rejeitada | PGlite serializa as chamadas: NAO comprova concorrencia multi-sessao. |
| Migration sobre registros anteriores | Aprovado na fixture | Comparacao de registros/IDs/estados, backfill do chat e operacao historica multivaga preservada. |
| Schema incompativel no preflight | Aprovado na fixture | Constraint renomeada provoca erro explicito; rollback sem colunas parcialmente instaladas. |
| ACL das RPCs adaptadas | Aprovado no escopo testado | Execucao de `respond_demand_invitation` e `approve_demand_candidate` negada a anon e permitida a authenticated. |
| Visual autenticado/mobile real | Pendente | Sem contas de teste; nenhuma sessao existente utilizada nesta etapa. |
| PostgreSQL com conexoes independentes | Pendente | Ambiente nao disponibilizado; nenhuma tentativa remota. |
| Compatibilidade com a base principal | Nao certificada | Schema e dados remotos nao inspecionados. |

O caso SQL integrado concentra diversas assercoes dentro de um teste; o total de
81 nao representa 81 testes de concorrencia ou 81 cenarios visuais.

### Compatibilidade historica exercitada

Antes de aplicar a migration, a fixture popula jobs, candidaturas, contratacoes,
convite, mensagens, check-in, checkout e avaliacoes, incluindo operacao concluida
e uma demanda historica com dois jobs. Depois da aplicacao:

- IDs e conteudo das tabelas comparadas permanecem iguais.
- Assignments preservam os campos anteriores e recebem somente os campos novos.
- Mensagem com assignment preexistente recebe o vinculo correto, sem mudar conteudo.
- Profissional original continua acessando sua mensagem; operacao concluida
  continua retornando fase `completed`.
- A fixture multivaga nao e convertida nem apagada.

O schema do harness e reduzido e usa trechos das migrations historicas. A funcao
original de gestao e um stub nesse harness: os caminhos antigos de editar,
duplicar e cancelar nao sao certificados pela combinacao com a nova migration.
A suite `demands-sql` exercita a gestao original separadamente. A suite antiga de
confianca operacional tambem roda separadamente e ainda valida o comportamento
historico de clonagem; a prova do novo comportamento e `recruitment-sql`.

## Arquivos e superficies impactadas

Esta lista identifica o escopo do recrutamento, nao todos os arquivos alterados no
worktree, que contem trabalho anterior independente.

| Arquivos | Impacto |
|---|---|
| [Migration](../supabase/migrations/20261104180000_recruitment_availability.sql) | Regra SQL central, RLS, triggers, RPCs, substituicao, historico e isolamento de chat. |
| [demands](../lib/demands.ts) | Janela temporal e elegibilidade compartilhadas; consulta com campo computado. |
| [restaurant-home](../lib/restaurant-home.ts), [operations](../lib/operations.ts), [demand-detail](../lib/demand-detail.ts), [restaurant-team](../lib/restaurant-team.ts) | Visibilidade, multiplos assignments historicos, eventos e contexto do profissional atual. |
| [Home profissional](../app/worker/dashboard/page.tsx) | Filtro SQL e local, atualizacao temporal e bloqueio de candidatura. |
| [Convites](../app/worker/invitations/page.tsx), [Candidaturas](../app/worker/applications/page.tsx) | Expiracao/aceite e continuidade dos vinculos e do historico. |
| [Home restaurante](../app/restaurant/dashboard/page.tsx), [Criacao](../app/restaurant/dashboard/jobs/create/page.tsx) | Disponibilidade derivada e aviso/bloqueio de publicacao urgente. |
| [Talentos](../app/restaurant/candidates/talent-center.tsx), [Rede de talentos](../app/components/demand-talent-network.tsx) | Separacao entre novas descobertas e candidatos existentes; Interesse/Favoritos preservados. |
| [Detalhe](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Decisao apos ocorrencia, reserva e validacao temporal inclusive no modal aberto. |
| [Card](../app/components/demand-card.tsx), [Painel operacional](../app/components/operational-panel.tsx) | Contexto e fluxo operacional sem recrutamento indevido. |
| [Chat](../app/chat/[jobId]/chat-client.tsx) | Assignment atual e limpeza do contexto ao mudar o relacionamento. |
| [Teste SQL](../tests/recruitment-sql.test.mjs) | Preflight, dados anteriores, regras backend, substituicao e chat. |
| [Testes de dominio](../tests/demands.test.mjs), [Detalhe](../tests/demand-detail.test.mjs), [UI](../tests/operational-ui.test.mjs), [Equipe](../tests/restaurant-team.test.mjs) | Limites temporais e regressao dos consumidores. |
| [README](../README.md), este relatorio | Regras, impactos, evidencias e pendencias de liberacao. |

### Banco, consultas e RPCs

Nao sao criadas tabelas, telas ou novos status de banco.

- Novas colunas: decisoes de substituicao em `operational_assignments`,
  `demand_invitations.replacement_assignment_id` e `messages.assignment_id`.
- A unicidade global de job em assignments vira unicidade parcial do assignment
  atual. Check-in/checkout deixam de ser unicos por job, mantendo unicidade por
  profissional e job. Convites comuns e convites de substituicao tem indices
  unicos separados.
- Helpers SQL: `recruitment_closes_at`, `recruitment_blocked`,
  `recruitment_available` e `recruitment_hireable`. Novos helpers nao constituem
  um fluxo operacional paralelo.
- Consultas de descoberta usam `recruitment_available`; participantes e dono
  continuam tendo excecoes de acesso sob RLS. Consultas de assignments e mensagens
  passam a distinguir historico e relacionamento atual.
- Adaptadas: `invite_demand_worker`, `respond_demand_invitation`,
  `approve_application`, `approve_demand_candidate`, `manage_restaurant_demand`,
  `interrupt_operational_assignment`, `worker_demand_invites`,
  `demand_talent_directory_before_trust`, `participant_assignment`,
  `operational_context`, `issue_operational_code`, `validate_operational_code`,
  `record_operational_payment`, `mark_chat_messages_read`,
  `get_chat_message_preview` e `restaurant_operational_message_inbox`.
- A implementacao antiga de `manage_restaurant_demand` e preservada como funcao
  interna sem execucao publica. Seu wrapper adiciona as decisoes apos ocorrencia.
- Trigger de candidatura e policies de jobs/applications bloqueiam acesso direto
  indevido; validacoes nao dependem apenas do frontend.
- RPCs adaptadas recebem ACL explicita para autenticados, sem liberacao a anon.

## Riscos restantes e condicoes de liberacao

1. **Concorrencia real nao validada.** Locks e indices existem, mas e necessario
   testar aprovacoes, convites, aceite, interrupcao e rotinas operacionais em
   conexoes independentes. Ha caminhos com ordem diferente de locks de worker/job
   que precisam de verificacao de espera/deadlock; nao ha garantia multi-sessao.
2. **Schema remoto desconhecido.** O preflight verifica tabelas, funcoes,
   constraints-chave e triggers de candidatura/contratacao. Nao valida todo
   detalhe de colunas, policies, grants, volume ou divergencia da base real.
3. **Mensagens sem assignment anterior.** Permanecem armazenadas com vinculo nulo,
   mas ficam ocultas pela nova policy. Antes de liberar, quantificar e definir
   tratamento explicito desses registros; nao prometer historico visivel sem isso.
4. **Substituicoes legadas por clone.** `replacement_job_id` continua preservado
   e bloqueia recrutamento publico do clone. Nao ha conversao automatica dessas
   operacoes para o novo ciclo no mesmo job; precisam de inventario e validacao.
5. **Demandas historicas multivaga.** Nao sao consolidadas nem removidas. Preservacao
   local de registros nao prova todos os percursos operacionais desse legado.
6. **Publicacao e edicao legadas.** A elegibilidade deriva de `created_at`, nao de
   novo campo de publicacao. Dados importados ou horarios historicos inconsistentes
   precisam ser inventariados, inclusive operacoes atravessando meia-noite.
7. **Ordem de entrega obrigatoria.** O frontend depende de novos campos computados
   e retornos SQL. Nao publicar esse frontend antes da migration e da confirmacao
   de que a API expoe o schema atualizado.
8. **Locks de DDL e volume.** Alteracao de constraints, indices e backfill do chat
   podem esperar locks ou exceder os limites locais da migration (5s de espera,
   5min de statement). Tempo e impacto nao foram medidos em volume representativo.
9. **Interface e integracoes reais.** Mocks nao comprovam navegacao autenticada,
   responsividade, dispositivos/GPS, notificacoes nem rotinas externas reais.
10. **Rollback depois de substituicoes.** Restaurar a antiga unicidade por job pode
    falhar apos multiplos assignments/check-ins historicos. Nao executar rollback
    destrutivo ou apagar registros para restaurar constraints.

## Protocolo futuro, somente mediante autorizacao explicita

1. Disponibilizar homologacao isolada, conexoes independentes e contas sinteticas.
   Nao substituir esse ambiente pelo projeto principal ou por usuarios reais.
2. Inventariar migrations aplicadas e dependencias; comparar assinaturas, policies,
   grants, constraints e triggers. Quantificar mensagens sem assignment, clones e
   demandas multivaga. Preparar backup e estrategia de recuperacao.
3. Aplicar somente em homologacao autorizada, respeitando a ordem das dependencias.
   Nenhum comando de conexao ou aplicacao foi executado por este relatorio.
4. Executar cenarios em pelo menos duas conexoes PostgreSQL independentes:
   - aprovar dois candidatos no mesmo job: somente um contratado atual;
   - repetir convite e aceite: sem duplicacao ou contratacao automatica;
   - segurar lock de job e liberar depois do corte, inicio ou termino: decisao
     deve usar o horario real depois da espera, nao o inicio da transacao;
   - interromper versus confirmar check-in, pagamento ou checkout;
   - candidatura direta versus aceite de convite, observando ordem de locks;
   - registrar espera, timeout e deadlock, confirmar rollback e repetir apos
     qualquer correcao. Nao classificar mero Promise.all em PGlite como prova.
5. Validar visualmente, autenticado e em mobile/desktop: Home, Vagas Abertas,
   Candidaturas, Convites, Talentos, detalhe/modal, Chat e painel operacional.
   Manter telas abertas ao atravessar corte/inicio. Conferir urgente, encerramento,
   reserva aceita mas nao contratada, sucessor e historico do profissional anterior.
6. Repetir ciclo completo de check-in, pagamento, checkout, historico e avaliacoes,
   incluindo operacao sem contratado e encerramento sem reserva.
7. Emitir novo relatorio com evidencias de homologacao, compatibilidade efetiva,
   riscos e aprovacao expressa antes de qualquer proposta de aplicacao em producao.

### Reproducao local

Na raiz do repositorio, sem conexao remota:

```powershell
node --test tests\recruitment-sql.test.mjs tests\demands.test.mjs tests\demand-detail.test.mjs tests\operational-ui.test.mjs tests\restaurant-home.test.mjs tests\message-navigation.test.mjs tests\talent-board.test.mjs tests\operational-trust-sql.test.mjs tests\demands-sql.test.mjs tests\restaurant-team.test.mjs tests\restaurant-history.test.mjs tests\restaurant-message-inbox-sql.test.mjs tests\restaurant-message-inbox.test.mjs tests\restaurant-message-ui.test.mjs tests\talent-directory-sql.test.mjs tests\talent-interest-sql.test.mjs
npm run typecheck
git --no-pager diff --check
```

**Compatibilidade confirmada:** schema/fixtures locais e percursos exercitados.
**Compatibilidade NAO confirmada:** base principal, carga real, concorrencia
multi-sessao e experiencia visual autenticada.
