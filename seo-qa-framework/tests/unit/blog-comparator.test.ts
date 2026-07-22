import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareBlogContent } from '../../src/blog/blog-comparator.js';
import type { BlogContent, BlogLink } from '../../src/types/blog.js';

import { normalizeUrl } from '../../src/blog/url-normalizer.js';

// ── Shared fixture ─────────────────────────────────────────────────────────────
// Paragraphs use rich, realistic content so the similarity heuristic (≥3
// content-word overlap + ≥65% Jaccard) works correctly for the "modified"
// test case without lowering thresholds.

const BASE_URL = 'https://example.com/blog/sourdough';

const makeLink = (text: string, rawUrl: string): BlogLink => ({
  text,
  url: normalizeUrl(rawUrl, BASE_URL),
  rawUrl
});

const baseExpected: BlogContent = {
  title:           'How to Bake Sourdough Bread',
  metaTitle:       'How to Bake Sourdough Bread | Example Blog',
  metaDescription: 'Learn how to bake sourdough bread at home with this step-by-step guide.',
  h2Headings:      ['Ingredients', 'Method', 'Tips for Success'],
  h3Headings:      ['Starter', 'Proofing'],
  paragraphs: [
    'The sourdough starter needs regular feeding to stay healthy and active.',
    'Combine flour, water, salt, and starter to form a shaggy dough.',
    'Allow the dough to proof overnight before baking in a hot Dutch oven.'
  ],
  links: [
    makeLink('sourdough starter guide', 'https://example.com/guides/starter'),
    makeLink('Dutch oven recommendations', 'https://example.com/tools/dutch-oven')
  ],
  boldPhrases: ['sourdough starter', 'Dutch oven'],
  // Matches the last path segment of BASE_URL ("/blog/sourdough") so the
  // "exact match" fixture below represents a fully-passing blog by default.
  expectedSlug: 'sourdough'
};

function exactMatch(content: BlogContent): BlogContent {
  const clone = JSON.parse(JSON.stringify(content)) as BlogContent;
  // Live-page-only field: default every "actual" fixture to a self-referencing
  // canonical so tests that assert "everything passes" remain accurate without
  // having to repeat this on every call site.
  clone.canonicalUrl = clone.canonicalUrl ?? normalizeUrl(BASE_URL, BASE_URL);
  return clone;
}

// ── Core SEO field comparisons ─────────────────────────────────────────────────

describe('compareBlogContent — metadata', () => {
  it('passes every comparison when the live page exactly matches the approved document', () => {
    const results = compareBlogContent(
      'https://example.com/blog/sourdough',
      baseExpected,
      exactMatch(baseExpected)
    );

    const nonWarning = results.filter((r) => r.status !== 'warning');
    assert.ok(
      nonWarning.every((r) => r.status === 'passed'),
      `Expected all non-warning results to pass; got: ${JSON.stringify(nonWarning.filter((r) => r.status !== 'passed'))}`
    );
  });

  it('fails Meta Title and Meta Description when they differ', () => {
    const actual = exactMatch(baseExpected);
    actual.metaTitle       = 'A Completely Different Title';
    actual.metaDescription = 'A completely different description.';

    const results      = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const metaTitle    = results.find((r) => r.checkType === 'Meta Title');
    const metaDesc     = results.find((r) => r.checkType === 'Meta Description');

    assert.equal(metaTitle?.status,  'failed');
    assert.match(metaTitle?.message ?? '', /has changed/);
    assert.equal(metaDesc?.status, 'failed');
  });

  it('fails Blog Title (H1) and reports it as missing when the live page has no H1', () => {
    const actual = exactMatch(baseExpected);
    actual.title = undefined;

    const results  = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const h1Result = results.find((r) => r.checkType === 'Blog Title (H1)');

    assert.equal(h1Result?.status, 'failed');
    assert.match(h1Result?.message ?? '', /missing/);
  });

  it('does NOT skip Blog Title (H1) when the approved document has a title', () => {
    // Regression: H1 was previously being reported as SKIPPED even when the
    // docx contained a valid H1 value. It should only be skipped when
    // expected.title is absent.
    const results  = compareBlogContent('https://example.com/blog/sourdough', baseExpected, exactMatch(baseExpected));
    const h1Result = results.find((r) => r.checkType === 'Blog Title (H1)');

    assert.notEqual(h1Result?.status, 'skipped',
      'H1 must not be SKIPPED when the approved document provides a title.');
    assert.equal(h1Result?.status, 'passed');
  });

  it('skips Meta Description only when the approved document provides no expected value', () => {
    const expected = exactMatch(baseExpected);
    expected.metaDescription = undefined;

    const results   = compareBlogContent('https://example.com/blog/sourdough', expected, exactMatch(baseExpected));
    const metaDescResult = results.find((r) => r.checkType === 'Meta Description');

    assert.equal(metaDescResult?.status, 'skipped');
  });
});

