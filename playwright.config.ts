import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Run tests sequentially — we're hitting a real local server with real DB state
  fullyParallel: false,
  retries: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    // Headless by default; set PWDEBUG=1 to see the browser
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  // Only test Chromium for smoke purposes
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Do not spin up a dev server — smoke tests expect `pnpm dev` already running
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
