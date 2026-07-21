import { chromium, firefox, webkit, type Browser, type BrowserType } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import { isProduction } from '../config/env.js';

export type SupportedBrowserName = 'chromium' | 'firefox' | 'webkit';

const browserTypes: Record<SupportedBrowserName, BrowserType> = {
  chromium,
  firefox,
  webkit
};

/**
 * Extra Chromium launch flags required in constrained container environments
 * (e.g. Render's free/starter web services):
 *  - --no-sandbox: Chromium's sandbox needs kernel privileges that are
 *    unavailable in Render's containers, so launch fails without this.
 *  - --disable-setuid-sandbox: same reasoning, for the legacy sandbox path.
 *  - --disable-dev-shm-usage: containers ship with a very small /dev/shm
 *    (Render's free tier included), which can crash Chromium under load;
 *    this makes Chromium fall back to disk-backed temp files instead.
 * Only applied in production so local development is unaffected.
 */
const PRODUCTION_CHROMIUM_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

export class BrowserManager {
  private browser?: Browser;

  async launch(browserName: SupportedBrowserName = 'chromium'): Promise<Browser> {
    const args = isProduction && browserName === 'chromium' ? PRODUCTION_CHROMIUM_ARGS : undefined;

    this.browser = await browserTypes[browserName].launch({
      headless: testConfig.headless,
      ...(args ? { args } : {})
    });

    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}
