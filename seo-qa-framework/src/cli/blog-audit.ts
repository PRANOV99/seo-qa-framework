import { Command } from 'commander';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';
import { BlogAuditRunner } from '../runner/blog-audit-runner.js';
import { ReportGenerator } from '../reports/report-generator.js';
import { DashboardGenerator } from '../dashboard/dashboard.js';
import { HistoryStore } from '../history/history.js';

const program = new Command();

program
  .name('seo-qa-blog-audit')
  .description('Validates a published blog page against the approved .docx provided by the content team.')
  .requiredOption('-d, --doc <path>', 'Path to the approved blog .docx document')
  .requiredOption('-u, --url <url>', 'Live, published blog URL to validate')
  .option('-r, --report-dir <path>', 'Report/dashboard output directory', testConfig.reportOutputDir)
  .option('--history-dir <path>', 'History snapshot directory', testConfig.historyDir)
  .option('--no-history', 'Skip recording/comparing this run in history')
  .action(async (options) => {
    const runner = new BlogAuditRunner();
    const result = await runner.run(options.doc, options.url);

    const reportGenerator = new ReportGenerator({ outputDir: options.reportDir });
    const { reportData, files } = await reportGenerator.generate(result);

    const dashboardGenerator = new DashboardGenerator({ outputDir: options.reportDir });
    const dashboardPath = await dashboardGenerator.generate(result);

    logger.info('Blog content validation run completed.', {
      docPath: options.doc,
      url: options.url,
      durationMs: result.durationMs,
      blogContent: reportData.summary.blogContent,
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

    if ((reportData.summary.blogContent?.failed ?? 0) > 0 || historyHasRegressions) {
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
