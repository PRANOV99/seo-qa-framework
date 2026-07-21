import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, CheckCircle, XCircle, Clock, Download, GitCompare } from 'lucide-react';
import { getHistory, downloadUrl, type AuditRecord } from '../lib/api';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function History() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [typeFilter, setType] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    getHistory()
      .then(h => setRecords(h.audits))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter(r => {
      const matchType = typeFilter === 'all' || r.type === typeFilter;
      const matchSearch = !q || r.filename.toLowerCase().includes(q) || (r.url ?? '').toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [records, search, typeFilter]);

  function toggleSelect(id: string) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= 2 ? [s[1]!, id] : [...s, id]);
  }

  return (
    <>
      <div className="page-header">
        <h1>Audit History</h1>
        <p>Browse, view, download, and compare all previous audit runs.</p>
      </div>

      {/* Compare banner */}
      {selected.length === 2 && (
        <div className="alert alert-info" style={{ marginBottom: 16, justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span>✓ Two audits selected for comparison.</span>
          <Link
            to={`/compare?a=${encodeURIComponent(selected[0]!)}&b=${encodeURIComponent(selected[1]!)}`}
            className="btn btn-primary btn-sm"
          >
            <GitCompare size={13} /> Compare These Audits
          </Link>
        </div>
      )}
      {selected.length === 1 && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <span>Select one more audit to compare.</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="form-control" style={{ paddingLeft: 30 }}
            placeholder="Search by filename or URL…"
            value={search} onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="sheet">Recommendation Sheets</option>
          <option value="blog">Blog Audits</option>
        </select>
        {selected.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>Clear selection</button>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">No audits yet</div>
          <p className="empty-desc">Run your first audit to see it here.</p>
          <Link to="/upload" className="btn btn-primary">Run Audit</Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No results</div>
          <p className="empty-desc">Try adjusting your search or filter.</p>
        </div>
      ) : (
        <div className="section">
          <div className="section-header">
            <span className="section-title">{filtered.length} audit{filtered.length !== 1 ? 's' : ''}</span>
            <span className="text-xs text-muted">Click checkboxes to select up to 2 for comparison</span>
          </div>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Passed</th>
                  <th>Failed</th>
                  <th>Duration</th>
                  <th>When</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const isSelected = selected.includes(r.id);
                  const passed = r.summary?.seoChecks?.passed ?? 0;
                  const failed = r.summary?.seoChecks?.failed ?? 0;
                  return (
                    <tr key={r.id} style={{ background: isSelected ? '#f0f4ff' : undefined }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(r.id)}
                          style={{ cursor: 'pointer', accentColor: 'var(--primary)', width: 15, height: 15 }}
                        />
                      </td>
                      <td>
                        <span className={`badge ${r.type === 'blog' ? 'badge-info' : 'badge-neutral'}`}>
                          {r.type === 'blog' ? '📝 Blog' : '📊 Sheet'}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{r.filename}</div>
                        {r.url && <div className="text-xs text-muted" style={{ marginTop: 2, wordBreak: 'break-all', maxWidth: 260 }}>{r.url}</div>}
                      </td>
                      <td>
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                          <CheckCircle size={12} style={{ marginRight: 3, verticalAlign: 'middle' }} />{passed}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: failed > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                          <XCircle size={12} style={{ marginRight: 3, verticalAlign: 'middle' }} />{failed}
                        </span>
                      </td>
                      <td>
                        <span className="text-muted text-sm">
                          {r.summary?.durationMs != null ? `${(r.summary.durationMs / 1000).toFixed(1)}s` : '—'}
                        </span>
                      </td>
                      <td>
                        <span className="text-muted text-sm">
                          <Clock size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />{timeAgo(r.createdAt)}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                          <Link to={`/history/${r.id}`} className="btn btn-outline btn-sm">View</Link>
                          <a
                            href={downloadUrl(r.id)} download={`${r.id}.json`}
                            className="btn btn-ghost btn-sm" title="Download JSON"
                          >
                            <Download size={13} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
