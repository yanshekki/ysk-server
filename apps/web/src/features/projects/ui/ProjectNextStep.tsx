import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { deriveProjectStatus } from '../model/status';

export function ProjectNextStep({ project }: { project: ProjectDto }) {
  const { t } = useTranslation();
  const display = deriveProjectStatus(project);

  if (display.bucket === 'pending_os') {
    return (
      <div className="next-step" role="status">
        <p className="next-step__title">{t('projects.next.pendingOsTitle')}</p>
        <p className="next-step__body">{t('projects.next.pendingOsBody')}</p>
        <p className="next-step__body">{t('projects.next.pendingOsActions')}</p>
      </div>
    );
  }

  if (!project.lastDeployAt && display.bucket === 'stopped') {
    return (
      <div className="next-step" role="status">
        <p className="next-step__title">{t('projects.next.deployTitle')}</p>
        <p className="next-step__body">{t('projects.next.deployBody')}</p>
      </div>
    );
  }

  if (project.lastDeployAt && !project.nginxConfigPath) {
    return (
      <div className="next-step" role="status">
        <p className="next-step__title">{t('projects.next.nginxTitle')}</p>
        <p className="next-step__body">{t('projects.next.nginxBody')}</p>
      </div>
    );
  }

  return null;
}
