# Sprint 2.6.3 - evidencias e limites de validacao

## Resultado

**Implementacao realizada; encerramento bloqueado.**

D-01, D-02 e D-03 foram corrigidos e verificados na sessao autenticada
compartilhada. A suite Playwright foi criada, mas seus casos autenticados
nao executaram por ausencia das variaveis exigidas. Nao declarar
SPRINT 2.6.3 CONCLUIDA nem aprovar a homologacao 2.6.1 com esse resultado.

## 1. Baseline

- Branch: `sprint-2.6.2-final-fixes`.
- Commit: `7d03a39dd1a6ac090a324cbf20a3ae6816ba3270`.
- Git inicial: 41 entradas modificadas e seis nao rastreadas, incluindo
  entradas de diretorios; todas preexistentes.
- Typecheck: aprovado.
- ESLint: zero erros; 16 warnings preexistentes no Android gerado.
- Regressao inicial: 171/171 testes, zero falhas, nos 11 arquivos abaixo.
- Ambiente: Windows, Next local e Chromium autenticado compartilhado.
- Sem credenciais `PLAYWRIGHT_EMAIL`/`PLAYWRIGHT_PASSWORD` no runner.
  As URLs opcionais tambem nao estavam definidas no runner.
- Screenshots anteriores capturados antes das alteracoes de produto.
- Nenhum commit, stash, migration ou registro de negocio criado.

## 2. Inventario

### Criados

- [Config](../../playwright.config.ts).
- [Variaveis e skip](../../tests/e2e/fixtures/env.ts).
- [Dados e verificacoes compartilhadas](../../tests/e2e/fixtures/test-data.ts).
- [Login](../../tests/e2e/setup/auth.setup.ts).
- [Responsividade e CTA](../../tests/e2e/operation-core-responsive.spec.ts).
- [Cancelamento](../../tests/e2e/operation-core-cancelled.spec.ts).
- [Acessibilidade](../../tests/e2e/operation-core-accessibility.spec.ts).
- [Matriz e snapshots](../../tests/e2e/operation-core-viewports.spec.ts).
- [Workflow](../../.github/workflows/playwright.yml).
- Este documento.

### Alterados

- [Bottom navigation](../../app/components/mobile-bottom-nav.tsx).
- [Detalhe](../../app/restaurant/demands/[demandId]/demand-detail.tsx).
- [Design system](../design-system.md).

### Excecoes explicitas a lista permitida

| Arquivo | Motivo | Impacto |
|---|---|---|
| [package.json](../../package.json) | Declarar `@playwright/test` e `@axe-core/playwright`, ausentes no baseline | Dependencias de desenvolvimento; sem runtime de produto |
| [package-lock.json](../../package-lock.json) | Registrar instalacao reproduzivel para `npm ci` | Lockfile atualizado pelo npm |
| [.gitignore](../../.gitignore) | Excluir sessao autenticada, relatorios e artefatos | Evita versionar tokens e dados capturados |

[operations.ts](../../lib/operations.ts) e
[operation-flow.tsx](../../app/components/operation-flow.tsx) nao foram
alterados nesta sprint. As modificacoes anteriores nesses arquivos foram
preservadas. Nenhum teste unitario existente foi alterado.

## 3. D-01 - Bottom navigation

Antes: rotulos de seis destinos se sobrepunham no reflow movel ampliado.
Depois: icones sem rotulos visuais em largura compacta, preservando nomes
acessiveis, destinos e item atual.

- Breakpoint: largura abaixo de 376 CSS px; inclui 375 px fracionarios.
- Resolucao a partir de 1.25 dppx tambem seleciona modo compacto.
- Desktop 1280 px/1 dppx conserva texto e icone.
- Limitacao: dppx tambem inclui densidade do monitor. A regra compacta
  telas de alta densidade de forma conservadora; nao identifica zoom
  nativo universalmente nem certifica pinch zoom.
- Verificacao direta: 16 combinacoes de quatro viewports por quatro
  fatores; seis links nomeados, icones contidos, sem sobreposicao ou
  overflow global. Limite de 375 px verificado separadamente.

