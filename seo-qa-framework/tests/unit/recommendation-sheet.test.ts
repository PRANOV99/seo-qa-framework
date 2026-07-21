import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { CsvAuditSheetParser } from '../../src/parsers/csv-parser.js';
import { XlsxAuditSheetParser } from '../../src/parsers/xlsx-parser.js';

describe('Recommendation sheet detection (CSV)', () => {
  it('detects recommendation mode and expands each non-empty field into its own row', async () => {
    const filePath = await writeTempFile(
      'recommendation.csv',
      [
        'Current URL,Suggested Meta Title,Suggested Meta Description,Canonical Tag,Suggested H1,Suggested H2',
        'https://example.com/,New Home Title,A better description,https://example.com/,Welcome,Our Services',
        'https://example.com/about,About Us Title,,,,'
      ].join('\n')
    );

    const result = await new CsvAuditSheetParser().parse(filePath);

    assert.equal(result.mode, 'recommendation');
    assert.equal(result.detectedColumns.url, 'Current URL');
    assert.ok(result.detectedFields && result.detectedFields.length >= 4);

    // Row 1 has all 5 fields populated -> 5 SeoAuditRow entries.
    const rowOneEntries = result.rows.filter((row) => row.url === 'https://example.com/');
    assert.equal(rowOneEntries.length, 5);
    assert.ok(rowOneEntries.some((row) => row.issueType === 'title' && row.expectedValue === 'New Home Title'));
    assert.ok(
      rowOneEntries.some((row) => row.issueType === 'metaDescription' && row.expectedValue === 'A better description')
    );
    assert.ok(rowOneEntries.some((row) => row.issueType === 'canonical'));
    assert.ok(rowOneEntries.some((row) => row.issueType === 'h1' && row.expectedValue === 'Welcome'));
    assert.ok(rowOneEntries.some((row) => row.issueType === 'h2' && row.expectedValue === 'Our Services'));

    // Row 2 only has Suggested Meta Title populated -> only 1 entry (empty fields are skipped).
    const rowTwoEntries = result.rows.filter((row) => row.url === 'https://example.com/about');
    assert.equal(rowTwoEntries.length, 1);
    assert.equal(rowTwoEntries[0]?.issueType, 'title');
    assert.equal(rowTwoEntries[0]?.expectedValue, 'About Us Title');
  });

  it('still parses traditional issue-based sheets the same way as before (no regression)', async () => {
    const filePath = await writeTempFile(
      'issue-based.csv',
      [
        'Page URL,Problem,Recommended Value,Current Value,Priority,Comments',
        'https://example.com/,Missing title,New homepage title,,High,Update title tag'
      ].join('\n')
    );

    const result = await new CsvAuditSheetParser().parse(filePath);

    assert.equal(result.mode, 'issueBased');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.issueType, 'title');
  });

  it('treats multiple suggested-field columns as decisive even alongside a generic "Recommendation" column', async () => {
    const filePath = await writeTempFile(
      'ambiguous.csv',
      [
        'Current URL,Recommendation,Suggested Meta Title,Suggested H1',
        'https://example.com/,Improve on-page SEO,Better Title,Better H1'
      ].join('\n')
    );

    const result = await new CsvAuditSheetParser().parse(filePath);

    assert.equal(result.mode, 'recommendation');
    assert.equal(result.rows.length, 2);
  });

  it('detects redirect and broken-link recommendation columns', async () => {
    const filePath = await writeTempFile(
      'redirect-and-links.csv',
      [
        'Current URL,Suggested Meta Title,Redirect To,Broken Link Check',
        'https://example.com/old,New Title,https://example.com/new,Yes'
      ].join('\n')
    );

    const result = await new CsvAuditSheetParser().parse(filePath);

    assert.equal(result.mode, 'recommendation');
    const entries = result.rows.filter((row) => row.url === 'https://example.com/old');
    assert.ok(entries.some((row) => row.issueType === 'redirect'));
    assert.ok(entries.some((row) => row.issueType === 'brokenLink'));
  });
});

describe('Recommendation sheet detection (XLSX)', () => {
  it('detects recommendation mode from an Excel sheet with Open Graph and Twitter Card columns', async () => {
    const filePath = await writeTempXlsx('recommendation.xlsx', [
      [
        'Current URL',
        'Suggested Meta Title',
        'Suggested Meta Description',
        'Suggested H1',
        'Open Graph Title',
        'Twitter Title'
      ],
      [
        'https://example.com/products',
        'Products | Example',
        'Browse our products',
        'Our Products',
        'Products | Example',
        'Products | Example'
      ]
    ]);

    const result = await new XlsxAuditSheetParser().parse(filePath);

    assert.equal(result.mode, 'recommendation');
    const entries = result.rows.filter((row) => row.url === 'https://example.com/products');
    assert.equal(entries.length, 5);
    assert.ok(entries.some((row) => row.issueType === 'openGraph'));
    assert.ok(entries.some((row) => row.issueType === 'twitterCard'));
    assert.ok(entries.some((row) => row.issueType === 'title'));
  });
});

async function writeTempFile(fileName: string, content: string): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-parser-tests');
  await mkdir(directory, { recursive: true });

  const filePath = path.join(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`);
  await writeFile(filePath, content, 'utf8');

  return filePath;
}

async function writeTempXlsx(fileName: string, rows: string[][]): Promise<string> {
  const filePath = await writeTempFile(fileName, '');
  const archive = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelationshipsXml),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(rows))
  });

  await writeFile(filePath, archive);

  return filePath;
}

function worksheetXml(rows: string[][]): string {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cellXml = row
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join('');

      return `<row r="${rowIndex + 1}">${cellXml}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
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
    <sheet name="Recommendations" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
