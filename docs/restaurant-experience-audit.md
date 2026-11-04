# Auditoria da experiência do restaurante

## Escopo e método

Auditoria diagnóstica do worktree local em 2026-11-03. A inspeção cobre rotas,
componentes, ligações entre telas, estados visíveis e padrões de carregamento em
código; não representa uso real nem o estado do deployment publicado.

Não foram consultados tráfego, sessões autenticadas de usuários, telemetria de
uso, métricas de rede, banco remoto ou profiling de produção. Portanto:

- “Impacto” e “risco de performance” são avaliações qualitativas baseadas no
  caminho e na quantidade de trabalho observáveis no código, não tempos medidos.
- Um atalho sem produtor interno identificado não é prova de que não tenha
  consumidores externos.
- A auditoria visual é por estrutura e composição dos componentes, não por
  captura autenticada com dados reais.
- Não houve alteração de comportamento, rota, API, autenticação, push, check-in,
  checkout, pagamento, regra de negócio, migration ou banco nesta auditoria.

O worktree já estava modificado antes do início: havia alterações em páginas e
componentes, arquivos removidos e uma migration não rastreada
(`supabase/migrations/20261103000000_verified_profile.sql`). Esses itens foram
preservados; não são atribuídos a esta auditoria. O único arquivo criado para
esta entrega é este relatório.

## 1. Mapa da experiência

| Área | Objetivo | Entrada | Saída | Dependências principais | Relação com outras telas |
|---|---|---|---|---|---|
| Dashboard | Resumir operação, pendências, próximas operações e conversas. | `/restaurant/dashboard`, logo/Home e navegação principal. | Detalhe da demanda, candidatos, chat, check-in/pagamento/checkout, avaliação, criação de operação e perfil. | Usuário e perfil, `jobs`, `applications`, mensagens/inbox, atribuições operacionais, avaliações pendentes e estado de comunicação. | É o hub; resume informações também disponíveis em Demandas, Equipe e Mensagens. |
| Demandas | Consultar operações por estado e abrir detalhes. | `/restaurant/demands`, navegação principal; links da Home e criação. | Lista filtrada, detalhe da demanda, edição/duplicação permitidas pela operação, criação. | `loadDemands`, candidaturas, reservas e projeções de estado no cliente. | É a lista de origem para detalhe, seleção de talentos e acompanhamento operacional. |
| Detalhe da demanda | Centralizar dados, candidatos, contratados, ações e etapas de uma operação. | `/restaurant/demands/{demandId}`; queries `view=candidates`, `view=talents`, `view=profile`, `action=edit`. | Perfil de profissional, convite/aprovação/reserva, chat, navegação para operação, check-in, pagamento, checkout e avaliação. | Dados da demanda, candidaturas, convites, eventos, atribuições, pessoas e RPCs de negócio existentes. | Faz a ponte entre Talentos/Candidatos, Equipe e Operação; algumas seções são acessíveis por âncoras. |
| Equipe | Acompanhar contratações ativas e sua próxima etapa operacional. | `/restaurant/team`, navegação principal. | Detalhe em painel/modal e ações para chat, check-in, pagamento, checkout ou avaliação, conforme o estado. | Atribuições operacionais, avaliação pendente e contexto operacional por profissional. | Recebe o resultado da seleção em Talentos/Detalhe; os links operacionais vão para telas compartilhadas. A lista não é o histórico: contratações concluídas são filtradas. |
| Talentos | Encontrar profissionais, consultar perfis, convidar e acompanhar estados por demanda. | `/restaurant/candidates` (item “Talentos” da navegação); também `/restaurant/demands/{id}?view=talents`. | Convite, aprovação de candidatura, perfil, histórico e avaliações do profissional. | Diretório de talentos, demandas ativas, convites, fotos assinadas e dados carregados sob demanda para histórico/avaliações. | A tela é organizada em torno de uma demanda selecionada. Divide informação e decisões com a visão de candidatos no detalhe da demanda. |
| Candidatos | Analisar candidaturas recebidas para uma demanda específica. | `/restaurant/demands/{id}?view=candidates`; atalhos da Home e do detalhe. | Perfil, aprovação/contratação, reserva e passagem para Equipe/Operação. | Candidaturas, perfis, eventos, atribuições e permissões de negócio existentes. | É um contexto de seleção por demanda; não é uma rota global distinta de Talentos. |
| Mensagens | Listar conversas operacionais com profissionais contratados e entrar no chat. | `/restaurant/messages`, item Mensagens, notificações e retorno do chat. | `/chat/{jobId}` para conversa individual; busca e filtragem local da lista. | Inbox operacional, dados do profissional/operação, contagens de mensagens e Realtime. | Atalhos da Home, Equipe, detalhe e notificações também podem abrir o chat individual diretamente. |
| Perfil | Ver e editar os dados do restaurante. | `/restaurant/profile`, avatar da Home ou Mais. | `/restaurant/profile/edit`; retorno ao perfil. | Componentes compartilhados de visualização/edição e serviços existentes de perfil/mídia. | Acesso duplicado pelo avatar e por Mais é contextual, não uma experiência diferente. |
| Histórico | Apresentar operações concluídas e avaliações. | `/restaurant/history`, item em Mais. | Atualmente, sempre apresenta estado vazio. | Não há carregamento de histórico nesta página. | Não recebe dados da Equipe; profissionais concluídos deixam a lista de Equipe, mas esta rota não os substitui atualmente. |

