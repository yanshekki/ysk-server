/**
 * Primary action bar only — page title/back live in FeaturePageLayout (no duplicate header).
 */
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { getProjectUiProfile } from '../model/runtime-ui';
import { ActionBar, Button } from '../../../shared/components/ui';

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

  const openUrl =
    project.domain != null
      ? `https://${project.domain}`
      : project.port != null
        ? `http://127.0.0.1:${project.port}`
        : null;

  return (
    <ActionBar className="project-primary-actions">
      {ui.showDeploy ? (
        <Button variant="primary" size="md" loading={busy} onClick={onDeploy}>
          {ui.deployIsPhp ? t('projects.deployPhp') : t('projects.deploy')}
        </Button>
      ) : null}
      <Button variant="secondary" size="md" loading={busy} onClick={onHealth}>
        {t('projects.health')}
      </Button>
      {ui.showStop ? (
        <Button variant="danger" size="md" loading={busy} onClick={onStop}>
          {t('projects.stop')}
        </Button>
      ) : null}
      {openUrl ? (
        <a href={openUrl} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="md">
            {t('projects.openUrl')}
          </Button>
        </a>
      ) : null}
      {onRefresh ? (
        <Button variant="ghost" size="md" loading={busy} onClick={onRefresh}>
          {t('common.refresh')}
        </Button>
      ) : null}
    </ActionBar>
  );
}
