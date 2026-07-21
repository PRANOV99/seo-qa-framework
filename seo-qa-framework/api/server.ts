import express from 'express';
import cors from 'cors';
import { logger } from '../src/logger/logger.js';
import runsRouter from './routes/runs.js';
import historyRouter from './routes/history.js';
import compareRouter from './routes/compare.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, cb) => {
        if (!origin || allowedOrigins.some(o => origin.startsWith(o.trim()))) {
          cb(null, true);
        } else {
          cb(new Error('Not allowed by CORS'));
        }
      }
    : true,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/runs',    runsRouter);
app.use('/api/history', historyRouter);
app.use('/api/compare', compareRouter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: '1.0.0', timestamp: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
// Express requires a 4-argument signature to recognise error-handling middleware.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('[API Error]', { message: err.message });
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`SEO QA API listening on port ${PORT}`);
});

export default app;
