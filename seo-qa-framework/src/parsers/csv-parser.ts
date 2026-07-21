import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import type { AuditParseResult } from '../types/audit.js';
import type { AuditSheetParser } from './audit-sheet-parser.js';
import { normalizeAuditRows } from './audit-row-normalizer.js';

export class CsvAuditSheetParser implements AuditSheetParser {
  async parse(filePath: string): Promise<AuditParseResult> {
    const csv = await readFile(filePath, 'utf8');
    const records = parse(csv, {
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true
    }) as string[][];
    const normalizedRows = normalizeAuditRows(records);

    return {
      sourcePath: filePath,
      format: 'csv',
      mode: normalizedRows.mode,
      detectedColumns: normalizedRows.detectedColumns,
      detectedFields: normalizedRows.detectedFields,
      rows: normalizedRows.rows
    };
  }
}
