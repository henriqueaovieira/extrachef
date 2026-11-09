import { test as setup, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { hasPlaywrightCredentials, skipIfMissing } from '../fixtures/env';

setup.skip(() => !hasPlaywrightCredentials(), 'Credenciais ausentes: login nao executado.');

setup('Login restaurante', async ({ page }) => {
  const email = process.env.PLAYWRIGHT_EMAIL ?? null;
  const password = process.env.PLAYWRIGHT_PASSWORD ?? null;
  skipIfMissing(email, 'PLAYWRIGHT_EMAIL ausente: autenticacao ignorada.');
  skipIfMissing(password, 'PLAYWRIGHT_PASSWORD ausente: autenticacao ignorada.');
  await page.goto('/login?redirect=%2Frestaurant%2Fdemands');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/restaurant\/demands(?:[?#]|$)/);
  await expect(page.getByRole('navigation', { name: 'Navegação principal', exact: true })).toBeVisible();
  await mkdir('playwright/.auth', { recursive: true });
  await page.context().storageState({ path: 'playwright/.auth/restaurant.json' });
});
