import { test, expect } from '../src/fixtures/test-fixtures.js';
import { testConfig } from '../src/config/test-config.js';

test('framework configuration is available', async () => {
  expect(testConfig.baseUrl).toBeTruthy();
  expect(testConfig.viewport.width).toBeGreaterThan(0);
});
