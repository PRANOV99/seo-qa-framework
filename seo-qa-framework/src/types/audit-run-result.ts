import type { AuditParseResult, SeoAuditRow } from './audit.js';
import type { SeoCheckResult } from './check-result.js';
import type { RedirectResult } from './redirect-result.js';
import type { BrokenLinkResult } from './broken-link-result.js';
import type { AccessibilityCheckResult } from './accessibility-result.js';
import type { LighthouseCheckResult } from './lighthouse-result.js';
import type { BlogContent } from './blog.js';

export interface SkippedAuditRow {
  auditRow: SeoAuditRow;
  reason: string;
}

export interface AuditRunResult {
  sourcePath: string;
  /** Distinguishes a sheet-driven audit run from a docx-vs-live blog validation run. Defaults to 'sheet' semantics when absent. */
  kind?: 'sheet' | 'blog';
  /**
   * The approved content parsed from the .docx (blog runs only) — persisted
   * on the saved history record so the SAME blog can be re-tested later
   * against a fresh crawl of the live page without re-uploading the
   * document. Undefined for sheet runs.
   */
  expected?: BlogContent;
  /**
   * The parsed sheet content (sheet runs only) — persisted on the saved
   * history record so the SAME sheet can be re-tested later against a fresh
   * crawl of its URLs without re-uploading the .xlsx/.csv. Mirrors `expected`
   * above, which serves the equivalent purpose for blog runs. Undefined for
   * blog runs.
   */
  expectedSheet?: AuditParseResult;
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