### Fluxo de contratação observado

```text
Dashboard ou Demandas
  -> Nova Operação (/restaurant/dashboard/jobs/create)
  -> formulário e publicação
  -> Convidar Agora (opcional) ou Pular
  -> Talentos da operação (/restaurant/demands/{id}?view=talents)
  -> convite aceito/candidatura recebida
  -> análise em Talentos ou Candidatos
  -> confirmar aprovação/contratação
  -> Equipe (/restaurant/team) e/ou seção de contratados da demanda
  -> chat, chegada/check-in, pagamento, checkout e avaliação
```

A publicação e o convite são ações distintas; a interface informa que o convite
é opcional e oferece saída direta para os detalhes. A candidatura aceita pode
ser aprovada tanto na Central de Talentos como no detalhe da operação. A
disponibilidade do chat aparece após aprovação. As etapas operacionais são
projeções de contratos existentes e não foram reavaliadas como regras nesta
auditoria.

## 2. Navegação

| Caso observado | Evidência / efeito | Classificação |
|---|---|---|
| Home, Operações, Talentos, Equipe e Mensagens na navegação principal; cartões e ações da Home levam às mesmas rotas ou a contextos mais específicos. | Os atalhos repetem destinos, mas evitam voltar à Home; não criam um segundo fluxo. | **MANTER** |
| “Talentos” aponta para `/restaurant/candidates`; não existe página `/restaurant/talents`. | Nome de menu e nome da rota diferem. A experiência global de Talentos está dentro de `candidates`. | **CONSOLIDAR** — nomenclatura e mapa mental, sem renomear/remover rota nesta sprint. |
| `?view=candidates`, `?view=talents`, `?view=profile` e `?action=edit` no detalhe da demanda. | São modos/contextos da mesma demanda, não rotas duplicadas. O parâmetro `demand` seleciona a demanda no quadro global. | **MANTER** |
| `/restaurant/candidates?view=messages` e `/restaurant/candidates#chats`. | Entradas legadas redirecionam com `router.replace` para `/restaurant/messages`; a tela evita montar Talentos durante a transição. Há testes de preservação de parâmetros/hash. | **REMOVER FUTURAMENTE** apenas o comportamento de compatibilidade, depois de medir uso e validar links externos/legados; manter o redirecionamento hoje. |
| Botões de Mensagens, prévias de conversa e avisos podem ir diretamente a `/chat/{jobId}`; retorno do chat do restaurante vai a `/restaurant/messages`. | Atalho direto e lista cumprem intenções diferentes. O aviso geral também oferece acesso à caixa. | **MANTER** |
| Avatar e Mais abrem `/restaurant/profile`; Novo Operação na Home, na lista vazia e em Demandas abre a mesma rota de criação. | Acesso redundante intencional por contexto. | **MANTER** |
| `/restaurant/history` está em Mais e na área ativa de “Mais” da navegação, mas sempre mostra estado vazio. | Baixa utilidade aparente no código, porém não existe medição de uso nem consulta a links externos. | **MANTER** até haver dados de uso e destino funcional acordado; não classificar como rota pouco usada sem evidência. |

