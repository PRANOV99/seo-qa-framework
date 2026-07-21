interface Props {
  value: number | string;
  label: string;
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'neutral';
}

export default function StatCard({ value, label, tone = 'default' }: Props) {
  return (
    <div className={`stat-card ${tone === 'default' ? '' : tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
