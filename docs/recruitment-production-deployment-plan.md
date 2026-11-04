# Plano de Implantacao em Producao: recrutamento

Data: 2026-11-04.
Status: **proposta para revisao; execucao nao autorizada**.

## 1. Objetivo e limites

Implantar a disponibilidade de recrutamento aprovada localmente, preservando
participantes, historico, chat, check-in, pagamento, checkout e OperationFlow.

Este documento e somente um plano. Sua aprovacao nao equivale a autorizacao para
conectar na base principal, aplicar migrations ou realizar deploy. A execucao
dependera de decisao posterior explicita sobre ambiente, pacote, janela e operadores.
Nenhum desses procedimentos foi executado para gerar este documento.

Referencias:

- [Revisao de compatibilidade do schema](./recruitment-schema-compatibility.md):
  a migration revisada aceita emissao com dois argumentos sem exigir GPS;
  esta revisao prevalece sobre a suposicao anterior de GPS obrigatorio.
- [Relatorio final de impacto](./recruitment-final-impact-report.md): inventario
  completo de migrations, arquivos, RPCs, policies, triggers e incompatibilidades.
- [Validacao local](./recruitment-local-validation.md): 81 testes aprovados,
  verificacoes estaticas e limites das evidencias.
- [Migration principal](../supabase/migrations/20261104180000_recruitment_availability.sql).

Nao incluir automaticamente todas as alteracoes do worktree. Ha 13 migrations
locais novas de tarefas diferentes; apenas uma e especifica de recrutamento.
A lista efetiva de migrations pendentes no destino ainda e desconhecida.

## 2. Responsabilidades e registros

Antes de agendar, designar nominalmente:

| Papel | Responsabilidade |
|---|---|
| Responsavel pelo produto | Aprovar escopo, restricoes de historico/chat, janela e resultado funcional. |
| Operador de banco | Inventario, backup, aplicacao autorizada, verificacoes SQL e recuperacao. |
| Responsavel pela aplicacao | Pacote revisado, versao anterior, entrega coordenada e verificacao da API/UI. |
| Responsavel pela validacao | Executar matriz funcional e registrar evidencias com contas aprovadas. |
| Responsavel pela decisao de continuidade | Declarar GO/NO-GO, interrupcao, recuperacao e encerramento. |

Registrar release/commit, hashes dos arquivos SQL, ambiente identificado, migrations
selecionadas, horarios, operadores, evidencias e decisoes. Nao registrar credenciais,
tokens ou dados pessoais nos relatorios.

## 3. Gates obrigatorios antes da janela

Nenhum item abaixo deve ser presumido como concluido pela aprovacao local.

### Gate A: pacote e compatibilidade

- [ ] Delimitar diff de entrega e versao imutavel; excluir trabalho alheio ao pacote.
- [ ] Sob autorizacao futura de acesso, comparar historico e schema do destino
      com as dependencias locais; decidir exatamente quais migrations faltam.
- [ ] Revisar colunas, assinaturas, retornos, grants, policies, triggers e
      constraints; nao remover preflight para contornar divergencias.
- [ ] Inventariar mensagens sem assignment, assignments interrompidos, clones
      legados, demandas multivaga e datas/publicacoes inconsistentes.
- [ ] Confirmar quais conversas historicas deixarao de ser visiveis: a nova policy
      permite somente relacionamento nao interrompido. Dados nao sao apagados.
- [ ] Identificar clientes/integracoes que presumem um assignment por job ou
      enviam `p_quantity`; coordenar sua compatibilidade.
- [ ] Rever dependencias SQL da RPC `worker_demand_invites()`, recriada com
      retorno ampliado; dependencias desconhecidas podem bloquear seu DROP.

### Gate B: ensaio e validacao

- [ ] Disponibilizar ambiente isolado autorizado, sem usar producao como homologacao.
- [ ] Ensaiar pacote efetivo sobre schema e dados representativos, com dados
      sinteticos ou anonimizados por procedimento aprovado.
- [ ] Executar concorrencia PostgreSQL com conexoes independentes, incluindo
      espera por locks cruzando corte/inicio/termino e ordens de locks worker/job.
