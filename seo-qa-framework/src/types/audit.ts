export type AuditSheetFormat = 'csv' | 'xlsx';

/**
 * issueBased: traditional audit sheets with one row per flagged issue
 * (a "Problem"/"Check Type" column plus a generic expected/actual value).
 *
 * recommendation: "recommendation sheets" with one row per URL and several
 * per-field "Suggested X" columns (e.g. Suggested Meta Title, Suggested H1).
 * Each non-empty field on a row is expanded into its own SeoAuditRow.
 */
export type AuditSheetMode = 'issueBased' | 'recommendation';

export type SeoIssueType =
  | 'title'
  | 'metaDescription'
  | 'h1'
  | 'h2'
  | 'canonical'
  | 'robots'
  | 'noindex'
  | 'statusCode'
  | 'redirect'
  | 'brokenLink'
  | 'accessibility'
  | 'performance'
  | 'imageAlt'
  | 'structuredData'
  | 'openGraph'
  | 'twitterCard'
  | 'sitemap'
  | 'internalLinks'
  | 'hreflang'
  | 'unknown';

export interface SeoAuditRow {
  url: string;
  checkType: string;
  issueType: SeoIssueType;
  expectedValue?: string;
  actualValue?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  sourceRowNumber: number;
  raw: Record<string, string>;
}

export interface DetectedRecommendationField {
  column: string;
  issueType: SeoIssueType;
}

export interface AuditParseResult {
  sourcePath: string;
  format: AuditSheetFormat;
  mode: AuditSheetMode;
  detectedColumns: Partial<Record<AuditColumnKey, string>>;
  detectedFields?: DetectedRecommendationField[];
  rows: SeoAuditRow[];
}

export type AuditColumnKey =
  | 'url'
  | 'checkType'
  | 'expectedValue'
  | 'actualValue'
  | 'severity'
  | 'notes';
