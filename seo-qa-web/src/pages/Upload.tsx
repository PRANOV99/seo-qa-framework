import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSpreadsheet, FileText, Globe, AlertCircle,
  CheckSquare, Square
} from 'lucide-react';
import DropZone from '../components/DropZone';
import { postRun, parseSheet } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type AuditType = 'sheet' | 'blog';
type LhScope   = 'all' | 'selected';
type Phase     = 'idle' | 'parsing' | 'running' | 'done' | 'error';

interface Modules {
  seo:         boolean;   // always on — locked
  redirects:   boolean;
  brokenLinks: boolean;
  a11y:        boolean;
  lighthouse:  boolean;
}

function detectType(name: string): AuditType {
  return name.toLowerCase().endsWith('.docx') ? 'blog' : 'sheet';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate();

  // File
  const [file, setFile]   = useState<File | null>(null);
  const [auditType, setAuditType] = useState<AuditType | null>(null);

  // Blog URL
  const [liveUrl, setLiveUrl] = useState('');

  // Module toggles
  const [modules, setModules] = useState<Modules>({
    seo:        true,
    redirects:  true,
    brokenLinks:true,
    a11y:       true,
    lighthouse: true,
  });

  // Lighthouse scope
  const [lhScope, setLhScope] = useState<LhScope>('all');

  // Parsed URLs for Lighthouse selector
  const [parsedUrls, setParsedUrls] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState('');

  // Progress
  const [phase, setPhase]   = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError]   = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    const t = detectType(f.name);
    setAuditType(t);
    setError('');
    setParseError('');
    setParsedUrls([]);
    setSelectedUrls(new Set());

    if (t === 'sheet') {
      setPhase('parsing');
      try {
        const result = await parseSheet(f);
        setParsedUrls(result.urls);
        setSelectedUrls(new Set(result.urls));
      } catch (e) {
        setParseError(e instanceof Error ? e.message : 'Could not parse sheet.');
      } finally {
        setPhase('idle');
      }
    }
  }, []);

  function toggleModule(key: keyof Modules) {
    if (key === 'seo') return; // always on
    setModules(m => ({ ...m, [key]: !m[key] }));
  }

  function toggleUrl(url: string) {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  function selectAllUrls()  { setSelectedUrls(new Set(parsedUrls)); }
  function clearAllUrls()   { setSelectedUrls(new Set()); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    if (auditType === 'blog' && !liveUrl.trim()) {
      setError('A live URL is required for blog document audits.');
      return;
    }

    setError('');
    setPhase('running');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    try {
      const fd = new FormData();
      fd.append('file', file);

      if (liveUrl.trim())             fd.append('url', liveUrl.trim());
      if (!modules.redirects)         fd.append('alwaysRunRedirects',  '0');
      if (!modules.brokenLinks)       fd.append('alwaysRunBrokenLinks','0');
      if (!modules.a11y)              fd.append('alwaysRunA11y',       '0');

      // Lighthouse config
      if (!modules.lighthouse) {
        fd.append('noLighthouse', '1');
        fd.append('lighthouseUrls', '[]');
      } else if (auditType === 'sheet' && lhScope === 'selected') {
        fd.append('lighthouseUrls', JSON.stringify([...selectedUrls]));
      } else if (auditType === 'sheet' && lhScope === 'all') {
        fd.append('lighthouseUrls', JSON.stringify(parsedUrls));
      }
      // For blog: backend defaults to [liveUrl] when lighthouseUrls is absent

      const result = await postRun(fd);
      clearInterval(timerRef.current!);
      setPhase('done');
      setTimeout(() => navigate(`/results/${result.id}`), 500);
    } catch (err) {
      clearInterval(timerRef.current!);
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Audit failed.');
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const running        = phase === 'running';
  const parseInFlight  = phase === 'parsing';
  const elapsedLabel   = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const lhUrlCount = lhScope === 'all' ? parsedUrls.length : selectedUrls.size;

  const activeModules: string[] = [
    'SEO Checks',
    modules.redirects  ? 'Redirect Checks'  : '',
    modules.brokenLinks? 'Broken Link Checks': '',
    modules.a11y       ? 'Accessibility'     : '',
    modules.lighthouse
      ? `Lighthouse${auditType === 'sheet' && lhScope === 'selected' ? ` (${lhUrlCount} URL${lhUrlCount !== 1 ? 's' : ''})` : ''}`
      : '',
  ].filter(Boolean);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="page-header">
        <h1>New Audit</h1>
        <p>Upload a file — the correct audit type is detected automatically.</p>
      </div>

      <div style={{ maxWidth: 680 }}>
        <form onSubmit={handleSubmit}>

          {/* ── 1. File ───────────────────────────────────────────────── */}
          <div className="card card-body" style={{ marginBottom: 16 }}>
            <div className="card-title">1 — Upload File</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#f5f7ff', border: '1px solid #dbe4ff', fontSize: 13 }}>
                <FileSpreadsheet size={14} style={{ color: 'var(--primary)', marginRight: 6, verticalAlign: 'middle' }} />
                <strong>.xlsx / .csv</strong> — Recommendation Sheet Audit
              </div>
              <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#fdf4ff', border: '1px solid #e9d5ff', fontSize: 13 }}>
                <FileText size={14} style={{ color: '#7c3aed', marginRight: 6, verticalAlign: 'middle' }} />
                <strong>.docx</strong> — Blog Content Audit
              </div>
            </div>
            <DropZone onFile={handleFile} />
            {parseInFlight && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                <div className="spinner" /> Parsing sheet to extract URLs…
              </div>
            )}
            {parseError && <div className="alert alert-warning" style={{ marginTop: 10 }}>{parseError}</div>}
            {auditType && !parseInFlight && (
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                {auditType === 'blog'
                  ? <><FileText size={13} style={{ verticalAlign: 'middle', marginRight: 4, color: '#7c3aed' }} /> Blog audit — enter the live URL below</>
                  : <><FileSpreadsheet size={13} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--primary)' }} /> Recommendation Sheet — {parsedUrls.length} URL{parsedUrls.length !== 1 ? 's' : ''} found</>}
              </div>
            )}
          </div>

          {/* ── 2. Live URL (blog required, sheet optional) ───────────── */}
          <div className="card card-body" style={{ marginBottom: 16 }}>
            <div className="card-title">
              2 — Live URL
              {auditType === 'blog'
                ? <span className="badge badge-danger" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Required</span>
                : <span className="badge badge-neutral" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Optional</span>}
            </div>
            <div style={{ position: 'relative' }}>
              <Globe size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="url" className="form-control" style={{ paddingLeft: 30 }}
                placeholder="https://example.com/blog/my-post"
                value={liveUrl}
                onChange={e => setLiveUrl(e.target.value)}
                disabled={running}
              />
            </div>
          </div>

          {/* ── 3. Audit Configuration ───────────────────────────────── */}
          <div className="card card-body" style={{ marginBottom: 16 }}>
            <div className="card-title">3 — Audit Configuration</div>

            {/* Module toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {(
                [
                  { key: 'seo',        label: 'SEO Checks',       locked: true  },
                  { key: 'redirects',  label: 'Redirect Checks',  locked: false },
                  { key: 'brokenLinks',label: 'Broken Link Checks',locked: false },
                  { key: 'a11y',       label: 'Accessibility (axe-core)', locked: false },
                  { key: 'lighthouse', label: 'Lighthouse',        locked: false },
                ] as const
              ).map(({ key, label, locked }) => {
                const enabled = modules[key];
                return (
                  <label
                    key={key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: locked ? 'default' : 'pointer',
                      padding: '8px 12px', borderRadius: 6,
                      background: enabled ? '#f0f4ff' : 'var(--bg)',
                      border: `1px solid ${enabled ? '#c7d7ff' : 'var(--border)'}`,
                      opacity: running ? .6 : 1,
                      userSelect: 'none',
                    }}
                  >
                    {locked
                      ? <CheckSquare size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
                      : enabled
                        ? <CheckSquare size={16} style={{ color: 'var(--primary)', flexShrink: 0, cursor: 'pointer' }} onClick={() => !running && toggleModule(key)} />
                        : <Square size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, cursor: 'pointer' }} onClick={() => !running && toggleModule(key)} />}
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
                    {locked && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>Always on</span>}
                    {key === 'lighthouse' && enabled && auditType === 'sheet' && parsedUrls.length > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                        {lhScope === 'all' ? `${parsedUrls.length} URLs` : `${selectedUrls.size} selected`}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Lighthouse scope (sheets only, when Lighthouse enabled and URLs available) */}
            {modules.lighthouse && auditType === 'sheet' && parsedUrls.length > 0 && (
              <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Lighthouse Scope</div>
                <div style={{ display: 'flex', gap: 10, marginBottom: lhScope === 'selected' ? 14 : 0 }}>
                  {(['all', 'selected'] as const).map(s => (
                    <label
                      key={s}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                        padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                        background: lhScope === s ? 'var(--primary)' : 'var(--surface)',
                        color: lhScope === s ? '#fff' : 'var(--text)',
                        border: `1px solid ${lhScope === s ? 'var(--primary)' : 'var(--border)'}`,
                        userSelect: 'none',
                      }}
                      onClick={() => !running && setLhScope(s)}
                    >
                      {lhScope === s ? <CheckSquare size={14} /> : <Square size={14} />}
                      {s === 'all' ? `All ${parsedUrls.length} URLs` : 'Selected URLs'}
                    </label>
                  ))}
                </div>

                {/* URL checkboxes for selected scope */}
                {lhScope === 'selected' && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, marginTop: 2 }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllUrls}>
                        <CheckSquare size={12} /> Select all
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllUrls}>
                        <Square size={12} /> Clear all
                      </button>
                      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                        {selectedUrls.size} / {parsedUrls.length} selected
                      </span>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)' }}>
                      {parsedUrls.map(url => (
                        <label
                          key={url}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                            borderBottom: '1px solid var(--border)',
                            background: selectedUrls.has(url) ? '#f8f9ff' : 'transparent',
                          }}
                          onClick={() => toggleUrl(url)}
                        >
                          {selectedUrls.has(url)
                            ? <CheckSquare size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                            : <Square size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                          <span style={{ wordBreak: 'break-all' }}>{url}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Blog: Lighthouse note */}
            {modules.lighthouse && auditType === 'blog' && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6 }}>
                Lighthouse will run for the live blog URL entered above.
              </div>
            )}
          </div>

          {/* ── Active modules preview ──────────────────────────────── */}
          {file && (
            <div className="card card-body" style={{ marginBottom: 16 }}>
              <div className="card-title">Modules to Execute</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {activeModules.map(m => (
                  <span key={m} style={{ padding: '4px 12px', background: '#f0f4ff', border: '1px solid #c7d7ff', borderRadius: 20, fontSize: 13, fontWeight: 500, color: 'var(--primary)' }}>
                    ✓ {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Error ──────────────────────────────────────────────── */}
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          {/* ── Progress ───────────────────────────────────────────── */}
          {running && (
            <div className="card card-body" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div className="spinner" />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Running audit…</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Elapsed: {elapsedLabel} &nbsp;·&nbsp; {activeModules.join(' · ')}
                  </div>
                </div>
              </div>
              <div className="progress-bar-outer">
                <div className="progress-bar-inner" style={{ width: '60%' }} />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>✓ Audit completed! Redirecting to results…</div>
          )}

          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!file || running || phase === 'done' || parseInFlight}
            >
              {running
                ? <><div className="spinner" /> Running…</>
                : parseInFlight
                  ? <><div className="spinner" /> Parsing sheet…</>
                  : '🚀 Run Audit'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
