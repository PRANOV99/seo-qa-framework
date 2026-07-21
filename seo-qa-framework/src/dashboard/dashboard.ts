import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { AuditRunResult } from '../types/audit-run-result.js';
import type { ReportData } from '../types/report.js';
import { buildReportData } from '../reports/report-data-builder.js';
import { ensureDirectory } from '../utils/file-system.js';
import { toAbsolutePath } from '../utils/path-utils.js';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';

export interface DashboardGeneratorOptions {
  /** Directory the dashboard is written to. Defaults to testConfig.reportOutputDir. */
  outputDir?: string;
  /** File name for the dashboard. Defaults to 'dashboard.html'. */
  fileName?: string;
}

/**
 * Generates a single, always-overwritten dashboard.html summarizing the
 * latest audit run: PASS / FAIL / WARNING totals, redirect issues, broken
 * links, and SEO issues by category.
 */
export class DashboardGenerator {
  constructor(private readonly options: DashboardGeneratorOptions = {}) {}

  async generate(result: AuditRunResult): Promise<string> {
    const reportData = buildReportData(result);
    const outputDir = toAbsolutePath(this.options.outputDir ?? testConfig.reportOutputDir);
    await ensureDirectory(outputDir);

    const filePath = path.join(outputDir, this.options.fileName ?? 'dashboard.html');
    await writeFile(filePath, generateDashboardHtml(reportData), 'utf8');

    logger.info('Dashboard generated.', { filePath });

    return filePath;
  }
}

export function generateDashboardHtml(reportData: ReportData): string {
  const { summary } = reportData;

  const overall = {
    passed: summary.seoChecks.passed + summary.redirects.passed + summary.brokenLinks.passed + summary.accessibility.passed,
    failed: summary.seoChecks.failed + summary.redirects.failed + summary.brokenLinks.failed + summary.accessibility.failed,
    warning: summary.seoChecks.warning + summary.redirects.warning + summary.brokenLinks.warning + summary.accessibility.warning
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO QA Dashboard</title>
<style>
${styles()}
</style>
</head>
<body>
<header>
  <h1>SEO QA Dashboard</h1>
  <p class="meta">Source sheet: <code>${escapeHtml(summary.sourcePath)}</code> &middot; Generated: ${escapeHtml(summary.generatedAt)}</p>
</header>
<main>
  <section class="status-grid">
    ${statusCard('PASS', overall.passed, 'pass')}
    ${statusCard('FAIL', overall.failed, 'fail')}
    ${statusCard('WARNING', overall.warning, 'warn')}
  </section>

  <section class="panel">
    <h2>Redirect Issues</h2>
    ${metricRow('Passed', summary.redirects.passed, summary.redirects.total, 'pass')}
    ${metricRow('Failed', summary.redirects.failed, summary.redirects.total, 'fail')}
    ${metricRow('Warning', summary.redirects.warning, summary.redirects.total, 'warn')}
  </section>

  <section class="panel">
    <h2>Broken Links</h2>
    ${metricRow('Working', summary.brokenLinks.passed, summary.brokenLinks.total, 'pass')}
    ${metricRow('Broken', summary.brokenLinks.failed, summary.brokenLinks.total, 'fail')}
  </section>

  <section class="panel">
    <h2>SEO Issues by Category</h2>
    ${
      reportData.categories.length === 0
        ? '<p class="muted">No SEO checks were executed for this sheet.</p>'
        : reportData.categories.map((category) => categoryBar(category)).join('\n')
    }
  </section>

  <section class="panel">
    <h2>Accessibility &amp; Performance</h2>
    <p>Pages scanned for accessibility: <strong>${summary.accessibility.total}</strong> &middot; Violations found: <strong>${summary.accessibilityViolations}</strong></p>
    <p>Pages audited with Lighthouse: <strong>${summary.lighthouse.auditedPages}</strong> &middot; Average Performance score: <strong>${formatScore(summary.lighthouse.averageScores.performance)}</strong></p>
  </section>
</main>
</body>
</html>
`;
}

function statusCard(label: string, value: number, tone: 'pass' | 'fail' | 'warn'): string {
  return `<div class="status-card ${tone}"><div class="status-value">${value}</div><div class="status-label">${escapeHtml(label)}</div></div>`;
}

function metricRow(label: string, value: number, total: number, tone: 'pass' | 'fail' | 'warn'): string {
  const percentage = total === 0 ? 0 : Math.round((value / total) * 100);
  return `<div class="metric-row">
    <span class="metric-label">${escapeHtml(label)} (${value}/${total})</span>
    <div class="bar"><div class="bar-fill ${tone}" style="width:${percentage}%"></div></div>
  </div>`;
}

function categoryBar(category: ReportData['categories'][number]): string {
  const passPercentage = category.total === 0 ? 0 : Math.round((category.passed / category.total) * 100);
  return `<div class="metric-row">
    <span class="metric-label">${escapeHtml(category.category)} — ${category.passed}/${category.total} passed</span>
    <div class="bar"><div class="bar-fill pass" style="width:${passPercentage}%"></div></div>
  </div>`;
}

function formatScore(score: number | null): string {
  return typeof score === 'number' ? String(score) : 'n/a';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function styles(): string {
  return `
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f5f6f8; color: #1f2330; }
  header { background: #1f2330; color: #fff; padding: 24px 32px; }
  header h1 { margin: 0 0 8px; font-size: 22px; }
  header .meta { margin: 0; font-size: 13px; color: #c7cbe0; }
  main { padding: 24px 32px; }
  .status-grid { display: flex; gap: 16px; margin-bottom: 24px; }
  .status-card { flex: 1; text-align: center; padding: 20px; border-radius: 10px; color: #fff; }
  .status-card.pass { background: #1a7f4f; }
  .status-card.fail { background: #c4314b; }
  .status-card.warn { background: #c97f10; }
  .status-value { font-size: 36px; font-weight: 700; }
  .status-label { font-size: 13px; letter-spacing: 1px; text-transform: uppercase; }
  .panel { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .panel h2 { margin-top: 0; font-size: 17px; }
  .metric-row { margin: 10px 0; }
  .metric-label { font-size: 13px; color: #444a5e; }
  .bar { height: 8px; background: #eceef4; border-radius: 4px; margin-top: 4px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-fill.pass { background: #1a7f4f; }
  .bar-fill.fail { background: #c4314b; }
  .bar-fill.warn { background: #c97f10; }
  .muted { color: #6b7184; }
  code { background: #eef0f6; padding: 2px 6px; border-radius: 4px; }
  `;
}
