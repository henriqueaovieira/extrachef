# ExtraChef: plano Beta de 30 dias

## Objetivo e limites

Validar se restaurantes conseguem preencher plantões e se profissionais conseguem concluir diárias com confiança. O Beta deve rodar em uma única cidade ou região, com acompanhamento próximo e sem desenvolver funcionalidades grandes. Pagamentos, mobile, IA e automações avançadas ficam fora do escopo.

As metas abaixo são critérios iniciais para decisão, não resultados observados. Ajuste-as antes do recrutamento se a capacidade operacional ou o mercado local forem diferentes.

## Plano de 30 dias

| Período | Execução | Evidência esperada |
| --- | --- | --- |
| Dias 1–3 | Escolher uma região e um tipo de operação; preparar contas de teste, planilha de métricas, canal de suporte e roteiro; confirmar RLS, migrations e fluxo completo em staging. | Teste interno ponta a ponta sem bloqueios críticos; critérios e definições de métricas registrados. |
| Dias 4–7 | Recrutar 8–12 restaurantes e 30–50 profissionais; entrevistar antes do primeiro uso; acompanhar cadastro e publicação da primeira vaga. | Pelo menos 6 restaurantes publicam uma vaga e 20 trabalhadores completam cadastro e veem oportunidades relevantes. |
| Dias 8–14 | Acompanhar as primeiras candidaturas e aprovações; observar chat, check-in e checkout sem conduzir cada clique; entrevistar após a primeira diária. | Primeiras 5–10 diárias concluídas; lista priorizada de falhas, dúvidas e abandono. |
| Dias 15–21 | Repetir o ciclo com os mesmos participantes; reduzir ajuda proativa e observar se conseguem operar sozinhos; acompanhar avaliações e notificações. | Evidência de repetição de uso e comparação entre tarefas assistidas e autônomas. |
| Dias 22–26 | Corrigir apenas bugs e fricções de alto impacto; repetir testes de segurança e jornadas; não incluir novos módulos. | Bloqueios críticos eliminados; fluxos principais executáveis sem suporte síncrono. |
| Dias 27–30 | Entrevistar participantes ativos e inativos; fechar métricas por coorte; decidir avançar, prolongar o Beta ou interromper o lançamento. | Relatório com dados, entrevistas, riscos e decisão documentada. |

**Ritmo operacional:** revisão diária de erros e vagas sem candidaturas; revisão semanal de métricas e incidentes; contato com participantes em até um dia útil. Registrar quando a equipe interveio para não confundir uso autônomo com operação concierge.

## Primeiros participantes

### Restaurantes

- Proprietário, gerente ou responsável direto por montar escalas.
- Restaurante independente ou pequena operação, na região escolhida.
- Tem necessidade recorrente de cobrir plantões e já usa WhatsApp, indicação ou agência.
- Aceita publicar pelo menos duas vagas durante o Beta e responder às candidaturas em prazo combinado.
- Excluir inicialmente operações sem responsável disponível para confirmar contratação, presença e encerramento da diária.

### Profissionais

- Cozinheiros, auxiliares, garçons ou outras funções que correspondam às vagas reais dos restaurantes participantes.
- Disponibilidade compatível com os horários e deslocamentos oferecidos na região.
- Consegue explicar como encontra plantões hoje e quais critérios usa para aceitar um.
- Participa voluntariamente do teste e entende que o Beta pode ter suporte manual.

**Amostra operacional proposta:** 8–12 restaurantes e 30–50 profissionais. A meta é aprender sobre liquidez local e repetição, não alegar validação estatística do mercado nacional.

## Roteiro de entrevistas

Pedir consentimento para anotações; não induzir respostas nem oferecer a solução como resposta. Entrevistar após uma tarefa real, não somente após uma demonstração.

### Restaurante: pré-uso, 15–20 minutos

1. Conte sobre a última vez que precisou cobrir um plantão.
2. Como encontrou a pessoa? Quanto tempo levou e quanto esforço exigiu?
3. O que costuma dar errado entre combinar o plantão e a pessoa chegar?
4. Como avalia se alguém é confiável para essa função?
5. O que precisa saber antes de aprovar um candidato?
6. Que informação impediria você de publicar uma vaga nesta plataforma?
7. Que resultado faria você voltar a publicar uma segunda vaga?

