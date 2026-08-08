import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Badge } from '../../../shared/components/ui';
import { ProjectStatusBadge } from './ProjectStatusBadge';

/** List row only — delete is detail/advanced, not list (same as email domains). */
export function ProjectListItem({ project }: { project: ProjectDto }) {
  const { t } = useTranslation();
  return (
    <div className="list-row">
      <Link to={`/projects/${project.id}`} className="list-row__main">
        <div className="list-row__title">
          <span>{project.name}</span>
          <Badge tone="info">{project.runtime}</Badge>
        </div>
        <div className="list-row__meta">
          <span>{project.domain ?? t('projects.noDomain')}</span>
          {project.port != null ? <span>:{project.port}</span> : null}
          {project.lastDeployAt ? (
            <span>
              {t('projects.lastDeploy')}: {new Date(project.lastDeployAt).toLocaleString()}
            </span>
          ) : (
            <span>{t('projects.neverDeployed')}</span>
          )}
        </div>
      </Link>
      <div className="list-row__side">
        <ProjectStatusBadge project={project} />
        <Link to={`/projects/${project.id}`} className="list-row__chevron" aria-hidden>
          ›
        </Link>
      </div>
    </div>
  );
}
