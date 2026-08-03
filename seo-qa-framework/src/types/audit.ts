export type AuditSheetFormat = 'csv' | 'xlsx';

/**
 * issueBased: traditional audit sheets with one row per flagged issue
 * (a "Problem"/"Check Type" column plus a generic expected/actual value).
 *
 * recommendation: "recommendation sheets" with one row per URL and several
 * per-field "Suggested X" columns (e.g. Suggested Meta Title, Suggested H1).
 * Each non-empty field on a row is expanded into its own SeoAuditRow.
 *
 * faq: FAQ accordion sheets — a URL/FAQs/Answer sheet where a hyperlinked
 * URL cell marks the start of a page's group of expected question/answer
 * pairs, checked against that page's live FAQ accordion. Structurally
 * distinct from the other two modes (grouped by page, not one row per
 * check), so it's parsed and run through a fully separate code path
 * (see faqGroups/unresolvedFaqGroups below) rather than SeoAuditRow.
 */
export type AuditSheetMode = 'issueBased' | 'recommendation' | 'faq';

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
  | 'faq'
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

/** One expected question/answer pair from an FAQ sheet. */
export interface FaqItem {
  question: string;
  answer: string;
  sourceRowNumber: number;
}

/** One page's worth of expected FAQs, resolved to a real URL via the sheet's hyperlink. */
export interface FaqAuditGroup {
  url: string;
  /** The sheet's original page label (hyperlink display text) — used in report messages. */
  label: string;
  faqs: FaqItem[];
}

/**
 * An FAQ group whose page label had no hyperlink (or, for CSV, no literal
 * absolute URL) to resolve to a real page — reported as skipped rather than
 * guessed at. `faqCount` is the number of question/answer pairs that
 * couldn't be tested as a result.
 */
export interface UnresolvedFaqGroup {
  label: string;
  sourceRowNumber: number;
  faqCount: number;
}

export interface AuditParseResult {
  sourcePath: string;
  format: AuditSheetFormat;
  mode: AuditSheetMode;
  detectedColumns: Partial<Record<AuditColumnKey, string>>;
  detectedFields?: DetectedRecommendationField[];
  rows: SeoAuditRow[];
  /** Populated only when mode === 'faq'. */
  faqGroups?: FaqAuditGroup[];
  /** Populated only when mode === 'faq'. */
  unresolvedFaqGroups?: UnresolvedFaqGroup[];
}

export type AuditColumnKey =
  | 'url'
  | 'checkType'
  | 'expectedValue'
  | 'actualValue'
  | 'severity'
  | 'notes';
