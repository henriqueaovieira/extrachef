# ExtraChef: auditoria visual e Design System

## Escopo

Padronizacao de UX e apresentacao sobre os componentes existentes, sem novas tabelas,
APIs de negocio ou alteracoes de policies/autenticacao. Nao foram criados fluxos de
recuperacao/troca de senha, que nao existem no projeto atual.
Os handlers e as validacoes de negocio foram preservados. O retorno da publicacao de
vaga recebe apenas `feedback=job_created` para apresentar confirmacao no dashboard.

## Auditoria antes da implementacao

| Superficie | Problema encontrado | Tratamento |
| --- | --- | --- |
| Inputs e formularios | Classes repetidas em login, cadastro, eventos, perfil, vagas e chat | Controles nativos encapsulados em uma base compartilhada |
| Placeholders | `text-gray-400` e cores implicitas pouco legiveis | Token explicito de texto secundario e placeholder, opacidade 1 |
| Labels | Login/cadastro/vagas com label separado sem `htmlFor` | Associacao explicita com IDs; labels envolventes preservados no perfil |
| Senha | Somente input password, sem visibilidade | Toggle acessivel sem submit, mantendo autocomplete e valor |
| Cores | CSS de modo escuro contradizia paginas claras e viewport light | Tema claro consistente, sem implementar tema escuro incompleto |
| Tipografia | Fonte Geist carregada, mas body forcava Arial | Usar a fonte ja instalada, sem nova dependencia |
| Botoes | Estilos repetidos, formas diferentes e icones de 36/40 px | Primitiva comum, variantes e alvo minimo de 44 px |
| Cards | Bordas, sombras e raios repetidos | Token e Card compartilhado nas superficies migradas |
| Badges | Estilos diferentes para estados equivalentes | Badge com tom semantico, preservando rotulos e status |
| Feedback | Mensagens soltas, blocos diferentes e falta de confirmacao ao voltar de criar vaga | Toast comum para feedback local e notificacao flutuante existente |
| Carregamento | Paragrafos isolados de carregamento | Skeleton com descricao acessivel e shimmer reduzivel |
| Vazio | Mensagem sem orientacao/contexto | EmptyState com descricao e acao existente quando apropriado |
| Mobile | Cidade/telefone lado a lado em tela estreita; teclados inconsistentes | Empilhar no mobile; inputMode/autocomplete e mascaras brasileiras |
| Perfil | Ausencia de orientacao de preenchimento | Progresso apenas visual usando os dados existentes, sem bloquear acoes |
| Safe area | Bottom nav tratava base; faltava viewport cover e margem superior/lateral global | Viewport cover, insets de body/nav e ajustes de overlays |
| Dialogos | Exclusao usa confirmacao nativa; camera e popup sao nao modais | Preservar mecanismo existente; nao adicionar modal paralelo |
| Teclado | Estrelas com semantica radio, mas sem setas | Tab unico no grupo, setas para navegar/selecionar |

## Componentes e contratos

Implementacao em [ui/index.tsx](../app/components/ui/index.tsx).
Todos os inputs, textareas, selects e botoes HTML da aplicacao passam por essas primitivas.
O teste de adocao evita a reintroducao de controles nativos fora dessa base.
Wrappers de pagina, tabelas, links de navegacao e cards de indicadores especificos mantem seus layouts.

| Componente | Uso |
| --- | --- |
| Button | `variant`: primary, secondary, ghost, danger; `busy` adiciona spinner e aria-busy sem apagar rotulo |
| TextInput | Props nativas, restricoes/handlers preservados; base visual compartilhada |
| PasswordInput | Mostrar/ocultar, aria-controls/pressed, botao nao envia formulario |
| TextArea | Mesmo contraste e foco de TextInput; permite redimensionamento vertical |
| Select | Select nativo, incluindo navegacao por teclado e selecao no sistema mobile |
| Card | Superficie comum; `as` preserva section/article/div conforme contexto |
| Badge | neutral, success, info, warning, danger; texto sempre explicita o estado |
| Toast | success/info/warning/danger; danger usa alert, demais usam status; error preservado como alias legado; fechamento opcional |
| EmptyState | Icone decorativo, titulo, orientacao e acao ja existente |
| LoadingSkeleton | Texto para leitor de tela e linhas decorativas; respeita reduced-motion |
| MaskedInput | cpf/cnpj/phone/postal-code, digitacao/colagem, restauracao de cursor |

Nao foi criado outro sistema global de notificacoes.
O componente de experiencia de notificacao existente reutiliza Toast; erros de formulario
continuam proximos ao contexto, sem desaparecer automaticamente durante a correcao.
Os avisos flutuantes mantem seu comportamento existente e podem ser fechados.

Exemplo:

```tsx
<label htmlFor="event-title">Nome do evento</label>
<TextInput id="event-title" required minLength={2} maxLength={160} />
<Button type="submit" variant="primary" busy={saving}>
  {saving ? 'Salvando...' : 'Criar evento'}
</Button>
```

Passar `type="submit"` explicitamente para a acao de envio; Button padrao usa `button`.
Usar classes adicionais para layout, nao copiar novamente cor/borda/foco dos campos.
As variantes secondary/ghost ficam na camada de componentes para permitir estados selecionados
de controles existentes sem sobrescrever suas classes condicionais.

## Tokens visuais e acessibilidade

Definidos em [globals.css](../app/globals.css):

- Fundo: `#f7f8fa`; superficie: branco; texto: `#182230`.
- Marca/acao principal: `#b9470d`; hover: `#95390b`.
- Texto secundario/placeholder: `#526071`; borda de campo: `#8994a3`.
- Controles com 16 px, altura minima de 48 px e borda visivel.
- Botoes com alvos minimos de 44 x 44 px, incluindo mostrar senha e fechar avisos.
- Raios, sombras, foco e animacoes centralizados; foco nao depende apenas de mudar a cor.
- Texto e placeholder sobre branco e texto branco na marca testados em >= 4.5:1.
- Limite de campo sobre branco testado em >= 3:1.
- Tema claro intencional, inclusive quando o SO solicita modo escuro.
- Nao foi desabilitado zoom do navegador.
- `prefers-reduced-motion: reduce` remove shimmer, spinner/transicoes e entradas animadas.
- Regioes de feedback possuem semantica alert/status; progresso tem nome acessivel.
- Notificacao expansivel pode fechar por Escape e devolve foco ao gatilho.

Esses testes dos tokens nao constituem certificacao WCAG de toda a aplicacao.
Imagens, combinacoes dinamicas, leitor de tela e estados remotos ainda precisam de homologacao.

## Sprint 2.1: Foundation Compliance (EVC 2.0)

Esta etapa evolui apenas OperationFlow, OperationalPanel, DemandCard e MobileBottomNav.
Usa Card, Badge, Button e TextInput existentes. Nao cria componentes, rotas, menus,
camada UI ou contratos de dados. A extensao `info` do Badge e retrocompativel;
as cores das variantes preexistentes permanecem iguais.

### Referencia semantica

| Tom | Uso nesta etapa |
| --- | --- |
| success | Etapa concluida, recebimento confirmado, checkout liberado/concluido |
| info | Contratacao confirmada, operacao ativa/em andamento, codigo disponivel, avisos informativos |
| warning | Check-in, pagamento ou contratacao pendentes |
| danger | Ausencia, abandono, pagamento contestado, erro/confirmacao destrutiva |
| neutral | Etapa bloqueada, cancelamento registrado, historico/arquivo, contexto indisponivel |

O estado agregado da demanda nao equivale a sua saude de preenchimento.
DemandCard apresenta ambos separadamente: por exemplo, operacao ativa usa info,
enquanto risco de preenchimento continua danger. Nao foi recalculado nenhum estado.
Selecao de navegacao usa info, linha de destaque e `aria-current`, nao cor isolada.

Tokens semanticos sao definidos no CSS existente, junto dos raios 8/12/16/20 px
e elevacoes padrao/interativa. Os raios e o padding de cards sao aplicados somente
as superficies desta sprint; o token legado de controle fora delas foi preservado.
Espacamento usa 4/8/12/16/24 px nestas composicoes. Altura minima de controle
continua 44 px ou maior, independentemente da escala de espacamento.

