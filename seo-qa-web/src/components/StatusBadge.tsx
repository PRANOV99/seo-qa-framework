interface Props { status: string }

export default function StatusBadge({ status }: Props) {
  const s = status.toLowerCase();
  if (s === 'pass' || s === 'passed') return <span className="badge badge-success">PASS</span>;
  if (s === 'fail' || s === 'failed') return <span className="badge badge-danger">FAIL</span>;
  if (s === 'warning' || s === 'warn') return <span className="badge badge-warning">WARN</span>;
  if (s === 'skipped' || s === 'skip') return <span className="badge badge-skip">SKIP</span>;
  return <span className="badge badge-neutral">{status}</span>;
}
