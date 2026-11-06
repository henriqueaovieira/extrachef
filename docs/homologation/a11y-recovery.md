# A11Y recovery - 2026-11-06

## Resultado

**SIM.** Suite solicitada: **6 passed, 0 failed, 0 skipped**.
Os seis casos incluem o login de setup e A11Y-001 a A11Y-005.
Segunda execucao completa apos a correcao: mesmo resultado, com
`OPERATION_FINISHED_URL` e `CANCELLED_OPERATION_URL` explicitamente vazias.
Nenhum registro de negocio foi criado ou alterado.

## Causa raiz comprovada

A11Y-002, A11Y-003 e A11Y-005 dependiam de uma acao transitoria:
`Avaliar experiencia`, dentro de `pending-heading`. No DOM autenticado
da operacao configurada, esse link tem **zero ocorrencias**. O status
continua **Finalizada**, mas a proxima acao exibida e **Encerrar acompanhamento**,
com link **Ver conclusao**. Nao houve mudanca de status principal comprovada;
houve divergencia entre a proxima acao assumida pelo teste e a renderizada.

A11Y-004 tem uma causa adicional comprovada nesta reproducao:
o helper de reflow abre e desconecta uma sessao CDP. O diagnostico salvo
no JUnit anterior mostra:

| Momento | innerWidth | outerWidth | compactMode | Rotulos |
|---|---:|---:|---|---|
| after-setViewportSize | 320 | 320 | true | hidden / display:none |
| after-CDP-override | 320 | 320 | true | hidden / display:none |
| after-CDP-detach | 1280 | 320 | false | display:block |
| final | 320 | 320 | true | hidden / display:none |

A assercao de `data-diagnostic-compact-mode` expirou recebendo `false`.
Isso nao comprova defeito da Bottom Nav. A correcao usa um contexto
Playwright inicialmente em 320x568 apenas para A11Y-004, sem CDP ou
transicao de tamanho. O componente e o helper de reflow nao foram alterados.
O resultado final confirma `innerWidth=320`, `compactMode=true`, seis
rotulos ocultos, seis links nomeados e os mesmos destinos.

O erro anterior relatado de ausencia de `summary-heading` **nao foi
reproduzido na baseline desta sessao**. O elemento existe no DOM carregado.
Nao foi atribuido esse erro a uma remocao de markup.

## Respostas obrigatorias

| # | Pergunta | Evidencia / resposta |
|---|---|---|
| 1 | URL aberta por openOperation() | Recebe o argumento `url` e executa `page.goto(url)`. A suite anterior passa `getOperations().FINISHED`, lido de `OPERATION_FINISHED_URL`: `http://localhost:3000/restaurant/demands/130e5c5a-e0a3-474b-b0c0-c2616785a187`. |
| 2 | Elemento esperado por mainCta() | Link com nome acessivel exato `Avaliar experiencia` (com acentos no codigo), dentro de `[aria-labelledby="pending-heading"]`. Codigo literal abaixo. |
| 3 | O que measureCta() mede | Altura e largura do boundingClientRect em CSS px; contencao dos retangulos de texto com tolerancia de 1px; clipping por ancestrais com overflow hidden/clip; se o centro atinge o proprio elemento/descendente via elementFromPoint; numero de coordenadas top distintas dos retangulos de texto; href. Antes mede visibilidade e faz scrollIntoViewIfNeeded. Nao mede contraste nem certifica acessibilidade integral. A11Y-005 verifica somente altura/largura >=44px. |
| 4 | Estado assumido | Finalizada, fontes operacionais disponiveis, sem pedido de atualizar operacao e com avaliacao ainda pendente como proxima acao. A espera por essa CTA e uma dependencia adicional, nao garantida pelo status Finalizada. |
| 5 | Estado real hoje | Finalizada; Equipe Confirmada 1; Presentes 0; Check-outs Realizados 1. Proxima acao: Encerrar acompanhamento. Texto: Participantes finalizados. Consulte o historico da operacao. |
| 6 | A CTA Avaliar experiencia ainda existe nessa tela? | **NAO**, zero links com o nome exato no DOM autenticado carregado. Isso nao afirma que o produto inteiro deixou de ter essa CTA em outros estados. |
| 7 | Qual elemento a substituiu? | Em pending-heading: link Ver conclusao, href `/restaurant/demands/130e5c5a-e0a3-474b-b0c0-c2616785a187#timeline-heading`. Existe tambem um link Avaliar profissional em outra area; ele nao e o locator antigo nem foi usado para estabilizar a suite. |
| 8 | summary-heading ainda existe? | **SIM**, exatamente uma secao `[aria-labelledby="summary-heading"]`, com heading Status atual e status Finalizada. |
| 9 | Qual elemento substituiu summary-heading? | Nenhum. Nao foi removido nem substituido. A nova suite deixa de depender desse resumo de uma operacao particular. |

