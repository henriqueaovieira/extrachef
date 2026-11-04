# ExtraChef V2: mapa arquitetural e roadmap de consolidacao

> Este documento preserva o mapa anterior a implementacao. A sprint de perfil
> unico posterior foi implementada conforme as decisoes do usuario: aba Perfil,
> edicao na mesma rota e `/profile` generico preservado para restaurantes.
> Consulte [Perfil unico do profissional](../README.md#perfil-unico-do-profissional)
> para o estado atual e a compatibilidade das URLs. As demais sprints abaixo
> continuam sendo recomendacoes, nao implementacoes.

> Atualizacao posterior: a entrada unica de mensagens foi implementada na
> sprint de estabilidade. `/restaurant/messages` e oficial; query/hash antigos
> em candidates apenas encaminham, sem montar outra caixa. Consulte
> [rotas atuais](./routes.md) e [relatorio de estabilidade](./stability-report.md).
> Os mapas historicos abaixo nao representam mais a navegacao vigente de mensagens.

## Entrega posterior: sprint exclusiva de perfil unico

### Decisoes confirmadas e composicao

- A aba profissional passou de Mais para **Perfil**.
- `/worker/profile` monta **uma** composicao, `WorkerProfileExperience`, que
  seleciona `ProfileOverview` ou `ProfileEditor` pelo parametro `edit=1`.
  Nao ha nova implementacao de formulario, verificacao ou reputacao.
- Editar/Completar perfil e preencher requisitos abrem o editor existente na
  mesma rota; Cancelar retorna a leitura. Salvar permanece no formulario com
  a confirmacao existente. Voltar a leitura remonta a consulta do perfil.
- `ProfileVerification` permanece no overview; somente seu link de completar
  requisitos foi atualizado. Selfie, submissao, revisao e contratos permanecem.
- Confianca Operacional conserva dados, RPC e calculo. O contador de check-ins
  existente recebe o rotulo **Presença (check-ins)**, sem novo indicador calculado.
- `MoreNavigationLinks` extrai a apresentacao dos links existentes e e reutilizado
  no perfil. Historico, notificacoes, privacidade e sair nao foram perdidos.

### Compatibilidade executada

| Entrada | Destino/comportamento atual |
| --- | --- |
| `/profile`, profissional | `/worker/profile`, depois da leitura autenticada do papel ja existente. |
| `/profile`, restaurante | Mantem a tela generica atual, conforme decisao do usuario. |
| `/worker/profile/details` | `/worker/profile`; query e hash preservados. |
| `/worker/profile/edit` | `/worker/profile?edit=1`; abre o editor existente e preserva demais parametros/hash. |
| `#verification` e `#confidence` | Permanecem na pagina canonica; posicionamento inicial ocorre apos carregar os dados. |

As paginas legadas continuam presentes. O redirecionamento e **cliente**, por
`router.replace`, sem adicionar uma URL legada extra ao historico. Existe link
de continuidade durante o encaminhamento. Nao foi alterado o proxy, callback,
sanitizacao de retorno ou SessionGuard; o usuario sem sessao continua passando
primeiro pelo fluxo de login existente.

### Arquivos desta sprint

Arquivos novos:

- [worker-profile-experience.tsx](../app/components/worker-profile-experience.tsx)
- [worker-profile-redirect.tsx](../app/components/worker-profile-redirect.tsx)
- [worker-profile.test.mjs](../tests/worker-profile.test.mjs)

Arquivos existentes alterados, integrando e preservando mudancas preexistentes:

- [Pagina canonica](../app/worker/profile/page.tsx)
- [Compatibilidade de details](../app/worker/profile/details/page.tsx)
- [Compatibilidade de edit](../app/worker/profile/edit/page.tsx)
- [Perfil generico](../app/profile/page.tsx)
- [ProfileOverview](../app/components/profile-overview.tsx)
- [ProfileEditor](../app/components/profile-editor.tsx)
- [ProfileVerification](../app/components/profile-verification.tsx)
- [OperationalReputationView](../app/components/operational-reputation.tsx)
- [MoreNavigation](../app/components/more-navigation.tsx)
- [MobileBottomNav](../app/components/mobile-bottom-nav.tsx)
- [DashboardAvatar](../app/components/dashboard-identity.tsx)
- [PrivacySettings](../app/components/privacy-settings.tsx)
- [WorkerDashboard](../app/worker/dashboard/page.tsx)
- [Testes HTTP](../tests/auth-http.test.mjs)
- [Testes de comunicacao](../tests/communication.test.mjs)
- [Testes de navegacao/historico](../tests/restaurant-history.test.mjs)
- [Testes UI/editor](../tests/ui.test.mjs)
- [README](../README.md#perfil-unico-do-profissional)
- Este documento.

Nenhum arquivo foi removido por esta sprint.

### Validacao da implementacao

- Suite completa com PostgreSQL isolado (`PGLITE_MODULE`): 196 testes,
  194 aprovados e dois HTTP inicialmente ignorados; nenhuma falha.
- Depois, os dois casos HTTP foram executados sobre o build de producao local,
  junto de UI e novos testes do perfil: **42 testes/subtestes aprovados**, sem
  falhas ou ignorados; inclui quinze caminhos protegidos e callback sem codigo.
- Testes de componentes cobrem selecao unica leitura/edicao, redirecionamento
  com query/hash/intencao de editar, identidade, verificacao, reputacao,
  atalhos preservados inclusive em perfil ausente/erro, restaurante sem
  redirecionamento, gravacao do editor e preservacao de legados/uploads.
- `npm run typecheck`: aprovado apos remover o JSX profissional que passou
  a ser inalcançavel na pagina generica.
- `npm run lint`: sem erros; dezesseis avisos preexistentes em asset Android
  gerado, sem autofix.
- `npm run build`: aprovado na segunda execucao. O primeiro compilou, mas o
  Next.js interrompeu para informar vulnerabilidade conhecida na versao
  instalada e orientou repetir. **Recomendada atualizacao de seguranca em
  tarefa separada**; nenhuma dependencia foi alterada aqui.
- Navegador real local: cinco entradas canonicas/legadas sem sessao e reload
  validaram tela de login e preservacao do caminho/query de retorno.
  Nao houve login com usuario real; estados autenticados foram verificados por
  testes de componentes com fixtures, nao por homologacao em producao.
- Servidor temporario confirmou `/login` HTTP 200 e foi encerrado ao concluir.
- Comparacao SHA256 com baseline no inicio desta sprint confirmou que app/api,
  lib, supabase, public, proxy, manifests e AGENTS.md permaneceram intactos.
  Nenhuma migration, RPC, tabela, bucket, regra de autenticacao/permissao,
  notificacao, check-in, checkout ou pagamento foi alterado.
- `git diff --check` aprovado. Nao houve commit, push ou deployment.

### Ganho e proxima etapa

O profissional deixa de escolher entre menu/perfil generico/detalhes/editor
em rotas separadas: leitura e edicao passam pela mesma entrada, com uma unica
implementacao de cada responsabilidade e os acessos de conta preservados.

Remocao definitiva **nao executada e nao agendada**. Antes dela:

1. Homologar acesso autenticado em mobile/desktop com contas de ambos os papeis.
2. Confirmar deployment/commit e monitorar uso das URLs legadas e retornos de login.
3. Inventariar favoritos, notificacoes/links antigos e consumidores externos.
4. Manter compatibilidade de query/hash e testar historico/refresh antes de
   eventualmente substituir paginas legadas por redirecionamentos permanentes.
5. Nao remover `/profile` enquanto servir restaurantes ou possuir consumidores;
   qualquer mudanca desse contrato exige nova decisao.

---

## 1. Escopo, metodo e estado atual

Auditoria estatica do worktree local sobre o commit
`f64c18810f7b48850db7ae77c687c365a23576c2`, incluindo alteracoes
preexistentes ainda nao commitadas. As conclusoes descrevem esse worktree,
**nao comprovam o que esta publicado na Vercel**.

Entrega exclusivamente documental: este arquivo e
[legacy-fields.md](./legacy-fields.md). Nao houve refatoracao, remocao de rota,
componente ou API, nem criacao de funcionalidade nesta epica. A
[limpeza da sprint anterior](./consolidation-report.md) e apenas antecedente;
suas exclusoes nao foram repetidas nem ampliadas.

Foram inspecionados entradas do App Router, imports, links, parametros, hashes,
menus, consultas, componentes, helpers, testes, SQL historico e documentacao.
Referencias abaixo apontam aos arquivos locais e linhas desta auditoria.
Ausencia de link interno nao prova ausencia de acesso: favoritos, deep links,
notificacoes antigas e consumidores externos exigem levantamento separado.
Nao foram consultados logs de navegacao, banco remoto, usuarios ou objetos do
Storage. "Usada" significa consumidor confirmado no codigo, nao medicao de trafego.

### Arquitetura existente

- Next.js App Router, React e TypeScript; entradas por papel em `/worker` e
  `/restaurant`, e rotas compartilhadas de conta, chat e operacoes.
- Paginas finas montam componentes de perfil, talentos, equipe e mensagens.
  Outras paginas, como dashboards e perfil generico, carregam seus dados.
- Supabase fornece autenticacao, consultas, RPCs, Realtime e Storage. Helpers em
  `lib` montam visoes operacionais; SQL mantem contratos e regras de negocio.
- [Proxy](../proxy.ts),
  [regras de rotas](../lib/auth/routes.ts) e
  [SessionGuard](../app/components/session-guard.tsx) protegem entradas em
  camadas distintas. Sem alteracao de seguranca/permissoes.
- [NotificationExperience](../app/components/notification-experience.tsx)
  coordena comunicacao global; a lista de avisos e as caixas de mensagens sao
  superficies diferentes. Push/webhooks/service worker permanecem intactos.
- [OperationalPanel](../app/components/operational-panel.tsx) ja e compartilhado
  por check-in, checkout e pagamento. Rotas diferentes nao implicam implementacoes
  descartaveis.
- [ProfessionalVerificationProvider](../app/components/professional-verification.tsx),
  montado no [layout](../app/layout.tsx), centraliza a leitura publica do selo.
  Verificacao privada e apresentacao continuam com responsabilidades separadas.

## 2. Relatorio de perfil unico

### 2.1 Rotas, publico, componentes e fluxos

| Rota | Quem acessa e para que | Implementacao | Consumidores confirmados | Autenticacao e classificacao |
| --- | --- | --- | --- | --- |
| `/profile` | Conta autenticada de ambos os papeis; identidade resumida, cidade, reputacao profissional e saida. | [ProfilePage](../app/profile/page.tsx#L20), DashboardLogo, MobileBottomNav, LogoutButton, ProfessionalVerification e OperationalReputationView. Consulta `public_user_directory`. | Nenhum link de menu ou card para a URL exata identificado na aplicacao atual. A rota e aceita pela protecao e pelo retorno autenticado. Entrada direta continua possivel. | Protegida por `/profile`; nao exclusiva de worker. **CONSOLIDAR FUTURAMENTE**, nao declarar abandonada. |
| `/worker/profile` | Profissional acessa o menu **Mais**, nao a ficha do perfil. | [Pagina](../app/worker/profile/page.tsx) monta [MoreNavigation](../app/components/more-navigation.tsx#L15). | Bottom nav, retorno de detalhes e retorno de privacidade. | Prefixo `/worker`, papel worker. **MANTER** agora; consolidar depois de decidir destino de Mais. |
| `/worker/profile/details` | Profissional consulta identidade, contatos permitidos, especialidades, verificacao e confianca. | [Pagina](../app/worker/profile/details/page.tsx) monta [ProfileOverview](../app/components/profile-overview.tsx) com `role="worker"`; ProfileVerification, VerifiedProfileBadge, OperationalReputationView, controles de conta/push. | Avatar, menu Meu Perfil, atalhos de verificacao/confianca, cancelar edicao. | Prefixo `/worker`, papel worker. **MANTER**; futura compatibilidade com entrada canonica. |
| `/worker/profile/edit` | Profissional edita dados e foto; preenche requisitos de identidade. | [Pagina](../app/worker/profile/edit/page.tsx) monta [ProfileEditor](../app/components/profile-editor.tsx), campos compartilhados e uploads ativos de imagem. | Editar/completar perfil, CTA do dashboard e requisito da verificacao. | Prefixo `/worker`, papel worker. **MANTER**; edicao e etapa legitima, nao duplicata da leitura. |

Existe **uma implementacao de ProfileOverview**, compartilhada tambem por
`/restaurant/profile`. Existem tres paginas sob a arvore `/worker/profile`
(raiz, detalhes e edicao), cada uma com responsabilidade distinta; nao tres
copias da mesma pagina. `/profile` e outra implementacao de visualizacao.

### 2.2 Todas as entradas e saidas internas identificadas

| Origem | Destino | Contexto/evidencia |
| --- | --- | --- |
| Bottom nav worker | `/worker/profile` | [MobileBottomNav:22](../app/components/mobile-bottom-nav.tsx#L22), label Mais. |
| Avatar compartilhado, quando worker | `/worker/profile/details` | [DashboardAvatar:27](../app/components/dashboard-identity.tsx#L27); utilizado nos dashboards e telas com identidade compartilhada. |
| Mais / Meu Perfil | `/worker/profile/details` | [MoreNavigation:16](../app/components/more-navigation.tsx#L16). |
| Mais / Perfil Verificado | `/worker/profile/details#verification` | [MoreNavigation:17](../app/components/more-navigation.tsx#L17). |
| Mais / Confianca | `/worker/profile/details#confidence` | [MoreNavigation:19](../app/components/more-navigation.tsx#L19). |
| Voltar de detalhes | `/worker/profile` | [ProfileOverview:179](../app/components/profile-overview.tsx#L179), volta a Mais. |
| Voltar de privacidade, quando worker | `/worker/profile` | [PrivacySettings:116](../app/components/privacy-settings.tsx#L116). |
| Editar / Completar perfil | `/worker/profile/edit` | [ProfileOverview:167](../app/components/profile-overview.tsx#L167), CTAs nas linhas 194 e 208. |
| Dashboard sem oportunidades | `/worker/profile/edit` | [WorkerDashboard:364](../app/worker/dashboard/page.tsx#L364), Revisar meu perfil. |
| Verificacao sem requisitos | `/worker/profile/edit` | [ProfileVerification:85](../app/components/profile-verification.tsx#L85), preencher CPF, RG e telefone. |
| Cancelar edicao | `/worker/profile/details` | [ProfileEditor:327](../app/components/profile-editor.tsx#L327). |
| Edicao / solicitar verificacao | `/worker/profile/details#verification` | [ProfileEditor:364](../app/components/profile-editor.tsx#L364). |
| Perfil / preferencias | `/settings/privacy` | [ProfileOverview:237](../app/components/profile-overview.tsx#L237). |
| Perfil / sair ou recuperar sessao | `/login` | LogoutButton e mensagens de sessao; comportamento compartilhado preservado. |

Salvar edicao confirma a gravacao no proprio editor; nao ha redirecionamento
automatico entre essas quatro rotas. Nenhuma delas redireciona hoje para uma
rota canonica de perfil.

### 2.3 Autenticacao, links externos e redirecionamentos

- [isProtectedPath/canAccessPath](../lib/auth/routes.ts#L3) reconhecem `/profile`
  e `/worker`; o segundo bloqueia o papel contrario em rotas especificas.
- O proxy envia usuario sem sessao a login com retorno; SessionGuard trata
  expiracao e papel no cliente. Um restaurante nao deve passar a poder acessar
  `/worker/profile` por uma consolidacao de `/profile`.
- [sanitizeRedirect](../lib/auth/routes.ts#L28) preserva caminho, query e hash
  validos e autorizados. Login/cadastro e
  [callback de autenticacao](../app/auth/callback/route.ts#L35) podem devolver
  o usuario a um perfil, mesmo sem link de menu.
- Sem retorno valido, o destino e `/{role}/dashboard`, nao perfil.
  Recuperacao de senha tem seu proprio destino e nao deve ser incorporada ao perfil.
- Nao foi identificado um produtor externo ativo obrigatorio dessas URLs.
  Tambem nao ha evidencias para excluir bookmarks, compartilhamentos ou
  deployments antigos. Dependencia externa: **desconhecida, preservar compatibilidade**.

### 2.4 Recomendacao para `/worker/profile`

Viavel como experiencia canonica futura, mas nao por simples exclusao/renomeacao:

1. Definir destino das funcoes do atual Mais: historico, avisos, privacidade e sair.
2. Tornar a raiz ponto de leitura profissional, preservando identidade, telefone,
   especialidades, verificacao e confianca, sem reintroduzir os legados.
3. Preservar `/worker/profile/edit` como subfluxo; nao fundir formulario com leitura
   sem decisao de UX.
4. Manter compatibilidade de `/worker/profile/details`, inclusive `#verification`
   e `#confidence`. Hash nao chega ao servidor: um eventual redirecionamento
   deve ser validado no navegador, nao apenas em teste HTTP.
5. Tratar `/profile` por papel; preservar a experiencia de restaurante.
6. Somente depois atualizar menus, avatares, cancelamentos, retorno de privacidade
   e login; validar reload, voltar, acesso direto e sessao expirada.

**Nada desta recomendacao foi implementado.**

## 3. Relatorio de mensagens unicas

### 3.1 Entradas, links e parametros

| Entrada/consumidor | Comportamento e evidencia |
| --- | --- |
| `/restaurant/messages` | [Pagina propria](../app/restaurant/messages/page.tsx) monta RestaurantMessageCenter. Rota principal da navegacao. |
| `/restaurant/candidates?view=messages` | [CandidatesPage:9](../app/restaurant/candidates/page.tsx#L9) monta o mesmo componente; sem esse valor monta TalentCenter. `demand` e entregue a TalentCenter, nao ao centro de mensagens. |
| Bottom nav / Mensagens | [MobileBottomNav:15](../app/components/mobile-bottom-nav.tsx#L15) aponta a rota propria. A selecao ativa tambem admite candidates + `activeItem="Mensagens"`. |
| Voltar do chat, restaurante | [ChatClient:345](../app/chat/[jobId]/chat-client.tsx#L345) aponta a `/restaurant/messages`. |
| Notificacoes / Mensagens | [NotificationCenter:196](../app/components/notification-center.tsx#L196) ainda aponta a `/restaurant/candidates#chats`, **nao** a `?view=messages`. |
| Avisos persistidos/SQL historico | [Deep links:70 e 89](../supabase/migrations/20261014060000_notification_deep_links.sql#L70) e [entrega:215 e 240](../supabase/migrations/20261015000000_notification_delivery_and_preferences.sql#L215) registram `/restaurant/candidates#chats`. Sao evidencia de contrato historico, nao prova de quais funcoes estao aplicadas/ativas remotamente. |
| Dashboard / conversas recentes e acoes | [RestaurantDashboard](../app/restaurant/dashboard/page.tsx#L483) abre `/chat/{jobId}`, sem passar pela caixa de entrada. |
| Lista de mensagens | [RestaurantMessageCenter:165](../app/restaurant/messages/message-center.tsx#L165) abre `/chat/{jobId}`; voltar leva a Home, vazio permite Ver Operacoes. |
| Equipe, detalhes e painel operacional | Abrem o chat do job contratado; continuam necessarios independentemente da URL da caixa de entrada. |
| Aviso flutuante / resposta rapida | [NotificationExperience:375 e 399](../app/components/notification-experience.tsx#L375) abre o chat diretamente e tambem responde sem navegar. Nao e duplicata removivel da caixa. |
| Aviso individual / push | O destino vem de `notification.url` ou do payload; nao se pode inferir ausencia de uso por falta de um literal JSX. |
| Documentacao | [README](../README.md#L134) descreve a central `/restaurant/messages`; [QA de comunicacao](./communication-qa.md) documenta as superficies compartilhadas. |

Nao foi encontrado produtor literal ativo de `view=messages` em app/lib/public
ou SQL; existe o consumidor na pagina de candidatos e referencia documental.
Isso nao autoriza remover a entrada antiga. Nao ha `id="chats"` correspondente
na experiencia atual de talentos: o atalho com hash nao aciona o switch de
mensagens e merece correcao em sprint futura, nao nesta auditoria.

### 3.2 Componentes e dependencias

[RestaurantMessageCenter](../app/restaurant/messages/message-center.tsx#L52)
usa o mesmo estado de busca, erros, retry e lista nas duas entradas. Compartilha:

- [loadRestaurantMessageInbox](../lib/restaurant-message-inbox.ts), contexto
  operacional, mensagens/nao lidas e ordenacao;
- [signDemandPhotos](../lib/demand-detail.ts), fotos profissionais assinadas;
- ProfessionalVerification, DashboardLogo, MobileBottomNav e primitivas UI;
- autenticacao Supabase e Realtime de `messages`, `operational_assignments`
  e `applications` (linhas 101 a 123 do componente);
- selecao ativa Mensagens na navegacao; abertura do chat por `job_id`;
- provider global de comunicacao para badges/avisos, sem substituir sua logica.

Ambas as rotas sao autenticadas e exclusivas do restaurante. A caixa de entrada
nao cria contratacao: conversa depende do contexto operacional ja existente.

### 3.3 E possivel consolidar sem impacto funcional?

**Sim como arquitetura de interface; impacto zero ainda nao esta comprovado.**
O componente ja e unico. Falta consolidar **enderecamento e compatibilidade**:

1. Manter a URL canonica `/restaurant/messages`.
2. Preservar a entrada antiga por compatibilidade, sem consumir `demand`/queries
   de talentos como se fossem parametros de mensagens.
3. Tratar separadamente `/restaurant/candidates#chats`: o hash e resolvido no
   cliente e e contrato historico de notificacoes. Uma regra apenas no servidor
   nao distingue essa URL de candidatos normais.
4. Inventariar avisos antigos/links externos sem modificar push, SQL ou banco
   nesta epica. A solucao futura precisa respeitar os limites de cada sprint.
5. Testar login com retorno, sessao expirada, papel, item ativo, busca, voltar,
   chat, nao lidas e Realtime.

Nenhum redirecionamento, destino de notificacao ou parametro foi alterado.

## 4. Relatorio de navegacao

### 4.1 Menus principais e secundarios

Fontes completas:
[MobileBottomNav](../app/components/mobile-bottom-nav.tsx#L9),
[MoreNavigation](../app/components/more-navigation.tsx#L8),
[DashboardLogo/Avatar](../app/components/dashboard-identity.tsx).

| Funcionalidade | Rota principal | Rotas secundarias / multiplos acessos | Redundancia ou sobreposicao |
| --- | --- | --- | --- |
| Home restaurante | `/restaurant/dashboard` | Logo por papel, retornos de mensagens/operacoes/avaliacoes. | Repeticao de acesso intencional. |
| Home profissional | `/worker/dashboard` | Logo, voltar de candidaturas/avisos, Explorar vagas. | Intencional. |
| Operacoes restaurante | `/restaurant/demands` | Home, cards, vazios, links de mensagens; `/restaurant/demands/{id}`. | Lista geral e resumo contextual, nao duplicatas exatas. |
| Criar operacao | `/restaurant/dashboard/jobs/create` | Home, lista, CTA vazio de talentos. | Caminho unico com varios CTAs; manter. |
| Talentos / candidatos | `/restaurant/candidates` | `/restaurant/demands/{id}?view=talents`, `?view=candidates`, cards/Home, Equipe vazia. | Duas superficies por contexto; consolidar contratos/apresentacao futuramente. |
| Perfil visto pelo restaurante | Drawer em Talentos | `/restaurant/demands/{id}?view=profile&person={workerId}`, foto/card, rede e chat. | Identidade/reputacao em formatos diferentes; nunca confundir com perfil privado do proprio worker. |
| Equipe | `/restaurant/team` | Detalhes da demanda, `#hired-heading`, `#team-heading` produzido pelo card. | Centros globais e locais; ambas as ancoras existem: `#team-heading` envolve candidatos/equipe, enquanto `#hired-heading` aponta diretamente aos contratados. Preservar os dois contratos. |
| Mensagens restaurante | `/restaurant/messages` | Query legada, hash legado, dashboard, chat e avisos flutuantes. | Fragmentacao de destinos; ver secao 3. |
| Mais restaurante | `/restaurant/more` | Retornos de perfil, historico, avisos e privacidade. | Agrupador ativo. |
| Perfil restaurante | `/restaurant/profile` | Avatar, Mais, `/restaurant/profile/edit`, `/profile` generico. | Perfil especifico versus generico; preservar diferenca de papel. |
| Historico restaurante | `/restaurant/history` | Mais; historico contextual da operacao e do talento. | Rotas/dados com escopos diferentes, nao excluir automaticamente. |
| Candidaturas profissional | `/worker/applications` | Bottom nav, retornos de operacoes/avaliacoes, dashboard. | Hub de operacoes do worker, manter. |
| Convites profissional | `/worker/invitations` | Link em candidaturas, retorno a candidaturas. | Aceitar/recusar nao e o mesmo que candidatar; manter. |
| Mensagens profissional | `/worker/messages` | Bottom nav, avisos, links de chat nas candidaturas e notificacoes. | Papel/dados diferentes da caixa do restaurante; manter separacao. |
| Mais / perfil profissional | `/worker/profile` hoje | Detalhes, edicao, avatar, generico `/profile`. | Conflito semantico entre URL "profile" e menu Mais; sprint 1. |
| Perfil Verificado | `/worker/profile/details#verification` | Mais, editor, cabecalho do perfil, indicacoes em talentos/equipe/chat. | Fluxo de solicitar versus selo de consulta; responsabilidades distintas. |
| Confianca profissional | `/worker/profile/details#confidence` | Mais, dashboard, perfil generico, visoes de talento/candidato. | Resumo versus detalhes; padronizar apresentacao sem alterar calculo. |
| Historico profissional | `/worker/dashboard#historico` | Mais, candidaturas e indicadores do dashboard. | Contextos semelhantes, nao rotas identicas. |
| Notificacoes | `/notifications` | Sinos compartilhados, Mais de ambos os papeis; URLs dinamicas nos avisos. | Acessos multiplos intencionais; padronizar retorno por papel. |
| Privacidade / preferencias | `/settings/privacy` | Mais, perfil detalhado, paginas legais. | Entrada compartilhada com retorno por papel. |
| Operacao contratada | `/checkin/{jobId}`, `/payment/{jobId}`, `/checkout/{jobId}` | Candidaturas, equipe, chat, detalhes, acao da Home. | URLs sao contratos; painel compartilhado nao autoriza eliminar etapas. |
| Avaliacao | `/reviews/{jobId}` | Homes, criar operacao bloqueada por avaliacao, equipe, candidaturas, painel e detalhes. | Varios acessos para mesma obrigacao; manter regras. |
| Conta / acesso | `/login`, `/register`, `/auth/callback`, `/settings/password` | Retornos protegidos, recuperacao, logout. | Fluxos relacionados, mas nao intercambiaveis. |
| Legal / dados | `/privacy`, `/terms`, `/settings/privacy` | Cadastro, verificacao, AccountRights e paginas legais cruzadas. | Textos legais e controles autenticados sao distintos. |

### 4.2 Cards, menus internos e acoes rapidas

- [DemandCard/DemandActions](../app/components/demand-card.tsx#L37):
  card/titulo/Ver Detalhes abrem a mesma demanda; menu edita/duplica por
  `?action=edit|duplicate`, e possui compartilhar/cancelar/arquivar conforme estado.
  Varias areas clicaveis nao sao varias regras de negocio.
- [DemandDetail](../app/restaurant/demands/[demandId]/demand-detail.tsx#L189):
  proxima acao contextual, candidatos, talentos e perfil por query; equipe,
  chat/check-in/payment/checkout/reserva por hash; atalhos por contratacao;
  abrir rota usa link externo de mapas. `view=profile` **nao** e legado de mensagens.
- [TalentCenter](../app/restaurant/candidates/talent-center.tsx#L434):
  foto/Ver perfil abrem drawer local, filtros/tabs e selecao de operacao mudam
  estado; favorito/interesse, convite e aprovacao sao acoes, nao novas rotas.
  Confirmacao de aprovacao tem responsabilidade operacional: manter.
- [TeamCenter](../app/restaurant/team/team-center.tsx#L113):
  card abre drawer; proxima acao navega para etapa operacional ou avaliacao;
  copiar codigo e acao local, nao navegacao duplicada.
- [RestaurantDashboard](../app/restaurant/dashboard/page.tsx#L393):
  pendencias, analisar candidatos, conversas recentes, operacoes agendadas
  e criar operacao; CTAs refletem a urgencia do estado.
- [WorkerDashboard](../app/worker/dashboard/page.tsx#L305):
  avaliar, candidatar, revisar perfil, atualizar/localizar oportunidades;
  candidatura e acao operacional, nao pagina redundante.
- [WorkerApplications](../app/worker/applications/page.tsx#L148):
  convites, avaliacoes, proxima etapa e conversar sob Orientacoes.
- [ChatClient](../app/chat/[jobId]/chat-client.tsx#L414):
  Ver Perfil no contexto da demanda e Ver Operacao; voltar por papel.
- [NotificationCenter](../app/components/notification-center.tsx#L196):
  filtros/leitura/exclusao locais; Abrir segue URL persistida.
- [NotificationExperience](../app/components/notification-experience.tsx#L375):
  toast e janela flutuante abrem chat; resposta rapida/leitura sem navegacao.
- [AccountRights](../app/components/account-rights.tsx):
  exportar/excluir conta e links legais nao sao paginas de perfil duplicadas.

**Decisao:** primeiro centralizar o mapa de destinos e preservar contratos;
somente depois avaliar extracao de mecanismos repetidos. Nao substituir todos
os atalhos por um menu unico, pois acesso contextual agrega valor.

## 5. Inventario de legados

Inventario completo, origem, uso tecnico, preservacao e status:
[LEGACY_FIELDS](./legacy-fields.md).

| Campo | Classificacao nesta epica |
| --- | --- |
| `worker_profiles.whatsapp` | LEGACY / PRESERVADO / SEM INTERFACE |
| `worker_profiles.resume_pdf_path` | LEGACY / PRESERVADO / SEM INTERFACE |
| `worker_profiles.certificates` | LEGACY / PRESERVADO / SEM INTERFACE |

Nao sao dependencias de identidade validada ou de confianca operacional.
Nao remover dados/arquivos, nao mudar schema. A exportacao de dados pessoais
nao equivale a uma interface profissional de curriculo/certificados.

## 6. Inventario de duplicacoes e complexidade

**REMOVER AGORA:** nenhum item novo autorizado ou comprovado como removivel
nesta epica. Os tres componentes sem consumidores e o score frontend morto
ja foram tratados na sprint anterior; nao ha nova exclusao.

| Item e evidencia | Responsabilidade sobreposta / oportunidade | Classificacao |
| --- | --- | --- |
| [ProfilePage](../app/profile/page.tsx) e [ProfileOverview](../app/components/profile-overview.tsx) | Identidade/cidade/reputacao em paginas diferentes. Unificar experiencia por papel e preservar links antigos. | **CONSOLIDAR FUTURAMENTE** |
| Raiz worker/profile, details e edit | Menu, leitura e escrita sao diferentes; consolidar entrada, nao apagar formulario por semelhanca de URL. | **CONSOLIDAR FUTURAMENTE** |
| [CandidatesPage](../app/restaurant/candidates/page.tsx) e [MessagesPage](../app/restaurant/messages/page.tsx) | Duas entradas do mesmo centro de mensagens, com hash historico adicional. | **CONSOLIDAR FUTURAMENTE** |
| [TalentCenter](../app/restaurant/candidates/talent-center.tsx), [DemandTalentNetwork](../app/components/demand-talent-network.tsx) e [DemandPerson](../app/components/demand-person.tsx) | Fotos, identidade, experiencia, reputacao, relacionamento e convites em contextos diferentes. Compartilhar apresentacao/contratos quando equivalentes, preservar selecao de demanda e autorizacao. | **CONSOLIDAR FUTURAMENTE** |
| Perfil de talento em drawer e perfil via demanda | Detalhes diferentes para a mesma pessoa; contratos de privacidade e disponibilidade nao sao necessariamente iguais. | **CONSOLIDAR FUTURAMENTE** |
| [TeamCenter](../app/restaurant/team/team-center.tsx) e contratados em [DemandDetail](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Acompanham contratacao global versus por demanda; possivel resumo comum, sem eliminar centros distintos. | **CONSOLIDAR FUTURAMENTE** |
| Foto do proprio usuario em dashboard, candidaturas, mensagens, editor e overview | Consultas, assinatura de URL, fallback e lifecycle semelhantes. Extrair apenas apos mapear renovacao/erros/autorizacao. | **CONSOLIDAR FUTURAMENTE** |
| Labels/ordem de estados em [operations](../lib/operations.ts#L55), [chat](../app/chat/[jobId]/chat-client.tsx#L65), [inbox](../lib/restaurant-message-inbox.ts#L69) e [team](../lib/restaurant-team.ts) | Varias projecoes textuais de fases operacionais. Padronizar vocabulario de interface; nao substituir RPCs/regras por uma enum simplificada. | **CONSOLIDAR FUTURAMENTE** |
| Formularios de [criacao](../app/restaurant/dashboard/jobs/create/page.tsx) e [edicao/duplicacao](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Campos semelhantes, mas criacao e alteracao possuem contratos e restricoes diferentes. Avaliar campos compartilhados, nao unificar transacoes. | **CONSOLIDAR FUTURAMENTE** |
| Links de perfil/mensagens repetidos em menus e retornos | Destinos divergentes geram complexidade; criar convencao de destinos em sprint futura, sem abstrair atalhos locais desnecessariamente. | **CONSOLIDAR FUTURAMENTE** |
| Numerosos fallbacks de campos opcionais | Repetem ausencia sem acao; secao 7 identifica candidatos a ocultacao visual futura. | **CONSOLIDAR FUTURAMENTE** |
| [NotificationCenter](../app/components/notification-center.tsx) versus [NotificationExperience](../app/components/notification-experience.tsx) | Historico de avisos versus coordenacao global/Realtime/resposta rapida. Nao sao substitutos. | **MANTER** |
| MobileBottomNav e MoreNavigation | Navegacao primaria e secundaria. Compartilhamento atual por papel e valido. | **MANTER** |
| [ProfileVerification](../app/components/profile-verification.tsx), [ProfessionalVerification](../app/components/professional-verification.tsx), [VerifiedProfileBadge](../app/components/verified-profile-badge.tsx) | Solicitar identidade privada, consultar sinal publico e renderizar selo acessivel. Unificar semantica, nao fundir dados privados/publicos. | **MANTER** |
| Proxy e SessionGuard | Protecao servidor e reacao a sessao no cliente; sobreposicao intencional. | **MANTER** |
| Wrappers checkin/checkout/payment | Montam o mesmo OperationalPanel, mas mantem URLs e contratos operacionais. | **MANTER** |
| Confianca operacional / selo de identidade | Historico de trabalho versus validacao de identidade. Nao sao a mesma reputacao e nao devem virar um unico score. | **MANTER** |

### Contratos preservados que nao devem virar "limpeza automatica"

- `jobLocationValues`, `eventLocationValues` e `locationFromEvent`, em
  [work-location](../lib/work-location.ts#L54), possuem consumidores identificados
  apenas em [testes de geolocalizacao](../tests/geolocation.test.mjs#L80).
- `nextDemand`, em [restaurant-home](../lib/restaurant-home.ts#L41), e usado pelos
  [testes da Home](../tests/restaurant-home.test.mjs#L50).
- `demandProgress`, em [demand-detail](../lib/demand-detail.ts#L49), e usado pelo
  [teste de progresso](../tests/demand-detail.test.mjs#L136).
- Esses exports tem contratos de testes; os respectivos modulos tambem contem
  funcoes ativas. **CONSOLIDAR FUTURAMENTE**, nao remover helpers/modulos agora.
- `worker-private` e `restaurant-assets` possuem consumidores ativos de foto,
  selfie, logo e imagens; **MANTER**, sem inventario remoto de objetos.
- [API debug/env](../app/api/debug/env/route.ts) possui contratos de testes e
  runbooks de diagnostico; **CONSOLIDAR FUTURAMENTE / MANTER AGORA**.
- APIs de push/webhooks, exportacao, exclusao e geocodificacao, migrations,
  dependencias de build/Android e contratos externos: **MANTER**.

## 7. Inventario visual

Inventario de renderizacao, incluindo variacoes equivalentes, contagens dinamicas
que podem ser zero e textos de ausencia/pendencia. Classificacao de UX e
recomendacao, **nao autorizacao de alteracao nem declaracao de erro funcional**.
Cada referencia pode ser compartilhada por varias telas.

Buscas literais por `0 itens`, `0 arquivos`, `Sem dados`, `Vazio` e `Sem conteúdo`
nao localizaram esses placeholders como texto de interface atual. Foram encontrados
equivalentes abaixo. Strings em tipos, nomes de variaveis, comentarios, testes,
SQL ou condicionais de estilo nao sao ocorrencias visiveis adicionais.

### 7.1 Perfil e ausencia de dados opcionais

| Arquivo/linha | Tela e texto/contexto | Classificacao |
| --- | --- | --- |
| [profile/page:89](../app/profile/page.tsx#L89) | Perfil generico: cidade "Não informada". | **NÃO AGREGA VALOR**; sem orientacao, candidato a ocultar campo opcional vazio. |
| [profile-overview:100](../app/components/profile-overview.tsx#L100) | Perfil profissional: experiencia "Não informada". | **NÃO AGREGA VALOR**; preservar edicao, nao inventar experiencia. |
| [profile-overview:101](../app/components/profile-overview.tsx#L101) | Perfil profissional: especialidades "Não informadas". | **AGREGA VALOR**; especialidade e informacao profissional relevante, proxima ao CTA de edicao. |
| [profile-overview:139](../app/components/profile-overview.tsx#L139) | Perfil restaurante: descricao "Não informada". | **NÃO AGREGA VALOR**; ausencia de texto opcional. |
| [profile-overview:206](../app/components/profile-overview.tsx#L206) | Ambos os perfis: "Cidade não informada" no resumo. | **NÃO AGREGA VALOR** como repeticao de ausencia; nao equivale a remover cidade do cadastro. |
| [demand-person:19](../app/components/demand-person.tsx#L19) | Candidato/rede/contratado: "Especialidade não compartilhada". | **AGREGA VALOR**; distingue indisponibilidade de especialidade conhecida. |
| [talent-center:631](../app/restaurant/candidates/talent-center.tsx#L631) | Drawer: "Cidade não compartilhada". | **AGREGA VALOR**; respeita privacidade, nao afirmar inexistencia do dado. |
| [talent-center:646](../app/restaurant/candidates/talent-center.tsx#L646) | Drawer: "Descrição profissional não compartilhada." | **NÃO AGREGA VALOR**; secao opcional sem conteudo. |
| [talent-center:648](../app/restaurant/candidates/talent-center.tsx#L648) | Drawer: "Especialidades não compartilhadas." | **AGREGA VALOR**; ausencia de informacao essencial a selecao, sem contornar privacidade. |
| [talent-center:650](../app/restaurant/candidates/talent-center.tsx#L650) | Drawer: "Experiência não compartilhada." | **NÃO AGREGA VALOR**; ruido de secao opcional. |
| [talent-center:671](../app/restaurant/candidates/talent-center.tsx#L671) | Avaliacao individual: "Sem comentário." | **NÃO AGREGA VALOR**; nota pode existir sem comentario opcional. |
| [talent-center:673](../app/restaurant/candidates/talent-center.tsx#L673) | Drawer: "Nenhuma avaliação compartilhada." | **AGREGA VALOR**; nao transformar ausencia/privacidade em nota zero. |
| [demand-detail:243](../app/restaurant/demands/[demandId]/demand-detail.tsx#L243) | Perfil contextual: "Experiência não compartilhada pelo profissional." | **NÃO AGREGA VALOR**; mesmo padrao de secao opcional. |
| [demand-detail:198](../app/restaurant/demands/[demandId]/demand-detail.tsx#L198) | Candidato: "Perfil não disponível..." por compartilhamento/exclusao. | **AGREGA VALOR**; explica indisponibilidade e limita contratacao. |
| [demand-detail:246](../app/restaurant/demands/[demandId]/demand-detail.tsx#L246) | Perfil contextual: "Perfil indisponível para esta conta." | **AGREGA VALOR**; nao esconder restricao como perfil vazio. |
| [demand-detail:312](../app/restaurant/demands/[demandId]/demand-detail.tsx#L312) | Contratado: "Profissional · perfil indisponível". | **AGREGA VALOR**; contratacao continua existindo sem expor dados indisponiveis. |

### 7.2 Vazios de listas, busca e mensagens

| Arquivo/linha | Tela e contexto | Classificacao |
| --- | --- | --- |
| [demand-talent-network:83](../app/components/demand-talent-network.tsx#L83) | Rede: "Nenhum profissional neste filtro", sugere outra busca. | **AGREGA VALOR** |
| [talent-center:475](../app/restaurant/candidates/talent-center.tsx#L475) | Talentos: nenhum profissional corresponde a busca/filtros; compartilhado pelas secoes. | **AGREGA VALOR** |
| [talent-center:482](../app/restaurant/candidates/talent-center.tsx#L482) | Nenhum convidado para operacao, seguido de sugestoes para convidar. | **AGREGA VALOR** |
| [talent-center:486](../app/restaurant/candidates/talent-center.tsx#L486) | Nenhum convidado / aguardando candidaturas, quando nao ha sugestoes. | **AGREGA VALOR**; estado da secao, nao indicador de certificados. |
| [talent-center:493](../app/restaurant/candidates/talent-center.tsx#L493) | Nenhuma candidatura para operacao. | **AGREGA VALOR** |
| [talent-center:496](../app/restaurant/candidates/talent-center.tsx#L496) | Nenhuma operacao ativa; CTA Criar operacao. | **AGREGA VALOR** |
| [talent-center:565](../app/restaurant/candidates/talent-center.tsx#L565) | Nenhum profissional marcado como interesse; explica a marcacao. | **AGREGA VALOR** |
| [restaurant/dashboard:451](../app/restaurant/dashboard/page.tsx#L451) | Nenhuma pendencia; mensagem de tranquilidade. | **AGREGA VALOR** |
| [restaurant/dashboard:472](../app/restaurant/dashboard/page.tsx#L472) | Nenhuma operacao agendada; explica proximas operacoes. | **AGREGA VALOR** |
| [demands/page:107](../app/restaurant/demands/page.tsx#L107) | Lista inicial "Você ainda não possui operações.", com CTA de criacao. | **AGREGA VALOR** |
| [demands/page:123](../app/restaurant/demands/page.tsx#L123) | Nenhuma operacao neste filtro; Ver todas. | **AGREGA VALOR** |
| [demand-detail:234](../app/restaurant/demands/[demandId]/demand-detail.tsx#L234) | Operacao nao encontrada/indisponivel para conta. | **AGREGA VALOR** |
| [demand-detail:254](../app/restaurant/demands/[demandId]/demand-detail.tsx#L254) | Lista completa: ainda nao ha candidatos, Compartilhar operacao. | **AGREGA VALOR** |
| [demand-detail:299](../app/restaurant/demands/[demandId]/demand-detail.tsx#L299) | Resumo: ainda nao ha candidatos, Compartilhar operacao. | **AGREGA VALOR**; mesma finalidade em outra subvisao. |
| [demand-detail:320](../app/restaurant/demands/[demandId]/demand-detail.tsx#L320) | Nenhum contratado, CTA Convidar. | **AGREGA VALOR** |
| [demand-detail:353](../app/restaurant/demands/[demandId]/demand-detail.tsx#L353) | Nenhum evento registrado na linha do tempo. | **AGREGA VALOR**; ausencia de historico nao e erro de leitura. |
| [history/page:14](../app/restaurant/history/page.tsx#L14) | Ainda nao houve operacao concluida. | **AGREGA VALOR** |
| [team-center:107](../app/restaurant/team/team-center.tsx#L107) | Nenhuma contratacao em andamento; Ir para Talentos. | **AGREGA VALOR** |
| [message-center:178](../app/restaurant/messages/message-center.tsx#L178) | Conversa existente sem mensagem: "Ainda não há mensagens. Combine os detalhes da operação." | **AGREGA VALOR** |
| [message-center:194](../app/restaurant/messages/message-center.tsx#L194) | Nenhuma conversa encontrada versus disponivel; Limpar busca ou Ver Operacoes. | **AGREGA VALOR**; duas condicoes explicitamente distintas. |
| [worker/dashboard:362](../app/worker/dashboard/page.tsx#L362) | "Novas oportunidades vêm por aí", sem plantoes; Revisar perfil. | **AGREGA VALOR** |
| [worker/applications:170](../app/worker/applications/page.tsx#L170) | "Sua próxima diária está à frente", ainda sem candidaturas; Explorar vagas. | **AGREGA VALOR** |
| [worker/invitations:67](../app/worker/invitations/page.tsx#L67) | Nenhum convite por enquanto. | **AGREGA VALOR** |
| [worker/messages:142](../app/worker/messages/page.tsx#L142) | "Ainda não existem conversas." | **AGREGA VALOR** |
| [chat-client:428](../app/chat/[jobId]/chat-client.tsx#L428) | Restaurante sem timeline: "Conversa da operação", orienta combinar detalhes. | **AGREGA VALOR** |
| [chat-client:430](../app/chat/[jobId]/chat-client.tsx#L430) | Worker sem mensagens: "Comece a conversa", orienta escrever. | **AGREGA VALOR** |
| [notification-center:218](../app/components/notification-center.tsx#L218) | Erro sem avisos: nao foi possivel consultar, Tentar novamente. | **AGREGA VALOR**; nunca trocar por vazio de sucesso. |
| [notification-center:222](../app/components/notification-center.tsx#L222) | "Tudo em dia por aqui" ou "Nenhum aviso neste filtro"; orientacao e Ver todas. | **AGREGA VALOR** |

### 7.3 Localizacao, estados operacionais, zero e indisponibilidade

| Arquivo/linha | Tela e contexto | Classificacao |
| --- | --- | --- |
| [demand-card:106](../app/components/demand-card.tsx#L106) | Card de operacao: "Local a definir". | **AGREGA VALOR**; nao presumir local conhecido. |
| [worker/invitations:62](../app/worker/invitations/page.tsx#L62) | Convite: "Local a definir". | **AGREGA VALOR** |
| [chat-client:181](../app/chat/[jobId]/chat-client.tsx#L181) | Contexto da conversa: "Local a definir". | **AGREGA VALOR** |
| [restaurant/dashboard:467](../app/restaurant/dashboard/page.tsx#L467) | Operacao agendada: "Endereço não informado." | **AGREGA VALOR**; local e dado operacional, nao ornamento. |
| [demand-detail:270 e 358](../app/restaurant/demands/[demandId]/demand-detail.tsx#L270) | Resumo e secao de local: "Local a definir". | **AGREGA VALOR**; revisar repeticao apenas em sprint visual. |
| [demand-detail:359](../app/restaurant/demands/[demandId]/demand-detail.tsx#L359) | "Endereço ainda não informado." | **AGREGA VALOR** |
| [demand-detail:365](../app/restaurant/demands/[demandId]/demand-detail.tsx#L365) | "Nenhuma orientação adicional." | **NÃO AGREGA VALOR**; descricao opcional vazia, distinta de endereco necessario. |
| [worker/dashboard:392](../app/worker/dashboard/page.tsx#L392) | Distancia indisponivel por falta de coordenadas. | **AGREGA VALOR**; nao inventar proximidade. |
| [chat-client:65,67,68](../app/chat/[jobId]/chat-client.tsx#L65) | Check-in, pagamento e checkout "pendente"; labels no contexto do chat. | **AGREGA VALOR**; passos exigem acao/confirmacao. |
| [restaurant-message-inbox:73,75,76](../lib/restaurant-message-inbox.ts#L73) | Mesmas tres pendencias calculadas para lista de mensagens, renderizadas como status. | **AGREGA VALOR** |
| [restaurant-message-inbox:214](../lib/restaurant-message-inbox.ts#L214) | Fallback "Local a definir", dado da conversa usado na busca. | **AGREGA VALOR** como contexto; nao e uma linha extra renderizada na lista atual. |
| [operational-panel:139](../app/components/operational-panel.tsx#L139) | Pagamento pendente, informado, recebimento ou contestacao; orienta acao exata. | **AGREGA VALOR**; nao alterar pagamento. |
| [restaurant-team:78](../lib/restaurant-team.ts#L78) | Estado "Pagamento pendente" apresentado na Equipe. | **AGREGA VALOR** |
| [team-center:160](../app/restaurant/team/team-center.tsx#L160) | `aria-label="pendente"` na linha do tempo, inclusive leitores de tela. | **AGREGA VALOR**; nao e texto decorativo redundante. |
| [demands:88 e 95](../lib/demands.ts#L88) | "Checkout Pendente" e profissionais pendentes, nos cards/detalhes. | **AGREGA VALOR**; fase e equipe incompleta. |
| [restaurant/dashboard:393 e 406](../app/restaurant/dashboard/page.tsx#L393) | Acoes pendentes e avaliacao obrigatoria pendente. | **AGREGA VALOR** |
| [worker/dashboard:305](../app/worker/dashboard/page.tsx#L305) | Avaliacao pendente com CTA. | **AGREGA VALOR** |
| [demand-detail:339](../app/restaurant/demands/[demandId]/demand-detail.tsx#L339) | Estado indisponivel versus aguardando chegada/pagamento/recebimento. | **AGREGA VALOR**; distinguir erro de etapa nao concluida. |
| [demand-detail helper:34,36,71](../lib/demand-detail.ts#L34) | Pagamento informado, lembrete enviado e Local a definir na timeline/compartilhamento. | **AGREGA VALOR**; eventos e contexto, nao campos vazios. |
| [operational-reputation:16 e 17](../app/components/operational-reputation.tsx#L16) | "Sem compromissos registrados" e "Sem avaliações". | **AGREGA VALOR**; nao transformar ausencia em score/nota zero. |
| [operational-reputation:18](../app/components/operational-reputation.tsx#L18) | Contadores de trabalho/check-in/atraso/ausencia podem ser zero. | **AGREGA VALOR**; historico operacional mensuravel. |
| [operational-reputation:58,60,64,76](../app/components/operational-reputation.tsx#L58) | Resumo usa traco em loading/erro/ausencia; detalhe explica indicadores nao compartilhados. | **AGREGA VALOR** nao inventar zero; **CONSOLIDAR FUTURAMENTE** a distincao visual dos tres estados do resumo. |
| [restaurant/dashboard:375](../app/restaurant/dashboard/page.tsx#L375) | Zero operacoes/nao lidas ou traco em carregamento/indisponibilidade. | **AGREGA VALOR**; medidas reais, nao "0 itens" decorativo. |
| [worker/dashboard:265](../app/worker/dashboard/page.tsx#L265) | Zero candidaturas/diarias/ganhos conforme dados, ou traco. | **AGREGA VALOR**; preservar estado de erro separado. |
| [talent-center:110,478,490](../app/restaurant/candidates/talent-center.tsx#L110) | Contagem dinamica `(0)` em convidados/candidatos. | **NÃO AGREGA VALOR** quando o mesmo vazio e explicado logo abaixo; preservar contagens positivas. |
| [talent-center:452 e 453](../app/restaurant/candidates/talent-center.tsx#L452) | Nota ausente em traco e `0 operações concluídas`. | **AGREGA VALOR** como historico; revisar `?? 0` para nao confundir dado ausente com zero em sprint futura, sem alterar aqui. |
| [talent-center:640 a 643](../app/restaurant/candidates/talent-center.tsx#L640) | Zero avaliacoes, metricas ausentes em traco, "avaliações privadas". | **AGREGA VALOR**; distinguir novo profissional, privacidade e desempenho. |
| [talent-center:654 e 665](../app/restaurant/candidates/talent-center.tsx#L654) | Data de ultima contratacao ausente em traco e avaliacoes "Privadas". | **AGREGA VALOR**; preservar privacidade. |
| [demand-detail:244,250,298](../app/restaurant/demands/[demandId]/demand-detail.tsx#L244) | Operacoes concluidas com empresa e candidatos/ver todos podem mostrar zero. | Historico: **AGREGA VALOR**; zero candidato/Ver todos junto ao vazio: **NÃO AGREGA VALOR** como repeticao. |
| [notification-center:179](../app/components/notification-center.tsx#L179) | `0 não lida(s)` no cabecalho. | **AGREGA VALOR**; estado da caixa. |
| [profile-editor:390](../app/components/profile-editor.tsx#L390) | Restaurante: `0 foto(s) salva(s)` e limite de upload. | **AGREGA VALOR** no formulario; nao e certificado profissional. |
| [push-notification-control:43](../app/components/push-notification-control.tsx#L43) | Zero dispositivos registrados e ultimas entregas "nenhuma" no diagnostico de push. | **AGREGA VALOR**; informa registro/entregas, nao perfil incompleto. |
| [offline.html:19](../public/offline.html#L19) | "Você está sem conexão". | **AGREGA VALOR**; explica indisponibilidade real. |

O [EmptyState compartilhado](../app/components/ui/index.tsx#L88) exige titulo e
descricao de quem o chama: nao injeta "Sem dados", "Vazio" ou contagem zero.
Badges de nao lidas em MobileBottomNav/NotificationBell so aparecem acima de zero.
Nao foram encontrados upload de curriculo/certificados ou indicador profissional
`0 arquivo(s)` nos formularios atuais.

Mensagens de erro que mencionam "avaliacoes pendentes" em dashboards, demand-detail,
operations e restaurant-team sao diagnosticos de falha, nao estados vazios de
sucesso: **AGREGA VALOR**, manter. Texto legal sobre ausencia de rastreamento,
biometria ou servicos externos tambem **AGREGA VALOR**; nao classificar como
ruido por conter "nao" ou "sem".

## 8. Relatorio de Perfil Verificado

### 8.1 Contrato e responsabilidades atuais

- [ProfileVerification](../app/components/profile-verification.tsx) e
  [getVerificationState](../lib/profile-verification.ts) tratam o fluxo privado:
  requisitos CPF/RG/telefone, selfie privada e estados nao iniciado, pendente,
  aprovado e rejeitado. Curriculo/certificados/WhatsApp nao sao requisitos.
- [ProfessionalVerification](../app/components/professional-verification.tsx)
  consulta o sinal publico `public_user_directory.profile_verified`, diretamente
  por usuario ou resolvendo o trabalhador de um job; faz registro de consumidores,
  lotes e atualizacao por tempo/foco/navegacao/autenticacao.
- [VerifiedProfileBadge](../app/components/verified-profile-badge.tsx) apresenta
  escudo, nome acessivel "Perfil Verificado" e tooltip por mouse, teclado e toque.
  E um selo de identidade, nao garantia de comparecimento ou reputacao.
- A [definicao SQL local do sinal](../supabase/migrations/20261103000000_verified_profile.sql#L114)
  exige papel worker, status aprovado, selfie e CPF/RG/telefone preenchidos.
  Essa migration ja estava no worktree antes da epica; **nao foi criada,
  alterada, aplicada ou verificada no banco remoto nesta tarefa**.
- Sem contexto/dados, o consumidor pode nao renderizar selo. Ausencia de selo
  nao e prova de identidade rejeitada. Falha de consulta publica limpa o conjunto
  exibido e sinaliza erro; nao substituir por aprovacao presumida.

### 8.2 Cobertura por superficie

| Superficie | Onde ja aparece | Situacao / recomendacao |
| --- | --- | --- |
| Perfil proprio detalhado | [ProfileOverview](../app/components/profile-overview.tsx) no cabecalho e [ProfileVerification](../app/components/profile-verification.tsx) na secao privada aprovada. | Dois pontos na mesma pagina; avaliar repeticao visual, sem remover estado privado. |
| Perfil generico | [ProfilePage:81](../app/profile/page.tsx#L81), junto ao nome quando worker. | Presente, fonte publica; alinhar com perfil canonico futuro. |
| Edicao profissional | [ProfileEditor:364](../app/components/profile-editor.tsx#L364), link para solicitar verificacao. | Nao renderiza o selo como status do formulario; isso nao torna upload/documentos requisitos. Padronizacao futura deve remeter ao mesmo estado. |
| Talentos / candidatos | [TalentCenter:449,629,695](../app/restaurant/candidates/talent-center.tsx#L449): card, drawer e confirmacao de aprovacao. | Presente por userId. |
| Rede e candidato no detalhe | [DemandPerson:18](../app/components/demand-person.tsx#L18), reutilizado na rede, candidatos, contratados e perfil contextual. | Presente por userId; indisponibilidade do perfil continua distinta de nao verificado. |
| Equipe | [TeamCenter:118 e 144](../app/restaurant/team/team-center.tsx#L118), lista e drawer. | Presente via jobId. |
| Mensagens restaurante | [MessageCenter:172](../app/restaurant/messages/message-center.tsx#L172), junto ao profissional. | Presente nas duas entradas, pois componente e o mesmo. |
| Mensagens profissional | [WorkerMessages](../app/worker/messages/page.tsx#L152) identifica restaurante/operacao. | Nao exibe selo profissional no restaurante, corretamente. Nao adicionar selo de worker ao nome de empresa. |
| Chat | [ChatClient:385 e 395](../app/chat/[jobId]/chat-client.tsx#L385), cabecalho quando participante e worker; [442 e 462](../app/chat/[jobId]/chat-client.tsx#L442), autores das mensagens. | Presente nos dois layouts. Pode repetir selo por mensagem; avaliar ruido sem perder identificacao. |
| Notificacao flutuante com remetente | [NotificationExperience:386](../app/components/notification-experience.tsx#L386). | Presente por senderId; provider filtra sinal publico. |
| Toast global / lista de notificacoes | [NotificationExperience:373](../app/components/notification-experience.tsx#L373) e [NotificationCenter:232](../app/components/notification-center.tsx#L232): titulo/mensagem genericos, sem selo. | Nao e inconsistência automatica: nem todo aviso identifica pessoa. Futuramente, se houver nome de worker e identificador autorizado no contrato existente, usar mesmo componente; nao inferir identidade do texto. |
| Push do sistema | [Service worker](../public/sw.js), notificacao nativa em texto. | Nao renderiza React/tooltip. **MANTER** push; nao incluir documentos privados nem alterar payload nesta epica. |
| Home restaurante | [Dashboard:407,424,489](../app/restaurant/dashboard/page.tsx#L407): avaliacao, pessoa em pendencia e conversa recente. | Presente quando ha identificador do profissional/job. |
| Criacao bloqueada por avaliacao | [CreateJob:145](../app/restaurant/dashboard/jobs/create/page.tsx#L145). | Presente via jobId, nao nova verificacao operacional. |
| Operacao e avaliacao | [OperationalPanel:102](../app/components/operational-panel.tsx#L102) e [ReviewClient:153](../app/reviews/[jobId]/review-client.tsx#L153). | Presente para restaurante vendo worker; fluxo operacional intacto. |

### 8.3 Inconsistencias e riscos a validar

1. Perfil privado usa selfie/status local; selo publico tambem depende dos demais
   requisitos no sinal SQL. Fontes tem responsabilidades diferentes e podem
   divergir temporalmente apos envio/analise ou dados incompletos.
2. Refresh publico por intervalo/foco/navegacao nao significa atualizacao
   sincronizada instantanea com a secao privada. Nao ha prova nesta auditoria de
   falha real no banco; medir antes de refatorar.
3. Resolucao por job depende de contratacao e status elegiveis; por userId nao
   precisa dessa resolucao. Ausencia de job/contexto nao deve virar rejeicao.
4. Cabecalho + secao aprovada e selo por mensagem sao repeticoes visuais possiveis.
   Padronizar densidade mantendo acessibilidade e contexto.
5. Onde **deveria** aparecer: junto de identidade profissional verificavel em
   superficies de decisao/comunicacao. Os principais pontos atuais ja o incluem.
   Novas padronizacoes devem reutilizar o consumidor publico; avisos genericos,
   nomes de restaurante e notificacoes nativas nao exigem o mesmo selo React.
6. Centralizar semantica/apresentacao nao autoriza misturar selfie, CPF ou RG
   privados com o diretorio publico, nem mudar permissoes, RPCs ou calculo operacional.

## 9. Problemas encontrados e ganhos esperados

| Problema | Ganho esperado da consolidacao futura |
| --- | --- |
| URL de perfil significa menu; leitura esta em details e existe perfil generico adicional. | Um ponto de entrada compreensivel, menos destinos divergentes e manutencao por papel. |
| Mesma caixa por duas entradas e hash historico que abre talentos. | Um destino canonico com compatibilidade explicita; menor confusao e testes mais claros. |
| Navegacao mistura query, hash, drawers e CTAs contextuais. | Contratos documentados, anchors consistentes e rastreabilidade sem eliminar contexto. |
| Resumos de pessoa e estados operacionais em varias projecoes. | Apresentacao reutilizavel, vocabulario uniforme e menor custo de evolucao. |
| Ausencias opcionais repetidas e contagens zero decorativas. | Menor ruido, hierarquia centrada em identidade e historico operacional. |
| Selo publico e estado privado com tempos/fontes diferentes. | Semantica consistente, sem vazamento de dados ou garantia operacional indevida. |
| Worktree local diferente do commit/deployment e contratos externos desconhecidos. | Entregas isoladas, rastreaveis e rollout com compatibilidade comprovada. |

Escalabilidade aqui significa reduzir pontos de manutencao e divergencia.
Nao ha benchmark que comprove ganho de performance; nao prometer reducao de
latencia ou consultas sem medir.

## 10. Roadmap recomendado, sem implementacao

### Sprint 1 - Perfil unico

- Decidir destino do Mais profissional e preservar seus acessos.
- Canonizar `/worker/profile`; manter edicao como subfluxo e compatibilidade
  de detalhes, anchors e perfil generico por papel.
- Criterios: identidade, CPF/RG/nascimento/telefone/endereco/especialidades,
  verificacao e confianca preservados; legados sem interface; login, retorno,
  sessao, reload e voltar cobertos.
- Dependencias: inventario de deep links e decisao de navegacao; sem banco/RPC.

### Sprint 2 - Mensagens unicas

- Canonizar `/restaurant/messages`, preservar entrada query e planejar
  tratamento do hash historico no cliente.
- Atualizar destinos internos apenas em tarefa autorizada; nao alterar push,
  notificacoes persistidas ou SQL como efeito colateral.
- Criterios: caixa, busca, Realtime, nao lidas, papel, chat e voltar equivalentes;
  candidatos normais e `demand` continuam funcionando.

### Sprint 3 - Navegacao unica

- Padronizar destinos/retornos por papel, corrigir o hash historico de mensagens
  em tarefa autorizada e preservar as ancoras validas de candidatos/equipe.
- Reutilizar menus existentes, preservar atalhos uteis e drawers contextuais;
  nao criar uma camada abstrata para cada link.
- Criterios: mapa atualizado, item ativo correto, nenhum acesso perdido,
  acessibilidade mobile/desktop e historico do navegador testados.
- Depende das decisoes de rotas das sprints 1 e 2.

### Sprint 4 - Consolidacao visual

- Usar o inventario da secao 7: primeiro textos opcionais **NÃO AGREGA VALOR**,
  depois repeticao de zeros e densidade do selo.
- Preservar erros explicitos, privacidade, falta de dados essenciais,
  estados acionaveis e metricas historicas verdadeiras.
- Criterios: comparar renderizacoes com/sem dados, loading/erro/vazio separados,
  leitores de tela e limites de conteudo. Nao mexer em regras de negocio.

### Sprint 5 - Perfil Verificado centralizado

- Consolidar semantica e uso do provider/consumidor/badge ja existentes,
  sem criar segunda fonte publica ou fundir fluxo privado com selo.
- Validar refresh, jobId/userId, acessibilidade e densidade por superficie.
- Criterios: mesma identidade aprovada leva ao mesmo selo publico nos pontos
  elegiveis; ausencia/erro nao cria falso aprovado ou falso rejeitado;
  identidade permanece separada de confianca operacional.
- Nenhuma mudanca de schema, RPC, seguranca, push ou biometria esta implicita.

## 11. Riscos, proximas etapas e limites

- Antes de implementar, confirmar dependencias externas e contrato de URLs
  antigas; ausencia de links nao e evidencia suficiente para exclusao.
- Nao consolidar pelo nome de componentes: lista/global, detalhe/contextual,
  privado/publico e leitura/escrita precisam manter suas diferencas.
- Existem alteracoes preexistentes e migration local de verificacao. A epica
  nao as criou, aprovou, aplicou, publicou ou reverteu.
- Testes locais nao equivalem a homologacao autenticada, analise de trafego,
  verificacao do schema remoto ou confirmacao de deployment.
- Nenhum componente, helper, API, bucket ou dado adicional foi classificado
  como seguro para remocao imediata.
- Proxima acao recomendada: aprovar o desenho da sprint 1 e o contrato de
  compatibilidade antes de alterar qualquer rota.

## 12. Validacao desta entrega

A verificacao considera o baseline no inicio desta epica, nao um diff contra
HEAD que incluiria trabalho de sprints anteriores.

| Verificacao | Resultado |
| --- | --- |
| `npm test` com `PGLITE_MODULE` resolvido para o pacote ja instalado | 191 testes: 189 aprovados, 2 HTTP inicialmente ignorados por ausencia de servidor, 0 falhas. Testes SQL executados em PostgreSQL isolado em memoria. |
| `node --test tests/auth-http.test.mjs` com `EXTRACHEF_TEST_URL` local | Os dois casos HTTP anteriormente ignorados foram executados: 12 testes/subtestes aprovados, nenhum ignorado ou com falha. Cobrem dez caminhos protegidos e callback sem codigo. |
| Servidor temporario de producao local | `next start` em loopback, porta 3187; `/login` respondeu HTTP 200 antes dos testes. Servidor encerrado ao concluir. Nao foi usado deployment remoto. |
| `npm run typecheck` | Aprovado; geracao de tipos de rotas e `tsc --noEmit`. |
| `npm run lint` | Exit 0, nenhum erro; 16 avisos preexistentes no asset Android gerado `android/app/build/intermediates/assets/debug/mergeDebugAssets/native-bridge.js`. Nenhum autofix aplicado. |
| `npm run build` | Aprovado na repeticao, conforme orientacao do proprio Next.js. As quatro rotas de perfil, as rotas de mensagens, etapas operacionais e as oito APIs permanecem no build. |
| Integridade do baseline SHA256 | 209 arquivos preexistentes comparados: nenhum alterado ou removido. Apenas os dois documentos solicitados adicionados nos caminhos inventariados. Inclui app, lib, supabase, public, testes, docs preexistentes, proxy, manifests/configuracoes e AGENTS.md. |
| Referencias dos documentos | Todos os destinos locais dos links nos dois documentos existem. |
| `git diff --check` | Exit 0; apenas avisos de conversao futura LF/CRLF em arquivos preexistentes, sem alteracao realizada por esta epica. |

O primeiro build compilou e gerou as rotas, mas o Next.js encerrou com
`SecurityFatalError`, informando vulnerabilidade conhecida na versao instalada
e orientando repetir o comando. A repeticao terminou com exit 0.
**Isso nao corrige a vulnerabilidade: recomendar atualizacao de seguranca em
tarefa separada, com autorizacao e validacao proprias.** Nenhum pacote foi
instalado, atualizado ou removido nesta epica.

Confirmacoes de escopo, sustentadas pelo baseline e pelas validacoes:

- Nenhuma funcionalidade, regra de negocio ou fluxo operacional foi alterado.
- Nenhuma migration foi criada, alterada ou aplicada por esta epica.
- Nenhuma rota ou API foi removida ou alterada.
- Nenhum banco remoto, tabela, bucket, objeto ou permissao foi modificado.
- Check-in, checkout, pagamentos, push, RPCs e seguranca foram preservados.
- As alteracoes e exclusoes anteriores do worktree permaneceram intactas.
- Nenhum commit, push ou deployment foi realizado.

Nao foi feita homologacao manual autenticada de todas as telas; a confirmacao
de preservacao se baseia na ausencia de mudancas no codigo e nos testes.
