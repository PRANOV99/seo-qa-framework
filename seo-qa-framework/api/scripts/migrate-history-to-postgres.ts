/**
 * One-time migration: reads every existing audit-*.json file out of the
 * old file-based history directory and inserts it into PostgreSQL via the
 * same saveAuditRecord() the API now uses — run once when cutting over an
 * existing installation from file-based history to Postgres so its history
 * isn't silently lost. Safe to re-run (saveAuditRecord upserts by id).
 *
 * Usage: npm run migrate:history
 * (reads from HISTORY_DIR if set, else ./history — same default the old
 * file-based store used; writes to DATABASE_URL, same as the API server)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { saveAuditRecord, type AuditRecord } from '../history-store.js';
import { ensureSchema } from '../db.js';
import { logger } from '../../src/logger/logger.js';

const HISTORY_DIR = process.env.HISTORY_DIR ? path.resolve(process.env.HISTORY_DIR) : path.resolve('./history');

async function main(): Promise<void> {
  await ensureSchema();

  const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith('.json'));
  logger.info(`[migrate-history] Found ${files.length} record(s) in ${HISTORY_DIR}.`);

  let migrated = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const raw = await readFile(path.join(HISTORY_DIR, file), 'utf8');
      const record = JSON.parse(raw) as AuditRecord;
      await saveAuditRecord(record);
      migrated++;
    } catch (error) {
      failed++;
      logger.error(`[migrate-history] Failed to migrate ${file}`, {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info(`[migrate-history] Done. Migrated ${migrated}, failed ${failed}, out of ${files.length} file(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('[migrate-history] Fatal error', { message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