### Ajustes por componente

| Componente | Ajustes de apresentacao |
| --- | --- |
| OperationFlow | Card/Badge existentes; marcadores uniformes; estado atual com borda, texto e aria-current; situacao semantica; CTAs empilhados no mobile |
| OperationalPanel | Card article preservado; Badge por fase; acao atual antes da timeline; dados e ocorrencias secundarios; codigos e botoes adaptaveis a telas estreitas |
| DemandCard | Card/Badge existentes; status independente da saude; acao contextual dominante e detalhes secundarios; foco do link expandido visivel; local/data com quebra natural |
| MobileBottomNav | Mesmos itens/destinos/regras de ativo; item selecionado com fundo/linha; badge info; fundo opaco; rotulos completos sem quebra dentro das palavras |

A mudanca de ordem visual no painel nao altera condicoes, handlers, etapas ou destinos.
DemandCard nao ganhou valor monetario: esse campo nao era exibido pelo componente.
No menu estreito, o tamanho de 10 px dos rotulos foi mantido para acomodar seis itens;
a partir de 640 px, usa 12 px. Os alvos continuam com pelo menos 44 px.

### Rubrica e score

Score tecnico local: 20 verificacoes de mesmo peso, 5 pontos percentuais cada.
As notas iniciais sao estimativas da revisao estatica anterior, nao medicoes de usuarios.
As notas finais combinam revisao, testes de componentes e fixtures em navegador.
Este score nao e certificacao externa de EVC ou WCAG.

| Grupo | Cinco verificacoes |
| --- | --- |
| Semantica | Paleta compartilhada; tom por significado; success reservado a conclusao/recebimento; estado textual; ausencia de conflito entre status e indicador |
| Hierarquia | Titulo; situacao visivel; acao dominante; secundarios subordinados; reconhecimento humano da acao em menos de 3 s |
| Layout | Escala de espacamento; raios; elevacao; sem overflow nas tres larguras; textos sem corte indevido |
| Acessibilidade | Foco visivel; nomes/labels; semantica e teclado; contraste textual >= 4.5:1; alvos principais >= 44 px |

| Componente | Antes (revisao) | Depois (19/20) |
| --- | --- | --- |
| OperationFlow | 65% | 95% |
| OperationalPanel | 60% | 95% |
| DemandCard | 65% | 95% |
| MobileBottomNav | 70% | 95% |

O criterio de reconhecimento humano em menos de 3 s permanece sem medicao e
nao recebe pontos. As demais verificacoes sao locais: nao substituem teste com
usuario autenticado, leitor de tela, teclado virtual ou dispositivos fisicos.

### Evidencias de validacao

- Testes existentes de UI operacional, demandas, navegacao e UI foram ampliados.
- Testes verificam os 12 estados de apresentacao nos dois papeis e preservam
  disponibilidade/rotulos/destinos, chamadas operacionais, restricoes e erros.
- Contraste dos cinco pares de tokens semanticos e do badge de mensagens >= 4.5:1.
- Fixtures renderizam os componentes reais, com dados sinteticos e dependencias
  de ambiente simuladas; nenhum acesso a banco ou acao operacional real.
- 51 fixtures em 320, 768 e 1280 px: 153 combinacoes sem overflow horizontal;
  rotulos do menu sem quebra de palavras e controles principais >= 44 px.
- Foco por Tab verificado nas quatro superficies. Eventos de negocio sao
  cobertos por testes de componente, nao pela fixture estatica de navegador.
- Typecheck e lint dos componentes alterados executados sem erro.

As fixtures temporarias nao fazem parte do aplicativo. Nao foram alterados helpers
de negocio, queries, RPCs, policies, migrations ou a estrutura da navegacao.

## Mascaras e compatibilidade de dados

Funcoes puras em [input-masks.ts](../lib/ui/input-masks.ts):

- CPF: `123.456.789-01`.
- CNPJ: `12.345.678/0001-90`.
- Telefone: `(11) 98765-4321` ou fixo `(11) 3456-7890`; prefixo brasileiro +55 quando informado.
- CEP: `01310-930`.
- Data: controle nativo `type=date`, formato visual definido pelo navegador/idioma,
  valor de formulario preservado em ISO `YYYY-MM-DD`.

Nao foi criada mascara textual dd/mm/aaaa que mudaria o payload de data ou perderia
min/max e seletor nativo mobile. Horarios continuam controles nativos time.
CPF/CNPJ continuam normalizados e validados pelo fluxo existente no salvamento.
Mascaras sao ajuda de preenchimento, nao validacao de identidade.
O progresso contabiliza presenca, nao validade ou verificacao dos documentos.
No editor ele acompanha dados ainda nao salvos; no resumo ele usa dados carregados.

## Arquivos alterados por esta etapa

### Base e helpers

- [Design System](../app/components/ui/index.tsx)
- [Tokens e estilos](../app/globals.css)
- [Layout/viewport](../app/layout.tsx)
- [Mascaras](../lib/ui/input-masks.ts)
- [Calculo visual de progresso](../lib/ui/profile-progress.ts)
- [Indicador de perfil](../app/components/profile-progress.tsx)
- [Confirmacao apos criar vaga](../app/components/route-feedback.tsx)
- [Testes UI](../tests/ui.test.mjs)

### Telas e componentes existentes migrados

- [Login](../app/login/page.tsx), [Cadastro](../app/register/page.tsx), [Perfil generico](../app/profile/page.tsx).
- [Editor de perfil](../app/components/profile-editor.tsx), [Resumo de perfil](../app/components/profile-overview.tsx), [Camera](../app/components/camera-capture.tsx), [Logout](../app/components/logout-button.tsx).
- [Criar demanda](../app/restaurant/dashboard/jobs/create/page.tsx), [Dashboard restaurante](../app/restaurant/dashboard/page.tsx). A antiga interface de Eventos foi posteriormente descontinuada.
- [Candidatos](../app/restaurant/candidates/page.tsx), [Dashboard worker](../app/worker/dashboard/page.tsx), [Candidaturas](../app/worker/applications/page.tsx).
- [Chat](../app/chat/[jobId]/chat-client.tsx), [Fallback chat](../app/chat/[jobId]/page.tsx).
- [Check-in](../app/checkin/[jobId]/checkin-client.tsx), [Fallback check-in](../app/checkin/[jobId]/page.tsx).
- [Check-out](../app/checkout/[jobId]/checkout-client.tsx), [Fallback check-out](../app/checkout/[jobId]/page.tsx).
- [Avaliacao](../app/reviews/[jobId]/review-client.tsx), [Fallback avaliacao](../app/reviews/[jobId]/page.tsx).
- [Central de notificacoes](../app/components/notification-center.tsx), [Sino](../app/components/notification-bell.tsx), [Experiencia de notificacoes](../app/components/notification-experience.tsx).
- [Preferencias](../app/components/privacy-settings.tsx), [Controle Push](../app/components/push-notification-control.tsx), [Instalacao PWA](../app/components/pwa-install-prompt.tsx).
- [Navegacao mobile](../app/components/mobile-bottom-nav.tsx), [Guarda de sessao](../app/components/session-guard.tsx) (somente controles/fallback visual).

Nenhuma mudanca desta etapa em SQL, policies, APIs de autenticacao ou regras de acesso.
O repositorio ja tinha alteracoes anteriores nessas areas; elas nao foram revertidas.

## Validacao executada

- Testes unitarios: mascaras completas/parciais/coladas, limites, idempotencia e progresso.
- Renderizacao dos componentes: senha inicialmente oculta, toggle button, autocomplete,
  busy/disabled e preservacao de tipos/constraints de data/numero.
- Verificacao automatica de adocao dos controles e contraste dos tokens CSS reais.
- Regressao dos testes existentes de rotas, proxy, cookies e provisionamento.
- Navegador local: mostrar/ocultar preserva valor; toggle nao submete formulario.
- Cadastro nas larguras 360, 390, 430 e 1280: sem overflow horizontal, campos de 16 px,
  botoes >= 44 px e labels associados.
