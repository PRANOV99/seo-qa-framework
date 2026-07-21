import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { SeoCheck } from './seo-check.js';
import { evaluateExpectedOrPresence } from './check-utils.js';

export class CanonicalCheck implements SeoCheck {
  readonly type = 'canonical';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const href = await page
      .$eval('link[rel="canonical"]', (element) => element.getAttribute('href'))
      .catch(() => null);
    const actual = href ? new URL(href, page.url()).toString() : undefined;

    return evaluateExpectedOrPresence({
      auditRow,
      actual,
      missingMessage: 'Canonical URL is missing.',
      mismatchMessage: 'Canonical URL does not match the expected value.',
      passMessage: 'Canonical URL is valid.'
    });
  }
}
