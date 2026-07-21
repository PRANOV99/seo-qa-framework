import type { ReportData } from '../types/report.js';
import type { HistorySnapshotEntry } from '../types/history.js';

export function buildFailingEntries(reportData: ReportData): HistorySnapshotEntry[] {
  const entries: HistorySnapshotEntry[] = [];

  for (const result of reportData.seoCheckResults) {
    if (result.status !== 'failed') {
      continue;
    }

    entries.push({
      key: `seoCheck:${result.url}:${result.checkType}`,
      category: 'seoCheck',
      url: result.url,
      description: `${result.checkType} — expected "${result.expected ?? ''}", found "${result.actual ?? ''}"`
    });
  }

  for (const result of reportData.redirectResults) {
    if (result.result === 'PASS') {
      continue;
    }

    entries.push({
      key: `redirect:${result.originalUrl}`,
      category: 'redirect',
      url: result.originalUrl,
      description: `${result.result} (status ${result.statusCode}) — ${result.recommendation}`
    });
  }

  for (const result of reportData.brokenLinkResults) {
    if (result.status === 'PASS') {
      continue;
    }

    entries.push({
      key: `brokenLink:${result.pageUrl}:${result.link}`,
      category: 'brokenLink',
      url: result.pageUrl,
      description: `${result.message} (${result.link}, status ${result.statusCode})`
    });
  }

  for (const result of reportData.accessibilityResults) {
    for (const violation of result.violations) {
      entries.push({
        key: `accessibility:${result.url}:${violation.id}`,
        category: 'accessibility',
        url: result.url,
        description: `${violation.id} (${violation.impact ?? 'n/a'} impact, ${violation.nodeCount} node(s))`
      });
    }
  }

  return entries;
}

export interface FailingEntryComparison {
  fixed: HistorySnapshotEntry[];
  stillFailing: HistorySnapshotEntry[];
  newIssues: HistorySnapshotEntry[];
}

export function compareFailingEntries(
  previous: readonly HistorySnapshotEntry[] | undefined,
  current: readonly HistorySnapshotEntry[]
): FailingEntryComparison {
  const previousByKey = new Map((previous ?? []).map((entry) => [entry.key, entry]));
  const currentByKey = new Map(current.map((entry) => [entry.key, entry]));

  return {
    fixed: [...previousByKey.values()].filter((entry) => !currentByKey.has(entry.key)),
    stillFailing: [...currentByKey.values()].filter((entry) => previousByKey.has(entry.key)),
    newIssues: [...currentByKey.values()].filter((entry) => !previousByKey.has(entry.key))
  };
}
