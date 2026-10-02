import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    // Environments with a preinstalled Chromium can point at it instead of `playwright install`.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    {
      name: 'mobile-360',
      testIgnore: /(individual|deduction|auto-approve)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } },
    },
    {
      name: 'desktop-1440',
      testIgnore: /(individual|deduction|auto-approve)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // T40/T41: change the shared active term (individual mode, an extra deduction component), so they run
    // after every other spec
    {
      name: 'isolated',
      testMatch: /(individual|deduction)\.spec\.ts/,
      dependencies: ['mobile-360', 'desktop-1440'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } },
    },
    // switches every new evaluation to "อนุมัติอัตโนมัติ", so it runs after the other isolated specs too
    {
      name: 'isolated-auto',
      testMatch: /auto-approve\.spec\.ts/,
      dependencies: ['isolated'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