- Eventos nas larguras 360, 390 e 430: sem overflow horizontal e botoes >= 44 px.
- Formulario de eventos: tipos nativos e labels presentes.
- Editor restaurante: CNPJ/telefone/CEP formatados, exclusao de digito, labels e progresso
  presentes, sem overflow em 390 px. Dados de teste nao foram salvos.
- Emulacao reduced-motion: transition-duration observado como 0s.

Nao foram criados registros, alteradas contas ou enviados formularios durante os testes visuais.
Dispositivos fisicos, teclado virtual real, VoiceOver/TalkBack e push em PWA nao foram certificados.
O servidor dev exibiu avisos de instant-navigation das rotas protegidas e falhas de requisicoes
do modulo de notificacoes; nao foram ocultados ou corrigidos fora deste escopo.
Esses avisos devem ser investigados separadamente, sem alterar as regras Auth nesta tarefa.

### Comandos

```powershell
node --test tests\ui.test.mjs tests\auth-routes.test.mjs tests\auth-proxy.test.mjs
$env:EXTRACHEF_TEST_URL = 'http://localhost:3000'
node --test tests\auth-http.test.mjs
npm run lint
npm run typecheck
npm run build
```

## Sprint 2.2: Home Profissional

Escopo restrito a apresentacao da [Home](../app/worker/dashboard/page.tsx)
e CSS local em [globals.css](../app/globals.css). Reutiliza Card, Badge, Button,
Toast, EmptyState, LoadingSkeleton, identidade, reputacao e navegacao existentes.
Nao introduz componentes, hooks, servicos, dependencias, rotas ou funcionalidades.

### Hierarquia e comunicacao

- Cabecalho compacto com titulo "Sua central operacional" e saudacao secundaria.
- Operacao prioritaria antes das oportunidades; mesmo seletor, contagem, destino e
  condicoes de exibicao. CTA destacado dentro do link existente, sem controle aninhado.
- Nome acessivel do card acompanha a acao exibida, inclusive "Ver todas as operacoes".
- Status escritos com Badge: info para operacao ativa/futura, warning para
  check-in/pendencia, success para checkout liberado. Nenhum status foi recalculado.
- Avaliacao pendente antes das oportunidades; mesmo bloqueio e link de avaliacao.
- Oportunidades com leitura de titulo, status, local, data pt-BR e horario HH:mm.
  Valor com peso secundario; candidatura e compartilhamento mantidos.
- Resumo profissional depois das oportunidades; historico ao final.
  Mesmos indicadores, dados, rotulos operacionais e expressoes temporais.
- Historico com cabecalhos de coluna e regiao de rolagem identificada/focavel.
- CSS limitado a `.ec-worker-home`: raios existentes de 8/12/16 px, espacamentos
  de 8/12/16/24/32 px e elevacao existente para o card prioritario.
  Textos extensos quebram linha sem truncamento; margem inferior preserva a navegacao.

### Rubrica local de verificacao

Os aproximadamente 68% iniciais sao a referencia informada no pedido, nao uma
medicao reproduzida nesta sprint. A verificacao abaixo e local, binaria e de pesos
iguais: 18 de 20 criterios atendidos = **90%**. Nao representa certificacao ECGM,
WCAG ou teste de usabilidade, nem permite comparar diretamente as duas notas.
ECGM e criterios de aceite especificos da Sprint 2.2 nao estavam disponiveis;
a homologacao contra esses documentos permanece pendente.

| # | Criterio verificado | Resultado |
| --- | --- | --- |
| 1 | Titulo principal identificavel por h1 | Atendido |
| 2 | Operacao antes da descoberta de vagas | Atendido |
| 3 | CTA operacional destacado, com texto e nome acessivel coerentes | Atendido |
| 4 | Prioridade e destino operacional existentes preservados | Atendido |
| 5 | Avaliacao bloqueante apresentada antes das oportunidades | Atendido |
| 6 | Resumo com menor precedencia e densidade | Atendido |
| 7 | Historico separado ao final | Atendido |
| 8 | Status comunicado por texto, nao apenas cor | Atendido |
| 9 | Tons semanticos e contraste dos tokens existentes | Atendido |
| 10 | Datas localizadas | Atendido |
| 11 | Horarios sem segundos | Atendido |
| 12 | Localizacao preservada e com quebra de linha | Atendido |
| 13 | Valor nao domina o status operacional | Atendido |
| 14 | Componentes existentes, sem camada paralela | Atendido |
| 15 | Espacamento, raio e elevacao consistentes no escopo | Atendido |
| 16 | Sem overflow da pagina em 320/768/1280 px | Atendido |
| 17 | Conteudo longo e alvos de CTA >=44 px nas fixtures | Atendido |
| 18 | Ordem de Tab, foco visivel e historico focavel | Atendido |
| 19 | Reconhecimento da proxima acao em menos de 3 segundos por usuarios | Nao medido |
| 20 | Homologacao em dispositivos fisicos e leitor de tela | Nao realizada |

### Evidencias e limites

- 59 testes direcionados aprovados: operational-ui, demands, message-navigation,
  ui e worker-home-operation. Novos casos renderizam a Home real com dados sinteticos:
  operacao futura, check-in, pendencia, andamento, pagamento, checkout, multiplas
  operacoes, vazio, avaliacao bloqueante, loading, login, erros e candidaturas.
- Typecheck e ESLint da Home/testes aprovados; `git diff --check` sem erros.
- Navegador com 12 fixtures sinteticas em tres larguras (36 combinacoes),
  sem overflow horizontal da pagina; tabela mantem rolagem interna intencional.
  Conteudo longo inclui nome, titulo, restaurante e avaliacao.
- CTAs visiveis com alvo minimo de 44 px; Tab com foco visivel; candidatura
  bloqueada continua fora da sequencia de Tab, sem alterar sua condicao.
- Hooks, handlers `handleApply`/`shareJob` e selecao/destino operacional comparados
  por hashes de AST com o inicio da sprint: inalterados. Helpers de operations
  e demands tambem mantiveram seus hashes.
- Nenhuma query, RPC, permissao, API, migration, regra operacional ou destino
  de navegacao alterado nesta sprint. Alteracoes preexistentes foram preservadas.
- Fixtures de navegador nao executam backend, GPS nem submissoes reais.
  O sino usa substituto de teste; sua implementacao nao foi alterada.
  Reputacao usa dados sinteticos, sem consultar o banco.
- Inconsistencias anteriores, como o fragmento usado no compartilhamento e
  tratamento de falha na carga operacional/ganhos, nao foram alteradas.

Arquivos desta sprint: Home, globals.css, este documento,
[ui.test.mjs](../tests/ui.test.mjs) e
[worker-home-operation.test.mjs](../tests/worker-home-operation.test.mjs).
O ultimo ja existia nao rastreado antes da sprint; foi ampliado, nao criado.

## Sprint 2.2.1: correcoes de compliance da Home

Esta etapa corrige somente comunicacao e semantica. Nao altera a hierarquia,
os handlers, hooks, consultas ou selecao operacional da Sprint 2.2.
O Toast existente foi estendido com warning/danger; error continua aceito,
com a mesma aparencia e role anterior, para preservar os demais consumidores.
Danger reutiliza a aparencia de erro existente; warning utiliza os tokens existentes.

### Mapa dos feedbacks da Home

| Mensagem ou superficie | Classificacao | Role do Toast |
| --- | --- | --- |
| Candidatura enviada com sucesso. | SUCCESS | status |
| Detalhes do plantao copiados para compartilhar. | SUCCESS | status |
| O recrutamento desta operacao foi encerrado. | INFO | status |
| Antes de se candidatar novamente, avalie sua ultima experiencia. | WARNING | status |
| Compartilhamento nao esta disponivel neste navegador. | WARNING | status |
| Nao foi possivel conferir suas avaliacoes pendentes. Atualize a pagina. | DANGER | alert |
| Sua sessao expirou. Entre novamente. | DANGER | alert |
| Voce ja se candidatou a esta vaga. (retorno de conflito na candidatura) | DANGER | alert |
| Nao foi possivel enviar sua candidatura. Tente novamente. | DANGER | alert |
| Nao foi possivel compartilhar este plantao. | DANGER | alert |
| Falha de painel, perfil, foto, candidaturas, resumo ou avaliacoes | DANGER | alert |
| Falha de oportunidades (Estado C) | DANGER | alert |
| Falha de localizacao, no bloco opcional ja oculto | DANGER | alert |
| Feedback futuro sem classificacao conhecida | DANGER | alert |

