/**
 * Ephemeral, in-memory progress tracking for Blog Testing batches.
 *
 * Unlike history-store.ts, batch records are not persisted to disk — a batch
 * run is a short-lived orchestration of several individually-persisted blog
 * audits (each saved via the existing saveAuditRecord/history-store, exactly
 * like a normal single blog run). Losing in-flight batch progress on a
 * server restart is acceptable; the underlying per-blog audit records are
 * not affected.
 */

export interface BatchItemStatus {
  index: number;
  filename: string;
  url: string;
  status: 'pending' | 'running' | 'done' | 'error';
  auditId?: string;
  summary?: Record<string, unknown>;
  error?: string;
}

export interface BatchRecord {
  id: string;
  total: number;
  completed: number;
  currentIndex: number | null;
  currentFilename: string | null;
  status: 'running' | 'done';
  createdAt: string;
  items: BatchItemStatus[];
}

/** How long a finished batch record stays available for polling/combined-download after it completes. */
const BATCH_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours

const batches = new Map<string, BatchRecord>();

export function createBatch(id: string, items: ReadonlyArray<{ filename: string; url: string }>): BatchRecord {
  const record: BatchRecord = {
    id,
    total: items.length,
    completed: 0,
    currentIndex: null,
    currentFilename: null,
    status: 'running',
    createdAt: new Date().toISOString(),
    items: items.map((item, index) => ({
      index,
      filename: item.filename,
      url: item.url,
      status: 'pending'
    }))
  };
  batches.set(id, record);
  return record;
}

export function getBatch(id: string): BatchRecord | undefined {
  return batches.get(id);
}

export function markItemRunning(batchId: string, index: number): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  const item = batch.items[index];
  if (!item) return;
  item.status = 'running';
  batch.currentIndex = index;
  batch.currentFilename = item.filename;
}

export function markItemSettled(
  batchId: string,
  index: number,
  update: Pick<BatchItemStatus, 'status'> & Partial<Pick<BatchItemStatus, 'auditId' | 'summary' | 'error'>>
): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  const item = batch.items[index];
  if (item) Object.assign(item, update);

  batch.completed += 1;
  if (batch.completed >= batch.total) {
    finishBatch(batch);
  }
}

/** Marks any not-yet-settled items as errored and closes out the batch — used when the background job itself throws. */
export function markBatchAborted(batchId: string, error: string): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  for (const item of batch.items) {
    if (item.status === 'pending' || item.status === 'running') {
      item.status = 'error';
      item.error = error;
      batch.completed += 1;
    }
  }
  finishBatch(batch);
}

function finishBatch(batch: BatchRecord): void {
  batch.status = 'done';
  batch.currentIndex = null;
  batch.currentFilename = null;
  setTimeout(() => batches.delete(batch.id), BATCH_RETENTION_MS).unref();
}
