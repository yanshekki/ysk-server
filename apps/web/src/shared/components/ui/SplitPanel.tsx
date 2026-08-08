/**
 * Equal-height master–detail split — use for key lists, file previews, etc.
 */
import type { ReactNode } from 'react';

export interface SplitPanelProps {
  left: ReactNode;
  right: ReactNode;
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
  /** CSS grid columns, default 1fr 1.1fr */
  ratio?: string;
  /** Min height of both panes */
  minHeight?: string;
  className?: string;
}

export function SplitPanel({
  left,
  right,
  leftTitle,
  rightTitle,
  leftActions,
  rightActions,
  ratio = '1fr 1.1fr',
  minHeight = '24rem',
  className }: SplitPanelProps) {
  return (
    <div
      className={`split-panel${className ? ` ${className}` : ''}`}
      style={{ ['--split-ratio' as string]: ratio, ['--split-min-h' as string]: minHeight }}
    >
      <section className="split-panel__pane card">
        {(leftTitle != null || leftActions != null) && (
          <header className="split-panel__head">
            <div className="split-panel__title">{leftTitle}</div>
            {leftActions ? <div className="split-panel__actions">{leftActions}</div> : null}
          </header>
        )}
        <div className="split-panel__body">{left}</div>
      </section>
      <section className="split-panel__pane card">
        {(rightTitle != null || rightActions != null) && (
          <header className="split-panel__head">
            <div className="split-panel__title">{rightTitle}</div>
            {rightActions ? <div className="split-panel__actions">{rightActions}</div> : null}
          </header>
        )}
        <div className="split-panel__body">{right}</div>
      </section>
    </div>
  );
}
