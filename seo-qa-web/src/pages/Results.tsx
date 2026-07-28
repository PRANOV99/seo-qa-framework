import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Download, Bug, RotateCw, ArrowLeft, ExternalLink } from 'lucide-react';
import { getRun, downloadUrl, devBugReportUrl, postRerunBatch, type AuditRecord } from '../lib/api';
import AuditSummaryCards from '../components/AuditSummaryCards';
import SeoResultsTable from '../components/SeoResultsTable';
import StatusBadge from '../components/StatusBadge';

type Tab = 'overview' | 'seo' | 'redirects' | 'links' | 'accessibility' | 'lighthouse' | 'skipped' | 'bold';

const BOLD_CHECK_PREFIX = 'Bold:';
const BOLD_EXTRA_PREFIX = 'Bold (extra)';

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState('');

  useEffect(() => {
    if (!id) return;
    getRun(id)
      .then(setRecord)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRerun() {
    if (!record) return;
    setRerunning(true);
    setRerunError('');
    try {
      const { batchId } = await postRerunBatch([record.id]);
      navigate(`/results/batch/${batchId}`);
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : String(e));
      setRerunning(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
      <div className="spinner spinner-lg" />
      <div className="text-muted">Loading results…</div>
    </div>
  );

  if (error || !record) return (
    <div className="alert alert-danger">
      {error || 'Audit record not found.'}
      <Link to="/" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>Go Home</Link>
    </div>
  );

  const { report, summary } = record;
  const isBlog = summary.kind === 'blog';

  // Bold Text is always broken out into its own section for Blog Testing —
  // derived directly from the check results, same as every other tab here.
  const boldMatches  = report.seoCheckResults.filter(r => r.checkType.startsWith(BOLD_CHECK_PREFIX) && r.status === 'passed');
  const boldMissing  = report.seoCheckResults.filter(r => r.checkType.startsWith(BOLD_CHECK_PREFIX) && r.status === 'failed');
  const boldExtra    = report.seoCheckResults.filter(r => r.checkType.startsWith(BOLD_EXTRA_PREFIX));
  // The current comparator only detects "missing"/"extra" bold phrases — there's no fuzzy
  // "modified" match like paragraphs have — so this is always empty today.
  const boldModified: typeof report.seoCheckResults = [];
  const boldTotal  = boldMatches.length + boldMissing.length + boldExtra.length;
  const boldPassed = boldMissing.length === 0 && boldModified.length === 0 && boldExtra.length === 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'seo', label: `${isBlog ? 'Content Checks' : 'SEO Checks'}`, count: report.seoCheckResults.length },
    ...(!isBlog ? [{ key: 'redirects' as Tab, label: 'Redirects', count: report.redirectResults.length }] : []),
    ...(isBlog ? [{ key: 'bold' as Tab, label: 'Bold Text', count: boldTotal }] : []),
    { key: 'links', label: 'Broken Links', count: report.brokenLinkResults.length },
    { key: 'accessibility', label: 'Accessibility', count: report.accessibilityResults.length },
    { key: 'lighthouse', label: 'Lighthouse', count: report.lighthouseResults.length },
    { key: 'skipped', label: 'Skipped', count: report.skipped.length },
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Link to="/history" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Back</Link>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{record.filename}</h1>
          {record.url && <div className="text-muted text-sm">{record.url}</div>}
        </div>
        {isBlog && Boolean(record.expectedContent) && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => void handleRerun()}
            disabled={rerunning}
            title="Re-test this blog against a fresh crawl of the live page, without re-uploading the document."
          >
            <RotateCw size={14} /> {rerunning ? 'Starting…' : 'Re-run This Blog'}
          </button>
        )}
        <a
          href={devBugReportUrl(record.id)}
          download={`bug-report-${record.id}.md`}
          className="btn btn-primary btn-sm"
          target="_blank" rel="noopener noreferrer"
          title="A Markdown report of every mismatch, ready to hand to a developer or paste into Claude/an AI coding assistant."
        >
          <Bug size={14} /> Download Bug Report
        </a>
        <a
          href={downloadUrl(record.id)}
          download={`${record.id}.json`}
          className="btn btn-outline btn-sm"
          target="_blank" rel="noopener noreferrer"
        >
          <Download size={14} /> Download JSON
        </a>
      </div>
      {rerunError && <div className="alert alert-danger" style={{ marginBottom: 20 }}>{rerunError}</div>}

      {/* Meta */}
      <div className="card card-body" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><div className="text-xs text-muted">Type</div>
          <span className={`badge ${isBlog ? 'badge-info' : 'badge-neutral'}`}>{isBlog ? '📝 Blog' : '📊 Sheet'}</span>
        </div>
        <div><div className="text-xs text-muted">Generated</div><div className="text-sm">{new Date(summary.generatedAt).toLocaleString()}</div></div>
        <div><div className="text-xs text-muted">Duration</div><div className="text-sm">{(summary.durationMs / 1000).toFixed(1)}s</div></div>
        {!isBlog && <div><div className="text-xs text-muted">Rows</div><div className="text-sm">{summary.totalRows}</div></div>}
      </div>

      <AuditSummaryCards summary={summary} report={report} />

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(t => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span style={{ marginLeft: 5, background: tab === t.key ? 'var(--primary)' : 'var(--border)', color: tab === t.key ? '#fff' : 'var(--text-muted)', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
          {report.categories.length > 0 && (
            <div className="section" style={{ gridColumn: '1 / -1' }}>
              <div className="section-header"><span className="section-title">Issues by Category</span></div>
              <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                <table>
                  <thead><tr><th>Category</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Total</th></tr></thead>
                  <tbody>
                    {report.categories.map(c => (
                      <tr key={c.category}>
                        <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{c.category}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{c.passed}</td>
                        <td style={{ color: c.failed > 0 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>{c.failed}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{c.skipped}</td>
                        <td>{c.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'seo' && <SeoResultsTable results={report.seoCheckResults} title={isBlog ? 'Content Checks' : 'SEO Checks'} />}

      {tab === 'bold' && (
        <div className="section">
          <div className="section-header">
            <span className="section-title">Bold Text</span>
            <StatusBadge status={boldPassed ? 'passed' : 'failed'} />
          </div>

          {boldTotal === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="text-muted">No bold-phrase checks in this audit.</div></div>
          ) : (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-muted)' }}>
                <span><strong style={{ color: 'var(--text)' }}>{boldMatches.length}</strong> matched</span>
                <span><strong style={{ color: 'var(--text)' }}>{boldMissing.length}</strong> missing</span>
                <span><strong style={{ color: 'var(--text)' }}>{boldModified.length}</strong> modified</span>
                <span><strong style={{ color: 'var(--text)' }}>{boldExtra.length}</strong> extra</span>
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>Missing bold phrases</div>
                {boldMissing.length === 0 ? (
                  <div className="text-sm text-muted">None — every expected bold phrase was found.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {boldMissing.map((r, i) => (
                      <li key={i} style={{ marginBottom: 6, fontSize: 13 }}>
                        <span className="badge badge-danger" style={{ marginRight: 8 }}>MISSING</span>
                        "{r.expected}"
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>Modified bold phrases</div>
                {boldModified.length === 0 ? (
                  <div className="text-sm text-muted">None.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {boldModified.map((r, i) => (
                      <li key={i} style={{ marginBottom: 6, fontSize: 13 }}>
                        <span className="badge badge-warning" style={{ marginRight: 8 }}>MODIFIED</span>
                        "{r.expected}" → "{r.actual}"
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>Extra bold phrases</div>
                {boldExtra.length === 0 ? (
                  <div className="text-sm text-muted">None — no unapproved bold text found on the live page.</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {boldExtra.map((r, i) => (
                      <li key={i} style={{ marginBottom: 6, fontSize: 13 }}>
                        <span className="badge badge-warning" style={{ marginRight: 8 }}>EXTRA</span>
                        "{r.actual}"
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'redirects' && (
        <div className="section">
          <div className="section-header"><span className="section-title">Redirect Results</span><span className="text-muted text-sm">{report.redirectResults.length} checked</span></div>
          {report.redirectResults.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="text-muted">No redirect checks in this audit.</div></div>
          ) : (
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>Status</th><th>Original URL</th><th>Final URL</th><th>Code</th><th>Redirects</th><th>Note</th></tr></thead>
                <tbody>
                  {report.redirectResults.map((r, i) => (
                    <tr key={i}>
                      <td><StatusBadge status={r.result} /></td>
                      <td><div className="url-cell">{r.originalUrl}</div></td>
                      <td><div className="url-cell">{r.finalUrl}</div></td>
                      <td>{r.statusCode}</td>
                      <td>{r.redirectCount}</td>
                      <td><div className="value-cell">{r.recommendation}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'links' && (
        <div className="section">
          <div className="section-header"><span className="section-title">Broken Link Results</span><span className="text-muted text-sm">{report.brokenLinkResults.length} checked</span></div>
          {report.brokenLinkResults.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="text-muted">No broken link checks in this audit.</div></div>
          ) : (
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>Status</th><th>Page</th><th>Link</th><th>Type</th><th>Code</th></tr></thead>
                <tbody>
                  {report.brokenLinkResults.map((r, i) => (
                    <tr key={i}>
                      <td><StatusBadge status={r.status} /></td>
                      <td><div className="url-cell">{r.pageUrl}</div></td>
                      <td><div className="url-cell">{r.link}</div></td>
                      <td>{r.linkType}</td>
                      <td>{r.statusCode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'accessibility' && (
        <div>
          {report.accessibilityResults.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">♿</div><div className="empty-title">No accessibility scans</div><div className="empty-desc">Accessibility checks were not run for this audit.</div></div>
          ) : report.accessibilityResults.map((r, i) => (
            <div key={i} className="section" style={{ marginBottom: 16 }}>
              <div className="section-header">
                <div>
                  <div className="section-title">{r.url}</div>
                  <div className="text-xs text-muted">{r.violations.length} violation(s) · {r.passCount} pass · {r.incompleteCount} incomplete</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.violations.length > 0 && (
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead><tr><th>Rule</th><th>Impact</th><th>Nodes</th><th>Help</th></tr></thead>
                    <tbody>
                      {r.violations.map((v, j) => (
                        <tr key={j}>
                          <td style={{ fontWeight: 500 }}>{v.id}</td>
                          <td><span className={`badge ${v.impact === 'critical' || v.impact === 'serious' ? 'badge-danger' : v.impact === 'moderate' ? 'badge-warning' : 'badge-neutral'}`}>{v.impact ?? 'n/a'}</span></td>
                          <td>{v.nodeCount}</td>
                          <td><a href={v.helpUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><ExternalLink size={11} /> Docs</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'lighthouse' && (
        <div className="section">
          <div className="section-header"><span className="section-title">Lighthouse Scores</span></div>
          {report.lighthouseResults.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="text-muted">No Lighthouse audits in this run.</div></div>
          ) : (
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>URL</th><th>Performance</th><th>Accessibility</th><th>Best Practices</th><th>SEO</th><th>Error</th></tr></thead>
                <tbody>
                  {report.lighthouseResults.map((r, i) => {
                    const score = (n: number | null) => n === null ? '—' : `${n}`;
                    const tone  = (n: number | null) => n === null ? '' : n >= 90 ? 'color:var(--success)' : n >= 50 ? 'color:var(--warning)' : 'color:var(--danger)';
                    return (
                      <tr key={i}>
                        <td><div className="url-cell">{r.url}</div></td>
                        {(['performance','accessibility','bestPractices','seo'] as const).map(k => (
                          <td key={k} style={{ fontWeight: 700 }}>
                            <span style={{ ...(r.scores[k] !== null ? Object.fromEntries([tone(r.scores[k]).split(':')]) : {}) }}>
                              {score(r.scores[k])}
                            </span>
                          </td>
                        ))}
                        <td style={{ color: 'var(--danger)', fontSize: 12 }}>{r.error ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'skipped' && (
        <div className="section">
          <div className="section-header"><span className="section-title">Skipped Rows</span><span className="text-muted text-sm">{report.skipped.length} skipped</span></div>
          {report.skipped.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}><div className="text-muted">No rows were skipped.</div></div>
          ) : (
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>URL</th><th>Check</th><th>Reason</th></tr></thead>
                <tbody>
                  {report.skipped.map((s, i) => (
                    <tr key={i}>
                      <td><div className="url-cell">{s.auditRow.url}</div></td>
                      <td><div className="check-cell">{s.auditRow.checkType}</div></td>
                      <td><div className="value-cell text-muted">{s.reason}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
