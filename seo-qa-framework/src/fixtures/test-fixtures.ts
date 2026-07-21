import { test as base } from '@playwright/test';
import { PageHelper } from '../playwright/page-helper.js';
import { ScreenshotHelper } from '../playwright/screenshot-helper.js';

interface SeoQaFixtures {
  pageHelper: PageHelper;
  screenshotHelper: ScreenshotHelper;
}

export const test = base.extend<SeoQaFixtures>({
  pageHelper: async ({ page }, use) => {
    await use(new PageHelper(page));
  },
  screenshotHelper: async ({ page }, use) => {
    await use(new ScreenshotHelper(page));
  }
});

export { expect } from '@playwright/test';
