import type { SeoAuditRow } from './audit.js';
import type { SeoCheckResult } from './check-result.js';
import type { RedirectResult } from './redirect-result.js';
import type { BrokenLinkResult } from './broken-link-result.js';
import type { AccessibilityCheckResult } from './accessibility-result.js';
import type { LighthouseCheckResult } from './lighthouse-result.js';

export interface SkippedAuditRow {
  auditRow: SeoAuditRow;
  reason: string;
}

export interface AuditRunResult {
  sourcePath: string;
  /** Distinguishes a sheet-driven audit run from a docx-vs-live blog validation run. Defaults to 'sheet' semantics when absent. */
  kind?: 'sheet' | 'blog';
  totalRows: number;
  seoCheckResults: SeoCheckResult[];
  redirectResults: RedirectResult[];
  brokenLinkResults: BrokenLinkResult[];
  accessibilityResults: AccessibilityCheckResult[];
  lighthouseResults: LighthouseCheckResult[];
  skipped: SkippedAuditRow[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
