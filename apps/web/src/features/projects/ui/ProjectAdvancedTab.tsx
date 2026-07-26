import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Button, Card, CardSection } from '../../../shared/components/ui';
import { getProjectUiProfile } from '../model/runtime-ui';

export interface ProjectAdvancedTabProps {
  project: ProjectDto;
  busy?: boolean;
  onBackup: () => void;
  onWordpress: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onDelete: () => void;
}

export function ProjectAdvancedTab({
  project,
  busy,
  onBackup,
  onWordpress,
  onSuspend,
  onUnsuspend,
  onDelete,
}: ProjectAdvancedTabProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);
  const suspended = project.status === 'suspended';

  return (
    <Card>
      <CardSection title={t('projects.sectionAdvanced')} description={t('projects.sectionAdvancedDesc')}>
        <div className="btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={onBackup}>
            {t('projects.backup')}
          </Button>
          {ui.showWordpress ? (
            <Button variant="secondary" size="md" loading={busy} onClick={onWordpress}>
              {t('projects.downloadWp')}
            </Button>
          ) : null}
          {suspended ? (
            <Button variant="primary" size="md" loading={busy} onClick={onUnsuspend}>
              恢復專案
            </Button>
          ) : (
            <Button variant="secondary" size="md" loading={busy} onClick={onSuspend}>
              暫停專案
            </Button>
          )}
        </div>
        {suspended ? (
          <p className="muted u-text-sm u-mt-2">暫停中：進程已停、Nginx 回 503。</p>
        ) : (
          <p className="muted u-text-sm u-mt-2">暫停會停止進程並將站點改為 503。</p>
        )}
      </CardSection>

      <div className="danger-zone">
        <h3 className="danger-zone__title">{t('projects.dangerZone')}</h3>
        <p className="danger-zone__desc">{t('projects.dangerZoneDesc')}</p>
        <Button variant="danger" size="md" loading={busy} onClick={onDelete}>
          {t('projects.delete')}
        </Button>
      </div>
    </Card>
  );
}
