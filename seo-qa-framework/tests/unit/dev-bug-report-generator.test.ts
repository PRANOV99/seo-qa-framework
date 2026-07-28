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
      message: 'Meta Title has changed. Expected "How to Bake Sourdough Bread" but found "How to Bake Rye Bread".',
      diff: [
        { type: 'same', expected: 'How', actual: 'How' },
        { type: 'same', expected: 'to', actual: 'to' },
        { type: 'same', expected: 'Bake', actual: 'Bake' },
        { type: 'changed', expected: 'Sourdough', actual: 'Rye' },
        { type: 'same', expected: 'Bread', actual: 'Bread' }
      ]
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

  it('groups failed checks under a "Must Fix" section, ahead of a "Worth Reviewing" warnings section', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    const mustFixIndex = report.indexOf('## 🔴 Must Fix');
    const warningIndex = report.indexOf('## 🟡 Worth Reviewing');
    const passedIndex  = report.indexOf('## ✅ Already Correct');

    assert.ok(mustFixIndex !== -1 && warningIndex !== -1 && passedIndex !== -1);
    assert.ok(mustFixIndex < warningIndex, 'Failed issues must come before warnings.');
    assert.ok(warningIndex < passedIndex, 'Warnings must come before the passed summary.');
  });

  it('categorizes issues into Metadata, Headings, Hyperlinks, and Bold Text sections', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /### Metadata/);
    assert.match(report, /### Headings/);
    assert.match(report, /### Hyperlinks/);
    assert.match(report, /### Bold Text/);
  });

  it('includes the live URL, expected value, actual value, and message for a failing check', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /\*\*URL:\*\* https:\/\/example\.com\/blog\/sourdough/);
    assert.match(report, /How to Bake Sourdough Bread/);
    assert.match(report, /How to Bake Rye Bread/);
    assert.match(report, /Meta Title has changed/);
  });

  it('renders a git-style diff block with the word-level change for a genuine text mismatch', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /```diff/);
    assert.match(report, /- How to Bake Sourdough Bread/);
    assert.match(report, /\+ How to Bake Rye Bread/);
    assert.match(report, /"Sourdough" → "Rye"/);
  });

  it('omits the diff block entirely when there is no live value to compare against (content missing)', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    const h2Section = report.slice(report.indexOf('H2 #1'), report.indexOf('H2 #1') + 400);
    assert.doesNotMatch(h2Section, /```diff/);
    assert.match(h2Section, /is missing from the live page/);
  });

  it('omits the diff block when expected and actual are identical (e.g. a "moved" paragraph)', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    const paragraphHeading = 'The sourdough starter needs regular feeding';
    const start = report.indexOf(paragraphHeading);
    const section = report.slice(start, start + 500);

    assert.doesNotMatch(section, /```diff/, 'A diff of identical expected/actual text is pure noise.');
    assert.match(section, /has moved/);
  });

  it('does not itemize passed checks — only summarizes the count and check names', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /Canonical URL/);
    // Passed checks should not get their own "#### N." issue block.
    const passedSection = report.slice(report.indexOf('## ✅ Already Correct'));
    assert.doesNotMatch(passedSection, /#### \d/);
  });

  it('appends a machine-readable JSON block containing every failed and warning issue, none of the passed ones', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    const jsonMatch = report.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(jsonMatch, 'Expected a fenced JSON block.');

    const issues = JSON.parse(jsonMatch![1]!) as Array<Record<string, unknown>>;
    assert.equal(issues.length, 5, 'Expected exactly the 4 failed + 1 warning issues, not the passed one.');
    assert.ok(issues.every((issue) => issue['severity'] === 'failed' || issue['severity'] === 'warning'));
    assert.ok(issues.some((issue) => issue['checkType'] === 'Meta Title' && issue['category'] === 'Metadata'));
  });

  it('explicitly scopes the report to the live website, not this tool\'s own codebase', () => {
    const reportData = buildBlogReportData(blogResults());
    const report = generateDevBugReport(reportData, { url: BLOG_URL });

    assert.match(report, /belongs? in the website\/CMS/i);
  });

  it('still produces a sensible report for a sheet (non-blog) audit', () => {
    const reportData = buildReportData(buildSampleAuditRunResult());
    const report = generateDevBugReport(reportData, { url: 'https://example.com/about' });

    assert.match(report, /Missing H1/);
    assert.match(report, /H1 tag is missing/);
  });
});
