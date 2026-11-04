# Backlog técnico de performance — fase congelada

## Status

**Fase de auditoria encerrada. Novas análises e medições de performance estão
congeladas.**

Todos os itens abaixo são **MONITORAR — NÃO IMPLEMENTAR**. Não iniciar
refatorações, otimizações, novas instrumentações persistentes ou campanhas de
medição até que todos os critérios de retomada sejam atendidos:

- ambiente autorizado com volume representativo;
- operação ativa no conjunto de teste;
- quantidade realista de candidatos;
- dados próximos da produção, anonimizados ou sintéticos equivalentes;
- dependências externas necessárias disponíveis no ambiente, incluindo
  geocodificação para criar operações pela interface.

Esta condição suspende somente novas análises de performance. Não impede
funcionalidades nem melhorias de produto independentes deste backlog.

## Fatos encerrados

- `/worker/profile` apresentou latência recorrente superior às demais rotas
  analisadas na campanha ampliada.
- `/restaurant/candidates` teve picos ocasionais semelhantes; nenhum endpoint
  individual foi confirmado como causa principal.
- Nenhum endpoint isolado demonstrou ser o principal responsável pelos tempos
  observados.
- O impacto do volume permanece não validado por falta de amostra representativa.
- Não há evidência suficiente para justificar refatorações ou otimizações
  estruturais agora.

Os resultados e limites da evidência estão no
[relatório de validação ampliada](./performance-expanded-validation.md) e no
[roadmap de performance](./performance-roadmap.md).

## Itens monitorados

| ID | Investigação futura | Situação atual | Retomada / critério de conclusão | Classificação |
|---|---|---|---|---|
| PERF-01 | Investigar `/worker/profile` | A latência recorrente está confirmada; a contribuição individual de endpoints, assets e render não está atribuída. | Com volume e ambiente elegíveis, capturar tempo até conteúdo, etapas/endpoints individuais, erros, bytes e custo de render em execuções repetidas. Encerrar a investigação quando houver atribuição reproduzível ou quando a recorrência não se confirmar sob amostra representativa. | **MONITORAR — NÃO IMPLEMENTAR** |
| PERF-02 | Investigar `/restaurant/candidates` | Picos de prontidão foram observados, sem causa individual confirmada; a amostra disponível tinha 0 operações e 1 registro no diretório. | Com operação ativa e número realista de candidatos, repetir medições e correlacionar prontidão, latência/bytes por endpoint, fotos e custo de render com o volume. Não propor mudança estrutural sem causa recorrente e atribuída. | **MONITORAR — NÃO IMPLEMENTAR** |
| PERF-03 | Acompanhar a dependência externa de geocodificação | `/api/geocode` respondeu HTTP 503 por configuração ausente no staging e bloqueou a criação da operação sintética; nenhuma gravação ocorreu. | Monitorar a disponibilidade/configuração no staging. Antes de qualquer campanha que precise criar operação, confirmar que a geocodificação funciona e que os dados podem ser removidos/cancelados conforme o fluxo autorizado. Configuração externa fica fora deste backlog e não é alterada por ele. | **MONITORAR — NÃO IMPLEMENTAR** |
| PERF-04 | Definir requisitos de observabilidade contínua | Não há evidência suficiente para escolher ou instalar instrumentação persistente nesta fase. | Quando a fase for reaberta, definir previamente: ambiente/build e estado de cache; tamanho e perfil da amostra; operação, candidatos e volume associado; tempo de navegação e de conteúdo pronto; latências p50/p90/p95 e máximos; erros/timeouts; latência, status e bytes por endpoint; sinais de render/CPU atribuíveis sem confundir nós DOM com renders; correlação entre volume e experiência; privacidade, retenção e alertas de regressão. | **MONITORAR — NÃO IMPLEMENTAR** |

## Gate para reabrir

Reabrir somente após confirmar **todos** os critérios de retomada, aprovar um
plano de coleta com escopo limitado e preservar os fatos já confirmados como
baseline. A reabertura autoriza investigação, não otimizações: qualquer
implementação exige evidência nova, benefício mensurável, avaliação de risco e
aprovação de escopo separada.