// ── Canonical URL comparisons ───────────────────────────────────────────────────

describe('compareBlogContent — canonical URL', () => {
  it('passes when the live canonical self-references the audited URL', () => {
    const results    = compareBlogContent(BASE_URL, baseExpected, exactMatch(baseExpected));
    const canonical  = results.find((r) => r.checkType === 'Canonical URL');

    assert.equal(canonical?.status, 'passed');
  });

  it('fails when the canonical tag is missing from the live page', () => {
    const actual = exactMatch(baseExpected);
    actual.canonicalUrl = undefined;

    const results   = compareBlogContent(BASE_URL, baseExpected, actual);
    const canonical = results.find((r) => r.checkType === 'Canonical URL');

    assert.equal(canonical?.status, 'failed');
    assert.match(canonical?.message ?? '', /missing/);
  });

  it('fails when the canonical points to a different URL than the one audited', () => {
    const actual = exactMatch(baseExpected);
    actual.canonicalUrl = 'https://example.com/blog/some-other-post';

    const results   = compareBlogContent(BASE_URL, baseExpected, actual);
    const canonical = results.find((r) => r.checkType === 'Canonical URL');

    assert.equal(canonical?.status, 'failed');
    assert.match(canonical?.message ?? '', /does not match/);
  });

  it('passes against a docx "Canonical:" override instead of the audited URL', () => {
    const expected = exactMatch(baseExpected);
    expected.expectedCanonicalUrl = 'https://example.com/blog/pillar-page';

    const actual = exactMatch(baseExpected);
    actual.canonicalUrl = 'https://example.com/blog/pillar-page';

    const results   = compareBlogContent(BASE_URL, expected, actual);
    const canonical = results.find((r) => r.checkType === 'Canonical URL');

    assert.equal(canonical?.status, 'passed');
  });

  it('tolerates a tracking-parameter variant of the same canonical URL', () => {
    const actual = exactMatch(baseExpected);
    actual.canonicalUrl = `${BASE_URL}?utm_source=newsletter`;

    const results   = compareBlogContent(BASE_URL, baseExpected, actual);
    const canonical = results.find((r) => r.checkType === 'Canonical URL');

    assert.equal(canonical?.status, 'passed');
  });
});

// ── Blog URL / slug comparisons ─────────────────────────────────────────────────

describe('compareBlogContent — URL / slug', () => {
  it('passes when the live URL path matches the expected slug', () => {
    const results = compareBlogContent(BASE_URL, baseExpected, exactMatch(baseExpected));
    const slug    = results.find((r) => r.checkType === 'Blog URL / Slug');

    assert.equal(slug?.status, 'passed');
  });

  it('is skipped when the approved document specifies no expected slug', () => {
    const expected = exactMatch(baseExpected);
    expected.expectedSlug = undefined;

    const results = compareBlogContent(BASE_URL, expected, exactMatch(baseExpected));
    const slug    = results.find((r) => r.checkType === 'Blog URL / Slug');

    assert.equal(slug?.status, 'skipped');
  });

  it('fails when the live URL does not contain the expected slug', () => {
    const results = compareBlogContent(
      'https://example.com/blog/a-completely-different-post',
      baseExpected,
      exactMatch(baseExpected)
    );
    const slug = results.find((r) => r.checkType === 'Blog URL / Slug');

    assert.equal(slug?.status, 'failed');
    assert.match(slug?.message ?? '', /does not match the expected slug/);
  });

  it('accepts a full-path expected slug ("/blog/sourdough") as well as a bare slug', () => {
    const expected = exactMatch(baseExpected);
    expected.expectedSlug = '/blog/sourdough';

    const results = compareBlogContent(BASE_URL, expected, exactMatch(baseExpected));
    const slug    = results.find((r) => r.checkType === 'Blog URL / Slug');

    assert.equal(slug?.status, 'passed');
  });
});

