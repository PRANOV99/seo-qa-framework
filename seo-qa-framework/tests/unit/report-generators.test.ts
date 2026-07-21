import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { generateJsonReport } from '../../src/reports/json-report-generator.js';
import { generateCsvReport } from '../../src/reports/csv-report-generator.js';
import { generateMarkdownReport } from '../../src/reports/markdown-report-generator.js';
import { generateHtmlReport } from '../../src/reports/html-report-generator.js';
import { generateDashboardHtml } from '../../src/dashboard/dashboard.js';
import { buildSampleAuditRunResult } from './fixtures.js';

const reportData = buildReportData(buildSampleAuditRunResult());

describe('generateJsonReport', () => {
  it('produces valid JSON that round-trips the report data', () => {
    const json = generateJsonReport(reportData);
    const parsed = JSON.parse(json) as typeof reportData;

    assert.equal(parsed.summary.totalRows, reportData.summary.totalRows);
    assert.equal(parsed.seoCheckResults.length, reportData.seoCheckResults.length);
  });
});

describe('generateCsvReport', () => {
  it('flattens every result category into one consolidated table with a header row', () => {
    const csv = generateCsvReport(reportData);
    const lines = csv.trim().split('\n');

    assert.equal(lines[0], 'url,fieldChecked,expectedValue,actualValue,status,recommendation');
    // 2 seoChecks + 1 redirect + 2 brokenLinks + 1 accessibility = 6 data rows + header
    assert.equal(lines.length, 7);
    assert.ok(csv.includes('Broken Link'));
  });

  it('only populates the recommendation column for failing/violating rows', () => {
    const csv = generateCsvReport(reportData);
    const lines = csv.trim().split('\n');

    const passedTitleRow = lines.find((line) => line.startsWith('https://example.com/,Missing title,'));
    const failedH1Row = lines.find((line) => line.includes('Missing H1'));

    assert.ok(passedTitleRow?.endsWith(',PASSED,'));
    assert.ok(failedH1Row?.includes('H1 tag is missing.'));
  });
});

describe('generateMarkdownReport', () => {
  it('generates a developer report listing failed checks in detail', () => {
    const markdown = generateMarkdownReport(reportData, 'developer');

    assert.match(markdown, /# SEO QA Audit Report \(Developer\)/);
    assert.match(markdown, /Missing H1/);
    assert.match(markdown, /screenshots\/h1-row-3\.png/);
  });

  it('generates a QA summary report with category breakdowns instead of row-level detail', () => {
    const markdown = generateMarkdownReport(reportData, 'qa');

    assert.match(markdown, /# SEO QA Summary Report/);
    assert.match(markdown, /SEO Issues by Category/);
    assert.doesNotMatch(markdown, /screenshots\/h1-row-3\.png/);
  });

  it('escapes literal "|" characters in cell values so they cannot break the table structure', () => {
    const dataWithPipes = buildReportData(
      buildSampleAuditRunResult({
        seoCheckResults: [
          {
            url: 'https://example.com/',
            checkType: 'Meta Title',
            status: 'passed',
            expected: 'Home | Example',
            actual: 'Home | Example'
          }
        ]
      })
    );

    const markdown = generateMarkdownReport(dataWithPipes, 'developer');
    const tableRow = markdown.split('\n').find((line) => line.includes('Home'));

    assert.ok(tableRow, 'expected to find the rendered table row');
    // The raw value's pipes must be escaped (\|), not left as bare table delimiters.
    assert.match(tableRow!, /Home \\\| Example/);

    // Every row should have exactly as many *unescaped* pipe delimiters as the
    // header row (7 columns -> 8 delimiters), proving the table isn't broken.
    const headerRow = '| URL | Field Checked | Expected Value | Actual Value | Status | Recommendation | Screenshot |';
    const countUnescapedPipes = (line: string) => (line.match(/(?<!\\)\|/g) ?? []).length;

    assert.equal(countUnescapedPipes(tableRow!), countUnescapedPipes(headerRow));
  });

  it('escapes newlines in cell values so multi-line messages stay on a single table row', () => {
    const dataWithNewline = buildReportData(
      buildSampleAuditRunResult({
        seoCheckResults: [
          {
            url: 'https://example.com/',
            checkType: 'Meta Description',
            status: 'failed',
            expected: 'A',
            actual: 'B',
            message: 'Line one\nLine two'
          }
        ]
      })
    );

    const markdown = generateMarkdownReport(dataWithNewline, 'developer');
    const lines = markdown.split('\n');
    const tableRow = lines.find((line) => line.includes('Line one'));

    assert.ok(tableRow, 'expected to find the rendered table row');
    assert.match(tableRow!, /Line one<br>Line two/);
    // The message must not have introduced an extra physical line.
    assert.equal(lines.filter((line) => line.includes('Line two')).length, 1);
  });
});

describe('generateHtmlReport', () => {
  it('renders a self-contained developer HTML report', () => {
    const html = generateHtmlReport(reportData, 'developer');

    assert.match(html, /<!doctype html>/i);
    assert.match(html, /SEO QA Audit Report \(Developer\)/);
    assert.match(html, /Missing H1/);
  });

  it('renders a self-contained QA HTML report', () => {
    const html = generateHtmlReport(reportData, 'qa');

    assert.match(html, /SEO QA Summary Report/);
    assert.match(html, /SEO Issues by Category/);
  });
});

describe('generateDashboardHtml', () => {
  it('renders PASS/FAIL/WARNING totals plus redirect, broken link, and SEO sections', () => {
    const html = generateDashboardHtml(reportData);

    assert.match(html, /SEO QA Dashboard/);
    assert.match(html, /Redirect Issues/);
    assert.match(html, /Broken Links/);
    assert.match(html, /SEO Issues by Category/);
  });
});
