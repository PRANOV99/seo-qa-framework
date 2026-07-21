import type { AuditRunResult } from '../types/audit-run-result.js';
import type { SeoCheckResult } from '../types/check-result.js';
import type { AccessibilityCheckResult } from '../types/accessibility-result.js';
import type { LighthouseCheckResult, LighthouseScores } from '../types/lighthouse-result.js';
import type { LighthouseSummary, ReportCounts, ReportData, SeoCategoryBreakdown } from '../types/report.js';
import type { BlogComparisonSummary } from '../types/blog.js';
import { detectIssueType } from '../parsers/audit-row-normalizer.js';

export function buildReportData(result: AuditRunResult): ReportData {
  const kind = result.kind ?? 'sheet';

  return {
    summary: {
      sourcePath: result.sourcePath,
      kind,
      generatedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      totalRows: result.totalRows,
      seoChecks: countSeoChecks(result.seoCheckResults),
      redirects: countByStatus(result.redirectResults.map((redirect) => redirect.result)),
      brokenLinks: countByStatus(result.brokenLinkResults.map((link) => link.status)),
      accessibility: countAccessibilityPages(result.accessibilityResults),
      accessibilityViolations: countAccessibilityViolations(result.accessibilityResults),
      lighthouse: summarizeLighthouse(result.lighthouseResults),
      skippedRows: result.skipped.length,
      blogContent: kind === 'blog' ? summarizeBlogContent(result.seoCheckResults) : undefined
    },
    categories: categorizeSeoChecks(result.seoCheckResults),
    seoCheckResults: result.seoCheckResults,
    redirectResults: result.redirectResults,
    brokenLinkResults: result.brokenLinkResults,
    accessibilityResults: result.accessibilityResults,
    lighthouseResults: result.lighthouseResults,
    skipped: result.skipped
  };
}

const METADATA_CHECK_TYPES = new Set(['Meta Title', 'Meta Description']);

/**
 * Summarizes a blog-validation run's checks into the QA report's requested
 * breakdown: Total Checks, Passed, Failed, Missing Content, Modified
 * Content, and Metadata Issues. "Missing" vs "Modified" is distinguished by
 * whether a live value was found at all (actual is empty) or differed from
 * the approved document.
 */
function summarizeBlogContent(results: readonly SeoCheckResult[]): BlogComparisonSummary {
  const evaluated = results.filter((result) => result.status !== 'skipped');
  const failed = evaluated.filter((result) => result.status === 'failed');

  const missingContent = failed.filter((result) => !result.actual || result.actual.trim() === '').length;
  const modifiedContent = failed.length - missingContent;
  const metadataIssues = failed.filter((result) => METADATA_CHECK_TYPES.has(result.checkType)).length;

  return {
    totalChecks: evaluated.length,
    passed: evaluated.filter((result) => result.status === 'passed').length,
    failed: failed.length,
    missingContent,
    modifiedContent,
    metadataIssues
  };
}

function countSeoChecks(results: readonly SeoCheckResult[]): ReportCounts {
  return {
    passed:  results.filter((r) => r.status === 'passed').length,
    failed:  results.filter((r) => r.status === 'failed').length,
    warning: results.filter((r) => r.status === 'warning').length,
    total:   results.length
  };
}

function countByStatus(statuses: ReadonlyArray<'PASS' | 'FAIL' | 'WARNING'>): ReportCounts {
  return {
    passed: statuses.filter((status) => status === 'PASS').length,
    failed: statuses.filter((status) => status === 'FAIL').length,
    warning: statuses.filter((status) => status === 'WARNING').length,
    total: statuses.length
  };
}

function countAccessibilityPages(results: readonly AccessibilityCheckResult[]): ReportCounts {
  return {
    passed: results.filter((result) => result.status === 'PASS').length,
    failed: results.filter((result) => result.status === 'FAIL').length,
    warning: 0,
    total: results.length
  };
}

function countAccessibilityViolations(results: readonly AccessibilityCheckResult[]): number {
  return results.reduce((total, result) => total + result.violations.length, 0);
}

function summarizeLighthouse(results: readonly LighthouseCheckResult[]): LighthouseSummary {
  const successful = results.filter((result) => !result.error);
  const errors = results.length - successful.length;

  return {
    auditedPages: results.length,
    errors,
    averageScores: averageScores(successful.map((result) => result.scores))
  };
}

function averageScores(scoresList: readonly LighthouseScores[]): LighthouseScores {
  return {
    performance: averageMetric(scoresList.map((scores) => scores.performance)),
    accessibility: averageMetric(scoresList.map((scores) => scores.accessibility)),
    bestPractices: averageMetric(scoresList.map((scores) => scores.bestPractices)),
    seo: averageMetric(scoresList.map((scores) => scores.seo))
  };
}

function averageMetric(values: ReadonlyArray<number | null>): number | null {
  const numericValues = values.filter((value): value is number => typeof value === 'number');

  if (numericValues.length === 0) {
    return null;
  }

  const total = numericValues.reduce((sum, value) => sum + value, 0);
  return Math.round(total / numericValues.length);
}

function categorizeSeoChecks(results: readonly SeoCheckResult[]): SeoCategoryBreakdown[] {
  const breakdownByCategory = new Map<string, SeoCategoryBreakdown>();

  for (const result of results) {
    const category = detectIssueType(result.checkType);
    const breakdown =
      breakdownByCategory.get(category) ??
      ({ category, passed: 0, failed: 0, skipped: 0, total: 0 } satisfies SeoCategoryBreakdown);

    breakdown.total += 1;

    if (result.status === 'passed') {
      breakdown.passed += 1;
    } else if (result.status === 'failed') {
      breakdown.failed += 1;
    } else {
      breakdown.skipped += 1;
    }

    breakdownByCategory.set(category, breakdown);
  }

  return Array.from(breakdownByCategory.values()).sort((left, right) => right.total - left.total);
}
