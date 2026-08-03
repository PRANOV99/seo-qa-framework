import type { Browser, BrowserContext, Page } from '@playwright/test';
import { BrowserManager, type SupportedBrowserName } from '../playwright/browser-manager.js';
import { PageHelper } from '../playwright/page-helper.js';
import { ScreenshotHelper } from '../playwright/screenshot-helper.js';
import { parseAuditSheet } from '../parsers/parser-factory.js';
import { seoChecks } from '../seo-checks/index.js';
import { RedirectChecker } from '../seo-checks/redirect-check.js';
import { BrokenLinkChecker } from '../seo-checks/broken-link-check.js';
import { AccessibilityChecker } from '../seo-checks/accessibility-check.js';
import { LighthouseChecker } from '../seo-checks/lighthouse-check.js';
import { FaqChecker } from '../seo-checks/faq-check.js';
import type { FaqAuditGroup, SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { RedirectResult } from '../types/redirect-result.js';
import type { BrokenLinkResult } from '../types/broken-link-result.js';
import type { AccessibilityCheckResult } from '../types/accessibility-result.js';
import type { LighthouseCheckResult } from '../types/lighthouse-result.js';
import type { AuditRunResult, SkippedAuditRow } from '../types/audit-run-result.js';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';
import { buildChecksByType, groupAuditRowsByUrl, resolveCheckDispatch } from './audit-runner-utils.js';

/**
 * How long to wait for network activity to settle before extracting FAQ
 * content, capped rather than left uncapped — mirrors the same fix already
 * applied for the same reason in blog-audit-runner.ts's
 * waitForBlogPageReady(). An FAQ sheet visits many varied pages (blog posts,
 * home page, etc.), and an uncapped `networkidle` wait can stall for the
 * full navigation timeout on pages with continuous background activity
 * (analytics beacons, chat widgets, ad refreshes) that never truly go idle
 * — confirmed for real against jrcprojects.com, where two blog pages timed
 * out after 30s despite their "load" event having already fired. This is
 * deliberately scoped to the FAQ branch only, not a change to the shared
 * PageHelper.waitForPageReady(), which the rest of the Website SEO Audit
 * workflow also depends on.
 */
const FAQ_NETWORK_IDLE_TIMEOUT_MS = 4000;

async function waitForFaqPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: FAQ_NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
}

/**
 * Resource types that carry real page weight but contribute nothing to FAQ
 * text extraction — the check only reads DOM text (question/answer
 * elements), never rendered pixels, so blocking these cuts per-page load
 * time substantially. `<img>` tags and their attributes stay in the DOM
 * either way, only the byte fetch is aborted. Mirrors
 * blog-audit-runner.ts's blockHeavyResources(); scoped to the FAQ branch
 * only for the same reason as the wait above — FAQ groups are the only
 * thing that runs on this shared page after this route handler is
 * registered, so it can never affect the rest of the sheet workflow.
 */
const FAQ_BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

async function blockHeavyResourcesForFaq(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    if (FAQ_BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
      return route.abort();
    }
    return route.continue();
  });
}

export interface AuditRunnerOptions {
  /** Overrides testConfig.baseUrl when audit rows contain relative URLs. */
  baseUrl?: string;
  /** Browser engine used to visit audited pages. Defaults to chromium. */
  browserName?: SupportedBrowserName;
  /** Captures a screenshot for every failed SEO check. Defaults to true. */
  captureScreenshotsOnFailure?: boolean;
  /** Runs an axe-core accessibility scan when the audit sheet flags an accessibility issue. Defaults to true. */
  enableAccessibilityChecks?: boolean;
  /** Runs a Lighthouse audit when the audit sheet flags a performance issue. Defaults to true. */
  enableLighthouseChecks?: boolean;

  // ── Web-API-driven forced execution ─────────────────────────────────────────
  // These run the module on every URL regardless of sheet issue types.
  // All default to false so the CLI is completely unaffected.

