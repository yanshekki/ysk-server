import { useTranslation } from 'react-i18next';
import { Button, Card, CardSection, LogViewer } from '../../../shared/components/ui';

export interface ProjectLogsTabProps {
  busy?: boolean;
  logTail: string;
  onLoad: () => void;
}

export function ProjectLogsTab({ busy, logTail, onLoad }: ProjectLogsTabProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardSection title={t('projects.sectionLogs')} description={t('projects.sectionLogsDesc')}>
        <div className="btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={onLoad}>
            {t('projects.viewLogs')}
          </Button>
        </div>
        <LogViewer text={logTail} emptyLabel={t('projects.logsEmpty')} />
      </CardSection>
    </Card>
  );
}
