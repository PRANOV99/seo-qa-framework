import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { test, expect } from '../src/fixtures/test-fixtures.js';
import { BlogAuditRunner } from '../src/runner/blog-audit-runner.js';
import { BlogBatchRunner } from '../src/runner/blog-batch-runner.js';
import { parseBlogDocx } from '../src/blog/docx-blog-parser.js';

test.describe('BlogAuditRunner', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The blog audit runner launches its own browser internally; one run covers the behaviour.'
  );

  let server: Server;
  let baseUrl: string;
  let matchingPath: string;
  let mismatchedPath: string;
  let headingEntitiesPath: string;
  let introOutsideScopePath: string;
  let listLayoutPath: string;
  let mixedBlocksPath: string;
  let splitTextNodesPath: string;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (req.url === '/blog/matching') {
        res.end(`<!doctype html>
          <html>
            <head>
              <title>How to Bake Sourdough Bread | Example Blog</title>
              <meta name="description" content="Learn how to bake sourdough bread at home with this step-by-step guide.">
              <link rel="canonical" href="${baseUrl}/blog/matching">
            </head>
            <body>
              <article>
                <h1>How to Bake Sourdough Bread</h1>
                <p>This is the introduction paragraph.</p>
                <h2>Ingredients</h2>
                <p>Flour, water, salt, and a starter.</p>
              </article>
            </body>
          </html>`);
        return;
      }

      if (req.url === '/blog/heading-entities') {
        // Reproduces the reported bug verbatim: an H2 whose text is wrapped in a
        // nested <span> and whose apostrophe is a numeric HTML entity (&#8217;).
        res.end(`<!doctype html>
          <html>
            <head>
              <title>Why Sri Sreenivasa Infra's Track Record Matters | Example Blog</title>
              <meta name="description" content="Why Sri Sreenivasa Infra's track record matters for buyers.">
              <link rel="canonical" href="${baseUrl}/blog/heading-entities">
            </head>
            <body>
              <article>
                <h1>Why Sri Sreenivasa Infra's Track Record Matters</h1>
                <p>This is the introduction paragraph.</p>
                <h2>
                    <span style="font-weight:400;">
                        Why Sri Sreenivasa Infra&#8217;s Track Record Matters Here
                    </span>
                </h2>
                <p>Flour, water, salt, and a starter.</p>
              </article>
            </body>
          </html>`);
        return;
      }

      if (req.url === '/blog/intro-outside-scope') {
        // Reproduces the reported bug: the theme places the post header
        // (H1 + lead/intro paragraphs) in a <header> OUTSIDE the <article>
        // content container, with the rest of the body inside <article>.
        res.end(`<!doctype html>
          <html>
            <head>
              <title>Intro Outside Scope | Example Blog</title>
              <meta name="description" content="A page whose intro paragraphs live outside the article tag.">
              <link rel="canonical" href="${baseUrl}/blog/intro-outside-scope">
            </head>
            <body>
              <header class="page-header">
                <h1>Intro Outside Scope</h1>
                <p>First introductory paragraph before any heading.</p>
                <p>Second introductory paragraph, also before the first H2.</p>
              </header>
              <article>
                <h2>Ingredients</h2>
                <p>Flour, water, salt, and a starter.</p>
              </article>
            </body>
          </html>`);
        return;
      }

      if (req.url === '/blog/list-layout') {
        // A paragraph introducing a bulleted list, followed by a normal
        // paragraph — the exact "paragraph + UL/OL" layout reported as a
        // false "missing" for the introducing sentence.
        res.end(`<!doctype html>
          <html>
            <head>
              <title>List Layout | Example Blog</title>
              <meta name="description" content="A page whose body mixes paragraphs and a bulleted list.">
              <link rel="canonical" href="${baseUrl}/blog/list-layout">
            </head>
            <body>
              <article>
                <h1>List Layout</h1>
                <p>A well-rounded programme may include:</p>
                <ul>
                  <li>Item one</li>
                  <li>Item two</li>
                  <li>Item three</li>
                </ul>
                <p>A normal paragraph after the list.</p>
              </article>
            </body>
          </html>`);
        return;
      }

      if (req.url === '/blog/mixed-blocks') {
        // Mixed block structure: paragraph, blockquote, figure/figcaption,
        // and an accordion whose answer is hidden (display:none) until
        // toggled — all of it approved content that must still compare
        // correctly, not just plain sequential <p> tags.
        res.end(`<!doctype html>
          <html>
            <head>
              <title>Mixed Blocks | Example Blog</title>
              <meta name="description" content="A page whose body mixes paragraphs, quotes, figures, and an accordion.">
              <link rel="canonical" href="${baseUrl}/blog/mixed-blocks">
            </head>
            <body>
              <article>
                <h1>Mixed Blocks</h1>
                <p>An ordinary paragraph leading into a quoted passage.</p>
                <blockquote>A memorable quoted passage from a satisfied customer.</blockquote>
                <figure>
                  <img src="/photo.jpg" alt="A finished loaf of sourdough bread">
                  <figcaption>The finished loaf, fresh out of the oven.</figcaption>
                </figure>
                <h4>Is financing available?</h4>
                <p style="display:none;">Yes, financing is available through our partner lenders.</p>
              </article>
            </body>
          </html>`);
        return;
      }

      if (req.url === '/blog/split-text-nodes') {
        // Gutenberg/CMS-style HTML where one logical paragraph's text is
        // split across several nested inline elements rather than being one
        // plain text node.
        res.end(`<!doctype html>
          <html>
            <head>
              <title>Split Text Nodes | Example Blog</title>
              <meta name="description" content="A page whose paragraph text is split across nested inline elements.">
              <link rel="canonical" href="${baseUrl}/blog/split-text-nodes">
            </head>
            <body>
              <article>
                <h1>Split Text Nodes</h1>
                <p><span>Our </span><strong>award-winning</strong><span> team delivers </span><em>exceptional</em><span> results every time.</span></p>
              </article>
            </body>
          </html>`);
        return;
      }

      // Mismatched page: different title, missing H2, and a modified paragraph.
      res.end(`<!doctype html>
        <html>
          <head>
            <title>A Totally Different Title</title>
            <meta name="description" content="Learn how to bake sourdough bread at home with this step-by-step guide.">
          </head>
          <body>
            <article>
              <h1>How to Bake Sourdough Bread</h1>
              <p>This is the introduction paragraph, completely rewritten and different.</p>
            </article>
          </body>
        </html>`);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    matchingPath = `${baseUrl}/blog/matching`;
    mismatchedPath = `${baseUrl}/blog/mismatched`;
    headingEntitiesPath = `${baseUrl}/blog/heading-entities`;
    introOutsideScopePath = `${baseUrl}/blog/intro-outside-scope`;
    listLayoutPath = `${baseUrl}/blog/list-layout`;
    mixedBlocksPath = `${baseUrl}/blog/mixed-blocks`;
    splitTextNodesPath = `${baseUrl}/blog/split-text-nodes`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('passes every comparison when the live page matches the approved document exactly', async () => {
    const docxPath = await writeBlogDocx('matching.docx', [
      paragraph('Meta Title: How to Bake Sourdough Bread | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home with this step-by-step guide.'),
      paragraph('SEO Slug: matching'),
      heading(1, 'How to Bake Sourdough Bread'),
      paragraph('This is the introduction paragraph.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, matchingPath);

      expect(result.kind).toBe('blog');
      expect(result.seoCheckResults.length).toBeGreaterThan(0);
      expect(result.seoCheckResults.every((check) => check.status === 'passed')).toBe(true);
      // The parsed approved content is returned on every run (not just
      // re-runs) so it can be persisted and reused later without a fresh
      // upload — see the "re-run" test below.
      expect(result.expected?.title).toBe('How to Bake Sourdough Bread');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('re-runs against a fresh crawl using already-parsed BlogContent, with no .docx file at all', async () => {
    // This is exactly the "re-run" code path: parse once, keep the result,
    // discard/never touch the original file again, then run (possibly much
    // later) purely from the kept BlogContent.
    const docxPath = await writeBlogDocx('for-rerun.docx', [
      paragraph('Meta Title: How to Bake Sourdough Bread | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home with this step-by-step guide.'),
      paragraph('SEO Slug: matching'),
      heading(1, 'How to Bake Sourdough Bread'),
      paragraph('This is the introduction paragraph.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    let expectedContent;
    try {
      expectedContent = await parseBlogDocx(docxPath, matchingPath);
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }

    const runner = new BlogAuditRunner();
    const result = await runner.run(expectedContent, matchingPath, undefined, 'matching.docx');

    expect(result.kind).toBe('blog');
    expect(result.sourcePath).toBe('matching.docx');
    expect(result.seoCheckResults.every((check) => check.status === 'passed')).toBe(true);
  });

  test('fails Meta Title, the missing H2, and the modified paragraph when the live page diverges from the approved document', async () => {
    const docxPath = await writeBlogDocx('mismatched.docx', [
      paragraph('Meta Title: How to Bake Sourdough Bread | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home with this step-by-step guide.'),
      heading(1, 'How to Bake Sourdough Bread'),
      paragraph('This is the introduction paragraph.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, mismatchedPath);

      const metaTitleResult = result.seoCheckResults.find((check) => check.checkType === 'Meta Title');
      const missingHeading = result.seoCheckResults.find((check) => check.checkType === 'H2 #1');
      // Paragraph checks are labeled with a quoted preview of their text, not "Body Paragraph #N" — see compareParagraphs.
      const paragraphResult = result.seoCheckResults.find((check) => check.expected === 'This is the introduction paragraph.');

      expect(metaTitleResult?.status).toBe('failed');
      expect(missingHeading?.status).toBe('failed');
      expect(paragraphResult?.status).toBe('failed');
      expect(result.seoCheckResults.some((check) => check.status === 'passed')).toBe(true);
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('does not report an H2 as missing when the live page wraps it in a nested <span> with an HTML-entity apostrophe', async () => {
    // End-to-end reproduction of the reported bug: the live page's H2 is
    // "<h2><span style=\"font-weight:400;\">...Infra&#8217;s...</span></h2>" —
    // a nested tag plus a numeric entity for a curly apostrophe — while the
    // approved document uses a plain straight apostrophe.
    const docxPath = await writeBlogDocx('heading-entities.docx', [
      paragraph("Meta Title: Why Sri Sreenivasa Infra's Track Record Matters | Example Blog"),
      paragraph("Meta Description: Why Sri Sreenivasa Infra's track record matters for buyers."),
      heading(1, "Why Sri Sreenivasa Infra's Track Record Matters"),
      paragraph('This is the introduction paragraph.'),
      heading(2, "Why Sri Sreenivasa Infra's Track Record Matters Here"),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, headingEntitiesPath);

      const h2Result = result.seoCheckResults.find((check) => check.checkType === 'H2 #1');

      expect(h2Result?.status).toBe('passed');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('does not report introductory paragraphs as missing when the theme places the post header outside <article>', async () => {
    const docxPath = await writeBlogDocx('intro-outside-scope.docx', [
      heading(1, 'Intro Outside Scope'),
      paragraph('First introductory paragraph before any heading.'),
      paragraph('Second introductory paragraph, also before the first H2.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, introOutsideScopePath);

      const firstIntro  = result.seoCheckResults.find((check) => check.expected === 'First introductory paragraph before any heading.');
      const secondIntro = result.seoCheckResults.find((check) => check.expected === 'Second introductory paragraph, also before the first H2.');

      expect(firstIntro?.status).toBe('passed');
      expect(secondIntro?.status).toBe('passed');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('does not report the paragraph introducing a bulleted list as missing, and compares the list items too', async () => {
    const docxPath = await writeBlogDocx('list-layout.docx', [
      heading(1, 'List Layout'),
      paragraph('A well-rounded programme may include:'),
      list(['Item one', 'Item two', 'Item three']),
      paragraph('A normal paragraph after the list.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, listLayoutPath);

      const intro   = result.seoCheckResults.find((check) => check.expected === 'A well-rounded programme may include:');
      const item1   = result.seoCheckResults.find((check) => check.expected === 'Item one');
      const item2   = result.seoCheckResults.find((check) => check.expected === 'Item two');
      const item3   = result.seoCheckResults.find((check) => check.expected === 'Item three');
      const after   = result.seoCheckResults.find((check) => check.expected === 'A normal paragraph after the list.');

      expect(intro?.status).toBe('passed');
      expect(item1?.status).toBe('passed');
      expect(item2?.status).toBe('passed');
      expect(item3?.status).toBe('passed');
      expect(after?.status).toBe('passed');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('correctly compares mixed block structures (blockquote, figcaption, and a collapsed accordion answer)', async () => {
    const docxPath = await writeBlogDocx('mixed-blocks.docx', [
      heading(1, 'Mixed Blocks'),
      paragraph('An ordinary paragraph leading into a quoted passage.'),
      paragraph('A memorable quoted passage from a satisfied customer.'),
      heading(4, 'Is financing available?'),
      paragraph('The finished loaf, fresh out of the oven.'),
      paragraph('Yes, financing is available through our partner lenders.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, mixedBlocksPath);

      const quote      = result.seoCheckResults.find((check) => check.expected === 'A memorable quoted passage from a satisfied customer.');
      const caption     = result.seoCheckResults.find((check) => check.expected === 'The finished loaf, fresh out of the oven.');
      const faqQuestion = result.seoCheckResults.find((check) => check.checkType === 'H4 #1');
      const hiddenAnswer = result.seoCheckResults.find((check) => check.expected === 'Yes, financing is available through our partner lenders.');

      expect(quote?.status).toBe('passed');
      expect(caption?.status).toBe('passed');
      expect(faqQuestion?.status).toBe('passed');
      expect(hiddenAnswer?.status).toBe('passed');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('matches a paragraph whose live-page text is split across several nested inline elements (Gutenberg-style markup)', async () => {
    const docxPath = await writeBlogDocx('split-text-nodes.docx', [
      heading(1, 'Split Text Nodes'),
      paragraph('Our award-winning team delivers exceptional results every time.')
    ]);

    try {
      const runner = new BlogAuditRunner();
      const result = await runner.run(docxPath, splitTextNodesPath);

      const paragraphResult = result.seoCheckResults.find(
        (check) => check.expected === 'Our award-winning team delivers exceptional results every time.'
      );

      expect(paragraphResult?.status).toBe('passed');
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });

  test('BlogBatchRunner shares one real browser across multiple blogs without leaking state between them', async () => {
    // End-to-end confirmation of the performance refactor: a real
    // BlogBatchRunner (real BrowserManager, real BlogAuditRunner) processes
    // two different live pages that share one launched browser process. Each
    // must still get its own correct, fully independent result — proving
    // per-item BrowserContext isolation holds even though the browser itself
    // is shared.
    const matchingDocxPath = await writeBlogDocx('batch-matching.docx', [
      paragraph('Meta Title: How to Bake Sourdough Bread | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home with this step-by-step guide.'),
      heading(1, 'How to Bake Sourdough Bread'),
      paragraph('This is the introduction paragraph.'),
      heading(2, 'Ingredients'),
      paragraph('Flour, water, salt, and a starter.')
    ]);
    const headingEntitiesDocxPath = await writeBlogDocx('batch-heading-entities.docx', [
      paragraph("Meta Title: Why Sri Sreenivasa Infra's Track Record Matters | Example Blog"),
      paragraph("Meta Description: Why Sri Sreenivasa Infra's track record matters for buyers."),
      heading(1, "Why Sri Sreenivasa Infra's Track Record Matters"),
      paragraph('This is the introduction paragraph.'),
      heading(2, "Why Sri Sreenivasa Infra's Track Record Matters Here"),
      paragraph('Flour, water, salt, and a starter.')
    ]);

    try {
      const batchRunner = new BlogBatchRunner();
      const results = await batchRunner.run([
        { docxSource: matchingDocxPath, url: matchingPath, filename: 'matching.docx' },
        { docxSource: headingEntitiesDocxPath, url: headingEntitiesPath, filename: 'heading-entities.docx' }
      ]);

      expect(results.length).toBe(2);
      expect(results[0]?.status).toBe('done');
      expect(results[1]?.status).toBe('done');
      // "skipped" is expected here too — this docx has no "SEO Slug:" field,
      // so the Blog URL / Slug check is legitimately skipped, not failed.
      expect(results[0]?.result?.seoCheckResults.every((c) => c.status === 'passed' || c.status === 'skipped')).toBe(true);

      const h2Result = results[1]?.result?.seoCheckResults.find((c) => c.checkType === 'H2 #1');
      expect(h2Result?.status).toBe('passed');
    } finally {
      await rm(path.dirname(matchingDocxPath), { recursive: true, force: true });
      await rm(path.dirname(headingEntitiesDocxPath), { recursive: true, force: true });
    }
  });
});

// --- Minimal .docx fixture builder (mirrors tests/unit/docx-blog-parser.test.ts) ---

interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
  headingLevel?: 1 | 2 | 3 | 4;
}

interface ListBlock {
  kind: 'list';
  items: string[];
}

type DocBlock = ParagraphBlock | ListBlock;

function paragraph(text: string): ParagraphBlock {
  return { kind: 'paragraph', text };
}

function heading(level: 1 | 2 | 3 | 4, text: string): ParagraphBlock {
  return { kind: 'paragraph', text, headingLevel: level };
}

/** A real Word bulleted list (genuine numbering, not typed bullet characters) — mammoth renders this as a real `<ul>/<li>`, unlike every other paragraph style. */
function list(items: string[]): ListBlock {
  return { kind: 'list', items };
}

async function writeBlogDocx(fileName: string, blocks: DocBlock[]): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'seo-qa-blog-runner-spec-'));
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);

  const hasList = blocks.some((block) => block.kind === 'list');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(hasList ? contentTypesXmlWithNumbering : contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'word/document.xml': strToU8(documentXml(blocks))
  };
  if (hasList) {
    files['word/_rels/document.xml.rels'] = strToU8(documentRelationshipsXmlWithNumbering);
    files['word/numbering.xml'] = strToU8(numberingXml);
  }

  const archive = zipSync(files);

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
  if (block.kind === 'list') {
    return block.items
      .map(
        (item) =>
          `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(item)}</w:t></w:r></w:p>`
      )
      .join('');
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

const contentTypesXmlWithNumbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const documentRelationshipsXmlWithNumbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#8226;"/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;
