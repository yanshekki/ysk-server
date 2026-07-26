import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { SummaryStrip } from '../../../shared/components/ui';
import { summarizeProjects } from '../model/status';

export function ProjectSummaryStrip({ items }: { items: ProjectDto[] }) {
  const { t } = useTranslation();
  const s = summarizeProjects(items);
  return (
    <SummaryStrip
      items={[
        { label: t('projects.statTotal'), value: s.total },
        { label: t('projects.statRunning'), value: s.running, tone: 'ok' },
        { label: t('projects.statDegraded'), value: s.degraded, tone: 'warn' },
        {
          label: t('projects.statPendingOs'),
          value: s.pendingOs,
          tone: s.pendingOs > 0 ? 'warn' : 'default',
        },
        { label: t('projects.statUnhealthy'), value: s.unhealthy, tone: 'danger' },
        { label: t('projects.statStopped'), value: s.stopped },
      ]}
    />
  );
}
