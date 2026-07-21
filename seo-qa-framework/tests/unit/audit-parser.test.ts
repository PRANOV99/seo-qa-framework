import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { CsvAuditSheetParser } from '../../src/parsers/csv-parser.js';
import { getAuditSheetFormat, createAuditSheetParser } from '../../src/parsers/parser-factory.js';
import { XlsxAuditSheetParser } from '../../src/parsers/xlsx-parser.js';

describe('SEO audit parser', () => {
  it('reads CSV files, detects columns, and returns structured audit rows', async () => {
    const filePath = await writeTempFile(
      'audit.csv',
      [
        'Page URL,Problem,Recommended Value,Current Value,Priority,Comments',
        'https://example.com/,Missing title,New homepage title,,High,Update title tag',
        'https://example.com/about,Meta description too short,About page summary,Short,Medium,'
      ].join('\n')
    );

    const result = await new CsvAuditSheetParser().parse(filePath);

    assert.equal(result.format, 'csv');
    assert.equal(result.detectedColumns.url, 'Page URL');
    assert.equal(result.detectedColumns.checkType, 'Problem');
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows[0], {
      url: 'https://example.com/',
      checkType: 'Missing title',
      issueType: 'title',
      expectedValue: 'New homepage title',
      actualValue: undefined,
      severity: 'high',
      notes: 'Update title tag',
      sourceRowNumber: 2,
      raw: {
        'Page URL': 'https://example.com/',
        Problem: 'Missing title',
        'Recommended Value': 'New homepage title',
        'Current Value': '',
        Priority: 'High',
        Comments: 'Update title tag'
      }
    });
    assert.equal(result.rows[1]?.issueType, 'metaDescription');
  });

  it('reads XLSX Excel files and detects issue types from audit language', async () => {
    const filePath = await writeTempXlsx('audit.xlsx', [
      ['Address', 'SEO Issue', 'Expected', 'Actual', 'Severity', 'Notes'],
      [
        'https://example.com/products',
        'Canonical URL is wrong',
        'https://example.com/products',
        'https://example.com/product',
        'critical',
        'Canonical fix from sheet'
      ],
      [
        'https://example.com/blog',
        'Image alt text missing',
        'Descriptive alt text',
        '',
        'low',
        ''
      ]
    ]);

    const result = await new XlsxAuditSheetParser().parse(filePath);

    assert.equal(result.format, 'xlsx');
    assert.equal(result.detectedColumns.url, 'Address');
    assert.equal(result.detectedColumns.checkType, 'SEO Issue');
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.issueType, 'canonical');
    assert.equal(result.rows[0]?.severity, 'critical');
    assert.equal(result.rows[1]?.issueType, 'imageAlt');
  });

  it('creates the correct parser from file extension', () => {
    assert.equal(getAuditSheetFormat('audit.csv'), 'csv');
    assert.equal(getAuditSheetFormat('audit.xlsx'), 'xlsx');
    assert.ok(createAuditSheetParser('audit.csv') instanceof CsvAuditSheetParser);
    assert.ok(createAuditSheetParser('audit.xlsx') instanceof XlsxAuditSheetParser);
    assert.throws(() => getAuditSheetFormat('audit.xls'), /Unsupported audit sheet format/);
  });
});

async function writeTempFile(fileName: string, content: string): Promise<string> {
  const directory = path.join(tmpdir(), 'seo-qa-parser-tests');
  await mkdir(directory, { recursive: true });

  const filePath = path.join(directory, `${Date.now()}-${fileName}`);
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
    <sheet name="SEO Audit" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const workbookRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
