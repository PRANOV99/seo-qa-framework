import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright';
import { testConfig } from '../config/test-config.js';
import { isProduction } from '../config/env.js';

export type SupportedBrowserName = 'chromium' | 'firefox' | 'webkit';

const browserTypes: Record<SupportedBrowserName, BrowserType> = {
  chromium,
  firefox,
  webkit
};

/**
 * Extra Chromium launch flags required in the production container (the
 * Microsoft Playwright Docker image used on Render, which runs as root):
 *  - --no-sandbox: Chromium refuses to start as root without this, and the
 *    kernel privileges its sandbox needs aren't available in the container
 *    regardless.
 *  - --disable-setuid-sandbox: same reasoning, for the legacy sandbox path.
 *  - --disable-dev-shm-usage: containers ship a very small /dev/shm
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
