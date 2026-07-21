import type { Locator, Page, Response } from '@playwright/test';
import { testConfig } from '../config/test-config.js';

export class PageHelper {
  constructor(private readonly page: Page) {}

  async goto(pathOrUrl: string): Promise<Response | null> {
    return this.page.goto(pathOrUrl, {
      waitUntil: 'domcontentloaded',
      timeout: testConfig.navigationTimeoutMs
    });
  }

  async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle');
  }

  byTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }
}
