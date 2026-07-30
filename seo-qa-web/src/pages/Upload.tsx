import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSpreadsheet, FileText, Globe, AlertCircle,
  CheckSquare, Square, Plus, X
} from 'lucide-react';
import DropZone from '../components/DropZone';
import { postRun, parseSheet, postBlogBatch, getBatchConfig } from '../lib/api';

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

interface BlogDraftItem {
  file: File;
  url: string;
}

/** Exactly the checks that apply to Blog Testing — shown as a static, non-toggleable list. */
const BLOG_TESTING_CHECKS = [
  'Blog content comparison',
  'Meta Title validation',
  'Meta Description validation',
  'Canonical URL validation',
  'Blog URL / Slug validation',
  'H1 validation',
  'H2 validation',
  'H3 validation',
  'Hyperlink text validation',
  'Hyperlink URL validation',
  'Exact wording comparison',
  'Bold text comparison',
];

function detectType(name: string): AuditType {
  return name.toLowerCase().endsWith('.docx') ? 'blog' : 'sheet';
}

function normalizeForDupeCheck(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate();

  // File
  const [file, setFile]   = useState<File | null>(null);
  const [auditType, setAuditType] = useState<AuditType | null>(null);

  // Blog URL (sheet's optional live-URL field; unused in Blog Testing mode)
  const [liveUrl, setLiveUrl] = useState('');

  // Blog Testing — batch of documents, each with its own live URL
  const [blogItems, setBlogItems] = useState<BlogDraftItem[]>([]);
  const [maxBatchSize, setMaxBatchSize] = useState(8);

  useEffect(() => {
    getBatchConfig().then(cfg => setMaxBatchSize(cfg.maxBatchSize)).catch(() => { /* keep default */ });
  }, []);

  const addBlogFiles = useCallback((files: File[]) => {
    setBlogItems(prev => {
      const existingKeys = new Set(prev.map(i => `${i.file.name}:${i.file.size}`));
      const additions = files
        .filter(f => detectType(f.name) === 'blog')
        .filter(f => !existingKeys.has(`${f.name}:${f.size}`));
      return [...prev, ...additions.map(f => ({ file: f, url: '' }))].slice(0, maxBatchSize);
    });
  }, [maxBatchSize]);

  function removeBlogItem(index: number) {
    setBlogItems(prev => prev.filter((_, i) => i !== index));
  }

  function updateBlogUrl(index: number, url: string) {
    setBlogItems(prev => prev.map((item, i) => (i === index ? { ...item, url } : item)));
  }

  function resetToIdle() {
    setFile(null);
    setAuditType(null);
    setBlogItems([]);
    setLiveUrl('');
    setParseError('');
    setParsedUrls([]);
    setSelectedUrls(new Set());
    setError('');
  }

  const duplicateUrls = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of blogItems) {
      const key = normalizeForDupeCheck(item.url);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [blogItems]);

  // Module toggles (sheet only)
  const [modules, setModules] = useState<Modules>({
    seo:        true,
    redirects:  true,
    brokenLinks:true,
    a11y:       true,
    lighthouse: true,
  });

  // Lighthouse scope (sheet only)
  const [lhScope, setLhScope] = useState<LhScope>('all');

  // Parsed URLs for Lighthouse selector (sheet only)
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
    setError('');
    setParseError('');

    const t = detectType(f.name);

    if (t === 'blog') {
      // Blog Testing is auto-detected — no manual check configuration needed.
      setFile(null);
      setAuditType('blog');
      addBlogFiles([f]);
      return;
    }

    setFile(f);
    setAuditType('sheet');
    setBlogItems([]);
    setParsedUrls([]);
    setSelectedUrls(new Set());
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
  }, [addBlogFiles]);

  /**
   * Handles the very first file pick (before the audit type is known),
   * which now allows selecting several files at once. When every picked
   * file is a .docx, the whole selection is treated as one Blog Testing
   * batch straight away — no need to pick one file, wait for the mode
   * switch, then go back and add the rest one at a time. A sheet audit is
   * still single-file, so a non-all-.docx selection just uses the first
   * file exactly as before.
   */
  const handleFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1 && files.every(f => detectType(f.name) === 'blog')) {
      setError('');
      setParseError('');
      setFile(null);
      setAuditType('blog');
      addBlogFiles(files);
      return;
    }
    void handleFile(files[0]!);
  }, [addBlogFiles, handleFile]);

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

  async function handleSheetSubmit() {
    if (!file) return;

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
      } else if (lhScope === 'selected') {
        fd.append('lighthouseUrls', JSON.stringify([...selectedUrls]));
      } else if (lhScope === 'all') {
        fd.append('lighthouseUrls', JSON.stringify(parsedUrls));
      }

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

  async function handleBlogBatchSubmit() {
    if (blogItems.length === 0) return;
    if (blogItems.some(i => !i.url.trim())) {
      setError('Enter a live URL for every blog document before running the test.');
      return;
    }
    if (duplicateUrls.size > 0) {
      setError('Duplicate live URLs found — each blog in the batch must have a unique URL.');
      return;
    }

    setError('');
    setPhase('running');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    try {
      const { batchId } = await postBlogBatch(
        blogItems.map(i => i.file),
        blogItems.map(i => i.url.trim())
      );
      clearInterval(timerRef.current!);
      setPhase('done');
      setTimeout(() => navigate(`/results/batch/${batchId}`), 400);
    } catch (err) {
      clearInterval(timerRef.current!);
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Blog test failed to start.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (auditType === 'blog') {
      await handleBlogBatchSubmit();
    } else {
      await handleSheetSubmit();
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const running        = phase === 'running';
  const parseInFlight   = phase === 'parsing';
  const elapsedLabel    = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const lhUrlCount = lhScope === 'all' ? parsedUrls.length : selectedUrls.size;

  const activeModules: string[] = [
    'SEO Checks',
    modules.redirects  ? 'Redirect Checks'  : '',
    modules.brokenLinks? 'Broken Link Checks': '',
    modules.a11y       ? 'Accessibility'     : '',
    modules.lighthouse
      ? `Lighthouse${lhScope === 'selected' ? ` (${lhUrlCount} URL${lhUrlCount !== 1 ? 's' : ''})` : ''}`
      : '',
  ].filter(Boolean);

  const blogUrlsMissing  = blogItems.some(i => !i.url.trim());
  const canSubmitBlog    = blogItems.length > 0 && !blogUrlsMissing && duplicateUrls.size === 0;
  const canSubmit         = auditType === 'blog' ? canSubmitBlog : !!file;

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
            <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}>
              1 — Upload File
              {auditType === 'blog' && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={resetToIdle}>
                  Start over
                </button>
              )}
            </div>

            {auditType !== 'blog' && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#f5f7ff', border: '1px solid #dbe4ff', fontSize: 13 }}>
                  <FileSpreadsheet size={14} style={{ color: 'var(--primary)', marginRight: 6, verticalAlign: 'middle' }} />
                  <strong>.xlsx / .csv</strong> — Recommendation Sheet Audit
                </div>
                <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#fdf4ff', border: '1px solid #e9d5ff', fontSize: 13 }}>
                  <FileText size={14} style={{ color: '#7c3aed', marginRight: 6, verticalAlign: 'middle' }} />
                  <strong>.docx</strong> — Blog Testing (up to {maxBatchSize} at once)
                </div>
              </div>
            )}

            {auditType !== 'blog' && (
              <>
                <DropZone
                  multiple
                  onFiles={handleFiles}
                  hint={`Supported: .xlsx, .csv — one at a time, or select up to ${maxBatchSize} .docx files at once for Blog Testing`}
                />
                {parseInFlight && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    <div className="spinner" /> Parsing sheet to extract URLs…
                  </div>
                )}
                {parseError && <div className="alert alert-warning" style={{ marginTop: 10 }}>{parseError}</div>}
                {auditType === 'sheet' && !parseInFlight && (
                  <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                    <FileSpreadsheet size={13} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--primary)' }} /> Recommendation Sheet — {parsedUrls.length} URL{parsedUrls.length !== 1 ? 's' : ''} found
                  </div>
                )}
              </>
            )}

            {auditType === 'blog' && (
              <>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                  <FileText size={13} style={{ verticalAlign: 'middle', marginRight: 4, color: '#7c3aed' }} />
                  Blog Testing mode — enter the matching live URL for each document below.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: blogItems.length < maxBatchSize ? 14 : 0 }}>
                  {blogItems.map((item, index) => {
                    const isDuplicate = item.url.trim() !== '' && duplicateUrls.has(normalizeForDupeCheck(item.url));
                    return (
                      <div key={`${item.file.name}-${index}`} style={{ padding: 12, borderRadius: 8, border: `1px solid ${isDuplicate ? 'var(--danger)' : 'var(--border)'}`, background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <FileText size={14} style={{ color: '#7c3aed', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, wordBreak: 'break-all' }}>Blog {index + 1} — {item.file.name}</span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeBlogItem(index)} disabled={running} aria-label={`Remove ${item.file.name}`}>
                            <X size={13} />
                          </button>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <Globe size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                          <input
                            type="url" className="form-control" style={{ paddingLeft: 30 }}
                            placeholder="https://example.com/blog-1"
                            value={item.url}
                            onChange={e => updateBlogUrl(index, e.target.value)}
                            disabled={running}
                          />
                        </div>
                        {isDuplicate && (
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
                            This URL is used by another blog in this batch — each blog needs a unique URL.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {blogItems.length < maxBatchSize && !running && (
                  <DropZone
                    accept=".docx"
                    multiple
                    onFiles={addBlogFiles}
                    hint={`Drop or browse to add ${blogItems.length === 0 ? 'blog documents' : `up to ${maxBatchSize - blogItems.length} more (.docx)`}`}
                  />
                )}
                {blogItems.length >= maxBatchSize && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <Plus size={12} style={{ verticalAlign: 'middle' }} /> Batch limit reached ({maxBatchSize} blogs).
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── 2. Live URL (sheet only — each blog has its own URL above) ── */}
          {auditType !== 'blog' && (
            <div className="card card-body" style={{ marginBottom: 16 }}>
              <div className="card-title">
                2 — Live URL
                <span className="badge badge-neutral" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Optional</span>
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
          )}

          {/* ── 3. Audit Configuration / Blog Testing ───────────────────── */}
          <div className="card card-body" style={{ marginBottom: 16 }}>
            <div className="card-title">{auditType === 'blog' ? 'Blog Testing' : '3 — Audit Configuration'}</div>

            {auditType === 'blog' ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4, marginBottom: 12 }}>
                  Only blog-relevant checks run — Lighthouse, Accessibility, Broken Links, and Redirect checks are
                  automatically skipped for Blog Testing.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {BLOG_TESTING_CHECKS.map(check => (
                    <span key={check} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f0f4ff', border: '1px solid #c7d7ff', borderRadius: 20, fontSize: 13, fontWeight: 500, color: 'var(--primary)' }}>
                      <CheckSquare size={13} /> {check}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
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
                        {key === 'lighthouse' && enabled && parsedUrls.length > 0 && (
                          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                            {lhScope === 'all' ? `${parsedUrls.length} URLs` : `${selectedUrls.size} selected`}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Lighthouse scope (when Lighthouse enabled and URLs available) */}
                {modules.lighthouse && parsedUrls.length > 0 && (
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
              </>
            )}
          </div>

          {/* ── Active modules preview (sheet only — blog's checklist above already shows this) ── */}
          {file && auditType !== 'blog' && (
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
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {auditType === 'blog' ? 'Starting Blog Test…' : 'Running audit…'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Elapsed: {elapsedLabel}
                    {auditType !== 'blog' && <>&nbsp;·&nbsp;{activeModules.join(' · ')}</>}
                  </div>
                </div>
              </div>
              <div className="progress-bar-outer">
                <div className="progress-bar-inner" style={{ width: '60%' }} />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>✓ {auditType === 'blog' ? 'Blog test started! Redirecting to progress…' : 'Audit completed! Redirecting to results…'}</div>
          )}

          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!canSubmit || running || phase === 'done' || parseInFlight}
            >
              {running
                ? <><div className="spinner" /> {auditType === 'blog' ? 'Starting…' : 'Running…'}</>
                : parseInFlight
                  ? <><div className="spinner" /> Parsing sheet…</>
                  : auditType === 'blog' ? '🚀 Run Blog Test' : '🚀 Run Audit'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
