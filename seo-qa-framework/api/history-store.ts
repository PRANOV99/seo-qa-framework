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
   * The approved blog content parsed from the .docx (BlogContent, stored
   * loosely like `summary`/`report`) — only present for completed blog
   * runs. Lets the SAME blog be re-tested later against a fresh crawl of
   * the live page without re-uploading the document (see POST
   * /api/runs/rerun).
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

export async function getAuditRecord(id: string): Promise<AuditRecord | null> {
  const { rows } = await pool.query<AuditRecordRow>(
    'SELECT * FROM audit_records WHERE id = $1',
    [id]
  );
  return rows[0] ? rowToRecord(rows[0]) : null;
}
