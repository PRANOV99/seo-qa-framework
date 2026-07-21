import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { SeoCheck } from './seo-check.js';
import {
  createCheckResult,
  expectedMatchesActual,
  hasExpectedValue,
  normalizeText
} from './check-utils.js';

const requiredOpenGraphProperties = ['og:title', 'og:description', 'og:url', 'og:image'];

export class OpenGraphCheck implements SeoCheck {
  readonly type = 'openGraph';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const tags = await page.$$eval('meta[property^="og:"]', (elements) =>
      elements.map((element) => ({
        property: element.getAttribute('property') ?? '',
        content: element.getAttribute('content') ?? ''
      }))
    );
    const tagMap = new Map(tags.map((tag) => [normalizeText(tag.property), normalizeText(tag.content)]));
    const actual = requiredOpenGraphProperties
      .map((property) => `${property}=${tagMap.get(property) ?? ''}`)
      .join(' | ');

    if (hasExpectedValue(auditRow)) {
      const hasExpectedValueInTags = [...tagMap.values()].some((content) =>
        expectedMatchesActual(auditRow.expectedValue, content)
      );

      return createCheckResult({
        auditRow,
        status: hasExpectedValueInTags ? 'passed' : 'failed',
        actual,
        message: hasExpectedValueInTags
          ? 'Expected Open Graph value is present.'
          : 'Expected Open Graph value was not found.'
      });
    }

    const missingProperties = requiredOpenGraphProperties.filter((property) => !tagMap.get(property));

    return createCheckResult({
      auditRow,
      status: missingProperties.length === 0 ? 'passed' : 'failed',
      actual,
      message:
        missingProperties.length === 0
          ? 'Required Open Graph tags are present.'
          : `Missing Open Graph tags: ${missingProperties.join(', ')}.`
    });
  }
}
