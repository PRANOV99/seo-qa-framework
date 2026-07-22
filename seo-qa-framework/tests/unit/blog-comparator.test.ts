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
  h4Headings:      [],
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

  it('PASSES Blog Title (H1) when the only difference is a curly vs straight apostrophe', () => {
    const expected = exactMatch(baseExpected);
    expected.title = "Baker's Guide to Sourdough Bread";

    const actual = exactMatch(baseExpected);
    actual.title = 'Baker’s Guide to Sourdough Bread';

    const results  = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
    const h1Result = results.find((r) => r.checkType === 'Blog Title (H1)');

    assert.equal(h1Result?.status, 'passed');
  });

  it('PASSES Meta Description when the only difference is a trailing period', () => {
    const expected = exactMatch(baseExpected);
    expected.metaDescription = 'Explore why luxury 4 BHK villas are in high demand — discover our ready-to-move homes.';

    const actual = exactMatch(baseExpected);
    actual.metaDescription = 'Explore why luxury 4 BHK villas are in high demand — discover our ready-to-move homes';

    const results = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
    const metaDesc = results.find((r) => r.checkType === 'Meta Description');

    assert.equal(metaDesc?.status, 'passed',
      `Expected trailing-period-only difference to PASS. Got: ${JSON.stringify(metaDesc)}`);
  });

  it('PASSES Meta Title when the only difference is trailing punctuation, for each punctuation mark', () => {
    for (const mark of ['.', ',', '!', '?', ';', ':']) {
      const expected = exactMatch(baseExpected);
      expected.metaTitle = `How to Bake Sourdough Bread${mark}`;

      const actual = exactMatch(baseExpected);
      actual.metaTitle = 'How to Bake Sourdough Bread';

      const results = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
      const metaTitle = results.find((r) => r.checkType === 'Meta Title');

      assert.equal(metaTitle?.status, 'passed', `Trailing "${mark}" should be ignored. Got: ${JSON.stringify(metaTitle)}`);
    }
  });

  it('still FAILS Meta Description for a genuine wording change, even when punctuation also differs', () => {
    const expected = exactMatch(baseExpected);
    expected.metaDescription = 'Explore why luxury 4 BHK villas are in high demand.';

    const actual = exactMatch(baseExpected);
    actual.metaDescription = 'Explore why premium 3 BHK apartments are in high demand';

    const results = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
    const metaDesc = results.find((r) => r.checkType === 'Meta Description');

    assert.equal(metaDesc?.status, 'failed');
    assert.match(metaDesc?.message ?? '', /has changed/);
  });

  it('PASSES Meta Description when the docx uses a literal ellipsis character where the live page has none', () => {
    const expected = exactMatch(baseExpected);
    expected.metaDescription = 'Explore why luxury 4 BHK villas are in high demand…';

    const actual = exactMatch(baseExpected);
    actual.metaDescription = 'Explore why luxury 4 BHK villas are in high demand';

    const results = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
    const metaDesc = results.find((r) => r.checkType === 'Meta Description');

    assert.equal(metaDesc?.status, 'passed', `Got: ${JSON.stringify(metaDesc)}`);
  });

  it('keeps working alongside quote normalization and whitespace normalization together', () => {
    const expected = exactMatch(baseExpected);
    expected.metaTitle = "Baker's Guide to Sourdough Bread.";

    const actual = exactMatch(baseExpected);
    // Curly apostrophe (quote normalization) + extra internal whitespace
    // (whitespace normalization) + missing trailing period (this fix), all at once.
    actual.metaTitle = 'Baker’s   Guide to Sourdough Bread';

    const results = compareBlogContent('https://example.com/blog/sourdough', expected, actual);
    const metaTitle = results.find((r) => r.checkType === 'Meta Title');

    assert.equal(metaTitle?.status, 'passed', `Got: ${JSON.stringify(metaTitle)}`);
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

  it('detects an H2 heading that is out of order — as a WARNING, since the heading genuinely exists', () => {
    const actual = exactMatch(baseExpected);
    actual.h2Headings = ['Ingredients', 'Tips for Success', 'Method']; // Method/Tips swapped

    const results      = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const methodResult = results.find((r) => r.expected === 'Method');

    assert.equal(methodResult?.status, 'warning',
      'A heading that exists but is out of order must be a WARNING, not a FAIL.');
    assert.match(methodResult?.message ?? '', /out of order/);
  });

  it('PASSES an H2 when the live page renders a curly apostrophe where the docx has a straight one', () => {
    // Regression: reported bug — a live heading like
    // "Why Sri Sreenivasa Infra’s Track Record Matters Here" (curly ’, often
    // from a decoded &#8217; entity or CMS "smart quotes" rendering) was
    // reported as MISSING against a docx heading using a straight apostrophe.
    const expected: BlogContent = {
      ...baseExpected,
      h2Headings: ["Why Sri Sreenivasa Infra's Track Record Matters Here"]
    };
    const actual = exactMatch(expected);
    actual.h2Headings = ['Why Sri Sreenivasa Infra’s Track Record Matters Here'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h2 = results.find((r) => r.checkType === 'H2 #1');

    assert.equal(h2?.status, 'passed',
      `Expected the curly-quote heading to match. Got: ${JSON.stringify(h2)}`);
  });

  it('PASSES an H3 with the same curly-vs-straight-apostrophe difference', () => {
    const expected: BlogContent = {
      ...baseExpected,
      h3Headings: ["Reader's Guide to the Recipe"]
    };
    const actual = exactMatch(expected);
    actual.h3Headings = ['Reader’s Guide to the Recipe'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h3 = results.find((r) => r.checkType === 'H3 #1');

    assert.equal(h3?.status, 'passed');
  });

  it('compares H4 headings the same way as H2/H3 (e.g. FAQ questions)', () => {
    const expected: BlogContent = {
      ...baseExpected,
      h4Headings: ['Is financing available?', 'What is the possession timeline?']
    };
    const actual = exactMatch(expected);
    actual.h4Headings = ['Is financing available?']; // second FAQ question missing from the live page

    const results = compareBlogContent(BASE_URL, expected, actual);
    const q1 = results.find((r) => r.checkType === 'H4 #1');
    const q2 = results.find((r) => r.checkType === 'H4 #2');

    assert.equal(q1?.status, 'passed');
    assert.equal(q2?.status, 'failed');
    assert.match(q2?.message ?? '', /missing from the live page/);
  });

  it('still FAILS an H2 with a genuine wording difference, not just a quote-style one', () => {
    const expected: BlogContent = {
      ...baseExpected,
      h2Headings: ["Why Sri Sreenivasa Infra's Track Record Matters Here"]
    };
    const actual = exactMatch(expected);
    actual.h2Headings = ['A Completely Unrelated Heading'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h2 = results.find((r) => r.checkType === 'H2 #1');

    assert.equal(h2?.status, 'failed');
    assert.match(h2?.message ?? '', /missing from the live page/);
  });

  it('PASSES a heading when the only difference is trailing punctuation (e.g. a theme adding a colon)', () => {
    const expected: BlogContent = { ...baseExpected, h2Headings: ['Frequently Asked Questions'] };
    const actual = exactMatch(expected);
    actual.h2Headings = ['Frequently Asked Questions:'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h2 = results.find((r) => r.checkType === 'H2 #1');

    assert.equal(h2?.status, 'passed', `Got: ${JSON.stringify(h2)}`);
  });

  it('does NOT report Missing for a heading that exists but is reported at a much later position — reports it as an "out of order" WARNING instead', () => {
    // Mirrors the reported example: expected position 1, found position 5.
    const expected: BlogContent = { ...baseExpected, h2Headings: ['Overview', 'Pricing', 'Amenities', 'Location'] };
    const actual = exactMatch(expected);
    // Four unrelated CMS-injected headings pushed in front of "Overview".
    actual.h2Headings = ['Related Posts', 'Popular This Week', 'Editor Picks', 'Trending Now', 'Overview', 'Pricing', 'Amenities', 'Location'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const overview = results.find((r) => r.checkType === 'H2 #1');
    const pricing  = results.find((r) => r.checkType === 'H2 #2');
    const amenities = results.find((r) => r.checkType === 'H2 #3');
    const location = results.find((r) => r.checkType === 'H2 #4');

    // All four are genuinely present, just shifted by a constant offset —
    // none of them should be Missing, and none should cascade into failures.
    assert.notEqual(overview?.status, 'failed');
    assert.equal(overview?.status, 'passed', `Got: ${JSON.stringify(overview)}`);
    assert.equal(pricing?.status, 'passed', `Got: ${JSON.stringify(pricing)}`);
    assert.equal(amenities?.status, 'passed', `Got: ${JSON.stringify(amenities)}`);
    assert.equal(location?.status, 'passed', `Got: ${JSON.stringify(location)}`);
  });

  it('reports a genuinely reordered heading as an "out of order" WARNING without cascading to the others', () => {
    const expected: BlogContent = { ...baseExpected, h2Headings: ['Overview', 'Pricing', 'Amenities', 'Location'] };
    const actual = exactMatch(expected);
    // "Overview" moved to the very end — Pricing/Amenities/Location stay in
    // their correct relative order to each other.
    actual.h2Headings = ['Pricing', 'Amenities', 'Location', 'Overview'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const overview  = results.find((r) => r.checkType === 'H2 #1');
    const pricing   = results.find((r) => r.checkType === 'H2 #2');
    const amenities = results.find((r) => r.checkType === 'H2 #3');
    const location  = results.find((r) => r.checkType === 'H2 #4');

    assert.equal(pricing?.status, 'passed', `Got: ${JSON.stringify(pricing)}`);
    assert.equal(amenities?.status, 'passed', `Got: ${JSON.stringify(amenities)}`);
    assert.equal(location?.status, 'passed', `Got: ${JSON.stringify(location)}`);
    assert.equal(overview?.status, 'warning', 'Only the genuinely-moved heading should be flagged, as a WARNING.');
    assert.match(overview?.message ?? '', /out of order/);
  });

  it('only FAILS a heading when its text truly does not exist anywhere on the live page', () => {
    const expected: BlogContent = { ...baseExpected, h2Headings: ['Overview', 'Pricing'] };
    const actual = exactMatch(expected);
    actual.h2Headings = ['Pricing']; // "Overview" genuinely removed, not just shifted

    const results = compareBlogContent(BASE_URL, expected, actual);
    const overview = results.find((r) => r.checkType === 'H2 #1');

    assert.equal(overview?.status, 'failed');
    assert.match(overview?.message ?? '', /missing from the live page/);
  });

  it('reports "Frequently Asked Questions" as a WARNING (not Missing) when an accordion widget wraps it in extra decoration', () => {
    // Reported bug: an FAQ section heading rendered by an accordion/page-builder
    // widget with a leading toggle icon that Playwright's innerText() picks up
    // as real text — the heading itself is genuinely present.
    const expected: BlogContent = { ...baseExpected, h2Headings: ['Frequently Asked Questions'] };
    const actual = exactMatch(expected);
    actual.h2Headings = ['+ Frequently Asked Questions'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h2 = results.find((r) => r.checkType === 'H2 #1');

    assert.notEqual(h2?.status, 'failed', `Must never report Missing when the heading text exists. Got: ${JSON.stringify(h2)}`);
    assert.equal(h2?.status, 'warning', `Got: ${JSON.stringify(h2)}`);
  });

  it('reports an H4 FAQ question as a WARNING when trailing accordion decoration (e.g. a chevron/expand indicator) is appended', () => {
    const expected: BlogContent = { ...baseExpected, h4Headings: ['What is the possession timeline?'] };
    const actual = exactMatch(expected);
    actual.h4Headings = ['What is the possession timeline? ▼'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h4 = results.find((r) => r.checkType === 'H4 #1');

    assert.equal(h4?.status, 'warning', `Got: ${JSON.stringify(h4)}`);
  });

  it('still FAILS when a short heading only coincidentally overlaps with unrelated live text (containment guard)', () => {
    const expected: BlogContent = { ...baseExpected, h2Headings: ['FAQ'] };
    const actual = exactMatch(expected);
    actual.h2Headings = ['A Completely Unrelated Section About Something Else Entirely'];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const h2 = results.find((r) => r.checkType === 'H2 #1');

    assert.equal(h2?.status, 'failed', `Got: ${JSON.stringify(h2)}`);
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

  it('PASSES a paragraph when the only difference is a trailing period (this exact fix)', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['This section describes ready-to-move homes in the new development phase available now.']
    };
    const actual = exactMatch(richBase);
    actual.paragraphs[0] = 'This section describes ready-to-move homes in the new development phase available now';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const first = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(first?.status, 'passed', `Got: ${JSON.stringify(first)}`);
  });

  it('still reports a genuine wording change as Modified even when trailing punctuation also differs, without showing the punctuation itself as a spurious diff', () => {
    const richBase: BlogContent = {
      ...baseExpected,
      paragraphs: ['This section describes ready-to-move homes in the new development phase available now.']
    };
    const actual = exactMatch(richBase);
    // Only "homes" -> "villas" is a real change; the trailing period is
    // simply absent here, same as the "PASSES ... trailing period" test above.
    actual.paragraphs[0] = 'This section describes ready-to-move villas in the new development phase available now';

    const results = compareBlogContent(BASE_URL, richBase, actual);
    const first = results.find((r) => r.expected === richBase.paragraphs[0]);

    assert.equal(first?.status, 'failed');
    const changed = first?.diff?.filter((seg) => seg.type === 'changed') ?? [];
    assert.deepEqual(changed, [{ type: 'changed', expected: 'homes', actual: 'villas' }],
      `Expected exactly one real word change and no punctuation-driven noise. Got: ${JSON.stringify(first?.diff)}`);
  });

  it('detects paragraph order differences — as a WARNING ("moved"), since the paragraph is unchanged', () => {
    const actual = exactMatch(baseExpected);
    // Swap first and second paragraph
    actual.paragraphs = [
      baseExpected.paragraphs[1]!,
      baseExpected.paragraphs[0]!,
      baseExpected.paragraphs[2]!
    ];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const first   = results.find((r) => r.expected === baseExpected.paragraphs[0]);

    assert.equal(first?.status, 'warning',
      'A paragraph that is unchanged but moved must be a WARNING, not a FAIL.');
    assert.match(first?.message ?? '', /moved/);
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

// ── Paragraph order resynchronization ───────────────────────────────────────────
//
// Regression coverage: the comparator used to require an expected
// paragraph's live-page position to equal its position in the approved
// document, so a single inserted/removed paragraph shifted every later
// paragraph's index and cascaded into dozens of false "out of order"
// failures. It now matches via the longest common subsequence of exact
// matches, so insertions/removals elsewhere don't affect paragraphs whose
// relative order is otherwise intact.

describe('compareBlogContent — paragraph order resynchronization', () => {
  // Rich, distinct paragraphs so the ≥3-content-word / 65%-Jaccard
  // similarity fallback never accidentally kicks in for these order tests.
  const FOUR_PARAGRAPHS = [
    'The sourdough starter needs regular feeding to stay healthy and active every single day.',
    'Combine flour, water, salt, and starter to form a shaggy dough before the first rest.',
    'Allow the dough to proof overnight before baking in a hot Dutch oven the next morning.',
    'Slice the finished loaf only once it has cooled completely on a wire rack.'
  ];

  function withParagraphs(paragraphs: string[]): BlogContent {
    return { ...baseExpected, paragraphs };
  }

  it('does NOT cascade a single inserted paragraph into "out of order" failures for everything after it', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);
    // Insert an unrelated CMS-injected paragraph at the very front.
    actual.paragraphs = [
      'This post was updated in 2026 to reflect the latest pricing.',
      ...FOUR_PARAGRAPHS
    ];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const paragraphResults = FOUR_PARAGRAPHS.map((p) => results.find((r) => r.expected === p));

    assert.ok(paragraphResults.every((r) => r?.status === 'passed'),
      `A leading insertion must not cascade into false failures. Got: ${JSON.stringify(paragraphResults)}`);
  });

  it('does NOT cascade a single inserted paragraph in the MIDDLE of the sequence', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);
    actual.paragraphs = [
      FOUR_PARAGRAPHS[0]!,
      FOUR_PARAGRAPHS[1]!,
      'An unrelated related-posts teaser paragraph injected by the CMS template.',
      FOUR_PARAGRAPHS[2]!,
      FOUR_PARAGRAPHS[3]!
    ];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const paragraphResults = FOUR_PARAGRAPHS.map((p) => results.find((r) => r.expected === p));

    assert.ok(paragraphResults.every((r) => r?.status === 'passed'),
      `A middle insertion must not cascade into false failures. Got: ${JSON.stringify(paragraphResults)}`);
  });

  it('does NOT cascade a single removed paragraph into failures for the paragraphs that follow it', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);
    // Second paragraph removed entirely from the live page.
    actual.paragraphs = [FOUR_PARAGRAPHS[0]!, FOUR_PARAGRAPHS[2]!, FOUR_PARAGRAPHS[3]!];

    const results = compareBlogContent(BASE_URL, expected, actual);

    const first  = results.find((r) => r.expected === FOUR_PARAGRAPHS[0]);
    const second = results.find((r) => r.expected === FOUR_PARAGRAPHS[1]);
    const third  = results.find((r) => r.expected === FOUR_PARAGRAPHS[2]);
    const fourth = results.find((r) => r.expected === FOUR_PARAGRAPHS[3]);

    assert.equal(first?.status, 'passed');
    assert.equal(second?.status, 'failed');
    assert.match(second?.message ?? '', /missing from the live page/);
    // The two paragraphs AFTER the removed one must still pass, not cascade.
    assert.equal(third?.status, 'passed', `Expected paragraph 3 to still pass. Got: ${JSON.stringify(third)}`);
    assert.equal(fourth?.status, 'passed', `Expected paragraph 4 to still pass. Got: ${JSON.stringify(fourth)}`);
  });

  it('does NOT cascade when a paragraph is skipped/re-ordered elsewhere — only the genuinely displaced one fails', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);
    // Move the FIRST paragraph to the very end — paragraphs 2-4 stay in
    // their correct relative order to each other.
    actual.paragraphs = [FOUR_PARAGRAPHS[1]!, FOUR_PARAGRAPHS[2]!, FOUR_PARAGRAPHS[3]!, FOUR_PARAGRAPHS[0]!];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const second = results.find((r) => r.expected === FOUR_PARAGRAPHS[1]);
    const third  = results.find((r) => r.expected === FOUR_PARAGRAPHS[2]);
    const fourth = results.find((r) => r.expected === FOUR_PARAGRAPHS[3]);
    const first  = results.find((r) => r.expected === FOUR_PARAGRAPHS[0]);

    assert.equal(second?.status, 'passed', `Got: ${JSON.stringify(second)}`);
    assert.equal(third?.status, 'passed', `Got: ${JSON.stringify(third)}`);
    assert.equal(fourth?.status, 'passed', `Got: ${JSON.stringify(fourth)}`);
    assert.equal(first?.status, 'warning',
      'Only the genuinely-moved paragraph should be flagged, and as a WARNING (it is unchanged, just moved).');
    assert.match(first?.message ?? '', /moved/);
  });

  it('still detects genuine reordering (an adjacent swap) rather than treating everything as fine', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);
    // Swap paragraphs 1 and 2.
    actual.paragraphs = [FOUR_PARAGRAPHS[1]!, FOUR_PARAGRAPHS[0]!, FOUR_PARAGRAPHS[2]!, FOUR_PARAGRAPHS[3]!];

    const results = compareBlogContent(BASE_URL, expected, actual);
    const flagged = results.filter((r) => FOUR_PARAGRAPHS.includes(r.expected ?? '') && r.status !== 'passed');

    assert.equal(flagged.length, 1,
      `Exactly one paragraph should be flagged for a simple adjacent swap. Got: ${JSON.stringify(flagged)}`);
    assert.equal(flagged[0]?.status, 'warning');
    assert.match(flagged[0]?.message ?? '', /moved/);
  });

  it('passes every paragraph when nothing changed at all (baseline sanity check)', () => {
    const expected = withParagraphs(FOUR_PARAGRAPHS);
    const actual = exactMatch(expected);

    const results = compareBlogContent(BASE_URL, expected, actual);
    const paragraphResults = FOUR_PARAGRAPHS.map((p) => results.find((r) => r.expected === p));

    assert.ok(paragraphResults.every((r) => r?.status === 'passed'));
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

  it('PASSES when the live page has multiple links to the same URL with different anchor text, as long as the expected pair exists somewhere', () => {
    // Regression: the comparator used to key live links by URL only, so
    // whichever link to a shared destination happened to be inserted last
    // into that lookup would silently hide the others — causing a false
    // "anchor text differs" failure even though the expected pair was
    // genuinely present on the page.
    const actual = exactMatch(baseExpected);
    actual.links = [
      // Decoy link to the same URL, but different (also legitimate) anchor text — inserted BEFORE the real match.
      makeLink('Dutch oven buying guide', 'https://example.com/tools/dutch-oven'),
      // The actual expected pair, present elsewhere on the page.
      makeLink('Dutch oven recommendations', 'https://example.com/tools/dutch-oven'),
      makeLink('sourdough starter guide', 'https://example.com/guides/starter')
    ];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const linkResults = results.filter((r) => r.checkType.startsWith('Hyperlink:'));

    assert.ok(
      linkResults.every((r) => r.status === 'passed'),
      `Expected all hyperlinks to pass when the exact (text, URL) pair exists among several same-URL links. Got: ${JSON.stringify(linkResults)}`
    );
  });

  it('PASSES regardless of how many other links share the same destination URL, checking every candidate not just the first', () => {
    const actual = exactMatch(baseExpected);
    actual.links = [
      makeLink('some other label', 'https://example.com/tools/dutch-oven'),
      makeLink('another label entirely', 'https://example.com/tools/dutch-oven'),
      makeLink('yet another decoy', 'https://example.com/tools/dutch-oven'),
      makeLink('Dutch oven recommendations', 'https://example.com/tools/dutch-oven'),
      makeLink('sourdough starter guide', 'https://example.com/guides/starter')
    ];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const dutchOven = results.find((r) => r.expected?.includes('Dutch oven recommendations'));

    assert.equal(dutchOven?.status, 'passed');
  });

  it('still FAILS with an anchor-text-mismatch message when no live link anywhere has the expected (text, URL) pair', () => {
    const actual = exactMatch(baseExpected);
    actual.links = [
      // Same URL, but no live link anywhere uses the exact expected anchor text.
      makeLink('completely different label', 'https://example.com/tools/dutch-oven'),
      makeLink('sourdough starter guide', 'https://example.com/guides/starter')
    ];

    const results = compareBlogContent('https://example.com/blog/sourdough', baseExpected, actual);
    const dutchOven = results.find((r) => r.expected?.includes('Dutch oven recommendations'));

    assert.equal(dutchOven?.status, 'failed');
    assert.match(dutchOven?.message ?? '', /anchor text differs/);
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

  it('PASSES a bold phrase that is really a whole bolded heading, even though the live page has no literal <strong>/<b> for it', () => {
    // Reported bug: a docx author bolded an entire Heading-styled paragraph
    // (e.g. bolding all of "Frequently Asked Questions"), so the docx parser
    // captured that heading's full text as a bold phrase in addition to the
    // heading itself. Live pages render heading text bold via heading
    // styling, not a literal <strong>/<b> tag, so the bold check must fall
    // back to the live page's heading text (reusing the same normalized text
    // already extracted for the heading comparison) instead of failing.
    const expected: BlogContent = {
      ...baseExpected,
      h2Headings: ['Frequently Asked Questions'],
      boldPhrases: [...baseExpected.boldPhrases, 'Frequently Asked Questions']
    };
    const actual = exactMatch(expected);
    actual.h2Headings = ['Frequently Asked Questions']; // present as a heading
    actual.boldPhrases = baseExpected.boldPhrases;       // but NOT wrapped in a literal <strong>/<b>

    const results = compareBlogContent(BASE_URL, expected, actual);
    const boldFaq = results.find((r) => r.checkType === 'Bold: "Frequently Asked Questions"');

    assert.equal(boldFaq?.status, 'passed', `Got: ${JSON.stringify(boldFaq)}`);
  });

  it('still FAILS a bold phrase that matches neither live bold text nor any live heading', () => {
    const expected: BlogContent = {
      ...baseExpected,
      boldPhrases: [...baseExpected.boldPhrases, 'Limited Time Offer']
    };
    const actual = exactMatch(expected);
    actual.boldPhrases = baseExpected.boldPhrases; // "Limited Time Offer" genuinely absent, not a heading either

    const results = compareBlogContent(BASE_URL, expected, actual);
    const bold = results.find((r) => r.checkType === 'Bold: "Limited Time Offer"');

    assert.equal(bold?.status, 'failed', `Got: ${JSON.stringify(bold)}`);
    assert.match(bold?.message ?? '', /missing from the live page/);
  });
});
