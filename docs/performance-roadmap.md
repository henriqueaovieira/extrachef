# Roadmap técnico de performance

> **Fase encerrada e congelada.** Não iniciar novas medições, análises,
> refatorações ou otimizações de performance até os critérios de retomada do
> [backlog técnico](./performance-backlog.md) serem atendidos. Os planos de
> ciclos abaixo são registros históricos e não autorizam trabalho nesta fase.

## Decisão executiva

Não há, neste momento, uma otimização de produto que possa ser indicada como
**IMPLEMENTAR AGORA** sem extrapolar a evidência. A captura inicial foi uma
amostra única por rota; a campanha posterior repetiu `/worker/profile` e
`/restaurant/candidates`, enquanto `/restaurant/messages` e
`/restaurant/dashboard` continuam com apenas uma execução. Ainda faltam bytes
de resposta Supabase, render counts React e dados representativos de volume.
As repetições confirmam uma cauda recorrente no perfil profissional, mas não
atribuem a causa raiz individual nem o ganho de uma mudança específica.

Uma campanha repetida foi concluída em `/worker/profile` e
`/restaurant/candidates`; os resultados e limites de representatividade estão
em [performance-expanded-validation.md](./performance-expanded-validation.md).
Nenhuma otimização foi implementada ou aprovada por este roadmap. Toda
investigação futura está suspensa conforme o [backlog técnico](./performance-backlog.md).

## Evidência de base

Captura do build de produção local, em sessão autenticada de teste:

| Tela | Requests Supabase | Última resposta observada | Duração acumulada (paralela) | DOM | Classificação da amostra |
|---|---:|---:|---:|---:|---|
| `/worker/profile` | 15 | 3.747 ms | 6.770 ms | 242 nós | ALTO |
| `/restaurant/candidates` | 12 | 3.104 ms | 4.909 ms | 109 nós | ALTO |
| `/restaurant/messages` | 12 | 2.892 ms | 6.010 ms | 104 nós | MÉDIO |
| `/restaurant/dashboard` | 17 | 2.157 ms | 4.387 ms | 126 nós | MÉDIO |

O método, limites de classificação e limitações completos estão em
[performance-profiling.md](./performance-profiling.md). A tabela acima é a
captura inicial de uma execução; o fim da rede Supabase é o proxy
`responseEnd` mais tardio, não um SLO de interatividade.

### Atualização: campanha ampliada

Dez reloads independentes confirmaram cauda Supabase p50/p90/máximo de
**3.555/4.093/5.388 ms** em `/worker/profile` e
**1.883/3.207/4.650 ms** em `/restaurant/candidates`. A prontidão observada de
Candidatos foi **2.719/4.732/5.380 ms**. A conta de restaurante tinha zero
operações e o RPC de talentos retornou uma linha, portanto a campanha não
validou o efeito de volume. As latências individuais de Candidatos ficaram
abaixo de 704 ms; a causa do pico de prontidão não foi isolada.

Os awaits sequenciais de carga estão confirmados no código das duas telas, mas
o ganho de alterá-los não foi medido. O custo de render por componente e os
bytes de respostas Supabase continuam não confirmados. Detalhes, incluindo a
captura por endpoint e os limites das três primeiras amostras do perfil, estão
no [relatório comparativo](./performance-expanded-validation.md).

## Plano priorizado

| Ordem | Gargalo comprovado na amostra | Causa técnica comprovada / limite causal | Ação planejada | Ganho esperado | Risco da alteração futura | Esforço | Classificação |
|---:|---|---|---|---|---|---|---|
| 1 | `/worker/profile`: cauda repetida p50/p90/máximo de 3.555/4.093/5.388 ms em 10 reloads. | A captura detalhada confirmou durações individuais abaixo de 1.576 ms; `ProfileOverview` executa a cadeia Auth → diretório → perfil → Storage em sequência. Nenhuma etapa foi confirmada como responsável isolada pela cauda. | Instrumentar cada etapa, obter bytes via medição compatível com CORS e fazer profiling React em build apropriado; separar cache frio/quente antes de escolher um alvo. | Confirmar a contribuição de cada etapa; sem atribuição não há ganho numérico responsável. | Baixo para coleta; médio/alto para alteração futura no carregamento do perfil. | Médio | **VALIDAR COM MAIS DADOS** |
| 2 | `/restaurant/candidates`: cauda p50/p90/máximo de 1.883/3.207/4.650 ms e prontidão p50/p90/máximo de 2.719/4.732/5.380 ms. | Dez reloads confirmaram 12 requests e durações individuais abaixo de 704 ms. A conta tinha zero operações e o RPC retornou uma linha; volume e causa do pico de prontidão não foram testados. | Repetir com operação e volume representativos; registrar tempos, bytes e custo até conteúdo principal. | Localizar a contribuição da rede, cadeia de carga ou UI; sem volume e atribuição não há ganho mensurável. | Baixo para coleta; médio/alto para mudança futura no diretório. | Médio | **VALIDAR COM MAIS DADOS** |
| 3 | `/restaurant/messages`: 12 requests e cauda de 2.892 ms; maior duração acumulada paralela da amostra (6.010 ms). | A captura incluiu `restaurant_operational_message_inbox`, Auth e REST. A soma de duração sobreposta não é tempo de parede e não demonstra consulta lenta específica. | Repetir com quantidades diferentes de conversas; obter latência/payload por endpoint e medir impacto de eventos Realtime após a carga inicial separadamente. | Determinar se inbox, Auth, REST ou atualizações Realtime explicam custo observável; não há ganho numérico sustentável hoje. | Baixo para coleta; médio para mudanças futuras, dado o risco de atraso ou inconsistência de mensagens/estado. | Médio | **MONITORAR** |
| 4 | `/restaurant/dashboard`: maior contagem (17 requests), mas menor cauda observada entre as quatro (2.157 ms). | A captura incluiu duas RPCs identificadas e requests REST/Auth. A conta tinha zero operações e zero mensagens não lidas; portanto não representa estados carregados. Contagem, por si, não prova gargalo. | Manter como baseline e repetir com operações, pendências e conversas reais de teste. Observar p50/p75/p95 e requests acionados por atualizações periódicas, sem remover/refatorar cargas antes de evidência. | Detectar regressão ou custo sob volume; ganho de otimização ainda não demonstrado. | Baixo para monitoramento; médio/alto para mudanças futuras na atualização e consistência do Dashboard. | Baixo | **MONITORAR** |

