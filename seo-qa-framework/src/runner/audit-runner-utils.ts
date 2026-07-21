import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheck } from '../seo-checks/seo-check.js';

export type AuditRowDispatch =
  | { kind: 'seoCheck'; check: SeoCheck }
  | { kind: 'redirect' }
  | { kind: 'brokenLink' }
  | { kind: 'accessibility' }
  | { kind: 'performance' }
  | { kind: 'unsupported' };

/**
 * Resolves an audit row URL to an absolute URL, falling back to the
 * provided base URL for sheets that only contain relative paths.
 */
export function resolveAuditUrl(url: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return new URL(url, baseUrl).toString();
}

/**
 * Groups audit rows by their resolved URL so the runner only visits
 * each page once, even when multiple issues were reported for it.
 */
export function groupAuditRowsByUrl(rows: readonly SeoAuditRow[], baseUrl: string): Map<string, SeoAuditRow[]> {
  const grouped = new Map<string, SeoAuditRow[]>();

  for (const row of rows) {
    const url = resolveAuditUrl(row.url, baseUrl);
    const existingRows = grouped.get(url);

    if (existingRows) {
      existingRows.push(row);
    } else {
      grouped.set(url, [row]);
    }
  }

  return grouped;
}

/**
 * Decides which existing check module (if any) should handle an audit row,
 * based on the row's detected issue type. Rows without a matching, already
 * implemented check are reported as unsupported instead of being executed.
 */
export function resolveCheckDispatch(
  row: SeoAuditRow,
  checksByType: ReadonlyMap<string, SeoCheck>
): AuditRowDispatch {
  const seoCheck = checksByType.get(row.issueType);

  if (seoCheck) {
    return { kind: 'seoCheck', check: seoCheck };
  }

  if (row.issueType === 'redirect') {
    return { kind: 'redirect' };
  }

  if (row.issueType === 'brokenLink') {
    return { kind: 'brokenLink' };
  }

  if (row.issueType === 'accessibility') {
    return { kind: 'accessibility' };
  }

  if (row.issueType === 'performance') {
    return { kind: 'performance' };
  }

  return { kind: 'unsupported' };
}

export function buildChecksByType(seoChecks: readonly SeoCheck[]): Map<string, SeoCheck> {
  return new Map(seoChecks.map((check) => [check.type, check]));
}
