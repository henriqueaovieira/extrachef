# Recrutamento: revisao de compatibilidade do schema

Data: 2026-11-04.
Status: artefato SQL revisado e validacao local; nenhuma aplicacao remota executada.

## Artefato para aplicacao

A versao revisada completa esta em
[20261104180000_recruitment_availability.sql](../supabase/migrations/20261104180000_recruitment_availability.sql).
Ela substitui a versao que falhou no preflight; nao e um patch para executar
depois da versao anterior.

Foi preservado o identificador da migration: a falha informada ocorreu no
preflight, antes do DDL, dentro de BEGIN/COMMIT. Criar uma segunda migration
incremental nao resolveria a primeira pendente e poderia tentar duplicar
colunas, indices e renomeacoes. Nao aplicar ambas as revisoes.

Antes de qualquer tentativa futura, o operador autorizado deve confirmar que
a transacao anterior foi revertida, que essa versao nao esta registrada como
aplicada e que nao ha objetos parcialmente instalados por execucao fragmentada.
Se o historico indicar sucesso ou o DDL ja existir, interromper: este arquivo
nao e idempotente e sera necessario um plano especifico para esse estado.

## Diferenca identificada

| Item | Esperado pela revisao anterior | Existente conforme informado pelo responsavel |
|---|---|---|
| RPC | `issue_operational_code(uuid,text,double precision,double precision)` | `issue_operational_code(uuid,text)` |
| Parametros | `p_job_id`, `p_stage`, `p_latitude`, `p_longitude` | `p_job_id`, `p_stage` |
| Dependencia | Migration GPS instalada previamente | GPS ainda nao implantado |
| Preflight | Exigia exclusivamente a assinatura com GPS | Abortou antes das alteracoes |

Esta e a **unica divergencia confirmada nesta solicitacao**, a partir do erro e
da assinatura informados. Nao houve consulta a producao. Nao e possivel afirmar
que inexistam outras diferencas de colunas, funcoes, policies, grants ou triggers.
A ausencia de colunas de coordenadas foi testada localmente, nao constatada no
schema remoto.

O problema nao estava no corte de recrutamento, mas no acoplamento indevido da
migration a uma evolucao de check-in ainda nao instalada.

## Correcao aplicada

1. Preflight aceita exatamente uma das assinaturas conhecidas.
2. Se ambas estiverem ausentes, falha explicitamente.
3. Se ambas coexistirem, falha explicitamente por ambiguidade; nao escolhe uma
   sobrecarga silenciosamente nem remove funcoes do ambiente.
4. Em ambiente sem GPS, substitui apenas `issue_operational_code(uuid,text)`,
   mantendo check-in por codigo sem exigir coordenadas.
5. Em ambiente com GPS, substitui apenas a assinatura de quatro argumentos,
   mantendo validacao de coordenadas e raio de 100 metros.
6. O corpo comum preserva autorizacao, fase, bloqueio de interrupcao, token,
   expiracao, notificacoes e o assignment correto, inclusive apos substituicao.
7. REVOKE/GRANT acompanha somente a assinatura instalada, sem referenciar uma
   funcao inexistente no fim da migration.
8. Nenhum outro requisito do preflight foi flexibilizado.

O SQL de emissao e montado dentro da propria migration a partir da assinatura
detectada, com um corpo operacional compartilhado. Nao se cria fallback de
execucao entre RPCs nem se repete logica de recrutamento.

Continuam inalterados corte normal, urgencia, descoberta, bloqueios de
candidatura/convite, aprovacao ate o inicio, decisao apos ocorrencia, reserva
restrita a candidato anterior, confirmacao do restaurante, historico e isolamento
do chat. Nao ha novas tabelas ou status.

## Validacao local

Rodada de regressao apos esta revisao: **82 testes aprovados, zero falhas ou
testes ignorados**. `git diff --check` tambem passou. Nao houve alteracao de
TypeScript/TSX; esta revisao altera somente SQL, teste JavaScript e documentacao.

O teste integrado
[recruitment-sql.test.mjs](../tests/recruitment-sql.test.mjs)
agora executa o mesmo ciclo nos dois schemas:

- Assinatura de dois argumentos, sem instalar a migration GPS e sem as colunas
  `work_latitude`/`work_longitude`.
- Assinatura de quatro argumentos, com GPS previamente instalado.

Nos dois casos foram exercitados preflight, preservacao de dados anteriores,
recrutamento normal/urgente, limites, aprovacao, ocorrencias, substituicao,
chat, check-in, pagamento, checkout e reputacao.

Tambem foram verificados:

- Ausencia de ambas as assinaturas e coexistencia ambigua geram erro no preflight.
- A assinatura original permanece e a alternativa nao e criada.
- ACL da assinatura efetiva nega anon e permite authenticated.
- GPS existente continua rejeitando check-in sem coordenadas ou fora do raio.
- Schema sem GPS completa o ciclo usando somente dois argumentos.

Esses testes usam PGlite local. Nao certificam concorrencia multi-sessao,
interface autenticada nem compatibilidade integral com o banco produtivo.

## Ajustes ao planejamento anterior

Esta secao prevalece sobre a suposicao de GPS obrigatorio nos relatorios anteriores:

- Nao aplicar as migrations de GPS apenas para satisfazer o recrutamento.
- A reconciliacao GPS permanece funcionalidade independente, fora deste ajuste.
- Para esta migration, a dependenca operacional pode ser a assinatura original de
  dois argumentos. As demais dependencias continuam obrigatorias.
- Nao executar um lote indiscriminado de migrations anteriores: uma reconciliacao
  de GPS poderia alterar a assinatura que o objetivo atual e preservar.
- Nao executar posteriormente uma reconciliacao antiga que sobrescreva a emissao
  compativel com multiplos assignments sem revisar sua implementacao.

### Compatibilidade do frontend

O consumidor local
[operational-panel.tsx](../app/components/operational-panel.tsx)
envia latitude/longitude no check-in e, portanto, pressupoe a RPC com GPS.
Ele nao foi alterado nem publicado nesta revisao de migration.

Aplicar esta revisao no schema de dois argumentos **nao torna esse consumidor
local compativel automaticamente**. Manter o cliente produtivo compativel com
dois argumentos; antes de qualquer deploy do frontend local, planejar
explicitamente essa compatibilidade. Nao mascarar erro de assinatura com
retentativa sem GPS, pois isso poderia contornar validacao em ambiente GPS.

## Aplicacao e recuperacao futuras

Nao foram realizados deploy, db push, acesso remoto ou alteracao manual de
producao. O artefato esta preparado para a divergencia informada, condicionado
as demais verificacoes do preflight e do schema de destino.

Procedimento futuro, somente mediante autorizacao:

1. Conferir rollback da tentativa falha e historico da migration.
2. Revisar schema/dependencias e capturar backup/definicoes/ACL anteriores.
3. Aplicar a versao revisada completa como substituta da tentativa falha.
4. Conferir que permanece somente a assinatura de dois argumentos no ambiente
   informado e que a API reconhece o schema apos a notificacao de reload.
5. Validar candidaturas, convites, limites, substituicao e ciclo operacional com
   cliente compativel e dados aprovados.

Em falha transacional, confirmar rollback antes de nova tentativa. Depois do
commit, seguir a estrategia do
[plano de implantacao](./recruitment-production-deployment-plan.md):
preferir correcao forward e nao restaurar unicidades antigas apos historico
multiplicado. Ao restaurar definicoes de emissao, preservar a assinatura original
capturada, sem instalar GPS como efeito colateral.
