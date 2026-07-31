import pg from 'pg';
import { logger } from '../src/logger/logger.js';

const { Pool } = pg;

/**
 * PostgreSQL connection pool backing audit history persistence
 * (api/history-store.ts) — the web API's per-run audit records (sheet and
 * blog), viewable on the History page. This is deliberately separate from
 * `testConfig.historyDir`/`HISTORY_DIR`, which is the CLI's own unrelated
 * `HistoryStore` (src/history/history.ts, used by `npm run compare` etc.)
 * — that one stays on the filesystem and is untouched by this change.
 *
 * `DATABASE_URL` is read directly from process.env (like PORT/ALLOWED_ORIGINS
 * in server.ts) rather than through the zod-validated `env`/`testConfig`
 * used by the sheet/blog audit engine — this is API-server-only
 * configuration, not part of that shared config surface.
 */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The web API requires a PostgreSQL connection string to persist audit history — set it in .env (local) or as an environment variable (production).'
    );
  }
  return url;
}

export const pool = new Pool({
  connectionString: requireDatabaseUrl(),
  // Neon (and most managed Postgres providers) terminate TLS with a
  // certificate chain that Node's default CA bundle won't always validate;
  // `sslmode=require` in the connection string only requires an encrypted
  // connection, it doesn't relax certificate verification on its own.
  ssl: { rejectUnauthorized: false }
});

/** Creates the audit_records table if it doesn't already exist. Idempotent — safe to call on every server start. */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_records (
      id                TEXT PRIMARY KEY,
      type              TEXT NOT NULL,
      filename          TEXT NOT NULL,
      url               TEXT,
      created_at        TIMESTAMPTZ NOT NULL,
      status            TEXT NOT NULL,
      error             TEXT,
      summary           JSONB NOT NULL,
      report            JSONB NOT NULL,
      expected_content  JSONB
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS audit_records_created_at_idx ON audit_records (created_at DESC);
  `);
  logger.info('PostgreSQL audit_records schema ready.');
}
