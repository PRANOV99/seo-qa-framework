import path from 'node:path';
import type { AuditSheetFormat } from '../types/audit.js';
import type { AuditSheetParser } from './audit-sheet-parser.js';
import { CsvAuditSheetParser } from './csv-parser.js';
import { XlsxAuditSheetParser } from './xlsx-parser.js';

export function createAuditSheetParser(filePath: string): AuditSheetParser {
  const format = getAuditSheetFormat(filePath);

  switch (format) {
    case 'csv':
      return new CsvAuditSheetParser();
    case 'xlsx':
      return new XlsxAuditSheetParser();
  }
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
