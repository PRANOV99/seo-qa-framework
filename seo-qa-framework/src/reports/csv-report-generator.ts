import { stringify } from 'csv-stringify/sync';
import type { ReportData } from '../types/report.js';

interface CsvRow {
  url: string;
  fieldChecked: string;
  expectedValue: string;
  actualValue: string;
  status: string;
  recommendation: string;
}

const CSV_COLUMNS = ['url', 'fieldChecked', 'expectedValue', 'actualValue', 'status', 'recommendation'] as const;

export function generateCsvReport(reportData: ReportData): string {
  const rows: CsvRow[] = [
    ...reportData.seoCheckResults.map(toSeoCheckRow),
    ...reportData.redirectResults.map(toRedirectRow),
    ...reportData.brokenLinkResults.map(toBrokenLinkRow),
    ...reportData.accessibilityResults.map(toAccessibilityRow)
  ];

  return stringify(rows, {
    header: true,
    columns: [...CSV_COLUMNS]
  });
}

function toSeoCheckRow(result: ReportData['seoCheckResults'][number]): CsvRow {
  const status = result.status.toUpperCase();

  return {
    url: result.url,
    fieldChecked: result.checkType,
    expectedValue: result.expected ?? '',
    actualValue: result.actual ?? '',
    status,
    recommendation: (status === 'FAILED' || status === 'WARNING') ? result.message ?? '' : ''
  };
}

function toRedirectRow(result: ReportData['redirectResults'][number]): CsvRow {
  return {
    url: result.originalUrl,
    fieldChecked: 'Redirect',
    expectedValue: '2xx/3xx, no broken redirect chain',
    actualValue: `${result.statusCode} (final: ${result.finalUrl}, ${result.redirectCount} redirect(s))`,
    status: result.result,
    recommendation: result.result === 'PASS' ? '' : result.recommendation
  };
}

function toBrokenLinkRow(result: ReportData['brokenLinkResults'][number]): CsvRow {
  return {
    url: result.pageUrl,
    fieldChecked: `Link (${result.linkType}): ${result.link}`,
    expectedValue: '2xx-3xx',
    actualValue: String(result.statusCode),
    status: result.status,
    recommendation: result.status === 'PASS' ? '' : result.message
  };
}

function toAccessibilityRow(result: ReportData['accessibilityResults'][number]): CsvRow {
  return {
    url: result.url,
    fieldChecked: 'Accessibility Scan (axe-core)',
    expectedValue: '0 violations',
    actualValue: `${result.violations.length} violation(s)`,
    status: result.status,
    recommendation:
      result.status === 'PASS' ? '' : result.violations.map((violation) => violation.id).join('; ')
  };
}
