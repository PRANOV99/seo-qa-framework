import ExcelJS from 'exceljs';
import type { Cell, CellValue } from 'exceljs';
import type { AuditParseResult } from '../types/audit.js';
import { detectFaqColumns, type FaqColumnIndexes } from './faq-sheet-detector.js';
import { groupFaqRows, type RawFaqRow } from './faq-grouping.js';

const HEADER_SEARCH_ROWS = 10;

/**
 * Reads a cell's plain text, unwrapping the shapes read-excel-file's own
 * xlsx-parser.ts never has to deal with (exceljs surfaces hyperlink cells
 * as { text, hyperlink } and rich-text cells as { richText: [...] }).
 */
function cellText(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join('').trim();
    }
    if ('text' in value) {
      return String(value.text ?? '').trim();
    }
  }

  return String(value).trim();
}

/**
 * Resolves a cell to the one that actually carries its value/hyperlink —
 * itself when unmerged, or the merge's anchor cell when merged. Reading
 * cell.text directly on a merged non-anchor cell returns garbage in
 * exceljs (confirmed empirically against the real FAQ sheet), so every
 * read in this parser goes through this first.
 */
function masterCell(cell: Cell): Cell {
  return cell.isMerged ? cell.master : cell;
}

export async function tryParseFaqXlsx(filePath: string): Promise<AuditParseResult | undefined> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return undefined;
  }

  const columnCount = Math.min(Math.max(worksheet.columnCount, 3), 20);
  let headerRowNumber: number | undefined;
  let columns: FaqColumnIndexes | undefined;

  for (let rowNumber = 1; rowNumber <= Math.min(HEADER_SEARCH_ROWS, worksheet.rowCount); rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const headers: string[] = [];
    for (let col = 1; col <= columnCount; col++) {
      headers.push(cellText(masterCell(row.getCell(col)).value));
    }

    const detected = detectFaqColumns(headers);
    if (detected) {
      headerRowNumber = rowNumber;
      columns = detected;
      break;
    }
  }

  if (headerRowNumber === undefined || !columns) {
    return undefined;
  }

  const rawRows: RawFaqRow[] = [];

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const urlCell = masterCell(row.getCell(columns.urlIndex + 1));

    rawRows.push({
      urlText: cellText(urlCell.value),
      urlHyperlink: urlCell.hyperlink || undefined,
      question: cellText(masterCell(row.getCell(columns.questionIndex + 1)).value),
      answer: cellText(masterCell(row.getCell(columns.answerIndex + 1)).value),
      sourceRowNumber: rowNumber
    });
  }

  const { faqGroups, unresolvedFaqGroups } = groupFaqRows(rawRows);

  return {
    sourcePath: filePath,
    format: 'xlsx',
    mode: 'faq',
    detectedColumns: {},
    rows: [],
    faqGroups,
    unresolvedFaqGroups
  };
}
