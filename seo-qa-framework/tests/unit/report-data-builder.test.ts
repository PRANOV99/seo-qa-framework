import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { buildSampleAuditRunResult } from './fixtures.js';

describe('buildReportData', () => {
  it('computes pass/fail/warning counts for every result category', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());

    assert.deepEqual(reportData.summary.seoChecks, { passed: 1, failed: 1, warning: 0, total: 2 });
    assert.deepEqual(reportData.summary.redirects, { passed: 0, failed: 1, warning: 0, total: 1 });
    assert.deepEqual(reportData.summary.brokenLinks, { passed: 1, failed: 1, warning: 0, total: 2 });
    assert.deepEqual(reportData.summary.accessibility, { passed: 0, failed: 1, warning: 0, total: 1 });
    assert.equal(reportData.summary.accessibilityViolations, 2);
    assert.equal(reportData.summary.skippedRows, 1);
  });

  it('averages Lighthouse scores across audited pages, ignoring errored audits', () => {
    const reportData = buildReportData(
      buildSampleAuditRunResult({
        lighthouseResults: [
          { url: 'a', scores: { performance: 80, accessibility: 90, bestPractices: 100, seo: 100 }, fetchedAt: 't' },
          { url: 'b', scores: { performance: 60, accessibility: 70, bestPractices: 80, seo: 90 }, fetchedAt: 't' },
          {
            url: 'c',
            scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
            fetchedAt: 't',
            error: 'navigation failed'
          }
        ]
      })
    );

    assert.equal(reportData.summary.lighthouse.auditedPages, 3);
    assert.equal(reportData.summary.lighthouse.errors, 1);
    assert.equal(reportData.summary.lighthouse.averageScores.performance, 70);
    assert.equal(reportData.summary.lighthouse.averageScores.seo, 95);
  });

  it('categorizes SEO check results by detected issue type', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());

    const titleCategory = reportData.categories.find((category) => category.category === 'title');
    const h1Category = reportData.categories.find((category) => category.category === 'h1');

    assert.equal(titleCategory?.passed, 1);
    assert.equal(h1Category?.failed, 1);
  });

  it('computes a dedicated Bold Text breakdown (passed/missing/extra) for blog runs', () => {
    const reportData = buildReportData(
      buildSampleAuditRunResult({
        kind: 'blog',
        seoCheckResults: [
          { url: 'https://example.com/blog/x', checkType: 'Meta Title', status: 'passed', expected: 'A', actual: 'A' },
          { url: 'https://example.com/blog/x', checkType: 'Bold: "sourdough starter"', status: 'passed', expected: 'sourdough starter', actual: 'sourdough starter' },
          { url: 'https://example.com/blog/x', checkType: 'Bold: "Dutch oven"', status: 'passed', expected: 'Dutch oven', actual: 'Dutch oven' },
          { url: 'https://example.com/blog/x', checkType: 'Bold: "hand-milled flour"', status: 'failed', expected: 'hand-milled flour', actual: undefined, message: 'Bold phrase "hand-milled flour" is missing from the live page.' },
          { url: 'https://example.com/blog/x', checkType: 'Bold (extra): "limited time"', status: 'warning', expected: undefined, actual: 'limited time', message: 'Bold phrase "limited time" is present on the live page but not in the approved document.' }
        ]
      })
    );

    assert.deepEqual(reportData.summary.blogContent?.boldText, {
      total: 3,
      passed: 2,
      missing: 1,
      modified: 0,
      extra: 1
    });
  });

  it('does not confuse "Bold (extra)" entries with regular Bold checks when summarizing', () => {
    const reportData = buildReportData(
      buildSampleAuditRunResult({
        kind: 'blog',
        seoCheckResults: [
          { url: 'https://example.com/blog/x', checkType: 'Bold: "sourdough starter"', status: 'passed', expected: 'sourdough starter', actual: 'sourdough starter' },
          { url: 'https://example.com/blog/x', checkType: 'Bold (extra): "limited time"', status: 'warning', expected: undefined, actual: 'limited time' }
        ]
      })
    );

    assert.equal(reportData.summary.blogContent?.boldText.total, 1,
      'The "Bold (extra)" entry must not be counted toward the expected-bold total.');
    assert.equal(reportData.summary.blogContent?.boldText.extra, 1);
  });
});
