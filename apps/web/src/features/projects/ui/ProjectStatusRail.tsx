import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { deriveProjectStatus } from '../model/status';
import { getProjectUiProfile } from '../model/runtime-ui';

export function ProjectStatusRail({ project }: { project: ProjectDto }) {
  const { t } = useTranslation();
  const display = deriveProjectStatus(project);
  const ui = getProjectUiProfile(project.runtime);
  const statusLabel = t(display.labelKey, { defaultValue: display.labelFallback });
  const healthOk =
    project.lastHealth && typeof project.lastHealth === 'object'
      ? (project.lastHealth as { ok?: boolean }).ok
      : undefined;

  let processValue = statusLabel;
  if (ui.runtime === 'node' && ui.showPid && project.pid != null) {
    processValue = `${statusLabel} · pid ${project.pid}`;
  } else if (ui.runtime === 'php') {
    processValue = statusLabel;
  } else if (ui.runtime === 'static') {
    processValue = project.nginxConfigPath
      ? t('projects.nginxPublished')
      : t('projects.status.ready', { defaultValue: 'Ready' });
  }

  return (
    <div className="status-rail">
      <div className="status-rail__item">
        <span className="status-rail__label">
          {t(ui.processLabelKey, { defaultValue: ui.processLabelFallback })}
        </span>
        <div className="status-rail__value">{processValue}</div>
        {display.hintKey ? (
          <div className="status-rail__hint">
            {t(display.hintKey, { defaultValue: display.hintFallback ?? '' })}
          </div>
        ) : null}
      </div>
      <div className="status-rail__item">
        <span className="status-rail__label">{t('projects.railNginx')}</span>
        <div className="status-rail__value">
          {project.nginxConfigPath ? t('projects.nginxPublished') : t('projects.nginxNone')}
        </div>
        {project.nginxConfigPath ? (
          <div className="status-rail__hint">
            <code className="inline">{project.nginxConfigPath}</code>
          </div>
        ) : null}
      </div>
      <div className="status-rail__item">
        <span className="status-rail__label">{t('projects.railOs')}</span>
        <div className="status-rail__value">{project.linuxUser || '—'}</div>
        <div className="status-rail__hint">
          {project.osProvisioned ? t('projects.osProvisioned') : t('projects.osPending')}
        </div>
      </div>
      <div className="status-rail__item">
        <span className="status-rail__label">{t('projects.railHealth')}</span>
        <div className="status-rail__value">
          {healthOk === true
            ? t('projects.healthOk')
            : healthOk === false
              ? t('projects.healthBad')
              : t('projects.healthUnknown')}
        </div>
        {ui.showProcessPort && project.port != null ? (
          <div className="status-rail__hint">port {project.port}</div>
        ) : null}
      </div>
    </div>
  );
}