O mapa cobre todos os textos emitidos por `setFeedbackMessage`; um teste extrai
esses textos dos setters existentes para impedir mensagens sem classificacao.
O compartilhamento nativo continua sem confirmacao local adicional; nao foi
alterado `shareJob` nem criado um novo feedback.

Outras mensagens da Home sao estaticas: orientacoes, login, vazio e historico
tem carater informativo, sem regiao viva adicional; avaliacao pendente usa Badge
warning; operacao futura/ativa e vaga aberta usam info, checkout liberado usa
success, check-in/pendencia usam warning. LoadingSkeleton mantem role status.
Erros de handlers e Toasts usam alert; avisos e orientacoes nao usam alert.

### Estados de oportunidades

`jobs` e `appliedJobIds` continuam vindo das mesmas consultas.
`openJobs` aplica exatamente o predicado existente `canRecruitJob(job, now)`;
`visibleJobs` exclui os IDs ja candidatados. Apenas a composicao da apresentacao
foi nomeada e reutilizada, sem modificar elegibilidade ou filtros.

| Estado | Condicao e precedencia | Titulo / descricao |
| --- | --- | --- |
| C | jobsError, antes de qualquer vazio ou lista | Nao foi possivel carregar as oportunidades. / Tente novamente. |
| A | Sem erro e openJobs.length === 0 | Nenhuma oportunidade disponivel no momento. / Novas operacoes aparecerao aqui assim que forem publicadas. |
| B | Sem erro, openJobs.length > 0 e visibleJobs.length === 0 | Voce ja se candidatou para todas as oportunidades disponiveis. / Acompanhe suas candidaturas em Minhas Operacoes. |
| Lista | Sem erro e visibleJobs.length > 0 | Mesmos cards e acoes existentes, apenas para as oportunidades ainda visiveis |

Nenhum botao de retry ou destino foi criado. Estado C e somente comunicacao;
o refresh existente permanece. A revisao do perfil do Estado A foi preservada.

### Validacao desta correcao

- 46 testes aprovados nos tres arquivos solicitados: worker-home-operation,
  ui e operational-ui. Incluem mapa completo dos feedbacks, alert exclusivo de
  erro, alias legado, contraste, estados A/B/C, precedencia do erro, lista mista,
  oportunidades inelegiveis e preservacao das acoes operacionais.
- Typecheck e ESLint dos arquivos de codigo/testes alterados aprovados;
  diff sem erros de whitespace.
- 23 fixtures da Home real com dados sinteticos, em 320/375/768/1280 px e
  ampliacoes de 100/125/150/200%: 368 combinacoes. Ampliacao emulada por viewport
  CSS reduzido e DPR correspondente via Chromium/CDP, com dimensoes observadas
  conferidas (arredondamento de ate 1 px). Nao e homologacao de zoom nativo
  em todos os navegadores ou dispositivos fisicos.
- Sem overflow horizontal da pagina; Card, CTA e texto do status preservados,
  sem truncamento critico nas superficies verificadas. Historico com rolagem
  interna intencional; ampliacao pode exigir scroll vertical, sem promessa de
  CTA sempre acima da dobra. Tab manteve foco visivel.
- Fixtures nao acessam backend nem executam candidatura, GPS ou pagamentos.
  Sino substituido apenas no teste; componentes de identidade, navegacao,
  reputacao e UI reais renderizados com dependencias simuladas.
- Hashes de AST de todos os hooks e de handleApply, shareJob, priorityOperation,
  relevantOperations e operationCardHref iguais aos do inicio desta sprint.
- Nenhuma query, RPC, API ou regra operacional alterada por esta etapa.
  Nenhuma migration, rota, hook, componente, dependencia, wrapper ou arquitetura
  paralela criado. A extensao do Toast existente e retrocompativel.

Arquivos alterados: Home, UI existente, globals.css, worker-home-operation.test.mjs,
ui.test.mjs e este documento. A aprovacao desta etapa se refere as duas pendencias
e aos criterios explicitados na Sprint 2.2.1, nao a uma certificacao integral ECGM,
WCAG ou de integracao remota.

## Sprint 2.3: Home Restaurante orientada a acao

A lapidacao usa apenas componentes e dados existentes. A hierarquia final e:
header compacto, feedbacks, pendencias, operacao em evidencia, conversas e
resumo operacional. O nome do restaurante continua visivel como identificacao
secundaria; logo, sino e avatar foram preservados.

### Hierarquia e contexto

- Pendencias sao o primeiro bloco operacional. A ordem existente permanece:
  avaliacoes, acoes operacionais, candidaturas/mensagens e equipe incompleta.
  O primeiro artigo e seu CTA recebem destaque de marca por CSS, sem novo
  ranking, filtro ou limite. Expansao e verificacao de perfil permanecem.
- Operacao em evidencia e exclusivamente `operationCards[0]`, da mesma lista
  ordenada. O primeiro card tem borda e elevacao distintas; todos continuam
  acessiveis pelos mesmos destinos. A leitura segue status, titulo, data e
  horario, local e diaria. O valor tem menor enfase.
- O CTA da primeira pendencia e principal. Sem pendencias, a primeira operacao
  ganha enfase de CTA. Criar Operacao continua no mesmo destino e e secundario
  enquanto ha contexto operacional, carga ou erro; ganha enfase primaria
  apenas no vazio confirmado. Nenhuma acao foi adicionada ou bloqueada.
- Conversas preservam inbox, elegibilidade, ordenacao e limite. Cada item
  mostra pessoa, titulo da operacao, ultima mensagem e horario, com nome
  acessivel incluindo pessoa e operacao. Sem novos rankings, SLA ou badges.
- Os mesmos tres KPIs ficam apos as conversas, em Resumo operacional:
  operacoes em andamento, proximas operacoes e mensagens nao lidas.
  Calculos e placeholders sao os mesmos, com enfase visual reduzida.
- CSS e restrito a `.ec-restaurant-home`; os componentes compartilhados nao
  foram alterados. Texto longo quebra linha, e o espaco inferior preserva
  leitura acima do CTA fixo e da navegacao, inclusive em viewport ampliado.

### Semantica

| Classificacao | Superficies | Role |
| --- | --- | --- |
| INFO | Em andamento e equipe confirmada | Badge sem regiao viva adicional |
| WARNING | Avaliacao, acoes operacionais, candidatos, mensagem pendente e equipe incompleta | Badge sem regiao viva adicional |
| SUCCESS | Confirmacao explicita do RouteFeedback existente | status |
| DANGER | pageError, pendingError, conversationError e operationsError | alert |

`operationsError` agora e visivel, sem criar estado ou alterar o loader.
Os demais erros locais usam Toast danger. O vazio Tudo em dia nao e apresentado
como confirmacao enquanto existe falha ou carga operacional conhecida.
Os mapeamentos dos componentes externos continuam os mesmos.

### Evidencias da sprint

- 60/60 testes aprovados nos cinco arquivos solicitados: restaurant-home (15),
  restaurant-message-inbox (5), restaurant-message-ui (1), operational-ui (17)
  e ui (22). O harness da Home passou a simular a UI compartilhada requerida
  pela navegacao; assercoes verificam a nova apresentacao e preservam os
  contratos de dados, agrupamento, expansao e destinos.
- Typecheck e ESLint da Home/teste aprovados; diff sem erros de whitespace.
- 14 fixtures da pagina real renderizada com dados sinteticos, incluindo
  carga, vazio, falhas, confirmacao, cada grupo de pendencia, somente operacao,
  expansao e textos longos: 224 combinacoes em 320/375/768/1280 px e
  100/125/150/200%. Ampliacao emulada por viewport CSS/DPR via Chromium/CDP,
  conferindo a largura observada com tolerancia de 1 px, nao zoom nativo.
