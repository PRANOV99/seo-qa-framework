import type { BlogComparisonSummary } from './blog.js';
import type { SeoCheckResult } from './check-result.js';
import type { RedirectResult } from './redirect-result.js';
import type { BrokenLinkResult } from './broken-link-result.js';
import type { AccessibilityCheckResult } from './accessibility-result.js';
import type { LighthouseCheckResult, LighthouseScores } from './lighthouse-result.js';
import type { SkippedAuditRow } from './audit-run-result.js';

export type ReportFormat = 'json' | 'csv' | 'markdown' | 'html';
export type ReportAudience = 'developer' | 'qa';

export interface ReportCounts {
  passed: number;
  failed: number;
  warning: number;
  total: number;
}

export interface LighthouseSummary {
  auditedPages: number;
  errors: number;
  averageScores: LighthouseScores;
}

export interface ReportSummary {
  sourcePath: string;
  kind: 'sheet' | 'blog';
  generatedAt: string;
  durationMs: number;
  totalRows: number;
  seoChecks: ReportCounts;
  redirects: ReportCounts;
  brokenLinks: ReportCounts;
  accessibility: ReportCounts;
  accessibilityViolations: number;
  lighthouse: LighthouseSummary;
  skippedRows: number;
  /** Only populated for blog-validation runs (AuditRunResult.kind === 'blog'). */
  blogContent?: BlogComparisonSummary;
}

export interface SeoCategoryBreakdown {
  category: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface ReportData {
  summary: ReportSummary;
  categories: SeoCategoryBreakdown[];
  seoCheckResults: SeoCheckResult[];
  redirectResults: RedirectResult[];
  brokenLinkResults: BrokenLinkResult[];
  accessibilityResults: AccessibilityCheckResult[];
  lighthouseResults: LighthouseCheckResult[];
  skipped: SkippedAuditRow[];
}

export interface GeneratedReportFile {
  format: ReportFormat;
  audience: ReportAudience | 'all';
  path: string;
}
