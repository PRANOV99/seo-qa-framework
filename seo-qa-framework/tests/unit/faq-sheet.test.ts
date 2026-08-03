import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { detectFaqColumns } from '../../src/parsers/faq-sheet-detector.js';
import { groupFaqRows, type RawFaqRow } from '../../src/parsers/faq-grouping.js';
import { tryParseFaqCsv } from '../../src/parsers/faq-csv-parser.js';
import { tryParseFaqXlsx } from '../../src/parsers/faq-xlsx-parser.js';

describe('detectFaqColumns', () => {
  it('detects the exact URL/FAQs/Answer header shape', () => {
    const detected = detectFaqColumns(['URL', 'FAQs', 'Answer']);
    assert.deepEqual(detected, { urlIndex: 0, questionIndex: 1, answerIndex: 2 });
  });

  it('is case/whitespace-insensitive and tolerates column order or aliases', () => {
    assert.ok(detectFaqColumns([' url ', 'Question', 'Answers']));
    assert.ok(detectFaqColumns(['Answer', 'URL', 'FAQ']));
  });

  it('does not match a normal audit sheet header row', () => {
    assert.equal(detectFaqColumns(['Page URL', 'Problem', 'Recommended Value', 'Priority']), undefined);
    assert.equal(detectFaqColumns(['Current URL', 'Suggested Meta Title', 'Suggested H1']), undefined);
  });
});

