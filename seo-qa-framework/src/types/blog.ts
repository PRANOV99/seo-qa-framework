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
}
