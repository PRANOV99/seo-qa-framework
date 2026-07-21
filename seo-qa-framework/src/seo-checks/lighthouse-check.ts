import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import type { LighthouseCheckResult, LighthouseScores } from '../types/lighthouse-result.js';
import { logger } from '../logger/logger.js';

const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

export class LighthouseChecker {
  async check(url: string): Promise<LighthouseCheckResult> {
    let chrome: chromeLauncher.LaunchedChrome | undefined;

    try {
      chrome = await chromeLauncher.launch({
        chromePath: chromium.executablePath(),
        chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu']
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
