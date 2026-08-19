/**
 * Unified information box — title + badge + facts + actions.
 * Use for runtime/status entities with paths and long strings.
 * Do NOT use kpi-card (max-width 14rem) for this content.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from './Badge';

export type InfoFact = {
  label: string;
  value: ReactNode;
  /** Prefer path-like strings as code */
  mono?: boolean;
};

export interface InfoCardProps {
  title: string;
  badge?: { label: string; tone?: BadgeTone; to?: string };
  facts: InfoFact[];
  actions?: ReactNode;
  className?: string;
}

export function InfoCard({ title, badge, facts, actions, className }: InfoCardProps) {
  return (
    <article
      className={['info-card', className ?? ''].filter(Boolean).join(' ')}
      role="listitem"
    >
      <header className="info-card__head">
        <h4 className="info-card__title">{title}</h4>
        {badge ? (
          badge.to ? (
            <Link to={badge.to} className="info-card__badge-link">
              <Badge tone={badge.tone ?? 'neutral'}>{badge.label}</Badge>
            </Link>
          ) : (
            <Badge tone={badge.tone ?? 'neutral'}>{badge.label}</Badge>
          )
        ) : null}
      </header>
      <div className="info-card__facts">
        {facts.map((f) => (
          <div key={f.label} className="info-card__fact">
            <span className="info-card__lab">{f.label}</span>
            <div className="info-card__val">
              {f.value == null || f.value === '' ? (
                <span className="muted">—</span>
              ) : f.mono ? (
                <code className="info-card__code">{f.value}</code>
              ) : (
                f.value
              )}
            </div>
          </div>
        ))}
      </div>
      {actions ? <footer className="info-card__actions">{actions}</footer> : null}
    </article>
  );
}

export type InfoCardGridCols = 2 | 3 | 4;

export function InfoCardGrid({
  children,
  cols = 3,
  className }: {
  children: ReactNode;
  cols?: InfoCardGridCols;
  className?: string;
}) {
  const cls = [
    'info-card-grid',
    cols === 2 ? 'info-card-grid--2' : '',
    cols === 3 ? 'info-card-grid--3' : '',
    cols === 4 ? 'info-card-grid--4' : '',
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
