# Responsive recovery - 2026-11-06

**PASSOU: 12 passed, 0 failed, 0 skipped.**
Total: login de setup + sete casos D01 + quatro casos D02.

## Causas comprovadas

**D01:** `reflow()` aplicava `Emulation.setDeviceMetricsOverride` e
desconectava imediatamente a sessao CDP em `finally`. A desconexao
restaurou a geometria desktop do contexto, invalidando o tamanho usado
nas assercoes. A11Y-004 passa porque cria o contexto inicialmente em
320x568, sem chamar esse helper ou desconectar uma sessao de emulacao.
O componente Bottom Nav nao foi alterado.

Probe autenticado novo, salvo em
`test-results/responsive-recovery/reflow-probe.json`:

| Etapa | innerWidth | innerHeight | DPR | compactMode | Seis labels |
|---|---:|---:|---:|---|---|
| Contexto inicial | 1280 | 800 | 1 | false | display:block |
| setViewportSize | 320 | 568 | 1 | true | display:none |
| Override CDP | 160 | 284 | 2 | true | display:none |
| Apos detach, estabilizado | 1280 | 800 | 1 | false | display:block |
| Override com sessao mantida | 160 | 284 | 2 | true | display:none |

O probe verificou `innerWidth` com assercao repetida antes de registrar
os dois estados finais. Nao foi usada espera fixa para produzir o resultado.
Essa evidencia nova justifica a alteracao restrita ao ciclo de vida da
sessao CDP no helper de testes. O contexto Playwright encerra a sessao ao
fim do teste. Formula de largura/altura, DPR, matriz e thresholds foram
preservados. D01 agora tambem exige a geometria efetiva exata antes de
verificar os labels e os limites dos icones/textos.

**D02:** a suite Responsive ainda importava `mainCta()` e abria uma
operacao especifica via `openOperation(getOperations().FINISHED)`.
A suite A11Y ja utilizava `openOperations()` e `operationsCta()`.
O locator antigo busca uma acao transitoria que nao existe na operacao
atual; as quatro falhas reais de baseline registram `element(s) not found`.
Nao foi reaberto nenhum fluxo de avaliacao ou investigacao de banco.

## Locators

Antigo:

```ts
page.locator('[aria-labelledby="pending-heading"]')
  .getByRole('link', { name: 'Avaliar experiência', exact: true })
```

Novo, reutilizado sem duplicar o helper A11Y:

```ts
page.getByRole('main')
  .getByRole('link', { name: 'Nova Operação', exact: true })
```

Pagina nova: `/restaurant/demands`, sem UUID de operacao.
Destino esperado atualizado de `/reviews/<id>` para
`/restaurant/dashboard/jobs/create`. Screenshot D02 agora recorta a
propria CTA, nao a antiga regiao `pending-heading`.

## Arquivos e linhas alteradas

| Arquivo | Linhas finais | Alteracao |
|---|---|---|
| `tests/e2e/fixtures/test-data.ts` | 73-80 | Manter sessao de emulacao durante as verificacoes; remover detach prematuro |
| `tests/e2e/operation-core-responsive.spec.ts` | 3-6 | Reutilizar abertura/CTA permanente; remover dependencia de URL de operacao |
| `tests/e2e/operation-core-responsive.spec.ts` | 8-32 | Anexar geometria, display dos labels, medidas e HTML da CTA |
| `tests/e2e/operation-core-responsive.spec.ts` | 45-49 | Verificar tamanho efetivo e DPR exatos em todos os D01 |
| `tests/e2e/operation-core-responsive.spec.ts` | 59-60, 65, 72, 75, 81 | Atualizar alvo, screenshot e destino D02 |
| `docs/homologation/responsive-recovery.md` | arquivo novo | Esta entrega |
| `docs/homologation/responsive-recovery.diff` | arquivo novo | Diff completo desta tarefa, incluindo este documento |

Nenhuma alteracao em `mobile-bottom-nav.tsx`, compactMode,
useSyncExternalStore, listeners de resize, CSS, suite A11Y ou dados de
negocio. Mudancas preexistentes no worktree preservadas.

## Execucoes reais

Comando integral executado antes e depois:

```powershell
npx.cmd playwright test tests/e2e/operation-core-responsive.spec.ts --project=authenticated-desktop
```

`npx.cmd` e o shim Windows do comando solicitado. Usadas as mesmas
variaveis de ambiente de infraestrutura da recuperacao A11Y, sem mudar
a configuracao do runner:

```powershell
$env:PLAYWRIGHT_EXTERNAL_SERVER='1'
$env:PLAYWRIGHT_PROXY_SERVER=$env:HTTP_PROXY
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\node_modules\.cache\ms-playwright"
```

Na execucao corrigida, `OPERATION_FINISHED_URL` e `CANCELLED_OPERATION_URL`
foram explicitamente vazias, comprovando a independencia desses dados.

| Casos | Antes | Depois |
|---|---|---|
| Login de setup | 1 passou | 1 passou |
| D01-001 ate D01-005 | 5 falharam: label visible | 5 passaram |
| D01-006 e D01-007 | 2 passaram | 2 passaram |
| D02-001 ate D02-004 | 4 falharam: CTA ausente | 4 passaram |
| Total | **3 passed, 9 failed** | **12 passed, 0 failed, 0 skipped** |

Geometria efetiva exigida pelos sete D01, na ordem:
320x568/1; 256x454/1.25; 213x379/1.5; 160x284/2;
188x406/2; 376x812/1; 1280x800/1.
O helper de medicao e os requisitos D02 foram preservados:
texto contido, ambos os eixos >=44 CSS px, sem clipping, centro atingivel,
destino correto e `click({ trial: true })` sem mutacao.

## Evidencias persistidas

- [JUnit antes](../../test-results/responsive-recovery/before.xml): 12 testes, 9 falhas.
- [JUnit depois](../../test-results/responsive-recovery/after.xml): 12 testes, zero falhas/skips.
- [Probe de geometria](../../test-results/responsive-recovery/reflow-probe.json): comparacao CDP detach/retido.
- [HTML do probe](../../test-results/responsive-recovery/nav-probe.html) e [screenshot](../../test-results/responsive-recovery/nav-probe.png).
- `test-results/responsive-recovery/before-runs/`: traces e screenshots das nove falhas originais.
- [Screenshot D01-002](../../test-results/evidence/mobile-nav-after.png).
- [Screenshot D02-001](../../test-results/evidence/cta-after.png).
- `playwright-report/index.html`: relatorio final com `responsive-geometry.json` por teste e `cta-measurements.json`/`cta.html` nos quatro D02.
- [Diff completo](responsive-recovery.diff).

ESLint dos dois arquivos de teste alterados e TypeScript sem erros.
