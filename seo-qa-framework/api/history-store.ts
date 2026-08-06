import { pool } from './db.js';

export interface AuditRecord {
  id: string;
  type: 'sheet' | 'blog';
  filename: string;
  url?: string;
  createdAt: string;
  status: 'completed' | 'error';
  error?: string;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
  /**
   * The approved/parsed input content this audit was run against — a
   * BlogContent for blog runs, or an AuditParseResult for sheet runs (both
   * stored loosely like `summary`/`report`). Only present for completed
   * runs. Lets the SAME blog or sheet be re-tested later against a fresh
   * crawl without re-uploading the original file (see POST
   * /api/runs/rerun and POST /api/runs/rerun-sheet).
   */
  expectedContent?: Record<string, unknown>;
}

interface AuditRecordRow {
  id: string;
  type: string;
  filename: string;
  url: string | null;
  created_at: Date;
  status: string;
  error: string | null;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
  expected_content: Record<string, unknown> | null;
}

function rowToRecord(row: AuditRecordRow): AuditRecord {
  return {
    id: row.id,
    type: row.type as AuditRecord['type'],
    filename: row.filename,
    url: row.url ?? undefined,
    createdAt: row.created_at.toISOString(),
    status: row.status as AuditRecord['status'],
    error: row.error ?? undefined,
    summary: row.summary,
    report: row.report,
    expectedContent: row.expected_content ?? undefined
  };
}

/** Inserts a new audit record, or overwrites one with the same id (re-saving under an existing id is not expected in practice — every run mints a fresh uuid — but kept idempotent rather than erroring). */
export async function saveAuditRecord(record: AuditRecord): Promise<void> {
  await pool.query(
    `INSERT INTO audit_records (id, type, filename, url, created_at, status, error, summary, report, expected_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type,
       filename = EXCLUDED.filename,
       url = EXCLUDED.url,
       created_at = EXCLUDED.created_at,
       status = EXCLUDED.status,
       error = EXCLUDED.error,
       summary = EXCLUDED.summary,
       report = EXCLUDED.report,
       expected_content = EXCLUDED.expected_content`,
    [
      record.id,
      record.type,
      record.filename,
      record.url ?? null,
      record.createdAt,
      record.status,
      record.error ?? null,
      JSON.stringify(record.summary),
      JSON.stringify(record.report),
      record.expectedContent ? JSON.stringify(record.expectedContent) : null
    ]
  );
}

/** Every stored audit record, newest first. */
export async function listAuditRecords(): Promise<AuditRecord[]> {
  const { rows } = await pool.query<AuditRecordRow>(
    'SELECT * FROM audit_records ORDER BY created_at DESC'
  );
  return rows.map(rowToRecord);
}

/**
 * Lightweight summary of every stored audit record, newest first — everything
 * the History list page actually renders (filename, url, status, summary
 * counts, and whether a re-run is possible), with none of the `report` or
 * `expected_content` JSONB payloads.
 *
 * `GET /api/history` used to call `listAuditRecords()` (`SELECT *`) and
 * immediately discard those two columns in the route handler — but Postgres
 * still had to read and transport them first. Measured against the real
 * production database (92 records): the full `SELECT *` took ~870ms and
 * shipped ~5.3MB; this query takes ~115ms and ships ~100KB. That gap is what
 * made the History tab slow to load, and it only gets worse as more audits
 * accumulate. `expected_content IS NOT NULL` reproduces the same
 * `hasExpectedContent` flag the route already computed from the full record.
 */
export interface AuditRecordSummary {
  id: string;
  type: 'sheet' | 'blog';
  filename: string;
  url?: string;
  createdAt: string;
  status: 'completed' | 'error';
  error?: string;
  summary: Record<string, unknown>;
  hasExpectedContent: boolean;
}

interface AuditRecordSummaryRow {
  id: string;
  type: string;
  filename: string;
  url: string | null;
  created_at: Date;
  status: string;
  error: string | null;
  summary: Record<string, unknown>;
  has_expected_content: boolean;
}

export async function listAuditRecordSummaries(): Promise<AuditRecordSummary[]> {
  const { rows } = await pool.query<AuditRecordSummaryRow>(
    `SELECT id, type, filename, url, created_at, status, error, summary,
            (expected_content IS NOT NULL) AS has_expected_content
     FROM audit_records
     ORDER BY created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type as AuditRecordSummary['type'],
    filename: row.filename,
    url: row.url ?? undefined,
    createdAt: row.created_at.toISOString(),
    status: row.status as AuditRecordSummary['status'],
    error: row.error ?? undefined,
    summary: row.summary,
    hasExpectedContent: row.has_expected_content
  }));
}

export async function getAuditRecord(id: string): Promise<AuditRecord | null> {
  const { rows } = await pool.query<AuditRecordRow>(
    'SELECT * FROM audit_records WHERE id = $1',
    [id]
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}
