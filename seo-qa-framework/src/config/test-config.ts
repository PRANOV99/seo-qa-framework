import { env } from './env.js';

export const testConfig = {
  baseUrl: env.BASE_URL,
  auditSheetPath: env.AUDIT_SHEET_PATH,
  reportOutputDir: env.REPORT_OUTPUT_DIR,
  screenshotDir: env.SCREENSHOT_DIR,
  historyDir: env.HISTORY_DIR,
  playwrightReportDir: 'playwright-report',
  testResultsDir: 'test-results',
  logLevel: env.LOG_LEVEL,
  isCi: env.CI,
  timeoutMs: env.TEST_TIMEOUT_MS,
  expectTimeoutMs: env.EXPECT_TIMEOUT_MS,
  actionTimeoutMs: env.ACTION_TIMEOUT_MS,
  navigationTimeoutMs: env.NAVIGATION_TIMEOUT_MS,
  headless: env.HEADLESS,
  viewport: {
    width: env.VIEWPORT_WIDTH,
    height: env.VIEWPORT_HEIGHT
  }
} as const;
