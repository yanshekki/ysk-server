/**
 * Live install terminal — LogViewer for stdout/stderr/status while jobs stream.
 */
import { useTranslation } from 'react-i18next';
import { LogViewer, type LogViewerLine } from './LogViewer';

export type InstallStreamLine = {
  stream: 'stdout' | 'stderr' | 'status';
  line: string;
  at?: string;
};

export function InstallStreamPanel({
  lines,
  busy,
  title,
  fill = false,
  defaultWrap = false,
}: {
  lines: InstallStreamLine[];
  busy?: boolean;
  title?: string;
  fill?: boolean;
  defaultWrap?: boolean;
}) {
  const { t } = useTranslation();

  if (!lines.length && !busy) return null;

  const rows: LogViewerLine[] = lines.map((row) => ({
    text: row.line,
    level: row.stream === 'stderr' ? 'error' : row.stream === 'status' ? 'info' : 'plain',
  }));

  return (
    <section
      className={`install-stream-panel${fill ? ' install-stream-panel--fill' : ''}`}
      aria-live="polite"
      aria-busy={busy || undefined}
      data-testid="install-stream-panel"
    >
      <header className="install-stream-panel__head">
        <h4 className="install-stream-panel__title">
          {title ?? t('runtime.installLogTitle')}
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
      <LogViewer
        lines={rows}
        follow={Boolean(busy)}
        showFollow={false}
        emptyLabel={busy ? t('runtime.installLogWaiting') : t('logViewer.empty')}
        maxHeight={fill ? 'none' : 'min(42vh, 360px)'}
        defaultWrap={defaultWrap}
        downloadName="install.log"
      />
    </section>
  );
}
