import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { parseBlogDocx, htmlToText, decodeHtmlEntities, isDividerOnly } from '../../src/blog/docx-blog-parser.js';

describe('parseBlogDocx', () => {
  it('extracts title (H1), H2s, H3s, body paragraphs, labeled Meta Title/Description paragraphs, hyperlinks, and bold phrases', async () => {
    const docxPath = await writeBlogDocx('labeled-fields.docx', [
      paragraph('Meta Title: How to Bake Sourdough | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home.'),
      heading(1, 'How to Bake Sourdough Bread'),
      paragraph('This is the introduction paragraph.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.'),
      heading(3, 'Starter'),
      paragraph('Keep your starter fed daily.'),
      heading(2, 'Method'),
      paragraph('Mix, knead, proof, and bake.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.title, 'How to Bake Sourdough Bread');
    assert.equal(content.metaTitle, 'How to Bake Sourdough | Example Blog');
    assert.equal(content.metaDescription, 'Learn how to bake sourdough bread at home.');
    assert.deepEqual(content.h2Headings, ['Ingredients', 'Method']);
    assert.deepEqual(content.h3Headings, ['Starter']);
    assert.deepEqual(content.paragraphs, [
      'This is the introduction paragraph.',
      'Flour, water, salt, and a starter.',
      'Keep your starter fed daily.',
      'Mix, knead, proof, and bake.'
    ]);
    // No links or bold in this fixture
    assert.deepEqual(content.links, []);
    assert.deepEqual(content.boldPhrases, []);
  });

  it('extracts Meta Title/Description/H1 from a 2-column content-brief table', async () => {
    const docxPath = await writeBlogDocx('table-fields.docx', [
      table([
        ['Meta Title', 'Table-Based Title | Example'],
        ['Meta Description', 'Table-based description text.'],
        ['H1', 'Table-Based Blog Title']
      ]),
      paragraph('This is the only body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.metaTitle, 'Table-Based Title | Example');
    assert.equal(content.metaDescription, 'Table-based description text.');
    assert.equal(content.title, 'Table-Based Blog Title');
    assert.deepEqual(content.paragraphs, ['This is the only body paragraph.']);
  });

  it('leaves metaTitle/metaDescription undefined when no labeled field is present in the document', async () => {
    const docxPath = await writeBlogDocx('no-labels.docx', [
      heading(1, 'A Blog Post With No Metadata Fields'),
      paragraph('Just a regular paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.metaTitle, undefined);
    assert.equal(content.metaDescription, undefined);
    assert.equal(content.title, 'A Blog Post With No Metadata Fields');
  });

  it('falls back to an unlabeled first paragraph as the title when no "Title:"/"H1:" label or real Heading-1 style exists', async () => {
    // Regression: a real-world content brief typed the blog title as the
    // very first line with no label and no Word Heading-1 style at all —
    // trusting a reader to infer it from position. Previously this left
    // content.title undefined (H1 check silently skipped) and the title
    // text sat in paragraphs[], always failing as "missing" since it
    // renders as a heading on the live page, never as a body paragraph.
    const docxPath = await writeBlogDocx('unlabeled-title-first-line.docx', [
      paragraph('Benefits of Smart Farming Techniques in Modern Farmlands'),
      paragraph('There was a time when farming felt simple to imagine.'),
      heading(2, 'The Land Feels More Thoughtful Now'),
      paragraph('One thing that stands out is how intentional everything feels.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.title, 'Benefits of Smart Farming Techniques in Modern Farmlands');
    assert.deepEqual(content.paragraphs, [
      'There was a time when farming felt simple to imagine.',
      'One thing that stands out is how intentional everything feels.'
    ], 'The claimed title line must not remain in paragraphs[].');
  });

  it('does NOT use the unlabeled-first-paragraph fallback when a real Word Heading-1 style already exists', async () => {
    const docxPath = await writeBlogDocx('unlabeled-first-line-with-real-h1.docx', [
      paragraph('An introductory line before the real heading.'),
      heading(1, 'The Real Title'),
      paragraph('The real first body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.title, 'The Real Title');
    assert.deepEqual(content.paragraphs, [
      'An introductory line before the real heading.',
      'The real first body paragraph.'
    ], 'A genuine intro paragraph must not be claimed as the title when a real H1 already exists.');
  });

  it('does NOT use the unlabeled-first-paragraph fallback when a "Title:" label already exists', async () => {
    const docxPath = await writeBlogDocx('unlabeled-first-line-with-title-label.docx', [
      paragraph('An introductory line before the label.'),
      paragraph('Title: The Labeled Title'),
      paragraph('The real first body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.title, 'The Labeled Title');
    assert.deepEqual(content.paragraphs, [
      'An introductory line before the label.',
      'The real first body paragraph.'
    ]);
  });

  it('strips metadata-only lines (SEO Slug, dividers) so they never appear in paragraphs[]', async () => {
    const docxPath = await writeBlogDocx('metadata-lines.docx', [
      paragraph('Meta Title: My Post | Site'),
      paragraph('SEO Slug: my-post-slug'),
      paragraph('Category: Health'),
      paragraph('-----'),
      heading(1, 'My Post'),
      paragraph('The real first article paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The real first article paragraph.'],
      'Metadata-only paragraphs must not appear in paragraphs[].');
  });

  it('ignores decorative divider lines of any length, not just short ones', async () => {
    // Regression: the old FORMATTING_ONLY regex capped at 10 characters, so
    // longer real-world dividers (36+ chars, as content writers actually use
    // before a metadata section) were NOT recognised and leaked through as
    // real body paragraphs.
    const dividers = [
      '------------------------------------',
      '____________________________________',
      '====================================',
      '************************************',
      '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
      '----------',
      '______'
    ];

    const docxPath = await writeBlogDocx('long-dividers.docx', [
      heading(1, 'My Post'),
      paragraph('The real first article paragraph.'),
      ...dividers.map((d) => paragraph(d)),
      paragraph('Meta Title: My Post | Site'),
      paragraph('The real second article paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, [
      'The real first article paragraph.',
      'The real second article paragraph.'
    ], `Divider lines must never appear as paragraphs. Got: ${JSON.stringify(content.paragraphs)}`);
  });

  it('ignores a divider line even when surrounded by leading/trailing whitespace', async () => {
    const docxPath = await writeBlogDocx('divider-with-whitespace.docx', [
      heading(1, 'My Post'),
      paragraph('   ------------------------------------   '),
      paragraph('The only real paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The only real paragraph.']);
  });

  it('does not mistake a real paragraph containing a hyphen for a divider line', async () => {
    const docxPath = await writeBlogDocx('hyphenated-content.docx', [
      heading(1, 'My Post'),
      paragraph('This is a well-known, state-of-the-art approach to baking.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['This is a well-known, state-of-the-art approach to baking.']);
  });

  it('ignores a divider line even when it contains a hidden zero-width space in the middle', async () => {
    // Regression: a single invisible character (invisible to whoever wrote
    // the document) used to defeat the plain character-class match entirely,
    // letting the whole line — quotes and all — leak through as a paragraph.
    const docxPath = await writeBlogDocx('divider-with-zwsp.docx', [
      heading(1, 'My Post'),
      paragraph('----------​----------'),
      paragraph('The only real paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The only real paragraph.'],
      `Got: ${JSON.stringify(content.paragraphs)}`);
  });

  it('ignores a divider line wrapped in straight quotation marks', async () => {
    const docxPath = await writeBlogDocx('divider-in-quotes.docx', [
      heading(1, 'My Post'),
      paragraph('"---------------------------------------------"'),
      paragraph('The only real paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The only real paragraph.']);
  });

  it('ignores a divider line built from Unicode dash variants (en dash, em dash) instead of a plain hyphen', async () => {
    const docxPath = await writeBlogDocx('divider-unicode-dashes.docx', [
      heading(1, 'My Post'),
      paragraph('————————————————————'), // em dash (U+2014)
      paragraph('––––––––––––––––––––'), // en dash (U+2013)
      paragraph('The only real paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The only real paragraph.']);
  });

  it('ignores a paragraph that is entirely non-breaking spaces / zero-width characters and nothing else', async () => {
    const docxPath = await writeBlogDocx('invisible-only.docx', [
      heading(1, 'My Post'),
      paragraph(' ​‌‍﻿'),
      paragraph('The only real paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The only real paragraph.']);
  });

  it('captures "SEO Slug:" into expectedSlug', async () => {
    const docxPath = await writeBlogDocx('slug-label.docx', [
      heading(1, 'My Post'),
      paragraph('SEO Slug: my-post-slug'),
      paragraph('The real first article paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, 'my-post-slug');
  });

  it('also recognizes "Slug:", "Permalink:", and "URL:" as slug labels', async () => {
    for (const label of ['Slug', 'Permalink', 'URL']) {
      const docxPath = await writeBlogDocx(`slug-label-${label}.docx`, [
        heading(1, 'My Post'),
        paragraph(`${label}: /blog/my-post`)
      ]);

      const content = await parseBlogDocx(docxPath);
      assert.equal(content.expectedSlug, '/blog/my-post', `Label "${label}:" should populate expectedSlug`);
    }
  });

  it('captures "Canonical:" into expectedCanonicalUrl', async () => {
    const docxPath = await writeBlogDocx('canonical-label.docx', [
      heading(1, 'My Post'),
      paragraph('Canonical: https://example.com/blog/pillar-page'),
      paragraph('The real first article paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/blog/pillar-page');
  });

  it('leaves expectedSlug/expectedCanonicalUrl undefined when no such labels are present', async () => {
    const docxPath = await writeBlogDocx('no-url-labels.docx', [
      heading(1, 'My Post'),
      paragraph('Just a regular paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, undefined);
    assert.equal(content.expectedCanonicalUrl, undefined);
  });

  it('extracts Canonical/Slug from a 2-column content-brief table', async () => {
    const docxPath = await writeBlogDocx('table-url-fields.docx', [
      table([
        ['Meta Title', 'Table-Based Title | Example'],
        ['Canonical', 'https://example.com/blog/table-canonical'],
        ['Slug', 'table-based-slug']
      ]),
      paragraph('This is the only body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/blog/table-canonical');
    assert.equal(content.expectedSlug, 'table-based-slug');
  });
});

// ── htmlToText / decodeHtmlEntities ─────────────────────────────────────────────
//
// These exercise the exact bug report: a heading whose rendered HTML wraps
// the text in a nested <span> and encodes its apostrophe as a numeric HTML
// entity. `htmlToText` is what the parser runs every block's innerHTML
// through, so testing it directly with that real-world snippet is the most
// precise way to confirm nested tags and entities are both handled.

describe('htmlToText — nested tags', () => {
  it('reproduces the reported bug: strips a nested <span> and decodes a numeric entity correctly', () => {
    const html = '<span style="font-weight:400;">Why Sri Sreenivasa Infra&#8217;s Track Record Matters Here</span>';

    assert.equal(htmlToText(html), 'Why Sri Sreenivasa Infra’s Track Record Matters Here');
  });

  it('strips <strong>/<b> tags while preserving their text content', () => {
    assert.equal(htmlToText('This is <strong>very</strong> important and <b>bold</b> too.'),
      'This is very important and bold too.');
  });

  it('strips <em>/<i> tags while preserving their text content', () => {
    assert.equal(htmlToText('This is <em>emphasized</em> and <i>italic</i> too.'),
      'This is emphasized and italic too.');
  });

  it('strips <a> tags while preserving their anchor text', () => {
    assert.equal(htmlToText('Read our <a href="https://example.com/guide">full guide</a> for details.'),
      'Read our full guide for details.');
  });

  it('strips arbitrarily deep nesting of mixed tags', () => {
    assert.equal(
      htmlToText('<span><strong><em><a href="https://example.com">Deeply Nested Heading</a></em></strong></span>'),
      'Deeply Nested Heading'
    );
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes decimal numeric entities (e.g. curly apostrophe &#8217;)', () => {
    assert.equal(decodeHtmlEntities('Infra&#8217;s'), 'Infra’s');
  });

  it('decodes hex numeric entities (e.g. &#x2019;)', () => {
    assert.equal(decodeHtmlEntities('Infra&#x2019;s'), 'Infra’s');
    assert.equal(decodeHtmlEntities('Infra&#X2019;s'), 'Infra’s', 'Hex entities should be matched case-insensitively.');
  });

  it('still decodes the previously-supported named entities (&amp;, &nbsp;, &lt;, &gt;, &quot;)', () => {
    assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('a&nbsp;b'), 'a b');
    assert.equal(decodeHtmlEntities('&lt;tag&gt;'), '<tag>');
    assert.equal(decodeHtmlEntities('&quot;quoted&quot;'), '"quoted"');
  });

  it('decodes a straight-apostrophe numeric entity (&#39;) the same as before', () => {
    assert.equal(decodeHtmlEntities('It&#39;s fine'), "It's fine");
  });
});

// ── isDividerOnly ────────────────────────────────────────────────────────────────
//
// Direct, exhaustive tests of the divider detector itself — the same
// scenarios below are also exercised end-to-end through parseBlogDocx in the
// "ignores decorative divider lines" tests above, but testing the exported
// function directly makes every hidden-character edge case explicit and fast.

describe('isDividerOnly', () => {
  it('detects plain ASCII dividers of any length', () => {
    assert.equal(isDividerOnly('------------------------------------'), true);
    assert.equal(isDividerOnly('____________________________________'), true);
    assert.equal(isDividerOnly('===================================='), true);
    assert.equal(isDividerOnly('************************************'), true);
    assert.equal(isDividerOnly('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~'), true);
    assert.equal(isDividerOnly('----------'), true);
    assert.equal(isDividerOnly('______'), true);
  });

  it('detects a divider with leading/trailing whitespace', () => {
    assert.equal(isDividerOnly('   ------------------------------------   '), true);
  });

  it('detects a divider wrapped in straight or curly quotation marks', () => {
    assert.equal(isDividerOnly('"----------"'), true);
    assert.equal(isDividerOnly("'----------'"), true);
    assert.equal(isDividerOnly('“----------”'), true);
    assert.equal(isDividerOnly('‘----------’'), true);
  });

  it('detects a divider containing a non-breaking space (U+00A0)', () => {
    assert.equal(isDividerOnly('----- -----'), true);
    assert.equal(isDividerOnly(' ------------ '), true);
  });

  it('detects a divider containing zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM)', () => {
    assert.equal(isDividerOnly('-----​-----'), true, 'zero-width space');
    assert.equal(isDividerOnly('-----‌-----'), true, 'zero-width non-joiner');
    assert.equal(isDividerOnly('-----‍-----'), true, 'zero-width joiner');
    assert.equal(isDividerOnly('-----⁠-----'), true, 'word joiner');
    assert.equal(isDividerOnly('-----﻿-----'), true, 'zero-width no-break space / BOM');
  });

  it('detects a paragraph that is nothing but hidden/invisible characters', () => {
    assert.equal(isDividerOnly('​‌‍﻿'), true);
    assert.equal(isDividerOnly('   '), true);
  });

  it('detects dividers built from Unicode dash variants, not just the ASCII hyphen', () => {
    assert.equal(isDividerOnly('‐‐‐‐‐'), true, 'HYPHEN');
    assert.equal(isDividerOnly('‑‑‑‑‑'), true, 'NON-BREAKING HYPHEN');
    assert.equal(isDividerOnly('‒‒‒‒‒'), true, 'FIGURE DASH');
    assert.equal(isDividerOnly('–––––'), true, 'EN DASH');
    assert.equal(isDividerOnly('—————'), true, 'EM DASH');
    assert.equal(isDividerOnly('―――――'), true, 'HORIZONTAL BAR');
    assert.equal(isDividerOnly('−−−−−'), true, 'MINUS SIGN');
  });

  it('detects a divider mixing several different divider characters together', () => {
    assert.equal(isDividerOnly('--==__~~||'), true);
    assert.equal(isDividerOnly('-=*_~-=*_~'), true);
  });

  it('detects a divider combining several edge cases at once (mixed chars + quotes + NBSP + zero-width + surrounding whitespace)', () => {
    assert.equal(isDividerOnly('  "--== __​~~"  '), true);
  });

  it('does NOT flag real content as a divider', () => {
    assert.equal(isDividerOnly('hello'), false);
    assert.equal(isDividerOnly('This is a well-known, state-of-the-art approach to baking.'), false);
    assert.equal(isDividerOnly('3 - 2 = 1'), false, 'contains real digits, not just divider characters');
  });

  it('does NOT flag real content that merely contains a hidden character somewhere in it', () => {
    assert.equal(isDividerOnly('Hello​world'), false);
  });
});

describe('parseBlogDocx — hyperlink extraction', () => {
  it('extracts hyperlinks from body paragraphs (mammoth HTML <a> tags)', async () => {
    // Build an HTML paragraph that mammoth would produce for a linked paragraph.
    // Since mammoth-generated HTML uses <a href="..."> for hyperlinks, we test
    // by providing the equivalent Word XML with a relationship-linked hyperlink.
    // For this unit test we inject the expected HTML directly via a raw XML block.
    const docxPath = await writeBlogDocxWithRelationships('hyperlinks.docx', [
      // Normal heading/paragraph blocks (no links)
      { kind: 'heading', level: 1, text: 'Blog With Links' },
      // Paragraph that will be converted to a paragraph with an <a> tag by mammoth
      { kind: 'hyperlink', text: 'learn more about sourdough', relId: 'rId2' },
      { kind: 'hyperlink', text: 'buy Dutch oven here', relId: 'rId3' }
    ], {
      rId2: 'https://example.com/sourdough-guide',
      rId3: 'https://example.com/tools/dutch-oven'
    });

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog/sourdough');

    assert.equal(content.links.length, 2,
      `Expected 2 links, got ${content.links.length}: ${JSON.stringify(content.links)}`);

    const link1 = content.links.find((l) => l.text === 'learn more about sourdough');
    const link2 = content.links.find((l) => l.text === 'buy Dutch oven here');

    assert.ok(link1, 'First hyperlink not found');
    assert.equal(link1!.url, 'https://example.com/sourdough-guide');

    assert.ok(link2, 'Second hyperlink not found');
    assert.equal(link2!.url, 'https://example.com/tools/dutch-oven');
  });

  it('strips tracking parameters (utm_*, fbclid) when extracting docx links', async () => {
    const docxPath = await writeBlogDocxWithRelationships('tracked-links.docx', [
      { kind: 'hyperlink', text: 'tracked article link', relId: 'rId2' }
    ], {
      rId2: 'https://example.com/article?utm_source=brief&utm_medium=docx&fbclid=abc'
    });

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.equal(content.links.length, 1);
    assert.equal(content.links[0]!.url, 'https://example.com/article',
      'Tracking params must be stripped from docx hyperlinks.');
    assert.equal(content.links[0]!.rawUrl, 'https://example.com/article?utm_source=brief&utm_medium=docx&fbclid=abc',
      'rawUrl must preserve the original href before normalisation.');
  });
});

describe('parseBlogDocx — bold phrase extraction', () => {
  it('extracts <strong> and <b> phrases from body paragraphs', async () => {
    const docxPath = await writeBlogDocxWithBold('bold-phrases.docx', [
      { kind: 'heading', level: 1, text: 'Blog With Bold' },
      {
        kind: 'paragraph-with-bold',
        parts: [
          { text: 'This is the introduction with ', bold: false },
          { text: 'sourdough starter', bold: true },
          { text: ' and more about ', bold: false },
          { text: 'Dutch oven baking', bold: true },
          { text: '.', bold: false }
        ]
      }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.ok(content.boldPhrases.includes('sourdough starter'),
      `Expected "sourdough starter" in bold phrases. Got: ${JSON.stringify(content.boldPhrases)}`);
    assert.ok(content.boldPhrases.includes('Dutch oven baking'),
      `Expected "Dutch oven baking" in bold phrases. Got: ${JSON.stringify(content.boldPhrases)}`);
  });
});

describe('parseBlogDocx — heading text extraction with inline formatting', () => {
  it('extracts an H2 whose text is split across bold, italic, and hyperlink runs into one clean heading', async () => {
    const docxPath = await writeBlogDocxHeadingWithRuns('heading-mixed-runs.docx', 2, [
      { text: 'Why ' },
      { text: 'Sri Sreenivasa Infra', bold: true },
      { text: "'s " },
      { text: 'Track Record', italic: true },
      { text: ' ' },
      { text: 'Matters Here', link: 'https://example.com/about' }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog/x');

    assert.deepEqual(content.h2Headings, ["Why Sri Sreenivasa Infra's Track Record Matters Here"]);
  });

  it('extracts an H3 with a bold+italic combined run correctly', async () => {
    const docxPath = await writeBlogDocxHeadingWithRuns('heading-bold-italic.docx', 3, [
      { text: 'Plain start, ' },
      { text: 'bold and italic together', bold: true, italic: true },
      { text: ', plain end.' }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog/x');

    assert.deepEqual(content.h3Headings, ['Plain start, bold and italic together, plain end.']);
  });

  it('extracts a real Word "Heading 4" style into h4Headings', async () => {
    const docxPath = await writeBlogDocx('real-h4.docx', [
      heading(1, 'My Post'),
      heading(4, 'What is the RERA registration number?'),
      paragraph('It is P02400003701.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, ['What is the RERA registration number?']);
  });
});

// ── Metadata field boundaries ────────────────────────────────────────────────────
//
// Covers requirement: each metadata field must stop parsing when another
// metadata field begins, and must never leak into paragraphs/bold — even
// when two labels end up merged onto the same Word paragraph via a soft
// line break (Shift+Enter), which is what "the parser currently merges
// these" looked like in practice.

describe('parseBlogDocx — metadata field boundaries', () => {
  it('does not let Focus Keyword bleed into Canonical when merged via a soft line break', async () => {
    const docxPath = await writeBlogDocx('canonical-then-focus-keyword.docx', [
      heading(1, 'My Post'),
      softBreakParagraph(
        'Canonical: https://example.com/my-post',
        'Focus Keyword: best sourdough recipe'
      ),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post',
      'Canonical must contain only the canonical value, not the next label.');
  });

  it('does not let Focus Keyword bleed into Slug when merged via a soft line break', async () => {
    const docxPath = await writeBlogDocx('slug-then-focus-keyword.docx', [
      heading(1, 'My Post'),
      softBreakParagraph(
        'SEO Slug: my-post-slug',
        'Focus Keyword: best sourdough recipe'
      ),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, 'my-post-slug',
      'Slug must contain only the slug value, not the next label.');
  });

  it('stops each metadata field at the next one when three labels are merged onto one paragraph', async () => {
    const docxPath = await writeBlogDocx('three-labels-merged.docx', [
      heading(1, 'My Post'),
      softBreakParagraph(
        'Meta Description: A description of the post.',
        'Canonical: https://example.com/my-post',
        'SEO Slug: my-post-slug',
        'Focus Keyword: sourdough'
      ),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.metaDescription, 'A description of the post.');
    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post');
    assert.equal(content.expectedSlug, 'my-post-slug');
  });

  it('stops a label value at the next label even with no line break at all between them', async () => {
    // Extreme edge case: no <br> and no separate paragraph — just two labels
    // typed one after another on the same run of text.
    const docxPath = await writeBlogDocx('same-line-labels.docx', [
      heading(1, 'My Post'),
      paragraph('Canonical: https://example.com/my-post Focus Keyword: sourdough starter'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post');
  });

  it('does not truncate a slug value that contains a hyphenated label-like word (e.g. "-slug-", "-url-", "-tag-")', async () => {
    // Regression: the same-line "stop at the next label" safety net matched
    // a recognized label word ANYWHERE in the value, not just at a genuine
    // new label boundary — since a hyphen is itself a valid label
    // separator, a slug like "my-post-slug-2026" got silently truncated to
    // "my-post-" right at the embedded "-slug-". Real slugs routinely
    // contain "slug"/"url"/"tag"/"date"/etc. as one of their hyphenated
    // words, so this could corrupt a perfectly normal, single-label value.
    const docxPath = await writeBlogDocx('slug-value-contains-label-word.docx', [
      heading(1, 'My Post'),
      paragraph('SEO Slug: my-post-slug-2026'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, 'my-post-slug-2026');
  });

  it('excludes Focus Keyword and Alt Text lines from paragraphs[] entirely', async () => {
    const docxPath = await writeBlogDocx('focus-keyword-alt-text.docx', [
      heading(1, 'My Post'),
      paragraph('Focus Keyword: sourdough starter recipe'),
      paragraph('Alt Text: a golden sourdough loaf cooling on a rack'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The real body paragraph.']);
  });

  it('captures the value when a label is typed alone on its own line and the value follows on the next soft-broken line', async () => {
    // Regression: a real-world content brief had "SEO Slug:", "Meta Title:",
    // and "Meta Description:" each typed alone, followed by a Shift+Enter and
    // the actual value on the next line within the SAME Word paragraph —
    // e.g. "SEO Slug:<br/>my-post-slug" rather than "SEO Slug: my-post-slug"
    // on one line. Previously the bare label line set the field to an empty
    // string (silently claiming it) and the orphaned value line leaked into
    // paragraphs[] as a bogus "missing paragraph" (the value never appears
    // as real page content, since it's metadata).
    const docxPath = await writeBlogDocx('label-value-on-next-line.docx', [
      softBreakParagraph('SEO Slug:', 'my-post-slug'),
      softBreakParagraph('Meta Title:', 'My Post Title'),
      softBreakParagraph('Meta Description:', 'A description spanning the next line.'),
      heading(1, 'My Post'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, 'my-post-slug');
    assert.equal(content.metaTitle, 'My Post Title');
    assert.equal(content.metaDescription, 'A description spanning the next line.');
    assert.deepEqual(content.paragraphs, ['The real body paragraph.'],
      'The orphaned value lines must not leak into paragraphs[].');
  });

  it('still stops a label-then-value split at a genuine following label, rather than swallowing it as the value', async () => {
    const docxPath = await writeBlogDocx('label-alone-then-another-label.docx', [
      softBreakParagraph('Meta Description:', 'Canonical: https://example.com/my-post'),
      heading(1, 'My Post'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post');
    assert.notEqual(content.metaDescription, 'Canonical: https://example.com/my-post');
  });

  it('captures the value when a label ends one Word paragraph and its value is an entirely separate, fully-bolded following paragraph', async () => {
    // Regression, reproducing a real-world docx exactly: a content brief ran
    // a bolded "Slug:" onto the tail of the Meta Description paragraph (a
    // stray label with no value of its own on that same soft-broken line),
    // with the actual slug value as its own, entirely bolded Word
    // paragraph — a hard paragraph break between the label and its value,
    // one level up from the soft-line-break case above. Previously the bare
    // "Slug:" line claimed expectedSlug as an empty string, and the
    // separate value paragraph leaked into BOTH paragraphs[] and
    // boldPhrases[] as a fake "missing" URL-slug-shaped paragraph and bold
    // phrase.
    const bodyXml =
      '<w:p><w:r><w:t xml:space="preserve">Meta Description: Discover why this matters.</w:t></w:r>' +
      '<w:r><w:br/></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Slug:</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>my-post-slug-2026</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>My Post</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>The real body paragraph.</w:t></w:r></w:p>';
    const docxPath = await writeRawBlogDocx('label-tail-then-separate-bold-paragraph.docx', bodyXml);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedSlug, 'my-post-slug-2026');
    assert.equal(content.metaDescription, 'Discover why this matters.');
    assert.deepEqual(content.paragraphs, ['The real body paragraph.'],
      'The separate value paragraph must not leak into paragraphs[].');
    assert.ok(!content.boldPhrases.includes('my-post-slug-2026'),
      'The separate, fully-bolded value paragraph must not leak into boldPhrases[] either.');
  });

  it('does NOT swallow a genuine following heading as a trailing bare label\'s value', async () => {
    const docxPath = await writeBlogDocx('label-tail-then-real-heading.docx', [
      softBreakParagraph(
        'Meta Description: Discover why this matters.',
        'Slug:'
      ),
      heading(2, 'A Genuine Section Heading'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h2Headings, ['A Genuine Section Heading'],
      'A real heading immediately after a trailing bare label must still be extracted as a heading, not consumed as the label\'s value.');
  });
});

// ── Metadata label variants (capitalization, punctuation, common typos) ────────

describe('parseBlogDocx — metadata label variants', () => {
  const metaDescriptionVariants = ['Meta Description', 'Met Description', 'meta description', 'Description'];
  for (const label of metaDescriptionVariants) {
    it(`recognizes "${label}:" as a Meta Description label`, async () => {
      const docxPath = await writeBlogDocx(`meta-desc-variant-${label.replace(/\s+/g, '')}.docx`, [
        heading(1, 'My Post'),
        paragraph(`${label}: A description of the post.`),
        paragraph('The real body paragraph.')
      ]);

      const content = await parseBlogDocx(docxPath);

      assert.equal(content.metaDescription, 'A description of the post.',
        `Label "${label}:" should populate metaDescription`);
      assert.deepEqual(content.paragraphs, ['The real body paragraph.']);
    });
  }

  it('recognizes "Canonical URL:" as well as bare "Canonical:"', async () => {
    const docxPath = await writeBlogDocx('canonical-url-label.docx', [
      heading(1, 'My Post'),
      paragraph('Canonical URL: https://example.com/my-post')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post');
  });

  it('recognizes "Focus Keyword:" and "Alt Text:" regardless of case', async () => {
    const docxPath = await writeBlogDocx('focus-alt-case.docx', [
      heading(1, 'My Post'),
      paragraph('FOCUS KEYWORD: sourdough'),
      paragraph('alt text: a loaf of bread'),
      paragraph('The real body paragraph.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.paragraphs, ['The real body paragraph.'],
      'Focus Keyword / Alt Text lines must never appear as paragraphs, regardless of case.');
  });

  it('recognizes a hyphen or dash separator, not just a colon', async () => {
    const docxPath = await writeBlogDocx('dash-separator.docx', [
      heading(1, 'My Post'),
      paragraph('Canonical - https://example.com/my-post')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.equal(content.expectedCanonicalUrl, 'https://example.com/my-post');
  });
});

// ── Heading-level (H#) suffix stripping ─────────────────────────────────────────

describe('parseBlogDocx — heading-level (H#) suffix', () => {
  it('strips a "(H2)" suffix from a real Heading-2-styled heading', async () => {
    const docxPath = await writeBlogDocx('h2-with-suffix.docx', [
      heading(1, 'My Post'),
      heading(2, 'Why Mokila Has Arrived (H2)')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h2Headings, ['Why Mokila Has Arrived']);
  });

  it('strips "(H1)".."(H4)" suffixes regardless of internal spacing or case', async () => {
    const variants = ['(H2)', '( H2 )', '(h2)', '(H 2)', '(  h2  )'];
    for (const suffix of variants) {
      const docxPath = await writeBlogDocx(`h2-suffix-variant-${variants.indexOf(suffix)}.docx`, [
        heading(1, 'My Post'),
        heading(2, `Why Mokila Has Arrived ${suffix}`)
      ]);

      const content = await parseBlogDocx(docxPath);

      assert.deepEqual(content.h2Headings, ['Why Mokila Has Arrived'],
        `Suffix "${suffix}" should be stripped`);
    }
  });

  it('promotes a plain paragraph ending in "(H4)" to an H4 heading instead of leaving it as a paragraph', async () => {
    const docxPath = await writeBlogDocx('promoted-h4.docx', [
      heading(1, 'My Post'),
      paragraph('What is the RERA registration number? (H4)'),
      paragraph('It is P02400003701.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, ['What is the RERA registration number?']);
    assert.deepEqual(content.paragraphs, ['It is P02400003701.']);
  });

  it('promotes a plain paragraph ending in "(H2)" to an H2 heading', async () => {
    const docxPath = await writeBlogDocx('promoted-h2.docx', [
      heading(1, 'My Post'),
      paragraph('Why Sri Sreenivasa Infra Track Record Matters (H2)'),
      paragraph('Body text follows.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h2Headings, ['Why Sri Sreenivasa Infra Track Record Matters']);
    assert.deepEqual(content.paragraphs, ['Body text follows.']);
  });

  it('strips the suffix from hyperlink anchor text', async () => {
    const docxPath = await writeBlogDocxWithRelationships('link-with-suffix.docx', [
      { kind: 'heading', level: 1, text: 'My Post' },
      { kind: 'hyperlink', text: 'our packing checklist (H2)', relId: 'rId2' }
    ], {
      rId2: 'https://example.com/packing-checklist'
    });

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.equal(content.links.length, 1);
    assert.equal(content.links[0]!.text, 'our packing checklist');
  });

  it('strips the suffix from a bold phrase', async () => {
    const docxPath = await writeBlogDocxWithBold('bold-with-suffix.docx', [
      { kind: 'heading', level: 1, text: 'My Post' },
      {
        kind: 'paragraph-with-bold',
        parts: [
          { text: 'This has ', bold: false },
          { text: 'a bold phrase (H2)', bold: true },
          { text: ' in it.', bold: false }
        ]
      }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.ok(content.boldPhrases.includes('a bold phrase'),
      `Expected suffix-stripped bold phrase. Got: ${JSON.stringify(content.boldPhrases)}`);
    assert.ok(!content.boldPhrases.some((p) => p.includes('(H2)')),
      'The raw "(H2)" suffix must never appear in a stored bold phrase.');
  });
});

// ── FAQ parsing ──────────────────────────────────────────────────────────────────

describe('parseBlogDocx — FAQ parsing', () => {
  it('extracts a "Question (H4)" / answer pair as a separate H4 heading and paragraph when they are separate Word paragraphs', async () => {
    const docxPath = await writeBlogDocx('faq-separate-paragraphs.docx', [
      heading(1, 'My Post'),
      paragraph('What is the RERA registration number? (H4)'),
      paragraph('It is P02400003701, issued for this project.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, ['What is the RERA registration number?']);
    assert.deepEqual(content.paragraphs, ['It is P02400003701, issued for this project.']);
  });

  it('extracts a "Question (H4)" / answer pair correctly even when merged into one Word paragraph via a soft line break', async () => {
    // Regression: this is exactly the reported bug — the parser used to
    // concatenate the question and answer into a single paragraph.
    const docxPath = await writeBlogDocx('faq-soft-break.docx', [
      heading(1, 'My Post'),
      softBreakParagraph(
        'What is the RERA registration number? (H4)',
        'It is P02400003701, issued for this project.'
      )
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, ['What is the RERA registration number?']);
    assert.deepEqual(content.paragraphs, ['It is P02400003701, issued for this project.'],
      `Question and answer must never be concatenated into one paragraph. Got paragraphs: ${JSON.stringify(content.paragraphs)}`);
  });

  it('extracts multiple FAQ question/answer pairs in sequence, each kept separate', async () => {
    const docxPath = await writeBlogDocx('faq-multiple.docx', [
      heading(1, 'My Post'),
      softBreakParagraph('Is financing available? (H4)', 'Yes, several banks offer approved financing plans.'),
      softBreakParagraph('What is the possession timeline? (H4)', 'Possession is expected within 18 months.')
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, [
      'Is financing available?',
      'What is the possession timeline?'
    ]);
    assert.deepEqual(content.paragraphs, [
      'Yes, several banks offer approved financing plans.',
      'Possession is expected within 18 months.'
    ]);
  });

  it('does not concatenate a real body paragraph that precedes a soft-broken FAQ question in the same Word paragraph', async () => {
    const docxPath = await writeBlogDocx('faq-with-preceding-content.docx', [
      heading(1, 'My Post'),
      softBreakParagraph(
        'Here is some closing context before the FAQ section begins.',
        'Is financing available? (H4)',
        'Yes, several banks offer approved financing plans.'
      )
    ]);

    const content = await parseBlogDocx(docxPath);

    assert.deepEqual(content.h4Headings, ['Is financing available?']);
    assert.deepEqual(content.paragraphs, [
      'Here is some closing context before the FAQ section begins.',
      'Yes, several banks offer approved financing plans.'
    ]);
  });
});

// ── Metadata excluded from bold validation ──────────────────────────────────────

describe('parseBlogDocx — metadata excluded from bold validation', () => {
  it('does not treat a bolded metadata label as a bold phrase', async () => {
    const docxPath = await writeBlogDocxWithBold('bold-label.docx', [
      { kind: 'heading', level: 1, text: 'My Post' },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Meta Description:', bold: true }, { text: ' A description of the post.', bold: false }] },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Canonical:', bold: true }, { text: ' https://example.com/my-post', bold: false }] },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Slug:', bold: true }, { text: ' my-post-slug', bold: false }] },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Focus Keyword:', bold: true }, { text: ' sourdough', bold: false }] },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Alt Text:', bold: true }, { text: ' a golden loaf', bold: false }] },
      {
        kind: 'paragraph-with-bold',
        parts: [{ text: 'The real content has a ', bold: false }, { text: 'genuinely bold phrase', bold: true }, { text: ' in it.', bold: false }]
      }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.deepEqual(content.boldPhrases, ['genuinely bold phrase'],
      `Metadata labels must never appear as bold phrases. Got: ${JSON.stringify(content.boldPhrases)}`);
  });

  it('does not treat a bolded label-only phrase (no trailing colon) as a bold phrase', async () => {
    const docxPath = await writeBlogDocxWithBold('bold-label-no-colon.docx', [
      { kind: 'heading', level: 1, text: 'My Post' },
      { kind: 'paragraph-with-bold', parts: [{ text: 'Canonical', bold: true }] },
      {
        kind: 'paragraph-with-bold',
        parts: [{ text: 'Real ', bold: false }, { text: 'bold content', bold: true }]
      }
    ]);

    const content = await parseBlogDocx(docxPath, 'https://example.com/blog');

    assert.deepEqual(content.boldPhrases, ['bold content']);
  });
});

// --- Minimal .docx fixture builder -----------------------------------------
//
// Mammoth's default style map matches Word's built-in heading styles by
// paragraph style ID ("p.Heading1 => h1:fresh", etc.), so a valid heading
// paragraph only needs <w:pStyle w:val="Heading1"/> — no styles.xml entry
// is required for the conversion to recognize it.

interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
  headingLevel?: 1 | 2 | 3 | 4;
}

interface TableBlock {
  kind: 'table';
  rows: string[][];
}

/** A single Word paragraph containing multiple "lines" joined by soft line breaks (`<w:br/>`) rather than separate hard paragraphs — used to test that metadata/FAQ/heading-suffix lines are correctly separated even when merged this way. */
interface SoftBreakParagraphBlock {
  kind: 'soft-break-paragraph';
  lines: string[];
}

type DocBlock = ParagraphBlock | TableBlock | SoftBreakParagraphBlock;

function paragraph(text: string): ParagraphBlock {
  return { kind: 'paragraph', text };
}

function heading(level: 1 | 2 | 3 | 4, text: string): ParagraphBlock {
  return { kind: 'paragraph', text, headingLevel: level };
}

function table(rows: string[][]): TableBlock {
  return { kind: 'table', rows };
}

function softBreakParagraph(...lines: string[]): SoftBreakParagraphBlock {
  return { kind: 'soft-break-paragraph', lines };
}

async function writeBlogDocx(fileName: string, blocks: DocBlock[]): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-blog-docx-tests');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'word/document.xml': strToU8(documentXml(blocks))
  });

  await writeFile(filePath, archive);

  return filePath;
}

function documentXml(blocks: DocBlock[]): string {
  const bodyXml = blocks.map(renderBlock).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;
}

function renderBlock(block: DocBlock): string {
  if (block.kind === 'table') {
    const rowsXml = block.rows
      .map(
        (cells) =>
          `<w:tr>${cells
            .map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`)
            .join('')}</w:tr>`
      )
      .join('');

    return `<w:tbl>${rowsXml}</w:tbl>`;
  }

  if (block.kind === 'soft-break-paragraph') {
    const runsXml = block.lines
      .map((line, i) => {
        const textRun = `<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
        const breakRun = i < block.lines.length - 1 ? '<w:r><w:br/></w:r>' : '';
        return textRun + breakRun;
      })
      .join('');
    return `<w:p>${runsXml}</w:p>`;
  }

  const styleXml = block.headingLevel ? `<w:pPr><w:pStyle w:val="Heading${block.headingLevel}"/></w:pPr>` : '';
  return `<w:p>${styleXml}<w:r><w:t>${escapeXml(block.text)}</w:t></w:r></w:p>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

// ── Extended fixture builders (hyperlinks and bold) ────────────────────────────

type HyperlinkBlock = { kind: 'hyperlink'; text: string; relId: string };
type HeadingSimple  = { kind: 'heading'; level: 1 | 2 | 3; text: string };
type BoldPart       = { text: string; bold: boolean };
type BoldParaBlock  = { kind: 'paragraph-with-bold'; parts: BoldPart[] };
type ExtendedBlock  = HyperlinkBlock | HeadingSimple | BoldParaBlock;

async function writeBlogDocxWithRelationships(
  fileName: string,
  blocks: ExtendedBlock[],
  relationships: Record<string, string>
): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-blog-docx-tests');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  const docBodyXml = blocks
    .map((block) => {
      if (block.kind === 'heading') {
        return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr><w:r><w:t>${escapeXml(block.text)}</w:t></w:r></w:p>`;
      }
      if (block.kind === 'hyperlink') {
        return `<w:p><w:hyperlink r:id="${block.relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${escapeXml(block.text)}</w:t></w:r></w:hyperlink></w:p>`;
      }
      return '';
    })
    .join('');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${docBodyXml}</w:body>
</w:document>`;

  const relXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Object.entries(relationships).map(([id, url]) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${url.replace(/"/g, '&quot;')}" TargetMode="External"/>`
  ).join('\n  ')}
</Relationships>`;

  const archive = zipSync({
    '[Content_Types].xml':          strToU8(contentTypesXml),
    '_rels/.rels':                  strToU8(rootRelationshipsXml),
    'word/document.xml':            strToU8(docXml),
    'word/_rels/document.xml.rels': strToU8(relXml)
  });

  await writeFile(filePath, archive);
  return filePath;
}

/** Builds a docx from raw Word body XML directly — for the rare fixture that needs precise control (e.g. a bold run split by a soft line break) beyond what the paragraph()/heading()/softBreakParagraph() helpers express. */
async function writeRawBlogDocx(fileName: string, bodyXml: string): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-blog-docx-tests');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;

  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'word/document.xml': strToU8(docXml)
  });

  await writeFile(filePath, archive);
  return filePath;
}

async function writeBlogDocxWithBold(
  fileName: string,
  blocks: Array<HeadingSimple | BoldParaBlock>
): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-blog-docx-tests');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  const docBodyXml = blocks
    .map((block) => {
      if (block.kind === 'heading') {
        return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr><w:r><w:t>${escapeXml(block.text)}</w:t></w:r></w:p>`;
      }
      const runsXml = block.parts
        .map((part) =>
          part.bold
            ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(part.text)}</w:t></w:r>`
            : `<w:r><w:t xml:space="preserve">${escapeXml(part.text)}</w:t></w:r>`
        )
        .join('');
      return `<w:p>${runsXml}</w:p>`;
    })
    .join('');

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${docBodyXml}</w:body>
</w:document>`;

  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels':         strToU8(rootRelationshipsXml),
    'word/document.xml':   strToU8(docXml)
  });

  await writeFile(filePath, archive);
  return filePath;
}

// ── Heading with mixed inline formatting (bold / italic / hyperlink runs) ──────

interface HeadingRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** href — when set, the run is wrapped in a hyperlink instead of a plain/bold/italic run. */
  link?: string;
}

async function writeBlogDocxHeadingWithRuns(
  fileName: string,
  headingLevel: 1 | 2 | 3,
  runs: HeadingRun[]
): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-blog-docx-tests');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);

  const relationships: Record<string, string> = {};
  let nextRelId = 2;

  const runsXml = runs
    .map((run) => {
      if (run.link) {
        const relId = `rId${nextRelId++}`;
        relationships[relId] = run.link;
        return `<w:hyperlink r:id="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r></w:hyperlink>`;
      }
      const rPrParts = [run.bold ? '<w:b/>' : '', run.italic ? '<w:i/>' : ''].filter(Boolean).join('');
      const rPr = rPrParts ? `<w:rPr>${rPrParts}</w:rPr>` : '';
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
    })
    .join('');

  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr>${runsXml}</w:p>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${bodyXml}</w:body>
</w:document>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels':         strToU8(rootRelationshipsXml),
    'word/document.xml':   strToU8(docXml)
  };

  if (Object.keys(relationships).length > 0) {
    const relXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Object.entries(relationships).map(([id, href]) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${href.replace(/"/g, '&quot;')}" TargetMode="External"/>`
  ).join('\n  ')}
</Relationships>`;
    files['word/_rels/document.xml.rels'] = strToU8(relXml);
  }

  const archive = zipSync(files);
  await writeFile(filePath, archive);
  return filePath;
}
