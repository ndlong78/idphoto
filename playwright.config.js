import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: isCi
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/static-server.mjs',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !isCi,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      testMatch: /.*\.desktop\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-mobile',
      testMatch: /.*\.mobile\.spec\.js/,
      use: {
        ...devices['Pixel 7'],
      },
    },
    {
      name: 'cross-chromium',
      testMatch: /.*\.cross\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'cross-firefox',
      testMatch: /.*\.cross\.spec\.js/,
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'cross-webkit',
      testMatch: /.*\.cross\.spec\.js/,
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],
});
