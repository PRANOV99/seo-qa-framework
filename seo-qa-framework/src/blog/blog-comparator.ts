import type { BlogContent, BlogLink } from '../types/blog.js';
import type { SeoCheckResult } from '../types/check-result.js';
import { normalizeForComparison, normalizeText } from '../seo-checks/check-utils.js';
import { normalizeUrl } from './url-normalizer.js';
import { computeLcsAlignment, computeWordDiff, normalizeQuotes, stripEdgePunctuation, summarizeWordDiff } from './text-diff.js';

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
 *    whitespace / smart-quote differences do not cause false failures; a
 *    genuine change is reported with a word-level diff)
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
    // Meta Title alone tolerates a trailing " – Site Name" (or "| Site
    // Name", "- Site Name") suffix — WordPress/most SEO plugins auto-append
    // this to the <title> tag, and a docx's approved value almost never
    // includes it on purpose. Meta Description and H1 get no such leniency;
    // that boilerplate is a <title>-tag-only convention.
    compareSingleValue(url, 'Meta Title',        expected.metaTitle,       actual.metaTitle,
      'Meta title is missing from the live page.', { allowSiteNameSuffix: true }),
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
    // H4 is most commonly FAQ questions ("Question text (H4)" in a content
    // brief, or a real <h4> on the live page) — compared the same way as H2/H3.
    ...compareHeadingList(url, 'H4', expected.h4Headings, actual.h4Headings),

    // ── Body paragraphs ──────────────────────────────────────────────────────
    ...compareParagraphs(url, expected.paragraphs, actual.paragraphs),

    // ── Hyperlinks ────────────────────────────────────────────────────────────
    ...compareLinks(url, expected.links, actual.links),

    // ── Bold formatting ───────────────────────────────────────────────────────
    ...compareBoldPhrases(url, expected.boldPhrases, actual.boldPhrases, actualHeadingTexts(actual), expected.links),
  ];

  return results;
}

// ── Single-value comparison ────────────────────────────────────────────────────

function compareSingleValue(
  url: string,
  checkType: string,
  expected: string | undefined,
  actual: string | undefined,
  missingMessage: string,
  options: { allowSiteNameSuffix?: boolean } = {}
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
  // Quote-normalized so typographic substitutions (e.g. a numeric &#8217;
  // entity rendering as a curly apostrophe) don't by themselves fail this
  // check — same treatment as paragraphs and headings. Edge punctuation
  // (a trailing period, etc.) is also ignored — a CMS adding or dropping one
  // on publish is a formatting nicety, not a wording change.
  const expKey = stripEdgePunctuation(normalizeQuotes(normalizeForComparison(expected)));
  const actKey = stripEdgePunctuation(normalizeQuotes(normalizeForComparison(actual)));

  if (expKey === actKey) {
    return { url, checkType, status: 'passed', expected, actual,
             message: `${checkType} matches the approved document.` };
  }

  if (options.allowSiteNameSuffix && hasSiteNameSuffix(expKey, actKey)) {
    return { url, checkType, status: 'passed', expected, actual,
             message: `${checkType} matches the approved document (a trailing site-name suffix was ignored).` };
  }

  // Case-preserving, quote/edge-punctuation-normalized text for the diff
  // itself, so the same insignificant differences that don't fail the
  // check also never show up highlighted as if they were the change.
  // expected/actual are guaranteed non-empty strings here — both normExp
  // and normAct were already checked truthy above.
  const display = (value: string) => stripEdgePunctuation(normalizeQuotes(normalizeText(value)));
  const diff = computeWordDiff(display(expected!), display(actual!));
  return {
    url, checkType, status: 'failed', expected, actual,
    message: `${checkType} has changed. Expected "${normExp}" but found "${normAct}".`,
    diff
  };
}

/** Common separators a WordPress theme/SEO plugin uses to auto-append the site name to the <title> tag. */
const SITE_NAME_SEPARATORS = [' - ', ' – ', ' — ', ' | '];