`getOperations()` retorna FINISHED e CANCELLED a partir das variaveis
`OPERATION_FINISHED_URL` e `CANCELLED_OPERATION_URL`; nao seleciona nem
cria operacoes, nao fixa seu estado e nao prepara uma avaliacao pendente.

## Locators antigos e novos

Antigo, preservado para outras suites de negocio:

```ts
page.locator('[aria-labelledby="pending-heading"]')
  .getByRole('link', { name: 'Avaliar experiência', exact: true })
```

Novo, permanente e sem dependencia de uma operacao:

```ts
page.getByRole('main')
  .getByRole('link', { name: 'Nova Operação', exact: true })
```

| Caso | Antes | Depois |
|---|---|---|
| A11Y-001 | Axe no main do detalhe mutavel | Axe no main da pagina permanente de operacoes |
| A11Y-002 | Voltar -> Acoes da operacao -> Avaliar experiencia | Home -> Nova Operacao -> Todas; Shift+Tab de volta; Enter/Space nos filtros Hoje/Todas com verificacao de aria-pressed |
| A11Y-003 | Tab do menu para Avaliar experiencia | Tab de Home para Nova Operacao; mantidas as verificacoes focus-visible e outline |
| A11Y-004 | Detalhe especifico, reflow/CDP e atributo diagnostico interno | Pagina permanente, contexto compacto inicial; mantidas as verificacoes dos seis aria-label, nomes acessiveis e rotulos ocultos |
| A11Y-005 | Bounding box de Avaliar experiencia | Mesmo measureCta() aplicado a Nova Operacao; ambos os eixos >=44px |

Nao foram adicionados skips por ausencia de CTA, fallbacks de locator,
mocks de HTML ou aumento de timeout para obter aprovacao.
Os helpers antigos continuam disponiveis para as suites responsivas e
de estados de negocio; nao tiveram seu contrato alterado.

## Arquivos e linhas alteradas

| Arquivo | Linhas finais | Mudanca |
|---|---|---|
| `tests/e2e/fixtures/test-data.ts` | 131-140 | Adicionados operationsCta() e openOperations(); mainCta(), measureCta(), getOperations() e openOperation() preservados |
| `tests/e2e/operation-core-accessibility.spec.ts` | 4-24, 43-89, 102-146 | Navegacao permanente, evidencia HTML/PNG, teclado/foco/medicao e contexto compacto isolado |
| `playwright.config.ts` | 26-29, 39 | Proxy opcional do browser e servidor externo opcional; comportamento padrao preservado |
| `docs/homologation/a11y-recovery.md` | arquivo novo | Entrega e referencias de evidencia |
| `docs/homologation/a11y-recovery.diff` | arquivo novo | Diff completo das alteracoes desta tarefa, sem incorporar as demais mudancas preexistentes |

Referencia dos helpers investigados em `test-data.ts`:
getOperations() 48-53; openOperation() 55-66; mainCta() 127-129;
measureCta() 142-166. O helper novo abre `/restaurant/demands` e espera
heading Operacoes, link Nova Operacao e grupo Filtrar operacoes.

Nenhuma alteracao em mobile-bottom-nav.tsx, compactMode,
useSyncExternalStore, resize, aria-label, CSS, backend ou banco.
As alteracoes preexistentes no worktree foram preservadas.

## Evidencia real persistida

Arquivos locais relativos a raiz do repositorio:

