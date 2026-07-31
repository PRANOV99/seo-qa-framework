import type {
  AuditColumnKey,
  AuditSheetMode,
  DetectedRecommendationField,
  SeoAuditRow,
  SeoIssueType
} from '../types/audit.js';

type CellValue = unknown;
type SheetRow = readonly CellValue[];

interface HeaderCandidate {
  index: number;
  headers: string[];
  score: number;
}

const columnAliases: Record<AuditColumnKey, string[]> = {
  url: [
    'url',
    'page url',
    'source page url',
    'page',
    'address',
    'landing page',
    'target url',
    'source url',
    'current url',
    'live url',
    'url to check',
    'url to audit'
  ],
  checkType: [
    'issue',
    'issue type',
    'check',
    'check type',
    'seo issue',
    'problem',
    'recommendation',
    'task',
    'fix'
  ],
  expectedValue: ['expected', 'expected value', 'expected result', 'new value', 'recommended value'],
  actualValue: ['actual', 'actual value', 'current', 'current value', 'found value', 'existing value'],
  severity: ['severity', 'priority', 'impact'],
  notes: ['notes', 'note', 'comment', 'comments', 'details', 'description']
};

const issuePatterns: Array<{ type: SeoIssueType; patterns: RegExp[] }> = [
  { type: 'metaDescription', patterns: [/meta\s*description/i, /\bdescription\b/i] },
  { type: 'redirect', patterns: [/redirect/i, /\b30[1278]\b/i] },
  {
    type: 'brokenLink',
    patterns: [/broken\s*links?/i, /dead\s*links?/i, /link\s*rot/i, /\b404\b/i, /\b50[0234]\b/i]
  },
  { type: 'statusCode', patterns: [/status\s*code/i] },
  {
    type: 'accessibility',
    patterns: [/accessib/i, /\baxe\b/i, /\bwcag\b/i, /\ba11y\b/i, /screen\s*reader/i]
  },
  {
    type: 'performance',
    patterns: [/performance/i, /\blighthouse\b/i, /page\s*speed/i, /core\s*web\s*vitals?/i, /\b(lcp|cls|ttfb|fcp|tbt)\b/i]
  },
  { type: 'imageAlt', patterns: [/image\s*alt/i, /\balt\s*text\b/i] },
  { type: 'structuredData', patterns: [/structured\s*data/i, /schema/i, /json-ld/i] },
  { type: 'openGraph', patterns: [/open\s*graph/i, /\bog:/i] },
  { type: 'twitterCard', patterns: [/twitter\s*card/i, /twitter:/i] },
  { type: 'internalLinks', patterns: [/internal\s*links?/i, /\binlinks?\b/i] },
  { type: 'canonical', patterns: [/canonical/i] },
  { type: 'hreflang', patterns: [/hreflang/i] },
  { type: 'sitemap', patterns: [/sitemap/i] },
  { type: 'robots', patterns: [/robots/i] },
  { type: 'noindex', patterns: [/noindex/i] },
  { type: 'title', patterns: [/\btitle\b/i, /title\s*tag/i] },
  { type: 'h1', patterns: [/\bh1\b/i, /heading\s*1/i] },
  { type: 'h2', patterns: [/\bh2\b/i, /heading\s*2/i] }
];

interface RecommendationFieldDetector {
  issueType: SeoIssueType;
  label: string;
  patterns: RegExp[];
}

/**
 * Maps "recommendation sheet" column headers (e.g. "Suggested Meta Title")
 * to the SEO field they represent. Order matters: more specific fields are
 * checked first so, e.g., "Suggested OG Title" matches openGraph rather
 * than the broader title pattern.
 */
const recommendationFieldDetectors: RecommendationFieldDetector[] = [
  { issueType: 'metaDescription', label: 'Meta Description', patterns: [/meta\s*description/i] },
  { issueType: 'canonical', label: 'Canonical Tag', patterns: [/canonical/i] },
  { issueType: 'redirect', label: 'Redirect', patterns: [/redirect/i] },
  {
    issueType: 'brokenLink',
    label: 'Broken Link Check',
    patterns: [/broken\s*links?/i, /dead\s*links?/i, /link\s*check/i]
  },
  { issueType: 'openGraph', label: 'Open Graph', patterns: [/open\s*graph/i, /\bog[\s:_-]/i] },
  { issueType: 'twitterCard', label: 'Twitter Card', patterns: [/twitter/i] },
  { issueType: 'imageAlt', label: 'Image Alt Text', patterns: [/image\s*alt/i, /alt\s*text/i, /\balt\b/i] },
  { issueType: 'h1', label: 'H1', patterns: [/\bh1\b/i, /heading\s*1/i] },
  { issueType: 'h2', label: 'H2', patterns: [/\bh2\b/i, /heading\s*2/i] },
  { issueType: 'title', label: 'Meta Title', patterns: [/meta\s*title/i, /title\s*tag/i, /\btitle\b/i] }
];

