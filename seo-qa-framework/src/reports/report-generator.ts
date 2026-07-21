import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { AuditRunResult } from '../types/audit-run-result.js';
import type { GeneratedReportFile, ReportData } from '../types/report.js';
import { ensureDirectory } from '../utils/file-system.js';
import { toAbsolutePath } from '../utils/path-utils.js';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';
import { buildReportData } from './report-data-builder.js';
import { generateJsonReport } from './json-report-generator.js';
import { generateCsvReport } from './csv-report-generator.js';
import { generateMarkdownReport } from './markdown-report-generator.js';
import { generateHtmlReport } from './html-report-generator.js';

export interface ReportGeneratorOptions {
  /** Directory reports are written to. Defaults to testConfig.reportOutputDir. */
  outputDir?: string;
}

export interface ReportGenerationResult {
  reportData: ReportData;
  files: GeneratedReportFile[];
}

/**
 * Generates Developer and QA SEO QA reports (HTML, CSV, JSON, Markdown)
 * from a completed AuditRunner run.
 *
 * Report filenames are derived from the source sheet / blog document name so
 * they immediately communicate which audit, site, or blog they belong to —
 * e.g. "developer-report-On-page-optimization-fixes-JRC.html" rather than
 * the generic "developer-report-2026-07-01T11-11-52-947Z.html".
 */
export class ReportGenerator {
  constructor(private readonly options: ReportGeneratorOptions = {}) {}

  async generate(result: AuditRunResult): Promise<ReportGenerationResult> {
    const reportData = buildReportData(result);
    const outputDir = toAbsolutePath(this.options.outputDir ?? testConfig.reportOutputDir);
    await ensureDirectory(outputDir);

    const slug      = sourceSlug(result.sourcePath);
    const timestamp = formatTimestampForFilename(reportData.summary.generatedAt);
    // Use "<slug>-<timestamp>" so each run's files are unique and sortable.
    const prefix = `${slug}-${timestamp}`;

    const files: GeneratedReportFile[] = [];

    files.push(
      await this.writeReportFile(outputDir, `audit-report-${prefix}.json`, generateJsonReport(reportData), 'json', 'all')
    );
    files.push(
      await this.writeReportFile(outputDir, `audit-report-${prefix}.csv`, generateCsvReport(reportData), 'csv', 'all')
    );
    files.push(
      await this.writeReportFile(
        outputDir,
        `developer-report-${prefix}.md`,
        generateMarkdownReport(reportData, 'developer'),
        'markdown',
        'developer'
      )
    );
    files.push(
      await this.writeReportFile(
        outputDir,
        `qa-report-${prefix}.md`,
        generateMarkdownReport(reportData, 'qa'),
        'markdown',
        'qa'
      )
    );
    files.push(
      await this.writeReportFile(
        outputDir,
        `developer-report-${prefix}.html`,
        generateHtmlReport(reportData, 'developer'),
        'html',
        'developer'
      )
    );
    files.push(
      await this.writeReportFile(
        outputDir,
        `qa-report-${prefix}.html`,
        generateHtmlReport(reportData, 'qa'),
        'html',
        'qa'
      )
    );

    logger.info('Audit reports generated.', { outputDir, fileCount: files.length });

    return { reportData, files };
  }

  private async writeReportFile(
    outputDir: string,
    fileName: string,
    content: string,
    format: GeneratedReportFile['format'],
    audience: GeneratedReportFile['audience']
  ): Promise<GeneratedReportFile> {
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, content, 'utf8');
    return { format, audience, path: filePath };
  }
}

export function formatTimestampForFilename(isoTimestamp: string): string {
  // Keep only the date + time portion, drop milliseconds and timezone.
  // e.g. "2026-07-01T11-11-52" from "2026-07-01T11:11:52.947Z"
  return isoTimestamp.replace(/[:.]/g, '-').replace(/-\d{3}-?\w*$/, '');
}

/**
 * Derives a human-readable slug from the source file path so report files
 * are immediately identifiable without opening them.
 *
 * Examples:
 *   "audit-sheets/On page optimization fixes - JRC.xlsx"
 *     → "On-page-optimization-fixes-JRC"
 *   "blogs/Escape Stress Naturally_ How Farmland Living Supports Mental Wellness.docx"
 *     → "Escape-Stress-Naturally"  (truncated to 60 chars)
 */
export function sourceSlug(sourcePath: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));

  return (
    base
      // Replace underscores, hyphens, colons with spaces first
      .replace(/[_\-:]+/g, ' ')
      // Strip characters that are neither alphanumeric nor space
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      // Split on spaces and capitalise-filter
      .split(' ')
      .filter((word) => word.length > 0)
      .join('-')
      // Truncate to 60 characters so filenames stay manageable
      .slice(0, 60)
      // Strip trailing hyphens left by the truncation
      .replace(/-+$/, '')
  );
}
