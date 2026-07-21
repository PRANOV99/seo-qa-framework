import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { AuditRunResult } from '../types/audit-run-result.js';
import type { ReportData } from '../types/report.js';
import type { HistoryComparison, HistoryFile, HistorySnapshot } from '../types/history.js';
import { buildReportData } from '../reports/report-data-builder.js';
import { buildFailingEntries, compareFailingEntries } from './history-compare.js';
import { ensureDirectory } from '../utils/file-system.js';
import { toAbsolutePath } from '../utils/path-utils.js';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';

export interface HistoryStoreOptions {
  /** Directory history snapshots are persisted to. Defaults to testConfig.historyDir. */
  historyDir?: string;
  /** Maximum number of snapshots retained per audit sheet. Defaults to 20. */
  maxSnapshots?: number;
}

/**
 * Persists per-sheet run snapshots so consecutive audit runs can be
 * compared: issues that were Fixed, are Still Failing, or are New.
 */
export class HistoryStore {
  constructor(private readonly options: HistoryStoreOptions = {}) {}

  /** Records the current run's failing issues and compares them against the previous run for this sheet. */
  async recordRun(result: AuditRunResult, reportData?: ReportData): Promise<HistoryComparison> {
    const data = reportData ?? buildReportData(result);
    const currentEntries = buildFailingEntries(data);

    const historyFile = await this.loadHistoryFile(result.sourcePath);
    const previousSnapshot = historyFile.snapshots.at(-1);
    const comparison = compareFailingEntries(previousSnapshot?.failingEntries, currentEntries);

    const newSnapshot: HistorySnapshot = {
      sourcePath: result.sourcePath,
      savedAt: data.summary.generatedAt,
      failingEntries: currentEntries
    };

    historyFile.snapshots.push(newSnapshot);
    this.trimSnapshots(historyFile);
    await this.saveHistoryFile(result.sourcePath, historyFile);

    logger.info('History snapshot recorded.', {
      sourcePath: result.sourcePath,
      fixed: comparison.fixed.length,
      stillFailing: comparison.stillFailing.length,
      newIssues: comparison.newIssues.length
    });

    return {
      sourcePath: result.sourcePath,
      previousRunAt: previousSnapshot?.savedAt ?? null,
      currentRunAt: newSnapshot.savedAt,
      ...comparison
    };
  }

  /** Compares the two most recently saved snapshots for a sheet without performing a new run. */
  async compareLastTwoRuns(sourcePath: string): Promise<HistoryComparison | undefined> {
    const historyFile = await this.loadHistoryFile(sourcePath);

    if (historyFile.snapshots.length < 2) {
      return undefined;
    }

    const current = historyFile.snapshots.at(-1);
    const previous = historyFile.snapshots.at(-2);

    if (!current || !previous) {
      return undefined;
    }

    const comparison = compareFailingEntries(previous.failingEntries, current.failingEntries);

    return {
      sourcePath,
      previousRunAt: previous.savedAt,
      currentRunAt: current.savedAt,
      ...comparison
    };
  }

  private trimSnapshots(historyFile: HistoryFile): void {
    const maxSnapshots = this.options.maxSnapshots ?? 20;

    if (historyFile.snapshots.length > maxSnapshots) {
      historyFile.snapshots.splice(0, historyFile.snapshots.length - maxSnapshots);
    }
  }

  private async loadHistoryFile(sourcePath: string): Promise<HistoryFile> {
    try {
      const raw = await readFile(this.historyFilePath(sourcePath), 'utf8');
      return JSON.parse(raw) as HistoryFile;
    } catch {
      return { sourcePath, snapshots: [] };
    }
  }

  private async saveHistoryFile(sourcePath: string, historyFile: HistoryFile): Promise<void> {
    const historyDir = toAbsolutePath(this.options.historyDir ?? testConfig.historyDir);
    await ensureDirectory(historyDir);
    await writeFile(this.historyFilePath(sourcePath), JSON.stringify(historyFile, null, 2), 'utf8');
  }

  private historyFilePath(sourcePath: string): string {
    const historyDir = toAbsolutePath(this.options.historyDir ?? testConfig.historyDir);
    return path.join(historyDir, `${sanitizeFileName(sourcePath)}.json`);
  }
}

function sanitizeFileName(sourcePath: string): string {
  return path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]+/g, '_');
}