- Nenhum overflow horizontal, CTA abaixo de 44 px, truncamento critico ou
  sobreposicao entre Criar Operacao e navegacao nas superficies verificadas.
  O resumo final pode rolar integralmente acima dos elementos fixos.
  Textos exclusivamente para leitor de tela foram excluidos da verificacao
  de clipping visual intencional. Logo nao e contabilizado como CTA.
- Inspecao visual em mobile e desktop; Tab com foco visivel. Nenhum controle
  interativo aninhado. Os testes de UI verificam contraste dos tokens.
- Fixtures usam UI, identidade, sino e navegacao reais, com dados/efeitos
  simulados; o selo existente e renderizado com identidade sintetica.
  Nao executam backend, envio de mensagens, contratacao ou pagamentos.
- Hashes de AST preservados para hooks, handlers, operationCards,
  operationActions e contagens. Comparacao textual integral da logica anterior
  ao JSX com o baseline Git, normalizando CRLF/LF, tambem identica.
- Nenhuma query, RPC, API, migration, permissao, regra, agrupamento, ordenacao,
  filtro, handler ou destino foi alterado nesta sprint. Nenhum componente,
  hook, rota, dependencia ou arquitetura paralela criado.

### Avaliacao local e limites

| Criterio da auditoria | Nota apos lapidacao |
| --- | --- |
| Clareza | 9/10 |
| Hierarquia | 9/10 |
| Contexto | 9/10 |
| Escaneabilidade | 8/10 |
| Consistencia | 9/10 |
| Responsividade | 9/10 |
| Aderencia EVC | 9/10 |

Score heuristico local: 62/70, aproximadamente 89%, ante os aproximadamente
57% registrados na auditoria anterior. As notas sao avaliacao de codigo e
apresentacao, nao medida empirica de usabilidade nem certificacao EVC/ECGM.
Reconhecimento em tres segundos por usuarios, leitor de tela, dispositivos
fisicos e integracao autenticada ainda exigem homologacao. A ampliacao pode
exigir scroll vertical. O refresh de 30 segundos, tratamento assincrono geral,
limites de dados e demais restricoes preexistentes nao foram refatorados.

Arquivos desta sprint: [Home](../app/restaurant/dashboard/page.tsx),
[globals.css](../app/globals.css),
[restaurant-home.test.mjs](../tests/restaurant-home.test.mjs) e este documento.
Esta etapa encerra a implementacao; a auditoria pos-implementacao permanece
como proxima etapa, sem inicio automatico de outra sprint.

## Sprint 2.3.1: compliance da Home Restaurante

Correcao restrita a semantica, contraste, tooltip, overlay e harness. Nao e
nova lapidacao de UX e nao modifica carregamento ou regras operacionais.

### Correcoes

- O erro de mensagens da navegacao compartilhada usa `role="alert"`.
  Na Home Restaurante, a mesma mensagem do contexto existente aparece em
  Toast danger no fluxo de feedbacks; a copia fixa da navegacao fica oculta
  por CSS somente nessa Home. Assim, o erro continua acessivel sem ocupar
  a area do CTA Criar Operacao. O erro do contador de notificacoes do mesmo
  contexto tambem recebe Toast danger, sem nova consulta ou estado.
- A regra de marca do primeiro card exclui botoes ghost, inclusive no hover.
  O selo verificado permanece azul info sobre branco em hover, focus e
  active: contraste computado 9,53:1, contra 1,30:1 no hover anterior.
- O tooltip existente limita a largura ao viewport com margem de 8 px.
  A transformacao vertical considera sua propria altura renderizada e a
  altura dinamica do viewport, preservando a margem inferior. O limite
  horizontal tambem acompanha redimensionamento com o tooltip aberto.
  Nenhum handler, hook ou mecanismo de abertura/fechamento foi alterado.
- O harness de communication carrega UI e input-masks existentes para
  resolver a dependencia da navegacao. Assercoes dos testes existentes
  cobrem role de erro, feedback no fluxo da Home, exclusao de ghost e
  restricoes do tooltip. Nenhum comportamento do produto e substituido
  para contornar falha de teste.

### Semantica final

| Classificacao | Role dos feedbacks vivos |
| --- | --- |
| SUCCESS | status |
| INFO | status |
| WARNING | status |
| DANGER | alert |

Badges informativos e de pendencia continuam sem role de regiao viva.
LoadingSkeleton continua status/aria-busy. Os consumidores globais que usam
o alias legado `error` do Toast continuam alert, sem quebra de contrato.
Erros de sessao tambem continuam alert.

### Homologacao automatizada

- 90/90 testes aprovados: restaurant-home (15), restaurant-message-inbox (5),
  restaurant-message-ui (1), operational-ui (17), ui (22),
  profile-verification (9) e communication (21); nenhuma falha.
- `npm run typecheck`, ESLint de todos os arquivos de codigo/testes desta
  etapa e `git diff --check` aprovados.
- Dez fixtures da Home real com dados sinteticos: pendencias, operacao,
  vazio, erros operacionais, erro de mensagens curto/longo, erro do contador,
  conteudo longo, muitas avaliacoes e confirmacao de publicacao.
  UI, identidade, navegacao e RouteFeedback reais; selo existente montado
  com React no navegador para foco, hover, active, teclado e tooltip.
- Matriz de 160 combinacoes: 320/375/768/1280 px e 100/125/150/200%.
  Nenhum overflow horizontal, clipping critico nas superficies verificadas,
  conflito entre navegacao e CTA ou erro visivel com role incorreto.
  Pendencias, operacao em evidencia, conversas e resumo preservados.
- Tooltip verificado em 32 casos: matriz de 16 dimensoes com o gatilho
  proximo ao topo e ao fim da viewport. Sem clipping horizontal/vertical,
  incluindo 320/150%, 320/200% e 375/200%. Redimensionamento com tooltip
  fixado de 1280 px para 160 px CSS tambem permaneceu dentro da viewport.
- CTA com erro de mensagens: hit testing e 32 ativacoes (mouse e Enter)
  em 16 dimensoes, sem obstrucao, foco visivel e alvo minimo de 44 px.
  A navegacao foi interceptada apenas na fixture; href do produto preservado.
  Tab move foco, Enter fixa o tooltip e Escape fecha sem retirar foco.
- Ampliacao emulada por viewport CSS/DPR no Chromium/CDP, com tolerancia
  de 1 px na largura observada; altura de referencia de 900 px antes da
  ampliacao. Nao e certificacao de zoom nativo, aparelhos fisicos ou leitor
  de tela. Fixtures nao executam backend nem acoes operacionais reais.

### Preservacao e limites

Hashes dos hooks e handlers da Home, navegacao e selo identicos aos do
inicio desta etapa. Toda a logica da Home anterior ao JSX permaneceu igual,
exceto a desestruturacao dos dois erros ja presentes no contexto para
apresentacao. Nenhuma query, RPC, API, migration, permissao, regra, filtro,
ordenacao, agrupamento ou destino alterado. Nenhum componente, hook,
provider, contexto, wrapper, servico, pagina, layout, dependencia ou
arquitetura paralela criado.

Os riscos preexistentes de recarga geral a cada 30 segundos, rejeicao
inesperada no loader, KPI zero apos falha e limites de dados nao fazem parte
das cinco correcoes autorizadas; continuam inalterados. A aprovacao desta
etapa e de compliance nas superficies e condicoes validadas, nao uma
certificacao irrestrita de disponibilidade ou integracao remota.

Arquivos alterados nesta etapa: [Home](../app/restaurant/dashboard/page.tsx),
[navegacao](../app/components/mobile-bottom-nav.tsx),
[selo](../app/components/verified-profile-badge.tsx),
[CSS](../app/globals.css),
[teste da Home](../tests/restaurant-home.test.mjs),
[teste de verificacao](../tests/profile-verification.test.mjs),
[teste de comunicacao](../tests/communication.test.mjs) e este documento.
Fixtures temporarias de navegador removidas apos a validacao.

## Sprint 2.4: experiencia operacional compartilhada

Implementacao somente de apresentacao. O inventario foi entregue antes das
edicoes. Nao foram criados componentes, hooks ou uma camada operacional paralela.
As Homes homologadas nao foram editadas; consumidores de OperationFlow recebem
a apresentacao compartilhada atualizada.

