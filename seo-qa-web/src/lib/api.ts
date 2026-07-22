const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Health ─────────────────────────────────────────────────────────────────────
export async function getHealth() {
  return request<{ ok: boolean; version: string; timestamp: string }>('/health');
}

// ── Parse (sheet URL extraction) ──────────────────────────────────────────────
export interface ParseResult {
  urls: string[];
  rowCount: number;
  mode: string;
}

export async function parseSheet(file: File): Promise<ParseResult> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/runs/parse`, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ParseResult>;
}

// ── Runs ───────────────────────────────────────────────────────────────────────
export interface AuditConfig {
  redirectCheckEnabled: boolean;
  brokenLinkCheckEnabled: boolean;
  accessibilityCheckEnabled: boolean;
  lighthouseUrls?: string[];
}

export interface RunResult {
  id: string;
  type: 'sheet' | 'blog';
  filename: string;
  url?: string;
  createdAt: string;
  auditConfig?: AuditConfig;
  summary: AuditSummary;
  report: ReportData;
}

export async function postRun(formData: FormData): Promise<RunResult> {
  const res = await fetch(`${API_BASE}/runs`, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<RunResult>;
}

export async function getRun(id: string): Promise<AuditRecord> {
  return request<AuditRecord>(`/runs/${encodeURIComponent(id)}`);
}

// ── History ────────────────────────────────────────────────────────────────────
export interface AuditRecord {
  id: string;
  type: 'sheet' | 'blog';
  filename: string;
  url?: string;
  createdAt: string;
  status: 'completed' | 'error';
  error?: string;
  auditConfig?: AuditConfig;
  summary: AuditSummary;
  report: ReportData;
}

export interface HistoryList {
  audits: AuditRecord[];
  total: number;
}

export async function getHistory(): Promise<HistoryList> {
  return request<HistoryList>('/history');
}

export async function getHistoryRecord(id: string): Promise<AuditRecord> {
  return request<AuditRecord>(`/history/${encodeURIComponent(id)}`);
}

// ── Compare ────────────────────────────────────────────────────────────────────
export interface ComparisonResult {
  baseline: { id: string; filename: string; createdAt: string };
  target:   { id: string; filename: string; createdAt: string };
  fixed:        FailingEntry[];
  newIssues:    FailingEntry[];
  stillFailing: FailingEntry[];
  counts: { fixed: number; newIssues: number; stillFailing: number };
}

export interface FailingEntry {
  key: string;
  category: string;
  url: string;
  description: string;
}

export async function postCompare(aId: string, bId: string): Promise<ComparisonResult> {
  return request<ComparisonResult>('/compare', {
    method: 'POST',
    body: JSON.stringify({ aId, bId }),
  });
}

// ── Download ───────────────────────────────────────────────────────────────────
export function downloadUrl(id: string): string {
  return `${API_BASE}/history/${encodeURIComponent(id)}?download=1`;
}

// ── Blog Testing batch ───────────────────────────────────────────────────────────
export interface BatchConfig {
  maxBatchSize: number;
}

export async function getBatchConfig(): Promise<BatchConfig> {
  return request<BatchConfig>('/runs/batch/config');
}

export interface BatchItemStatus {
  index: number;
  filename: string;
  url: string;
  status: 'pending' | 'running' | 'done' | 'error';
  auditId?: string;
  summary?: AuditSummary;
  error?: string;
}

export interface BatchStatus {
  id: string;
  total: number;
  completed: number;
  currentIndex: number | null;
  currentFilename: string | null;
  status: 'running' | 'done';
  createdAt: string;
  items: BatchItemStatus[];
}

export async function postBlogBatch(files: File[], urls: string[]): Promise<{ batchId: string; total: number }> {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  fd.append('urls', JSON.stringify(urls));

  const res = await fetch(`${API_BASE}/runs/batch`, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ batchId: string; total: number }>;
}

export async function getBatchStatus(batchId: string): Promise<BatchStatus> {
  return request<BatchStatus>(`/runs/batch/${encodeURIComponent(batchId)}`);
}

export function combinedBatchDownloadUrl(batchId: string): string {
  return `${API_BASE}/runs/batch/${encodeURIComponent(batchId)}/download`;
}

// ── Shared types (mirrors backend ReportData shape) ───────────────────────────
export interface AuditSummary {
  sourcePath: string;
  kind: 'sheet' | 'blog';
  generatedAt: string;
  durationMs: number;
  totalRows: number;
  seoChecks:   { passed: number; failed: number; warning: number; total: number };
  redirects:   { passed: number; failed: number; warning: number; total: number };
  brokenLinks: { passed: number; failed: number; warning: number; total: number };
  accessibility: { passed: number; failed: number; warning: number; total: number };
  accessibilityViolations: number;
  lighthouse: {
    auditedPages: number;
    errors: number;
    averageScores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  };
  skippedRows: number;
  blogContent?: {
    totalChecks: number;
    passed: number;
    failed: number;
    missingContent: number;
    modifiedContent: number;
    metadataIssues: number;
    boldText: {
      total: number;
      passed: number;
      missing: number;
      modified: number;
      extra: number;
    };
  };
}

export type DiffSegmentType = 'same' | 'added' | 'removed' | 'changed';

export interface DiffSegment {
  type: DiffSegmentType;
  expected?: string;
  actual?: string;
}

export interface SeoCheckResult {
  url: string;
  checkType: string;
  status: 'passed' | 'failed' | 'skipped' | 'warning';
  expected?: string;
  actual?: string;
  message?: string;
  screenshotPath?: string;
  /** Word-level diff, present only for a failed paragraph comparison with a genuine text change. */
  diff?: DiffSegment[];
}

export interface RedirectResult {
  originalUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectCount: number;
  responseTime: number;
  result: 'PASS' | 'FAIL' | 'WARNING';
  recommendation: string;
}

export interface BrokenLinkResult {
  pageUrl: string;
  link: string;
  linkType: string;
  statusCode: number;
  status: 'PASS' | 'FAIL' | 'WARNING';
  message: string;
}

export interface AccessibilityResult {
  url: string;
  status: 'PASS' | 'FAIL';
  violations: { id: string; impact: string | null; description: string; helpUrl: string; nodeCount: number }[];
  passCount: number;
  incompleteCount: number;
  fetchedAt: string;
}

export interface LighthouseResult {
  url: string;
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  fetchedAt: string;
  error?: string;
}

export interface ReportData {
  summary: AuditSummary;
  categories: { category: string; passed: number; failed: number; skipped: number; total: number }[];
  seoCheckResults: SeoCheckResult[];
  redirectResults: RedirectResult[];
  brokenLinkResults: BrokenLinkResult[];
  accessibilityResults: AccessibilityResult[];
  lighthouseResults: LighthouseResult[];
  skipped: { auditRow: { url: string; checkType: string; issueType: string }; reason: string }[];
}