Não foi encontrada rota separada `/restaurant/talents`; o build também não a
lista. “Talentos” e “Candidatos” têm nomes e pontos de entrada que podem parecer
duas áreas independentes, embora sejam a tela global e um contexto de seleção
por demanda. Os atalhos não são evidência de telas pouco utilizadas: não há
telemetria disponível nesta inspeção.

## 3. Experiência de contratação

| Etapa | Como funciona hoje | Fricção potencial (não medida) |
|---|---|---|
| Demanda | O formulário pede função, data, início/fim, diária, endereço (rua/número/cidade/UF) e detalhes. A publicação resolve/salva localização antes de criar a demanda. | Formulário longo e dependência de geocodificação tornam esta uma etapa de maior esforço; não há dado de abandono. |
| Talentos | Após publicar, há “Convidar Agora” e “Pular”. O quadro global também requer selecionar uma demanda, carregada em contexto. | Uma escolha adicional após publicação e mudança de contexto; é intencionalmente opcional. |
| Candidatura/convite | Candidaturas aparecem por demanda; convites e candidaturas aceitas têm estados diferentes. O convite pode exigir aceite do profissional antes da candidatura. | A diferença entre “convidar”, “candidatura” e “aprovar” pode demandar explicação para quem espera uma única lista. |
| Seleção | A aprovação pode ser iniciada em Talentos ou no detalhe; ambas mostram confirmação antes de chamar o RPC existente. | A pessoa pode encontrar ações semelhantes em mais de um lugar. O segundo ponto pode ser útil para seleção contextual, mas pede consistência visual e de status. |
| Equipe | Após aprovação, há encaminhamento à equipe no detalhe e uma visão global em `/restaurant/team`. | Alternância entre equipe da demanda e Equipe global é contexto adicional; as listas não têm a mesma finalidade. |
| Operação | Próxima ação depende da fase e leva para chat/check-in/pagamento/checkout/avaliação. | A dispersão entre detalhe, Equipe e telas operacionais pode exigir retorno à origem; as etapas não devem ser unidas sem preservar contexto e estado. |

**Etapas repetidas:** aprovação e leitura do perfil aparecem em Talentos e no
detalhe por demanda; resumo de operação/contratado aparece no Dashboard, no
detalhe e em Equipe com densidades diferentes. São sobreposições de apresentação
confirmadas, não repetição comprovada de trabalho nem defeito de regra.

**Cliques:** há ao menos duas confirmações visíveis em caminhos comuns: publicar
e, opcionalmente, navegar para convidar; na seleção, acionar aprovação e
confirmar. Não há instrumentação que permita afirmar um total médio de cliques.

**Abandono:** nenhum ponto de abandono real pode ser determinado sem funil. Os
maiores candidatos a teste futuro são o formulário extenso, o salto da publicação
para outra tela e a distinção convite/candidatura/aprovação. O gate de avaliação
pendente na criação é comportamento de negócio existente e fica fora do escopo de
qualquer ajuste desta auditoria.

## 4. Talentos e candidatos