### Inventario e fontes de verdade

| Componente existente | Responsabilidade | Consumidores |
| --- | --- | --- |
| [DemandCard, DemandSituation, DemandActions](../app/components/demand-card.tsx) | Resumo, equipe, contexto e menu da demanda | Lista de operacoes; Situation e Actions tambem no detalhe |
| [DemandDetail / DemandEditor](../app/restaurant/demands/[demandId]/demand-detail.tsx) | Estado atual, pendencias, equipe, historico e administracao | Rota do detalhe e suas views de candidatos/perfil |
| [RestaurantDemands](../app/restaurant/demands/page.tsx) | Lista, filtros e paginacao existentes | Operacoes do restaurante |
| [OperationFlow](../app/components/operation-flow.tsx) | Status, responsabilidade, agenda, proxima acao e etapas | Detalhe, painel, candidaturas profissionais e chat |
| [OperationalPanel](../app/components/operational-panel.tsx) | Contexto e controles da etapa operacional | Check-in, pagamento e checkout |
| [TeamBoard / NextAction](../app/restaurant/team/team-center.tsx) | Contratacoes e detalhe com timeline | Equipe |
| [TalentCenter](../app/restaurant/candidates/talent-center.tsx) | Situacao do participante no contexto da demanda | Talentos; ajuste restrito ao badge de contratado |
| [DemandPersonSummary](../app/components/demand-person.tsx) | Identificacao do participante | Detalhe e rede de talentos; erro de foto usa alert |

Badge, Button, Card, Toast e VerifiedProfileBadge continuam os existentes.
Nao existe novo componente chamado OperationStatus ou OperationContext: os
status sao apresentados nos consumidores atuais, a partir de
[operations](../lib/operations.ts), [demands](../lib/demands.ts) e
[restaurant-team](../lib/restaurant-team.ts), sem alterar essas fontes.

### Hierarquia e CTAs

- DemandCard: status dominante, responsavel e CTAs antes da agenda; depois,
  local, equipe e acoes secundarias. Os dois destinos existentes permanecem
  iguais, inclusive o fragmento people-heading. O card nao exibia valor nem
  recebe timestamps individuais de pagamento/check-in: esses estados nao
  foram inventados nem derivados de novas consultas.
- Detalhe: status atual, responsavel, proxima acao e agenda; pendencias;
  OperationFlow por participante; equipe; historico significativo e
  informacoes administrativas. Valor, endereco, mapa e observacoes deixam
  de competir com a acao. A selecao existente de nextAction, inclusive a
  precedencia de avaliacao e substituicao, permanece intacta.
- O resumo do detalhe reutiliza getOperationFlow para apresentar a operacao
  ja escolhida por pendingOperation. Nao escolhe outra operacao, participante
  ou prioridade. Cada participante continua com seu estado individual.
- O menu nativo details expande no fluxo e limita sua largura. Aberto, nao
  cobre candidatos ou CTAs, inclusive em 160 px CSS.
- Listas: borda de atencao nas pendencias, tratamento info em andamento e
  menor peso nas encerradas, sem opacidade que reduza contraste. Nenhuma
  linha foi movida, filtrada ou reagrupada por esse tratamento.
- Equipe explicita proxima acao e responsavel; nomes longos podem quebrar
  linha. Estados e prioridades de TeamHire continuam intactos. Apenas
  textos e cores de apresentacao sao adaptados no consumidor.
- Confirmar Check-in, Confirmar Pagamento, Confirmar Recebimento, Realizar
  Checkout, Acompanhar recebimento e Acompanhar etapas da operacao esclarecem
  a intencao. No resumo do restaurante, o link de checkout explica gerar o
  codigo, sem trocar seu destino nem a elegibilidade.

### EVC operacional

| Classe | Aplicacao nesta camada | Semantica acessivel |
| --- | --- | --- |
| INFO | Equipe confirmada/contratacao aprovada, trabalho em andamento | Status operacional vivo usa status; badges estaticos nao anunciam novamente |
| WARNING | Equipe incompleta, check-in, pagamento, recebimento, checkout ou avaliacao pendentes | status quando anunciado como estado vivo |
| SUCCESS | Etapa concluida, operacao concluida, checkout realizado | status quando anunciado como estado vivo |
| DANGER | Estado indisponivel, pagamento contestado, ausencia/abandono e erros | alert nos estados vivos de Flow/Panel e nos erros |
| NEUTRAL | Agenda, local, contexto, futuro e cancelamento administrativo | Conteudo estatico; sem alerta |

Risco de equipe incompleta nao e erro operacional: health continua o mesmo,
mas sua apresentacao usa warning. Recebimento confirmado nao significa que o
checkout ja terminou: checkout pendente usa warning no status, badge da
etapa e marcador. Em Talentos, aprovado usa info, nao sucesso de conclusao.
O alias error dos Toasts continua alert, sem mudar o componente compartilhado.

A timeline de OperationFlow continua com seis etapas: Operacao, Contratacao,
Check-in, Pagamento, Checkout e Conclusao. Recebimento permanece descrito no
pagamento; avaliacao aparece nas pendencias/equipe e na timeline ja existente
de Equipe. Nao foram adicionadas etapas, eventos ou novas regras de transicao.
O historico conserva ordem, limites, expansao e criterio de cartao separado.

### Evidencias e limites de validacao

- 168/168 testes, zero falhas, em 22 suites: demands, demand-detail,
  operational-ui, ui, communication, restaurant-team, talent-board,
  worker-home-operation, restaurant-home, restaurant-message-ui,
  restaurant-message-inbox, message-navigation, profile-verification,
  checkin-api, demands-sql, recruitment-sql, operational-trust-sql,
  operational-location-readiness-sql, restaurant-operational-locations-sql,
  demand-restaurant-location-sql, talent-directory-sql e
  profile-verification-sql. Suites SQL inspecionam contratos; nenhuma
  migration foi executada.
- O harness de detalhe ganhou a dependencia UI ja exigida por OperationFlow
  e passou a renderizar DemandActions real. Testes verificam ordem visual,
  responsabilidades, semantica, destinos e ausencia de mutacoes no render.
- `npm run typecheck`, ESLint dos arquivos de codigo/testes desta etapa e
  `git diff --check` aprovados.
- 54 fixtures sinteticas usando componentes reais: Flow nos dois papeis,
  fases operacionais, estado indisponivel, Panel, cards, detalhe e suas
  pendencias, lista de demandas, lista de equipe e drawer.
- 864 combinacoes em 320/375/768/1280 px e 100/125/150/200%, incluindo
  menus expandidos e nomes longos: sem overflow da pagina ou clipping
  horizontal critico. Scroll horizontal intencional dos filtros foi
  preservado; scroll vertical continua necessario em ampliacao.
- 96 cenarios de interacao: 992 hit tests e 992 verificacoes de foco
  aprovados; 16 ativacoes por Enter e 16 por mouse em CTAs com navegacao
  interceptada exclusivamente na fixture. O foco por teclado tem outline
  visivel e os destinos permanecem os do produto.
- Tooltip real montado em React: 32 casos, topo/fim da viewport, sem clipping;
  Enter fixa, Escape fecha preservando foco e Tab avanca. Nenhuma alteracao
  foi necessaria no selo ou nos seus handlers.
- Contraste computado dos badges: info 8,71:1, warning 6,38:1,
  success 6,49:1, danger 6,65:1, neutral 9,16:1. Minimo superior a 4,5:1.
- Comparacao AST com o inicio desta sprint: hooks, handlers JSX, funcoes de
  acao, consultas e destinos identicos nos sete consumidores principais.
  Logica anterior ao render, selecao, filtros e agrupamentos preservados.
  Os cinco helpers de dominio e os manifests/lockfile permanecem identicos
  byte a byte. Alteracoes preexistentes no worktree nao foram revertidas.
- Nenhuma query, RPC, API, migration, permissao, regra operacional,
  ordenacao, agrupamento, handler ou destino alterado nesta sprint.
  Nenhum componente, hook, provider, contexto, wrapper, layout, pagina,
  rota, servico, dependencia ou arquitetura paralela criado.