// ── Heading comparisons ────────────────────────────────────────────────────────

describe('compareBlogContent — headings', () => {
  it('detects a missing H2 heading', () => {
    const actual = exactMatch(baseExpected);
    actual.h2Headings = ['Ingredients', 'Method']; // "Tips for Success" removed

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const missing = results.find((r) => r.expected === 'Tips for Success');

    assert.equal(missing?.status, 'failed');
    assert.match(missing?.message ?? '', /missing from the live page/);
  });

  it('detects an H2 heading that is out of order', () => {
    const actual = exactMatch(baseExpected);
    actual.h2Headings = ['Ingredients', 'Tips for Success', 'Method']; // Method/Tips swapped

    const results      = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const methodResult = results.find((r) => r.expected === 'Method');

    assert.equal(methodResult?.status, 'failed');
    assert.match(methodResult?.message ?? '', /out of order/);
  });
});

// ── Paragraph comparisons ──────────────────────────────────────────────────────

describe('compareBlogContent — paragraphs', () => {
  it('detects a missing paragraph', () => {
    const actual = exactMatch(baseExpected);
    // Remove the second paragraph
    actual.paragraphs = [baseExpected.paragraphs[0]!, baseExpected.paragraphs[2]!];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const missing = results.find((r) => r.expected === baseExpected.paragraphs[1]);

    assert.equal(missing?.status, 'failed');
    assert.match(missing?.message ?? '', /missing from the live page/);
  });

  it('detects a modified paragraph (similar content, not identical) rather than reporting it as missing', () => {
    // Uses rich content so the 3-content-word + 65% Jaccard thresholds are met.
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: [
        'The sourdough starter needs regular feeding to stay healthy and active.',
        'Mix together high-quality bread flour, filtered water, and your bubbly starter.',
        'Allow the dough to proof overnight before baking in a hot Dutch oven.'
      ]
    };
    const actual = exactMatch(richBase);
    // Minor modification: adds two words at the end
    actual.paragraphs[1] = 'Mix together high-quality bread flour, filtered water, and your bubbly active starter today.';

    const results  = compareBlogContent('https://example.com/blog/sourdough', richBase, actual);
    const modified = results.find((r) => r.expected === richBase.paragraphs[1]);

    assert.equal(modified?.status, 'failed');
    assert.match(modified?.message ?? '', /Paragraph text has changed/);
    assert.ok(modified?.diff && modified.diff.length > 0, 'A word-level diff should be attached to a modified paragraph.');
    assert.ok(modified?.diff?.some((seg) => seg.type !== 'same'), 'The diff should contain at least one non-matching segment.');
  });

  it('does not report matching paragraphs as missing due to minor punctuation or spacing differences', () => {
    // Regression: paragraph comparison must use normalised text, not raw strings.
    const actual = exactMatch(baseExpected);
    // Extra trailing space — should still match
    actual.paragraphs[0] = baseExpected.paragraphs[0] + '  ';

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const first   = results.find((r) => r.expected === baseExpected.paragraphs[0]);

    assert.equal(first?.status, 'passed',
      'A paragraph differing only in trailing whitespace must be PASSED, not FAILED.');
  });

  it('detects paragraph order differences', () => {
    const actual = exactMatch(baseExpected);
    // Swap first and second paragraph
    actual.paragraphs = [
      baseExpected.paragraphs[1]!,
      baseExpected.paragraphs[0]!,
      baseExpected.paragraphs[2]!
    ];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const first   = results.find((r) => r.expected === baseExpected.paragraphs[0]);

    assert.equal(first?.status, 'failed');
    assert.match(first?.message ?? '', /out of order/);
  });
});