| Dimensão | `/restaurant/candidates` (Talentos) | Detalhe `?view=candidates` |
|---|---|---|
| Escopo | Diretório e relacionamentos, com demanda ativa selecionada. | Candidaturas de uma demanda específica. |
| Dados sobre pessoas | Identidade, especialidade, cidade, perfil, métricas/reputação, relacionamento, histórico e avaliações. | Resumo do perfil, estado da candidatura, contratação/reserva e links para perfil/chat. |
| Ações | Busca/filtros, favorito/interesse, convite e aprovação de candidatura. | Perfil, aprovação, reserva e navegação para operação. |
| Sobreposição | Estados de candidatura/convite, ações de seleção e informações de perfil/reputação. | Reapresenta o contexto de candidatura da mesma demanda; as listas têm filtros e densidades diferentes. |

**Oportunidade de unificação:** oferecer uma única linguagem de seleção e um
mesmo resumo de perfil/estado, preservando a entrada global de busca e a entrada
contextual por demanda. Uma extração visual compartilhada pode reduzir
divergência sem fundir as duas tarefas. **Não** há evidência para remover uma
das telas nem para eliminar ações: cada uma oferece um contexto de entrada
válido.

**Complexidade observada:** o componente de Talentos reúne carregamento do
diretório, filtros, ranking local de sugestões, convites, aprovação, drawer de
perfil, histórico e avaliações. O conteúdo é progressivo em parte: avaliações e
histórico completos só são carregados ao solicitá-los; porém o diretório e as
fotos são carregados antes da filtragem local.

## 5. Mensagens

### Atalhos e compatibilidade verificados

- Navegação principal e badge de não lidas: `/restaurant/messages`.
- A tela de notificações fornece link para a caixa; notificações individuais
  mantêm seu próprio URL, que pode ser uma candidatura.
- Dashboard mostra conversas e pendências; “Responder” e prévia da conversa
  abrem diretamente `/chat/{jobId}`.
- Demanda, Equipe e avisos/toasts de conversa também podem abrir o chat
  individual.
- O chat do restaurante volta para `/restaurant/messages`.
- A caixa abre cada conversa em `/chat/{jobId}`, oferece busca local e leva a
  Demandas quando está vazia.
- As entradas antigas em `/restaurant/candidates?view=messages` e
  `/restaurant/candidates#chats` redirecionam para a caixa oficial e têm testes
  de compatibilidade.

**Conclusão:** a entrada da caixa está consolidada; abrir diretamente um chat
por um aviso/ação contextual é coerente e não é uma caixa duplicada. A
compatibilidade observada preserva queries não legadas e hash não legado. O
principal ponto de orientação é distinguir “Notificações” (avisos) de
“Mensagens” (conversas), distinção já presente na interface.

## 6. Auditoria visual

Classificação por potencial de impacto, baseada no conteúdo dos componentes:

