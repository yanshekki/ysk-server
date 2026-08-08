/**
 * Live install terminal — shows server stdout/stderr while runtime install streams.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export type InstallStreamLine = {
  stream: 'stdout' | 'stderr' | 'status';
  line: string;
  at?: string;
};

export function InstallStreamPanel({
  lines,
  busy,
  title }: {
  lines: InstallStreamLine[];
  busy?: boolean;
  title?: string;
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lines.length, busy]);

  if (!lines.length && !busy) return null;

  return (
    <section
      className="install-stream-panel"
      aria-live="polite"
      aria-busy={busy || undefined}
      data-testid="install-stream-panel"
    >
      <header className="install-stream-panel__head">
        <h4 className="install-stream-panel__title">
          {title ??
            t('runtime.installLogTitle', { })}
        </h4>
        {busy ? (
          <span className="install-stream-panel__badge">
            {t('runtime.installLogStreaming')}
          </span>
        ) : (
          <span className="install-stream-panel__badge install-stream-panel__badge--done">
            {t('runtime.installLogDone')}
          </span>
        )}
      </header>
      <pre className="install-stream-panel__log" ref={boxRef} tabIndex={0}>
        {lines.length === 0 && busy ? (
          <span className="install-stream-panel__muted">
            {t('runtime.installLogWaiting')}
          </span>
        ) : null}
        {lines.map((row, i) => (
          <div
            key={`${i}-${row.line.slice(0, 24)}`}
            className={
              row.stream === 'stderr'
                ? 'install-stream-panel__line install-stream-panel__line--err'
                : row.stream === 'status'
                  ? 'install-stream-panel__line install-stream-panel__line--status'
                  : 'install-stream-panel__line'
            }
          >
            {row.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </pre>
    </section>
  );
}
