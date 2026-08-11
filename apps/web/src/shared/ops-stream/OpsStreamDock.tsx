/**
 * Bottom-right floating dock for live install/uninstall logs.
 */
import { useTranslation } from 'react-i18next';
import { InstallStreamPanel } from '../components/ui/InstallStreamPanel';
import { buttonClassName } from '../components/ui/Button';
import { useOpsStream } from './OpsStreamContext';

export function OpsStreamDock() {
  const { t } = useTranslation();
  const { job, minimized, setMinimized, dismiss } = useOpsStream();

  if (!job) return null;

  const kindLabel =
    job.kind === 'uninstall'
      ? t('softwareLifecycle.kindUninstall')
      : t('softwareLifecycle.kindInstall');

  if (minimized) {
    return (
      <button
        type="button"
        className={`ops-stream-dock ops-stream-dock--mini${job.busy ? ' is-busy' : job.ok === false ? ' is-fail' : ' is-ok'}`}
        onClick={() => setMinimized(false)}
        title={job.title}
      >
        <span className="ops-stream-dock__mini-dot" aria-hidden />
        <span className="ops-stream-dock__mini-text">
          {job.busy
            ? t('softwareLifecycle.dockBusy', { kind: kindLabel, title: job.title })
            : job.ok === false
              ? t('softwareLifecycle.dockFail', { title: job.title })
              : t('softwareLifecycle.dockDone', { title: job.title })}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`ops-stream-dock ops-stream-dock--panel${job.busy ? ' is-busy' : job.ok === false ? ' is-fail' : ' is-ok'}`}
      role="dialog"
      aria-label={job.title}
    >
      <header className="ops-stream-dock__head">
        <div className="ops-stream-dock__titles">
          <span className="ops-stream-dock__kind">{kindLabel}</span>
          <strong className="ops-stream-dock__title">{job.title}</strong>
        </div>
        <div className="ops-stream-dock__actions">
          <button
            type="button"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            onClick={() => setMinimized(true)}
          >
            {t('softwareLifecycle.minimize')}
          </button>
          {!job.busy ? (
            <button
              type="button"
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              onClick={() => dismiss()}
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
      />
      {job.error ? (
        <p className="ops-stream-dock__error" role="alert">
          {job.error}
        </p>
      ) : null}
    </div>
  );
}
