import type { SeoAuditRow } from '../src/types/audit.js';
import {
  AltTextCheck,
  CanonicalCheck,
  H1Check,
  H2Check,
  MetaDescriptionCheck,
  MetaTitleCheck,
  OpenGraphCheck,
  TwitterCardCheck,
  seoChecks
} from '../src/seo-checks/index.js';
import { test, expect } from '../src/fixtures/test-fixtures.js';

test.describe('reusable SEO checks', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox page creation fails in this local runner.');

  test.beforeEach(async ({ page }) => {
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <title>Expected SEO Title</title>
          <meta name="description" content="Expected meta description">
          <link rel="canonical" href="https://example.com/page">
          <meta property="og:title" content="Expected SEO Title">
          <meta property="og:description" content="Expected meta description">
          <meta property="og:url" content="https://example.com/page">
          <meta property="og:image" content="https://example.com/og.png">
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:title" content="Expected SEO Title">
          <meta name="twitter:description" content="Expected meta description">
          <meta name="twitter:image" content="https://example.com/twitter.png">
        </head>
        <body>
          <h1>Expected H1</h1>
          <h2>Expected H2</h2>
          <img src="/hero.png" alt="Hero image alt">
        </body>
      </html>
    `);
  });

  test('registers all Phase 4 check modules', () => {
    expect(seoChecks.map((check) => check.type)).toEqual([
      'title',
      'metaDescription',
      'canonical',
      'h1',
      'h2',
      'imageAlt',
      'openGraph',
      'twitterCard'
    ]);
  });

  test('validates metadata and heading checks against expected values', async ({ page }) => {
    const results = await Promise.all([
      new MetaTitleCheck().run(page, auditRow('title', 'Expected SEO Title')),
      new MetaDescriptionCheck().run(page, auditRow('metaDescription', 'Expected meta description')),
      new CanonicalCheck().run(page, auditRow('canonical', 'https://example.com/page')),
      new H1Check().run(page, auditRow('h1', 'Expected H1')),
      new H2Check().run(page, auditRow('h2', 'Expected H2'))
    ]);

    expect(results.every((result) => result.status === 'passed')).toBe(true);
  });

  test('validates ALT text, Open Graph, and Twitter Card checks', async ({ page }) => {
    const altTextResult = await new AltTextCheck().run(page, auditRow('imageAlt'));
    const openGraphResult = await new OpenGraphCheck().run(page, auditRow('openGraph'));
    const twitterCardResult = await new TwitterCardCheck().run(page, auditRow('twitterCard'));

    expect(altTextResult.status).toBe('passed');
    expect(openGraphResult.status).toBe('passed');
    expect(twitterCardResult.status).toBe('passed');
  });

  test('returns failed results when expected metadata does not match', async ({ page }) => {
    const result = await new MetaTitleCheck().run(page, auditRow('title', 'Different title'));

    expect(result.status).toBe('failed');
    expect(result.actual).toBe('Expected SEO Title');
  });
});

function auditRow(issueType: SeoAuditRow['issueType'], expectedValue?: string): SeoAuditRow {
  return {
    url: 'https://example.com/page',
    checkType: issueType,
    issueType,
    expectedValue,
    sourceRowNumber: 2,
    raw: {}
  };
}
