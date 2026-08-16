import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from 'ysk-server-shared';
import { Badge, Button } from '../../../shared/components/ui';
import { useNavBookmarks } from '../../../shared/hooks/useNavBookmarks';
import { notifyOk, notifyWarn } from '../../../shared/lib/notify';
import { formatDateTime } from '../../../shared/lib/datetime';
import { ProjectStatusBadge } from './ProjectStatusBadge';

/** List row only — delete is detail/advanced, not list (same as email domains). */
export function ProjectListItem({ project }: { project: ProjectDto }) {
  const { t } = useTranslation();
  const { isProjectBookmarked, toggleProject } = useNavBookmarks();
  const [pinBusy, setPinBusy] = useState(false);
  const pinned = isProjectBookmarked(project.id);

  return (
    <div className="list-row">
      <Link to={`/projects/${project.id}`} className="list-row__main">
        <div className="list-row__title">
          <span>{project.name}</span>
          <Badge tone="info">{project.runtime}</Badge>
          {pinned ? (
            <span title={t('nav.bookmarkPinned')}>
              <Badge tone="warn">★</Badge>
            </span>
          ) : null}
        </div>
        <div className="list-row__meta">
          <span>{project.domain ?? t('projects.noDomain')}</span>
          {project.port != null ? <span>:{project.port}</span> : null}
          {project.lastDeployAt ? (
            <span>
              {t('projects.lastDeploy')}: {formatDateTime(project.lastDeployAt)}
            </span>
          ) : (
            <span>{t('projects.neverDeployed')}</span>
          )}
        </div>
      </Link>
      <div className="list-row__side">
        <Button
          variant="ghost"
          size="sm"
          loading={pinBusy}
          title={pinned ? t('nav.unbookmark') : t('nav.bookmark')}
          aria-label={pinned ? t('nav.unbookmark') : t('nav.bookmark')}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPinBusy(true);
            void toggleProject({
              id: project.id,
              label: project.name,
              domain: project.domain ?? undefined,
            })
              .then((on) =>
                notifyOk(on ? t('nav.bookmarkAdded') : t('nav.bookmarkRemoved')),
              )
              .catch((err: Error) => notifyWarn(err.message))
              .finally(() => setPinBusy(false));
          }}
        >
          {pinned ? '★' : '☆'}
        </Button>
        <ProjectStatusBadge project={project} />
        <Link to={`/projects/${project.id}`} className="list-row__chevron" aria-hidden>
          ›
        </Link>
      </div>
    </div>
  );
}