| Cobertura permanente | Verificacao direta na sessao | Runner autenticado |
|---|---|---|
| D01-001: 320x568/100% | Conforme | Skip |
| D01-002: 320x568/125% equivalente | Conforme | Skip |
| D01-003: 320x568/150% equivalente | Conforme | Skip |
| D01-004: 320x568/200% equivalente | Conforme | Skip |
| D01-005: 375x812/200% equivalente | Conforme | Skip |

[Antes](../../test-results/evidence/mobile-nav-before.png) /
[Depois](../../test-results/evidence/mobile-nav-after.png).

## 4. D-02 - CTA

Antes: em 320x568/200% equivalente, botao de 63.2 CSS px continha linha
de texto de 77.44 px, excedendo aproximadamente 7.1 px de cada lado.
Depois: texto dentro do botao, largura 63.2 px e altura 98 px, com quebra
real. Area central continuou atingivel e `click({ trial: true })` passou,
sem navegar nem enviar formulario.

| Cobertura permanente | Verificacao direta | Runner autenticado |
|---|---|---|
| D02-001: texto dentro do botao | Conforme | Skip |
| D02-002: largura/altura >=44 px | Conforme | Skip |
| D02-003: sem clipping e atingivel | Conforme | Skip |
| D02-004: quebra em multiplas linhas | Conforme | Skip |

O destino da avaliacao e sua condicao nao mudaram.
[Antes](../../test-results/evidence/cta-before.png) /
[Depois](../../test-results/evidence/cta-after.png).

## 5. D-03 - Cancelamento

Antes: estado principal Cancelada e orientacao de historico coexistiam
com Aguardando contratacao, Acompanhar contratacao e pedido para contratar.
Depois: bloco terminal Operacao Cancelada, Encerrar acompanhamento,
Consultar historico e Revisar motivo.

O detalhe deixa de renderizar etapas ativas apenas quando o contrato
existente informa `demand.cancelled`. Os links apontam para a linha do
tempo existente, sem requisicoes novas ou encerramento mutante.

| Cobertura permanente | Verificacao direta | Runner autenticado |
|---|---|---|
| D03-001: estado/fluxo cancelados | Conforme | Skip |
| D03-002: sem CTA de contratacao | Conforme | Skip |
| D03-003: historico e motivo | Conforme | Skip |
| D03-004: encerrar acompanhamento | Conforme, orientacao textual | Skip |
| D03-005: sem narrativa/etapa ativa | Conforme | Skip |

[Antes](../../test-results/evidence/cancelled-before.png) /
[Depois](../../test-results/evidence/cancelled-after.png).

## 6. Acessibilidade

| Caso | Verificacao direta na sessao compartilhada | Runner |
|---|---|---|
| A11Y-001 | Axe no main: zero critical; um tipo moderate, landmark-unique, em dois nos | Skip |
| A11Y-002 | Tab, Shift+Tab, Enter e Space verificados sem acionar mutacoes | Skip |
| A11Y-003 | CTA focado por teclado, focus-visible e outline de 2.4 px | Skip |
| A11Y-004 | Seis links com aria-label, preservados no modo compacto | Skip |
| A11Y-005 | CTA acima de 44 px nas duas dimensoes | Skip |

Isso nao representa certificacao WCAG integral. O apontamento moderate
preexistente nao foi corrigido fora do escopo. O erro de schema do selo
de perfil observado anteriormente tambem permanece fora destes fixes.

## 7. Playwright

- Projetos: setup, authenticated-desktop, authenticated-tablet,
  authenticated-mobile, authenticated-mobile-small.
- Viewports: 1280x800, 768x1024, 375x812, 320x568.
- 145 casos expandidos: um setup e 36 casos em cada projeto autenticado.
- Ultimo `npx playwright test`: **145 skipped, zero testes aprovados,
  zero falhas**, exit code 0. Skip nao e aprovacao.
- Credenciais ausentes ignoram antes das fixtures de navegador.
  URL opcional ausente ignora o grupo correspondente.
- HTML em `playwright-report`, JUnit em `playwright-artifacts/junit.xml`,
  resultados em `test-results/runs`; evidencias em `test-results/evidence`.
- Trace/video/screenshot de falha habilitados nos testes, mas nao no
  login para nao capturar credenciais. Nao houve video/trace de teste
  aprovado nesta execucao, pois os casos autenticados foram ignorados.

