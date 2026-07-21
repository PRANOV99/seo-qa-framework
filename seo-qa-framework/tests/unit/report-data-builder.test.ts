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
});
