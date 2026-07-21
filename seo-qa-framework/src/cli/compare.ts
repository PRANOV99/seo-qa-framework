import { Command } from 'commander';
import { testConfig } from '../config/test-config.js';
import { logger } from '../logger/logger.js';
import { HistoryStore } from '../history/history.js';

const program = new Command();

program
  .name('seo-qa-compare')
  .description('Compares the two most recently recorded audit runs for a sheet: Fixed / Still Failing / New Issues.')
  .option('-s, --sheet <path>', 'Path to the CSV/XLSX SEO audit sheet', testConfig.auditSheetPath)
  .option('--history-dir <path>', 'History snapshot directory', testConfig.historyDir)
  .action(async (options) => {
    const historyStore = new HistoryStore({ historyDir: options.historyDir });
    const comparison = await historyStore.compareLastTwoRuns(options.sheet);

    if (!comparison) {
      logger.info('Not enough recorded history to compare yet. Run `npm run audit` at least twice first.', {
        sourcePath: options.sheet
      });
      return;
    }

    logger.info('History comparison completed.', {
      sourcePath: comparison.sourcePath,
      previousRunAt: comparison.previousRunAt,
      currentRunAt: comparison.currentRunAt,
      fixed: comparison.fixed.length,
      stillFailing: comparison.stillFailing.length,
      newIssues: comparison.newIssues.length
    });

    for (const entry of comparison.fixed) {
      logger.info(`FIXED: ${entry.description}`, { url: entry.url, category: entry.category });
    }

    for (const entry of comparison.newIssues) {
      logger.warn(`NEW ISSUE: ${entry.description}`, { url: entry.url, category: entry.category });
    }

    for (const entry of comparison.stillFailing) {
      logger.warn(`STILL FAILING: ${entry.description}`, { url: entry.url, category: entry.category });
    }

    if (comparison.newIssues.length > 0 || comparison.stillFailing.length > 0) {
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
