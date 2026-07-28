import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, AlertTriangle, Download, Bug, ArrowLeft } from 'lucide-react';
import { getBatchStatus, downloadUrl, devBugReportUrl, combinedBatchDownloadUrl, batchDevBugReportUrl, type BatchStatus, type BatchItemStatus } from '../lib/api';

const POLL_INTERVAL_MS = 1500;

function blogFailedCount(item: BatchItemStatus): number {
  return item.summary?.blogContent?.failed ?? 0;
}

function BlogRow({ item }: { item: BatchItemStatus }) {
  if (item.status === 'pending') {
    return (
      <div className="card card-body" style={{ marginBottom: 12, opacity: .6 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.filename}</div>
        <div className="text-xs text-muted">Queued…</div>
      </div>
    );
  }

  if (item.status === 'running') {
    return (
      <div className="card card-body" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="spinner" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.filename}</div>
            <div className="text-xs text-muted">{item.url}</div>
          </div>
        </div>
      </div>
    );
  }

  if (item.status === 'error') {
    return (
      <div className="card card-body" style={{ marginBottom: 12, borderColor: 'var(--danger)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <XCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.filename}</div>
            <div className="text-xs text-muted">{item.url}</div>
          </div>
        </div>
        <div className="alert alert-danger" style={{ marginTop: 10 }}>{item.error ?? 'This blog failed to process.'}</div>
      </div>
    );
  }

  // done
  const failed = blogFailedCount(item);
  const passed = failed === 0;

  return (
    <div className="card card-body" style={{ marginBottom: 12, borderColor: passed ? 'var(--success)' : 'var(--danger)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {passed
          ? <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
          : <XCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{item.filename}</div>
          <div className="text-xs text-muted">{item.url}</div>
        </div>
        <span className={`badge ${passed ? 'badge-success' : 'badge-danger'}`}>
          {passed ? 'Passed' : `${failed} mismatch${failed === 1 ? '' : 'es'}`}
        </span>
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        {item.auditId && (
          <>
            <Link to={`/results/${item.auditId}`} className="btn btn-outline btn-sm">View Full Report</Link>
            <a
              href={devBugReportUrl(item.auditId)}
              download={`bug-report-${item.auditId}.md`}
              className="btn btn-ghost btn-sm"
              target="_blank" rel="noopener noreferrer"
              title="A Markdown report of every mismatch for this blog, ready to hand to a developer or paste into Claude/an AI coding assistant."
            >
              <Bug size={13} /> Bug Report
            </a>
            <a
              href={downloadUrl(item.auditId)}
              download={`${item.auditId}.json`}
              className="btn btn-ghost btn-sm"
              target="_blank" rel="noopener noreferrer"
            >
              <Download size={13} /> Download Report
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function BatchResults() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!batchId) return;

    let cancelled = false;

    async function poll() {
      try {
        const status = await getBatchStatus(batchId!);
        if (cancelled) return;
        setBatch(status);
        if (status.status === 'done' && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load batch status.');
      }
    }

    void poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [batchId]);

  if (error) return (
    <div className="alert alert-danger">
      {error}
      <Link to="/upload" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>Back to Upload</Link>
    </div>
  );

  if (!batch) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
      <div className="spinner spinner-lg" />
      <div className="text-muted">Loading batch status…</div>
    </div>
  );

  const running = batch.status === 'running';
  const percent = batch.total === 0 ? 0 : Math.round((batch.completed / batch.total) * 100);
  const currentLabel = batch.currentIndex !== null ? batch.currentIndex + 1 : Math.min(batch.completed + 1, batch.total);

  const doneItems = batch.items.filter(i => i.status === 'done');
  const passedCount = doneItems.filter(i => blogFailedCount(i) === 0).length;
  const failedCount = doneItems.filter(i => blogFailedCount(i) > 0).length;
  const erroredCount = batch.items.filter(i => i.status === 'error').length;
  const totalMismatches = doneItems.reduce((sum, i) => sum + blogFailedCount(i), 0);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Link to="/upload" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back</Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Blog Testing — {batch.total} blog{batch.total !== 1 ? 's' : ''}</h1>
        </div>
        {!running && (
          <>
            <a
              href={batchDevBugReportUrl(batch.id)}
              download
              className="btn btn-primary btn-sm"
              target="_blank" rel="noopener noreferrer"
              title="One combined Markdown report of every mismatch across all blogs in this batch, ready to hand to a developer or paste into Claude/an AI coding assistant."
            >
              <Bug size={14} /> Download Bug Report
            </a>
            <a href={combinedBatchDownloadUrl(batch.id)} download className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer">
              <Download size={14} /> Download Combined Summary
            </a>
          </>
        )}
      </div>

      {running && (
        <div className="card card-body" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div className="spinner" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Processing Blog {currentLabel} of {batch.total}
              </div>
              {batch.currentFilename && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{batch.currentFilename}</div>
              )}
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>{percent}%</div>
          </div>
          <div className="progress-bar-outer">
            <div className="progress-bar-inner" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {!running && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="stat-card" style={{ flex: '1 1 140px' }}>
            <div className="stat-value">{batch.total}</div>
            <div className="stat-label">Total Blogs</div>
          </div>
          <div className="stat-card success" style={{ flex: '1 1 140px' }}>
            <div className="stat-value">{passedCount}</div>
            <div className="stat-label">✓ Passed</div>
          </div>
          <div className="stat-card danger" style={{ flex: '1 1 140px' }}>
            <div className="stat-value">{failedCount + erroredCount}</div>
            <div className="stat-label">✗ Failed</div>
          </div>
          <div className="stat-card warning" style={{ flex: '1 1 140px' }}>
            <div className="stat-value">{totalMismatches}</div>
            <div className="stat-label">Total Mismatches</div>
          </div>
        </div>
      )}

      {erroredCount > 0 && !running && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {erroredCount} blog{erroredCount !== 1 ? 's' : ''} could not be processed — see details below.
        </div>
      )}

      <div>
        {batch.items.map(item => <BlogRow key={item.index} item={item} />)}
      </div>
    </>
  );
}