- [ ] Validar UI autenticada desktop/mobile e ciclo operacional completo.
- [ ] Medir duracao, locks e backfill em volume representativo.
- [ ] Reexecutar suites locais do relatorio e verificacoes estaticas no pacote final.
- [ ] Ensaiar recuperacao; anexar resultado e limites.

PGlite e mocks nao substituem esses itens. Se continuarem indisponiveis,
o resultado deste gate e **NO-GO**, nao uma homologacao implicita.

### Gate C: recuperacao e operacao

- [ ] Backup recuperavel verificado e restauracao ensaiada.
- [ ] Definicoes anteriores de funcoes/ACL/policies/triggers/indices/constraints
      capturadas em local protegido, junto da versao anterior da aplicacao.
- [ ] RPO e RTO definidos e aprovados; nenhuma promessa de recuperacao sem perda.
- [ ] Plano corretivo de banco revisado para o schema efetivo do destino.
- [ ] Procedimento testado para suspender escritas de clientes e integracoes.
- [ ] Avaliar cron e processos em andamento: so pausar tarefas identificadas
      quando necessario, registrar estado e garantir restauracao.
- [ ] Definir metricas basais e limites de erro/latencia/locks para interrupcao.
- [ ] Definir duracao da janela, observacao assistida e responsavel de plantao.

### Gate D: autorizacao de execucao

- [ ] Responsavel aprova explicitamente ambiente principal, pacote exato,
      janela, operadores, riscos restantes e plano de recuperacao.
- [ ] Nenhuma pendencia critica dos gates anteriores permanece aberta.

## 4. Ordem de entrega do banco e da aplicacao

1. Partir do historico realmente instalado, nao do estado Git de arquivos novos.
2. Resolver dependencias do schema-base e migrations historicas antes do pacote.
3. Aplicar somente migrations aprovadas e realmente pendentes, em ordem crescente
   de versao. O inventario completo esta no relatorio de impacto.
4. No lote local acumulado, manter esta sequencia relativa:
   verificacao de perfil e geocodificacao opcional; reconciliacoes de GPS,
   verificacao, ganhos, inbox, locais geocodificados e criacao com endereco;
   diagnostico de Interesse se sua inclusao for aprovada; agenda operacional;
   uma vaga; restauracao efetiva de Interesse; recrutamento por ultimo.
5. O arquivo
   [20261104060000_reconcile_talent_interest.sql](../supabase/migrations/20261104060000_reconcile_talent_interest.sql)
   e somente SELECT. Decidir sua inclusao no pacote/historico expressamente;
   nao o confundir com restauracao funcional.
6. Nao reaplicar reconciliacoes antigas de GPS/inbox depois da migration de
   recrutamento, nem criacao antiga depois da migration de uma vaga.
7. Conferir banco e exposicao do schema pela API antes de liberar o frontend novo.
8. Entregar a versao compativel de frontend na mesma janela coordenada:
   computed fields, retorno de convites, chat e criacao sem quantidade exigem
   compatibilidade. Nao assumir que banco novo e frontend antigo sao intercambiaveis.

Nao usar `db push` indiscriminado no worktree atual. A ferramenta e o modo de
aplicacao serao escolhidos no runbook autorizado, com selecao revisada e
rastreabilidade no historico. Este plano nao inclui comandos de conexao ou deploy.

## 5. Procedimento da janela, somente apos autorizacao

