import { test, expect } from '@playwright/test';
import { hasPlaywrightCredentials } from './fixtures/env';
import { expectNavigationFits, getOperations, openOperation, reflow } from './fixtures/test-data';

test.skip(() => !hasPlaywrightCredentials() || !getOperations().FINISHED?.trim(), 'Credenciais ou OPERATION_FINISHED_URL ausentes.');
test.beforeEach(async ({ page }) => openOperation(page, getOperations().FINISHED));

for (const [width, height] of [[320, 568], [375, 812], [768, 1024], [1280, 800]]) {
  for (const zoom of [1, 1.25, 1.5, 2]) {
    test(`reflow ${width}x${height} ${zoom * 100}% equivalente`, async ({ page }) => {
      await reflow(page, width, height, zoom);
      await expectNavigationFits(page, Math.round(width / zoom) <= 375);
      for (const heading of ['summary-heading', 'operational-summary-heading', 'pending-heading', 'presence-heading', 'continuation-heading']) {
        const region = page.locator(`[aria-labelledby="${heading}"]`);
        await expect(region).toBeVisible();
        expect(await region.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth + 1;
        })).toBe(true);
      }
    });
  }
}

test('regressao visual dos cinco blocos do Operation Core', async ({ page }) => {
  for (const [heading, filename] of [
    ['summary-heading', 'operation-state.png'],
    ['operational-summary-heading', 'operation-summary.png'],
    ['pending-heading', 'operation-action-center.png'],
    ['presence-heading', 'operation-presence.png'],
    ['continuation-heading', 'operation-continuation.png'],
  ]) {
    const region = page.locator(`[aria-labelledby="${heading}"]`);
    await region.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(region).toHaveScreenshot(filename, {
      mask: [page.locator('[aria-labelledby="summary-heading"] p'), page.locator('[aria-labelledby="presence-heading"] li')],
    });
  }
});
