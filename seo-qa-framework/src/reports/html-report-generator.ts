import path from 'node:path';
import type { ReportAudience, ReportData } from '../types/report.js';

export function generateHtmlReport(reportData: ReportData, audience: ReportAudience): string {
  const isBlog = reportData.summary.kind === 'blog';
  const title = isBlog
    ? `Blog Content Validation ${audience === 'developer' ? 'Report (Developer)' : 'Summary (QA)'}`
    : audience === 'developer'
      ? 'SEO QA Audit Report (Developer)'
      : 'SEO QA Summary Report (QA)';
  const body = audience === 'developer' ? developerBody(reportData) : qaBody(reportData);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${styles()}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">
    Source ${isBlog ? 'document' : 'sheet'}: <code>${escapeHtml(isBlog ? path.basename(reportData.summary.sourcePath) : reportData.summary.sourcePath)}</code><br>
    Generated: ${escapeHtml(reportData.summary.generatedAt)} &middot; Duration: ${reportData.summary.durationMs}ms${isBlog ? '' : ` &middot; Rows audited: ${reportData.summary.totalRows}`}
  </p>
  ${isBlog ? `<p class="meta" style="margin-top:6px;"><strong>Source Document:</strong> <code>${escapeHtml(path.basename(reportData.summary.sourcePath))}</code></p>` : ''}
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

function developerBody(reportData: ReportData): string {
  const sections: string[] = [];

  sections.push(summaryCards(reportData));

  sections.push(
    section(
      reportData.summary.kind === 'blog' ? 'Blog Content Comparisons' : 'SEO Checks',
      reportData.seoCheckResults.length === 0
        ? '<p class="muted">No SEO field comparisons were run for this sheet.</p>'
        : table(
            ['URL', 'Field Checked', 'Expected Value', 'Actual Value', 'Status', 'Recommendation', 'Screenshot'],
            reportData.seoCheckResults.map((result) => [
              link(result.url),
              escapeHtml(result.checkType),
              escapeHtml(result.expected ?? ''),
              escapeHtml(result.actual ?? ''),
              badge(result.status.toUpperCase(), result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'WARNING'),
              escapeHtml(result.status === 'failed' ? result.message ?? '' : ''),
              result.screenshotPath ? escapeHtml(result.screenshotPath) : ''
            ])
          )
    )
  );

  const failingRedirects = reportData.redirectResults.filter((result) => result.result !== 'PASS');
  sections.push(
    section(
      'Redirect Issues',
      reportData.redirectResults.length === 0
        ? '<p class="muted">No redirect checks were run for this sheet.</p>'
        : failingRedirects.length === 0
          ? '<p class="ok">No redirect issues found.</p>'
          : table(
              ['Original URL', 'Final URL', 'Status Code', 'Redirects', 'Recommendation'],
              failingRedirects.map((result) => [
                link(result.originalUrl),
                link(result.finalUrl),
                badge(String(result.statusCode), result.result),
                String(result.redirectCount),
                escapeHtml(result.recommendation)
              ])
            )
    )
  );

  const brokenLinks = reportData.brokenLinkResults.filter((result) => result.status !== 'PASS');
  sections.push(
    section(
      'Broken Links',
      reportData.brokenLinkResults.length === 0
        ? '<p class="muted">No broken link scans were run for this sheet.</p>'
        : brokenLinks.length === 0
          ? '<p class="ok">No broken links found.</p>'
          : table(
              ['Page', 'Link', 'Type', 'Status Code', 'Message'],
              brokenLinks.map((result) => [
                link(result.pageUrl),
                link(result.link),
                escapeHtml(result.linkType),
                badge(String(result.statusCode), result.status),
                escapeHtml(result.message)
              ])
            )
    )
  );

  sections.push(
    section(
      'Accessibility',
      reportData.accessibilityResults.length === 0
        ? '<p class="muted">No accessibility scans were run for this sheet.</p>'
        : reportData.accessibilityResults
            .map((result) => {
              const heading = `<h3>${link(result.url)} ${badge(result.status, result.status)}</h3>`;
              const violationsTable =
                result.violations.length === 0
                  ? '<p class="ok">No violations found.</p>'
                  : table(
                      ['Rule', 'Impact', 'Nodes', 'Help'],
                      result.violations.map((violation) => [
                        escapeHtml(violation.id),
                        escapeHtml(violation.impact ?? 'n/a'),
                        String(violation.nodeCount),
                        `<a href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noopener">docs</a>`
                      ])
                    );
              return heading + violationsTable;
            })
            .join('\n')
    )
  );

  sections.push(
    section(
      'Performance (Lighthouse)',
      reportData.lighthouseResults.length === 0
        ? '<p class="muted">No Lighthouse audits were run for this sheet.</p>'
        : table(
            ['URL', 'Performance', 'Accessibility', 'Best Practices', 'SEO', 'Error'],
            reportData.lighthouseResults.map((result) => [
              link(result.url),
              formatScore(result.scores.performance),
              formatScore(result.scores.accessibility),
              formatScore(result.scores.bestPractices),
              formatScore(result.scores.seo),
              escapeHtml(result.error ?? '')
            ])
          )
    )
  );

  sections.push(
    section(
      'Skipped Rows',
      reportData.skipped.length === 0
        ? '<p class="ok">No rows were skipped.</p>'
        : table(
            ['URL', 'Check', 'Reason'],
            reportData.skipped.map((skippedRow) => [
              link(skippedRow.auditRow.url),
              escapeHtml(skippedRow.auditRow.checkType),
              escapeHtml(skippedRow.reason)
            ])
          )
    )
  );

  return sections.join('\n');
}

function qaBody(reportData: ReportData): string {
  const { summary } = reportData;
  const sections: string[] = [];

  sections.push(summaryCards(reportData));

  sections.push(
    section(
      'Overall Health',
      table(
        ['Area', 'Passed', 'Failed', 'Warning', 'Total'],
        [
          ['SEO Checks', summary.seoChecks],
          ['Redirects', summary.redirects],
          ['Broken Links', summary.brokenLinks],
          ['Accessibility (pages)', summary.accessibility]
        ].map(([label, counts]) => [
          escapeHtml(label as string),
          String((counts as { passed: number }).passed),
          String((counts as { failed: number }).failed),
          String((counts as { warning: number }).warning),
          String((counts as { total: number }).total)
        ])
      ) + `<p class="muted">Accessibility violations found: <strong>${summary.accessibilityViolations}</strong> &middot; Rows skipped: <strong>${summary.skippedRows}</strong></p>`
    )
  );

  if (summary.blogContent) {
    const blog = summary.blogContent;
    sections.push(
      section(
        'Blog Content Validation Summary',
        table(
          ['Total Checks', 'Passed', 'Failed', 'Missing Content', 'Modified Content', 'Metadata Issues'],
          [
            [
              String(blog.totalChecks),
              String(blog.passed),
              String(blog.failed),
              String(blog.missingContent),
              String(blog.modifiedContent),
              String(blog.metadataIssues)
            ]
          ]
        )
      )
    );
  }

  if (summary.kind !== 'blog') {
    sections.push(
      section(
        'SEO Issues by Category',
        reportData.categories.length === 0
          ? '<p class="muted">No SEO checks were executed for this sheet.</p>'
          : table(
              ['Category', 'Passed', 'Failed', 'Skipped', 'Total'],
              reportData.categories.map((category) => [
                escapeHtml(category.category),
                String(category.passed),
                String(category.failed),
                String(category.skipped),
                String(category.total)
              ])
            )
      )
    );
  }

  sections.push(
    section(
      'Lighthouse Averages',
      summary.lighthouse.auditedPages === 0
        ? '<p class="muted">No Lighthouse audits were run for this sheet.</p>'
        : table(
            ['Performance', 'Accessibility', 'Best Practices', 'SEO', 'Pages Audited', 'Errors'],
            [
              [
                formatScore(summary.lighthouse.averageScores.performance),
                formatScore(summary.lighthouse.averageScores.accessibility),
                formatScore(summary.lighthouse.averageScores.bestPractices),
                formatScore(summary.lighthouse.averageScores.seo),
                String(summary.lighthouse.auditedPages),
                String(summary.lighthouse.errors)
              ]
            ]
          )
    )
  );

  return sections.join('\n');
}

function summaryCards(reportData: ReportData): string {
  const { summary } = reportData;
  const cards = [
    { label: 'SEO Checks Passed', value: summary.seoChecks.passed, tone: 'pass' },
    { label: 'SEO Checks Failed', value: summary.seoChecks.failed, tone: summary.seoChecks.failed > 0 ? 'fail' : 'pass' },
    {
      label: 'Broken Links',
      value: summary.brokenLinks.failed,
      tone: summary.brokenLinks.failed > 0 ? 'fail' : 'pass'
    },
    {
      label: 'Redirect Issues',
      value: summary.redirects.failed + summary.redirects.warning,
      tone: summary.redirects.failed + summary.redirects.warning > 0 ? 'warn' : 'pass'
    },
    {
      label: 'Accessibility Violations',
      value: summary.accessibilityViolations,
      tone: summary.accessibilityViolations > 0 ? 'warn' : 'pass'
    }
  ];

  return `<div class="cards">${cards
    .map(
      (card) =>
        `<div class="card ${card.tone}"><div class="card-value">${card.value}</div><div class="card-label">${escapeHtml(card.label)}</div></div>`
    )
    .join('\n')}</div>`;
}

function section(heading: string, content: string): string {
  return `<section><h2>${escapeHtml(heading)}</h2>${content}</section>`;
}

function table(headers: string[], rows: string[][]): string {
  const headRow = `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>`;
  const bodyRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead>${headRow}</thead><tbody>${bodyRows}</tbody></table>`;
}

function link(url: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
}

function badge(text: string, status: string): string {
  const tone = status === 'PASS' ? 'pass' : status === 'WARNING' ? 'warn' : 'fail';
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
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
  section { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  section h2 { margin-top: 0; font-size: 18px; }
  section h3 { font-size: 15px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e7e9f0; vertical-align: top; }
  th { background: #f0f1f6; }
  a { color: #2952e3; text-decoration: none; word-break: break-all; }
  a:hover { text-decoration: underline; }
  code { background: #eef0f6; padding: 2px 6px; border-radius: 4px; }
  .muted { color: #6b7184; }
  .ok { color: #1a7f4f; font-weight: 600; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .card { flex: 1 1 160px; background: #fff; border-radius: 8px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #d0d4e0; }
  .card.pass { border-left-color: #1a7f4f; }
  .card.fail { border-left-color: #c4314b; }
  .card.warn { border-left-color: #c97f10; }
  .card-value { font-size: 26px; font-weight: 700; }
  .card-label { font-size: 12px; color: #6b7184; margin-top: 4px; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge.pass { background: #e3f6ec; color: #1a7f4f; }
  .badge.fail { background: #fbe7ea; color: #c4314b; }
  .badge.warn { background: #fdf1e0; color: #c97f10; }
  `;
}