Ampliacao emulada por viewport CSS/DPR no Chromium/CDP, nao zoom nativo
certificado. Fixtures nao executam backend, GPS, pagamento ou contratacao
reais. Talentos recebeu somente uma troca de tone; nao se afirma homologacao
integral de seu layout autenticado. Reconhecimento em menos de tres segundos
nao foi medido com usuarios. Leitor de tela e aparelhos fisicos continuam
dependendo de homologacao dedicada.

Avaliacao heuristica local: 72/80 (90%): clareza, hierarquia, contexto,
consistencia, EVC e responsividade 9/10; acessibilidade 8/10; preservacao
arquitetural 10/10. Indica aderencia tecnica local superior a 85%, nao uma
certificacao EVC/ECGM ou aprovacao definitiva de usabilidade. Implementacao
encaminhada para Auditoria Pos-Implementacao da Sprint 2.4; nao inicia
automaticamente outra sprint.

Arquivos desta etapa: os oito componentes/paginas do inventario acima,
[globals.css](../app/globals.css), este documento e os testes
[demands](../tests/demands.test.mjs),
[demand-detail](../tests/demand-detail.test.mjs),
[operational-ui](../tests/operational-ui.test.mjs) e
[restaurant-team](../tests/restaurant-team.test.mjs).
Fixtures temporarias removidas apos a validacao.

## Sprint 2.5: Talent Experience

Implementacao de apresentacao sobre TalentCenter, DemandTalentNetwork,
DemandPersonSummary e VerifiedProfileBadge existentes. RestaurantCandidatesPage,
ProfessionalVerificationProvider, TeamBoard e as fontes operacionais permanecem
inalterados. Nao foram criados componentes, hooks customizados ou providers.

- Busca, funcao, cidade e relacionamentos usam o mesmo predicado em candidatos,
  convidados, interesses e recomendacoes. Os contadores correspondem aos cards
  dos respectivos grupos apos os filtros.
- O ranking, desempates e limite de tres recomendacoes foram preservados.
  Convidar uma pessoa a move para Convidados sem ocultar as demais sugestoes.
  A rede completa continua no destino existente do detalhe da operacao.
- Identidade, historico proprio, avaliacoes, experiencia e operacoes sao lidos
  nessa ordem. O selo explica que identidade validada nao certifica qualificacao
  ou disponibilidade. Reputacao privada/ausente nao vira zero operacoes.
- Motivos de recomendacao utilizam apenas especialidades compativeis,
  relacionamentos e avaliacoes realmente compartilhadas. Nao ha agenda,
  distancia ou disponibilidade inferida.
- Convite enviado, aceite pendente de avaliacao, candidatura aguardando
  aprovacao e contratacao confirmada mantem os mesmos estados de dominio.
  A aprovacao continua exigindo confirmacao explicita e a mesma RPC.
- A central reutiliza seu carregamento ao receber foco e a cada trinta segundos.
  O relogio de elegibilidade continua em um segundo. Queries, argumentos,
  janelas, seletores operacionais e ordenacao nao mudaram.
- Erros de contratacao aparecem na confirmacao; erros de convite no contexto
  ativo. Repetir tenta a mesma acao. Avaliacoes/historico opcionais usam warning
  e controles explicitos de recarga; erros de diretorio/contratacao usam alert.
- A confirmacao conserva contexto apos a ultima vaga e oferece Equipe,
  Operacao e Chat. O link de chat usa o job efetivamente aprovado no
  carregamento existente, nunca um job presumido antes da RPC.
- Dialogos existentes usam o elemento nativo dialog para isolamento e teclado.
  O tooltip usa o dialogo aberto como destino do portal quando aplicavel.
  Abas possuem associacao com painel e navegacao por setas/Home/End.
- O perfil nao depende mais de quarenta por cento do viewport. Nome e textos
  extensos podem quebrar; metricas usam duas colunas e acoes podem empilhar.

Regressoes automatizadas cobrem os grupos filtrados, contadores, permanencia
apos convite, privacidade, aceite remoto, erro/retry da aprovacao e continuidade
da ultima vaga. Contratos SQL, regras de elegibilidade e integracao com Equipe
continuam cobertos pelas suites existentes.
Baseline: 122 testes relacionados, typecheck aprovado e lint sem erros.
Validacao ampliada: 154/154 testes em 21 suites, typecheck aprovado e lint
sem erros; permanecem dezesseis warnings preexistentes no bundle gerado do
Android. As chamadas de dados foram comparadas por AST com o baseline;
os helpers de classificacao/ranking e as fontes protegidas foram preservados.

**Status: implementacao nao homologada.** A fixture interativa isolada de
navegador foi bloqueada pela politica do sandbox ao resolver metadados de
pacote no diretorio do usuario. A matriz 320/375/768/1280 em
100/125/150/200%, tooltips dentro dos dialogos e restauracao real de foco
continuam pendentes de execucao. Testes de componentes/SQL e verificacao de
tipos nao substituem essa homologacao. Nao se declara a sprint concluida nem
se atribui score EVC aprovado antes dessas evidencias.

## Sprint 2.5.2: final fixes

Escopo restrito a FF-001, FF-002 e FF-003 nos dois componentes existentes.
Nao foram alterados queries, RPCs, elegibilidade, triggers ou assignments.

- FF-001: o erro e sua origem usam o mesmo registro existente de falha.
  Uma carga completa bem-sucedida limpa somente a falha de diretorio;
  erros de convite/contratacao nao desaparecem por uma recarga automatica.
- FF-002: apos fechar uma confirmacao que falhou, Tentar novamente restaura
  profissional e operacao da tentativa e reabre o dialogo. Nenhuma RPC de
  contratacao e executada ate a nova confirmacao explicita. A elegibilidade
  continua sendo validada pelo fluxo existente.
- FF-003: Escape e interceptado apenas enquanto o tooltip esta aberto.
  O primeiro Escape fecha o tooltip; o seguinte permite o cancelamento
  nativo do dialogo, inclusive com o foco mantido no selo.

Regressoes adicionadas cobrem recuperacao por foco/temporizador, preservacao
de erro de convite, retry de contratacao apos cancelar e trocar de operacao,
e dois Escapes consecutivos apos abrir o tooltip por foco, mouse ou clique.
A homologacao integral 2.5.1 continua sendo uma etapa separada; o bloqueio
externo de navegador registrado acima nao equivale a uma falha visual.
Validacao dos fixes: os tres testes especificos falharam antes da correcao
e passaram depois. Resultado final: 158/158 testes em 21 suites, typecheck
aprovado e lint sem erros (dezesseis warnings preexistentes no bundle Android).
A reproducao isolada em navegador confirmou tooltip fechado no primeiro
Escape e dialogo fechado no segundo, com retorno ao acionador.
Comparacao com baseline preservou todos os contratos de dados e arquivos
protegidos; somente dois componentes, dois testes e este documento mudaram.

Reexecucao 2.5.1: descoberta, filtros, contadores, privacidade, estados,
contratacao e continuidade aprovados nos cenarios automatizados. As portas
locais 3000 e 4195 nao estavam disponiveis. A matriz responsiva de dezesseis
combinacoes e a acessibilidade integral do produto permanecem como bloqueio
externo de homologacao, nao como validacao aprovada ou defeito demonstrado.
Sprint 2.5.2 concluida; Talent Experience permanece aberta para homologacao.

## Sprint 2.6A: Operation Core

O detalhe da operacao passa a exibir, nesta ordem: Estado Atual, Resumo
Operacional, Acao Necessaria, Central de Presenca e Proxima Etapa. Fluxo
individual, equipe, substituicoes, agenda, dados administrativos e historico
permanecem nas superficies existentes. Nenhuma consulta adicional e feita.

Os helpers puros `getOperationSummary`, `getOperationState` e
`getOperationContinuation`, em `lib/operations.ts`, recebem a demanda de
`buildDemands`, janelas por job de `demandWindow`, assignments ja carregados,
avaliacoes pendentes e os gates atuais de contratacao/recrutamento.
Nao consultam nem modificam dados. Os destinos individuais continuam usando
`getOperationFlow` e `operationNextAction`; os contratos de Equipe,
incluindo `describeHire`, permanecem intactos.