Houve uma tentativa inicial de probe HTTP incompativel com o proxy local
e uma execucao interrompida por navegador ausente no sandbox daquela
sessao. O skip antecipado foi corrigido para nao depender desses recursos
quando faltam as variaveis. Nao converter esses erros iniciais em
evidencia de teste funcional aprovado.

### Regressao visual

Expectativas criadas com os nomes exatos:

- `operation-state.png`
- `operation-summary.png`
- `operation-action-center.png`
- `operation-presence.png`
- `operation-continuation.png`

`expect(page).toHaveScreenshot` usa recorte documental do bloco inteiro.
Agenda e participantes variaveis sao mascarados, sem mascarar contagens,
estado ou CTA. Nao foram fabricadas baselines a partir de uma execucao
ignorada. Os snapshots ainda precisam ser gerados, revisados e
versionados no ambiente alvo. Os arquivos gerados pelo padrao do
Playwright em `tests/e2e/operation-core-viewports.spec.ts-snapshots`
serao uma excecao necessaria a lista de arquivos na etapa de aprovacao;
nenhum foi criado nesta execucao.

Configurar as quatro variaveis exigidas/condicionais no ambiente do
processo; o runner nao importa credenciais da sessao compartilhada.
Usar uma operacao finalizada com avaliacao pendente para exercitar o CTA
e uma cancelada com historico. Nao ha UUIDs hardcoded nos testes.

```powershell
npx playwright test operation-core-viewports.spec.ts --update-snapshots
npx playwright test
```

O primeiro comando so deve ser usado para estabelecer/revisar baselines
intencionais, nao para aprovar automaticamente uma regressao.

## 8. Typecheck, ESLint e regressoes

- `npm run typecheck`: aprovado apos a implementacao.
- `npm run lint`: zero erros; os mesmos 16 warnings do baseline.
- 171/171 testes aprovados; zero falhas e zero skips.
- Seis arquivos obrigatorios executados junto das regressoes relacionadas:

```text
tests/demands.test.mjs
tests/demand-detail.test.mjs
tests/operational-ui.test.mjs
tests/restaurant-team.test.mjs
tests/restaurant-home.test.mjs
tests/worker-home-operation.test.mjs
tests/ui.test.mjs
tests/profile-verification.test.mjs
tests/checkin-api.test.mjs
tests/restaurant-history.test.mjs
tests/talent-board.test.mjs
```

H-01 e H-02 permanecem cobertos e aprovados nessa suite.

## 9. Github Actions e build

- YAML parseado e ordem dos seis comandos obrigatorios conferida.
- Upload always: playwright-report, test-results e playwright-artifacts.
- Storage state de autenticacao nao faz parte do upload.
- Credenciais via secrets; URLs de operacoes/base via vars.
- O build local usa tambem os valores existentes
  NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY; o workflow os
  recebe por secrets. Nenhum valor foi copiado para codigo.
- `npm run build` falhou duas vezes em panic do Turbopack: processo Node
  do loader CSS encerrou com codigo 0 antes da conexao. Nenhuma evidencia
  permite atribuir esse panic aos fixes. Nao se alterou o bundler ou a
  configuracao de CSS para contorna-lo.
- Feedback Next executado uma vez; CLI terminou sem saida.
- Workflow criado e validado estaticamente; **execucao completa local/CI
  nao aprovada**, por build e autenticacao pendentes.
- Nenhum workflow remoto foi disparado ou commit enviado.

## 10. Evidencias

As seis imagens exigidas existem localmente. Antes foi capturado uma
vez no produto anterior; depois foi capturado apos os fixes. Os testes
tambem salvam automaticamente as imagens after quando o projeto desktop
executa com dados reais. O outputDir de testes e uma subpasta para nao
apagar as evidencias anteriores a cada execucao.

Relatorios e imagens sao artefatos locais ignorados pelo Git. Os links
relativos acima funcionam na copia de trabalho; nao implicam upload ou
versionamento. Nao publicar artefatos autenticados sem revisar privacidade.

## 11. Arquitetura

