# Viewport final recovery - 2026-11-06

**PASSOU: 18 passed, 0 failed, 0 skipped.**
Execucao final completa, sem `--update-snapshots`.

## 1. Causa raiz e elemento responsavel

**Overflow visual real, nao erro da medicao.** O elemento responsavel e
o contêiner do alerta de Perfil Verificado, fora do `main`. O `body` usa
flex column; esse item tinha margens horizontais automaticas e apenas
max-width, sem largura limitada ao viewport. Sua largura intrinseca
ultrapassava os 160 CSS px efetivos no caso 320x568/200%.

Selector estavel identificado pelo HTML:

```css
body > div.mx-auto.max-w-2xl.p-4
```

Selector estrutural na captura: `html > body:nth-child(2) > div:nth-child(9)`.

HTML real anterior:

```html
<div class="mx-auto max-w-2xl p-4"><div role="alert" aria-atomic="true" class="ec-toast ec-toast--error"><span class="ec-toast__icon" aria-hidden="true">!</span><div class="min-w-0 flex-1"><div class="break-words text-sm leading-6">Não foi possível atualizar os selos de Perfil Verificado.</div></div></div></div>
```

| Medida | Antes | Depois, DOM real corrigido |
|---|---:|---:|
| innerWidth / document clientWidth | 160 | 160 |
| document scrollWidth | 169 | 160 |
| overflowWidth do documento | 9 | 0 |
| boundingRect x / y | 0 / 0 | 0 / 0 |
| boundingRect width / height | 168.75 / 210 | 160 / 234 |
| boundingRect right / bottom | 168.75 / 210 | 160 / 234 |
| wrapper scrollWidth / clientWidth | 169 / 169 | 160 / 160 |
| wrapper overflowWidth interno | 0 | 0 |
| excesso geometrico a direita | 8.75 | 0 |

O overflowWidth interno do wrapper e zero: ele nao transbordava sua
propria caixa; a caixa inteira era maior que a janela. A medicao global
`document.documentElement.scrollWidth > innerWidth + 1` estava correta.
`measurements.overlaps=false` continuou verdadeiro; nao havia overlap.

O primeiro probe, antes de o alerta assincrono aparecer, registrou
scrollWidth=160. O probe conclusivo aguardou scrollWidth>161 e identificou
o alerta real. O probe posterior aguardou o mesmo alerta visivel e confirmou
document scrollWidth=160. Nenhuma mensagem foi removida ou ocultada.

Experimento antes da edicao: aplicar somente `width:100%` no wrapper real
reduziu o documento de 169 para 160px. A correcao persistente adiciona
somente `w-full`, mantendo max-width, padding, conteudo, role e tratamento
de erro existentes. Nenhuma investigacao de dados de verificacao foi feita.

## 2. Screenshot, trace, HTML e medicoes

- [Screenshot da falha original](../../test-results/viewport-recovery/before-runs/operation-core-viewports-reflow-320x568-200-equivalente-authenticated-desktop/test-failed-1.png).
- [Trace da falha original](../../test-results/viewport-recovery/before-runs/operation-core-viewports-reflow-320x568-200-equivalente-authenticated-desktop/trace.zip).
- [Selectors, HTML e boundingRects anteriores](../../test-results/viewport-recovery/overflow-before.json).
- [Experimento width:100% anterior a edicao](../../test-results/viewport-recovery/overflow-experiment.json).
- [HTML e boundingRect reais apos correcao](../../test-results/viewport-recovery/alert-after.json).
- [Medicoes globais posteriores](../../test-results/viewport-recovery/overflow-after.json).
- [Screenshot posterior](../../test-results/viewport-recovery/overflow-after.png).

Screenshots em DPR 2 usam pixels fisicos; as medicoes JSON sao CSS px.
O trace pode ser aberto com `npx.cmd playwright show-trace <arquivo>`.

## 3. Snapshots: respostas e comparacao actual vs expected

**Os snapshots existem hoje? SIM.**

**E primeira geracao de baseline nesta tarefa? NAO.**
Os cinco arquivos ja existiam antes da primeira execucao desta tarefa.
O erro historico `A snapshot doesn't exist` nao se repetiu: o teste visual
passou na baseline inicial. Nenhuma ausencia foi inventada ou ignorada.

**As imagens geradas apresentam divergencia real de produto? NAO.**
A comparacao inicial entre actual e expected existentes passou.
Entretanto, a inspeção dos cinco PNGs revelou erro real de enquadramento
na captura anterior: `page.toHaveScreenshot({fullPage:true, clip})` usava
coordenadas calculadas antes da captura de pagina completa. O recorte
de estado incluia o cabecalho, e outros recortes mostravam a barra fixa
encobrindo conteudo. Aprovar esses arquivos manteria cobertura incompleta.

Foi feita uma atualizacao intencional da captura, nao uma aceitacao
automatica de regressao do produto: alinhar a regiao no inicio da janela
e usar `expect(region).toHaveScreenshot()`, sem clip manual/fullPage.
As mascaras existentes de agenda/participantes foram preservadas; estado,
contagens, proxima acao e CTA continuam sem mascara.

| Arquivo (sufixo authenticated-desktop-win32.png) | Expected anterior | Actual revisado / expected final |
|---|---|---|
| operation-state | Cabecalho incluido e resumo incompleto | Somente Status atual, Finalizada e dois paragrafos mascarados |
| operation-summary | Texto final encoberto pela barra fixa | Resumo completo, cinco indicadores e explicacao final |
| operation-action-center | Barra fixa encobria Ver conclusao | Acao Necessaria completa, incluindo CTA Ver conclusao |
| operation-presence | Bloco completo com participantes mascarados | Identico; preservado sem alteracao binaria |
| operation-continuation | Barra fixa encobria os paragrafos | Proxima Etapa completa, com os dois paragrafos |

