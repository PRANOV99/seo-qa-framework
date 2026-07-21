import type { AuditRunResult } from '../../src/types/audit-run-result.js';

export function buildSampleAuditRunResult(overrides: Partial<AuditRunResult> = {}): AuditRunResult {
  const base: AuditRunResult = {
    sourcePath: 'audit-sheets/sample.csv',
    totalRows: 6,
    seoCheckResults: [
      { url: 'https://example.com/', checkType: 'Missing title', status: 'passed', expected: 'Home', actual: 'Home' },
      {
        url: 'https://example.com/about',
        checkType: 'Missing H1',
        status: 'failed',
        expected: 'About Us',
        actual: '',
        message: 'H1 tag is missing.',
        screenshotPath: 'screenshots/h1-row-3.png'
      }
    ],
    redirectResults: [
      {
        originalUrl: 'https://example.com/old-page',
        finalUrl: 'https://example.com/old-page',
        statusCode: 404,
        redirectCount: 0,
        responseTime: 120,
        result: 'FAIL',
        recommendation: 'Page returns a 404 and should be redirected or restored.'
      }
    ],
    brokenLinkResults: [
      {
        pageUrl: 'https://example.com/',
        link: 'https://example.com/',
        linkType: 'Internal',
        statusCode: 200,
        status: 'PASS',
        message: 'Link is reachable.'
      },
      {
        pageUrl: 'https://example.com/',
        link: 'https://example.com/missing',
        linkType: 'Internal',
        statusCode: 404,
        status: 'FAIL',
        message: 'Broken Link - 404 Not Found'
      }
    ],
    accessibilityResults: [
      {
        url: 'https://example.com/',
        status: 'FAIL',
        violations: [
          {
            id: 'image-alt',
            impact: 'critical',
            description: 'Images must have alternate text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
            nodeCount: 2
          },
          {
            id: 'color-contrast',
            impact: 'serious',
            description: 'Elements must meet contrast ratio thresholds',
            helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
            nodeCount: 1
          }
        ],
        passCount: 20,
        incompleteCount: 0,
        fetchedAt: '2026-06-27T00:00:00.000Z'
      }
    ],
    lighthouseResults: [
      {
        url: 'https://example.com/',
        scores: { performance: 82, accessibility: 91, bestPractices: 95, seo: 100 },
        fetchedAt: '2026-06-27T00:00:00.000Z'
      }
    ],
    skipped: [
      {
        auditRow: {
          url: 'https://example.com/',
          checkType: 'robots.txt missing',
          issueType: 'robots',
          sourceRowNumber: 7,
          raw: {}
        },
        reason: 'No SEO check is implemented for issue type "robots".'
      }
    ],
    startedAt: '2026-06-27T00:00:00.000Z',
    finishedAt: '2026-06-27T00:00:05.000Z',
    durationMs: 5000
  };

  return { ...base, ...overrides };
}
