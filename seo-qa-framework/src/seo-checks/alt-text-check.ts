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

interface ImageAltSnapshot {
  src: string;
  alt: string;
}

export class AltTextCheck implements SeoCheck {
  readonly type = 'imageAlt';

  async run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult> {
    const images = await page.$$eval('img', (elements) =>
      elements.map((image) => ({
        src: image.getAttribute('src') ?? '',
        alt: image.getAttribute('alt') ?? ''
      }))
    );

    if (images.length === 0) {
      return createCheckResult({
        auditRow,
        status: 'skipped',
        actual: '',
        message: 'No images found on the page.'
      });
    }

    const imageSnapshots = images.map((image): ImageAltSnapshot => ({
      src: normalizeText(image.src),
      alt: normalizeText(image.alt)
    }));
    const actual = imageSnapshots
      .map((image) => image.alt)
      .filter(Boolean)
      .join(' | ');

    if (hasExpectedValue(auditRow)) {
      const hasExpectedAlt = imageSnapshots.some((image) =>
        expectedMatchesActual(auditRow.expectedValue, image.alt)
      );

      return createCheckResult({
        auditRow,
        status: hasExpectedAlt ? 'passed' : 'failed',
        actual,
        message: hasExpectedAlt
          ? 'Expected ALT text is present.'
          : 'Expected ALT text was not found on any image.'
      });
    }

    const missingAltImages = imageSnapshots.filter((image) => image.alt === '');

    return createCheckResult({
      auditRow,
      status: missingAltImages.length === 0 ? 'passed' : 'failed',
      actual,
      message:
        missingAltImages.length === 0
          ? 'All images have ALT text.'
          : `${missingAltImages.length} image(s) are missing ALT text.`
    });
  }
}