  /** Force a redirect check on every audited URL (web API). */
  alwaysRunRedirectCheck?: boolean;
  /** Force a broken-link scan on every audited URL (web API). */
  alwaysRunBrokenLinkCheck?: boolean;
  /** Force an axe-core accessibility scan on every audited URL (web API). */
  alwaysRunAccessibilityCheck?: boolean;

  /**
   * When set by the web API, Lighthouse runs only on the URLs listed here.
   * - undefined  → use sheet-driven dispatch (CLI behaviour, unchanged)
   * - []         → Lighthouse disabled for this run
   * - ['url'…]  → run only for the listed canonical URLs
   */
  lighthouseUrls?: string[];
}

interface UrlGroupContext {
  url: string;
  rows: SeoAuditRow[];
  page: Page;
  pageHelper: PageHelper;
  screenshotHelper: ScreenshotHelper;
  seoCheckResults: SeoCheckResult[];
  redirectResults: RedirectResult[];
  brokenLinkResults: BrokenLinkResult[];
  accessibilityResults: AccessibilityCheckResult[];
  lighthouseResults: LighthouseCheckResult[];
  skipped: SkippedAuditRow[];
}

export class AuditRunner {
  private readonly checksByType = buildChecksByType(seoChecks);

  constructor(private readonly options: AuditRunnerOptions = {}) {}

  async run(auditSheetPath: string): Promise<AuditRunResult> {
    const startedAt = new Date();
    const parseResult = await parseAuditSheet(auditSheetPath);

    logger.info('Audit sheet parsed.', {
      sourcePath: parseResult.sourcePath,
      mode: parseResult.mode,
      rowCount: parseResult.rows.length,
      detectedColumns: parseResult.detectedColumns,
      detectedFields: parseResult.detectedFields,
      faqGroupCount: parseResult.faqGroups?.length,
      unresolvedFaqGroupCount: parseResult.unresolvedFaqGroups?.length
    });

    const seoCheckResults: SeoCheckResult[] = [];
    const redirectResults: RedirectResult[] = [];
    const brokenLinkResults: BrokenLinkResult[] = [];
    const accessibilityResults: AccessibilityCheckResult[] = [];
    const lighthouseResults: LighthouseCheckResult[] = [];
    const skipped: SkippedAuditRow[] = [];

    const baseUrl = this.options.baseUrl ?? testConfig.baseUrl;
    const browserManager = new BrowserManager();
    const browser: Browser = await browserManager.launch(this.options.browserName);
    let context: BrowserContext | undefined;

    try {
      context = await browser.newContext({ viewport: testConfig.viewport, baseURL: baseUrl });
      const page = await context.newPage();
      const pageHelper = new PageHelper(page);
      const screenshotHelper = new ScreenshotHelper(page);

      const rowsByUrl = groupAuditRowsByUrl(parseResult.rows, baseUrl);

      for (const [url, rows] of rowsByUrl) {
        await this.processUrlGroup({
          url,
          rows,
          page,
          pageHelper,
          screenshotHelper,
          seoCheckResults,
          redirectResults,
          brokenLinkResults,
          accessibilityResults,
          lighthouseResults,
          skipped
        });
      }

      const faqGroups = parseResult.faqGroups ?? [];
      if (faqGroups.length > 0) {
        await blockHeavyResourcesForFaq(page);
      }
      for (const group of faqGroups) {
        seoCheckResults.push(...(await this.runFaqGroup(pageHelper, page, group)));
      }
    } finally {
      await context?.close();
      await browserManager.close();
    }

    for (const unresolved of parseResult.unresolvedFaqGroups ?? []) {
      const faqCountLabel = `${unresolved.faqCount} FAQ${unresolved.faqCount === 1 ? '' : 's'}`;
      seoCheckResults.push({
        url: unresolved.label,
        checkType: 'FAQ (skipped)',
        status: 'warning',
        expected: `${faqCountLabel} for page "${unresolved.label}" — not a live-site bug, nothing to fix on the page itself.`,
        actual: `Untested — no hyperlink/URL found in the sheet for page label "${unresolved.label}" (row ${unresolved.sourceRowNumber}). ` +
          'Add a real link in the sheet and re-run to test this page\'s FAQs.',
        message: `${faqCountLabel} could not be tested.`
      });
    }

    const finishedAt = new Date();
    const faqRowCount =
      (parseResult.faqGroups ?? []).reduce((sum, group) => sum + group.faqs.length, 0) +
      (parseResult.unresolvedFaqGroups ?? []).reduce((sum, group) => sum + group.faqCount, 0);

    return {
      sourcePath: parseResult.sourcePath,
      totalRows: parseResult.mode === 'faq' ? faqRowCount : parseResult.rows.length,
      seoCheckResults,
      redirectResults,
      brokenLinkResults,
      accessibilityResults,
      lighthouseResults,
      skipped,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime()
    };
  }

