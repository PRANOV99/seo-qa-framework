import type { BlogContent, BlogLink } from '../types/blog.js';
import type { SeoCheckResult } from '../types/check-result.js';
import { normalizeForComparison, normalizeText } from '../seo-checks/check-utils.js';
import { normalizeUrl } from './url-normalizer.js';

/**
 * Compares the approved blog content (extracted from the .docx) against the
 * live, published page content (extracted via Playwright).
 *
 * Produces PASS / FAIL / WARNING / SKIPPED SeoCheckResult entries:
 *  - Metadata (Meta Title, Meta Description, H1)
 *  - Canonical URL (self-referencing, or matching a docx "Canonical:" override)
 *  - Blog URL / Slug (only when the docx specifies an expected slug/URL)
 *  - H2 / H3 headings (presence and order)
 *  - Body paragraphs (similarity-based matching — minor punctuation /
 *    whitespace differences do not cause false failures)
 *  - Hyperlinks (anchor text + destination URL)
 *  - Bold formatting (missing = FAIL; extra = WARNING)
 */
export function compareBlogContent(
  url: string,
  expected: BlogContent,
  actual: BlogContent
): SeoCheckResult[] {
  const results: SeoCheckResult[] = [
    // ── Metadata ─────────────────────────────────────────────────────────────
    compareSingleValue(url, 'Meta Title',        expected.metaTitle,       actual.metaTitle,
      'Meta title is missing from the live page.'),
    compareSingleValue(url, 'Meta Description',  expected.metaDescription, actual.metaDescription,
      'Meta description is missing from the live page.'),
    // H1 is skipped ONLY when expected.title is absent — never when it has a value.
    compareSingleValue(url, 'Blog Title (H1)',   expected.title,           actual.title,
      'H1 is missing from the live page.'),

    // ── URL-level checks ─────────────────────────────────────────────────────
    compareCanonicalUrl(url, expected.expectedCanonicalUrl, actual.canonicalUrl),
    compareSlug(url, expected.expectedSlug),

    // ── Headings ─────────────────────────────────────────────────────────────
    ...compareHeadingList(url, 'H2', expected.h2Headings, actual.h2Headings),
    ...compareHeadingList(url, 'H3', expected.h3Headings, actual.h3Headings),

    // ── Body paragraphs ──────────────────────────────────────────────────────
    ...compareParagraphs(url, expected.paragraphs, actual.paragraphs),

    // ── Hyperlinks ────────────────────────────────────────────────────────────
    ...compareLinks(url, expected.links, actual.links),

    // ── Bold formatting ───────────────────────────────────────────────────────
    ...compareBoldPhrases(url, expected.boldPhrases, actual.boldPhrases),
  ];

  return results;
}

// ── Single-value comparison ────────────────────────────────────────────────────

function compareSingleValue(
  url: string,
  checkType: string,
  expected: string | undefined,
  actual: string | undefined,
  missingMessage: string
): SeoCheckResult {
  const normExp = normalizeText(expected);
  const normAct = normalizeText(actual);

  if (!normExp) {
    return { url, checkType, status: 'skipped', expected, actual,
             message: 'No expected value provided in the document.' };
  }
  if (!normAct) {
    return { url, checkType, status: 'failed', expected, actual, message: missingMessage };
  }
  if (normalizeForComparison(expected) !== normalizeForComparison(actual)) {
    return {
      url, checkType, status: 'failed', expected, actual,
      message: `${checkType} has changed. Expected "${normExp}" but found "${normAct}".`
    };
  }
  return { url, checkType, status: 'passed', expected, actual,
           message: `${checkType} matches the approved document.` };
}

// ── Canonical URL comparison ───────────────────────────────────────────────────

/**
 * Validates the live page's `<link rel="canonical">` tag.
 *
 * Expectation:
 *  - If the approved document specifies a "Canonical: …" override, the live
 *    canonical must match that value.
 *  - Otherwise, standard SEO practice for a blog post is a self-referencing
 *    canonical, so the live canonical is expected to match the audited URL.
 */
