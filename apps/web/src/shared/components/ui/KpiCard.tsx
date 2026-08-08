import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';

export type KpiGridCols = 2 | 3 | 4;

export function KpiGrid({
  children,
  cols = 4,
  className }: {
  children: ReactNode;
  cols?: KpiGridCols;
  className?: string;
}) {
  const cls = [
    'kpi-grid',
    cols === 2 ? 'kpi-grid--2' : cols === 3 ? 'kpi-grid--3' : 'kpi-grid--4',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} role="list">
      {children}
    </div>
  );
}

export interface KpiCardProps {
  label: string;
  hint?: ReactNode;
  badge?: { label: string; tone?: BadgeTone };
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Equal-height professional panel used across dashboard and feature pages.
 */
export function KpiCard({ label, hint, badge, children, footer, className }: KpiCardProps) {
  return (
    <article className={['kpi-card', className ?? ''].filter(Boolean).join(' ')} role="listitem">
      <header className="kpi-card__head">
        <span className="kpi-card__label">{label}</span>
        {badge ? <Badge tone={badge.tone ?? 'neutral'}>{badge.label}</Badge> : null}
        {!badge && hint != null ? <span className="kpi-card__hint">{hint}</span> : null}
      </header>
      <div className="kpi-card__body">{children}</div>
      {footer != null ? <footer className="kpi-card__foot">{footer}</footer> : null}
    </article>
  );
}