### Restaurante: pós-uso, 15 minutos

1. Mostre como você concluiu a última tarefa, do cadastro ao encerramento.
2. Em que momento precisou pedir ajuda ou sair do fluxo?
3. Como escolheu quem aprovar? O que faltou para decidir?
4. O chat, check-in, checkout e avaliação refletiram o que aconteceu na diária?
5. O que você fez fora da plataforma para concluir o processo?
6. O que faria você usar o fluxo novamente? O que faria você não voltar?

### Trabalhador: pré-uso, 15–20 minutos

1. Como encontra trabalho temporário hoje? Conte sobre o último plantão.
2. Como compara pagamento, horário, local e confiabilidade antes de aceitar?
3. O que já fez perder uma oportunidade ou chegar a um plantão que não correspondia ao combinado?
4. Que informação você precisa receber antes de se candidatar?
5. O que faria você confiar em um novo restaurante?

### Trabalhador: pós-uso, 15 minutos

1. Mostre como encontrou a vaga e acompanhou a candidatura.
2. Em qual etapa hesitou ou precisou de ajuda?
3. O chat ajudou a esclarecer o combinado? O que ficou faltando?
4. O check-in e o checkout foram claros e corresponderam à diária?
5. Você voltaria a se candidatar? O que precisaria mudar para isso?
6. Como se sentiria recomendando o ExtraChef a outro profissional? Por quê?

## Métricas essenciais

Registrar denominador, período e coorte. Segmentar restaurante e trabalhador; não misturar usuários convidados pela equipe com aquisição orgânica.

| Métrica | Definição operacional | Sinal inicial para avançar |
| --- | --- | --- |
| Ativação de restaurante | Restaurantes que publicam uma vaga válida / restaurantes cadastrados no Beta. | Pelo menos 6 dos 8–12 participantes. |
| Ativação de profissional | Trabalhadores que enviam candidatura a uma vaga real / trabalhadores cadastrados. | Pelo menos 20 trabalhadores ativos. |
| Liquidez da vaga | Vagas elegíveis com candidatura e decisão de contratação em até 72 h / vagas elegíveis publicadas. Excluir vagas retiradas pelo restaurante e registrar separadamente. | 60% ou mais na região piloto. |
| Tempo para preencher | Mediana entre publicação e aprovação. | Até 72 h; revisar por função e horário. |
| Comparecimento | Check-ins / candidaturas aprovadas com plantão já iniciado. | 85% ou mais. |
| Conclusão | Checkouts / check-ins realizados. | 85% ou mais. |
| Repetição de restaurante | Restaurantes ativos que publicam outra vaga em 30 dias / restaurantes que concluíram ao menos um plantão. | 40% ou mais. |
| Repetição de profissional | Trabalhadores ativos que se candidatam a outra vaga após a primeira diária / trabalhadores com diária concluída. | 30% ou mais. |
| Qualidade percebida | Nota pós-diária de 1–5, acompanhada de comentário qualitativo e taxa de resposta. | Média de 4,2 ou mais, com ao menos 10 respostas por lado antes de interpretar. |
| Esforço de suporte | Intervenções humanas necessárias por diária e minutos de suporte. | Tendência decrescente entre primeira e segunda utilização. |

**Métrica norteadora do Beta:** diárias concluídas com check-in e checkout por restaurante ativo a cada 30 dias. Não usar cadastros ou candidaturas isoladamente como prova de valor.

## Hipóteses a validar

1. Restaurantes da região têm necessidade recorrente e publicarão mais de uma vaga.
2. Há trabalhadores ativos suficientes, na função e região corretas, para responder dentro de 72 horas.
3. As informações atuais da vaga bastam para o trabalhador decidir candidatar-se.
4. O restaurante consegue decidir e aprovar sem mediação da equipe ExtraChef.
5. Chat, check-in e checkout reduzem ambiguidades e registram o que ocorreu na diária.
6. Trabalhadores e restaurantes aceitam avaliar a outra parte após a conclusão.
7. O fluxo gera confiança suficiente para uma segunda utilização sem incentivo operacional da equipe.
8. O suporte necessário por diária diminui depois da primeira utilização.