function compareCanonicalUrl(
  url: string,
  expectedCanonicalOverride: string | undefined,
  actualCanonicalUrl: string | undefined
): SeoCheckResult {
  const checkType = 'Canonical URL';
  const expectedTarget = expectedCanonicalOverride
    ? normalizeUrl(expectedCanonicalOverride, url)
    : normalizeUrl(url, url);
  const expectedDisplay = expectedCanonicalOverride ?? url;

  if (!actualCanonicalUrl) {
    return { url, checkType, status: 'failed', expected: expectedDisplay, actual: undefined,
             message: 'Canonical URL is missing from the live page.' };
  }

  const normalizedActual = normalizeUrl(actualCanonicalUrl, url);
  if (normalizedActual !== expectedTarget) {
    return {
      url, checkType, status: 'failed', expected: expectedDisplay, actual: actualCanonicalUrl,
      message: `Canonical URL does not match. Expected it to point to "${expectedDisplay}" ` +
               `but found "${actualCanonicalUrl}".`
    };
  }

  return { url, checkType, status: 'passed', expected: expectedDisplay, actual: actualCanonicalUrl,
           message: 'Canonical URL matches the expected target.' };
}

// ── Blog URL / slug comparison ─────────────────────────────────────────────────

/**
 * Validates that the audited (live) URL's path matches the expected
 * slug/URL structure declared in the approved document (an "SEO Slug:" /
 * "Slug:" / "Permalink:" / "URL:" labeled line). Skipped when the document
 * provides no such label — this check has no meaning without one.
 *
 * Matching is lenient: the expected value may be authored as a bare slug
 * ("top-reasons-to-choose-jrc-wildwoods") or a full path
 * ("/blog/top-reasons-to-choose-jrc-wildwoods"), so a match is accepted
 * either way.
 */
function compareSlug(url: string, expectedSlug: string | undefined): SeoCheckResult {
  const checkType = 'Blog URL / Slug';
  const cleanExpected = expectedSlug ? normalizeSlugSegment(expectedSlug) : '';

  if (!cleanExpected) {
    return { url, checkType, status: 'skipped', expected: expectedSlug, actual: undefined,
             message: 'No expected URL/slug was specified in the approved document.' };
  }

  let actualPath: string;
  try {
    actualPath = normalizeSlugSegment(new URL(url).pathname);
  } catch {
    actualPath = normalizeSlugSegment(url);
  }

  const matches =
    actualPath === cleanExpected ||
    actualPath.endsWith(`/${cleanExpected}`) ||
    actualPath.endsWith(cleanExpected);

  if (!matches) {
    return {
      url, checkType, status: 'failed', expected: expectedSlug, actual: actualPath,
      message: `The live URL does not match the expected slug. Expected "${expectedSlug}" ` +
               `but the live URL path is "${actualPath}".`
    };
  }

  return { url, checkType, status: 'passed', expected: expectedSlug, actual: actualPath,
           message: 'Live URL matches the expected slug/structure.' };
}

