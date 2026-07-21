import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, History, GitCompare, Settings, CheckCircle, XCircle, Clock } from 'lucide-react';
import { getHistory, type AuditRecord } from '../lib/api';

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function Home() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then(h => setRecords(h.audits.slice(0, 6)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalPassed  = records.reduce((s, r) => s + (r.summary?.seoChecks?.passed ?? 0), 0);
  const totalFailed  = records.reduce((s, r) => s + (r.summary?.seoChecks?.failed ?? 0), 0);
  const lastRun      = records[0]?.createdAt;

  const quickActions = [
    { to: '/upload',   label: 'Run New Audit',  icon: Upload,    desc: 'Upload a sheet or blog document' },
    { to: '/history',  label: 'View History',   icon: History,   desc: 'Browse all previous audits' },
    { to: '/compare',  label: 'Compare Audits', icon: GitCompare,desc: 'Diff two audit runs side-by-side' },
    { to: '/settings', label: 'Settings',       icon: Settings,  desc: 'Configure the application' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>SEO QA Framework</h1>
        <p>Automated SEO validation for recommendation sheets and blog content.</p>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card neutral">
          <div className="stat-value">{records.length}</div>
          <div className="stat-label">Total Audits</div>
        </div>
        <div className="stat-card neutral">
          <div className="stat-value">{lastRun ? timeAgo(lastRun) : '—'}</div>
          <div className="stat-label">Last Audit</div>
        </div>
        <div className="stat-card success">
          <div className="stat-value">{totalPassed}</div>
          <div className="stat-label">Passed</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-value">{totalFailed}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 16, marginBottom: 32 }}>
        {quickActions.map(({ to, label, icon: Icon, desc }) => (
          <Link key={to} to={to} style={{ textDecoration: 'none' }}>
            <div className="card card-body" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', transition: 'box-shadow .15s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent audits */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Recent Audits</span>
          <Link to="/history" className="btn btn-ghost btn-sm">View all</Link>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div className="spinner spinner-lg" style={{ margin: '0 auto 12px' }} />
            <div className="text-muted text-sm">Loading history…</div>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🚀</div>
            <div className="empty-title">No audits yet</div>
            <p className="empty-desc">Upload a recommendation sheet (.xlsx/.csv) or blog document (.docx) to run your first audit.</p>
            <Link to="/upload" className="btn btn-primary btn-lg">Start First Audit</Link>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th><th>Source</th><th>Passed</th><th>Failed</th><th>When</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>
                      <span className={`badge ${r.type === 'blog' ? 'badge-info' : 'badge-neutral'}`}>
                        {r.type === 'blog' ? '📝 Blog' : '📊 Sheet'}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{r.filename}</div>
                      {r.url && <div className="text-xs text-muted" style={{ marginTop: 2, wordBreak: 'break-all' }}>{r.url}</div>}
                    </td>
                    <td>
                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                        <CheckCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        {r.summary?.seoChecks?.passed ?? 0}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: r.summary?.seoChecks?.failed ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                        <XCircle size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        {r.summary?.seoChecks?.failed ?? 0}
                      </span>
                    </td>
                    <td>
                      <span className="text-muted text-sm">
                        <Clock size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        {timeAgo(r.createdAt)}
                      </span>
                    </td>
                    <td>
                      <Link to={`/history/${r.id}`} className="btn btn-outline btn-sm">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
