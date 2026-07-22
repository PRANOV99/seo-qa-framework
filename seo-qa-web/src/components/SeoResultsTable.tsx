import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import type { SeoCheckResult } from '../lib/api';
import StatusBadge from './StatusBadge';
import DiffView from './DiffView';

interface Props {
  results: SeoCheckResult[];
  title?: string;
}

const PAGE_SIZE = 25;

type SortKey = 'status' | 'url' | 'checkType';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = { failed: 0, warning: 1, skipped: 2, passed: 3 };

export default function SeoResultsTable({ results, title }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('status');
  const [dir, setDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return results.filter(r => {
      const matchStatus = filter === 'all' || r.status === filter;
      const matchSearch = !q ||
        r.url.toLowerCase().includes(q) ||
        r.checkType.toLowerCase().includes(q) ||
        (r.expected ?? '').toLowerCase().includes(q) ||
        (r.actual ?? '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [results, search, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort === 'status') cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      else if (sort === 'url') cmp = a.url.localeCompare(b.url);
      else if (sort === 'checkType') cmp = a.checkType.localeCompare(b.checkType);
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort, dir]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sort === key) setDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setDir('asc'); }
    setPage(0);
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sort !== k) return <ChevronUp size={12} style={{ opacity: .3 }} />;
    return dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  const counts = useMemo(() => ({
    all: results.length,
    failed: results.filter(r => r.status === 'failed').length,
    warning: results.filter(r => r.status === 'warning').length,
    passed: results.filter(r => r.status === 'passed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
  }), [results]);

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">{title ?? 'SEO Checks'}</span>
        <span className="text-muted text-sm">{filtered.length} / {results.length} results</span>
      </div>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 30 }}
              placeholder="Search URL, check type, values…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <select
            className="filter-select"
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(0); }}
          >
            <option value="all">All ({counts.all})</option>
            <option value="failed">Failed ({counts.failed})</option>
            <option value="warning">Warning ({counts.warning})</option>
            <option value="passed">Passed ({counts.passed})</option>
            <option value="skipped">Skipped ({counts.skipped})</option>
          </select>
        </div>
      </div>
      <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
        <table>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Status <SortIcon k="status" /></span>
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('url')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>URL <SortIcon k="url" /></span>
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('checkType')}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Check <SortIcon k="checkType" /></span>
              </th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>No results match your filter.</td></tr>
            )}
            {pageData.map((r, i) => (
              <tr key={i}>
                <td><StatusBadge status={r.status} /></td>
                <td><div className="url-cell">{r.url}</div></td>
                <td><div className="check-cell">{r.checkType}</div></td>
                <td><div className="value-cell">{r.expected ?? <span className="text-muted">—</span>}</div></td>
                <td><div className="value-cell">{r.actual ?? <span className="text-muted">—</span>}</div></td>
                <td>
                  {r.diff && r.diff.length > 0 ? (
                    <div className="value-cell" style={{ maxWidth: 360 }}>
                      <div className="text-xs text-muted" style={{ marginBottom: 4 }}>{r.message}</div>
                      <DiffView segments={r.diff} />
                    </div>
                  ) : (
                    <div className="value-cell">{r.message ?? <span className="text-muted">—</span>}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', justifyContent: 'flex-end' }}>
          <span className="text-sm text-muted">Page {page + 1} of {pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
