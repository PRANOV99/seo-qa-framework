import { Router, type Request, type Response, type NextFunction } from 'express';
import { getAuditRecord } from '../history-store.js';
import { compareFailingEntries, buildFailingEntries } from '../../src/history/history-compare.js';

const router = Router();

/**
 * POST /api/compare
 * Body: { aId: string, bId: string }
 *   aId = older/baseline run
 *   bId = newer run
 * Returns { fixed, newIssues, stillFailing }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { aId, bId } = req.body as { aId?: string; bId?: string };

    if (!aId || !bId) {
      res.status(400).json({ error: 'Both aId and bId are required.' });
      return;
    }

    const [recordA, recordB] = await Promise.all([
      getAuditRecord(aId),
      getAuditRecord(bId),
    ]);

    if (!recordA) {
      res.status(404).json({ error: `Audit ${aId} not found.` });
      return;
    }
    if (!recordB) {
      res.status(404).json({ error: `Audit ${bId} not found.` });
      return;
    }

    // Build failing entry lists from each record's stored report data
    const entriesA = buildFailingEntries(recordA.report as unknown as Parameters<typeof buildFailingEntries>[0]);
    const entriesB = buildFailingEntries(recordB.report as unknown as Parameters<typeof buildFailingEntries>[0]);

    const comparison = compareFailingEntries(entriesA, entriesB);

    res.json({
      baseline: { id: recordA.id, filename: recordA.filename, createdAt: recordA.createdAt },
      target:   { id: recordB.id, filename: recordB.filename, createdAt: recordB.createdAt },
      fixed:        comparison.fixed,
      newIssues:    comparison.newIssues,
      stillFailing: comparison.stillFailing,
      counts: {
        fixed:        comparison.fixed.length,
        newIssues:    comparison.newIssues.length,
        stillFailing: comparison.stillFailing.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
