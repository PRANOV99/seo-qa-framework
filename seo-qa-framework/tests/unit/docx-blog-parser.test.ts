import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { parseBlogDocx, htmlToText, decodeHtmlEntities } from '../../src/blog/docx-blog-parser.js';

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
  headingLevel?: 1 | 2 | 3;
}

interface TableBlock {
  kind: 'table';
  rows: string[][];
}

type DocBlock = ParagraphBlock | TableBlock;

function paragraph(text: string): ParagraphBlock {
  return { kind: 'paragraph', text };
}

function heading(level: 1 | 2 | 3, text: string): ParagraphBlock {
  return { kind: 'paragraph', text, headingLevel: level };
}

function table(rows: string[][]): TableBlock {
  return { kind: 'table', rows };
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
