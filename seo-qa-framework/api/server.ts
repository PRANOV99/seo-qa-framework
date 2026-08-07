import express from 'express';
import cors from 'cors';
import { logger } from '../src/logger/logger.js';
import { ensureSchema } from './db.js';
import runsRouter from './routes/runs.js';
import historyRouter from './routes/history.js';
import compareRouter from './routes/compare.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── Crash safety net ─────────────────────────────────────────────────────────
// An audit run spawns external processes (Playwright's browser, Lighthouse's
// chrome-launcher) that can occasionally throw or reject completely outside
// the request's own try/catch (e.g. an EventEmitter 'error' event on a child
// process with no listener of its own — Node crashes the whole process for
// that regardless of any surrounding try/catch, since it isn't a normal
// promise rejection). Without a handler here, ONE bad audit takes the entire
// server down, dropping every other in-flight/future request until something
// restarts it — that's a "Failed to fetch" for every user, not just the one
// whose request actually failed. This is deliberately narrow: log and keep
// the process alive, rather than the (correctly) more cautious general advice
// to always exit on an uncaught exception — the specific failure mode this
// guards against is well-understood and isolated to one external process,
// not shared server state (the HTTP listener, the DB pool, in-memory stores).
process.on('uncaughtException', (error) => {
  logger.error('[API] Uncaught exception — the server is staying up, but the request that triggered this may have failed.', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('[API] Unhandled promise rejection — the server is staying up, but the request that triggered this may have failed.', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

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

// Fail fast on startup if PostgreSQL (audit history) isn't reachable rather
// than surfacing a confusing error on the first audit run later.
try {
  await ensureSchema();
} catch (error) {
  logger.error('[API] Could not initialize PostgreSQL schema — is DATABASE_URL set and reachable?', {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}

app.listen(PORT, () => {
  logger.info(`SEO QA API listening on port ${PORT}`);
});

export default app;
