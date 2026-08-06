import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { upload } from '../middleware/upload.js';
import { saveAuditRecord, getAuditRecord } from '../history-store.js';
import {
  createBatch, getBatch, markItemRunning, markItemSettled, markBatchAborted
} from '../batch-store.js';
import { AuditRunner } from '../../src/runner/audit-runner.js';
import { BlogAuditRunner } from '../../src/runner/blog-audit-runner.js';
import { BlogBatchRunner, type BlogBatchItem } from '../../src/runner/blog-batch-runner.js';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { generateDevBugReport } from '../../src/reports/dev-bug-report-generator.js';
import type { ReportData } from '../../src/types/report.js';
import type { BlogContent } from '../../src/types/blog.js';
import type { AuditParseResult } from '../../src/types/audit.js';
import { parseAuditSheet } from '../../src/parsers/parser-factory.js';
import { normalizeUrl } from '../../src/blog/url-normalizer.js';
import { testConfig } from '../../src/config/test-config.js';
import { logger } from '../../src/logger/logger.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeDelete(filePath: string): Promise<void> {
  try { await unlink(filePath); } catch { /* ignore */ }
}

function parseLighthouseUrls(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as unknown[]).map(String) : undefined;
  } catch {
    return undefined;
  }
}

// ── POST /api/runs/parse ──────────────────────────────────────────────────────
/**
 * Parse an uploaded sheet and return the unique URLs it contains.
 * Used by the frontend to populate the Lighthouse URL selector.
 * Does NOT run an audit — file is deleted after parsing.
 */
router.post(
  '/parse',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }
    try {
      const result = await parseAuditSheet(file.path);

      if (result.mode === 'faq') {
        const faqGroups = result.faqGroups ?? [];
        const unresolvedFaqGroups = result.unresolvedFaqGroups ?? [];
        const urls = faqGroups.map((group) => group.url);
        const faqCount = faqGroups.reduce((sum, group) => sum + group.faqs.length, 0);
        res.json({
          urls,
          rowCount: faqCount,
          mode: result.mode,
          faqPageCount: faqGroups.length,
          faqCount,
          unresolvedFaqLabels: unresolvedFaqGroups.map((group) => group.label)
        });
        return;
      }

      const urls = [...new Set(result.rows.map(r => r.url).filter(Boolean))].sort();
      res.json({ urls, rowCount: result.rows.length, mode: result.mode });
    } catch (error) {
      next(error);
    } finally {
      await safeDelete(file.path);
    }
  }
);

// ── POST /api/runs ────────────────────────────────────────────────────────────
/**
 * Upload a file and run the appropriate audit.
 *
 * Form fields:
 *   file                required  .xlsx / .csv / .docx
 *   url                 for .docx the live blog URL
 *   baseUrl             optional site base URL override (sheets)
 *   alwaysRunRedirects  '0' to disable, anything else = enabled (default on)
 *   alwaysRunBrokenLinks'0' to disable (default on)
 *   alwaysRunA11y       '0' to disable (default on)
 *   noLighthouse        '1' to disable (kept for CLI compat, overrides lighthouseUrls)
 *   lighthouseUrls      JSON array of URLs e.g. '["https://...","https://..."]'
 *                       '[]' = none, absent = determined by noLighthouse flag
 */