// ── Paragraph typography normalization + word-level diff ───────────────────────

describe('compareBlogContent — paragraph typography & diff', () => {
  it('PASSES when the only difference is curly/smart quotes (e.g. WordPress wptexturize)', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ["The city's growth story reflects Mokila's emergence as a destination."]
    };
    const actual = exactMatch(richBase);
    // Curly apostrophes, as a CMS would render them — same content, different characters.
    actual.paragraphs[0] = 'The city’s growth story reflects Mokila’s emergence as a destination.';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const para     = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(para?.status, 'passed',
      'A paragraph differing only by straight vs curly quotes must PASS.');
  });

  it('PASSES when the only difference is extra internal whitespace or CRLF line endings', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['This paragraph has multiple internal words for testing whitespace handling properly.']
    };
    const actual = exactMatch(richBase);
    actual.paragraphs[0] = 'This paragraph  has\r\nmultiple   internal words for testing whitespace handling properly.';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const para     = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(para?.status, 'passed',
      'A paragraph differing only by whitespace/line-ending noise must PASS.');
  });

  it('FAILS a genuine one-word change and attaches a diff with a "changed" segment', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['The quick brown fox jumps over the lazy dog near the riverbank.']
    };
    const actual = exactMatch(richBase);
    actual.paragraphs[0] = 'The quick brown fox jumps over the sleepy dog near the riverbank.';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const para     = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(para?.status, 'failed');
    const changed = para?.diff?.find((seg) => seg.type === 'changed');
    assert.ok(changed, 'Expected a "changed" diff segment for the substituted word.');
    assert.equal(changed?.expected, 'lazy');
    assert.equal(changed?.actual, 'sleepy');
    assert.match(para?.message ?? '', /word.*changed/i);
  });

  it('FAILS a missing word and attaches a diff with a "removed" segment', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['The quick brown fox jumps over the lazy sleeping dog near the riverbank.']
    };
    const actual = exactMatch(richBase);
    actual.paragraphs[0] = 'The quick brown fox jumps over the lazy dog near the riverbank.';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const para     = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(para?.status, 'failed');
    const removed = para?.diff?.find((seg) => seg.type === 'removed');
    assert.ok(removed, 'Expected a "removed" diff segment for the dropped word.');
    assert.equal(removed?.expected, 'sleeping');
  });

  it('FAILS an extra word and attaches a diff with an "added" segment', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['The quick brown fox jumps over the lazy dog near the riverbank.']
    };
    const actual = exactMatch(richBase);
    actual.paragraphs[0] = 'The quick brown fox jumps swiftly over the lazy dog near the riverbank.';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const para     = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(para?.status, 'failed');
    const added = para?.diff?.find((seg) => seg.type === 'added');
    assert.ok(added, 'Expected an "added" diff segment for the inserted word.');
    assert.equal(added?.actual, 'swiftly');
  });
});

// ── Hyperlink comparisons ──────────────────────────────────────────────────────