- [x] Nenhuma query nova ou alterada no produto.
- [x] Nenhuma RPC nova ou alterada.
- [x] Nenhuma migration criada.
- [x] Nenhum trigger ou assignment alterado.
- [x] Nenhum provider, hook global ou componente estrutural criado.
- [x] Nenhuma arquitetura paralela ou novo fluxo de negocio.
- [x] Contratacao, presenca, pagamento e checkout preservados.
- [x] Helpers existentes e erros H-01/H-02 preservados.
- [x] Alteracoes anteriores do usuario preservadas.

Conferencia adicional contra os checkpoints tecnicos salvos: 337 arquivos
protegidos mantiveram seus hashes; as 32 chamadas de dados protegidas
mantiveram seus textos AST normalizados; `lib/operations.ts` permaneceu
identico ao checkpoint validado da 2.6.2.

## 12. Pronto para reexecutar Sprint 2.6.1?

**NAO, segundo o criterio integral de encerramento solicitado.**

Pendencias comprovadas:

1. Configurar credenciais e URLs do runner e executar os 145 casos sem
   considerar skips como aprovacao.
2. Gerar/revisar as cinco baselines visuais em cada projeto no ambiente
   de CI e executar a comparacao normal.
3. Obter build e execucao completa do workflow aprovados.
4. Validar o comportamento em zoom nativo/alta densidade; CDP aqui
   representa reflow equivalente, nao deteccao universal de zoom.

Nao encerrar Sprint 2.6A ou Operation Core, nem liberar Sprint 2.6B.

## 13. Sprint 2.6.3-A - investigacao do build e bloqueios

### Causa isolada

`npm run build` foi reexecutado sem modificar produto, dependencias ou
bundler. A saida completa, incluindo stack, foi preservada em
[build-error.log](../../build-error.log). O build falhou novamente.

Categoria: **Turbopack / IPC de processos / restricao do sandbox**.
Nao foi demonstrado erro de sintaxe CSS, PostCSS, import ou Tailwind.
O nome `app/globals.css.css` identifica o asset que solicita o loader,
nao uma linha defeituosa do stylesheet.

O worker gerado em
`.next/build/chunks/[root-of-the-server]__1nvwxt65m8t91._.js`
abre `createConnection` para `127.0.0.1` na linha 147, com host na
linha 149. Seu handler de fechamento encerra o processo com codigo 0
na linha 229. Esse arquivo e gerado pelo Next, nao deve ser corrigido
manualmente e seu nome pode mudar em outro build.

Duas sondagens isoladas explicaram o panic:

1. Um processo pai abriu servidor TCP em porta efemera e iniciou o
   worker gerado. O worker saiu com codigo 0 sem o pai aceitar conexao.
   Nenhuma requisicao para transformar CSS foi enviada.
2. A mesma comunicacao foi reproduzida com um filho Node minimo, sem
   importar Next, Tailwind ou CSS. Resultado:

```text
CHILD error EACCES connect EACCES 127.0.0.1:<porta-efemera>
CHILD closed
{"exit":0,"connected":false}
```

Portanto, o sandbox nega a conexao TCP local necessaria ao IPC. O
Turbopack reporta que o filho encerrou antes da conexao, coerente com
o handler `close` observado. A investigacao parou apos essa negacao:
nao se tentou elevacao, troca de linguagem, proxy, bundler ou outra
forma de contornar a politica.

**Correcao necessaria no ambiente:** permitir na politica do sandbox
conexoes TCP de loopback entre os processos Node do build em
`127.0.0.1`, usando portas efemeras. Essa permissao nao esta disponivel
ao executor. Nao foi aplicada uma correcao especulativa ao produto.
Depois da atualizacao da politica, o build precisa ser reexecutado;
este diagnostico nao garante ausencia de outros erros posteriores.

### Autenticacao e URLs

Foi verificada somente a presenca, sem imprimir valores, no processo
e nos arquivos `.env.local`, `.env`, `.env.test` e `.env.test.local`
existentes.

| Variavel | Resultado |
|---|---|
| PLAYWRIGHT_EMAIL | Ausente - BLOCKED |
| PLAYWRIGHT_PASSWORD | Ausente - BLOCKED |
| OPERATION_FINISHED_URL | Ausente - SKIPPED |
| CANCELLED_OPERATION_URL | Ausente - SKIPPED |

