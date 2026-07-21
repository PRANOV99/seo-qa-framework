import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitCompare, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { getHistory, postCompare, type AuditRecord, type ComparisonResult } from '../lib/api';

export default function Compare() {
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [aId, setAId] = useState(searchParams.get('a') ?? '');
  const [bId, setBId] = useState(searchParams.get('b') ?? '');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    getHistory()
      .then(h => setRecords(h.audits))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, []);

  // Auto-run if both IDs are pre-filled from URL params
  useEffect(() => {
    if (aId && bId && records.length > 0) {
      void runCompare(aId, bId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length, aId, bId]);

  async function runCompare(a = aId, b = bId) {
    if (!a || !b || a === b) {
      setError('Please select two different audits to compare.');
      return;
    }
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await postCompare(a, b);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Compare Audits</h1>
        <p>Compare two audit runs to see what was fixed, what's still failing, and what's new.</p>
      </div>

      {/* Selector */}
      <div className="card card-body" style={{ marginBottom: 20 }}>
        <div className="card-title">Select Two Audits</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center' }}>
          <div>
            <div className="form-label">Baseline (older)</div>
            <select
              className="form-control"
              value={aId}
              onChange={e => { setAId(e.target.value); setResult(null); }}
              disabled={histLoading}
            >
              <option value="">Select baseline…</option>
              {records.map(r => (
                <option key={r.id} value={r.id} disabled={r.id === bId}>
                  {r.filename} · {new Date(r.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 20 }}>
            <GitCompare size={22} />
          </div>
          <div>
            <div className="form-label">Target (newer)</div>
            <select
              className="form-control"
              value={bId}
              onChange={e => { setBId(e.target.value); setResult(null); }}
              disabled={histLoading}
            >
              <option value="">Select target…</option>
              {records.map(r => (
                <option key={r.id} value={r.id} disabled={r.id === aId}>
                  {r.filename} · {new Date(r.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="alert alert-danger" style={{ marginTop: 14 }}>{error}</div>}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            onClick={() => runCompare()}
            disabled={!aId || !bId || aId === bId || loading}
          >
            {loading ? <><div className="spinner" /> Comparing…</> : <><GitCompare size={14} /> Compare Audits</>}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div className="stat-card success" style={{ flex: '1 1 160px' }}>
              <div className="stat-value">{result.counts.fixed}</div>
              <div className="stat-label">✓ Fixed</div>
            </div>
            <div className="stat-card danger" style={{ flex: '1 1 160px' }}>
              <div className="stat-value">{result.counts.newIssues}</div>
              <div className="stat-label">⚠ New Issues</div>
            </div>
            <div className="stat-card warning" style={{ flex: '1 1 160px' }}>
              <div className="stat-value">{result.counts.stillFailing}</div>
              <div className="stat-label">⟳ Still Failing</div>
            </div>
          </div>

          <div className="compare-grid">
            {/* Fixed */}
            {result.fixed.length > 0 && (
              <div className="compare-card fixed">
                <div className="compare-card-title" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={15} /> {result.counts.fixed} Fixed
                </div>
                {result.fixed.map((entry, i) => (
                  <div key={i} className="compare-item">
                    <div>{entry.description}</div>
                    <div className="compare-item-url">{entry.url}</div>
                  </div>
                ))}
              </div>
            )}

            {/* New Issues */}
            {result.newIssues.length > 0 && (
              <div className="compare-card new-issues">
                <div className="compare-card-title" style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={15} /> {result.counts.newIssues} New Issues
                </div>
                {result.newIssues.map((entry, i) => (
                  <div key={i} className="compare-item">
                    <div>{entry.description}</div>
                    <div className="compare-item-url">{entry.url}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Still Failing */}
            {result.stillFailing.length > 0 && (
              <div className="compare-card still-fail">
                <div className="compare-card-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <XCircle size={15} /> {result.counts.stillFailing} Still Failing
                </div>
                {result.stillFailing.map((entry, i) => (
                  <div key={i} className="compare-item">
                    <div>{entry.description}</div>
                    <div className="compare-item-url">{entry.url}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.counts.fixed === 0 && result.counts.newIssues === 0 && result.counts.stillFailing === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🎉</div>
              <div className="empty-title">No differences found</div>
              <p className="empty-desc">The two audits produced identical results.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