describe('compareBlogContent — hyperlinks', () => {
  it('passes when every expected hyperlink is present with matching text and URL', () => {
    const results  = compareBlogContent('https://example.com/blog/sourdough', baseExpected, exactMatch(baseExpected));
    const linkResults = results.filter((r) => r.checkType.startsWith('Hyperlink:'));

    assert.ok(linkResults.every((r) => r.status === 'passed'));
  });

  it('fails when an expected hyperlink is completely absent from the live page', () => {
    const actual = exactMatch(baseExpected);
    actual.links = [makeLink('sourdough starter guide', 'https://example.com/guides/starter')];
    // "Dutch oven recommendations" link removed

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const missing = results.find((r) => r.expected?.includes('Dutch oven recommendations'));

    assert.equal(missing?.status, 'failed');
    assert.match(missing?.message ?? '', /missing from the live page/);
  });

  it('fails when the anchor text matches but the destination URL differs', () => {
    const actual = exactMatch(baseExpected);
    actual.links = [
      makeLink('sourdough starter guide', 'https://example.com/guides/starter'),
      makeLink('Dutch oven recommendations', 'https://example.com/tools/WRONG-URL')
    ];

    const results     = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const urlMismatch = results.find(
      (r) => r.checkType.startsWith('Hyperlink:') && r.expected?.includes('Dutch oven recommendations')
    );

    assert.equal(urlMismatch?.status, 'failed');
    assert.match(urlMismatch?.message ?? '', /destination URL differs/);
  });

  it('fails when the URL matches but the anchor text differs', () => {
    const actual = exactMatch(baseExpected);
    actual.links = [
      makeLink('sourdough starter guide', 'https://example.com/guides/starter'),
      makeLink('Dutch oven buying guide', 'https://example.com/tools/dutch-oven') // text changed
    ];

    const results   = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const textDiff  = results.find(
      (r) => r.checkType.startsWith('Hyperlink:') && r.expected?.includes('Dutch oven')
    );

    assert.equal(textDiff?.status, 'failed');
    assert.match(textDiff?.message ?? '', /anchor text differs/);
  });

  it('passes when a tracking-parameter variant of the same URL is present on the live page', () => {
    // UTM parameters should be stripped before comparison so the same
    // destination URL with or without tracking params is considered equal.
    const actual = exactMatch(baseExpected);
    actual.links = [
      makeLink('sourdough starter guide',
               'https://example.com/guides/starter?utm_source=blog&utm_medium=link'),
      makeLink('Dutch oven recommendations',
               'https://example.com/tools/dutch-oven?fbclid=abc123')
    ];

    const results     = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const linkResults = results.filter((r) => r.checkType.startsWith('Hyperlink:'));

    assert.ok(
      linkResults.every((r) => r.status === 'passed'),
      `Tracking-param variants should PASS. Got: ${JSON.stringify(linkResults)}`
    );
  });

  it('ignores extra links on the live page that are not in the approved document', () => {
    const actual = exactMatch(baseExpected);
    // Add a CMS-generated "related posts" link not in the docx
    actual.links.push(makeLink('Related: 5 Bread Recipes', 'https://example.com/bread-recipes'));

    const results     = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const linkResults = results.filter((r) => r.checkType.startsWith('Hyperlink:'));

    assert.ok(
      linkResults.every((r) => r.status === 'passed'),
      'Extra links on the live page must not cause failures.'
    );
  });
});

// ── Bold formatting comparisons ────────────────────────────────────────────────

describe('compareBlogContent — bold formatting', () => {
  it('passes when every expected bold phrase is present on the live page', () => {
    const results     = compareBlogContent('https://example.com/blog/sourdough', baseExpected, exactMatch(baseExpected));
    const boldResults = results.filter((r) => r.checkType.startsWith('Bold:') && !r.checkType.startsWith('Bold (extra)'));

    assert.ok(boldResults.every((r) => r.status === 'passed'));
  });

  it('fails when an expected bold phrase is missing from the live page', () => {
    const actual = exactMatch(baseExpected);
    actual.boldPhrases = ['sourdough starter']; // "Dutch oven" bold removed

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const missing = results.find(
      (r) => r.checkType.startsWith('Bold:') && r.expected === 'Dutch oven'
    );

    assert.equal(missing?.status, 'failed');
    assert.match(missing?.message ?? '', /missing from the live page/);
  });

  it('produces a WARNING (not FAIL) for extra bold phrases present on the live page but not in the approved document', () => {
    const actual = exactMatch(baseExpected);
    actual.boldPhrases = [...baseExpected.boldPhrases, 'unexpected bold phrase'];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const extra   = results.find(
      (r) => r.checkType.startsWith('Bold (extra)') && r.actual === 'unexpected bold phrase'
    );

    assert.equal(extra?.status, 'warning', 'Extra bold must produce a WARNING, not a FAIL.');
  });

  it('does not warn about extra bold when actual bold matches expected exactly', () => {
    const results    = compareBlogContent('https://example.com/blog/sourdough', baseExpected, exactMatch(baseExpected));
    const extraBold  = results.filter((r) => r.checkType.startsWith('Bold (extra)'));

    assert.equal(extraBold.length, 0,
      'No extra-bold warnings should appear when actual bold matches expected exactly.');
  });
});