- Estado principal unico: Finalizada > Financeiro > Encerramento >
  Em andamento > Preparacao > Planejada. Conclusao confirmada pela demanda
  exige que nenhum vinculo vigente aguarde checkout; checkouts de toda a
  equipe completa tambem permitem finalizar o acompanhamento. Sem pendencias
  operacionais, Finalizada prevalece sobre dados financeiros residuais,
  sem certificar liquidacao financeira. Cancelamento e arquivamento
  preservam seu contexto.
- Atividade exige check-in real. O relogio e a contratacao, isoladamente,
  nao comprovam trabalho em andamento. Equipe aguardando chegada apos o
  inicio permanece em preparacao.
- Resumo: equipe vigente, presentes sem checkout/interrupcao, chegadas
  pendentes estritamente depois de cinco minutos, ausencias explicitamente
  confirmadas e checkouts realizados. Contagens sao de vinculos por job;
  historicos de substituicao nao acrescentam membros a equipe vigente.
- Presenca: cada vinculo aparece em um unico grupo. Checkout prevalece
  sobre chegada; chegada apos cinco minutos e atraso. Ausencia exige
  `interruption = absent`. Outras interrupcoes ficam no historico.
  Um profissional que chegou tarde continua incluido no total de presentes
  do resumo, mas aparece somente em Atrasados na central.
- Acao principal: financeiro > checkout > check-in > contratacao >
  candidaturas. Pagamento informado nao equivale a recebimento confirmado.
  Contestacao aponta para regularizacao pelo restaurante. Navegacao para
  chegada tardia apenas abre a conferencia existente; nao confirma presenca.
- Continuidade usa a mesma leitura do Action Center, com uma unica
  recomendacao atual e explicacao da etapa seguinte. Avaliacoes e ocorrencias
  continuam acessiveis sem sobrepor pendencias prioritarias. Contratacao
  fechada aponta para conferencia, nunca executa aprovacao ou reabre janela.
- Dados ausentes, conflitantes, horarios invalidos ou falha de carga tornam
  indicadores e acao indisponiveis, com erro e recarga explicitos. Nao ha
  fallback para zero nem conclusao automatica por ausencia de dados.
  A atualizacao existente por foco/temporizador recalcula todos os blocos.

Escopo de integracao: centro agregado no detalhe da operacao. Home e Equipe
mantem suas consultas e resumos individuais, sem fabricar dados que seus
contratos nao carregam. Testes confrontam os destinos operacionais do nucleo,
fluxo individual e Equipe para os mesmos participantes e fases.

OE-005 permanece fora do escopo: sem saldo consolidado, processamento,
liquidacao, pagamentos parciais ou novos eventos financeiros. Nenhuma
migration, RPC, query, trigger, assignment, provider ou hook global foi
criado ou alterado nesta sprint. A homologacao visual e autenticada 2.6.1
permanece uma etapa separada.

## Sprint 2.6.2: final fixes H-01 e H-02

- H-01: equipe incompleta nao recomenda completar ou contratar quando
  `canHire` e `canRecruit` estao ambos bloqueados. Havendo atividade real,
  a recomendacao e acompanhar a operacao. Sem atividade, orienta conferir
  a equipe e informa que a contratacao esta indisponivel. Os gates e as
  prioridades de financeiro, checkout, check-in e ocorrencias nao mudam.
- H-02: o estado de erro existente separa avaliacoes das fontes consultadas
  pelo refresh parcial. Foco e temporizador nao recarregam avaliacoes e,
  portanto, nao apagam seu erro. A recarga completa existente deve consultar
  `loadPendingReviews` novamente e receber sucesso antes de limpar essa
  falha. Enquanto isso, o nucleo permanece indisponivel e nao recomenda
  encerrar o acompanhamento.

Nao foram criados hooks, componentes ou chamadas de dados. Os quatro casos
H-01 e os cinco casos H-02 possuem cobertura nos testes existentes, incluindo
recuperacao com lista vazia valida e recuperacao com avaliacao pendente.
Os fixes nao equivalem a aprovacao da homologacao visual 2.6.1 e nao
autorizam o inicio da Sprint 2.6B.

## Sprint 2.6.3: reflow e consistencia do cancelamento

- D-01: a navegacao existente preserva destinos, icones, `aria-current` e
  `aria-label`. Os rotulos visuais recebem `hidden` quando
  `window.innerWidth <= 375`. Estado local atualizado na montagem e no
  evento resize, com remocao do listener no unmount. Acima de 375 CSS px
  permanecem icone e texto, independentemente da densidade do monitor.
  Nao usa media query de resolucao, devicePixelRatio ou inferencia de zoom.
- D-02: o CTA principal mantem seu href e sua condicao. Um span com
  `min-width: 0` e `overflow-wrap: anywhere` permite quebrar palavras
  dentro do flex item. O botao mantem `white-space: normal`,
  `word-break: break-word` e altura minima de 44 px.
- D-03: no detalhe cancelado, a apresentacao terminal substitui o fluxo
  de etapas ativas, usando Card/Badge/classes existentes e links locais
  para a linha do tempo. Comunica Operacao Cancelada, Consultar historico,
  Revisar motivo e Encerrar acompanhamento. Nao executa encerramento nem
  altera registros. Operacoes nao canceladas mantem o mesmo OperationFlow.
  `getOperationFlow` e os demais helpers operacionais nao foram alterados.

A suite permanente fica em `tests/e2e`, com login de restaurante por
variaveis de ambiente, storage state local ignorado pelo Git, quatro
projetos autenticados e setup separado. Sem credenciais ou URL da operacao,
os casos correspondentes sao ignorados antes de inicializar o navegador.
Credenciais incorretas, pagina inacessivel e dados incompativeis falham;
nao sao convertidos em skip.

Os testes medem geometria dos icones/rotulos, contencao do texto do CTA,
hit testing, foco por teclado, axe critical e narrativa cancelada.
A matriz CDP cobre quatro viewports por quatro fatores de reflow
equivalente; nao deve ser anunciada como certificacao de zoom nativo.
D02-004 exige texto contido e ausencia de clipping, nao quebra obrigatoria
de linha. A matriz espera compactacao somente pela largura CSS efetiva.
As cinco expectativas visuais usam `expect(page).toHaveScreenshot` com
recorte do bloco, mascarando agenda e dados pessoais variaveis.
Baselines precisam ser geradas e revisadas no ambiente alvo antes do CI;
nao ha atualizacao automatica de snapshots no workflow.

O workflow preserva a ordem ci, typecheck, lint, build, instalacao dos
navegadores e Playwright. Segredos de login nao entram em codigo ou
artefatos do setup. Traces/videos de falha dos testes autenticados podem
conter informacoes da conta: os uploads devem permanecer com acesso
restrito. Evidencias, limites e resultado desta execucao:
[Sprint 2.6.3](homologation/sprint-2.6.3-evidences.md).
Skips e validacao estatica do workflow nao equivalem a aprovacao E2E.

## Checklist de homologacao

- [ ] iPhone Safari/PWA: notch, Dynamic Island, orientacao horizontal e teclado aberto.
- [ ] Android Chrome/PWA: retorno do teclado, botao voltar e safe area inferior.
- [ ] Zoom 200%, font scaling e conteudo longo sem sobreposicao.
- [ ] VoiceOver/TalkBack: labels, campo senha, feedback, progresso e ordem de leitura.
- [ ] Teclado desktop: foco visivel, Tab/Shift+Tab, Escape no sino e setas nas estrelas.
- [ ] CPF/CNPJ invalidos continuam recusados ao salvar; mascara nao burla validacao.
- [ ] Datas/horarios enviados no mesmo formato anterior em todos os navegadores.
- [ ] Cadastro/login/redirects e sessao continuam funcionando sem mudanca de regras.
- [ ] Submissoes reais em homologacao: evento, vaga, candidatura, perfil e avaliacao.
- [ ] Estados de erro/rede lenta, loading e vazio em cada papel.
- [ ] Popup, toast e teclado nao cobrem a resposta rapida em dispositivos reais.
- [ ] Imagens/arquivos longos e formularios de perfil worker em aparelho real.
