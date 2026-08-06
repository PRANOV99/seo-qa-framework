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

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Backend connection status.</p>
      </div>

      {/* API Health */}
      <div className="section">
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
          </div>
        </div>
      </div>

      <style>{`.spin { animation: spin .7s linear infinite; }`}</style>
    </>
  );
}
