import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    // Serve a production build: the dev/Turbopack client manifest can be
    // incomplete on cold compile, which is flaky for E2E. `next start` has a
    // complete manifest and matches what public testers will run.
    command: 'npm run db:migrate:deploy && npm run build && npm run start -- -p 3002',
    url: 'http://localhost:3002',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'tradeplay-e2e-secret-at-least-32-characters',
      AUTH_URL: process.env.AUTH_URL ?? 'http://localhost:3002',
      DATABASE_URL: process.env.DATABASE_URL ?? 'file:./prisma/e2e.db',
    },
  },
});
