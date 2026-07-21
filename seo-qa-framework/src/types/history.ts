export type HistoryEntryCategory = 'seoCheck' | 'redirect' | 'brokenLink' | 'accessibility';

export interface HistorySnapshotEntry {
  /** Stable identity for the failing issue, used to match it across runs. */
  key: string;
  category: HistoryEntryCategory;
  url: string;
  description: string;
}

export interface HistorySnapshot {
  sourcePath: string;
  savedAt: string;
  failingEntries: HistorySnapshotEntry[];
}

export interface HistoryFile {
  sourcePath: string;
  snapshots: HistorySnapshot[];
}

export interface HistoryComparison {
  sourcePath: string;
  previousRunAt: string | null;
  currentRunAt: string;
  fixed: HistorySnapshotEntry[];
  stillFailing: HistorySnapshotEntry[];
  newIssues: HistorySnapshotEntry[];
}