function normalizeSlugSegment(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

// ── Heading-list comparison ────────────────────────────────────────────────────

function compareHeadingList(
  url: string,
  label: string,
  expected: string[],
  actual: string[]
): SeoCheckResult[] {
  const normalizedActual = actual.map(normalizeForComparison);

  return expected.map((expectedHeading, index) => {
    const checkType   = `${label} #${index + 1}`;
    const normExpect  = normalizeForComparison(expectedHeading);
    const actualIndex = normalizedActual.indexOf(normExpect);

    if (actualIndex === -1) {
      return {
        url, checkType, status: 'failed',
        expected: expectedHeading, actual: undefined,
        message: `${label} heading "${expectedHeading}" is missing from the live page.`
      } satisfies SeoCheckResult;
    }
    if (actualIndex !== index) {
      return {
        url, checkType, status: 'failed',
        expected: expectedHeading, actual: actual[actualIndex],
        message: `${label} heading "${expectedHeading}" is present but out of order ` +
                 `(expected position ${index + 1}, found at position ${actualIndex + 1}).`
      } satisfies SeoCheckResult;
    }
    return {
      url, checkType, status: 'passed',
      expected: expectedHeading, actual: actual[actualIndex],
      message: `${label} heading matches the approved document.`
    } satisfies SeoCheckResult;
  });
}

// ── Paragraph comparison ───────────────────────────────────────────────────────

/**
 * Compares body paragraphs using content-similarity rather than strict
 * positional matching so minor formatting / punctuation differences don't
 * cause false failures.
 *
 * Paragraphs are identified in the report by a human-readable preview of the
 * first 10 words rather than a generic "Body Paragraph #N" label.
 */
function compareParagraphs(
  url: string,
  expected: string[],
  actual: string[]
): SeoCheckResult[] {
  const normalizedActual = actual.map(normalizeForComparison);

  return expected.map((expectedParagraph, index) => {
    const preview         = paragraphPreview(expectedParagraph);
    const checkType       = `"${preview}"`;
    const normExpect      = normalizeForComparison(expectedParagraph);
    const exactIndex      = normalizedActual.indexOf(normExpect);

    if (exactIndex !== -1) {
      if (exactIndex === index) {
        return {
          url, checkType, status: 'passed',
          expected: expectedParagraph, actual: actual[exactIndex],
          message: 'Paragraph matches the approved document.'
        } satisfies SeoCheckResult;
      }
      return {
        url, checkType, status: 'failed',
        expected: expectedParagraph, actual: actual[exactIndex],
        message: `Paragraph is present but out of order ` +
                 `(expected position ${index + 1}, found at position ${exactIndex + 1}).`
      } satisfies SeoCheckResult;
    }

    const closestIndex = findMostSimilarIndex(normExpect, normalizedActual);
    if (closestIndex !== undefined) {
      return {
        url, checkType, status: 'failed',
        expected: expectedParagraph, actual: actual[closestIndex],
        message: 'Paragraph text has been modified from the approved document.'
      } satisfies SeoCheckResult;
    }

    return {
      url, checkType, status: 'failed',
      expected: expectedParagraph, actual: undefined,
      message: 'Paragraph is missing from the live page.'
    } satisfies SeoCheckResult;
  });
}

// ── Hyperlink comparison ───────────────────────────────────────────────────────

/**
 * For each expected hyperlink (from the docx), finds the best matching link
 * on the live page.
 *
 * Matching strategy (in priority order):
 *  1. URL match (canonical/normalised) → check if anchor text also matches.
 *  2. Anchor text match → report URL mismatch.
 *  3. Neither match → report as missing.
 *
 * Extra links on the live page (not in the docx) are not flagged — CMS
 * templates add breadcrumbs, related posts, share buttons, etc. that are
 * not in the approved content brief.
 */
function compareLinks(
  url: string,
  expected: BlogLink[],
  actual: BlogLink[]
): SeoCheckResult[] {
  const byUrl  = new Map<string, BlogLink>(actual.map((l) => [l.url,                             l]));
  const byText = new Map<string, BlogLink>(actual.map((l) => [normalizeForComparison(l.text), l]));

  return expected.map((expectedLink) => {
    const checkType       = `Hyperlink: "${paragraphPreview(expectedLink.text)}"`;
    const expectedDisplay = `${expectedLink.text} → ${expectedLink.url}`;

    const foundByUrl = byUrl.get(expectedLink.url);
    if (foundByUrl) {
      const textMatch = normalizeForComparison(foundByUrl.text) === normalizeForComparison(expectedLink.text);
      if (textMatch) {
        return {
          url, checkType, status: 'passed',
          expected: expectedDisplay,
          actual: `${foundByUrl.text} → ${foundByUrl.url}`,
          message: 'Hyperlink matches the approved document.'
        } satisfies SeoCheckResult;
      }
      return {
        url, checkType, status: 'failed',
        expected: expectedDisplay,
        actual: `${foundByUrl.text} → ${foundByUrl.url}`,
        message: `Hyperlink destination matches but anchor text differs. ` +
                 `Expected "${expectedLink.text}" but found "${foundByUrl.text}".`
      } satisfies SeoCheckResult;
    }

    const foundByText = byText.get(normalizeForComparison(expectedLink.text));
    if (foundByText) {
      return {
        url, checkType, status: 'failed',
        expected: expectedDisplay,
        actual: `${foundByText.text} → ${foundByText.url}`,
        message: `Hyperlink text matches but destination URL differs. ` +
                 `Expected "${expectedLink.url}" but found "${foundByText.url}".`
      } satisfies SeoCheckResult;
    }

    return {
      url, checkType, status: 'failed',
      expected: expectedDisplay,
      actual: undefined,
      message: `Hyperlink "${expectedLink.text}" (${expectedLink.url}) is missing from the live page.`
    } satisfies SeoCheckResult;
  });
}

// ── Bold formatting comparison ─────────────────────────────────────────────────

/**
 * Compares bold phrases:
 *  - Expected bold missing from live page → FAIL
 *  - Extra bold on live page not in approved document → WARNING
 */
function compareBoldPhrases(
  url: string,
  expected: string[],
  actual: string[]
): SeoCheckResult[] {
  const results: SeoCheckResult[] = [];
  const normalizedActualSet   = new Set(actual.map(normalizeForComparison));
  const normalizedExpectedSet = new Set(expected.map(normalizeForComparison));

  for (const phrase of expected) {
    const norm    = normalizeForComparison(phrase);
    const preview = paragraphPreview(phrase);
    if (normalizedActualSet.has(norm)) {
      results.push({
        url,
        checkType: `Bold: "${preview}"`,
        status: 'passed',
        expected: phrase, actual: phrase,
        message: 'Bold phrase matches the approved document.'
      });
    } else {
      results.push({
        url,
        checkType: `Bold: "${preview}"`,
        status: 'failed',
        expected: phrase, actual: undefined,
        message: `Bold phrase "${phrase}" is missing from the live page.`
      });
    }
  }

  // Extra bold on the live page that wasn't approved → WARNING (not an error)
  for (const phrase of actual) {
    if (!normalizedExpectedSet.has(normalizeForComparison(phrase))) {
      results.push({
        url,
        checkType: `Bold (extra): "${paragraphPreview(phrase)}"`,
        status: 'warning',
        expected: undefined, actual: phrase,
        message: `Bold phrase "${phrase}" is present on the live page but not in the approved document.`
      });
    }
  }

  return results;
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the first 10 words of text as a human-readable preview label.
 * Replaces the generic "Body Paragraph #N" / "Hyperlink #N" labels that
 * SEO/content teams cannot identify without counting positions.
 */
function paragraphPreview(text: string): string {
  const words = normalizeText(text).split(/\s+/);
  const slice = words.slice(0, 10).join(' ');
  return words.length > 10 ? slice + '…' : slice;
}

// ── Paragraph similarity helpers ───────────────────────────────────────────────
//
// Thresholds are calibrated for real blog paragraphs (≥10 words with rich
// vocabulary).  Short synthetic paragraphs used in unit tests should use
// richer content to trigger the similarity path.

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by',
  'can','did','do','for','from','get','has','have','here',
  'i','in','is','it','its','just','my','no','not',
  'of','on','or','our','out','so','that','the','their',
  'them','there','these','they','this','to','up','us',
  'was','we','were','which','who','will','with','you','your'
]);

/**
 * Returns the index of the live-page paragraph most similar to the expected
 * paragraph, or undefined when no live paragraph is sufficiently similar.
 *
 * Similarity is measured by Jaccard overlap of content words (non-stopwords,
 * punctuation stripped).
 *
 * Thresholds to minimise false positives:
 *  - At least 3 content words in common
 *  - At least 65% Jaccard similarity
 */
function findMostSimilarIndex(
  normalizedExpected: string,
  normalizedActualList: string[]
): number | undefined {
  const expectedWords = contentWords(normalizedExpected);
  if (expectedWords.size === 0) return undefined;

  let bestIndex: number | undefined;
  let bestScore = 0;

  normalizedActualList.forEach((candidate, index) => {
    const candidateWords = contentWords(candidate);
    if (candidateWords.size === 0) return;

    const overlapCount = [...expectedWords].filter((w) => candidateWords.has(w)).length;
    const score        = overlapCount / Math.max(expectedWords.size, candidateWords.size);

    if (overlapCount >= 3 && score >= 0.65 && score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function contentWords(normalizedText: string): Set<string> {
  return new Set(
    normalizedText
      .split(/\s+/)
      .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
      .filter((w) => w !== '' && !STOPWORDS.has(w))
  );
}
