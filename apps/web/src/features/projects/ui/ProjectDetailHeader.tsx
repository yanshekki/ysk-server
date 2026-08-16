/**
 * Primary action bar only — page title/back live in FeaturePageLayout (no duplicate header).
 */
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from 'ysk-server-shared';
import { getProjectUiProfile } from '../model/runtime-ui';
import {
  ActionBar,
  Button,
  buttonClassName,
} from '../../../shared/components/ui';

export interface ProjectDetailHeaderProps {
  project: ProjectDto;
  busy?: boolean;
  onDeploy: () => void;
  onStop: () => void;
  onHealth: () => void;
  onRefresh?: () => void;
}

export function ProjectDetailHeader({
  project,
  busy,
  onDeploy,
  onStop,
  onHealth,
  onRefresh }: ProjectDetailHeaderProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);

  const openUrl = project.domain != null ? `https://${project.domain}` : null;
  const provisioned = project.osProvisioned !== false;

  return (
    <ActionBar className="project-primary-actions">
      {ui.showDeploy ? (
        <Button
          variant="primary"
          size="md"
          loading={busy}
          disabled={!provisioned}
          title={
            provisioned
              ? t('projects.deployTitle', { defaultValue: t('projects.deploy') })
              : t('projects.needOsUser')
          }
          onClick={onDeploy}
        >
          {ui.deployIsPhp ? t('projects.deployPhp') : t('projects.deploy')}
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="md"
        loading={busy}
        disabled={!provisioned}
        title={
          provisioned
            ? t('projects.health')
            : t('projects.needOsUser')
        }
        onClick={onHealth}
      >
        {t('projects.health')}
      </Button>
      {ui.showStop ? (
        <Button
          variant="danger"
          size="md"
          loading={busy}
          disabled={!provisioned}
          title={
            provisioned
              ? t('projects.stopTitle', {
                  defaultValue: t('projects.stopNeedConfirm', {
                    defaultValue: t('projects.stop'),
                  }),
                })
              : t('projects.needOsUser')
          }
          onClick={onStop}
        >
          {t('projects.stop')}
        </Button>
      ) : null}
      {openUrl ? (
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName({ variant: 'secondary', size: 'md' })}
        >
          {t('projects.openUrl')}
        </a>
      ) : (
        <Button
          variant="secondary"
          size="md"
          disabled
          title={t('projects.openUrlNeedDomain')}
        >
          {t('projects.openUrl')}
        </Button>
      )}
      {onRefresh ? (
        <Button variant="ghost" size="md" loading={busy} onClick={onRefresh}>
          {t('common.refresh')}
        </Button>
      ) : null}
    </ActionBar>
  );
}
