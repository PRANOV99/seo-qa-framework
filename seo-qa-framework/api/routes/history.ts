import { Router, type Request, type Response, type NextFunction } from 'express';
import { listAuditRecords, getAuditRecord } from '../history-store.js';

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
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await getAuditRecord(String(req.params['id'] ?? ''));
    if (!record) {
      res.status(404).json({ error: 'Audit not found.' });
      return;
    }
    if (req.query['download'] === '1') {
      const slug = record.filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60);
      res.setHeader('Content-Disposition', `attachment; filename="audit-${slug}.json"`);
      res.setHeader('Content-Type', 'application/json');
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
