import { readSheet } from 'read-excel-file/node';
import type { AuditParseResult } from '../types/audit.js';
import type { AuditSheetParser } from './audit-sheet-parser.js';
import { normalizeAuditRows } from './audit-row-normalizer.js';

export class XlsxAuditSheetParser implements AuditSheetParser {
  async parse(filePath: string): Promise<AuditParseResult> {
    const records = await readSheet(filePath);
    const normalizedRows = normalizeAuditRows(records);

    return {
      sourcePath: filePath,
      format: 'xlsx',
      mode: normalizedRows.mode,
      detectedColumns: normalizedRows.detectedColumns,
      detectedFields: normalizedRows.detectedFields,
      rows: normalizedRows.rows
    };
  }
}
