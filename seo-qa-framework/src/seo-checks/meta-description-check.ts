import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { SeoCheck } from './seo-check.js';
import { evaluateExpectedOrPresence } from './check-utils.js';

export class MetaDescriptionCheck implements SeoCheck {
  readonly type = 'metaDescription';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const actual = await page
      .$eval('meta[name="description"]', (element) => element.getAttribute('content'))
      .catch(() => null);

    return evaluateExpectedOrPresence({
      auditRow,
      actual: actual ?? undefined,
      missingMessage: 'Meta description is missing.',
      mismatchMessage: 'Meta description does not match the expected value.',
      passMessage: 'Meta description is valid.'
    });
  }
}
