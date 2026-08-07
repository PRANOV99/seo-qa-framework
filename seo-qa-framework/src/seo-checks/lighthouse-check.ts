import { chromium } from 'playwright';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import type { LighthouseCheckResult, LighthouseScores } from '../types/lighthouse-result.js';
import { logger } from '../logger/logger.js';
import { isProduction } from '../config/env.js';

const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export class LighthouseChecker {
  async check(url: string): Promise<LighthouseCheckResult> {
    let chrome: chromeLauncher.LaunchedChrome | undefined;

    try {
      chrome = await chromeLauncher.launch({
        chromePath: chromium.executablePath(),
        chromeFlags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          // Render's production container runs as root (Playwright's official
          // Docker image) and has a very small /dev/shm; both make this flag
          // necessary to avoid a mid-audit crash.
          ...(isProduction ? ['--disable-dev-shm-usage'] : [])
        ]
      });

      // chrome-launcher spawns Chrome as a raw child process and attaches no
      // 'error' listener of its own (confirmed in its source) — a transient
      // spawn failure (antivirus locking the freshly-written executable,
      // momentary resource exhaustion, etc.) fires an 'error' event on that
      // process asynchronously, AFTER launch() has already resolved. An
      // EventEmitter 'error' with zero listeners crashes the entire Node
      // process, not just this check — killing every other in-flight
      // request on the server, not only this one. This listener converts
      // that into an ordinary, per-call failure instead; the outer
      // try/catch below already turns any error into a graceful result.
      chrome.process?.on('error', (err) => {
        logger.warn('Chrome child process emitted an error event during a Lighthouse audit.', {
          url,
          error: err instanceof Error ? err.message : String(err)
        });
      });

      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'silent',
        onlyCategories: LIGHTHOUSE_CATEGORIES
      });

      if (!runnerResult) {
        throw new Error('Lighthouse did not return a result.');
      }

      return {
        url,
        scores: extractLighthouseScores(runnerResult.lhr.categories),
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Lighthouse audit failed.', { url, error: message });

      return {
        url,
        scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
        fetchedAt: new Date().toISOString(),
        error: message
      };
    } finally {
      chrome?.kill();
    }
  }
}

export function extractLighthouseScores(categories: Record<string, { score: number | null }>): LighthouseScores {
  const toPercentage = (score: number | null | undefined): number | null =>
    typeof score === 'number' ? Math.round(score * 100) : null;

  return {
    performance: toPercentage(categories.performance?.score),
    accessibility: toPercentage(categories.accessibility?.score),
    bestPractices: toPercentage(categories['best-practices']?.score),
    seo: toPercentage(categories.seo?.score)
  };
}