Conforme a regra desta etapa, nao se prosseguiu com o runner autenticado.
A sessao compartilhada do navegador nao foi exportada para substituir
o login exigido. Nenhuma credencial foi inventada, salva em codigo ou
solicitada em texto publico.

### Resultado desta reexecucao

- Build: reprovado/bloqueado pela restricao acima.
- Typecheck: aprovado novamente.
- ESLint: zero erros e os mesmos 16 warnings preexistentes.
- Regressoes: 171/171 aprovadas novamente, zero falhas.
- Playwright nesta etapa: zero testes executados; bloqueio antes do login.
  Os 145 skips registrados na secao anterior pertencem a execucao anterior.
- Baselines definitivas: nenhuma gerada ou aprovada nesta etapa.
- Workflow local integral: BLOCKED. Nao foram executados `npm ci`,
  instalacao de navegadores nem login para produzir um resultado artificial
  depois dos bloqueios confirmados. Os seis passos nao estao aprovados
  como uma execucao sequencial de CI.
- Feedback Next: comando exigido executado uma vez, sem saida.
- Alteracoes nesta etapa: somente este adendo documental e o log solicitado.
  Nao houve mudanca de produto, query, RPC, banco ou configuracao.

**Sprint 2.6.3 permanece aberta. Pronto para reexecutar a homologacao
2.6.1: NAO.** Para retomar, atualizar a politica do sandbox para o IPC
local e configurar as quatro variaveis no ambiente do runner.

## 14. Desbloqueio da leitura de ambiente dos workers

Esta atualizacao substitui o diagnostico anterior de variaveis ausentes:
as quatro variaveis agora estao presentes em `.env.local`, e a sessao
`playwright/.auth/restaurant.json` ja existe. A sessao nao foi lida,
exibida ou exportada durante esta correcao.

### Causa e correcao

O config carregava dotenv em seu corpo, mas importava o modulo `env.ts`,
que lia credenciais e URLs em constantes. Imports estaticos podem ser
avaliados antes do corpo do config; os valores capturados nao eram
atualizados quando o ambiente passava a estar disponivel. Apenas trocar
por getters mantendo sua chamada no topo dos specs nao garante avaliacao
tardia nem carregamento do ambiente nos processos consumidores.

Foram feitas as seguintes alteracoes:

- `fixtures/env.ts`: dotenv carregado silenciosamente por caminho
  absoluto relativo ao modulo, sem sobrescrever variaveis ja definidas
  pelo processo/CI. URLs e credenciais consultadas pelos getters
  `getFinishedOperationUrl`, `getCancelledOperationUrl` e
  `hasPlaywrightCredentials`; senha composta apenas por espacos e ausente.
- `fixtures/test-data.ts`: `getOperations()` substitui o objeto congelado.
  A verificacao de estado tambem consulta esse getter.
- Quatro specs: condicoes de skip em callbacks e URLs obtidas no
  `beforeEach`, sem snapshots de configuracao no topo do modulo.
- `auth.setup.ts`: mesma condicao dinamica para credenciais; formulario,
  verificacao de login e persistencia da sessao preservados.
- `playwright.config.ts`: usa o carregamento compartilhado e o getter
  de credenciais; remove carregamento dotenv tardio e duplicado.
- Log temporario de diagnostico removido. Nenhuma credencial ou URL
  foi impressa; apenas indicadores booleanos de presenca.

Verificacao isolada do modulo real retornou:

```text
credentials: true
finishedConfigured: true
cancelledConfigured: true
```

Uma regressao em memoria, sem acessar segredos, passou em oito assertions:
valores ausentes, atribuicao apos importar, atualizacao posterior de URL
e senha em branco. Isso comprova o comportamento dinamico dos getters;
nao equivale a uma execucao autenticada dos specs.

### Execucao e bloqueio desta etapa

O comando desktop accessibility foi tentado. Antes dos workers:

1. A verificacao HTTP inicial encontrou incompatibilidade de Host no
   proxy do ambiente, antes de executar qualquer teste.