### IMPLEMENTAR AGORA

**Nenhuma otimização de produto aprovada.** Também não há evidência suficiente
para escolher um endpoint, payload ou componente como causa raiz. A instrumentação
adicional aparece como próxima atividade de validação, não como alteração já
implementada.

## Roadmap por ciclos

### Ciclo 1 — Confirmar e decompor as duas maiores caudas

**Escopo:** `/worker/profile` e `/restaurant/candidates`.

- Dez reloads já foram medidos por rota, mas na conta de restaurante o RPC
  retornou uma linha e não havia operações ativas. Repetir com dados de teste
  autorizados e volume representativo antes de inferir comportamento sob carga.
- O perfil profissional precisa de captura por etapa; a primeira campanha
  repetida não preservou nomes de RPC em todas as execuções.
- Obter tamanhos de resposta Supabase por instrumento de rede que não dependa de
  Resource Timing cross-origin.
- Registrar tempo até conteúdo principal; não tratar `load` do documento como
  tempo até dados prontos.
- Medir commits/renders em React Profiler numa execução de diagnóstico, sem
  instrumentação persistente no produto.

**Gate:** só promover uma otimização se um request, asset ou fase de render
recorrer como contribuição material em várias execuções e o caminho afetado
estiver identificado.

### Ciclo 2 — Confirmar comportamento operacional e volume

**Escopo:** `/restaurant/messages` e `/restaurant/dashboard`.

- Repetir com conjunto de teste contendo conversas, não lidas, operações e
  estados operacionais.
- Separar carga inicial de requests/atualizações disparados por Realtime,
  intervalos ou mudanças de estado.
- Reportar p50/p75/p95, erros/timeouts, payloads e volume de dados. Não usar a
  soma de durations concorrentes como latência de tela.

**Gate:** volume de requests só motiva otimização quando combinado com latência,
payload ou custo de render repetidamente relevante.

### Ciclo 3 — Selecionar correções e medir regressões

- Comparar causas confirmadas, benefício mensurável, risco operacional e esforço.
- Propor uma mudança por gargalo, com baseline e teste de regressão da tela e
  dos fluxos relacionados.
- Validar que estado de mensagens/operação e contratos de dados continuam
  corretos.
- Repetir as mesmas capturas antes/depois; não aceitar melhoria baseada apenas
  em redução de requests se latência/transferência não melhorar.

## Critérios de promoção entre classificações

- **VALIDAR COM MAIS DADOS → IMPLEMENTAR AGORA:** causa recorrente e atribuída,
  amostra representativa, benefício esperado mensurável, plano de rollback e
  risco aceitável.
- **MONITORAR → VALIDAR COM MAIS DADOS:** regressão repetida acima dos limites
  usados no profiling, crescimento comprovado de volume/bytes, ou falhas
  observadas em mais de uma execução.
- **MONITORAR → encerrar:** séries repetidas ficam abaixo dos limites e não há
  impacto material em métricas de experiência.

Os limites de 1,5 s / 3 s / 5 s usados para classificar a cauda no relatório de
profiling são critérios provisórios desta análise, não SLO aprovado do ExtraChef.
Definir SLOs requer decisão de produto/engenharia e dados de produção.

## Escopo e mudanças

Este documento é diagnóstico e planejamento. Não implementa otimizações nem
altera funcionalidades. Os bytes Supabase e renders React continuam sem medida
na coleta original; as causas prováveis permanecem explicitamente não
confirmadas até as próximas campanhas de profiling.
