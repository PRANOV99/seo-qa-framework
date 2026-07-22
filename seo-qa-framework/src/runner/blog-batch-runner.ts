import { BlogAuditRunner, type BlogAuditRunnerOptions } from './blog-audit-runner.js';
import type { AuditRunResult } from '../types/audit-run-result.js';
import { logger } from '../logger/logger.js';

export interface BlogBatchItem {
  /** Absolute path to the uploaded .docx on disk. */
  docxPath: string;
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
 * Sequentially runs a batch of blog documents through BlogAuditRunner,
 * one after another (never in parallel), so results are produced in a
 * predictable order and progress can be reported as "N of total".
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

  constructor(options: BlogAuditRunnerOptions = {}, runner?: BlogRunnerLike) {
    this.runner = runner ?? new BlogAuditRunner({
      browserName: options.browserName,
      alwaysRunRedirectCheck: false,
      alwaysRunBrokenLinkCheck: false,
      alwaysRunAccessibilityCheck: false,
      lighthouseUrls: []
    });
  }

  async run(
    items: readonly BlogBatchItem[],
    callbacks: BlogBatchRunnerCallbacks = {}
  ): Promise<BlogBatchItemResult[]> {
    const total = items.length;
    const results: BlogBatchItemResult[] = [];

    for (let index = 0; index < total; index++) {
      const item = items[index]!;
      await callbacks.onStart?.(index, total, item);

      let itemResult: BlogBatchItemResult;
      try {
        const result = await this.runner.run(item.docxPath, item.url);
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

      results.push(itemResult);
      await callbacks.onComplete?.(index, total, item, itemResult);
    }

    return results;
  }
}