router.post(
  '/',
  upload.single('file'),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (req: Request, res: Response, _next: NextFunction) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const auditType: 'sheet' | 'blog' = ext === '.docx' ? 'blog' : 'sheet';
    const liveUrl: string = String(req.body.url ?? '').trim();

    if (auditType === 'blog' && !liveUrl) {
      await safeDelete(file.path);
      res.status(400).json({ error: 'A live URL is required for blog (.docx) audits.' });
      return;
    }

    // Lighthouse URL list — undefined means "use sheet dispatch", [] means none
    const rawLhUrls = String(req.body.lighthouseUrls ?? '').trim();
    const noLighthouse = req.body.noLighthouse === '1';
    let lighthouseUrls: string[] | undefined = noLighthouse ? [] : parseLighthouseUrls(rawLhUrls);

    // Blog: default to running Lighthouse on the single URL unless disabled
    if (auditType === 'blog' && lighthouseUrls === undefined) {
      lighthouseUrls = noLighthouse ? [] : [liveUrl];
    }

    const alwaysRunRedirects = req.body.alwaysRunRedirects  !== '0';
    const alwaysRunBrokenLinks = req.body.alwaysRunBrokenLinks !== '0';
    const alwaysRunA11y      = req.body.alwaysRunA11y      !== '0';

    const id = uuidv4();

    try {
      let result;

      if (auditType === 'sheet') {
        const runner = new AuditRunner({
          baseUrl:                     String(req.body.baseUrl ?? '').trim() || undefined,
          captureScreenshotsOnFailure: false,
          enableLighthouseChecks:      !noLighthouse,
          enableAccessibilityChecks:   req.body.noAccessibility !== '1',
          alwaysRunRedirectCheck:      alwaysRunRedirects,
          alwaysRunBrokenLinkCheck:    alwaysRunBrokenLinks,
          alwaysRunAccessibilityCheck: alwaysRunA11y,
          lighthouseUrls,
        });
        result = await runner.run(file.path);
      } else {
        const runner = new BlogAuditRunner({
          alwaysRunRedirectCheck:      alwaysRunRedirects,
          alwaysRunBrokenLinkCheck:    alwaysRunBrokenLinks,
          alwaysRunAccessibilityCheck: alwaysRunA11y,
          lighthouseUrls,
        });
        result = await runner.run(file.path, liveUrl);
      }

      const reportData = buildReportData(result);

      const auditConfig = {
        redirectCheckEnabled:      alwaysRunRedirects,
        brokenLinkCheckEnabled:    alwaysRunBrokenLinks,
        accessibilityCheckEnabled: alwaysRunA11y,
        lighthouseUrls,
      };

      const record = {
        id,
        type: auditType,
        filename: file.originalname,
        url: liveUrl || undefined,
        createdAt: result.startedAt,
        status: 'completed' as const,
        auditConfig,
        summary:  reportData.summary  as unknown as Record<string, unknown>,
        report:   reportData          as unknown as Record<string, unknown>,
        // `result.expected` (BlogContent) for blog runs, `result.expectedSheet`
        // (AuditParseResult) for sheet runs — see the AuditRunResult doc
        // comments for why each is only ever set on its own run type.
        expectedContent: (auditType === 'blog' ? result.expected : result.expectedSheet) as unknown as Record<string, unknown> | undefined,
      };

      await saveAuditRecord(record);

      res.json({ id, type: auditType, filename: file.originalname,
                 createdAt: result.startedAt, auditConfig,
                 summary: reportData.summary, report: reportData });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[runs] Audit failed', { message });

      await saveAuditRecord({
        id, type: auditType, filename: file.originalname,
        url: liveUrl || undefined,
        createdAt: new Date().toISOString(),
        status: 'error', error: message, summary: {}, report: {},
      });

      res.status(500).json({ error: `Audit failed: ${message}`, id });
    } finally {
      await safeDelete(file.path);
    }
  }
);

// ── Blog Testing batch ─────────────────────────────────────────────────────────
//
// Batch mode orchestrates multiple existing single-blog audits — it reuses
// BlogAuditRunner/buildReportData/saveAuditRecord exactly as-is via
// BlogBatchRunner, so every blog in a batch is saved and viewable through the
// same history/results plumbing as any other blog audit. Nothing here
// changes the single-blog report structure; it only adds a thin sequential
// orchestration layer and a lightweight combined summary on top.

/** GET /api/runs/batch/config — exposes the server-configured batch size limit so the UI never hardcodes it. */
router.get('/batch/config', (_req: Request, res: Response) => {
  res.json({ maxBatchSize: testConfig.maxBlogBatchSize });
});

/**
 * POST /api/runs/batch
 * Form fields:
 *   files  required  up to `maxBlogBatchSize` .docx files
 *   urls   required  JSON array of live URLs, same order/count as `files`
 * Responds immediately with { batchId, total } and processes the batch
 * sequentially in the background — poll GET /api/runs/batch/:id for progress.
 */
