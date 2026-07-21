import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { upload } from '../middleware/upload.js';
import { saveAuditRecord, getAuditRecord } from '../history-store.js';
import { AuditRunner } from '../../src/runner/audit-runner.js';
import { BlogAuditRunner } from '../../src/runner/blog-audit-runner.js';
import { buildReportData } from '../../src/reports/report-data-builder.js';
import { createAuditSheetParser } from '../../src/parsers/parser-factory.js';
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
      const parser = createAuditSheetParser(file.path);
      const result = await parser.parse(file.path);
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