- `test-results/a11y-recovery/operation.html`: outerHTML real do main, apos esperar summary-heading visivel.
- `test-results/a11y-recovery/operation.png`: screenshot do detalhe carregado.
- `test-results/a11y-recovery/operation.txt`: texto real da tela.
- `test-results/a11y-recovery/operation.json`: URL, contagens de locators, resumo, proxima acao e destinos reais.
- `test-results/a11y-recovery/permanent-controls.html`: header real da pagina permanente.
- `test-results/a11y-recovery/permanent-controls.png`: screenshot do header com Home e Nova Operacao.
- `test-results/a11y-recovery/permanent-controls.json`: medicao real do novo alvo.
- `test-results/a11y-recovery/before.xml`: JUnit anterior, incluindo as quatro falhas e diagnosticos CDP.
- `test-results/a11y-recovery/before-runs/`: traces, screenshots e contextos das falhas preservados antes da nova execucao.
- `test-results/a11y-recovery/after.xml`: JUnit final com zero falhas/skips.
- `playwright-report/index.html`: relatorio final com HTML/PNG dos controles permanentes e JSON das medicoes anexados aos testes.

Extratos do HTML capturado:

```html
<h2 id="summary-heading" class="text-sm font-semibold text-gray-600">Status atual</h2>
```

```html
<a class="ec-button ec-button--primary px-3 text-sm sm:px-5"
   href="/restaurant/dashboard/jobs/create"><span aria-hidden="true">+</span> Nova Operação</a>
```

Medicao adicional capturada em 1280x800: **158.6875 CSS px de largura,
44 CSS px de altura**, href `/restaurant/dashboard/jobs/create`.
O sinal + visual tem aria-hidden; o nome acessivel verificado e
`Nova Operacao` (com acento no codigo), nao `+ Nova Operacao`.

## Playwright antes e depois

| Execucao | Setup | A11Y-001 | A11Y-002 | A11Y-003 | A11Y-004 | A11Y-005 | Total |
|---|---|---|---|---|---|---|---|
| Baseline autenticada | passou | passou | falhou: CTA ausente | falhou: CTA ausente | falhou: compactMode false apos detach CDP | falhou: CTA ausente | **2 passed, 4 failed** |
| Primeira execucao corrigida | passou | passou | passou | passou | passou | passou | **6 passed, 0 failed** |
| Reexecucao final, URLs de operacao vazias | passou | passou | passou | passou | passou | passou | **6 passed, 0 failed, 0 skipped** |

Comando executado integralmente em ambas as execucoes corrigidas:

```powershell
npx.cmd playwright test tests/e2e/operation-core-accessibility.spec.ts --project=authenticated-desktop
```

`npx.cmd` e o shim Windows para o mesmo comando npx solicitado; a invocacao
inicial de npx.ps1 foi recusada pelo AuthorizationManager do PowerShell.
O runner inicialmente tambem encontrou browser ausente e erro de probe
HTTP no proxy. Essas tentativas nao foram contadas como baseline funcional.
O Chromium requerido foi instalado; a baseline funcional acima executou
todos os casos com login real.

Preparacao especifica do sandbox desta sessao:

```powershell
$env:PLAYWRIGHT_EXTERNAL_SERVER='1'
$env:PLAYWRIGHT_PROXY_SERVER=$env:HTTP_PROXY
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\node_modules\.cache\ms-playwright"
```

O servidor existente respondeu HTTP 200 em `/login` antes dos testes.
O proxy opcional permite ao browser usar a rede autorizada do sandbox.
O servidor externo opcional evita a sondagem HTTP do runner incompativel
com esse proxy, sem iniciar ou encerrar o servidor existente.

Na reexecucao final foram definidos tambem:

```powershell
$env:OPERATION_FINISHED_URL=''
$env:CANCELLED_OPERATION_URL=''
```

Isso comprova que o sucesso nao depende dessas URLs ou de uma operacao
especifica. Login e acesso autenticado continuam obrigatorios.

## Acessibilidade resolvida?

**SIM**, para a suite e o criterio de sucesso solicitados. Nao constitui
certificacao WCAG integral nem alteracao dos fluxos de negocio.
