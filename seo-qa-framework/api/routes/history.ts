import { Router, type Request, type Response, type NextFunction } from 'express';
import { listAuditRecords, getAuditRecord } from '../history-store.js';
import { generateDevBugReport } from '../../src/reports/dev-bug-report-generator.js';
import type { ReportData } from '../../src/types/report.js';

const router = Router();

/**
 * GET /api/history
 * Returns list of all stored audits (summary only, no full report).
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await listAuditRecords();
    // Return lightweight list without the full report payload
    const list = records.map(r => ({
      id: r.id,
      type: r.type,
      filename: r.filename,
      url: r.url,
      createdAt: r.createdAt,
      status: r.status,
      error: r.error,
      summary: r.summary,
    }));
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
      res.send(markdown);
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