2. O diagnostico de disponibilidade subsequente revelou
   `connect EACCES ::1:3000` e `connect EACCES 127.0.0.1:3000`.
   O processo foi interrompido apos a negacao, sem novas tentativas de
   contornar a restricao. O teste temporario de log no beforeEach nao
   chegou a executar.

O sandbox desta execucao bloqueia o acesso do probe ao servidor local.
Isso nao contradiz o login aprovado anteriormente em outro contexto,
nem demonstra credenciais invalidas. A suite completa autenticada nao
foi repetida apos a negacao no mesmo destino. E necessario permitir,
na politica do sandbox, acesso dos processos Node/Playwright ao loopback
do servidor e ao IPC em portas efemeras antes de retomar.

Resultados atuais:

| Verificacao | Resultado |
|---|---|
| Coleta `npx playwright test --list` | 145 testes registrados em cinco arquivos |
| Playwright efetivamente executados nesta etapa | 0, bloqueio anterior ao setup/workers |
| Playwright aprovados nesta etapa | 0 |
| Skips observados nesta etapa | Nenhum resultado de suite produzido; nao afirmar 144 skips eliminados em execucao real |
| Accessibility | Nao executada no runner |
| Visual regression | Nao executada; baselines nao alteradas |
| Typecheck | Aprovado |
| ESLint | Zero erros, 16 warnings preexistentes |
| Regressoes | 171/171 aprovadas, zero falhas/skips |
| Build | Falhou novamente no panic do worker do loader CSS; stack integral atualizada em build-error.log |

O feedback Next exigido foi executado uma vez, sem saida. Nao foram
alterados produto, consultas, RPCs, banco ou regras operacionais.
Arquivos alterados: os dois fixtures, quatro specs, setup, config,
este relatorio e o log de build solicitado.

**Pronto para reexecutar Sprint 2.6.1: NAO.** A correcao de configuracao
esta implementada e validada estaticamente; a aprovacao real continua
dependendo de execucao autenticada sem o bloqueio do sandbox.

## 15. D-01 definitivo por largura efetiva

Este adendo substitui o criterio de resolucao descrito na secao 3:
compactacao agora depende exclusivamente de `window.innerWidth <= 375`.
O componente existente usa estado local e efeito de montagem/resize,
removendo o listener no unmount. O bloco style/media query foi removido.
Nao ha calculo por devicePixelRatio, resolucao ou zoom.

D02-004 foi corrigido para exigir texto contido e ausencia de clipping,
sem impor multiplas linhas. A matriz de viewports usa a largura CSS
arredondada efetiva, sem compactar desktop apenas por DPR. O helper
aguarda a visibilidade esperada dos rotulos antes de medir geometria,
para sincronizar com o efeito de resize sem sleeps arbitrarios.

Arquivos alterados: mobile-bottom-nav.tsx, operation-core-responsive.spec.ts,
operation-core-viewports.spec.ts, fixtures/test-data.ts, design-system.md,
este relatorio e o log de build solicitado anteriormente.

Validacao desta etapa:

- Typecheck aprovado; lint zero erros e 16 warnings preexistentes.
- 171/171 regressoes aprovadas, zero falhas.
- Harness em memoria do componente real verificou larguras 320 e 375
  com hidden, 376 e 1280 sem hidden, resize nas duas direcoes e remocao
  do listener. Nao e substituto para layout real ou Playwright autenticado.
- A11Y + responsive desktop tentados num unico runner: falha antes do
  setup por incompatibilidade de Host no proxy local. Nenhum caso A11Y,
  D01 ou D02 recebeu aprovacao nova nesta execucao.
- A tentativa complementar no navegador compartilhado nao produziu
  matriz conclusiva: reload/espera de compactacao expiraram e a pagina
  compartilhada depois deixou de estar disponivel. Nenhuma screenshot
  nova foi gerada; nao reutilizar as anteriores como prova deste fix.
- Build reexecutado: mesmo panic do worker do loader CSS, stack completa
  atualizada em build-error.log. Nenhuma correcao de bundler foi aplicada.
- Feedback Next executado uma vez, sem saida.

