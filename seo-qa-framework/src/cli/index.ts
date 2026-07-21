import { Command } from 'commander';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';
import { AuditRunner } from '../runner/audit-runner.js';
import { ReportGenerator } from '../reports/report-generator.js';
import { DashboardGenerator } from '../dashboard/dashboard.js';
import { HistoryStore } from '../history/history.js';

const program = new Command();

program
  .name('seo-qa')
  .description('CLI for running SEO QA validation from audit sheets.')
  .option('-s, --sheet <path>', 'Path to CSV/XLSX SEO audit sheet', testConfig.auditSheetPath)
  .option('-a, --audit-sheet <path>', 'Alias for --sheet', testConfig.auditSheetPath)
  .option('-u, --base-url <url>', 'Target site base URL', testConfig.baseUrl)
  .option('-r, --report-dir <path>', 'Report/dashboard output directory', testConfig.reportOutputDir)
  .option('--history-dir <path>', 'History snapshot directory', testConfig.historyDir)
  .option('--no-screenshots', 'Disable screenshot capture on failed SEO checks')
  .option('--no-accessibility', 'Disable accessibility (axe-core) checks even if flagged in the sheet')
  .option('--no-lighthouse', 'Disable Lighthouse checks even if flagged in the sheet')
  .option('--no-history', 'Skip recording/comparing this run in history')
  .action(async (options) => {
    const auditSheetPath: string = options.sheet ?? options.auditSheet;

    const runner = new AuditRunner({
      baseUrl: options.baseUrl,
      captureScreenshotsOnFailure: options.screenshots,
      enableAccessibilityChecks: options.accessibility,
      enableLighthouseChecks: options.lighthouse
    });

    const result = await runner.run(auditSheetPath);

    const reportGenerator = new ReportGenerator({ outputDir: options.reportDir });
    const { reportData, files } = await reportGenerator.generate(result);

    const dashboardGenerator = new DashboardGenerator({ outputDir: options.reportDir });
    const dashboardPath = await dashboardGenerator.generate(result);

    logger.info('SEO QA audit run completed.', {
      sourcePath: result.sourcePath,
      totalRows: result.totalRows,
      durationMs: result.durationMs,
      seoChecks: reportData.summary.seoChecks,
      redirects: reportData.summary.redirects,
      brokenLinks: reportData.summary.brokenLinks,
      accessibility: reportData.summary.accessibility,
      lighthouse: reportData.summary.lighthouse,
      skippedRows: result.skipped.length,
      reportFiles: files.map((file) => file.path),
      dashboardPath
    });

    let historyHasRegressions = false;

    if (options.history) {
      const historyStore = new HistoryStore({ historyDir: options.historyDir });
      const comparison = await historyStore.recordRun(result, reportData);

      logger.info('History comparison completed.', {
        previousRunAt: comparison.previousRunAt,
        currentRunAt: comparison.currentRunAt,
        fixed: comparison.fixed.length,
        stillFailing: comparison.stillFailing.length,
        newIssues: comparison.newIssues.length
      });

      historyHasRegressions = comparison.newIssues.length > 0 || comparison.stillFailing.length > 0;
    }

    const hasFailures =
      reportData.summary.seoChecks.failed > 0 ||
      reportData.summary.brokenLinks.failed > 0 ||
      reportData.summary.redirects.failed > 0;

    if (hasFailures || historyHasRegressions) {
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