/**
 * True when `actualKey` is exactly `expectedKey` plus one of the common
 * auto-appended "Site Name" suffixes ( " - Site Name", " – Site Name", " |
 * Site Name", …) — boilerplate most WordPress themes/SEO plugins add to the
 * live `<title>` tag that a docx's approved Meta Title almost never
 * includes on purpose, since it isn't part of that page's actual approved
 * copy. Both keys are already lowercased/whitespace-collapsed/quote- and
 * edge-punctuation-normalized by the caller.
 */
function hasSiteNameSuffix(expectedKey: string, actualKey: string): boolean {
  if (!expectedKey) return false;
  return SITE_NAME_SEPARATORS.some((separator) => {
    const prefix = expectedKey + separator;
    return actualKey.startsWith(prefix) && actualKey.length > prefix.length;
  });
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
               `but found "${actualCanonicalUrl}".`,
      diff: computeWordDiff(expectedDisplay, actualCanonicalUrl)
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
               `but the live URL path is "${actualPath}".`,
      diff: computeWordDiff(expectedSlug ?? '', actualPath)
    };
  }

  return { url, checkType, status: 'passed', expected: expectedSlug, actual: actualPath,
           message: 'Live URL matches the expected slug/structure.' };
}

function normalizeSlugSegment(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

// ── Heading-list comparison ────────────────────────────────────────────────────

/**
 * Compares H2/H3/H4 heading lists for presence and order.
 *
 * Matching is quote-normalized and edge-punctuation-normalized in addition
 * to the usual whitespace/case normalization, so a typographic apostrophe
 * substitution (e.g. a live page rendering a docx's straight `'` as a curly
 * `’` — whether authored that way or produced by decoding a numeric
 * `&#8217;` entity) or a trailing colon/period a theme adds to section
 * headings does not by itself cause a heading that is genuinely present to
 * be reported as missing.
 *
 * Order is checked the same way as body paragraphs: via the longest common
 * subsequence (LCS) of exact matches, not strict positional equality — one
 * heading inserted/removed elsewhere (e.g. an extra "Related Posts" heading
 * a CMS template injects) doesn't cascade into "out of order" for every
 * heading that follows it. A heading found verbatim on the live page but
 * outside that maximal in-order match is reported as present-but-out-of-order
 * — as a WARNING, not a FAIL, since the content itself is genuinely there;
 * only a heading that truly cannot be found anywhere is a FAIL.
 */
function compareHeadingList(
  url: string,
  label: string,
  expected: string[],
  actual: string[]
): SeoCheckResult[] {
  const headingKey = (value: string) => stripEdgePunctuation(normalizeQuotes(normalizeForComparison(value)));
  // Case-preserving, quote/edge-punctuation-normalized text used only for the
  // diff shown on a genuinely modified heading — mirrors paragraphDisplay.
  const headingDisplay = (value: string) => stripEdgePunctuation(normalizeQuotes(normalizeText(value)));

  const expectedKeys = expected.map(headingKey);
  const actualKeys = actual.map(headingKey);
  const orderedMatch = computeLcsAlignment(expectedKeys, actualKeys, (x, y) => x === y);

  return expected.map((expectedHeading, index) => {
    const checkType  = `${label} #${index + 1}`;
    const normExpect = expectedKeys[index]!;

    const matchedIndex = orderedMatch[index];
    if (matchedIndex !== undefined) {
      return {
        url, checkType, status: 'passed',
        expected: expectedHeading, actual: actual[matchedIndex],
        message: `${label} heading matches the approved document.`
      } satisfies SeoCheckResult;
    }

    // Not part of the maximal in-order match, but present verbatim
    // elsewhere on the live page — the heading exists, it's just shifted
    // relative to the others, so this is a WARNING, not a FAIL.
    const actualIndex = actualKeys.indexOf(normExpect);
    if (actualIndex !== -1) {
      return {
        url, checkType, status: 'warning',
        expected: expectedHeading, actual: actual[actualIndex],
        message: `${label} heading "${expectedHeading}" is present but out of order ` +
                 `(expected around position ${index + 1}, found at position ${actualIndex + 1}).`
      } satisfies SeoCheckResult;
    }

    // No exact match anywhere — but accordion/FAQ widgets and other
    // dynamically structured markup sometimes wrap the same heading text in
    // extra decoration (a toggle icon, a "+"/"-" character rendered as real
    // text, etc.). If the expected text is still fully contained in a live
    // heading (or vice versa) it is genuinely present, just not verbatim —
    // a WARNING, not a FAIL.
    const containedIndex = actualKeys.findIndex((key) => isHeadingContained(normExpect, key));
    if (containedIndex !== -1) {
      return {
        url, checkType, status: 'warning',
        expected: expectedHeading, actual: actual[containedIndex],
        message: `${label} heading "${expectedHeading}" was found on the live page wrapped in ` +
                 `additional markup (e.g. an accordion/FAQ widget) — found "${actual[containedIndex]}".`
      } satisfies SeoCheckResult;
    }

    // Genuinely not present anywhere, verbatim or decorated — but a similar
    // live heading exists (word-overlap similarity, same threshold as
    // paragraphs): the heading was likely modified, not removed. Reporting
    // it against that closest candidate with a word-level diff pinpoints
    // exactly what changed instead of a blunt "missing".
    const closestIndex = findMostSimilarIndex(normExpect, actualKeys);
    if (closestIndex !== undefined) {
      const closestActual = actual[closestIndex]!;
      const diff = computeWordDiff(headingDisplay(expectedHeading), headingDisplay(closestActual));
      return {
        url, checkType, status: 'failed',
        expected: expectedHeading, actual: closestActual,
        message: summarizeWordDiff(diff, `${label} heading`),
        diff
      } satisfies SeoCheckResult;
    }

    return {
      url, checkType, status: 'failed',
      expected: expectedHeading, actual: undefined,
      message: `${label} heading "${expectedHeading}" is missing from the live page.`
    } satisfies SeoCheckResult;
  });
}

/** Strips leading/trailing characters that aren't letters/digits — accordion toggle icons, bullets, decorative punctuation, etc. */
function stripHeadingDecoration(value: string): string {
  return value.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}

/**
 * True when one (already normalized) heading key is fully contained within
 * the other after decorative leading/trailing characters are stripped —
 * used as a last-resort match for a heading whose live markup wraps the
 * same text in extra decoration. Guarded by a minimum length so short
 * headings don't spuriously "contain" unrelated longer ones.
 */
function isHeadingContained(expectedKey: string, actualKey: string): boolean {
  const e = stripHeadingDecoration(expectedKey);
  const a = stripHeadingDecoration(actualKey);
  if (e.length < 4 || a.length < 4) return false;
  return a.includes(e) || e.includes(a);
}

// ── Paragraph comparison ───────────────────────────────────────────────────────

/**
 * Compares body paragraphs by content first, then position — never the
 * other way around — so minor formatting / punctuation differences or a
 * shifted position don't cause false failures.
 *
 * Paragraphs are identified in the report by a human-readable preview of the
 * first 10 words rather than a generic "Body Paragraph #N" label.
 *
 * Matching is quote-normalized and edge-punctuation-normalized, as well as
 * whitespace/case-normalized, so typographic substitutions content platforms
 * make on publish (e.g. WordPress' wptexturize converting straight quotes to
 * curly ones, or a theme dropping/adding a trailing period) do not by
 * themselves cause a paragraph to be reported as changed — only genuine
 * content differences do. When a paragraph is genuinely modified, a
 * word-level diff is attached (see text-diff.ts) so the report can show
 * exactly what changed instead of a generic message.
 *
 * Position is only consulted AFTER content matching, via the longest common
 * subsequence (LCS) of exact matches between the expected and actual
 * paragraph lists — every paragraph in that subsequence is genuinely in the
 * same relative order in both, so one paragraph inserted, removed, or
 * reordered elsewhere doesn't cascade into false failures for everything
 * that follows it, and a paragraph at the same (or a merely shifted, e.g.
 * because something was added before it) position always passes. Only a
 * paragraph left OUT of that maximal subsequence, but still found
 * word-for-word somewhere else in the live page, has genuinely moved — that
 * is a WARNING, not a FAIL, since the content itself is unchanged.
 */
function compareParagraphs(
  url: string,
  expected: string[],
  actual: string[]
): SeoCheckResult[] {
  // Case-insensitive, quote-normalized, edge-punctuation-normalized,
  // whitespace-collapsed key used purely to decide whether two paragraphs
  // are "the same" — matches the existing case-insensitive comparison
  // semantics used throughout this file.
  const paragraphKey = (value: string) => stripEdgePunctuation(normalizeQuotes(normalizeForComparison(value)));
  // Case-preserving, quote/whitespace/edge-punctuation-normalized text used
  // to compute and display the diff, so insignificant differences never
  // appear in it — only genuine wording changes do.
  const paragraphDisplay = (value: string) => stripEdgePunctuation(normalizeQuotes(normalizeText(value)));

  const expectedKeys = expected.map(paragraphKey);
  const actualKeys = actual.map(paragraphKey);
  const orderedMatch = computeLcsAlignment(expectedKeys, actualKeys, (x, y) => x === y);

  return expected.map((expectedParagraph, index) => {
    const preview    = paragraphPreview(expectedParagraph);
    const checkType  = `"${preview}"`;
    const normExpect = expectedKeys[index]!;

    const matchedIndex = orderedMatch[index];
    if (matchedIndex !== undefined) {
      return {
        url, checkType, status: 'passed',
        expected: expectedParagraph, actual: actual[matchedIndex],
        message: 'Paragraph matches the approved document.'
      } satisfies SeoCheckResult;
    }

    // Not part of the maximal in-order match, but present verbatim elsewhere
    // on the live page — the paragraph is unchanged, it has simply moved, so
    // this is a WARNING (not a FAIL): the content itself is genuinely there.
    const anyExactIndex = actualKeys.indexOf(normExpect);
    if (anyExactIndex !== -1) {
      return {
        url, checkType, status: 'warning',
        expected: expectedParagraph, actual: actual[anyExactIndex],
        message: `Paragraph is unchanged but has moved ` +
                 `(expected around position ${index + 1}, found at position ${anyExactIndex + 1}).`
      } satisfies SeoCheckResult;
    }

    const closestIndex = findMostSimilarIndex(normExpect, actualKeys);
    if (closestIndex !== undefined) {
      const closestActual = actual[closestIndex]!;
      const diff = computeWordDiff(paragraphDisplay(expectedParagraph), paragraphDisplay(closestActual));
      return {
        url, checkType, status: 'failed',
        expected: expectedParagraph, actual: closestActual,
        message: summarizeWordDiff(diff),
        diff
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
 * For each expected hyperlink (from the docx), checks whether that exact
 * (anchor text + URL) pair exists on the live page.
 *
 * Matching strategy (in priority order):
 *  1. Exact (anchor text + URL) pair found anywhere on the live page → PASS.
 *     This is checked against *every* live link, not just one link per URL,
 *     so a page that legitimately has several links sharing the same
 *     destination with different anchor text (e.g. "view pricing" and
 *     "see plans" both pointing to /pricing) does not cause a false failure
 *     for whichever of those anchor texts is actually expected.
 *
 *     Matching is occurrence-counted, not just present/absent: if the
 *     approved document expects the exact same (text, URL) pair twice (a
 *     repeated CTA, say), the live page must have it twice too — each
 *     matched occurrence is consumed so it cannot also satisfy a different
 *     expected entry, and a genuinely-missing duplicate is still reported
 *     rather than silently passing because "one of them" was found.
 *  2. No exact pair — but another live link shares the destination URL →
 *     report an anchor-text mismatch, with a word-level diff (for
 *     diagnostics; picks the first such link not already claimed by #1).
 *  3. No exact pair — but another live link shares the anchor text →
 *     report a destination-URL mismatch, with a word-level diff.
 *  4. Neither → report as missing.
 *
 * Extra (text, URL) pairs on the live page beyond what the approved
 * document accounts for are reported as a WARNING (not a FAIL) — genuinely
 * unexpected content is worth flagging, but CMS templates routinely add
 * breadcrumbs/related-posts/share-button links that are still legitimate,
 * so this must never block an otherwise-passing audit. Reported once per
 * distinct (text, URL) pair, not once per repeated occurrence, so a
 * "related posts" widget repeating the same card three times doesn't
 * produce three near-identical warnings.
 */
function compareLinks(
  url: string,
  expected: BlogLink[],
  actual: BlogLink[]
): SeoCheckResult[] {
  const pairKey = (text: string, linkUrl: string) => `${normalizeForComparison(text)}||${linkUrl}`;
  const linkDisplay = (l: Pick<BlogLink, 'text' | 'url'>) => `${l.text} → ${l.url}`;

  // Occurrence-counted (multiset), not a plain Set, so N identical expected
  // pairs require N distinct live occurrences — see the doc comment above.
  const actualPairCounts = new Map<string, number>();
  for (const link of actual) {
    const key = pairKey(link.text, link.url);
    actualPairCounts.set(key, (actualPairCounts.get(key) ?? 0) + 1);
  }

  // Grouped (not de-duped) lookups, used only to produce a helpful message
  // when no exact pair match exists — multiple live links can legitimately
  // share a URL or anchor text, so these intentionally keep every candidate
  // rather than letting the last one silently overwrite the others.
  const byUrl = new Map<string, BlogLink[]>();
  const byText = new Map<string, BlogLink[]>();
  for (const link of actual) {
    (byUrl.get(link.url) ?? byUrl.set(link.url, []).get(link.url)!).push(link);
    const textKey = normalizeForComparison(link.text);
    (byText.get(textKey) ?? byText.set(textKey, []).get(textKey)!).push(link);
  }

  const results: SeoCheckResult[] = expected.map((expectedLink) => {
    const checkType       = `Hyperlink: "${paragraphPreview(expectedLink.text)}"`;
    const expectedDisplay = linkDisplay(expectedLink);
    const key             = pairKey(expectedLink.text, expectedLink.url);
    const remaining       = actualPairCounts.get(key) ?? 0;

    if (remaining > 0) {
      actualPairCounts.set(key, remaining - 1);
      return {
        url, checkType, status: 'passed',
        expected: expectedDisplay,
        actual: expectedDisplay,
        message: 'Hyperlink matches the approved document.'
      } satisfies SeoCheckResult;
    }

    const sameUrl = byUrl.get(expectedLink.url);
    if (sameUrl && sameUrl.length > 0) {
      const found = sameUrl[0]!;
      const foundDisplay = linkDisplay(found);
      return {
        url, checkType, status: 'failed',
        expected: expectedDisplay,
        actual: foundDisplay,
        message: `Hyperlink destination matches but anchor text differs. ` +
                 `Expected "${expectedLink.text}" but found "${found.text}".`,
        diff: computeWordDiff(expectedDisplay, foundDisplay)
      } satisfies SeoCheckResult;
    }

    const sameText = byText.get(normalizeForComparison(expectedLink.text));
    if (sameText && sameText.length > 0) {
      const found = sameText[0]!;
      const foundDisplay = linkDisplay(found);
      return {
        url, checkType, status: 'failed',
        expected: expectedDisplay,
        actual: foundDisplay,
        message: `Hyperlink text matches but destination URL differs. ` +
                 `Expected "${expectedLink.url}" but found "${found.url}".`,
        diff: computeWordDiff(expectedDisplay, foundDisplay)
      } satisfies SeoCheckResult;
    }

    return {
      url, checkType, status: 'failed',
      expected: expectedDisplay,
      actual: undefined,
      message: `Hyperlink "${expectedLink.text}" (${expectedLink.url}) is missing from the live page.`
    } satisfies SeoCheckResult;
  });

  // Whatever is left unconsumed in actualPairCounts is genuinely extra —
  // one WARNING per distinct (text, URL) pair, regardless of how many times
  // it repeats on the page.
  const extraSeen = new Set<string>();
  for (const link of actual) {
    const key = pairKey(link.text, link.url);
    if ((actualPairCounts.get(key) ?? 0) <= 0) continue;
    if (extraSeen.has(key)) continue;
    extraSeen.add(key);
    results.push({
      url,
      checkType: `Hyperlink (extra): "${paragraphPreview(link.text)}"`,
      status: 'warning',
      expected: undefined,
      actual: linkDisplay(link),
      message: `Hyperlink "${link.text}" (${link.url}) is present on the live page but not in the approved document.`
    });
  }

  return results;
}

// ── Bold formatting comparison ─────────────────────────────────────────────────

/**
 * Compares bold phrases:
 *  - Expected bold missing from live page → FAIL
 *  - Extra bold on live page not in approved document → WARNING
 *
 * Matching is occurrence-counted (a multiset), not just present/absent —
 * consistent with compareLinks — so N identical expected bold phrases
 * require N distinct occurrences on the live page: each match consumes one
 * occurrence, a genuinely-missing duplicate is still reported, and leftover
 * unconsumed occurrences are reported as extra (deduped to one WARNING per
 * distinct phrase, not one per repeat).
 *
 * A docx author sometimes bolds an entire Heading-styled paragraph (e.g. a
 * whole "Frequently Asked Questions" H2), which the docx parser captures as
 * a bold phrase in addition to the heading itself. Live pages almost never
 * render heading text inside a literal <strong>/<b> tag — headings are bold
 * via their own styling — so that bold phrase would otherwise never find a
 * match even though the heading is genuinely present and already verified by
 * the heading comparison. `actualHeadings` reuses the same normalized
 * heading text already extracted from the live page (title + H2/H3/H4) so
 * that case is recognized as present rather than reported missing.
 *
 * A docx author also sometimes bolds a phrase that is ALSO the anchor text
 * of a hyperlink (e.g. a bolded call-to-action link). A hyperlink is its own
 * distinct visual treatment on a live page, not necessarily bold, so it is
 * never required to also render bold; expectedLinks (the approved
 * document's own hyperlink anchor texts) is used to skip those phrases
 * entirely rather than failing them when the live link isn't bold.
 */
function compareBoldPhrases(
  url: string,
  expected: string[],
  actual: string[],
  actualHeadings: string[],
  expectedLinks: BlogLink[]
): SeoCheckResult[] {
  const results: SeoCheckResult[] = [];

  const actualCounts = new Map<string, number>();
  for (const phrase of actual) {
    const norm = normalizeForComparison(phrase);
    actualCounts.set(norm, (actualCounts.get(norm) ?? 0) + 1);
  }
  const normalizedActualHeadingSet = new Set(actualHeadings.map(normalizeForComparison));
  const normalizedLinkTextSet = new Set(expectedLinks.map((link) => normalizeForComparison(link.text)));

  for (const phrase of expected) {
    const norm    = normalizeForComparison(phrase);
    const preview = paragraphPreview(phrase);
    const remaining = actualCounts.get(norm) ?? 0;

    if (remaining > 0) {
      actualCounts.set(norm, remaining - 1);
      results.push({
        url,
        checkType: `Bold: "${preview}"`,
        status: 'passed',
        expected: phrase, actual: phrase,
        message: 'Bold phrase matches the approved document.'
      });
    } else if (normalizedActualHeadingSet.has(norm)) {
      results.push({
        url,
        checkType: `Bold: "${preview}"`,
        status: 'passed',
        expected: phrase, actual: phrase,
        message: 'Bold phrase matches a heading on the live page (rendered bold via heading styling, not a literal bold tag).'
      });
    } else if (normalizedLinkTextSet.has(norm)) {
      results.push({
        url,
        checkType: `Bold: "${preview}"`,
        status: 'skipped',
        expected: phrase, actual: undefined,
        message: 'Bold phrase is also a hyperlink anchor text; hyperlinks are not required to also render bold.'
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

  // Whatever is left unconsumed is genuinely extra — one WARNING per
  // distinct phrase, regardless of how many times it repeats on the page.
  const extraSeen = new Set<string>();
  for (const phrase of actual) {
    const norm = normalizeForComparison(phrase);
    if ((actualCounts.get(norm) ?? 0) <= 0) continue;
    if (extraSeen.has(norm)) continue;
    extraSeen.add(norm);
    results.push({
      url,
      checkType: `Bold (extra): "${paragraphPreview(phrase)}"`,
      status: 'warning',
      expected: undefined, actual: phrase,
      message: `Bold phrase "${phrase}" is present on the live page but not in the approved document.`
    });
  }

  return results;
}

/** Every heading on the live page, across all levels, for cross-checking bold phrases against heading text (see compareBoldPhrases). */
function actualHeadingTexts(actual: BlogContent): string[] {
  return [actual.title, ...actual.h2Headings, ...actual.h3Headings, ...actual.h4Headings]
    .filter((heading): heading is string => Boolean(heading));
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