Para cada hipótese, registrar evidência favorável, evidência contrária, número de observações e decisão. Não contar elogios genéricos como validação de comportamento.

## Formulário de feedback pós-diária

Aplicar separadamente a restaurante e trabalhador; levar cerca de dois minutos.

1. Papel: restaurante / trabalhador.
2. Esta foi sua primeira diária pelo ExtraChef? sim / não.
3. De 1 a 5, quão fácil foi concluir seu fluxo principal?
4. De 1 a 5, quão confiante você se sentiu sobre o combinado e a outra parte?
5. Qual etapa foi mais difícil? cadastro / vaga / candidatura / aprovação / chat / check-in / checkout / avaliação / outra.
6. Precisou de ajuda da equipe? não / sim; em qual etapa?
7. O que você esperava que acontecesse e não aconteceu?
8. O que quase fez você desistir?
9. Você usaria o ExtraChef novamente nos próximos 30 dias? sim / talvez / não. Por quê?
10. Podemos entrar em contato para uma entrevista curta? sim / não.

Não solicitar documentos, dados bancários ou informações sensíveis neste formulário. Se houver contato posterior, obter consentimento e registrar somente o necessário.

## Critérios de decisão no dia 30

### Avançar para v1.0

- Pelo menos 8 restaurantes e 20 trabalhadores realizaram tarefas reais.
- Pelo menos 20 diárias concluídas, com dados suficientes para calcular comparecimento, conclusão e repetição.
- Metas iniciais de liquidez, comparecimento e conclusão atingidas, ou desvios explicados por uma causa operacional corrigível e confirmada.
- Pelo menos 40% dos restaurantes elegíveis repetiram publicação e 30% dos trabalhadores elegíveis voltaram a candidatar-se.
- Nenhum incidente crítico de exposição de dados, autorização incorreta ou perda de registro sem plano de correção.
- Fluxos principais executáveis sem acompanhamento ao vivo na maioria das tentativas finais.

### Prolongar o Beta

- Volume insuficiente, participantes concentrados em uma única rede de indicação, ou resultados contraditórios por função/horário.
- Interesse declarado alto, mas baixa repetição ou baixa conclusão ainda sem causa identificada.
- Problemas corrigíveis de onboarding, copy, navegação ou operação que impedem medir a hipótese de mercado.

### Não avançar ainda

- RLS ou isolamento entre contas não comprovados.
- Incidentes críticos de segurança ou integridade dos registros.
- Restaurantes não conseguem preencher vagas mesmo com oferta suficiente, ou usuários não voltam após experiência concluída.

## Roadmap Beta → v1.0

### Durante o Beta

- Instrumentar os eventos já existentes e registrar funil/coorte manualmente se ainda não houver analytics.
- Corrigir bugs, acessibilidade, mensagens, estados vazios/carregamento e navegação observados.
- Melhorar os fluxos existentes de criar, editar e encerrar vaga; não introduzir novos módulos.
- Ajustar RLS, documentação, recuperação operacional e automação dos testes críticos.

### Gate de v1.0

- Aprovação de segurança e migrations reproduzíveis em ambiente limpo.
- Checklist de testes completo em Preview, com evidência e contas de papéis diferentes.
- Metas do Beta avaliadas por coorte e decisão assinada pelo responsável do produto.
- Deploy, rollback, suporte e responsável por incidentes definidos.

### Primeiros 30 dias de v1.0

- Monitorar as mesmas métricas semanalmente e comparar com a coorte Beta.
- Priorizar apenas correções com impacto demonstrado em ativação, conclusão, retenção ou segurança.
- Fazer revisão quinzenal com usuários; adiar expansão geográfica até a liquidez local se repetir.
- Não adicionar pagamentos, mobile, IA ou automações complexas sem evidência específica do Beta.