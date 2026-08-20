/**
 * Bottom-right floating dock for live job logs. One expanded panel; other jobs as pills.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InstallStreamPanel } from '../components/ui/InstallStreamPanel';
import { buttonClassName } from '../components/ui/Button';
import { useOpsStream, type OpsStreamJob, type OpsStreamJobKind } from './OpsStreamContext';

function kindLabel(kind: OpsStreamJobKind, t: (k: string) => string): string {
  if (kind === 'uninstall') return t('softwareLifecycle.kindUninstall');
  if (kind === 'apply') return t('softwareLifecycle.kindApply');
  if (kind === 'scan') return t('softwareLifecycle.kindScan');
  if (kind === 'deploy') return t('softwareLifecycle.kindDeploy');
  if (kind === 'runtime') return t('softwareLifecycle.kindRuntime');
  return t('softwareLifecycle.kindInstall');
}

function statusClass(job: OpsStreamJob): string {
  if (job.busy) return ' is-busy';
  if (job.cancelled) return ' is-cancel';
  if (job.ok === false) return ' is-fail';
  return ' is-ok';
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function JobPill({
  job,
  t,
  onOpen,
}: {
  job: OpsStreamJob;
  t: (k: string, o?: Record<string, unknown>) => string;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job.busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job.busy]);
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const label = job.busy
    ? t('softwareLifecycle.dockBusy', {
        kind: kindLabel(job.kind, t),
        title: job.title,
      })
    : job.cancelled
      ? t('softwareLifecycle.dockCancelled', { title: job.title })
      : job.ok === false
        ? t('softwareLifecycle.dockFail', { title: job.title })
        : t('softwareLifecycle.dockDone', { title: job.title });
  return (
    <button
      type="button"
      className={`ops-stream-dock ops-stream-dock--mini${statusClass(job)}`}
      onClick={onOpen}
      title={job.title}
    >
      <span className="ops-stream-dock__mini-dot" aria-hidden />
      <span className="ops-stream-dock__mini-text">{label}</span>
      <span className="ops-stream-dock__mini-time">{formatElapsed(elapsed)}</span>
    </button>
  );
}

export function OpsStreamDock() {
  const { t } = useTranslation();
  const {
    jobs,
    job,
    minimized,
    setMinimized,
    setExpandedId,
    dismiss,
    requestCancel,
    isCancelRequested,
  } = useOpsStream();
  const [maximized, setMaximized] = useState(false);

  if (!jobs.length) return null;

  const pills = minimized || !job ? jobs : jobs.filter((j) => j.id !== job.id);

  return (
    <div className={`ops-stream-dock-stack${maximized && !minimized ? ' is-max' : ''}`}>
      {pills.map((j) => (
        <JobPill
          key={j.id}
          job={j}
          t={t}
          onOpen={() => {
            setExpandedId(j.id);
            setMinimized(false);
          }}
        />
      ))}
      {!minimized && job ? (
        <div
          className={`ops-stream-dock ops-stream-dock--panel${statusClass(job)}${maximized ? ' is-max' : ''}`}
          role="dialog"
          aria-label={job.title}
          data-testid="ops-stream-dock-panel"
          data-maximized={maximized ? 'true' : 'false'}
        >
          <header className="ops-stream-dock__head">
            <div className="ops-stream-dock__titles">
              <span className="ops-stream-dock__kind">{kindLabel(job.kind, t)}</span>
              <strong className="ops-stream-dock__title">{job.title}</strong>
            </div>
            <div className="ops-stream-dock__actions">
              {job.busy ? (
                <button
                  type="button"
                  className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  disabled={isCancelRequested}
                  onClick={() => requestCancel(job.id)}
                >
                  {isCancelRequested
                    ? t('softwareLifecycle.cancelling')
                    : t('softwareLifecycle.requestCancel')}
                </button>
              ) : null}
              <button
                type="button"
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                aria-pressed={maximized}
                data-testid="ops-stream-maximize"
                onClick={() => setMaximized((v) => !v)}
              >
                {maximized ? t('softwareLifecycle.restore') : t('softwareLifecycle.maximize')}
              </button>
              <button
                type="button"
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                data-testid="ops-stream-minimize"
                onClick={() => setMinimized(true)}
              >
                {t('softwareLifecycle.minimize')}
              </button>
              {!job.busy ? (
                <button
                  type="button"
                  className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                  onClick={() => dismiss(job.id)}
                >
                  {t('common.close')}
                </button>
              ) : null}
            </div>
          </header>
          <InstallStreamPanel
            lines={job.lines}
            busy={job.busy}
            title={t('softwareLifecycle.liveLog')}
            fill={maximized}
            defaultWrap
          />
          {job.error ? (
            <p className="ops-stream-dock__error" role="alert">
              {job.error}
            </p>
          ) : null}
          {job.cancelled && !job.busy ? (
            <p className="ops-stream-dock__hint muted" role="status">
              {t('softwareLifecycle.cancelHint')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
