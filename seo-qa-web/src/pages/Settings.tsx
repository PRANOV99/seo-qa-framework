import { useEffect, useState } from 'react';
import { Server, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { getHealth } from '../lib/api';

interface Health { ok: boolean; version: string; timestamp: string }

export default function Settings() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;

  async function checkHealth() {
    setChecking(true); setError('');
    try {
      const h = await getHealth();
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot reach backend');
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { checkHealth(); }, []);

  const endpoints = [
    { method: 'GET',  path: '/api/health',        desc: 'Health check' },
    { method: 'POST', path: '/api/runs',           desc: 'Upload file and run audit' },
    { method: 'GET',  path: '/api/runs/:id',       desc: 'Get a single run result' },
    { method: 'GET',  path: '/api/history',        desc: 'List all audit history' },
    { method: 'GET',  path: '/api/history/:id',    desc: 'Get historical audit JSON' },
    { method: 'POST', path: '/api/compare',        desc: 'Compare two audit runs' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Application configuration, API status, and usage reference.</p>
      </div>

      {/* API Health */}
      <div className="section" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={16} />
            <span className="section-title">Backend API Status</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={checkHealth} disabled={checking}>
            <RefreshCw size={13} className={checking ? 'spin' : ''} /> Refresh
          </button>
        </div>
        <div className="section-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {checking ? (
              <><div className="spinner" /> <span className="text-muted">Checking…</span></>
            ) : health?.ok ? (
              <><CheckCircle size={18} style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>Connected</span>
                <span className="text-muted text-sm">· v{health.version}</span></>
            ) : (
              <><XCircle size={18} style={{ color: 'var(--danger)' }} />
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Unreachable</span>
                {error && <span className="text-muted text-sm">· {error}</span>}</>
            )}
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">API Base URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-control" readOnly value={apiUrl} style={{ fontFamily: 'monospace', fontSize: 13 }} />
            </div>
            <div className="form-hint">
              Set <code>VITE_API_URL</code> in the frontend environment to point to your Render backend.
              Leave empty for local development (Vite proxy handles <code>/api/*</code> requests).
            </div>
          </div>
        </div>
      </div>

      {/* API Reference */}
      <div className="section" style={{ marginBottom: 20 }}>
        <div className="section-header"><span className="section-title">API Endpoints</span></div>
        <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
            <tbody>
              {endpoints.map(e => (
                <tr key={e.path}>
                  <td><code style={{ background: e.method === 'POST' ? '#fef3c7' : '#dbeafe', color: e.method === 'POST' ? '#92400e' : '#1e40af' }}>{e.method}</code></td>
                  <td><code>{e.path}</code></td>
                  <td className="text-muted text-sm">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deployment guide */}
      <div className="section" style={{ marginBottom: 20 }}>
        <div className="section-header"><span className="section-title">Deployment Guide</span></div>
        <div className="section-body">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Frontend → Vercel</div>
            <pre>{`# 1. Push seo-qa-web/ to GitHub
# 2. Import project in Vercel dashboard
# 3. Set root directory to: seo-qa-web
# 4. Set environment variable:
VITE_API_URL=https://your-app.onrender.com
# 5. Deploy — Vercel detects Vite automatically`}</pre>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Backend → Render</div>
            <pre>{`# 1. Push seo-qa-framework/ to GitHub
# 2. Create Web Service in Render dashboard
# 3. Build command:   npm install && npm run build
# 4. Start command:   node dist/api/server.js
# 5. Set environment variables:
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app
# 6. Install Playwright browsers in Render:
# Add build step:  npx playwright install chromium --with-deps`}</pre>
          </div>
        </div>
      </div>

      {/* Environment variables */}
      <div className="section">
        <div className="section-header"><span className="section-title">Environment Variables</span></div>
        <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead><tr><th>Variable</th><th>Where</th><th>Description</th></tr></thead>
            <tbody>
              {[
                { var: 'VITE_API_URL',   where: 'Frontend (Vercel)', desc: 'Full URL of the backend API (e.g. https://your-app.onrender.com)' },
                { var: 'PORT',           where: 'Backend (Render)',  desc: 'Port for the Express server (default: 3001)' },
                { var: 'FRONTEND_URL',   where: 'Backend (Render)',  desc: 'Frontend origin for CORS (e.g. https://your-app.vercel.app)' },
                { var: 'NODE_ENV',       where: 'Backend (Render)',  desc: 'Set to production for the deployed backend' },
                { var: 'UPLOAD_DIR',     where: 'Backend (optional)',desc: 'Override default uploads directory' },
                { var: 'HISTORY_DIR',    where: 'Backend (optional)',desc: 'Override default history directory' },
                { var: 'REPORT_DIR',     where: 'Backend (optional)',desc: 'Override default reports directory' },
              ].map(row => (
                <tr key={row.var}>
                  <td><code>{row.var}</code></td>
                  <td className="text-xs text-muted">{row.where}</td>
                  <td className="text-sm text-muted">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`.spin { animation: spin .7s linear infinite; }`}</style>
    </>
  );
}
