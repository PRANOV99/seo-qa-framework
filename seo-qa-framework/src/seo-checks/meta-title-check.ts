import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { SeoCheck } from './seo-check.js';
import { evaluateExpectedOrPresence } from './check-utils.js';

export class MetaTitleCheck implements SeoCheck {
  readonly type = 'title';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const actual = await page.title();

    return evaluateExpectedOrPresence({
      auditRow,
      actual,
      missingMessage: 'Meta title is missing.',
      mismatchMessage: 'Meta title does not match the expected value.',
      passMessage: 'Meta title is valid.'
    });
  }
}