| Etapa | Procedimento | Condicao para avancar |
|---|---|---|
| 1. Abertura | Confirmar destino, operadores, pacote/hash, autorizacao e comunicacao da janela. | Todos correspondem ao aprovado. |
| 2. Protecao | Suspender escritas afetadas no backend/clientes/integracoes pelo procedimento ensaiado; considerar operacoes em andamento. | Bloqueio efetivo, nao apenas botoes ocultos. |
| 3. Baseline | Registrar saude, contagens, estados operacionais, schema e ponto recuperavel atualizado. | Backup e evidencias disponiveis. |
| 4. Preflight | Conferir dependencias e ausencia de divergencias/locks incompativeis. | Nenhum desvio nao aprovado. |
| 5. Banco | Operador aplica apenas a lista autorizada, uma migration por vez, registrando resultado. | Commit e historico conferidos em cada etapa. |
| 6. API | Conferir assinaturas, retorno de convites, campos computados e cache de schema pelo procedimento suportado. | Nenhum erro de campo/funcao ausente. |
| 7. Aplicacao | Responsavel entrega versao aprovada e verifica carregamento/saude. | Versao correta e API compativel. |
| 8. Smoke protegido | Validar backend e jornadas com contas/dados previamente aprovados, sem afetar usuarios reais. | Cenarios criticos aprovados. |
| 9. Reabertura | Restaurar escritas e tarefas pausadas de forma coordenada; observar primeiras operacoes. | Sem violacao de invariantes ou erro critico. |
| 10. Encerramento | Executar checklist, comparar indicadores e registrar aceite. | Responsavel declara GO e define acompanhamento. |

Cada migration tem sua propria atomicidade. A migration principal usa transacao,
espera maxima de lock de 5s e timeout por statement de 5min. Nao aumentar limites
automaticamente diante de falha; avaliar bloqueios/volume e obter nova decisao.
Nao tratar todo o lote como uma unica transacao reversivel.

## 6. Validacoes pos-aplicacao

Usar somente contas e dados aprovados. Cenarios temporais devem ser preparados
previamente; nao alterar relogio do servidor, desabilitar triggers ou modificar
horarios de operacoes reais para simular limites.

### Integridade e seguranca de acesso

- [ ] Historico de migrations corresponde ao pacote, sem transacao aberta.
- [ ] Indices/constraints/FKs e triggers esperados estao presentes e habilitados.
- [ ] Somente um assignment nao interrompido por job.
- [ ] Dados anteriores preservados; mensagens vinculadas quando havia assignment.
- [ ] RPCs negadas a anon, participantes autorizados atendidos, auxiliares internas
      sem execucao direta pelos clientes.
- [ ] API sem erro de schema cache; cron e notificacoes saudaveis.

### Matriz funcional obrigatoria

| Cenario | Resultado esperado |
|---|---|
| Publicacao normal antes do corte | Descoberta, candidatura e convite permitidos. |
| Exatamente no corte e depois dele | Sem novas candidaturas/convites/descoberta; candidatos existentes permanecem. |
| Contratacao depois do corte e antes do inicio | Permitida para candidato ja vinculado, sem reabrir recrutamento. |
| Convite comum valido anterior ao corte | Aceite antes do inicio, sem contratacao automatica. |
| Urgente publicada no/depois do corte, antes do inicio | Aviso e recrutamento ate antes do inicio. |
| Inicio atingido, urgente ou normal | Sem recrutamento ou contratacao comum; execucao/historico preservados. |
| Sem contratado no inicio | Visivel ao restaurante, fora de descoberta. |
| Ausencia/abandono/cancelamento | Sem reabertura; decisao explicita de encerrar ou buscar substituto. |
| Substituto | Somente candidato anterior a ocorrencia, convite aceito e confirmacao do restaurante antes do termino. |
| Nenhum reserva aceita | Registro e historico mantidos, sem volta a vagas abertas. |
| Chat apos substituicao | Relacao atual funcional, mensagens antigas nao expostas ao sucessor. |
| Ciclo operacional | Check-in, pagamento, recebimento, checkout, historico e confianca preservados. |
| Telas abertas | Corte/inicio revalidam listas, acoes e modal sem depender de recarregamento manual. |
| Regressao visual | Home, Candidaturas, Convites, Talentos, detalhe, Equipe e chat coerentes em mobile/desktop. |

### Concorrencia e desempenho

- [ ] Duas aprovacoes simultaneas: apenas uma contratacao atual.
- [ ] Convites/aceites repetidos sem duplicacao ou contratacao automatica.
- [ ] Lock liberado depois do limite temporal: backend decide pelo horario real.
- [ ] Interrupcao concorrente com check-in/pagamento/checkout consistente.
- [ ] Candidatura direta versus aceite de convite sem deadlock nao tratado.
- [ ] Logs e indicadores dentro dos limites definidos antes da janela.

