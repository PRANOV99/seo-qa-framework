import path from 'node:path';
import type { AuditParseResult, AuditSheetFormat } from '../types/audit.js';
import type { AuditSheetParser } from './audit-sheet-parser.js';
import { CsvAuditSheetParser } from './csv-parser.js';
import { XlsxAuditSheetParser } from './xlsx-parser.js';
import { tryParseFaqXlsx } from './faq-xlsx-parser.js';
import { tryParseFaqCsv } from './faq-csv-parser.js';

export function createAuditSheetParser(filePath: string): AuditSheetParser {
  const format = getAuditSheetFormat(filePath);

  switch (format) {
    case 'csv':
      return new CsvAuditSheetParser();
    case 'xlsx':
      return new XlsxAuditSheetParser();
  }
}

/**
 * Parses an uploaded audit sheet, auto-detecting an FAQ accordion sheet
 * (header row exactly URL / FAQs / Answer) before falling back to the
 * normal issueBased/recommendation parsing. Kept as a separate entry point
 * from createAuditSheetParser() so the existing sheet-workflow parsers are
 * never touched by this branch — every existing caller of
 * createAuditSheetParser(...).parse(...) continues to work unchanged;
 * callers that should also recognize FAQ sheets (the runner, the /parse
 * preview route) use this instead.
 */
export async function parseAuditSheet(filePath: string): Promise<AuditParseResult> {
  const format = getAuditSheetFormat(filePath);
  const faqResult = format === 'xlsx' ? await tryParseFaqXlsx(filePath) : await tryParseFaqCsv(filePath);

  if (faqResult) {
    return faqResult;
  }

  return createAuditSheetParser(filePath).parse(filePath);
}

export function getAuditSheetFormat(filePath: string): AuditSheetFormat {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv') {
    return 'csv';
  }

  if (extension === '.xlsx') {
    return 'xlsx';
  }

  throw new Error(`Unsupported audit sheet format: ${extension || 'unknown'}`);
}