  private async processUrlGroup(groupContext: UrlGroupContext): Promise<void> {
    const {
      url,
      rows,
      page,
      pageHelper,
      screenshotHelper,
      seoCheckResults,
      redirectResults,
      brokenLinkResults,
      accessibilityResults,
      lighthouseResults,
      skipped
    } = groupContext;

    const navigationError = await this.navigate(pageHelper, url);
    let redirectChecked = false;
    let brokenLinksChecked = false;
    let accessibilityChecked = false;
    let performanceChecked = false;

    for (const row of rows) {
      const dispatch = resolveCheckDispatch(row, this.checksByType);

      // Redirect and performance checks make their own independent network
      // requests, so they run even if the Playwright page failed to load.
      if (dispatch.kind === 'redirect') {
        if (!redirectChecked) {
          redirectChecked = true;
          redirectResults.push(await new RedirectChecker(page.context().request).check(url));
        }
        continue;
      }

      if (dispatch.kind === 'performance') {
        if (!this.shouldRunLighthouse()) {
          skipped.push({ auditRow: row, reason: 'Lighthouse checks are disabled for this run.' });
        } else if (!performanceChecked) {
          performanceChecked = true;
          lighthouseResults.push(await new LighthouseChecker().check(url));
        }
        continue;
      }

      if (navigationError) {
        if (dispatch.kind === 'seoCheck') {
          seoCheckResults.push({
            url,
            checkType: row.checkType,
            status: 'failed',
            expected: row.expectedValue,
            message: `Unable to load the page for SEO validation: ${navigationError}`
          });
        } else if (dispatch.kind === 'brokenLink') {
          skipped.push({
            auditRow: row,
            reason: `Unable to load the page to scan for broken links: ${navigationError}`
          });
        } else if (dispatch.kind === 'accessibility') {
          skipped.push({
            auditRow: row,
            reason: `Unable to load the page to run an accessibility scan: ${navigationError}`
          });
        } else {
          skipped.push({
            auditRow: row,
            reason: `No SEO check is implemented for issue type "${row.issueType}".`
          });
        }
        continue;
      }

      if (dispatch.kind === 'seoCheck') {
        seoCheckResults.push(await this.runSeoCheck(dispatch.check, page, row, screenshotHelper));
        continue;
      }

      if (dispatch.kind === 'brokenLink') {
        if (!brokenLinksChecked) {
          brokenLinksChecked = true;
          brokenLinkResults.push(...(await new BrokenLinkChecker().check(page)));
        }
        continue;
      }

      if (dispatch.kind === 'accessibility') {
        if (!this.shouldRunAccessibility()) {
          skipped.push({ auditRow: row, reason: 'Accessibility checks are disabled for this run.' });
        } else if (!accessibilityChecked) {
          accessibilityChecked = true;
          accessibilityResults.push(await new AccessibilityChecker().check(page));
        }
        continue;
      }

      skipped.push({
        auditRow: row,
        reason: `No SEO check is implemented for issue type "${row.issueType}".`
      });
    }

    // ── Forced modules (web-API-driven, run once per URL regardless of sheet content) ──

    // Redirect check
    if (this.options.alwaysRunRedirectCheck && !redirectChecked) {
      redirectResults.push(await new RedirectChecker(page.context().request).check(url));
    }

    // Broken-link scan (requires a successfully loaded page)
    if (this.options.alwaysRunBrokenLinkCheck && !brokenLinksChecked && !navigationError) {
      brokenLinkResults.push(...(await new BrokenLinkChecker().check(page)));
    }

    // Accessibility scan (requires a successfully loaded page)
    if (this.options.alwaysRunAccessibilityCheck && !accessibilityChecked && !navigationError) {
      accessibilityResults.push(await new AccessibilityChecker().check(page));
    }

    // Lighthouse — run when this URL is explicitly listed in lighthouseUrls
    if (
      this.options.lighthouseUrls !== undefined &&
      !performanceChecked &&
      this.options.lighthouseUrls.some(u => u.trim() === url.trim())
    ) {
      lighthouseResults.push(await new LighthouseChecker().check(url));
    }
  }

