import { Router, type Request, type Response, type NextFunction } from 'express';
import { listAuditRecordSummaries, getAuditRecord } from '../history-store.js';
import { generateDevBugReport } from '../../src/reports/dev-bug-report-generator.js';
import type { ReportData } from '../../src/types/report.js';

const router = Router();

/**
 * GET /api/history
 * Returns list of all stored audits (summary only, no full report).
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Lightweight query — selects only what the History list renders, never
    // the full `report`/`expected_content` JSONB payloads (see
    // listAuditRecordSummaries' doc comment for why that matters).
    const list = await listAuditRecordSummaries();
    res.json({ audits: list, total: list.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/history/:id
 * Returns full audit record (including report) for one run.
 * Add ?download=1 to force an attachment download.
 * Add ?format=dev-report for a Markdown "Dev Bug Report" instead — see
 * dev-bug-report-generator.ts. Testers hand this straight to a developer
 * (or paste it directly into Claude/another AI coding assistant); it needs
 * no access to this tool to be understood or acted on.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await getAuditRecord(String(req.params['id'] ?? ''));
    if (!record) {
      res.status(404).json({ error: 'Audit not found.' });
      return;
    }

    const slug = slugifyFilename(record.filename);

    if (req.query['format'] === 'dev-report') {
      const markdown = generateDevBugReport(record.report as unknown as ReportData, { url: record.url });
      res.setHeader('Content-Disposition', `attachment; filename="bug-report-${slug}.md"`);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      // A leading UTF-8 BOM is redundant for browsers/editors that already
      // trust the charset=utf-8 header above, but several common Windows
      // tools (Notepad, Excel, some editors opening a downloaded .md with no
      // other signal) fall back to the system codepage without one — this
      // report is full of non-ASCII characters (₹, —, …, curly quotes) that
      // then get mangled into "â€¦"-style mojibake on save/reopen. Cheap and
      // harmless to always include.
      res.send('﻿' + markdown);
      return;
    }

    if (req.query['download'] === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="audit-${slug}.json"`);
      res.setHeader('Content-Type', 'application/json');
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

function slugifyFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
}

export default router;
