import { defineConfig, devices } from '@playwright/test';
import { testConfig } from './src/config/test-config.js';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**'],
  timeout: testConfig.timeoutMs,
  expect: {
    timeout: testConfig.expectTimeoutMs
  },
  fullyParallel: true,
  forbidOnly: testConfig.isCi,
  retries: testConfig.isCi ? 2 : 0,
  workers: testConfig.isCi ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: testConfig.playwrightReportDir, open: 'never' }]
  ],
  use: {
    baseURL: testConfig.baseUrl,
    actionTimeout: testConfig.actionTimeoutMs,
    navigationTimeout: testConfig.navigationTimeoutMs,
    headless: testConfig.headless,
    viewport: testConfig.viewport,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false
  },
  outputDir: testConfig.testResultsDir,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ]
});
