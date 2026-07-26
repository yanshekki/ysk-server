/**
 * Read-only key/value display for overviews / status.
 * Never use <input readOnly> for facts — use this instead.
 */
import type { ReactNode } from 'react';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
  hint?: string;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  /** 1 or 2 columns */
  columns?: 1 | 2;
  className?: string;
}

export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  if (!items.length) return null;
  return (
    <dl
      className={`desc-list desc-list--cols-${columns}${className ? ` ${className}` : ''}`}
    >
      {items.map((item) => (
        <div key={item.label} className="desc-list__row">
          <dt className="desc-list__label">{item.label}</dt>
          <dd className="desc-list__value">
            {item.value == null || item.value === '' ? (
              <span className="muted">—</span>
            ) : (
              item.value
            )}
            {item.hint ? <div className="desc-list__hint">{item.hint}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
