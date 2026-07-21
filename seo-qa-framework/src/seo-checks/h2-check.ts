import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { SeoCheck } from './seo-check.js';
import { evaluateExpectedOrPresence, normalizeText } from './check-utils.js';

export class H2Check implements SeoCheck {
  readonly type = 'h2';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const headings = await page.locator('h2').allTextContents();
    const actual = headings.map(normalizeText).filter(Boolean).join(' | ');

    return evaluateExpectedOrPresence({
      auditRow,
      actual,
      missingMessage: 'H2 is missing.',
      mismatchMessage: 'H2 does not match the expected value.',
      passMessage: 'H2 is valid.'
    });
  }
}
