import path from 'node:path';
import type { ReportAudience, ReportData } from '../types/report.js';

export function generateMarkdownReport(reportData: ReportData, audience: ReportAudience): string {
  return audience === 'developer' ? generateDeveloperMarkdown(reportData) : generateQaMarkdown(reportData);
}

function generateDeveloperMarkdown(reportData: ReportData): string {
  const { summary } = reportData;
  const lines: string[] = [];

  lines.push(summary.kind === 'blog' ? '# Blog Content Validation Report (Developer)' : '# SEO QA Audit Report (Developer)', '');
  if (summary.kind === 'blog') {
    lines.push(`**Source Document:** \`${path.basename(summary.sourcePath)}\``);
    lines.push(`- Full path: \`${summary.sourcePath}\``);
  } else {
    lines.push(`- Source sheet: \`${summary.sourcePath}\``);
  }
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Duration: ${summary.durationMs}ms`);
  if (summary.kind !== 'blog') {
    lines.push(`- Rows in sheet: ${summary.totalRows}`, '');
  } else {
    lines.push('');
  }

  lines.push(summary.kind === 'blog' ? '## Blog Content Comparisons' : '## SEO Checks', '');
  if (reportData.seoCheckResults.length === 0) {
    lines.push('No SEO field comparisons were run for this sheet.', '');
  } else {
    lines.push('| URL | Field Checked | Expected Value | Actual Value | Status | Recommendation | Screenshot |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const result of reportData.seoCheckResults) {
      const statusLabel = result.status.toUpperCase();
      const recommendation = result.status === 'failed' ? result.message ?? '' : '';
      lines.push(
        row(
          result.url,
          result.checkType,
          result.expected ?? '',
          result.actual ?? '',
          statusLabel,
          recommendation,
          result.screenshotPath ?? ''
        )
      );
    }
    lines.push('');
  }

  lines.push('## Redirect Issues', '');
  const failingRedirects = reportData.redirectResults.filter((result) => result.result !== 'PASS');
  if (failingRedirects.length === 0) {
    lines.push('No redirect issues found.', '');
  } else {
    lines.push('| Original URL | Final URL | Status Code | Redirects | Recommendation |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const result of failingRedirects) {
      lines.push(
        row(result.originalUrl, result.finalUrl, result.statusCode, result.redirectCount, result.recommendation)
      );
    }
    lines.push('');
  }

  lines.push('## Broken Links', '');
  const brokenLinks = reportData.brokenLinkResults.filter((result) => result.status !== 'PASS');
  if (brokenLinks.length === 0) {
    lines.push('No broken links found.', '');
  } else {
    lines.push('| Page | Link | Type | Status Code | Message |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const result of brokenLinks) {
      lines.push(row(result.pageUrl, result.link, result.linkType, result.statusCode, result.message));
    }
    lines.push('');
  }

  lines.push('## Accessibility', '');
  if (reportData.accessibilityResults.length === 0) {
    lines.push('No accessibility scans were run for this sheet.', '');
  } else {
    for (const result of reportData.accessibilityResults) {
      lines.push(`### ${escapeMarkdownTableCell(result.url)} — ${result.status}`, '');
      if (result.violations.length === 0) {
        lines.push('No violations found.', '');
        continue;
      }
      lines.push('| Rule | Impact | Nodes | Help |');
      lines.push('| --- | --- | --- | --- |');
      for (const violation of result.violations) {
        lines.push(
          row(violation.id, violation.impact ?? 'n/a', violation.nodeCount, `[docs](${violation.helpUrl})`)
        );
      }
      lines.push('');
    }
  }

  lines.push('## Performance (Lighthouse)', '');
  if (reportData.lighthouseResults.length === 0) {
    lines.push('No Lighthouse audits were run for this sheet.', '');
  } else {
    lines.push('| URL | Performance | Accessibility | Best Practices | SEO | Error |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const result of reportData.lighthouseResults) {
      lines.push(
        row(
          result.url,
          formatScore(result.scores.performance),
          formatScore(result.scores.accessibility),
          formatScore(result.scores.bestPractices),
          formatScore(result.scores.seo),
          result.error ?? ''
        )
      );
    }
    lines.push('');
  }

  lines.push('## Skipped Rows', '');
  if (reportData.skipped.length === 0) {
    lines.push('No rows were skipped.', '');
  } else {
    lines.push('| URL | Check | Reason |');
    lines.push('| --- | --- | --- |');
    for (const skippedRow of reportData.skipped) {
      lines.push(row(skippedRow.auditRow.url, skippedRow.auditRow.checkType, skippedRow.reason));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateQaMarkdown(reportData: ReportData): string {
  const { summary } = reportData;
  const lines: string[] = [];

  lines.push(summary.kind === 'blog' ? '# Blog Content Validation Summary (QA)' : '# SEO QA Summary Report', '');
  lines.push(`- Source ${summary.kind === 'blog' ? 'document' : 'sheet'}: \`${summary.sourcePath}\``);
  lines.push(`- Generated: ${summary.generatedAt}`);
  if (summary.kind !== 'blog') {
    lines.push(`- Rows audited: ${summary.totalRows}`, '');
  } else {
    lines.push('');
  }

  if (summary.blogContent) {
    const blog = summary.blogContent;
    lines.push('## Blog Content Validation Summary', '');
    lines.push('| Total Checks | Passed | Failed | Missing Content | Modified Content | Metadata Issues |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    lines.push(row(blog.totalChecks, blog.passed, blog.failed, blog.missingContent, blog.modifiedContent, blog.metadataIssues));
    lines.push('');
  }

  lines.push('## Overall Health', '');
  lines.push('| Area | Passed | Failed | Warning | Total |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push(formatCountsRow('SEO Checks', summary.seoChecks));
  lines.push(formatCountsRow('Redirects', summary.redirects));
  lines.push(formatCountsRow('Broken Links', summary.brokenLinks));
  lines.push(formatCountsRow('Accessibility (pages)', summary.accessibility));
  lines.push('');

  lines.push(`Accessibility violations found: **${summary.accessibilityViolations}**`, '');
  lines.push(`Rows skipped (no implemented check): **${summary.skippedRows}**`, '');

  if (summary.kind !== 'blog') {
    lines.push('## SEO Issues by Category', '');
    if (reportData.categories.length === 0) {
      lines.push('No SEO checks were executed for this sheet.', '');
    } else {
      lines.push('| Category | Passed | Failed | Skipped | Total |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const category of reportData.categories) {
        lines.push(row(category.category, category.passed, category.failed, category.skipped, category.total));
      }
      lines.push('');
    }
  }

  lines.push('## Lighthouse Averages', '');
  if (summary.lighthouse.auditedPages === 0) {
    lines.push('No Lighthouse audits were run for this sheet.', '');
  } else {
    lines.push('| Performance | Accessibility | Best Practices | SEO | Pages Audited | Errors |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    lines.push(
      row(
        formatScore(summary.lighthouse.averageScores.performance),
        formatScore(summary.lighthouse.averageScores.accessibility),
        formatScore(summary.lighthouse.averageScores.bestPractices),
        formatScore(summary.lighthouse.averageScores.seo),
        summary.lighthouse.auditedPages,
        summary.lighthouse.errors
      )
    );
    lines.push('');
  }

  return lines.join('\n');
}

function formatCountsRow(label: string, counts: { passed: number; failed: number; warning: number; total: number }): string {
  return row(label, counts.passed, counts.failed, counts.warning, counts.total);
}

function formatScore(score: number | null): string {
  return typeof score === 'number' ? `${score}` : 'n/a';
}

/**
 * Builds a Markdown table row, escaping every cell so values containing
 * literal `|` characters (e.g. a meta title like "Home | Example") or
 * newlines (e.g. a multi-line error message) can't break the table's
 * column structure.
 */
function row(...cells: Array<string | number>): string {
  return `| ${cells.map((cell) => escapeMarkdownTableCell(String(cell))).join(' | ')} |`;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}
