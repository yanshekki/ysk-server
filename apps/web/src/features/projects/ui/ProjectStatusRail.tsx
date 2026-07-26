import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { deriveProjectStatus } from '../model/status';
import { getProjectUiProfile } from '../model/runtime-ui';
import { KpiCard, KpiGrid } from '../../../shared/components/ui';

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
  } else if (ui.runtime === 'static') {
    processValue = project.nginxConfigPath
      ? t('projects.nginxPublished')
      : t('projects.status.ready', { defaultValue: '已就緒' });
  }

  const processHint = display.hintKey
    ? t(display.hintKey, { defaultValue: display.hintFallback ?? '' })
    : display.hintFallback;

  return (
    <KpiGrid cols={4} className="project-status-kpis">
      <KpiCard
        label={t(ui.processLabelKey, { defaultValue: ui.processLabelFallback })}
        hint={ui.runtime === 'php' ? 'PHP' : ui.runtime === 'node' ? 'Node' : 'Static'}
      >
        <p className="dash-kpi__value dash-kpi__value--sm">{processValue}</p>
        {processHint ? <p className="dash-kpi__meta">{processHint}</p> : null}
      </KpiCard>

      <KpiCard
        label={t('projects.railNginx')}
        badge={{
          label: project.nginxConfigPath ? t('projects.nginxPublished') : t('projects.nginxNone'),
          tone: project.nginxConfigPath ? 'ok' : 'neutral',
        }}
      >
        {project.nginxConfigPath ? (
          <p className="dash-kpi__meta">
            <code className="inline u-break-all">{project.nginxConfigPath}</code>
          </p>
        ) : (
          <div className="dash-kpi__empty">
            <p className="dash-kpi__meta">尚未發布 Nginx 管理設定</p>
          </div>
        )}
      </KpiCard>

      <KpiCard
        label={t('projects.railOs')}
        badge={{
          label: project.osProvisioned ? t('projects.osProvisioned') : t('projects.osPending'),
          tone: project.osProvisioned ? 'ok' : 'warn',
        }}
      >
        <p className="dash-kpi__value dash-kpi__value--sm">{project.linuxUser || '—'}</p>
        <p className="dash-kpi__meta">
          {project.osProvisioned ? '已完成 OS 隔離' : '尚未完成 OS 隔離（需系統管理員權限）'}
        </p>
      </KpiCard>

      <KpiCard
        label={t('projects.railHealth')}
        badge={{
          label:
            healthOk === true
              ? t('projects.healthOk')
              : healthOk === false
                ? t('projects.healthBad')
                : t('projects.healthUnknown'),
          tone: healthOk === true ? 'ok' : healthOk === false ? 'danger' : 'neutral',
        }}
      >
        <p className="dash-kpi__value dash-kpi__value--sm">
          {healthOk === true ? '正常' : healthOk === false ? '異常' : '—'}
        </p>
        {ui.showProcessPort && project.port != null ? (
          <p className="dash-kpi__meta">埠 {project.port}</p>
        ) : (
          <p className="dash-kpi__meta">按「健康檢查」更新狀態</p>
        )}
      </KpiCard>
    </KpiGrid>
  );
}
