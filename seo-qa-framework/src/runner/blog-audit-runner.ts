import { BrowserManager, type SupportedBrowserName } from '../playwright/browser-manager.js';
import { PageHelper } from '../playwright/page-helper.js';
import { ScreenshotHelper } from '../playwright/screenshot-helper.js';
import { extractLiveBlogContent } from '../seo-checks/blog-validator.js';
import { parseBlogDocx } from '../blog/docx-blog-parser.js';
import { compareBlogContent } from '../blog/blog-comparator.js';
import { RedirectChecker } from '../seo-checks/redirect-check.js';
import { BrokenLinkChecker } from '../seo-checks/broken-link-check.js';
import { AccessibilityChecker } from '../seo-checks/accessibility-check.js';
import { LighthouseChecker } from '../seo-checks/lighthouse-check.js';
import type { AuditRunResult } from '../types/audit-run-result.js';
import { logger } from '../logger/logger.js';

export interface BlogAuditRunnerOptions {
  /** Browser engine used to load the live blog page. Defaults to chromium. */
  browserName?: SupportedBrowserName;

  /**
   * Lighthouse URLs to audit. When set:
   *   undefined  → Lighthouse disabled (CLI default)
   *   []         → Lighthouse disabled
   *   [url]      → Run Lighthouse for the blog URL (typical web-API usage)
   */
  lighthouseUrls?: string[];

  /** Force redirect check on the blog URL (web-API). */
  alwaysRunRedirectCheck?: boolean;
  /** Force broken-link scan on the blog page (web-API). */
  alwaysRunBrokenLinkCheck?: boolean;
  /** Force axe accessibility scan on the blog page (web-API). */
  alwaysRunAccessibilityCheck?: boolean;
}

export class BlogAuditRunner {
  constructor(private readonly options: BlogAuditRunnerOptions = {}) {}

  async run(docxPath: string, url: string): Promise<AuditRunResult> {
    const startedAt = new Date();

    const expected = await parseBlogDocx(docxPath, url);
    logger.info('Blog document parsed.', {
      docxPath,
      h2Count: expected.h2Headings.length,
      h3Count: expected.h3Headings.length,
      h4Count: expected.h4Headings.length,
      paragraphCount: expected.paragraphs.length,
      hasMetaTitle: Boolean(expected.metaTitle),
      hasMetaDescription: Boolean(expected.metaDescription)
    });

    const browserManager = new BrowserManager();
    const browser = await browserManager.launch(this.options.browserName);

    let seoCheckResults;
    const redirectResults = [];
    const brokenLinkResults = [];
    const accessibilityResults = [];
    const lighthouseResults = [];

    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const pageHelper = new PageHelper(page);
        const screenshotHelper = new ScreenshotHelper(page);
        void screenshotHelper; // available but not used by blog runner

        await pageHelper.goto(url);
        await pageHelper.waitForPageReady();

        const actual = await extractLiveBlogContent(page);
        seoCheckResults = compareBlogContent(url, expected, actual);

        // ── Optional modules (web-API-driven) ──────────────────────────────────

        if (this.options.alwaysRunRedirectCheck) {
          redirectResults.push(await new RedirectChecker(page.context().request).check(url));
        }

        if (this.options.alwaysRunBrokenLinkCheck) {
          brokenLinkResults.push(...(await new BrokenLinkChecker().check(page)));
        }

        if (this.options.alwaysRunAccessibilityCheck) {
          accessibilityResults.push(await new AccessibilityChecker().check(page));
        }
      } finally {
        await context.close();
      }
    } finally {
      await browserManager.close();
    }

    // Lighthouse runs independently (no browser context needed)
    if (
      this.options.lighthouseUrls !== undefined &&
      this.options.lighthouseUrls.length > 0 &&
      this.options.lighthouseUrls.some(u => u.trim() === url.trim())
    ) {
      lighthouseResults.push(await new LighthouseChecker().check(url));
    }

    const finishedAt = new Date();

    logger.info('Blog content validation completed.', {
      url,
      totalChecks: seoCheckResults.length,
      passed: seoCheckResults.filter(r => r.status === 'passed').length,
      failed: seoCheckResults.filter(r => r.status === 'failed').length,
      redirects: redirectResults.length,
      brokenLinks: brokenLinkResults.length,
      accessibility: accessibilityResults.length,
      lighthouse: lighthouseResults.length,
    });

    return {
      sourcePath: docxPath,
      kind: 'blog',
      totalRows: seoCheckResults.length,
      seoCheckResults,
      redirectResults,
      brokenLinkResults,
      accessibilityResults,
      lighthouseResults,
      skipped: [],
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime()
    };
  }
}
