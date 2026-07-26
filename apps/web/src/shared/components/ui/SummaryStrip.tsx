export type StatTone = 'default' | 'ok' | 'warn' | 'danger';

export interface StatItem {
  label: string;
  value: number | string;
  tone?: StatTone;
}

export interface SummaryStripProps {
  items: StatItem[];
}

const TONE_CLASS: Record<StatTone, string> = {
  default: 'stat-pill',
  ok: 'stat-pill stat-pill--ok',
  warn: 'stat-pill stat-pill--warn',
  danger: 'stat-pill stat-pill--danger',
};

export function SummaryStrip({ items }: SummaryStripProps) {
  return (
    <div className="summary-strip" role="group" aria-label="Summary">
      {items.map((item) => (
        <div key={item.label} className={TONE_CLASS[item.tone ?? 'default']}>
          <span>{item.label}</span>
          <span className="stat-pill__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