  private async runFaqGroup(pageHelper: PageHelper, page: Page, group: FaqAuditGroup): Promise<SeoCheckResult[]> {
    const navigationError = await this.navigateForFaq(pageHelper, page, group.url);

    if (navigationError) {
      // A load/timeout failure, not a live-site content bug — kept out of
      // 'failed' (Must Fix) so it doesn't inflate the real bug count; the
      // fix here is to re-run the audit, not to change anything on the page.
      return [
        {
          url: group.url,
          checkType: 'FAQ (page load failed)',
          status: 'warning',
          expected: `This page's FAQs — not a live-site bug, nothing to fix on the page itself.`,
          actual: `Untested — the page failed to load: ${navigationError} Re-run the audit to test this page's FAQs.`,
          message: `Unable to load the page to check its FAQs: ${navigationError}`
        }
      ];
    }

    return new FaqChecker().check(page, group);
  }

  /** FAQ-specific navigation using the bounded networkidle wait (see FAQ_NETWORK_IDLE_TIMEOUT_MS above) instead of the shared, uncapped PageHelper.waitForPageReady(). */
  private async navigateForFaq(pageHelper: PageHelper, page: Page, url: string): Promise<string | undefined> {
    try {
      await pageHelper.goto(url);
      await page.waitForLoadState('domcontentloaded');
      await waitForFaqPageReady(page);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to navigate to audited URL for FAQ check.', { url, error: message });
      return message;
    }
  }

  private async navigate(pageHelper: PageHelper, url: string): Promise<string | undefined> {
    try {
      await pageHelper.goto(url);
      await pageHelper.waitForPageReady();
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to navigate to audited URL.', { url, error: message });
      return message;
    }
  }

  private async runSeoCheck(
    check: (typeof seoChecks)[number],
    page: Page,
    row: SeoAuditRow,
    screenshotHelper: ScreenshotHelper
  ): Promise<SeoCheckResult> {
    const result = await check.run(page, row);

    if (result.status !== 'failed' || !this.shouldCaptureScreenshots()) {
      return result;
    }

    try {
      const screenshotPath = await screenshotHelper.capture(`${row.issueType}-row-${row.sourceRowNumber}`);
      return { ...result, screenshotPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to capture failure screenshot.', { url: row.url, error: message });
      return result;
    }
  }

  private shouldCaptureScreenshots(): boolean {
    return this.options.captureScreenshotsOnFailure ?? true;
  }

  private shouldRunAccessibility(): boolean {
    return this.options.enableAccessibilityChecks ?? true;
  }

  private shouldRunLighthouse(): boolean {
    return this.options.enableLighthouseChecks ?? true;
  }
}