describe('groupFaqRows', () => {
  function row(partial: Partial<RawFaqRow> & { sourceRowNumber: number }): RawFaqRow {
    return { urlText: '', question: '', answer: '', ...partial };
  }

  it('groups a hyperlinked row and its blank-URL continuation rows into one page', () => {
    const { faqGroups } = groupFaqRows([
      row({ urlText: 'Home page', urlHyperlink: 'https://example.com/', question: 'Q1', answer: 'A1', sourceRowNumber: 2 }),
      row({ question: 'Q2', answer: 'A2', sourceRowNumber: 3 }),
      row({ question: 'Q3', answer: 'A3', sourceRowNumber: 4 })
    ]);

    assert.equal(faqGroups.length, 1);
    assert.equal(faqGroups[0]?.url, 'https://example.com/');
    assert.equal(faqGroups[0]?.faqs.length, 3);
  });

  it('skips a fully-blank separator row without breaking the currently-open group', () => {
    const { faqGroups } = groupFaqRows([
      row({ urlText: 'Palladio', urlHyperlink: 'https://example.com/palladio', question: 'Q1', answer: 'A1', sourceRowNumber: 2 }),
      row({ sourceRowNumber: 3 }), // fully blank spacer row
      row({ urlText: 'Sanzio', urlHyperlink: 'https://example.com/sanzio', question: 'Q2', answer: 'A2', sourceRowNumber: 4 })
    ]);

    assert.equal(faqGroups.length, 2);
    assert.equal(faqGroups[0]?.faqs.length, 1);
    assert.equal(faqGroups[1]?.faqs.length, 1);
  });

  it('starts a new group for a hyperlinked "divider" row with a blank question, contributing zero FAQs of its own', () => {
    const { faqGroups } = groupFaqRows([
      row({ urlText: 'Blog A', urlHyperlink: 'https://example.com/blog-a', question: 'Q1', answer: 'A1', sourceRowNumber: 2 }),
      row({ sourceRowNumber: 3 }), // blank separator — every real page block in the sheet ends with one
      // A real pattern from the JRC sheet: hyperlink + blank question + a
      // one-line description instead of a real FAQ pair, followed by that
      // same page's remaining real FAQ in the next (blank-URL) row.
      row({ urlText: 'Blog B', urlHyperlink: 'https://example.com/blog-b', answer: 'Just an intro paragraph.', sourceRowNumber: 4 }),
      row({ question: 'Q2', answer: 'A2', sourceRowNumber: 5 })
    ]);

    assert.equal(faqGroups.length, 2);
    assert.equal(faqGroups[0]?.url, 'https://example.com/blog-a');
    assert.equal(faqGroups[0]?.faqs.length, 1);
    assert.equal(faqGroups[1]?.url, 'https://example.com/blog-b');
    assert.equal(faqGroups[1]?.faqs.length, 1, 'The divider row itself contributes no FAQ; only Q2 belongs to Blog B.');
  });

  it('resolves an ENTIRE block to its one hyperlink even when that hyperlink sits in the MIDDLE of the block, not the first row', () => {
    // Reproduces the real "JRC Sanzio" block from the source sheet: three
    // real questions in blank-URL rows BEFORE the hyperlink, anchored on a
    // row in the middle, then more blank-URL rows after it — all one block,
    // no blank separator anywhere inside it. Previously, the rows before
    // the hyperlink were wrongly attributed to whichever OTHER page's
    // hyperlink preceded this block, because grouping was triggered by
    // "did this row's URL cell go non-blank", not by the actual block
    // boundary (a fully-blank row).
    const { faqGroups } = groupFaqRows([
      row({ question: 'Why was French Art Deco chosen?', answer: 'Because of its timeless appeal.', sourceRowNumber: 20 }),
      row({ question: 'How does a 39-villa community feel?', answer: 'Quieter and more private.', sourceRowNumber: 21 }),
      row({ urlText: 'JRC Sanzio', urlHyperlink: 'https://example.com/jrc-sanzio', question: 'How does it balance classic and modern?', answer: 'By pairing Art Deco facades with modern planning.', sourceRowNumber: 24 }),
      row({ question: 'What makes it different from a conventional community?', answer: 'Its combination of architecture and scale.', sourceRowNumber: 25 })
    ]);

    assert.equal(faqGroups.length, 1);
    assert.equal(faqGroups[0]?.url, 'https://example.com/jrc-sanzio');
    assert.equal(faqGroups[0]?.faqs.length, 4, 'All four questions belong to jrc-sanzio, including the three in blank-URL rows before the hyperlink row.');
  });

  it('does not let an un-hyperlinked, differently-labelled section swallow into the previous hyperlinked block when there is no blank row between them', () => {
    // Reproduces a real regression: the "Whitefield vs. Sarjapur" block runs
    // straight (zero blank rows) into the sheet's un-hyperlinked "NEW FAQs"
    // section (repeated "Home page"/"Wildwood"/"Kanso" labels, no link of
    // their own). A block-wide "one hyperlink resolves everything in the
    // block" rule wrongly attributed all of those unrelated pricing/RERA
    // questions to the Whitefield blog page. Each of those rows restates
    // its OWN non-blank label, so they must start their own new identity
    // instead of inheriting the block's hyperlink.
    const { faqGroups, unresolvedFaqGroups } = groupFaqRows([
      row({ question: 'Why are Whitefield and Sarjapur compared?', answer: 'Both are growing corridors.', sourceRowNumber: 150 }),
      row({ urlText: 'Whitefield vs. Sarjapur', urlHyperlink: 'https://example.com/blogs/whitefield-vs-sarjapur', question: 'Is Whitefield better for rental income?', answer: 'Depends on the micro-market.', sourceRowNumber: 152 }),
      row({ question: 'Why do prices differ?', answer: 'Infrastructure and demand.', sourceRowNumber: 155 }),
      row({ question: 'NEW FAQs', sourceRowNumber: 156 }), // question-only divider, no answer, no url
      row({ urlText: 'Home page', question: 'What is the price per sq ft?', answer: 'Between X and Y.', sourceRowNumber: 158 }),
      row({ urlText: 'Home page', question: 'What are the RERA numbers?', answer: 'PRM/KA/...', sourceRowNumber: 159 }),
      row({ urlText: 'Wildwood', question: 'What is ClubWild?', answer: 'The clubhouse.', sourceRowNumber: 164 })
    ]);

    assert.equal(faqGroups.length, 1);
    assert.equal(faqGroups[0]?.url, 'https://example.com/blogs/whitefield-vs-sarjapur');
    assert.equal(faqGroups[0]?.faqs.length, 3, 'Only the three real Whitefield questions belong to this URL.');

    assert.equal(unresolvedFaqGroups.length, 2);
    assert.equal(unresolvedFaqGroups[0]?.label, 'Home page');
    assert.equal(unresolvedFaqGroups[0]?.faqCount, 2);
    assert.equal(unresolvedFaqGroups[1]?.label, 'Wildwood');
    assert.equal(unresolvedFaqGroups[1]?.faqCount, 1);
  });

  it('reports a page label with no hyperlink as unresolved instead of guessing a URL', () => {
    const { faqGroups, unresolvedFaqGroups } = groupFaqRows([
      row({ urlText: 'Wildwood', question: 'Q1', answer: 'A1', sourceRowNumber: 158 }),
      row({ urlText: 'Wildwood', question: 'Q2', answer: 'A2', sourceRowNumber: 159 })
    ]);

    assert.equal(faqGroups.length, 0);
    assert.equal(unresolvedFaqGroups.length, 1);
    assert.equal(unresolvedFaqGroups[0]?.label, 'Wildwood');
    assert.equal(unresolvedFaqGroups[0]?.faqCount, 2, 'Consecutive rows repeating the same label must merge into one unresolved group, not two.');
  });

  it('treats a repeated-but-interrupted label as two separate unresolved groups', () => {
    const { unresolvedFaqGroups } = groupFaqRows([
      row({ urlText: 'Wildwood', question: 'Q1', answer: 'A1', sourceRowNumber: 164 }),
      row({ urlText: 'Kanso', question: 'Q2', answer: 'A2', sourceRowNumber: 166 }),
      row({ urlText: 'Wildwood', question: 'Q3', answer: 'A3', sourceRowNumber: 167 })
    ]);

    assert.equal(unresolvedFaqGroups.length, 3, 'Wildwood, Kanso, Wildwood again — non-contiguous repeats are not merged.');
  });

  it('drops a row with a question but no answer (e.g. a section-title row) without producing an FAQ', () => {
    const { faqGroups } = groupFaqRows([
      row({ urlText: 'Blog', urlHyperlink: 'https://example.com/blog', question: 'Q1', answer: 'A1', sourceRowNumber: 2 }),
      row({ question: 'NEW FAQs', sourceRowNumber: 3 }), // question-only divider, no answer
      row({ question: 'Q2', answer: 'A2', sourceRowNumber: 4 })
    ]);

    assert.equal(faqGroups[0]?.faqs.length, 2, 'Only Q1 and Q2 count; the question-only divider row is dropped.');
  });
});

