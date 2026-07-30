import type { Browser } from 'playwright';
import { BlogAuditRunner, type BlogAuditRunnerOptions } from './blog-audit-runner.js';
import { BrowserManager } from '../playwright/browser-manager.js';
import type { AuditRunResult } from '../types/audit-run-result.js';
import type { BlogContent } from '../types/blog.js';
import { logger } from '../logger/logger.js';
import { testConfig } from '../config/test-config.js';

/** Minimal shape BlogBatchRunner depends on for launching a shared browser — lets tests inject a fake in place of a real BrowserManager. */
export type BrowserManagerLike = Pick<BrowserManager, 'launch' | 'close'>;

export interface BlogBatchItem {
  /**
   * Either the absolute path to an uploaded .docx on disk (parsed fresh), or
   * already-parsed BlogContent — used when re-running a previously-tested
   * blog against a new crawl of the live page without re-uploading the
   * document (see the `/api/runs/rerun` route).
   */
  docxSource: string | BlogContent;
  /** Live blog URL to validate this document against. */
  url: string;
  /** Original filename, for progress reporting and result labeling. */
  filename: string;
}

export interface BlogBatchItemResult {
  filename: string;
  url: string;
  status: 'done' | 'error';
  result?: AuditRunResult;
  error?: string;
}

export interface BlogBatchRunnerCallbacks {
  /** Fired right before an item starts running. May return a Promise — it is awaited before the item starts. */
  onStart?: (index: number, total: number, item: BlogBatchItem) => void | Promise<void>;
  /** Fired right after an item settles (success or failure). May return a Promise — it is awaited before the next item starts. */
  onComplete?: (index: number, total: number, item: BlogBatchItem, result: BlogBatchItemResult) => void | Promise<void>;
}

/** Minimal shape BlogBatchRunner depends on — lets tests inject a fake in place of a real BlogAuditRunner. */
export type BlogRunnerLike = Pick<BlogAuditRunner, 'run'>;

/**
 * Runs a batch of blog documents through BlogAuditRunner with a bounded
 * number running concurrently (see `concurrency`) rather than one at a time
 * — each blog's crawl/compare is dominated by network waits (page
 * navigation, `networkidle`), so running several concurrently multiplies
 * batch throughput instead of paying for those waits serially.
 *
 * All items in the batch share ONE launched browser (each still gets its
 * own fresh BrowserContext, so cookies/storage/cache never leak between
 * blogs, and concurrent items never see each other's state) — launching a
 * full browser process is the single most expensive part of a run, and
 * repeating it per item is pure waste for a same-machine batch. The browser
 * is launched once up front and closed once the whole batch settles, even
 * if some items fail along the way.
 *
 * Results are returned in the SAME order as the input items regardless of
 * which finishes first, and onStart/onComplete still report each item's own
 * original index/total — callers that key progress off `index` (as the web
 * API's batch-store does) are unaffected by items completing out of order.
 *
 * Blog Testing always runs with Lighthouse, Accessibility, Broken Links,
 * and Redirects disabled — those checks don't apply to blog content
 * validation, so they are hard-disabled here rather than left as
 * caller-configurable options.
 *
 * A failure in one document (docx parsing, navigation, or any other error
 * surfaced by BlogAuditRunner) is caught and recorded against that item only
 * — it never aborts the remaining items in the batch.
 */
export class BlogBatchRunner {
  private readonly runner: BlogRunnerLike;
  private readonly browserManager: BrowserManagerLike;
  private readonly browserName: BlogAuditRunnerOptions['browserName'];
  private readonly concurrency: number;

  constructor(
    options: BlogAuditRunnerOptions = {},
    runner?: BlogRunnerLike,
    browserManager?: BrowserManagerLike,
    concurrency: number = testConfig.blogBatchConcurrency
  ) {
    this.runner = runner ?? new BlogAuditRunner({
      browserName: options.browserName,
      alwaysRunRedirectCheck: false,
      alwaysRunBrokenLinkCheck: false,
      alwaysRunAccessibilityCheck: false,
      lighthouseUrls: []
    });
    this.browserManager = browserManager ?? new BrowserManager();
    this.browserName = options.browserName;
    this.concurrency = Math.max(1, concurrency);
  }

  async run(
    items: readonly BlogBatchItem[],
    callbacks: BlogBatchRunnerCallbacks = {}
  ): Promise<BlogBatchItemResult[]> {
    const total = items.length;
    if (total === 0) return [];

    const results: BlogBatchItemResult[] = new Array(total);
    const browser: Browser = await this.browserManager.launch(this.browserName);

    try {
      let nextIndex = 0;
      const runWorker = async (): Promise<void> => {
        for (;;) {
          const index = nextIndex++;
          if (index >= total) return;
          const item = items[index]!;
          await callbacks.onStart?.(index, total, item);

          let itemResult: BlogBatchItemResult;
          try {
            const result = await this.runner.run(item.docxSource, item.url, browser, item.filename);
            itemResult = { filename: item.filename, url: item.url, status: 'done', result };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('[BlogBatchRunner] Blog failed, continuing with the rest of the batch.', {
              filename: item.filename,
              url: item.url,
              message
            });
            itemResult = { filename: item.filename, url: item.url, status: 'error', error: message };
          }

          results[index] = itemResult;
          await callbacks.onComplete?.(index, total, item, itemResult);
        }
      };

      const workerCount = Math.min(this.concurrency, total);
      await Promise.all(Array.from({ length: workerCount }, runWorker));
    } finally {
      await this.browserManager.close();
    }

    return results;
  }
}
