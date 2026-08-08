/**
 * System-wide button list (toolbar / row actions / page header actions).
 * Prefer this over className="btn-row".
 */
import type { ReactNode } from 'react';

export type ActionBarAlign = 'start' | 'end' | 'between';
export type ActionBarSize = 'sm' | 'md';

export interface ActionBarProps {
  children: ReactNode;
  align?: ActionBarAlign;
  /** Default sm — matches dense page chrome */
  size?: ActionBarSize;
  wrap?: boolean;
  className?: string;
  /** Accessible name for the group */
  'aria-label'?: string;
}

export function ActionBar({
  children,
  align = 'start',
  size = 'sm',
  wrap = true,
  className,
  'aria-label': ariaLabel }: ActionBarProps) {
  const cls = [
    'action-bar',
    align === 'end' ? 'action-bar--end' : '',
    align === 'between' ? 'action-bar--between' : '',
    size === 'md' ? 'action-bar--md' : 'action-bar--sm',
    wrap ? 'action-bar--wrap' : 'action-bar--nowrap',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
