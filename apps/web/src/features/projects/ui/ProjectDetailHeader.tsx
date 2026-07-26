import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { ProjectStatusBadge } from './ProjectStatusBadge';
import { deriveProjectStatus } from '../model/status';
import { getProjectUiProfile } from '../model/runtime-ui';
import { Button } from '../../../shared/components/ui';

export interface ProjectDetailHeaderProps {
  project: ProjectDto;
  busy?: boolean;
  onDeploy: () => void;
  onStop: () => void;
  onHealth: () => void;
}

export function ProjectDetailHeader({
  project,
  busy,
  onDeploy,
  onStop,
  onHealth,
}: ProjectDetailHeaderProps) {
  const { t } = useTranslation();
  const display = deriveProjectStatus(project);
  const ui = getProjectUiProfile(project.runtime);
  const hint = display.hintKey
    ? t(display.hintKey, { defaultValue: display.hintFallback ?? '' })
    : display.hintFallback;

  const openUrl =
    project.domain != null
      ? `https://${project.domain}`
      : project.port != null
        ? `http://127.0.0.1:${project.port}`
        : null;

  return (
    <div className="detail-header">
      <div>
        <div className="detail-header__back">
          <Link to="/projects">
            <Button variant="ghost" size="sm">
              ← {t('projects.backToList')}
            </Button>
          </Link>
        </div>
        <div className="detail-header__title-row">
          <h1>{project.name}</h1>
          <ProjectStatusBadge project={project} />
        </div>
        <p className="detail-header__sub">
          {project.domain ?? t('projects.noDomain')}
          {ui.showProcessPort && project.port != null ? ` · :${project.port}` : ''}
          {` · ${project.runtime}${project.runtimeVersion ? ` ${project.runtimeVersion}` : ''}`}
        </p>
        {hint ? <p className="status-hint">{hint}</p> : null}
      </div>
      <div className="detail-header__actions btn-row">
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
      </div>
    </div>
  );
}
