import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { test, expect } from '../src/fixtures/test-fixtures.js';
import { BlogAuditRunner } from '../src/runner/blog-audit-runner.js';

test.describe('BlogAuditRunner', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The blog audit runner launches its own browser internally; one run covers the behaviour.'
  );

  let server: Server;
  let baseUrl: string;
  let matchingPath: string;
  let mismatchedPath: string;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (req.url === '/blog/matching') {
        res.end(`<!doctype html>
          <html>
            <head>
              <title>How to Bake Sourdough Bread | Example Blog</title>
              <meta name="description" content="Learn how to bake sourdough bread at home with this step-by-step guide.">
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
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('passes every comparison when the live page matches the approved document exactly', async () => {
    const docxPath = await writeBlogDocx('matching.docx', [
      paragraph('Meta Title: How to Bake Sourdough Bread | Example Blog'),
      paragraph('Meta Description: Learn how to bake sourdough bread at home with this step-by-step guide.'),
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
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
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
      const paragraphResult = result.seoCheckResults.find((check) => check.checkType === 'Body Paragraph #1');

      expect(metaTitleResult?.status).toBe('failed');
      expect(missingHeading?.status).toBe('failed');
      expect(paragraphResult?.status).toBe('failed');
      expect(result.seoCheckResults.some((check) => check.status === 'passed')).toBe(true);
    } finally {
      await rm(path.dirname(docxPath), { recursive: true, force: true });
    }
  });
});

// --- Minimal .docx fixture builder (mirrors tests/unit/docx-blog-parser.test.ts) ---

interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
  headingLevel?: 1 | 2 | 3;
}

function paragraph(text: string): ParagraphBlock {
  return { kind: 'paragraph', text };
}

function heading(level: 1 | 2 | 3, text: string): ParagraphBlock {
  return { kind: 'paragraph', text, headingLevel: level };
}

async function writeBlogDocx(fileName: string, blocks: ParagraphBlock[]): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'seo-qa-blog-runner-spec-'));
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);

  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'word/document.xml': strToU8(documentXml(blocks))
  });

  await writeFile(filePath, archive);

  return filePath;
}

function documentXml(blocks: ParagraphBlock[]): string {
  const bodyXml = blocks.map(renderParagraph).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`;
}

function renderParagraph(block: ParagraphBlock): string {
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
