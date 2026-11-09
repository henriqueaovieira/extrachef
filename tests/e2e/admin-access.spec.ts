import { test, expect } from '@playwright/test';

interface LoginCase {
  label: string;
  email?: string;
  password?: string;
  expectedStatus: number;
  expectedRole?: string;
}

const cases: LoginCase[] = [
  {
    label: 'Worker',
    email: process.env.PLAYWRIGHT_WORKER_EMAIL,
    password: process.env.PLAYWRIGHT_WORKER_PASSWORD,
    expectedStatus: 403,
  },
  {
    label: 'Restaurant',
    email: process.env.PLAYWRIGHT_EMAIL,
    password: process.env.PLAYWRIGHT_PASSWORD,
    expectedStatus: 403,
  },
  {
    label: 'Admin',
    email: process.env.PLAYWRIGHT_ADMIN_EMAIL,
    password: process.env.PLAYWRIGHT_ADMIN_PASSWORD,
    expectedStatus: 200,
    expectedRole: 'admin',
  },
];

for (const login of cases) {
  test(`${login.label} ${login.expectedStatus === 200 ? 'can' : 'cannot'} access /admin`, async ({ browser }) => {
    test.skip(!login.email || !login.password, `Credenciais ${login.label} não configuradas.`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel('E-mail', { exact: true }).fill(login.email!);
      await page.getByLabel('Senha', { exact: true }).fill(login.password!);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);

      const response = await page.goto('/admin');
      expect(response?.status()).toBe(login.expectedStatus);
      if (login.expectedStatus === 200) {
        await expect(page.getByRole('heading', { name: 'Admin Area' })).toBeVisible();
        await expect(page.getByText(login.expectedRole!, { exact: true })).toBeVisible();
        const access = await page.request.get('/api/admin/staff/me');
        expect(access.status()).toBe(200);
        expect(await access.json()).toMatchObject({ role: login.expectedRole, status: 'active' });
      } else {
        await expect(page.getByText('Acesso administrativo não autorizado.')).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}
