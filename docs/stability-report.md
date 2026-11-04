# Sprint de consolidacao, estabilidade e otimizacao

## Escopo e resumo

Entrega local sobre o worktree existente em 2026-11-03. Nao representa
publicacao na Vercel. Alteracoes anteriores de perfil, verificacao e operacoes
foram preservadas; nao foram criadas por esta sprint.

**Estado mais recente:** apos a sprint, o usuario autorizou explicitamente
`Fix all issues` no formulario de seguranca. A [secao 10](#10-correcao-de-dependencias-apos-autorizacao-adicional)
registra as correcoes de dependencias, validacoes repetidas e o bloqueio
upstream remanescente. As secoes 5, 6 e 9 conservam o baseline anterior a essa
autorizacao; "sem upgrades" nessas secoes descreve somente a sprint original.

**Implementacao limitada a mensagens:** a rota oficial passa a ser
`/restaurant/messages` em todos os acessos internos para a caixa do restaurante.
Candidates preserva compatibilidade de query/hash sem montar uma segunda caixa.
As demais fases sao auditoria e documentacao, nao refatoracao ou upgrade.

Entregas de governanca:
[rotas](./routes.md), [arquitetura](./architecture.md),
[legados preservados](./legacy-fields.md). O
[roadmap V2](./consolidation-roadmap-v2.md) conserva o mapa historico e a entrega
de perfil unico; este relatorio atualiza o estado de mensagens.

## 1. Mensagens: mapa e consolidacao executada

### Consumidores e componentes

| Entrada / consumidor | Antes | Agora / contrato |
| --- | --- | --- |
| [MobileBottomNav](../app/components/mobile-bottom-nav.tsx#L15) | `/restaurant/messages` | Mantido como destino oficial. |
| [NotificationCenter](../app/components/notification-center.tsx#L196) | `/restaurant/candidates#chats` | Atualizado diretamente para `/restaurant/messages`; worker continua `/worker/messages`. Nenhuma consulta, leitura de aviso ou contagem mudou. |
| [ChatClient](../app/chat/[jobId]/chat-client.tsx#L345) | Voltar restaurante para `/restaurant/messages` | Mantido; nenhuma logica do chat alterada. |
| [CandidatesPage](../app/restaurant/candidates/page.tsx) com `?view=messages` | Montava RestaurantMessageCenter dentro de candidatos. | `replace` para rota oficial; remove somente seletor legado e preserva demais parametros/hash. |
| Candidates com `#chats` | Abria Talentos, sem acionar switch de mensagens. | Detecta hash no cliente e redireciona; consome `#chats`, preserva query. |
| Candidates normal / `?demand=` / outros hashes | Talentos e demanda selecionada. | Mantidos, sem redirecionamento. |
| [Home restaurante](../app/restaurant/dashboard/page.tsx#L483) | Abre `/chat/{jobId}` nas conversas recentes. | Mantido: conversa direta nao e outra caixa de entrada. |
| [Equipe](../app/restaurant/team/team-center.tsx), [demanda](../app/restaurant/demands/[demandId]/demand-detail.tsx), [painel](../app/components/operational-panel.tsx) | Chat/etapas por job. | Mantidos; atalhos operacionais nao passam obrigatoriamente pela caixa. |
| [NotificationExperience](../app/components/notification-experience.tsx#L375) | Preview/toast abre chat; resposta rapida sem navegacao. | Mantido sem alteracao, inclusive Push/Realtime e leitura. |
| [WorkerMessages](../app/worker/messages/page.tsx) | Caixa profissional independente. | Mantida; unificar a entrada restaurante nao funde papeis. |
| SQL/notificacoes historicas | Podem persistir `/restaurant/candidates#chats`. | Preservados no banco/migrations; compatibilidade somente frontend. |

O [RestaurantMessageCenter](../app/restaurant/messages/message-center.tsx)
continua unico, agora montado somente pela
[pagina oficial](../app/restaurant/messages/page.tsx). Compartilha
[loadRestaurantMessageInbox](../lib/restaurant-message-inbox.ts),
[signDemandPhotos](../lib/demand-detail.ts#L96), selo publico, UI e navegacao.
Autenticacao, contratos de contratacao, RPC, fallback de dados, assinatura de
fotos, busca, mensagens nao lidas e Realtime nao foram alterados.

### Compatibilidade e robustez

- Hash nao chega ao servidor: candidates aguarda snapshot do navegador com
  `useSyncExternalStore`, inclusive inscricao/limpeza de `hashchange`.
- Antes de conhecer o hash, renderiza estado de continuidade, nao Talentos.
  URL legada nao dispara consultas de talentos nem monta outra caixa.
- `router.replace` evita acrescentar o caminho legado ao historico. Parametros
  sao serializados por URLSearchParams e o destino tem prefixo interno fixo.
- Nao houve exclusao de rota, redirecionamento global de candidatos,
  regravacao de avisos, migration ou alteracao de autenticacao.
- Nao limpar `demand` ou outros parametros desconhecidos por suposicao.
  A caixa atual nao os utiliza, mas compatibilidade nao deve elimina-los.

## 2. Navegacao e duplicacoes

Inventario de todas as paginas, APIs, queries/hashes e responsaveis por area:
[routes.md](./routes.md). Nao foram presumidos owners individuais.

| Funcionalidade / acessos | Evidencia e analise | Classificacao |
| --- | --- | --- |
| Caixa restaurante em candidates e messages | Mesmo componente; segunda montagem retirada nesta sprint, URLs preservadas com encaminhamento. | **REMOVER AGORA**, somente montagem paralela executada; nao remover rotas. |
| Atalho legado em notificacoes | Apontava ao hash de candidatos, nao a caixa. Atualizado. | **REMOVER AGORA**, somente destino obsoleto substituido. |
| Menus restaurante | Home, Operacoes, Talentos, Equipe, Mensagens, Mais; Mais oferece perfil/historico/avisos/privacidade. | **MANTER** |
| Menus worker | Home, Candidaturas, Mensagens, Perfil; perfil oferece verificacao/confianca/historico/avisos/privacidade/sair. | **MANTER** |
| Perfil canonico e aliases | Mesmo ponto de experiencia apos sprint anterior; editor por query e perfil generico restaurante preservado. | **MANTER** compatibilidade; **CONSOLIDAR FUTURAMENTE** eventual retirada apos telemetria. |
| Avatar, menu Meu Perfil e botao de editar | Diferentes intencoes/acessos para identidade; destinos canonicos. | **MANTER**; nao eliminar acesso contextual util. |
| Cards de demanda / Home / lista | Varios acessos a `/restaurant/demands/{id}`, CTAs dependem do estado. | **MANTER** |
| Criar operacao por Home/lista/vazio de talentos | Mesmo destino, uma funcionalidade com varios pontos uteis. | **MANTER** |
| Talentos globais versus rede/candidatos por demanda | Drawer de perfil, `?view=profile&person=`, convites e contratacao sobrepostos na apresentacao. Privacidade/contexto podem diferir. | **CONSOLIDAR FUTURAMENTE** apresentacao, nao regras. |
| Equipe global versus contratados da demanda | Mesmos participantes em escopos diferentes, acoes por job. | **CONSOLIDAR FUTURAMENTE** resumos comuns; manter centros. |
| Historico restaurante e historico contextual worker/talento | Escopos e papeis distintos; vazio nao prova pagina abandonada. | **MANTER** |
| Avisos versus caixa versus chat | Historico, lista de conversas e conversa individual sao diferentes. | **MANTER** |
| Wrappers checkin/payment/checkout | OperationalPanel ja compartilhado; URLs sao contratos operacionais. | **MANTER** |
| Avaliacao acessada por Home/equipe/operacao/criacao/candidaturas | Varias entradas para obrigacao existente, nao varias regras. | **MANTER** |
| Dados de conta em paginas legais/preferencias/exportacao | Direitos e explicacao publica nao sao duplicatas descartaveis. | **MANTER** |
| Labels/ordem de fases em chat, equipe, inbox e operations | Projecoes semelhantes, nem sempre semanticamente identicas. | **CONSOLIDAR FUTURAMENTE** vocabulario, sem alterar calculos/RPCs. |

Nao foram encontrados outros itens com evidencia suficiente para exclusao
imediata. Helpers usados por testes, buckets ativos, APIs HTTP/webhooks e
migrations historicas nao sao codigo morto por ausencia de imports de pagina.

## 3. Perfil Verificado

Revisao do estado atual, sem nova regra:

| Tela | Onde aparece | Consistencia / acao futura |
| --- | --- | --- |
| Perfil unico worker | [Overview:213](../app/components/profile-overview.tsx#L213), cabecalho e [secao privada](../app/components/profile-verification.tsx#L70). | Presente; pode repetir selo na mesma pagina. Editor remete a `#verification`; nao necessita fluxo paralelo. |
| Candidatos / talentos | [TalentCenter:449,629,695](../app/restaurant/candidates/talent-center.tsx#L449): card, drawer e confirmacao. | Presente, por userId. |
| Rede / candidato / contratado contextual | [DemandPerson:18](../app/components/demand-person.tsx#L18), componente reutilizado. | Presente; perfil indisponivel nao significa rejeitado. |
| Equipe | [TeamCenter:118,144](../app/restaurant/team/team-center.tsx#L118), lista e drawer por jobId. | Presente; resolucao de job e dependente de contexto. |
| Mensagens restaurante | [MessageCenter:172](../app/restaurant/messages/message-center.tsx#L172). | Presente; aliases chegam ao mesmo componente. |
| Mensagens worker | Mostra empresa/operacao em [WorkerMessages](../app/worker/messages/page.tsx#L152). | Nao aplicar selo de trabalhador a restaurante. |
| Chat | [ChatClient:385,395,442,462](../app/chat/[jobId]/chat-client.tsx#L385), cabecalho worker e autores. | Presente; avaliar densidade por mensagem sem mudar semantica. |
| Dashboard restaurante | [Dashboard:407,424,489](../app/restaurant/dashboard/page.tsx#L407), avaliacao, acao com pessoa e conversa. | Presente com userId/jobId. |
| Dashboard worker | Home identifica o proprio usuario via avatar; perfil canonico possui estado completo. | Ausencia de selo no avatar nao e nova regra; considerar somente padronizacao de identidade em sprint visual. |
| Preview global | [NotificationExperience:386](../app/components/notification-experience.tsx#L386), remetente. | Presente. Avisos genericos/toast nao devem inferir worker pelo texto. |
| Operacao / avaliar / criar bloqueado por avaliacao | [OperationalPanel:102](../app/components/operational-panel.tsx#L102), [Review:153](../app/reviews/[jobId]/review-client.tsx#L153), [Create:145](../app/restaurant/dashboard/jobs/create/page.tsx#L145). | Presente ao identificar worker; fluxos preservados. |

Onde deveria aparecer: junto a identidade profissional nas superficies de
decisao/comunicacao que possuam identificador autorizado; os principais pontos
ja o incluem. Nao e necessario em todo aviso generico, nome de empresa ou push nativo.

Inconsistencias/riscos a validar, nao bugs remotos presumidos:

1. Estado privado e sinal publico possuem requisitos/fontes e ciclos diferentes.
   O provider atualiza em lotes, foco/navegacao/autenticacao e intervalo de 60 s;
   nao presumir sincronizacao instantanea apos submissao/revisao.
2. Ausencia de registro/contexto/consulta nao significa identidade rejeitada.
3. JobId exige resolver trabalhador; userId evita consulta de resolucao. Preferir
   o identificador ja disponivel numa eventual otimizacao, sem alterar acesso.
4. Manter `ProfileVerification` (privado), `ProfessionalVerification` (consulta)
   e `VerifiedProfileBadge` (apresentacao) separados. Compartilhar UI nao pode
   expor CPF, RG ou selfie.
5. Selo de identidade permanece independente de Confianca Operacional.

## 4. Inventario visual

Nenhum texto ou estado visual foi alterado nesta fase. Busca em app/lib por
literais e equivalentes; excluidos nomes de variaveis/tipos, comentarios e
condicoes de estilo. `0 itens`, `0 arquivos`, `Sem dados`, `Sem conteúdo` e
`Vazio` nao foram encontrados como placeholders literais visiveis atuais.
Contagens dinamicas e mensagens equivalentes estao abaixo.

O [inventario detalhado anterior](./consolidation-roadmap-v2.md#7-inventario-visual)
continua referencia complementar, inclusive para linhas/variantes por subvisao.
Esta sprint revalidou arquivos e acrescentou o estado canonico de perfil/mensagens.

| Arquivo | Tela / conteudo / contexto | Classificacao |
| --- | --- | --- |
| [profile/page:90](../app/profile/page.tsx#L90) | Perfil generico agora restaurante: cidade "Não informada". | **NÃO AGREGA VALOR**, campo opcional sem acao. |
| [profile-overview:101](../app/components/profile-overview.tsx#L101) | Perfil: experiencia "Não informada". | **NÃO AGREGA VALOR** |
| [profile-overview:102](../app/components/profile-overview.tsx#L102) | Especialidades "Não informadas". | **AGREGA VALOR**, dado profissional relevante e editavel. |
| [profile-overview:140](../app/components/profile-overview.tsx#L140) | Restaurante: descricao "Não informada". | **NÃO AGREGA VALOR** |
| [profile-overview:214](../app/components/profile-overview.tsx#L214) | Resumo: "Cidade não informada". | **NÃO AGREGA VALOR**, repeticao de ausencia; nao remover cidade do cadastro. |
| [demand-person:19](../app/components/demand-person.tsx#L19) | Candidato/rede/equipe: especialidade nao compartilhada. | **AGREGA VALOR**, respeitar dado indisponivel. |
| [talent-center:631](../app/restaurant/candidates/talent-center.tsx#L631) | Drawer: cidade nao compartilhada. | **AGREGA VALOR**, privacidade nao e inexistencia. |
| [talent-center:646](../app/restaurant/candidates/talent-center.tsx#L646) | Drawer: descricao e experiencia (linha 650) nao compartilhadas. | **NÃO AGREGA VALOR**, secoes opcionais vazias. |
| [talent-center:648](../app/restaurant/candidates/talent-center.tsx#L648) | Drawer: especialidades nao compartilhadas. | **AGREGA VALOR** |
| [talent-center:671](../app/restaurant/candidates/talent-center.tsx#L671) | Avaliacao: "Sem comentário." | **NÃO AGREGA VALOR**, nota pode existir sem comentario. |
| [talent-center:673](../app/restaurant/candidates/talent-center.tsx#L673) | Nenhuma avaliacao compartilhada. | **AGREGA VALOR**, nao inventar nota zero. |
| [demand-detail:243](../app/restaurant/demands/[demandId]/demand-detail.tsx#L243) | Perfil contextual: experiencia nao compartilhada. | **NÃO AGREGA VALOR** |
| [demand-detail:198](../app/restaurant/demands/[demandId]/demand-detail.tsx#L198) | Perfil nao disponivel; variantes nas linhas 246/312. | **AGREGA VALOR**, explica limite de dados/acesso. |
| [talent-center:475](../app/restaurant/candidates/talent-center.tsx#L475) | Nenhum resultado nos filtros. | **AGREGA VALOR** |
| [talent-center:482](../app/restaurant/candidates/talent-center.tsx#L482) | Nenhum convidado; variante 486; sugestoes ou aguardando candidaturas. | **AGREGA VALOR** |
| [talent-center:493](../app/restaurant/candidates/talent-center.tsx#L493) | Nenhuma candidatura para operacao. | **AGREGA VALOR** |
| [talent-center:496](../app/restaurant/candidates/talent-center.tsx#L496) | Nenhuma operacao ativa; CTA Criar. | **AGREGA VALOR** |
| [talent-center:565](../app/restaurant/candidates/talent-center.tsx#L565) | Nenhum interesse marcado; explica marcacao. | **AGREGA VALOR** |
| [demand-talent-network:83](../app/components/demand-talent-network.tsx#L83) | Nenhum profissional no filtro, orienta busca. | **AGREGA VALOR** |
| [restaurant/dashboard:451](../app/restaurant/dashboard/page.tsx#L451) | Nenhuma pendencia; linha 472 sem operacao agendada. | **AGREGA VALOR** |
| [demands/page:107](../app/restaurant/demands/page.tsx#L107) | Nenhuma operacao; linha 123 sem resultado no filtro; CTAs. | **AGREGA VALOR** |
| [demand-detail:234](../app/restaurant/demands/[demandId]/demand-detail.tsx#L234) | Operacao nao encontrada/indisponivel. | **AGREGA VALOR** |
| [demand-detail:254](../app/restaurant/demands/[demandId]/demand-detail.tsx#L254) | Sem candidatos, variante 299; compartilhar. | **AGREGA VALOR** |
| [demand-detail:320](../app/restaurant/demands/[demandId]/demand-detail.tsx#L320) | Nenhum contratado; convidar. | **AGREGA VALOR** |
| [demand-detail:353](../app/restaurant/demands/[demandId]/demand-detail.tsx#L353) | Nenhum evento registrado na timeline. | **AGREGA VALOR** |
| [history/page:14](../app/restaurant/history/page.tsx#L14) | Ainda sem operacao concluida. | **AGREGA VALOR** |
| [team-center:107](../app/restaurant/team/team-center.tsx#L107) | Sem contratacao em andamento; Ir para Talentos. | **AGREGA VALOR** |
| [message-center:178](../app/restaurant/messages/message-center.tsx#L178) | Ainda sem mensagens numa contratacao; linha 194 distingue busca sem resultado/caixa vazia. | **AGREGA VALOR** |
| [worker/dashboard:362](../app/worker/dashboard/page.tsx#L362) | Sem plantoes, orienta revisar perfil. | **AGREGA VALOR** |
| [worker/applications:170](../app/worker/applications/page.tsx#L170) | Ainda sem candidaturas; Explorar vagas. | **AGREGA VALOR** |
| [worker/invitations:67](../app/worker/invitations/page.tsx#L67) | Nenhum convite por enquanto. | **AGREGA VALOR** |
| [worker/messages:142](../app/worker/messages/page.tsx#L142) | Ainda nao existem conversas. | **AGREGA VALOR** |
| [chat-client:428](../app/chat/[jobId]/chat-client.tsx#L428) | Conversa da operacao / Comece a conversa (430). | **AGREGA VALOR** |
| [notification-center:218](../app/components/notification-center.tsx#L218) | Falha de consulta versus nenhum aviso no filtro/tudo em dia (222). | **AGREGA VALOR**, nunca converter erro em sucesso vazio. |
| [demand-card:106](../app/components/demand-card.tsx#L106) | Local a definir; tambem convites:62, chat:181, detalhe:270/358 e helper de compartilhamento. | **AGREGA VALOR**, dado operacional necessario. |
| [restaurant/dashboard:467](../app/restaurant/dashboard/page.tsx#L467) | Endereco nao informado; detalhe:359 mesma necessidade. | **AGREGA VALOR** |
| [worker/dashboard:392](../app/worker/dashboard/page.tsx#L392) | Distancia indisponivel por falta de coordenadas. | **AGREGA VALOR** |
| [demand-detail:365](../app/restaurant/demands/[demandId]/demand-detail.tsx#L365) | Nenhuma orientacao adicional. | **NÃO AGREGA VALOR**, texto opcional. |
| [chat-client:65](../app/chat/[jobId]/chat-client.tsx#L65) | Check-in, pagamento e checkout pendentes (65/67/68). | **AGREGA VALOR**, estados acionaveis. |
| [restaurant-message-inbox:73](../lib/restaurant-message-inbox.ts#L73) | Mesmas pendencias projetadas na caixa (73/75/76). | **AGREGA VALOR** |
| [operational-panel:139](../app/components/operational-panel.tsx#L139) | Pagamento pendente/informado/contestado e orientacao. | **AGREGA VALOR**, preservar fluxo. |
| [restaurant-team:78](../lib/restaurant-team.ts#L78) | Pagamento pendente da Equipe; [team-center:160](../app/restaurant/team/team-center.tsx#L160) anuncia etapa pendente por aria-label. | **AGREGA VALOR**, inclusive acessibilidade. |
| [demands:88](../lib/demands.ts#L88) | Checkout Pendente e profissionais pendentes (95). | **AGREGA VALOR**, risco/equipe incompleta. |
| [restaurant/dashboard:393](../app/restaurant/dashboard/page.tsx#L393) | Acoes pendentes e avaliacao pendente (406); [worker/dashboard:305](../app/worker/dashboard/page.tsx#L305) equivalente. | **AGREGA VALOR** |
| [demand-detail:339](../app/restaurant/demands/[demandId]/demand-detail.tsx#L339) | Estado indisponivel versus aguardando etapa. | **AGREGA VALOR** |
| [operational-reputation:16](../app/components/operational-reputation.tsx#L16) | Sem compromissos / Sem avaliacoes (17) / indicadores nao compartilhados (76). | **AGREGA VALOR**, nao inventar desempenho. |
| [operational-reputation:18](../app/components/operational-reputation.tsx#L18) | Contadores de trabalho/check-in/ausencia podem ser zero. | **AGREGA VALOR**, historico mensuravel. |
| [operational-reputation:58](../app/components/operational-reputation.tsx#L58) | Traco em loading/erro/ausencia no resumo. | **AGREGA VALOR** nao inventar zero; melhorar distincao visual futuramente. |
| [talent-center:110](../app/restaurant/candidates/talent-center.tsx#L110) | Titulos convidados/candidatos `(0)`, junto ao vazio explicado. | **NÃO AGREGA VALOR** quando redundante. |
| [talent-center:452](../app/restaurant/candidates/talent-center.tsx#L452) | Nota ausente em traco e zero operacoes (453); metricas drawer 640/643, data 654, privadas 665. | **AGREGA VALOR** distinguir historico/privacidade; revisar `?? 0` para ausencia nao virar numero. |
| [demand-detail:244](../app/restaurant/demands/[demandId]/demand-detail.tsx#L244) | Operacoes concluidas com empresa versus zero candidatos/ver todos (250/298). | Historico **AGREGA VALOR**; zero repetido ao vazio **NÃO AGREGA VALOR**. |
| [restaurant/dashboard:375](../app/restaurant/dashboard/page.tsx#L375) | Resumo zero operacoes/nao lidas; [worker/dashboard:265](../app/worker/dashboard/page.tsx#L265) candidaturas/diarias/ganhos. | **AGREGA VALOR**, dados reais, erro separado. |
| [notification-center:179](../app/components/notification-center.tsx#L179) | Zero nao lidas no cabecalho. | **AGREGA VALOR** |
| [profile-editor:390](../app/components/profile-editor.tsx#L390) | Restaurante: zero fotos salvas e limite; nao sao certificados worker. | **AGREGA VALOR** no formulario. |
| [push-notification-control:43](../app/components/push-notification-control.tsx#L43) | Zero dispositivos e entregas "nenhuma". | **AGREGA VALOR**, diagnostico; nao alterar push. |
| [offline.html:19](../public/offline.html#L19) | Sem conexao. | **AGREGA VALOR** |

Erros de carregar "avaliacoes pendentes" sao falhas, nao placeholders.
Textos legais de ausencia de rastreamento/biometria agregam valor.
O [EmptyState](../app/components/ui/index.tsx#L88) nao cria texto generico;
recebe titulo/descricao explicitos. Nao ha contagem de certificados/arquivos
profissionais reintroduzida pela consolidacao.

## 5. Seguranca e dependencias

Consulta ao registry/npm audit em **2026-11-03**, sobre manifest/lock locais.
Nenhum pacote foi instalado, atualizado ou removido. Resultado bruto:
**22 entradas, 1 critical e 21 moderate; 4 diretas e 18 transitivas; 6
advisories distintos**. Propagacao de um advisory na arvore nao e uma nova
vulnerabilidade independente. Severidade publicada nao prova explorabilidade.

### Advisories e contexto

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🔴 CRITICAL | [package-lock.json](../package-lock.json) | 6071 no baseline | Next 16.4.0: [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr), RCE com `use cache` retornando multiplos typed arrays. Cache Components habilitado; essas funcoes nao foram identificadas na revisao. Exploracao nao confirmada. | 10/10 na correspondencia da versao |
| 2 | 🔴 CRITICAL | [package-lock.json](../package-lock.json) | 6071 no baseline | Next: [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), RCE no otimizador de imagens em Linux/glibc. **Mitigado no lock** por sharp 0.35.5, conforme advisory. | 10/10 na versao e mitigacao documentada |
| 3 | 🟠 HIGH | [package-lock.json](../package-lock.json) | 6071 no baseline | Next: [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), DoS em Server Actions. Faixa instalada afetada; nao foi realizado teste de exploracao. | 10/10 na correspondencia da versao |
| 4 | 🟡 MEDIUM | [package-lock.json](../package-lock.json) | arvore transitiva | minimatch: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), DoS por amplificacao de globparts, `<11.0.1`. Uso direto de entrada hostil pela aplicacao nao demonstrado. | 10/10 no inventario npm |
| 5 | 🟡 MEDIUM | [package-lock.json](../package-lock.json) | arvore transitiva | glob: [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), bypass de cancelamento/travessia apos timeout, `>=9.0.0 <=14.0.1`. Nao confirmado como caminho exposto ao usuario. | 10/10 no inventario npm |
| 6 | 🟡 MEDIUM | [package-lock.json](../package-lock.json) | 7833 no baseline | uuid 7.0.3 via Capacitor CLI -> xcode: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), CVE-2026-41907. APIs v3/v5/v6 com buffers; xcode consultado usa **v4**, nao afetada. | 10/10 na versao e consumidor consultado |

**Nao ha vulnerabilidade exploravel da aplicacao confirmada por esta auditoria
de dependencias.** Isso nao equivale a certificar seguranca nem autoriza manter
Next desatualizado. Os dois advisories RCE Next nao apresentavam CVE nas fontes
consultadas. O lock preserva [sharp 0.35.5](../package-lock.json#L6927).

### Inventario das 22 entradas npm

`prod` abaixo significa no grafo de dependencies do lock, nao necessariamente
execucao no servidor. Capacitor CLI e ferramenta de build declarada em dependencies.
Todas as entradas sao moderate, exceto Next critical.

| Entrada | Direta/transitiva | Grafo | Advisory proprio ou propagacao |
| --- | --- | --- | --- |
| `@capacitor/cli` | Direta | prod | xcode -> uuid |
| `@eslint-community/eslint-utils` | Transitiva | dev | eslint |
| `@eslint/config-array` | Transitiva | dev | minimatch |
| `@eslint/eslintrc` | Transitiva | dev | minimatch |
| `@next/eslint-plugin-next` | Transitiva | dev | eslint-utils |
| `@typescript-eslint/eslint-plugin` | Transitiva | dev | parser/type-utils/utils/eslint |
| `@typescript-eslint/parser` | Transitiva | dev | typescript-estree/eslint |
| `@typescript-eslint/type-utils` | Transitiva | dev | typescript-estree/utils/eslint |
| `@typescript-eslint/typescript-estree` | Transitiva | dev | minimatch |
| `@typescript-eslint/utils` | Transitiva | dev | eslint-utils/typescript-estree/eslint |
| `eslint` | Direta | dev | eslint-utils/config-array/eslintrc/minimatch |
| `eslint-config-next` | Direta | dev | plugin-next/eslint/plugins/typescript-eslint |
| `eslint-plugin-import` | Transitiva | dev | minimatch |
| `eslint-plugin-jsx-a11y` | Transitiva | dev | minimatch |
| `eslint-plugin-react` | Transitiva | dev | minimatch |
| `glob` | Transitiva | prod | Advisory proprio + minimatch |
| `minimatch` | Transitiva | dev/prod | Advisory proprio |
| `next` | Direta | prod | Tres advisories proprios |
| `rimraf` | Transitiva | prod | glob |
| `typescript-eslint` | Transitiva | dev | plugin/parser/typescript-estree/utils/eslint |
| `uuid` | Transitiva | prod | Advisory proprio |
| `xcode` | Transitiva | prod | uuid |

### Versoes e plano de atualizacao, nao executado

| Pacotes | Lock atual | Estavel consultada | Impacto / homologacao |
| --- | --- | --- | --- |
| Next / eslint-config-next | 16.4.0 | **16.4.5** | Prioridade de seguranca; corrigidos os advisories Next a partir de 16.4.1. Atualizar juntos, preservar sharp >=0.35.5; validar SSR, rotas, cache, proxy e aliases. |
| React / React DOM | 19.3.0 | **19.3.1** | Patch coordenado; hidratar perfil/chat e testar interacoes. Nenhum advisory retornado para estes pacotes. |
| Capacitor Android / Core / CLI | 8.5.3 | **8.6.0** | Atualizacao coordenada nativa; CLI passa a xcode 4, retirando a cadeia uuid citada. Validar sync/build Android, camera e navegacao sem alterar Push. |
| Supabase JS | 2.117.3 | **2.118.0** | Minor separado; sem advisory retornado. Testar contratos auth/RPC/Realtime sem modifica-los. |
| Supabase SSR | 0.12.7 | **0.12.7** | Atual; nao alterar por arrasto. |
| web-push | 3.6.7 | **3.6.7** | Atual; Push preservado. |
| PGlite (dev) | 0.5.10 | **0.5.15** | Patch separado; reexecutar testes SQL isolados. |
| sharp (transitiva) | 0.35.5 | **0.35.5** | Atual; mitigacao importante do advisory de imagens. |

Fontes de versao: metadados oficiais
[Next](https://registry.npmjs.org/next),
[React](https://registry.npmjs.org/react),
[React DOM](https://registry.npmjs.org/react-dom),
[Capacitor CLI](https://registry.npmjs.org/@capacitor%2fcli),
[Supabase](https://registry.npmjs.org/@supabase%2fsupabase-js),
[PGlite](https://registry.npmjs.org/@electric-sql%2fpglite) e
[sharp](https://registry.npmjs.org/sharp). Sao snapshots da consulta, nao versoes
garantidamente mais recentes na futura data de execucao.

Sequencia recomendada: worktree/branch isolada -> Next/config -> React em par ->
Capacitor em trio -> Supabase/PGlite separados -> transitorias remanescentes
de glob/minimatch por seus consumidores compativeis -> audit/testes/typecheck/
lint/build e homologacao web/nativa antes de deploy. Nao prometer zero avisos
depois de um unico upgrade.

**Nao executar `npm audit fix --force`.** O JSON oferece inclusive ESLint
4.0.0 e eslint-config-next 0.2.4 como `fixAvailable`, downgrades incompatíveis,
nao um plano seguro. `fixAvailable: true` nao identifica versao-alvo nem assegura
que todos os avisos sejam eliminados. Nenhum override transitivo foi introduzido.

Um build de verificacao desta sprint foi interrompido **apos gerar rotas** pelo
`SecurityFatalError` de recomendacao de upgrade do Next. A recomendacao de
atualizar permanece valida mesmo quando repetir o comando permite concluir;
**repetir build nao corrige vulnerabilidade**. Nao foi feito upgrade.

## 6. Performance: evidencias e prioridades

### Metodo e limites

Build de producao local; leitura de arquivos JS em `.next/static`, manifestos
`entryJSFiles` por rota e `gzipSync` do Node no nivel padrao. Bytes gzip sao soma
de compressoes por arquivo, **nao medicao de trafego, First Load JS, cobertura,
TTI, LCP ou tempo de render autenticado**. Chunks compartilhados entram em cada
rota, mas nao devem ser somados entre rotas como trafego unico.

Nenhum analyzer/dependencia foi instalado. Nao foram consultadas imagens remotas,
traces de usuarios, tamanho de respostas reais ou profiler React em producao.
Imports/linhas de codigo apontam candidatos, nao comprovam custo CPU.

### Snapshot do bundle final

41 arquivos JS: **1.445.471 bytes** sem compressao e **445.642 bytes** na soma
gzip. O conjunto compartilhado de entradas do layout soma **325.605 bytes**
raw / **89.762 bytes** gzip, em tres chunks. Inclui runtime/framework e providers;
nao atribuir todo esse custo a um componente isolado sem sourcemap/analyzer.

| Rota | Entradas JS unicas no manifesto | Bytes raw | Soma gzip |
| --- | --- | --- | --- |
| `/restaurant/candidates` | 4 | 369.177 | 103.001 |
| `/restaurant/messages` | 4 | 351.453 | 98.695 |
| `/worker/profile` | 4 | 368.744 | 102.304 |
| `/restaurant/dashboard` | 4 | 361.569 | 100.851 |
| `/chat/{jobId}` | 4 | 354.482 | 99.497 |
| `/login` | 4 | 331.675 | 91.874 |

Maiores chunks individuais raw/gzip: 258.228/67.398, 229.627/71.926,
168.604/46.469, 112.594/39.627 e 56.702/15.676 bytes. Sao artefatos versionados
por hash, nao fontes a editar. Alguns chunks globais podem nao compor uma entrada
de rota listada: o total da pasta nao e uma pagina inteira.

### Analise

| Evidencia | Impacto | Recomendacao futura / risco |
| --- | --- | --- |
| [TalentCenter:143](../app/restaurant/candidates/talent-center.tsx#L143) pagina todo o diretorio em lotes de 100, carrega demandas/convites e assina fotos antes de filtrar no cliente. | **ALTO IMPACTO** com crescimento | Medir volume/rede e definir limites/paginacao de interface em tarefa aprovada; nao alterar RPCs ou visibilidade nesta sprint. |
| [Inbox fallback:143](../lib/restaurant-message-inbox.ts#L143) realiza quatro consultas/RPCs por contratacao elegivel, alem das consultas iniciais; lotes paralelos de 20. | **ALTO IMPACTO** quando fallback ativo e base grande | Verificar operacionalmente disponibilidade do RPC existente; medir numero de chamadas. Nao remover fallback nem aplicar migration nesta sprint. |
| [loadRestaurantMessageInbox:228](../lib/restaurant-message-inbox.ts#L228) pagina toda a caixa, inclusive para Home que exibe poucas conversas. | **ALTO IMPACTO** em caixas grandes | Medir respostas e separar contratos de resumo/lista em futura tarefa sem modificar regras; nao prometer limite seguro sem analise. |
| [MessageCenter:101](../app/restaurant/messages/message-center.tsx#L101) recarrega caixa completa a eventos de tres tabelas; provider global tambem atualiza contagens. | **MÉDIO IMPACTO**, potencial alto por volume | Profilar bursts, coalescer/refinar refresh preservando recebimento e contagens exatas; sem modificar push agora. |
| [NotificationExperience:368](../app/components/notification-experience.tsx#L368) fornece objeto de contexto novo por render; consumidores compartilham contagens/erros. | **MÉDIO IMPACTO**, candidato nao medido | Medir commits de consumidores antes de memoizar/separar contexto. Nao usar memoizacao para mascarar estado incorreto. |
| [ProfessionalVerification:35](../app/components/professional-verification.tsx#L35) registra todos os selos e resolve jobs; mesma pessoa em muitas mensagens compartilha chave, mas alteracoes de registros/refresh renovam conjunto. | **MÉDIO IMPACTO** | Preservar lotes/ref-count ja existentes; preferir userId disponivel e medir renders/requests. Sem nova fonte publica. |
| [WorkerProfileExperience](../app/components/worker-profile-experience.tsx) importa editor e overview estaticamente; [TalentCenter](../app/restaurant/candidates/talent-center.tsx) inclui drawers/filtros no mesmo modulo. | **MÉDIO IMPACTO** | Avaliar lazy loading com medicao de bundle/latencia e estados acessiveis; nao implementado. |
| [RootLayout:56](../app/layout.tsx#L56) monta providers globais tambem em rotas publicas; provider de selo nao consulta sem consumidores, mas codigo participa do shell. | **MÉDIO IMPACTO** | Medir impacto e limites de layout sem duplicar providers/canais nem alterar sessao. |
| [ProfileOverview:158](../app/components/profile-overview.tsx#L158) renova perfil/foto por foco e a cada minuto; outras telas consultam a mesma foto. | **MÉDIO IMPACTO** | Investigar deduplicacao com TTL e invalidacao apos editar/trocar conta; evitar cache que vaze identidade ou mantenha URL expirada. |
| [RestaurantDashboard:120](../app/restaurant/dashboard/page.tsx#L120) atualiza clock e operacoes a cada 30 s. | **BAIXO IMPACTO** ate medicao | Intencional para estados temporais; nao desligar polling por suposicao. Medir e isolar relogio se necessario. |
| 10 tags Next Image, todas com `unoptimized`; fotos assinadas sem dimensao de arquivo remoto conhecida. | **MÉDIO IMPACTO**, potencial alto em fotos grandes | Medir bytes/resolucao no dispositivo; planejar thumbnails/resize separado. Nao mudar Storage/policies nem confiar em proxy de imagem sem analisar privacidade. |
| [CameraCapture:77](../app/components/camera-capture.tsx#L77) preserva resolucao do video e JPEG qualidade 0,88. | **MÉDIO IMPACTO** dependente do dispositivo | Medir tamanho/resolucao antes de definir reducao; nao degradar selfie de identidade ou limites atuais. |
| Maior asset publico: icon-512 PNG 12.976 bytes; maskable 12.035 bytes. | **BAIXO IMPACTO** | Nao priorizar minificacao desses icones frente a fotos/rede de dados. |
| Imports externos em app/lib: React, Next, Supabase; web-push/node:crypto em servidor. Nao ha import cliente de web-push ou biblioteca de graficos identificado. | **BAIXO IMPACTO** sem evidencia de import excessivo adicional | Nao remover dependencias pelo nome; medir tree-shaking antes de trocar imports. |
| Compartilhamento de fotos ja usa [createSignedUrls em lote](../lib/demand-detail.ts#L96); inbox deduplica fotos por worker. | **BAIXO IMPACTO**, mecanismo existente positivo | Reutilizar, nao recriar assinatura individual por card. |

## 7. Divida tecnica

Nenhuma refatoracao de risco executada sob pretexto de consolidacao.

| Prioridade | Item e evidencia | Plano |
| --- | --- | --- |
| **IMPORTANTE**, apos correcao adicional | Advisories criticos Next corrigidos; permanece minimatch no tooling dev. | A secao 10 documenta a correcao autorizada, audit prod zerado e o bloqueio de compatibilidade restante. |
| **IMPORTANTE** | [TalentCenter](../app/restaurant/candidates/talent-center.tsx): 704 linhas, 42.354 bytes; carrega dados, filtra, gerencia relacao, aprova, convida, abre drawers/historicos. | Separar apresentacao e carregamento por contratos existentes; testes de estado antes de extrair. |
| **IMPORTANTE** | [ChatClient](../app/chat/[jobId]/chat-client.tsx): 525 linhas; layouts por papel, mensagens, timeline, operacao e leitura. | Extrair somente apresentacao comprovadamente comum; preservar recebimento/leitura e jobId. |
| **IMPORTANTE** | [RestaurantDashboard](../app/restaurant/dashboard/page.tsx): 515 linhas; varias consultas e projecoes de prioridade. | Medir e isolar projecoes puras; nao reimplementar prioridades operacionais. |
| **IMPORTANTE** | [WorkerDashboard](../app/worker/dashboard/page.tsx): 437 linhas; oportunidades, candidatura, localizacao e indicadores. | Separacao gradual com regressoes, sem alterar elegibilidade ou ganhos. |
| **IMPORTANTE** | [NotificationExperience](../app/components/notification-experience.tsx): 410 linhas, Realtime, concorrencia, contagens, preview, push e resposta. | Manter nesta sprint; testes de ordenacao/geracao existentes sao essenciais. Refatoracao dedicada se autorizada. |
| **IMPORTANTE** | [ProfileEditor](../app/components/profile-editor.tsx): 404 linhas para dois papeis; persistencia, uploads e UI juntos. | Preservar implementacao unica; extrair blocos visuais somente apos equivalencia e erros testados. |
| **IMPORTANTE** | [DemandDetail](../app/restaurant/demands/[demandId]/demand-detail.tsx): 387 linhas, 33.906 bytes; varias subvisoes/acoes operacionais. | Separar vistas, nao contratos de transacao/estado. |
| **IMPORTANTE** | [Inbox helper](../lib/restaurant-message-inbox.ts): RPC paginado + fallback com varios contratos. | Documentar condicoes do fallback e medir uso; nao remover compatibilidade por falta de log local. |
| **IMPORTANTE** | Testes de contrato textual e mocks nao equivalem a navegacao autenticada de producao. | Homologacao com contas de ambos os papeis em ambiente autorizado; nao criar conta/sessao real nesta sprint. |
| **BAIXA PRIORIDADE** | Textos opcionais vazios, vocabulario de status e repeticao de selo. | Sprint visual com baseline, acessibilidade e privacidade, sem novas regras. |
| **BAIXA PRIORIDADE** | Avisos lint em asset gerado Android, nao codigo fonte da sprint. | Decidir politica de lint de gerados em tarefa propria; nao editar build Android manualmente. |
| **BAIXA PRIORIDADE** | Owners individuais nao nomeados e varias documentacoes historicas. | Definir mantenedores por area; marcar estado atual vs auditoria anterior, sem apagar evidencias. |

## 8. TOP 10 MELHORIAS

Ordenadas combinando impacto no usuario, manutencao e risco. Nao sao autorizacao
para implementar itens pendentes ou alterar areas protegidas.

| Ordem | Melhoria | Usuario / manutencao | Risco e estado |
| --- | --- | --- | --- |
| 1 | Unica caixa oficial e compatibilidade de query/hash | Alto / alto | Baixo; **implementado** com testes. |
| 2 | Homologar perfil/mensagens autenticados e aliases em mobile/desktop | Alto / alto | Baixo; sem mutacoes operacionais, ambiente autorizado necessario. |
| 3 | Atualizacoes de seguranca confirmadas, primeiro as de menor salto e maior exposicao | Alto / alto | **Cinco advisories corrigidos apos autorizacao adicional**, sem mudanca de negocio; pendencia dev/compatibilidade na secao 10. |
| 4 | Manter mapa de URLs/owners/compatibilidade como contrato | Medio / alto | Baixo; documentacao **entregue**. |
| 5 | Medir volume do diretorio/inbox e numero de requests por refresh | Alto em escala / alto | Baixo para medir; mudanca de carregamento exige tarefa propria. |
| 6 | Evitar carregar editor/drawers nao utilizados, apos medir bundle | Medio / medio | Baixo a medio; preservar loading/foco/cancelar. |
| 7 | Coalescer consultas repetidas mantendo contagens e sessao corretas | Alto em escala / alto | Medio; nao executar sem testes de concorrencia e push intacto. |
| 8 | Medir fotos e planejar reducao de bytes sem mudar privacidade | Alto em mobile / medio | Medio; Storage nao alterado aqui. |
| 9 | Extrair apresentacao de grandes componentes por responsabilidade | Medio / alto | Medio; etapas pequenas, sem reescrever regras. |
| 10 | Reduzir fallbacks opcionais sem valor e padronizar selo/status | Medio / medio | Baixo apos aprovacao visual; **somente inventario**. |

## 9. Validacao e integridade

### Escopo de arquivos desta sprint

- Alterados: `app/restaurant/candidates/page.tsx`,
  `app/components/notification-center.tsx`, `tests/auth-http.test.mjs`,
  `README.md`, `docs/communication-qa.md`,
  `docs/consolidation-roadmap-v2.md`.
- Criados: `tests/message-navigation.test.mjs`, `docs/routes.md`,
  `docs/architecture.md`, `docs/stability-report.md`.
- Removidos: **nenhum**.
- Componentes consolidados: CandidatesPage deixa de montar inbox;
  RestaurantMessageCenter continua existente e unico na rota oficial;
  NotificationCenter altera somente seu destino de navegacao.

### Validacoes

- Suite completa final `npm test`: **217/217 passaram, zero falhas e zero
  skips**, com `EXTRACHEF_TEST_URL` apontando ao build local e SQL executado com
  PGlite isolado, nao banco remoto. A primeira execucao sem servidor tinha
  198 testes, 196 aprovados e dois HTTP condicionais ignorados; a execucao final
  habilitou esses testes e seus 19 subtestes.
- Contratos focados de navegacao/mensagens/comunicacao: **24/24 passaram**,
  incluindo snapshot/hashchange/limpeza e preservacao de candidatos normais.
- HTTP com build servido localmente: **24/24 testes/subtestes passaram**, sem
  skips, incluindo 19 caminhos protegidos, callback e tres testes de mensagens.
  Os dois testes condicionais da suite completa estao incluidos nesta execucao.
- `npm run typecheck`: aprovado apos a ultima alteracao de componente.
- `npm run lint`: aprovado, zero erros; 16 avisos preexistentes no asset gerado
  Android `native-bridge.js`, nao modificado pela sprint.
- `npm run build`: **aprovado**. Primeira execucao passou; a verificacao posterior
  gerou rotas mas foi interrompida pelo aviso de seguranca descrito na secao 5.
  Repeticao identica concluiu com sucesso, sem upgrade; o risco de dependencia
  permanece. Todas as paginas e oito APIs constam do build.
- Browser: entrada oficial, query e hash antigos chegam ao login preservando
  destino/query; reload do login funciona. Isso **nao comprova sessao autenticada
  nem continuidade de hash atraves do login existente**. Componente autenticado
  foi coberto por fixtures; homologacao real com ambos os papeis segue recomendada.
- Comparacao SHA256 contra baseline anterior a esta sprint: **95 arquivos de
  areas protegidas inalterados**, incluindo lib, APIs, supabase, public,
  autenticacao/proxy, manifest/lock e AGENTS; nenhum arquivo existente removido.
- Links relativos dos tres documentos novos verificados; `git diff --check`
  sem erros de whitespace.

Nenhuma funcionalidade removida: somente montagem paralela da mesma caixa foi
substituida por compatibilidade. Nenhuma migration criada/aplicada, tabela,
bucket, API, RPC, autenticacao, permissao, notificacao Push, regra de negocio ou
implementacao de check-in/checkout/pagamento alterada nesta sprint.
Alteracoes/migration ja existentes no worktree foram preservadas, nao atribuidas
a esta entrega. Nao houve commit, push ou deployment.

## 10. Correcao de dependencias apos autorizacao adicional

O usuario selecionou **Fix all issues**, autorizando uma etapa adicional a
restricao original de nao executar upgrades. A implementacao segura resolveu
**cinco dos seis advisories distintos**. Nao foi possivel zerar o audit completo
sem substituicoes incompativeis de dependencias de lint; isso e um bloqueio
explicito, nao uma correcao concluida de todos os avisos.

### Alteracoes executadas

| Dependencia | Antes | Depois / motivo |
| --- | --- | --- |
| Next | 16.4.0 | **16.4.5**, retira os tres advisories Next. |
| eslint-config-next | 16.4.0 | **16.4.5**, alinhado ao framework. |
| Capacitor Android/Core/CLI | 8.5.3 | **8.6.0**, atualizacao coordenada; xcode 4 retira uuid vulneravel. |
| rimraf transitivo | 6.1.3 | **6.1.4**, dentro do range do CLI, sem override. |
| glob transitivo do CLI | 13.0.6 | **14.0.3**, dependencia do rimraf corrigido. |
| minimatch transitivo do glob | 10.2.6 | **11.0.4**, dependencia compativel do novo glob. |
| sharp | 0.35.5 | **0.35.5**, mitigacao preservada. |

Comandos: `npm install` apos editar manifest; `npm update rimraf`.
Nao foi usado `--force`, override, patch de node_modules, downgrade do lint,
upgrade de React/Supabase/PGlite ou alteracao de codigo de negocio.
Arquivos adicionais alterados: somente `package.json`, `package-lock.json` e
este relatorio. Nenhum pacote novo foi adicionado diretamente ao manifest.

### Resultado mensuravel de seguranca

| Verificacao | Antes | Depois |
| --- | --- | --- |
| `npm audit --omit=dev --json` | Avisos Next/CLI/transitivas no grafo prod | **0 vulnerabilidades** |
| `npm audit --json` | 22 entradas, 1 critical / 21 moderate | **16 moderate, 0 critical, 0 high** |
| Advisories distintos | 6 | **1**, somente minimatch em ferramentas dev |

O audit de producao exclui ferramentas dev do grafo, nao comprova seguranca
absoluta nem avalia como o deploy e instalado. Em particular, manter CI/build
isolado e nao processar padroes de glob de terceiros sem limites.

### Bloqueio restante: minimatch no lint

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | [package-lock.json](../package-lock.json#L5963) | 5963; 2314 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch 3.1.5/10.2.6 em ESLint/plugins/typescript-estree, com 16 entradas por propagacao. | 10/10 na versao e inventario npm; exploracao da aplicacao nao demonstrada |

Evidencia de que nao existe substituicao segura simples nas versoes consultadas:

- Plugins React 7.37.5, import 2.32.0 e jsx-a11y 6.10.2 ainda exigem minimatch
  `^3.1.2`; eslintrc 3.3.7 exige `^3.1.5`. Todos sao releases mais recentes
  consultados; dist-tag legacy-v3 continua em 3.1.5.
- ESLint mais recente 10.14.0 e typescript-estree mais recente ainda dependem
  de minimatch 10.x; subir o major do ESLint nao elimina esse advisory.
- Comparacao real de modulos: minimatch 3 exporta funcao chamavel;
  minimatch 11 exporta objeto com funcao nomeada. Consumidores atuais chamam o
  export diretamente. Substituir globalmente por 11 resulta em
  `TypeError: modern is not a function`; nao e override seguro.
- O audit continua sugerindo downgrades ESLint 4.0.0/config-next 0.2.4.
  Nao aplicados: quebrariam compatibilidade e nao representam solucao validada.

Proxima acao: acompanhar releases corrigidos/compativeis dos consumidores ou
aprovar uma migracao dedicada de tooling com equivalencia das regras.
Nao remover lint, desabilitar regras, suprimir advisory ou criar adaptador local
somente para apresentar um audit "verde".

### Validacoes repetidas apos o upgrade

- Suite completa com HTTP habilitado e SQL isolado: **217/217 passaram, sem skips**.
- Typecheck e lint aprovados; mesmos **16 warnings** no asset Android gerado,
  zero erros. Build web aprovado sem a interrupcao de seguranca anterior.
- CLI Capacitor executa e informa 8.6.0. Doctor alerta sobre script de instalacao
  de unrs-resolver nao aprovado e ausencia de index.html nos assets Android.
  O projeto usa `server.url` remoto; nao foi criado asset nem aprovado script
  arbitrariamente para silenciar diagnosticos.
- Build Android `:app:assembleDebug`: **aprovado**, 68 tarefas, usando JDK 21
  ja instalado e variaveis JAVA_HOME/ANDROID_HOME apenas no processo; sem
  instalacao de SDK/JDK ou mudanca permanente do ambiente. Gradle sinaliza
  deprecacoes para futura versao 10, nao falha do build atual.
  Nenhum `cap sync/copy`, publicacao ou alteracao de configuracao de
  Push/autenticacao foi executado.
- Baseline independente desta etapa confirma codigo app/lib/APIs/schema/
  autenticacao e configuracoes inalterados; somente manifest/lock e documentacao.
- Sem commit, push ou deploy. Testes automatizados nao substituem homologacao
  autenticada em mobile nem teste de camera/notificacao em dispositivo real.

### Bundle apos Next 16.4.5

Mesmo metodo da secao 6: 41 chunks, **1.448.208 bytes raw / 445.462 bytes gzip
somados**. Layout compartilhado: 326.126/89.775 bytes. Nao e medicao de trafego.

| Rota | Raw | Soma gzip |
| --- | --- | --- |
| candidates | 369.740 | 103.010 |
| messages | 352.029 | 98.704 |
| worker/profile | 369.359 | 102.316 |
| restaurant/dashboard | 362.158 | 100.862 |
| chat | 355.045 | 99.507 |
| login | 332.199 | 91.884 |

Variacao total em relacao ao snapshot anterior: +2.737 bytes raw e -180 bytes
gzip somados. Isso nao comprova ganho perceptivel de performance; a motivacao
do upgrade foi seguranca.