**Baselines criados: 0. Atualizados: 4. Preservados identicos: 1.**
Os cinco PNGs finais foram abertos e inspecionados antes da execucao final.
Diretorio persistente: `tests/e2e/operation-core-viewports.spec.ts-snapshots/`.
Originais preservados em `test-results/viewport-recovery/baselines-before/`.
Hashes antes/depois em `baseline-hashes-before.json` e
`baseline-hashes-final.json` dentro de `test-results/viewport-recovery/`.

A regeneracao direcionada usou:

```powershell
npx.cmd playwright test tests/e2e/operation-core-viewports.spec.ts --project=authenticated-desktop --grep 'regressao visual' --update-snapshots
```

Resultado intermediario: 2 passed (setup + visual). Isso nao foi usado
como substituto da validacao completa. A execucao final comparou os cinco
actuals contra os expecteds revisados, com maxDiffPixels=0, sem atualiza-los.

## 4. Arquivos e linhas alterados

| Arquivo | Linha(s) finais | Alteracao |
|---|---|---|
| `app/components/professional-verification.tsx` | 88 | Adicionar w-full ao wrapper do alerta |
| `tests/e2e/operation-core-viewports.spec.ts` | 34-35 | Scroll block:start e screenshot da propria regiao; remover clip manual/fullPage |
| `tests/e2e/operation-core-viewports.spec.ts-snapshots/operation-state-authenticated-desktop-win32.png` | binario | Recorte correto |
| `tests/e2e/operation-core-viewports.spec.ts-snapshots/operation-summary-authenticated-desktop-win32.png` | binario | Recorte completo |
| `tests/e2e/operation-core-viewports.spec.ts-snapshots/operation-action-center-authenticated-desktop-win32.png` | binario | Mostrar CTA |
| `tests/e2e/operation-core-viewports.spec.ts-snapshots/operation-continuation-authenticated-desktop-win32.png` | binario | Mostrar paragrafos |
| `docs/homologation/viewport-recovery.md` | novo | Esta entrega |
| `docs/homologation/viewport-recovery.diff` | novo | Diff completo textual e binario desta tarefa |

O diff isola as alteracoes desta tarefa das mudancas preexistentes.
Nao foram alterados mobile-bottom-nav.tsx, compactMode, aria-label,
hidden, useSyncExternalStore, listeners, reflow(), suites A11Y/Responsive/
Cancelled, regras de negocio ou banco. A assercao global de overflow,
limiar de 1px e os 16 cenarios foram preservados.

## 5. Resultados antes e depois

| Execucao | Resultado |
|---|---|
| Resultado historico informado | 16 passed, 2 failed |
| Baseline reproduzida nesta tarefa | **17 passed, 1 failed**; somente overflow; cinco snapshots existentes passaram |
| Apos w-full, antes de corrigir recorte visual | **18 passed, 0 failed** |
| Final, com recortes revisados, sem update-snapshots | **18 passed, 0 failed, 0 skipped** |

- [Saida completa antes](../../test-results/viewport-recovery/before-output.txt).
- [JUnit antes](../../test-results/viewport-recovery/before.xml).
- [Saida completa final](../../test-results/viewport-recovery/final-output.txt).
- [JUnit final](../../test-results/viewport-recovery/final.xml).
- [Saida da atualizacao intencional das baselines](../../test-results/viewport-recovery/baseline-update-output.txt).
- [Diff completo](viewport-recovery.diff).

Comando completo final executado:

```powershell
npx.cmd playwright test tests/e2e/operation-core-viewports.spec.ts --project=authenticated-desktop
```

`npx.cmd` e o shim Windows do comando npx solicitado. Mantidas as mesmas
variaveis de infraestrutura do sandbox ja utilizadas nas tarefas anteriores:

```powershell
$env:PLAYWRIGHT_EXTERNAL_SERVER='1'
$env:PLAYWRIGHT_PROXY_SERVER=$env:HTTP_PROXY
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\node_modules\.cache\ms-playwright"
```

Saida final (ordem e tempos da execucao real):

```text
Running 18 tests using 1 worker
ok  1 [setup] Login restaurante (9.1s)
ok  2 reflow 320x568 100% equivalente (15.7s)
ok  3 reflow 320x568 125% equivalente (15.8s)
ok  4 reflow 320x568 150% equivalente (15.3s)
ok  5 reflow 320x568 200% equivalente (15.9s)
ok  6 reflow 375x812 100% equivalente (15.5s)
ok  7 reflow 375x812 125% equivalente (15.5s)
ok  8 reflow 375x812 150% equivalente (15.8s)
ok  9 reflow 375x812 200% equivalente (15.4s)
ok 10 reflow 768x1024 100% equivalente (16.1s)
ok 11 reflow 768x1024 125% equivalente (16.2s)
ok 12 reflow 768x1024 150% equivalente (15.3s)
ok 13 reflow 768x1024 200% equivalente (15.6s)
ok 14 reflow 1280x800 100% equivalente (15.3s)
ok 15 reflow 1280x800 125% equivalente (15.1s)
ok 16 reflow 1280x800 150% equivalente (15.4s)
ok 17 reflow 1280x800 200% equivalente (16.1s)
ok 18 regressao visual dos cinco blocos do Operation Core (16.3s)
18 passed (5.2m)
```

O arquivo final-output.txt preserva a saida original integral, incluindo
projetos e caminhos/linhas de cada teste. Total: setup + 16 cenarios de
reflow + um teste com cinco comparacoes visuais.