describe('tryParseFaqCsv', () => {
  it('resolves a group only when the URL cell is a literal absolute URL', async () => {
    const filePath = await writeTempFile(
      'faq.csv',
      [
        'URL,FAQs,Answer',
        'https://example.com/,What is this site?,It is an example.',
        ',Another question?,Another answer.',
        ',,', // blank separator row — real sheets always have one between distinct pages
        'Just a label with no link,Unlinked question?,Unlinked answer.'
      ].join('\n')
    );

    const result = await tryParseFaqCsv(filePath);

    assert.ok(result);
    assert.equal(result!.mode, 'faq');
    assert.equal(result!.faqGroups?.length, 1);
    assert.equal(result!.faqGroups?.[0]?.faqs.length, 2);
    assert.equal(result!.unresolvedFaqGroups?.length, 1);
    assert.equal(result!.unresolvedFaqGroups?.[0]?.label, 'Just a label with no link');
    assert.equal(result!.unresolvedFaqGroups?.[0]?.faqCount, 1);
  });

  it('returns undefined for a non-FAQ sheet so the caller falls back to the normal parser', async () => {
    const filePath = await writeTempFile(
      'not-faq.csv',
      ['Page URL,Problem,Recommended Value', 'https://example.com/,Missing title,New title'].join('\n')
    );

    const result = await tryParseFaqCsv(filePath);
    assert.equal(result, undefined);
  });
});

