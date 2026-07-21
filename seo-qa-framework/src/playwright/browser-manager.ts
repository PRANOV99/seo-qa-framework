import { chromium, firefox, webkit, type Browser, type BrowserType } from '@playwright/test';
import { testConfig } from '../config/test-config.js';

export type SupportedBrowserName = 'chromium' | 'firefox' | 'webkit';

const browserTypes: Record<SupportedBrowserName, BrowserType> = {
  chromium,
  firefox,
  webkit
};

export class BrowserManager {
  private browser?: Browser;

  async launch(browserName: SupportedBrowserName = 'chromium'): Promise<Browser> {
    this.browser = await browserTypes[browserName].launch({
      headless: testConfig.headless
    });

    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}