**Pronto para homologacao final 2.6.1: NAO.** Falta executar A11Y-001 a
005, D01-001 a 005, D02-001 a 004 e a matriz visual no runner com acesso
ao servidor, e obter build aprovado. Nao declarar ausencia de overflow
ou regressao visual sem essa evidencia. Produto/queries/RPCs fora do
escopo nao foram alterados.

## 16. Reexecucao de continuidade

- D-01: confirmado `window.innerWidth <= 375`, listener de resize e
  cleanup. A spec responsiva agora inclui tambem 376 e 1280 CSS px.
  A homologacao real continua pendente porque o sandbox negou conexao
  loopback com `EACCES`.
- D-02-004 ja exige texto contido e ausencia de clipping, sem exigir
  quebra de linha. Nenhum caso E2E recebeu aprovacao nesta execucao.
- D-03 e A11Y nao foram executados. Nenhuma evidencia visual nova foi
  produzida ou aprovada; baselines nao foram atualizadas.
- O PostgREST do projeto ligado respondeu `42703` para
  `public_user_directory.profile_verified`. A coluna nao foi renomeada
  nem removida nas migracoes do repositorio: e derivada de
  `worker_profiles` na view definida por
  `20261104010000_reconcile_verified_profile.sql`. A view remota esta
  atrasada em relacao a essa migracao. O componente agora mostra o erro,
  em vez de silencia-lo. A migracao remota nao foi aplicada; ela tambem
  altera politicas Storage e transicoes de verificacao e requer aprovacao
  antes do deploy.
- A consulta SQL local da verificacao passou. Typecheck aprovado; lint
  dirigido aos arquivos alterados aprovado. O suite completo Node passou
  319 testes, falhou zero e marcou quatro skips. A selecao de regressao
  2.6.1 passou 171/171, sem skips.
- `npm run build` falhou novamente quando o worker do loader CSS encerrou
  com codigo 0 antes da conexao. O stack esta em `build-error.log`; nao
  aponta linha de codigo fonte nem evidencia defeito em CSS, e nenhum
  bundler foi trocado.
- Playwright autenticado, snapshots e homologacao 2.6.1 permanecem
  pendentes devido ao bloqueio de loopback do sandbox.

**Sprint 2.6.3 concluida: NAO.**

## 17. Reexecucao da estabilizacao

- Baseline logica registrada em [STABILIZATION_BASELINE.md](../../STABILIZATION_BASELINE.md), com hashes SHA-256, datas, status Git, branch, commit e versoes. Ela nao e copia de conteudo nem substitui backup dos arquivos.
- `npm run typecheck`: aprovado.
- `npm run lint`: zero erros; 16 warnings em `android/app/build/intermediates/assets/debug/mergeDebugAssets/native-bridge.js`.
- `npm test`, antes da correcao: 318 aprovados, 1 falha, 4 skips. A falha era uma assercao estatica em `tests/ui.test.mjs` que proibia `useSyncExternalStore`, embora a navegacao o use para acompanhar o viewport. O teste isolado reproduziu a falha.
- Correcao minima: a assercao passou a proibir somente o destino legado `/worker/applications#chats`. O teste isolado passou depois da alteracao.
- `npm test`, depois da correcao: 319 aprovados, zero falhas, 4 skips.
- `npm run build`: falhou novamente no worker do loader CSS; o processo filho terminou com codigo 0 antes da conexao IPC. O diagnostico anterior nesta secao atribui o bloqueio ao sandbox/loopback; nao foi aplicada alteracao especulativa ao produto ou ao bundler.
- Runtime: `http://localhost:3000/` recusou conexao. Nenhuma inspecao de console ou rede em runtime foi possivel.
- Playwright: configuracao lista 153 casos, mas nao foram executados. O Chromium configurado nao existe neste ambiente; nenhum baseline visual foi criado ou atualizado.
- Database drift: nao revalidado nesta execucao. Nenhum SQL foi aplicado; banco remoto, Storage, policies, triggers e migrations nao foram alterados.
- Rollback da assercao e da baseline: [ROLLBACK.md](../../ROLLBACK.md). Nenhuma alteracao de produto ou migracao foi feita nesta etapa.

**Estabilizacao concluida: NAO. Pronto para producao: NAO.** Build, runtime e E2E autenticado continuam sem validacao aprovada.