export interface NormalizedAuditRows {
  mode: AuditSheetMode;
  detectedColumns: Partial<Record<AuditColumnKey, string>>;
  detectedFields?: DetectedRecommendationField[];
  rows: SeoAuditRow[];
}

export function normalizeAuditRows(sheetRows: readonly SheetRow[]): NormalizedAuditRows {
  const nonEmptyRows = sheetRows.filter((row) => row.some((cell) => stringifyCell(cell) !== ''));
  const headerCandidate = findHeaderRow(nonEmptyRows);

  if (!headerCandidate) {
    return {
      mode: 'issueBased',
      detectedColumns: {},
      rows: []
    };
  }

  const columnIndexes = detectColumnIndexes(headerCandidate.headers);
  const recommendationFields = detectRecommendationFieldColumns(headerCandidate.headers);
  const mode = detectSheetMode(columnIndexes, recommendationFields.length);
  const dataRows = nonEmptyRows.slice(headerCandidate.index + 1);

  if (mode === 'recommendation') {
    return {
      mode,
      detectedColumns: toDetectedColumns({ url: columnIndexes.url }, headerCandidate.headers),
      detectedFields: recommendationFields.map((field) => ({
        column: headerCandidate.headers[field.index] ?? `Column ${field.index + 1}`,
        issueType: field.issueType
      })),
      rows: dataRows.flatMap((row, index) =>
        normalizeRecommendationDataRow(
          row,
          headerCandidate.headers,
          columnIndexes.url,
          recommendationFields,
          headerCandidate.index + index + 2
        )
      )
    };
  }

  return {
    mode,
    detectedColumns: toDetectedColumns(columnIndexes, headerCandidate.headers),
    rows: dataRows
      .map((row, index) =>
        normalizeDataRow(row, headerCandidate.headers, columnIndexes, headerCandidate.index + index + 2)
      )
      .filter((row): row is SeoAuditRow => row !== undefined)
  };
}

/**
 * Decides whether a sheet is a traditional issue-based audit sheet or a
 * "recommendation sheet" (one row per URL, several "Suggested X" columns).
 *
 * Two or more detected per-field recommendation columns is treated as
 * decisive even if one of those columns also happens to match a generic
 * checkType alias (e.g. a literal "Recommendation" column) — real
 * issue-based sheets have exactly one problem/check column, not several
 * per-field suggested-value columns.
 */
function detectSheetMode(
  columnIndexes: Partial<Record<AuditColumnKey, number>>,
  recommendationFieldCount: number
): AuditSheetMode {
  if (recommendationFieldCount >= 2) {
    return 'recommendation';
  }

  if (typeof columnIndexes.checkType === 'number') {
    return 'issueBased';
  }

  if (recommendationFieldCount >= 1 && typeof columnIndexes.url === 'number') {
    return 'recommendation';
  }

  return 'issueBased';
}

/**
 * A column whose header marks it as measurement metadata ("Title Chars",
 * "Desc Chars", "Char Count") or an explicitly BEFORE/baseline value
 * ("Current Meta Description", "Existing Alt Text") rather than an actual
 * suggested fix — real-world recommendation sheets commonly place these
 * alongside their "Suggested X" counterpart for the same field, and their
 * header still contains that field's keyword (e.g. "Title Chars" contains
 * "title"), so without this guard they'd be wrongly detected as a second,
 * bogus suggested-value column for the same issue type.
 */
function isNonRecommendationMetadataHeader(header: string): boolean {
  return /\b(chars?|count|length)\b/i.test(header) || /\b(current|existing)\b/i.test(header);
}

function detectRecommendationFieldColumns(
  headers: string[]
): Array<{ index: number; issueType: SeoIssueType; label: string }> {
  const matches: Array<{ index: number; issueType: SeoIssueType; label: string }> = [];

  headers.forEach((header, index) => {
    if (!header || isNonRecommendationMetadataHeader(header)) {
      return;
    }

    const detector = recommendationFieldDetectors.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(header))
    );

    if (detector) {
      matches.push({ index, issueType: detector.issueType, label: detector.label });
    }
  });

  return matches;
}

/**
 * Expands a single recommendation-sheet row (one URL, many possible
 * suggested fields) into one SeoAuditRow per non-empty field, reusing the
 * existing SeoCheck registry's expected-vs-actual comparison for each.
 */
function normalizeRecommendationDataRow(
  row: SheetRow,
  headers: string[],
  urlIndex: number | undefined,
  recommendationFields: Array<{ index: number; issueType: SeoIssueType; label: string }>,
  sourceRowNumber: number
): SeoAuditRow[] {
  const raw = toRawRow(row, headers);
  // Only fall back to scanning the whole row for a URL when there's no
  // detected URL column at all — when the column IS known but this row's
  // cell is simply blank (e.g. an image with no page it appears on), that
  // row has nothing to check and must be skipped, not silently reattributed
  // to some other URL-shaped cell elsewhere in the row (e.g. an image asset
  // URL in an image-alt-text sheet).
  const url = urlIndex !== undefined ? getValue(row, urlIndex) : findUrlInRow(row);

  if (!url) {
    return [];
  }

  return recommendationFields.reduce<SeoAuditRow[]>((rows, field) => {
    const expectedValue = getValue(row, field.index);

    if (!expectedValue) {
      return rows;
    }

    rows.push({
      url,
      checkType: field.label,
      issueType: field.issueType,
      expectedValue,
      sourceRowNumber,
      raw
    });

    return rows;
  }, []);
}

