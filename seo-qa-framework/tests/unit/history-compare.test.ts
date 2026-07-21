import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { buildFailingEntries, compareFailingEntries } from '../../src/history/history-compare.js';
import { buildSampleAuditRunResult } from './fixtures.js';

describe('buildFailingEntries', () => {
  it('only includes failing/violating entries, not passing ones', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());
    const entries = buildFailingEntries(reportData);

    // 1 failed SEO check + 1 failed redirect + 1 failed broken link + 2 accessibility violations = 5
    assert.equal(entries.length, 5);
    assert.ok(entries.every((entry) => entry.key.length > 0));
  });
});

describe('compareFailingEntries', () => {
  it('classifies issues as fixed, still failing, or new based on stable keys', () => {
    const previousReportData = buildReportData(buildSampleAuditRunResult());
    const previousEntries = buildFailingEntries(previousReportData);

    // Simulate a second run where the H1 issue was fixed and a new redirect issue appeared.
    const currentReportData = buildReportData(
      buildSampleAuditRunResult({
        seoCheckResults: [
          { url: 'https://example.com/', checkType: 'Missing title', status: 'passed', expected: 'Home', actual: 'Home' }
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
          },
          {
            originalUrl: 'https://example.com/new-broken-page',
            finalUrl: 'https://example.com/new-broken-page',
            statusCode: 500,
            redirectCount: 0,
            responseTime: 90,
            result: 'FAIL',
            recommendation: 'Page returns a server error.'
          }
        ]
      })
    );
    const currentEntries = buildFailingEntries(currentReportData);

    const comparison = compareFailingEntries(previousEntries, currentEntries);

    assert.ok(comparison.fixed.some((entry) => entry.description.includes('Missing H1')));
    assert.ok(comparison.stillFailing.some((entry) => entry.url === 'https://example.com/old-page'));
    assert.ok(comparison.newIssues.some((entry) => entry.url === 'https://example.com/new-broken-page'));

    // The H1 fix removes 1 previously-failing entry; broken link + accessibility
    // violations are unchanged (still failing) since they weren't overridden above.
    assert.equal(comparison.fixed.length, 1);
    assert.equal(comparison.stillFailing.length, 4);
    assert.equal(comparison.newIssues.length, 1);
  });

  it('treats an empty previous snapshot as everything being new', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());
    const currentEntries = buildFailingEntries(reportData);

    const comparison = compareFailingEntries(undefined, currentEntries);

    assert.equal(comparison.fixed.length, 0);
    assert.equal(comparison.newIssues.length, currentEntries.length);
    assert.equal(comparison.stillFailing.length, 0);
  });
});