router.post(
  '/batch',
  upload.array('files', testConfig.maxBlogBatchSize),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (req: Request, res: Response, _next: NextFunction) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (files.length === 0) {
      res.status(400).json({ error: 'At least one blog document is required.' });
      return;
    }

    const nonDocx = files.filter((f) => path.extname(f.originalname).toLowerCase() !== '.docx');
    if (nonDocx.length > 0) {
      await Promise.all(files.map((f) => safeDelete(f.path)));
      res.status(400).json({
        error: `Blog Testing only accepts .docx files. Invalid file(s): ${nonDocx.map((f) => f.originalname).join(', ')}`
      });
      return;
    }

    let urls: string[];
    try {
      const parsed: unknown = JSON.parse(String(req.body.urls ?? '[]'));
      urls = Array.isArray(parsed) ? (parsed as unknown[]).map(String) : [];
    } catch {
      urls = [];
    }

    if (urls.length !== files.length) {
      await Promise.all(files.map((f) => safeDelete(f.path)));
      res.status(400).json({
        error: `Expected one live URL per blog document (${files.length}), but received ${urls.length}.`
      });
      return;
    }

    if (urls.some((u) => !u.trim())) {
      await Promise.all(files.map((f) => safeDelete(f.path)));
      res.status(400).json({ error: 'A live URL is required for every blog document.' });
      return;
    }

    // Duplicate URL validation — normalised so tracking-param / trailing-slash
    // variants of the same page are also caught, not just exact string matches.
    const trimmedUrls = urls.map((u) => u.trim());
    const seenNormalized = new Set<string>();
    const duplicates = new Set<string>();
    for (const u of trimmedUrls) {
      const normalized = normalizeUrl(u, u);
      if (seenNormalized.has(normalized)) duplicates.add(u);
      seenNormalized.add(normalized);
    }
    if (duplicates.size > 0) {
      await Promise.all(files.map((f) => safeDelete(f.path)));
      res.status(400).json({
        error: `Duplicate live URL(s) in this batch: ${[...duplicates].join(', ')}. Each blog must have a unique URL.`
      });
      return;
    }

    if (files.length > testConfig.maxBlogBatchSize) {
      await Promise.all(files.map((f) => safeDelete(f.path)));
      res.status(400).json({ error: `A batch can contain at most ${testConfig.maxBlogBatchSize} blog documents.` });
      return;
    }

    const items: BlogBatchItem[] = files.map((file, i) => ({
      docxSource: file.path,
      url: trimmedUrls[i]!,
      filename: file.originalname
    }));

    const batchId = uuidv4();
    createBatch(batchId, items.map(({ filename, url }) => ({ filename, url })));

    res.json({ batchId, total: items.length });

    void processBlogBatch(batchId, items);
  }
);

/** GET /api/runs/batch/:id — progress/status for polling. */
router.get('/batch/:id', (req: Request, res: Response) => {
  const batch = getBatch(String(req.params['id'] ?? ''));
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }
  res.json(batch);
});

/** GET /api/runs/batch/:id/download — combined summary across every blog in the batch (individual reports still use GET /api/history/:id?download=1). */
router.get('/batch/:id/download', (req: Request, res: Response) => {
  const batch = getBatch(String(req.params['id'] ?? ''));
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const passed = batch.items.filter((i) => i.status === 'done' && (i.summary?.['blogContent'] as { failed?: number } | undefined)?.failed === 0).length;
  const failed = batch.items.filter((i) => i.status === 'done' && ((i.summary?.['blogContent'] as { failed?: number } | undefined)?.failed ?? 0) > 0).length;
  const errored = batch.items.filter((i) => i.status === 'error').length;
  const totalMismatches = batch.items.reduce(
    (sum, i) => sum + ((i.summary?.['blogContent'] as { failed?: number } | undefined)?.failed ?? 0),
    0
  );

  const combined = {
    batchId: batch.id,
    createdAt: batch.createdAt,
    totalBlogs: batch.total,
    passed,
    failed,
    errored,
    totalMismatches,
    blogs: batch.items.map((i) => ({
      filename: i.filename,
      url: i.url,
      status: i.status,
      auditId: i.auditId,
      summary: i.summary,
      error: i.error
    }))
  };

  const slug = `batch-${batch.id}`.slice(0, 60);
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(combined);
});

/**
 * GET /api/runs/batch/:id/dev-report
 * One combined Markdown "Dev Bug Report" across every blog in the batch —
 * each blog's own stored audit record (already saved individually via
 * saveAuditRecord, same as any single blog run) is rendered through the
 * same generateDevBugReport() used for a single blog, one section per blog.
 */
