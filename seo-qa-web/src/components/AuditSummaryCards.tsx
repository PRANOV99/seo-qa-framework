import type { AuditSummary, ReportData } from '../lib/api';
import StatCard from './StatCard';

interface Props {
  summary: AuditSummary;
  report?: ReportData;
}

export default function AuditSummaryCards({ summary, report }: Props) {
  const isBlog = summary.kind === 'blog';

  if (isBlog && summary.blogContent) {
    const b = summary.blogContent;
    const redirectCount = report?.redirectResults.length ?? 0;
    const brokenTotal   = report?.brokenLinkResults.length ?? 0;
    const brokenFailed  = report?.brokenLinkResults.filter(r => r.status !== 'PASS').length ?? 0;
    const a11yPages     = report?.accessibilityResults.length ?? 0;
    const a11yViolations= report?.accessibilityResults.reduce((n, r) => n + r.violations.length, 0) ?? 0;
    const lhPages       = report?.lighthouseResults.length ?? 0;

    return (
      <>
        <div className="stat-grid">
          <StatCard value={b.totalChecks}       label="Content Checks"    tone="neutral" />
          <StatCard value={b.passed}            label="Passed"            tone="success" />
          <StatCard value={b.failed}            label="Failed"            tone={b.failed > 0 ? 'danger' : 'success'} />
          <StatCard value={b.missingContent}    label="Missing Content"   tone={b.missingContent > 0 ? 'danger' : 'neutral'} />
          <StatCard value={b.modifiedContent}   label="Modified Content"  tone={b.modifiedContent > 0 ? 'warning' : 'neutral'} />
          <StatCard value={b.metadataIssues}    label="Metadata Issues"   tone={b.metadataIssues > 0 ? 'warning' : 'neutral'} />
        </div>
        <div className="stat-grid" style={{ marginTop: 0 }}>
          <StatCard value={redirectCount}       label="Redirects Checked" tone="neutral" />
          <StatCard value={brokenFailed}        label={`Broken Links (${brokenTotal} checked)`} tone={brokenFailed > 0 ? 'danger' : 'neutral'} />
          <StatCard value={a11yViolations}      label={`A11y Issues (${a11yPages} page${a11yPages !== 1 ? 's' : ''})`} tone={a11yViolations > 0 ? 'warning' : 'neutral'} />
          <StatCard value={lhPages > 0 ? (report?.lighthouseResults[0]?.scores.performance ?? '—') : '—'} label={`Lighthouse Performance (${lhPages} page${lhPages !== 1 ? 's' : ''})`} tone="neutral" />
        </div>
      </>
    );
  }

  // Sheet audit
  const totalPassed  = summary.seoChecks.passed  + summary.redirects.passed  + summary.brokenLinks.passed;
  const totalFailed  = summary.seoChecks.failed  + summary.redirects.failed  + summary.brokenLinks.failed;
  const totalWarning = summary.seoChecks.warning + summary.redirects.warning + summary.brokenLinks.warning;

  const redirectTotal  = summary.redirects.total;
  const brokenTotal    = summary.brokenLinks.total;
  const brokenFailed   = summary.brokenLinks.failed;
  const a11yPages      = report?.accessibilityResults.length ?? 0;
  const a11yViolations = report?.accessibilityResults.reduce((n, r) => n + r.violations.length, 0) ?? summary.accessibilityViolations;
  const lhPages        = report?.lighthouseResults.length ?? summary.lighthouse.auditedPages;

  // Average Lighthouse performance across pages
  const lhScores = report?.lighthouseResults
    .map(r => r.scores.performance)
    .filter((s): s is number => s !== null) ?? [];
  const lhAvgPerf = lhScores.length > 0
    ? Math.round(lhScores.reduce((a, b) => a + b, 0) / lhScores.length)
    : null;

  return (
    <>
      <div className="stat-grid">
        <StatCard value={summary.totalRows}  label="Rows Audited"  tone="neutral" />
        <StatCard value={totalPassed}        label="Passed"        tone="success" />
        <StatCard value={totalFailed}        label="Failed"        tone={totalFailed > 0 ? 'danger' : 'success'} />
        <StatCard value={totalWarning}       label="Warnings"      tone={totalWarning > 0 ? 'warning' : 'neutral'} />
      </div>
      <div className="stat-grid" style={{ marginTop: 0 }}>
        <StatCard
          value={redirectTotal}
          label={`Redirects Checked${summary.redirects.failed > 0 ? ` (${summary.redirects.failed} issues)` : ' ✓'}`}
          tone={summary.redirects.failed > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          value={brokenFailed > 0 ? brokenFailed : brokenTotal}
          label={brokenFailed > 0 ? `Broken Links (${brokenTotal} checked)` : `Links Checked ✓`}
          tone={brokenFailed > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          value={a11yViolations > 0 ? a11yViolations : a11yPages}
          label={a11yViolations > 0 ? `A11y Issues (${a11yPages} page${a11yPages !== 1 ? 's' : ''})` : `Pages Scanned (a11y) ✓`}
          tone={a11yViolations > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          value={lhAvgPerf !== null ? lhAvgPerf : (lhPages > 0 ? '—' : 'Off')}
          label={`Lighthouse Avg Score (${lhPages} page${lhPages !== 1 ? 's' : ''})`}
          tone={lhAvgPerf !== null ? (lhAvgPerf >= 90 ? 'success' : lhAvgPerf >= 50 ? 'warning' : 'danger') : 'neutral'}
        />
      </div>
    </>
  );
}
