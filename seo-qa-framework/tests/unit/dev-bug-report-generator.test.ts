import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { generateDevBugReport } from '../../src/reports/dev-bug-report-generator.js';
import type { SeoCheckResult } from '../../src/types/check-result.js';
import { buildSampleAuditRunResult } from './fixtures.js';

const BLOG_URL = 'https://example.com/blog/sourdough';

function blogResults(overrides: Record<string, SeoCheckResult> = {}): SeoCheckResult[] {
  const base: Record<string, SeoCheckResult> = {
    metaTitle: {
      url: BLOG_URL, checkType: 'Meta Title', status: 'failed',
      expected: 'How to Bake Sourdough Bread', actual: 'How to Bake Rye Bread',
      message: 'Meta Title has changed. Expected "How to Bake Sourdough Bread" but found "How to Bake Rye Bread".'
    },
    h2: {
      url: BLOG_URL, checkType: 'H2 #1', status: 'failed',
      expected: 'Ingredients List', actual: undefined,
      message: 'H2 heading "Ingredients List" is missing from the live page.'
    },
    paragraph: {
      url: BLOG_URL, checkType: '"The sourdough starter needs regular feeding"', status: 'warning',
      expected: 'The sourdough starter needs regular feeding to stay healthy.',
      actual: 'The sourdough starter needs regular feeding to stay healthy.',
      message: 'Paragraph is unchanged but has moved (expected around position 1, found at position 3).'
    },
    hyperlink: {
      url: BLOG_URL, checkType: 'Hyperlink: "Dutch oven recommendations"', status: 'failed',
      expected: 'Dutch oven recommendations → https://example.com/tools/dutch-oven',
      actual: 'Dutch oven recommendations → https://example.com/tools/WRONG-URL',
      message: 'Hyperlink destination matches but anchor text differs.'
    },
    bold: {
      url: BLOG_URL, checkType: 'Bold: "Dutch oven"', status: 'failed',
      expected: 'Dutch oven', actual: undefined,
      message: 'Bold phrase "Dutch oven" is missing from the live page.'
    },
    passed: {
      url: BLOG_URL, checkType: 'Canonical URL', status: 'passed',
      expected: BLOG_URL, actual: BLOG_URL,
      message: 'Canonical URL matches the expected target.'
    }
  };
  return Object.values({ ...base, ...overrides });
}

function buildBlogReportData(results: SeoCheckResult[]) {
  return buildReportData(buildSampleAuditRunResult({ kind: 'blog', seoCheckResults: results }));
}

describe('generateDevBugReport', () => {
  it('reports "no issues found" when every check passes', () => {
    const reportData = buildBlogReportData([
      { url: BLOG_URL, checkType: 'Meta Title', status: 'passed', expected: 'X', actual: 'X' }
    ]);

    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /No issues found/);
    assert.doesNotMatch(report, /Must Fix/);
  });

  it('groups failed checks under a "Must Fix" section, ahead of a "Warnings" section', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    const mustFixIndex = report.indexOf('## Must Fix');
    const warningIndex = report.indexOf('## Warnings');
    const passedIndex  = report.indexOf('## Passed');

    assert.ok(mustFixIndex !== -1 && warningIndex !== -1 && passedIndex !== -1);
    assert.ok(mustFixIndex < warningIndex, 'Failed issues must come before warnings.');
    assert.ok(warningIndex < passedIndex, 'Warnings must come before the passed summary.');
  });

  it('renders each issue as just a check-name heading, an Expected line, and an Actual line', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /### Meta Title\nExpected: How to Bake Sourdough Bread\nActual: How to Bake Rye Bread/);
  });

  it('renders "(missing from the live page)" as Actual when there is no live value to compare against', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /### H2 #1\nExpected: Ingredients List\nActual: \(missing from the live page\)/);
  });

  it('includes the live URL once, in the overview, not repeated per issue', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, new RegExp(`Live URL: ${BLOG_URL}`));
  });

  it('contains no emoji', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    // Covers the emoji ranges previously used in this report (bug/warning/check/etc. glyphs).
    assert.doesNotMatch(report, /[\u{1F300}-\u{1FAFF}✅❌⚠️]/u);
  });

  it('does not itemize passed checks — only summarizes the count and check names', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /Canonical URL/);
    const passedSection = report.slice(report.indexOf('## Passed'));
    assert.doesNotMatch(passedSection, /### /);
  });

  it('explicitly scopes the report to the live website, not this tool\'s own codebase', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /belongs? to the website\/CMS|belongs? in the website\/CMS/i);
  });

  it('still produces a sensible report for a sheet (non-blog) audit', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());
    const report = generateDevBugReport(reportData, { url: 'https://example.com/about' });

    assert.match(report, /Missing H1/);
  });
});
