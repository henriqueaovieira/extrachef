import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { hasPlaywrightCredentials } from './fixtures/env';
import {
  measureCta,
  openOperations,
  operationsCta,
} from './fixtures/test-data';

test.skip(() => !hasPlaywrightCredentials(), 'Credenciais ausentes.');

test.beforeEach(async ({ page }) => openOperations(page));

test.afterEach(async ({ page }, info) => {
  const header = page.getByRole('main').locator('header');
  await info.attach('permanent-controls.html', {
    body: await header.evaluate((element) => element.outerHTML),
    contentType: 'text/html',
  });
  await info.attach('permanent-controls.png', {
    body: await header.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
});

test('A11Y-001 axe sem violacoes critical', async ({ page }, info) => {
  const results = await new AxeBuilder({ page })
    .include('main')
    .analyze();

  await info.attach('axe-results.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });

  expect(
    results.violations.filter(
      (violation) => violation.impact === 'critical'
    )
  ).toEqual([]);
});

test('A11Y-002 navegacao por Tab e Shift+Tab', async ({ page }) => {
  const back = page.getByRole('link', {
    name: '← Home',
    exact: true,
  });

  const cta = operationsCta(page);
  const filters = page.getByRole('group', { name: 'Filtrar operações', exact: true });
  const all = filters.getByRole('button', { name: 'Todas', exact: true });
  const today = filters.getByRole('button', { name: 'Hoje', exact: true });

  await back.focus();

  await page.keyboard.press('Tab');
  await expect(cta).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(all).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(cta).toBeFocused();

  await today.focus();
  await page.keyboard.press('Enter');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');

  await all.focus();
  await page.keyboard.press('Space');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(today).toHaveAttribute('aria-pressed', 'false');
});

test('A11Y-003 foco visivel na acao principal', async ({ page }) => {
  const cta = operationsCta(page);

  await page
    .getByRole('link', { name: '← Home', exact: true })
    .focus();

  await page.keyboard.press('Tab');

  await expect(cta).toBeFocused();

  const focus = await cta.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      visible: element.matches(':focus-visible'),
      outline: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
    };
  });

  expect(focus.visible).toBe(true);
  expect(focus.outline).toBeGreaterThan(0);
  expect(focus.style).not.toBe('none');
});

test.describe('Navegacao compacta', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('A11Y-004 todos os icones da bottom nav possuem aria-label', async ({ page }) => {
    const navigation = page.getByRole('navigation', {
      name: 'Navegação principal',
      exact: true,
    });

    await expect(navigation).toBeVisible();

    const links = navigation.getByRole('link');

    await expect(links).toHaveCount(6);

    const count = await links.count();

    for (let i = 0; i < count; i++) {
      const link = links.nth(i);

      await expect(link).toHaveAttribute(
        'aria-label',
        /\S+/
      );

      await expect(
        link.locator('.ec-mobile-nav__label')
      ).toBeHidden();

      await expect(link).toHaveAccessibleName(/\S+/);
    }
  });
});

test('A11Y-005 CTA tem alvo minimo de 44px', async ({ page }, info) => {
  const bounds = await measureCta(operationsCta(page));

  await info.attach('cta-measurements.json', {
    body: JSON.stringify(bounds, null, 2),
    contentType: 'application/json',
  });

  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
});