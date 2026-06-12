import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_STATE = 'test-results/.auth/user.json';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  // Spec files share one database and several truncate their domain's
  // tables in beforeAll — run files sequentially so runs stay deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: /mobile\//,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    // Touch-first regression net: only the mobile suite runs here, on a
    // phone profile (412px, touch, mobile UA) — Pixel keeps it Chromium.
    {
      name: 'mobile',
      dependencies: ['setup'],
      testMatch: /mobile\/.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
    },
  ],
  webServer: {
    command: process.env.CI ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The e2e server answers on :3100; auth callbacks must match.
      APP_URL: BASE_URL,
    },
  },
});