router.get('/batch/:id/dev-report', async (req: Request, res: Response) => {
  const batch = getBatch(String(req.params['id'] ?? ''));
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const lines: string[] = [];
  lines.push('# Blog Content Bug Report — Batch', '');
  lines.push(
    `Combined report for ${batch.total} blog(s) tested together. Each blog's issues are in its own section ` +
    'below, in the exact same format as a single-blog report — every fix described belongs in the website/CMS ' +
    'that serves that blog\'s live URL, not in the seo-qa-framework tool itself.',
    ''
  );

  for (const item of batch.items) {
    lines.push('---', '', `## ${item.filename}`, '');
    if (item.status === 'error' || !item.auditId) {
      lines.push(`This blog could not be tested: ${item.error ?? 'unknown error'}.`, '');
      continue;
    }
    const record = await getAuditRecord(item.auditId);
    if (!record) {
      lines.push('This blog\'s audit record could not be found.', '');
      continue;
    }
    // Drop this section's own top-level "# 🐛 Blog Content Bug Report" /
    // "## Overview" heading level down by one so it nests under this blog's
    // "##" heading instead of competing with the batch-level title.
    const singleReport = generateDevBugReport(record.report as unknown as ReportData, { url: record.url });
    lines.push(nestHeadings(singleReport), '');
  }

  const slug = `batch-${batch.id}-bug-report`.slice(0, 60);
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.md"`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  // See the equivalent BOM comment in history.ts's dev-report route — same
  // non-ASCII-mojibake-on-Windows-tools reasoning applies to this combined
  // batch report.
  res.send('﻿' + lines.join('\n'));
});

