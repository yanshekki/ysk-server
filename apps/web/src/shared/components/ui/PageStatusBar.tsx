/**
 * Compact one-line page status strip (used by FeaturePageLayout).
 * Pages should not import this directly — pass `status` to FeaturePageLayout.
 */
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';

export type PageStatusChip = {
  label: string;
  value: ReactNode;
  tone?: BadgeTone;
  hint?: string;
};

export type PageStatusBarProps = {
  pill?: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'neutral' };
  chips?: PageStatusChip[];
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

function pillToBadge(tone?: string): BadgeTone {
  if (tone === 'ok') return 'ok';
  if (tone === 'warn') return 'warn';
  if (tone === 'danger') return 'danger';
  return 'neutral';
}

export function PageStatusBar({
  pill,
  chips,
  note,
  actions,
  className }: PageStatusBarProps) {
  const list = (chips ?? []).slice(0, 6);
  return (
    <div
      className={['page-status', className].filter(Boolean).join(' ')}
      role="status"
    >
      {pill ? (
        <Badge tone={pillToBadge(pill.tone)} className="page-status__pill">
          {pill.label}
        </Badge>
      ) : null}
      {list.length > 0 ? (
        <ul className="page-status__chips">
          {list.map((c) => (
            <li key={c.label} className="page-status__chip" title={c.hint}>
              <span className="page-status__chip-lab">{c.label}</span>
              {c.tone ? (
                <Badge tone={c.tone}>{c.value}</Badge>
              ) : (
                <strong className="page-status__chip-val">{c.value}</strong>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <div className="page-status__note">{note}</div> : null}
      <div className="page-status__grow" />
      {actions ? <div className="page-status__actions">{actions}</div> : null}
    </div>
  );
}
