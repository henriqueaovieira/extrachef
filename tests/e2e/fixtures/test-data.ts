import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getCancelledOperationUrl, getFinishedOperationUrl, skipIfMissing } from './env';

async function captureNavigationDiagnostic(page: Page, stage: string) {
  const info = test.info();
  if (!info.title.startsWith('A11Y-004')) return;
  const diagnostic = await page.evaluate(() => {
    const navigation = document.querySelector('.ec-mobile-nav');
    return {
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      compactMode: navigation?.getAttribute('data-diagnostic-compact-mode'),
      hydrated: navigation?.getAttribute('data-diagnostic-hydrated'),
      source: navigation?.getAttribute('data-diagnostic-source'),
      lastCommit: navigation?.getAttribute('data-diagnostic-commit'),
      labels: [...(navigation?.querySelectorAll('.ec-mobile-nav__label') ?? [])].map((label) => ({
        text: label.textContent,
        className: label.className,
        display: getComputedStyle(label).display,
      })),
      html: navigation?.outerHTML ?? null,
    };
  });
  await info.attach(`bottom-nav-${stage}.json`, {
    body: JSON.stringify(diagnostic, null, 2),
    contentType: 'application/json',
  });
  if (diagnostic.html !== null) {
    await info.attach(`bottom-nav-${stage}.html`, {
      body: diagnostic.html,
      contentType: 'text/html',
    });
  }
  console.log(`[A11Y-004 ${stage}] ${JSON.stringify({ ...diagnostic, html: undefined })}`);
}

test.afterEach(async ({ page }, info) => {
  if (!info.title.startsWith('A11Y-004')) return;
  await captureNavigationDiagnostic(page, 'final');
  await info.attach('bottom-nav-final.png', {
    body: await page.screenshot({ animations: 'disabled', fullPage: true }),
    contentType: 'image/png',
  });
});

export function getOperations() {
  return {
    FINISHED: getFinishedOperationUrl(),
    CANCELLED: getCancelledOperationUrl(),
  };
}

export async function openOperation(page: Page, url: string | null) {
  skipIfMissing(process.env.PLAYWRIGHT_EMAIL ?? null, 'PLAYWRIGHT_EMAIL ausente: login nao executado.');
  skipIfMissing(process.env.PLAYWRIGHT_PASSWORD ?? null, 'PLAYWRIGHT_PASSWORD ausente: login nao executado.');
  skipIfMissing(url, 'URL da operacao ausente: fornecer a variavel correspondente.');
  await page.goto(url);
  await expect(page.locator('[aria-labelledby="summary-heading"]')).toBeVisible();
  await expect(page.locator('[aria-labelledby="summary-heading"]').getByRole('status')).toHaveText(
    url === getOperations().CANCELLED ? 'Cancelada' : 'Finalizada',
  );
  await expect(page.locator('[aria-labelledby="operational-summary-heading"]')).not.toContainText('Indisponível');
  await expect(page.locator('[aria-labelledby="pending-heading"]')).not.toContainText('Atualizar operação');
}

export async function reflow(page: Page, width: number, height: number, zoom = 1) {
  await captureNavigationDiagnostic(page, 'before-reflow');
  await page.setViewportSize({ width, height });
  await captureNavigationDiagnostic(page, 'after-setViewportSize');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width / zoom),
      height: Math.round(height / zoom),
      deviceScaleFactor: zoom,
      mobile: false,
    });
    await captureNavigationDiagnostic(page, 'after-CDP-override');
  } finally {
    await session.detach();
  }
  await captureNavigationDiagnostic(page, 'after-CDP-detach');
}

export async function expectNavigationFits(page: Page, compact: boolean) {
  const navigation = page.getByRole('navigation', { name: 'Navegação principal', exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(6);
  for (const label of await navigation.locator('.ec-mobile-nav__label').all()) {
    if (compact) await expect(label).toBeHidden();
    else await expect(label).toBeVisible();
  }
  const measurements = await navigation.evaluate((nav) => {
    const rects = [...nav.querySelectorAll('a')].map((link) => {
      const rect = link.getBoundingClientRect();
      const icon = link.querySelector('svg')?.getBoundingClientRect();
      const label = link.querySelector('.ec-mobile-nav__label');
      const range = document.createRange();
      if (label) range.selectNodeContents(label);
      const text = label ? range.getBoundingClientRect() : null;
      return {
        named: Boolean(link.getAttribute('aria-label')?.trim()),
        hidden: label ? getComputedStyle(label).display === 'none' : false,
        inside: Boolean(icon && icon.left >= rect.left && icon.right <= rect.right && icon.top >= rect.top && icon.bottom <= rect.bottom),
        textInside: !text || text.width === 0 || (text.left >= rect.left - 1 && text.right <= rect.right + 1),
        left: rect.left, right: rect.right,
      };
    });
    return {
      rects,
      overlaps: rects.some((rect, index) => index > 0 && rect.left < rects[index - 1].right - 1),
      horizontal: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(measurements.overlaps).toBe(false);
  expect(measurements.horizontal).toBe(false);
  for (const rect of measurements.rects) {
    expect(rect.named).toBe(true);
    expect(rect.hidden).toBe(compact);
    expect(rect.inside).toBe(true);
    expect(rect.textInside).toBe(true);
  }
}

export function mainCta(page: Page) {
  return page.locator('[aria-labelledby="pending-heading"]').getByRole('link', { name: 'Avaliar experiência', exact: true });
}

export function operationsCta(page: Page) {
  return page.getByRole('main').getByRole('link', { name: 'Nova Operação', exact: true });
}

export async function openOperations(page: Page) {
  await page.goto('/restaurant/demands');
  await expect(page.getByRole('heading', { name: 'Operações', exact: true, level: 1 })).toBeVisible();
  await expect(operationsCta(page)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filtrar operações', exact: true })).toBeVisible();
}

export async function measureCta(cta: Locator) {
  await expect(cta).toBeVisible();
  await cta.scrollIntoViewIfNeeded();
  return cta.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(button);
    const textRects = [...range.getClientRects()].filter((text) => text.width > 0 && text.height > 0);
    const ancestors: Element[] = [];
    for (let parent = button.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
    return {
      height: rect.height,
      width: rect.width,
      textInside: textRects.every((text) => text.left >= rect.left - 1 && text.right <= rect.right + 1 && text.top >= rect.top - 1 && text.bottom <= rect.bottom + 1),
      clipped: ancestors.some((parent) => {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        return (['hidden', 'clip'].includes(style.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1))
          || (['hidden', 'clip'].includes(style.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1));
      }),
      hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
      lines: new Set(textRects.map((text) => Math.round(text.top))).size,
      href: button.getAttribute('href'),
    };
  });
}

export async function saveEvidence(target: Locator, filename: string, info: TestInfo) {
  const directory = path.resolve('test-results', 'evidence');
  await mkdir(directory, { recursive: true });
  const screenshot = await target.screenshot({ animations: 'disabled' });
  await info.attach(filename, { body: screenshot, contentType: 'image/png' });
  if (info.project.name === 'authenticated-desktop') {
    await target.screenshot({ path: path.join(directory, filename), animations: 'disabled' });
  }
}
