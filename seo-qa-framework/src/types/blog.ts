/** A hyperlink extracted from the document or live page. */
export interface BlogLink {
  /** Visible anchor text (normalised). */
  text: string;
  /** Destination URL (normalised — tracking params stripped, relative resolved). */
  url: string;
  /** Raw href as it appeared in the source before normalisation. */
  rawUrl: string;
}

/**
 * Normalized blog content shape. The same shape is produced by the docx
 * extractor (expected/approved content) and the live-page extractor
 * (actual/published content) so they can be compared field-by-field.
 */
export interface BlogContent {
  /** The H1 / blog title. */
  title?: string;
  h2Headings: string[];
  h3Headings: string[];
  /**
   * H4 headings — most commonly FAQ questions ("Question text (H4)" in a
   * content brief, or a real `<h4>` on the live page).
   */
  h4Headings: string[];
  /** Body paragraphs in document order (headings excluded). */
  paragraphs: string[];
  metaTitle?: string;
  metaDescription?: string;
  /** Hyperlinks within the article body. */
  links: BlogLink[];
  /** Bold words/phrases within the article body. */
  boldPhrases: string[];
  /**
   * Twitter Card fields. Always extracted, but only included in the
   * comparison when Twitter Card validation is explicitly enabled via
   * configuration — it is not part of the default Blog Validation workflow.
   */
  twitterTitle?: string;
  twitterDescription?: string;
  /**
   * The `<link rel="canonical">` href resolved to an absolute URL.
   * Only populated by the live-page extractor (`extractLiveBlogContent`) —
   * the docx side has no canonical tag of its own, only an optional
   * `expectedCanonicalUrl` override (below).
   */
  canonicalUrl?: string;
  /**
   * Total number of `<h1>` elements found anywhere on the live page
   * (document-wide, not scoped to the content container — a duplicate H1
   * injected by the CMS template outside the article, or a second one
   * inside it, both count). Only populated by the live-page extractor; a
   * .docx has no notion of "how many H1 tags" since it isn't rendered HTML.
   * Confirmed against a real site where the CMS re-rendered the blog title
   * as a second literal `<h1>` at the top of the article body, in addition
   * to the page-header `<h1>` — `title` above only ever captures the first
   * match, so this field is what lets `compareBlogContent` flag the
   * duplicate instead of silently passing.
   */
  h1Count?: number;
  /**
   * Optional canonical URL override from a "Canonical: …" labeled line in
   * the approved document. When absent, the canonical check falls back to
   * expecting the live page to self-reference the audited URL. Only
   * populated by the docx extractor.
   */
  expectedCanonicalUrl?: string;
  /**
   * Optional expected URL slug/path from a "SEO Slug:" / "Slug:" /
   * "Permalink:" / "URL:" labeled line in the approved document. Only
   * populated by the docx extractor.
   */
  expectedSlug?: string;
}

export interface BlogComparisonSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  missingContent: number;
  modifiedContent: number;
  metadataIssues: number;
  boldText: BoldTextSummary;
}

export interface BoldTextSummary {
  /** Number of expected bold phrases evaluated (excludes "extra" bold found only on the live page). */
  total: number;
  passed: number;
  missing: number;
  /**
   * Bold phrases that changed rather than being purely missing or extra.
   * The current comparator only detects presence/absence (no fuzzy
   * matching like paragraphs have), so this is always 0 today — kept so the
   * summary shape doesn't need to change if that's added later.
   */
  modified: number;
  /** Bold phrases present on the live page but not in the approved document. */
  extra: number;
}
