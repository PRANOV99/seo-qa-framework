import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HISTORY_DIR = process.env.HISTORY_DIR
  ? path.resolve(process.env.HISTORY_DIR)
  : path.join(__dirname, '..', 'history');

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

export async function ensureHistoryDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

export async function saveAuditRecord(record: AuditRecord): Promise<void> {
  await ensureHistoryDir();
  const filename = `audit-${record.id}.json`;
  await writeFile(
    path.join(HISTORY_DIR, filename),
    JSON.stringify(record, null, 2),
    'utf8'
  );
}

export async function listAuditRecords(): Promise<AuditRecord[]> {
  await ensureHistoryDir();
  const files = (await readdir(HISTORY_DIR)).filter(f => f.endsWith('.json')).sort().reverse();
  const records: AuditRecord[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(path.join(HISTORY_DIR, file), 'utf8');
      const record = JSON.parse(raw) as AuditRecord;
      records.push(record);
    } catch {
      // skip malformed files
    }
  }
  return records;
}

export async function getAuditRecord(id: string): Promise<AuditRecord | null> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(HISTORY_DIR, `audit-${safeId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as AuditRecord;
  } catch {
    return null;
  }
}
