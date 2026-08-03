import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import type { AuditParseResult } from '../types/audit.js';
import { detectFaqColumns, type FaqColumnIndexes } from './faq-sheet-detector.js';
import { groupFaqRows, type RawFaqRow } from './faq-grouping.js';

const HEADER_SEARCH_ROWS = 10;

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

/**
 * CSV has no concept of a cell hyperlink, so — unlike the xlsx FAQ parser —
 * a group can only resolve to a real URL when the URL column's text is
 * itself a literal absolute http(s) URL. Anything else (a page label with
 * no real link, exactly the same gap the real xlsx sheet has for some
 * pages) is reported as unresolved rather than guessed at.
 */
export async function tryParseFaqCsv(filePath: string): Promise<AuditParseResult | undefined> {
  const csv = await readFile(filePath, 'utf8');
  const records = parse(csv, {
    bom: true,
    relaxColumnCount: true,
    skipEmptyLines: true,
    trim: true
  }) as string[][];

  let headerRowIndex: number | undefined;
  let columns: FaqColumnIndexes | undefined;

  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, records.length); i++) {
    const detected = detectFaqColumns(records[i] ?? []);
    if (detected) {
      headerRowIndex = i;
      columns = detected;
      break;
    }
  }

  if (headerRowIndex === undefined || !columns) {
    return undefined;
  }

  const rawRows: RawFaqRow[] = records.slice(headerRowIndex + 1).map((record, index) => {
    const urlText = (record[columns.urlIndex] ?? '').trim();

    return {
      urlText,
      urlHyperlink: isAbsoluteUrl(urlText) ? urlText : undefined,
      question: (record[columns.questionIndex] ?? '').trim(),
      answer: (record[columns.answerIndex] ?? '').trim(),
      sourceRowNumber: headerRowIndex + index + 2
    };
  });

  const { faqGroups, unresolvedFaqGroups } = groupFaqRows(rawRows);

  return {
    sourcePath: filePath,
    format: 'csv',
    mode: 'faq',
    detectedColumns: {},
    rows: [],
    faqGroups,
    unresolvedFaqGroups
  };
}