| Impacto | Observação | Oportunidade diagnóstica |
|---|---|---|
| **ALTO IMPACTO** | Dashboard empilha três indicadores, pendências, operações, conversas recentes e um CTA fixo de criar operação. Uma mensagem não lida pode aparecer em “Ações pendentes” e a conversa também em “Conversas recentes”. | Avaliar hierarquia e prioridade das ações; medir se o resumo repetido ajuda ou compete com a tarefa principal. |
| **ALTO IMPACTO** | Talentos expõe busca, quatro abas, filtros adicionais, cartões densos e drawer com métricas, perfil, histórico e avaliações. | Validar se seleção e relacionamento ficam compreensíveis sem exigir leitura de vários indicadores; revisar conteúdo por etapa. |
| **ALTO IMPACTO** | Histórico é uma página acessível que, no código atual, sempre mostra “Ainda não houve nenhuma operação concluída.” sem consultar dados. | Confirmar contrato e conteúdo esperado antes de promover a entrada; o estado atual pode ser enganoso para quem já concluiu operações. |
| **MÉDIO IMPACTO** | Detalhe da demanda reúne resumo, “O que fazer agora”, links de etapas, “Outras ações”, candidatos recentes, equipe contratada e estados operacionais. | Considerar organização por prioridade/progressão e consistência de âncoras; preservar os deep links existentes. |
| **MÉDIO IMPACTO** | Mensagens mostra nome, especialidade, demanda, data/horário/local, última mensagem, estado operacional e não lidas no mesmo cartão. | Conferir em dispositivos estreitos a prioridade visual entre conversa e estado operacional. |
| **MÉDIO IMPACTO** | Equipe repete estado/horário/detalhe no cartão e no painel de detalhes; a ação pode aparecer em ambos. | Revisar o benefício do painel em relação ao cartão e manter o CTA operacional fácil de alcançar. |
| **BAIXO IMPACTO** | Demandas oferece sete filtros e “Mostrar mais”; filtros sem resultado e lista vazia têm mensagens distintas. | Medir filtros realmente usados; não remover filtros só por quantidade ou ausência de dados no código. |
| **BAIXO IMPACTO** | Há estados vazios para ausência de demanda, candidatura, conversa e contratação; a frequência real não é conhecida. | Instrumentar os vazios por área antes de simplificar conteúdo ou inferir desuso. |

Os pontos “alto impacto” são hipóteses de prioridade para teste/usabilidade, não
reprovações visuais aferidas com usuários.

## 7. Performance

Não foram medidos tempo de resposta, volume real, bundle, renderizações em
produção ou custo do banco. A classificação abaixo estima risco estrutural.

| Rota | Risco | Evidência estática | Próxima medição recomendada |
|---|---|---|---|
| `restaurant/dashboard` | **ALTO** | Carrega até 1.000 jobs, aplicações pendentes/confirmadas, mensagens não lidas e inbox. Outra rotina carrega atribuições e avaliações e consulta de novo a cada 30 s. Mudanças em `counts.messages` refazem o efeito inteiro do Dashboard, incluindo perfil/jobs/inbox. Cálculos de cartões percorrem listas carregadas. | Medir requests por visita e por minuto; separar refresh de contador do reload completo e comparar com métricas reais antes de mexer. |
| `restaurant/messages` | **ALTO no fallback; médio no caminho normal** | O caminho normal usa RPC paginada. Se ela não existir, o fallback percorre atribuições e dispara quatro consultas por contratação elegível, em lotes concorrentes de 20. Realtime em `messages`, `operational_assignments` e `applications` pode invalidar e recarregar a inbox inteira para eventos da tabela. | Confirmar se o fallback é usado em ambientes suportados; contar reloads Realtime, volume de conversas e consultas por atualização. |
| `restaurant/candidates` (Talentos) | **ALTO** | `loadDemands` mais paginação do diretório em lotes de 100, convites das demandas ativas e assinatura de fotos. Busca/filtros e cartões operam sobre a coleção em memória. Histórico e avaliações completos são carregados sob demanda. | Medir tamanho do diretório, imagens assinadas, tempo até interatividade e quantidade de cartões; observar uso dos filtros e dos detalhes sob demanda. |
| `restaurant/team` | **MÉDIO/ALTO** | Carrega atribuições e avaliações pendentes, resolve papéis e consulta contexto operacional por contratação, com concorrência em lotes de 20. Refaz o carregamento a cada 30 s e ao recuperar foco. | Contar contratações ativas por empresa, RPCs por carga e refreshes redundantes no intervalo/foco. |
| `restaurant/demands` | **MÉDIO/ALTO** | Busca todas as páginas de jobs, candidaturas e reservas da empresa; monta e filtra os grupos no cliente. A lista visual mostra 20 de cada vez, mas os dados já foram carregados. | Medir volume por empresa e custo de `loadDemands`; comparar downloads com itens efetivamente exibidos. |
| Detalhe de demanda | **MÉDIO** | Recarrega demanda, pessoas, eventos paginados, atribuições e avaliações pendentes em paralelo; alterações disparam reload da tela. `loadDemands` também carrega candidaturas/reservas necessárias à projeção. | Medir requests por detalhe e por ação; identificar chamadas que não são necessárias para a seção visível sem alterar contratos. |

