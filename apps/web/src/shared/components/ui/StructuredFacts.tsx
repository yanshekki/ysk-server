import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';

export interface FactItem {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: BadgeTone;
}

export function StructuredFacts({ items }: { items: FactItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fact-grid">
      {items.map((f) => (
        <div key={f.label} className="fact-card">
          <span className="fact-card__label">{f.label}</span>
          <div className="fact-card__value">
            {f.tone ? <Badge tone={f.tone}>{f.value}</Badge> : f.value}
          </div>
          {f.hint ? <div className="fact-card__hint">{f.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