export function detectIssueType(input: string): SeoIssueType {
  for (const issuePattern of issuePatterns) {
    if (issuePattern.patterns.some((pattern) => pattern.test(input))) {
      return issuePattern.type;
    }
  }

  return 'unknown';
}

function findHeaderRow(rows: SheetRow[]): HeaderCandidate | undefined {
  return rows
    .slice(0, 10)
    .map((row, index) => {
      const headers = row.map(stringifyCell);
      return {
        index,
        headers,
        score: scoreHeader(headers)
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0];
}

function scoreHeader(headers: string[]): number {
  const normalizedHeaders = headers.map(normalizeLabel);

  const aliasScore = Object.values(columnAliases).reduce((score, aliases) => {
    const matched = normalizedHeaders.some((header) =>
      aliases.some((alias) => header === normalizeLabel(alias))
    );

    return matched ? score + 1 : score;
  }, 0);

  const recommendationFieldScore = detectRecommendationFieldColumns(headers).length > 0 ? 1 : 0;

  return aliasScore + recommendationFieldScore;
}

function detectColumnIndexes(headers: string[]): Partial<Record<AuditColumnKey, number>> {
  const indexes: Partial<Record<AuditColumnKey, number>> = {};

  for (const key of Object.keys(columnAliases) as AuditColumnKey[]) {
    const index = headers.findIndex((header) => matchesAlias(header, columnAliases[key]));

    if (index >= 0) {
      indexes[key] = index;
    }
  }

  return indexes;
}

function normalizeDataRow(
  row: SheetRow,
  headers: string[],
  columnIndexes: Partial<Record<AuditColumnKey, number>>,
  sourceRowNumber: number
): SeoAuditRow | undefined {
  const raw = toRawRow(row, headers);
  // See the equivalent comment in normalizeRecommendationDataRow: only scan
  // the whole row for a URL when no URL column was detected at all — a
  // detected column with a genuinely blank cell means this row has nothing
  // to check, not "look elsewhere in the row for something URL-shaped".
  const url = columnIndexes.url !== undefined ? getValue(row, columnIndexes.url) : findUrlInRow(row);
  const checkType = getValue(row, columnIndexes.checkType) ?? inferCheckType(row, columnIndexes.url);

  if (!url || !checkType) {
    return undefined;
  }

  const issueText = [checkType, raw.Notes, raw.Description, raw.Details].filter(Boolean).join(' ');
  const severity = normalizeSeverity(getValue(row, columnIndexes.severity));

  return {
    url,
    checkType,
    issueType: detectIssueType(issueText),
    expectedValue: getValue(row, columnIndexes.expectedValue),
    actualValue: getValue(row, columnIndexes.actualValue),
    severity,
    notes: getValue(row, columnIndexes.notes),
    sourceRowNumber,
    raw
  };
}

function toRawRow(row: SheetRow, headers: string[]): Record<string, string> {
  return headers.reduce<Record<string, string>>((raw, header, index) => {
    const key = header || `Column ${index + 1}`;
    raw[key] = stringifyCell(row[index]);
    return raw;
  }, {});
}

function toDetectedColumns(
  columnIndexes: Partial<Record<AuditColumnKey, number>>,
  headers: string[]
): Partial<Record<AuditColumnKey, string>> {
  return Object.entries(columnIndexes).reduce<Partial<Record<AuditColumnKey, string>>>(
    (detectedColumns, [key, index]) => {
      if (typeof index === 'number') {
        detectedColumns[key as AuditColumnKey] = headers[index];
      }

      return detectedColumns;
    },
    {}
  );
}

function inferCheckType(row: SheetRow, urlIndex?: number): string | undefined {
  return row
    .map((cell, index) => (index === urlIndex ? '' : stringifyCell(cell)))
    .find((value) => value !== '' && !isUrl(value));
}

function findUrlInRow(row: SheetRow): string | undefined {
  return row.map(stringifyCell).find(isUrl);
}

function getValue(row: SheetRow, index?: number): string | undefined {
  if (typeof index !== 'number') {
    return undefined;
  }

  const value = stringifyCell(row[index]);
  return value === '' ? undefined : value;
}

function matchesAlias(header: string, aliases: string[]): boolean {
  const normalizedHeader = normalizeLabel(header);
  return aliases.some((alias) => normalizedHeader === normalizeLabel(alias));
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stringifyCell(value: CellValue): string {
  if (typeof value === 'function') {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeSeverity(value?: string): SeoAuditRow['severity'] {
  const normalized = value?.toLowerCase().trim();

  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
    return normalized;
  }

  return undefined;
}

function isUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}
