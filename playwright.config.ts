import { defineConfig } from '@playwright/test';
import { hasPlaywrightCredentials, PLAYWRIGHT_BASE_URL } from './tests/e2e/fixtures/env';

const authenticated = hasPlaywrightCredentials();
const local = ['localhost', '127.0.0.1'].includes(new URL(PLAYWRIGHT_BASE_URL).hostname);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/runs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 0 },
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-artifacts/junit.xml' }],
  ],
  use: {
    baseURL: PLAYWRIGHT_BASE_URL,
    proxy: process.env.PLAYWRIGHT_PROXY_SERVER ? {
      server: process.env.PLAYWRIGHT_PROXY_SERVER,
      bypass: '<-loopback>',
    } : undefined,
    browserName: 'chromium',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: local && authenticated && process.env.PLAYWRIGHT_EXTERNAL_SERVER !== '1' ? {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: new URL('/login', PLAYWRIGHT_BASE_URL).href,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PORT: new URL(PLAYWRIGHT_BASE_URL).port || '3000' },
  } : undefined,
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined, trace: 'off', video: 'off', screenshot: 'off' },
    },
    ...[
      { name: 'authenticated-desktop', viewport: { width: 1280, height: 800 } },
      { name: 'authenticated-tablet', viewport: { width: 768, height: 1024 } },
      { name: 'authenticated-mobile', viewport: { width: 375, height: 812 } },
      { name: 'authenticated-mobile-small', viewport: { width: 320, height: 568 } },
    ].map(({ name, viewport }) => ({
      name,
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        viewport,
        storageState: authenticated ? 'playwright/.auth/restaurant.json' : undefined,
      },
    })),
  ],
});