**Consultas repetidas entre telas:** Dashboard, Talentos, lista e detalhe chamam
`loadDemands` ou carregam projeções relacionadas separadamente. Dashboard,
detalhe, criação e Equipe consultam avaliações pendentes em seus próprios ciclos.
Isso não demonstra erro: as rotas têm necessidades diferentes e não há cache
compartilhado no cliente. Qualquer consolidação precisa primeiro medir se o custo
é material e garantir atualização de estados operacionais.

**Renderizações:** há estado e cálculo derivado extenso em Dashboard/Talentos;
no componente de Talentos, a lista de sugestões atualiza estado condicionalmente
durante renderização para estabilizar sugestões por demanda. É um ponto para
verificar com profiling e testes antes de alterar, não uma conclusão de
renderização lenta.

## 8. Dívida técnica

| Prioridade | Item | Evidência e impacto possível |
|---|---|---|
| **CRÍTICO** | Nenhum problema crítico confirmado nesta inspeção estática. | Não houve execução autenticada com dados reais nem evidência de indisponibilidade; não elevar complexidade potencial a incidente. |
| **IMPORTANTE** | Componentes de página concentram responsabilidades. | `talent-center.tsx` (704 linhas no worktree), Dashboard (515) e `demand-detail.tsx` (387) concentram estado, carregamento, ações e apresentação. O tamanho, sozinho, não é bug; a mistura aumenta custo de revisão/teste. |
| **IMPORTANTE** | Projeções operacionais em telas distintas. | Inbox, Equipe, detalhe e Dashboard derivam rótulos/próxima ação de dados operacionais em formatos próprios. Mudanças futuras podem divergir de apresentação se não forem testadas juntas. Não alterar regras/RPCs como “limpeza” desta dívida. |
| **IMPORTANTE** | Estratégias de atualização variadas e repetidas. | Dashboard e Equipe usam intervalo de 30 s; Mensagens reage a eventos Realtime; detalhes recarregam após ação; demandas atualizam horário local periodicamente. Há risco de custo e estados inconsistentes se a estratégia mudar sem matriz de invalidação. |
| **IMPORTANTE** | Uma tarefa de seleção tem duas entradas de apresentação. | Talentos e detalhe da demanda repetem perfil/status/aprovação. A manutenção pede testes de paridade e clareza sobre qual tela é global e qual é contextual. |
| **BAIXA PRIORIDADE** | Formatação e estados auxiliares ficam próximos das páginas. | Funções locais de data/horário e rótulos facilitam leitura local, mas podem divergir entre páginas. Extrair apenas quando houver inconsistência concreta e cobertura apropriada. |
| **BAIXA PRIORIDADE** | Histórico de restaurante não possui fonte de dados. | A página é estática e sua mensagem não comprova o estado real da conta. Confirmar intenção do produto antes de decidir evolução/aposentadoria. |

## TOP 15 oportunidades de melhoria

Ordenação qualitativa por impacto no usuário, ganho operacional e baixo risco
relativo. São oportunidades para sprints futuras; nenhuma foi implementada.

