import type { Browser, Page } from 'playwright';
import { BrowserManager, type SupportedBrowserName } from '../playwright/browser-manager.js';
import { PageHelper } from '../playwright/page-helper.js';
import { extractLiveBlogContent } from '../seo-checks/blog-validator.js';
import { parseBlogDocx } from '../blog/docx-blog-parser.js';
import { compareBlogContent } from '../blog/blog-comparator.js';
import { RedirectChecker } from '../seo-checks/redirect-check.js';
import { BrokenLinkChecker } from '../seo-checks/broken-link-check.js';
import { AccessibilityChecker } from '../seo-checks/accessibility-check.js';
import { LighthouseChecker } from '../seo-checks/lighthouse-check.js';
import type { AuditRunResult } from '../types/audit-run-result.js';
import type { BlogContent } from '../types/blog.js';
import { logger } from '../logger/logger.js';

/**
 * How long to wait for network activity to settle before extracting content,
 * capped rather than left uncapped. `PageHelper.goto()` already waits for
 * `domcontentloaded`, so this only needs to cover JS-rendered content
 * (accordions, lazy sections, etc.) finishing its initial render. An
 * uncapped `networkidle` wait can stall for many seconds — sometimes the
 * full default timeout — on pages with continuous background activity
 * (analytics beacons, chat widgets, ad refreshes) that never truly go idle.
 * This is intentionally a blog-only helper rather than a change to the
 * shared PageHelper, which the Website SEO Audit workflow also depends on.
 */
const BLOG_NETWORK_IDLE_TIMEOUT_MS = 4000;

async function waitForBlogPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: BLOG_NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
}

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

  /**
   * @param docxSource   Either a path to the approved .docx (parsed fresh),
   *   or an already-parsed BlogContent — passed when re-running a
   *   previously-tested blog against a new crawl of the live page without
   *   re-uploading the document (see BlogBatchRunner / the `/rerun` route).
   * @param sharedBrowser  An already-launched Browser to reuse instead of
   *   launching (and closing) a fresh one for this run. Passed by
   *   BlogBatchRunner so a whole batch shares one browser process — a
   *   fresh BrowserContext is still created (and closed) per run either
   *   way, so isolation between blogs (cookies, storage, cache) is
   *   unaffected. When omitted, behaves exactly as a standalone run always
   *   has: launches its own browser and closes it before returning.
   * @param sourceLabel  Used as this run's `sourcePath` when `docxSource` is
   *   already-parsed content rather than a file path (there's no file to
   *   name it after) — typically the original .docx filename from history.
   */
  async run(
    docxSource: string | BlogContent,
    url: string,
    sharedBrowser?: Browser,
    sourceLabel?: string
  ): Promise<AuditRunResult> {
    const startedAt = new Date();

    const ownsBrowser = !sharedBrowser;
    const browserManager = ownsBrowser ? new BrowserManager() : undefined;

    // Parsing the approved .docx (CPU-bound, no browser involved) has no
    // dependency on launching the browser (I/O-bound process spawn) — when
    // this run owns its own browser, overlap the two instead of paying for
    // them sequentially. When docxSource is already-parsed content (a
    // re-run), there's nothing to parse at all.
    const [expected, browser] = await Promise.all([
      typeof docxSource === 'string' ? parseBlogDocx(docxSource, url) : Promise.resolve(docxSource),
      sharedBrowser ? Promise.resolve(sharedBrowser) : browserManager!.launch(this.options.browserName)
    ]);

    const sourcePath = typeof docxSource === 'string' ? docxSource : (sourceLabel ?? '(re-run — approved content reused)');

    logger.info('Blog document parsed.', {
      docxPath: sourcePath,
      reusedParsedContent: typeof docxSource !== 'string',
      h2Count: expected.h2Headings.length,
      h3Count: expected.h3Headings.length,
      h4Count: expected.h4Headings.length,
      paragraphCount: expected.paragraphs.length,
      hasMetaTitle: Boolean(expected.metaTitle),
      hasMetaDescription: Boolean(expected.metaDescription)
    });

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

        await pageHelper.goto(url);
        await waitForBlogPageReady(page);

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
      if (ownsBrowser) await browserManager!.close();
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
      sourcePath,
      kind: 'blog',
      expected,
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
