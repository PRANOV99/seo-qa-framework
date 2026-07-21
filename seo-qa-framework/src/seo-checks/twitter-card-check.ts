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

const requiredTwitterCardProperties = [
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image'
];

export class TwitterCardCheck implements SeoCheck {
  readonly type = 'twitterCard';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const tags = await page.$$eval('meta[name^="twitter:"]', (elements) =>
      elements.map((element) => ({
        name: element.getAttribute('name') ?? '',
        content: element.getAttribute('content') ?? ''
      }))
    );
    const tagMap = new Map(tags.map((tag) => [normalizeText(tag.name), normalizeText(tag.content)]));
    const actual = requiredTwitterCardProperties
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
          ? 'Expected Twitter Card value is present.'
          : 'Expected Twitter Card value was not found.'
      });
    }

    const missingProperties = requiredTwitterCardProperties.filter((property) => !tagMap.get(property));

    return createCheckResult({
      auditRow,
      status: missingProperties.length === 0 ? 'passed' : 'failed',
      actual,
      message:
        missingProperties.length === 0
          ? 'Required Twitter Card tags are present.'
          : `Missing Twitter Card tags: ${missingProperties.join(', ')}.`
    });
  }
}
