import { test, expect } from '@playwright/test';
import { hasPlaywrightCredentials } from './fixtures/env';
import { expectNavigationFits, measureCta, openOperations, operationsCta, reflow, saveEvidence } from './fixtures/test-data';

test.skip(() => !hasPlaywrightCredentials(), 'Credenciais ausentes.');
test.beforeEach(async ({ page }) => openOperations(page));

test.afterEach(async ({ page }, info) => {
  await info.attach('responsive-geometry.json', {
    body: JSON.stringify(await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      deviceScaleFactor: devicePixelRatio,
      labels: [...document.querySelectorAll('.ec-mobile-nav__label')].map((label) => ({
        text: label.textContent,
        display: getComputedStyle(label).display,
      })),
    })), null, 2),
    contentType: 'application/json',
  });
  if (info.title.startsWith('D02-')) {
    const cta = operationsCta(page);
    await info.attach('cta-measurements.json', {
      body: JSON.stringify(await measureCta(cta), null, 2),
      contentType: 'application/json',
    });
    await info.attach('cta.html', {
      body: await cta.evaluate((element) => element.outerHTML),
      contentType: 'text/html',
    });
  }
});

for (const [id, width, height, zoom] of [
  ['D01-001', 320, 568, 1],
  ['D01-002', 320, 568, 1.25],
  ['D01-003', 320, 568, 1.5],
  ['D01-004', 320, 568, 2],
  ['D01-005', 375, 812, 2],
  ['D01-006', 376, 812, 1],
  ['D01-007', 1280, 800, 1],
] as const) {
  test(`${id} navegacao sem overlap na largura efetiva`, async ({ page }, info) => {
    await reflow(page, width, height, zoom);
    await expect.poll(() => page.evaluate(() => ({
      width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio,
    }))).toEqual({
      width: Math.round(width / zoom), height: Math.round(height / zoom), deviceScaleFactor: zoom,
    });
    await expectNavigationFits(page, width <= 375);
    if (id === 'D01-002') {
      await saveEvidence(page.getByRole('navigation', { name: 'Navegação principal', exact: true }), 'mobile-nav-after.png', info);
    }
  });
}

test('D02-001 texto contido no CTA', async ({ page }, info) => {
  await reflow(page, 320, 568, 2);
  expect((await measureCta(operationsCta(page))).textInside).toBe(true);
  await saveEvidence(operationsCta(page), 'cta-after.png', info);
});

test('D02-002 alvo de pelo menos 44px', async ({ page }) => {
  await reflow(page, 320, 568, 2);
  const bounds = await measureCta(operationsCta(page));
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
});

test('D02-003 CTA sem clipping e clicavel', async ({ page }) => {
  await reflow(page, 320, 568, 2);
  const cta = operationsCta(page), bounds = await measureCta(cta);
  expect(bounds.clipped).toBe(false);
  expect(bounds.hit).toBe(true);
  expect(bounds.href).toBe('/restaurant/dashboard/jobs/create');
  await cta.click({ trial: true });
});

test('D02-004 texto contido e sem clipping em reflow extremo', async ({ page }) => {
  await reflow(page, 320, 568, 2);
  const bounds = await measureCta(operationsCta(page));
  expect(bounds.textInside).toBe(true);
  expect(bounds.clipped).toBe(false);
});
