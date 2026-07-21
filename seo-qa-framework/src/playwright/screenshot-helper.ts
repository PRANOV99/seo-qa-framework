import path from 'node:path';
import type { Page } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import { ensureDirectory } from '../utils/file-system.js';

export class ScreenshotHelper {
  constructor(private readonly page: Page) {}

  async capture(name: string): Promise<string> {
    await ensureDirectory(testConfig.screenshotDir);

    const safeName = name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    const screenshotPath = path.join(testConfig.screenshotDir, `${safeName}.png`);

    await this.page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    return screenshotPath;
  }
}