/** Demotes every Markdown heading in a single-blog report by two levels (# -> ###, ## -> ####, ...) so it nests correctly under a batch-level "##" section heading. */
function nestHeadings(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (/^#{1,4}\s/.test(line) ? `##${line}` : line))
    .join('\n');
}

/** Deletes the item's uploaded .docx, if it has one — a rerun item carries already-parsed BlogContent instead of a file, so there's nothing to clean up. */
async function safeDeleteBatchItemFile(item: BlogBatchItem): Promise<void> {
  if (typeof item.docxSource === 'string') await safeDelete(item.docxSource);
}

/** Runs a Blog Testing batch sequentially in the background, persisting each blog exactly like a normal single blog audit. */
async function processBlogBatch(batchId: string, items: BlogBatchItem[]): Promise<void> {
  try {
    const runner = new BlogBatchRunner();
    await runner.run(items, {
      onStart: (index) => {
        markItemRunning(batchId, index);
      },
      onComplete: async (index, _total, item, itemResult) => {
        if (itemResult.status === 'done' && itemResult.result) {
          const reportData = buildReportData(itemResult.result);
          const auditId = uuidv4();
          await saveAuditRecord({
            id: auditId,
            type: 'blog',
            filename: item.filename,
            url: item.url,
            createdAt: itemResult.result.startedAt,
            status: 'completed',
            summary: reportData.summary as unknown as Record<string, unknown>,
            report: reportData as unknown as Record<string, unknown>,
            expectedContent: itemResult.result.expected as unknown as Record<string, unknown> | undefined
          });
          markItemSettled(batchId, index, {
            status: 'done',
            auditId,
            summary: reportData.summary as unknown as Record<string, unknown>
          });
        } else {
          markItemSettled(batchId, index, { status: 'error', error: itemResult.error ?? 'Unknown error.' });
        }
        await safeDeleteBatchItemFile(item);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[runs] Blog batch aborted unexpectedly.', { batchId, message });
    markBatchAborted(batchId, message);
    await Promise.all(items.map((item) => safeDeleteBatchItemFile(item)));
  }
}

/**
 * POST /api/runs/rerun
 * Re-runs one or more previously-tested blogs against a fresh crawl of
 * their live URL, WITHOUT re-uploading the .docx — reuses the approved
 * content saved on each blog's history record (see AuditRecord.expectedContent)
 * and the exact same batch pipeline as a normal upload-driven batch.
 * Body: { auditIds: string[] }
 * Responds { batchId, total, skipped } — `skipped` lists any selected audits
 * that couldn't be re-run (not found, not a blog, or predate this feature).
 */
router.post('/rerun', async (req: Request, res: Response) => {
  const rawIds: unknown = req.body?.auditIds;
  const auditIds = Array.isArray(rawIds) ? rawIds.map(String).filter(Boolean) : [];

  if (auditIds.length === 0) {
    res.status(400).json({ error: 'At least one blog audit must be selected to re-run.' });
    return;
  }
  if (auditIds.length > testConfig.maxBlogBatchSize) {
    res.status(400).json({ error: `You can re-run at most ${testConfig.maxBlogBatchSize} blogs at a time.` });
    return;
  }

  const items: BlogBatchItem[] = [];
  const skipped: string[] = [];

  for (const auditId of auditIds) {
    const record = await getAuditRecord(auditId);
    if (!record) { skipped.push(`Audit ${auditId} was not found.`); continue; }
    if (record.type !== 'blog') { skipped.push(`"${record.filename}" is not a blog audit.`); continue; }
    if (!record.url) { skipped.push(`"${record.filename}" has no live URL on record.`); continue; }
    if (!record.expectedContent) {
      skipped.push(`"${record.filename}" was tested before re-running was supported — upload it once more to enable this.`);
      continue;
    }
    items.push({
      docxSource: record.expectedContent as unknown as BlogContent,
      url: record.url,
      filename: record.filename
    });
  }

  if (items.length === 0) {
    res.status(400).json({ error: `None of the selected blogs could be re-run. ${skipped.join(' ')}`.trim() });
    return;
  }

  const batchId = uuidv4();
  createBatch(batchId, items.map(({ filename, url }) => ({ filename, url })));

  res.json({ batchId, total: items.length, skipped });

  void processBlogBatch(batchId, items);
});

/**
 * POST /api/runs/rerun-sheet
 * Re-runs a previously-tested sheet (.xlsx/.csv) audit against a fresh crawl
 * of its URLs, WITHOUT re-uploading the file — reuses the parsed sheet
 * content saved on the audit's history record (see
 * AuditRecord.expectedContent). Unlike blog re-run, this runs synchronously
 * and returns the same shape as POST /api/runs: a sheet audit is already a
 * single one-shot run over (potentially many) URLs, not a batch of
 * independent per-URL items, so there's no need for the blog batch/polling
 * pipeline here.
 * Body: { auditId: string }
 */
router.post(
  '/rerun-sheet',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (req: Request, res: Response, _next: NextFunction) => {
    const auditId = String(req.body?.auditId ?? '').trim();
    if (!auditId) {
      res.status(400).json({ error: 'auditId is required.' });
      return;
    }

    const record = await getAuditRecord(auditId);
    if (!record) {
      res.status(404).json({ error: 'Audit not found.' });
      return;
    }
    if (record.type !== 'sheet') {
      res.status(400).json({ error: `"${record.filename}" is not a sheet audit.` });
      return;
    }
    if (!record.expectedContent) {
      res.status(400).json({
        error: `"${record.filename}" was tested before re-running was supported — upload it once more to enable this.`
      });
      return;
    }

    const id = uuidv4();
    try {
      const runner = new AuditRunner();
      const result = await runner.run(record.expectedContent as unknown as AuditParseResult);
      const reportData = buildReportData(result);

      await saveAuditRecord({
        id,
        type: 'sheet',
        filename: record.filename,
        url: record.url,
        createdAt: result.startedAt,
        status: 'completed',
        summary: reportData.summary as unknown as Record<string, unknown>,
        report: reportData as unknown as Record<string, unknown>,
        expectedContent: result.expectedSheet as unknown as Record<string, unknown> | undefined,
      });

      res.json({
        id, type: 'sheet', filename: record.filename,
        createdAt: result.startedAt, summary: reportData.summary, report: reportData
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[runs] Sheet re-run failed', { auditId, message });

      await saveAuditRecord({
        id, type: 'sheet', filename: record.filename, url: record.url,
        createdAt: new Date().toISOString(),
        status: 'error', error: message, summary: {}, report: {},
      });

      res.status(500).json({ error: `Re-run failed: ${message}`, id });
    }
  }
);

// ── GET /api/runs/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await getAuditRecord(String(req.params['id'] ?? ''));
    if (!record) {
      res.status(404).json({ error: 'Audit not found.' });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