| # | Oportunidade | Impacto no usuário | Ganho operacional | Risco |
|---:|---|---|---|---|
| 1 | Unificar linguagem e componente visual do perfil/status de candidato entre Talentos e detalhe, mantendo os dois contextos de entrada. | Alto | Menos divergência e retrabalho entre duas superfícies. | Baixo |
| 2 | Tornar explícita a progressão convite → aceite/candidatura → aprovação → equipe, sem misturar os estados. | Alto | Menos dúvidas e decisões incorretas. | Baixo |
| 3 | Revisar o formulário de publicação com teste de usabilidade, priorizando endereço e informações obrigatórias. | Alto | Menos esforço na etapa inicial. | Baixo |
| 4 | Testar se a decisão “Convidar Agora / Pular” após publicação é clara e se o salto para Talentos preserva a demanda selecionada. | Alto | Menos perda de contexto após publicar. | Baixo |
| 5 | Reduzir repetição entre pendências e conversas recentes no Dashboard, mantendo acesso direto ao chat. | Alto | Mais foco nas ações que exigem resposta. | Baixo |
| 6 | Medir requests do Dashboard e evitar recarregar dados independentes quando só muda a contagem de mensagens, se a medição confirmar custo. | Alto | Menos latência e tráfego recorrente. | Médio |
| 7 | Validar se o carregamento integral do diretório de Talentos é necessário antes de busca/filtro; medir uma carga real primeiro. | Alto | Menor espera para empresas com muitos talentos. | Médio |
| 8 | Medir o tamanho/tempo da inbox e os efeitos do Realtime antes de ajustar o gatilho de reload completo. | Médio | Atualização mais eficiente sem perder mensagens/estado. | Médio |
| 9 | Confirmar se o fallback da inbox sem RPC é necessário em ambientes ativos e medir seu custo; preservar compatibilidade até essa validação. | Médio | Evita trabalho por contratação onde o fallback não é necessário. | Médio |
| 10 | Mensurar volume de dados de Demandas e comparar o carregamento completo com o que a lista efetivamente apresenta. | Médio | Menor custo em contas com histórico grande. | Médio |
| 11 | Medir carga de Equipe em empresas com muitas contratações e o refresh duplicado por intervalo/foco. | Médio | Menos consultas sem perder atualização operacional. | Médio |
| 12 | Definir o conteúdo esperado de Histórico e corrigir a mensagem sempre vazia em uma sprint aprovada, sem remover a rota no diagnóstico. | Alto | Evita falsa indicação de que não há operações concluídas. | Médio |
| 13 | Rever hierarquia/quantidade de ações e âncoras no detalhe da demanda com tarefas reais de usuário. | Médio | Menos procura por ações de seleção e operação. | Baixo |
| 14 | Revisar visualmente o painel de Equipe para confirmar se repetir estado e ação no cartão e no detalhe agrega valor em mobile. | Médio | Menos leitura repetida. | Baixo |
| 15 | Instrumentar entradas, vazios, filtros, convites, aprovações e saídas do funil. | Médio | Gera base para priorizar e evitar remover caminhos usados. | Baixo |

## Validação desta entrega

| Verificação | Resultado |
|---|---|
| Testes (`npm test`) | **194 passaram, 0 falharam, 4 ignorados**. |
| Typecheck (`npm run typecheck`) | **Passou** (`next typegen` e `tsc --noEmit`). |
| Lint (`npm run lint`) | **Passou com 0 erros e 16 avisos** em `android/app/build/intermediates/assets/debug/mergeDebugAssets/native-bridge.js` (artefato gerado). |
| Build (`npm run build`) | **Passou**; o inventário de rotas inclui as rotas atuais de restaurante e não lista `/restaurant/talents`. |
| Alterações desta auditoria | **Somente este documento**; nenhum fluxo ou componente de produto foi alterado. |
| Banco/migrations/APIs/auth/push/operação | **Não alterados por esta auditoria**. A migration não rastreada já existia no baseline do worktree; não foi criada nesta entrega. |
| Rotas | **Nenhuma rota removida por esta auditoria**. |

As verificações validam o worktree existente, que já continha alterações não
relacionadas ao relatório. Portanto, os resultados não atribuem essas mudanças
anteriores a esta sprint e não atestam o comportamento do deployment publicado.