describe('tryParseFaqXlsx', () => {
  it('extracts the real hyperlink target as the group URL, not the cell label text', async () => {
    const filePath = await writeTempFaqXlsx(
      'faq.xlsx',
      [
        ['URL', 'FAQs', 'Answer'],
        ['Home page', 'What makes it different?', 'A design-led community.'],
        ['', 'How big is it?', '12.7 acres.'],
        ['', '', ''],
        ['JRC Palladio', 'Why Greco-Roman?', 'Classical design principles.']
      ],
      [
        { row: 2, col: 1, target: 'https://example.com/' },
        { row: 5, col: 1, target: 'https://example.com/jrc-palladio' }
      ]
    );

    const result = await tryParseFaqXlsx(filePath);

    assert.ok(result);
    assert.equal(result!.mode, 'faq');
    assert.equal(result!.faqGroups?.length, 2);
    assert.equal(result!.faqGroups?.[0]?.url, 'https://example.com/');
    assert.equal(result!.faqGroups?.[0]?.faqs.length, 2);
    assert.equal(result!.faqGroups?.[1]?.url, 'https://example.com/jrc-palladio');
  });

  it('returns undefined for a normal (non-FAQ) xlsx sheet', async () => {
    const filePath = await writeTempFaqXlsx(
      'not-faq.xlsx',
      [
        ['Current URL', 'Suggested Meta Title'],
        ['https://example.com/', 'New Title']
      ],
      []
    );

    const result = await tryParseFaqXlsx(filePath);
    assert.equal(result, undefined);
  });
});

// ── Test fixture helpers ────────────────────────────────────────────────────

async function writeTempFile(fileName: string, content: string): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-faq-parser-tests');
  await mkdir(directory, { recursive: true });

  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
  await writeFile(filePath, content, 'utf8');

  return filePath;
}

interface HyperlinkSpec {
  row: number;
  col: number;
  target: string;
}

async function writeTempFaqXlsx(fileName: string, rows: string[][], hyperlinks: HyperlinkSpec[]): Promise<string> {
  const filePath = await writeTempFile(fileName, '');
  const hyperlinkEntries = hyperlinks.map((link, index) => ({ ...link, id: `rId${index + 1}` }));

  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelationshipsXml),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(rows, hyperlinkEntries)),
    ...(hyperlinkEntries.length > 0
      ? { 'xl/worksheets/_rels/sheet1.xml.rels': strToU8(sheetRelationshipsXml(hyperlinkEntries)) }
      : {})
  });

  await writeFile(filePath, archive);

  return filePath;
}

function worksheetXml(rows: string[][], hyperlinks: Array<HyperlinkSpec & { id: string }>): string {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cellXml = row
        .map((value, columnIndex) => {
          if (value === '') return '';
          const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join('');

      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join('');

  const hyperlinksXml =
    hyperlinks.length > 0
      ? `<hyperlinks>${hyperlinks
          .map((link) => `<hyperlink ref="${columnName(link.col)}${link.row}" r:id="${link.id}"/>`)
          .join('')}</hyperlinks>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>${rowXml}</sheetData>
  ${hyperlinksXml}
</worksheet>`;
}

function sheetRelationshipsXml(hyperlinks: Array<HyperlinkSpec & { id: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${hyperlinks
    .map(
      (link) =>
        `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${link.target}" TargetMode="External"/>`
    )
    .join('')}
</Relationships>`;
}

function columnName(index: number): string {
  let dividend = index;
  let name = '';

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return name;
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
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