Os testes de corrida devem ser ensaiados no ambiente isolado. Repeticao em
producao somente se explicitamente aprovada para dados de teste segregados;
nao gerar carga competitiva em operacoes reais.

## 7. Criterios de interrupcao

Declarar NO-GO e suspender avancos/reabertura se ocorrer:

- Divergencia de schema, dependencias, hashes ou historico nao prevista.
- Falha de migration, bloqueio persistente ou timeout.
- Nova candidatura/convite fora da regra ou multiplas contratacoes atuais.
- Exposicao de mensagens a participante indevido.
- Falha critica em check-in, pagamento, checkout ou acesso do contratado.
- Perda/inconsistencia de dados, backup indisponivel ou recuperacao nao viavel.
- Erros/latencia acima dos limites previamente aprovados.

Preservar evidencias sem segredos, identificar a ultima migration efetivamente
commitada e seguir a matriz de recuperacao. Nao insistir com reaplicacoes cegas.

## 8. Rollback e recuperacao

Nao existe down migration pronta. Antes da janela, o operador deve preparar e
ensaiar o procedimento corretivo para o schema efetivamente inventariado.
Preferir forward-fix que mantenha o corte e a integridade historica.

| Momento da falha | Procedimento |
|---|---|
| Antes de qualquer aplicacao | Cancelar janela; manter banco e app atuais. Restaurar apenas controles/tarefas alterados para a manutencao. |
| Durante migration nao commitada | Confirmar rollback da transacao e ausencia de transacao aberta. Nao marcar como aplicada. Conferir migrations anteriores ja commitadas separadamente. |
| Banco commitado, app novo ainda nao liberado | Manter escritas afetadas suspensas; avaliar correcao forward ou reversao ensaiada. Nao reabrir app antigo assumindo compatibilidade. |
| App liberado, sem novos dados incompativeis | Com escritas suspensas e inventario confirmado, executar somente correcao/reversao previamente revisada; restaurar versao de app compativel de forma coordenada. |
| Ja houve substituicoes/novos historicos | Manter modelo capaz de armazenar multiplos registros por job; corrigir para frente. Nao restaurar unicidades antigas cegamente. |
| Corrupcao ou falha sem reparo seguro | Acionar recuperacao aprovada: restaurar backup em destino isolado, verificar integridade e conciliar escritas posteriores antes do corte de retorno. Decisao explicita sobre RPO/RTO. |

### Regras que nao podem ser violadas na recuperacao

- Nao apagar assignments, mensagens, convites, presencas ou pagamentos para
  fazer uma constraint antiga voltar a caber.
- Nao remover isolamento do chat de forma avulsa: pode expor historico ao sucessor.
- Nao usar DROP CASCADE para contornar dependencias.
- Nao apagar/reescrever migrations aplicadas nem marcar sucesso sem aplicacao real.
- Nao restaurar trigger de geocodificacao obrigatoria como efeito colateral.
- Nao reverter verificacao/privacidade/Interesse por estarem no mesmo lote local.
- Nao prometer rollback somente de frontend: banco novo pode nao ser compativel.
- Nao restaurar backup sobre a base ativa sem plano de conciliacao e autorizacao
  para perda de escritas e indisponibilidade.

### Verificacao apos recuperacao

Conferir schema/historico, integridade, controles de recrutamento, isolamento de
chat, operacoes em andamento, check-in/pagamento/checkout, cron e notificacoes.
Reabrir escritas somente apos aceite do responsavel e registrar dados recuperados,
eventual perda de janela e riscos remanescentes.

## 9. Encerramento e decisao

O registro final da janela devera conter:

1. Pacote aplicado e diferencas em relacao ao plano aprovado.
2. Resultados de cada gate, validacao e checklist.
3. Contagens e saude antes/depois, incidentes e medidas adotadas.
4. Estado das escritas, cron, app e banco ao encerrar.
5. Responsavel pelo aceite e periodo de observacao assistida.

**Decisao atual:** plano gerado para revisao, sem execucao.
Somente depois da revisao e de autorizacao explicita sera definida a data de
aplicacao na base principal.
