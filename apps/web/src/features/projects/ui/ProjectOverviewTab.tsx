/**
 * Project overview — facts + usage + retry strip when live path broken.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Alert,
  Button,
  Badge,
  Card,
  CardSection,
  DescriptionList,
  FormActions,
  SummaryStrip,
} from '../../../shared/components/ui';
import { HealthSummary } from './HealthSummary';
import { projectNeedsLiveRetry } from '../model/status';
import { projectsApi } from '../api';

function PathValue({ value, copyLabel }: { value: string; copyLabel: string }) {
  return (
    <div className="path-row">
      <code className="inline">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        {copyLabel}
      </Button>
    </div>
  );
}

export interface ProjectOverviewTabProps {
  project: ProjectDto;
  busy?: boolean;
  onRetryDeploy?: () => void;
  onRetryPublish?: () => void;
  /** @deprecated */
  onPublishNginx?: () => void;
  onPublishSsl?: () => void;
  onBackup?: () => void;
  onHealth?: () => void;
}

export function ProjectOverviewTab({
  project,
  busy,
  onRetryDeploy,
  onRetryPublish,
}: ProjectOverviewTabProps) {
  const { t } = useTranslation();
  const copy = t('common.copy');
  const needRetry = projectNeedsLiveRetry(project);
  const [usage, setUsage] = useState<{
    usedMb: number;
    quotaMb: number | null;
    withinQuota: boolean | null;
  } | null>(null);
  const [webStats, setWebStats] = useState<{
    linesRead: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
  } | null>(null);

  useEffect(() => {
    void projectsApi
      .usage(project.id)
      .then((r) =>
        setUsage({
          usedMb: r.usedMb,
          quotaMb: r.quotaMb,
          withinQuota: r.withinQuota,
        }),
      )
      .catch(() => setUsage(null));
    void projectsApi
      .webStats(project.id)
      .then((r) =>
        setWebStats({
          linesRead: r.linesRead,
          status2xx: r.status2xx,
          status4xx: r.status4xx,
          status5xx: r.status5xx,
        }),
      )
      .catch(() => setWebStats(null));
  }, [project.id, project.quotaMb]);

  const notes = (project.lastDeployNotes ?? []).slice(0, 6);

  return (
    <div className="stack">
      {needRetry ? (
        <Alert variant="warning">
          <strong>
            {t('projects.retryLiveTitle', { defaultValue: '上線未完成' })}
          </strong>
          {notes.length ? (
            <ul className="u-mb-2 u-mt-2 u-pl-5">
              {notes.map((n) => (
                <li key={n} className="u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-mb-2 u-mt-1 u-text-sm">
              {t('projects.retryLiveBody', {
                defaultValue: '部署或 Nginx 發佈未成功，可重試。',
              })}
            </p>
          )}
          <FormActions>
            {onRetryDeploy ? (
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={onRetryDeploy}
              >
                {t('projects.retryDeploy', { defaultValue: '重試部署' })}
              </Button>
            ) : null}
            {onRetryPublish ? (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                disabled={!project.domain?.trim() && project.runtime !== 'static'}
                onClick={onRetryPublish}
              >
                {t('projects.retryPublish', { defaultValue: '重試發佈 Nginx' })}
              </Button>
            ) : null}
          </FormActions>
        </Alert>
      ) : null}

      {usage ? (
        <SummaryStrip
          items={[
            { label: t('projects.ovUsed'), value: `${usage.usedMb} MiB` },
            {
              label: t('publicFiles.quota'),
              value: usage.quotaMb != null ? `${usage.quotaMb} MiB` : t('projects.ovQuotaUnset'),
            },
            {
              label: t('projects.ovQuotaStatus'),
              value:
                usage.withinQuota === false
                  ? t('projects.ovOverQuota')
                  : usage.withinQuota === true
                    ? t('common.normal')
                    : '—',
              tone:
                usage.withinQuota === false
                  ? 'danger'
                  : usage.withinQuota === true
                    ? 'ok'
                    : 'default',
            },
            ...(webStats
              ? [
                  {
                    label: '2xx / 4xx / 5xx',
                    value: `${webStats.status2xx}/${webStats.status4xx}/${webStats.status5xx}`,
                    tone:
                      webStats.status5xx > 0
                        ? ('danger' as const)
                        : webStats.status4xx > webStats.status2xx
                          ? ('warn' as const)
                          : ('ok' as const),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      <Card>
        <CardSection title={t('projects.tabOverview')}>
          <DescriptionList
            columns={1}
            items={[
              {
                label: 'ID',
                value: <PathValue value={project.id} copyLabel={copy} />,
              },
              {
                label: t('projects.home'),
                value: <PathValue value={project.homeDir} copyLabel={copy} />,
              },
              {
                label: t('projects.runtime'),
                value: (
                  <>
                    <Badge>{project.runtime}</Badge>
                    {project.runtime !== 'static' && project.runtimeVersion
                      ? ` ${project.runtimeVersion}`
                      : ''}
                  </>
                ),
              },
              {
                label: t('common.domain'),
                value: project.domain || '—',
              },
              {
                label: t('projects.ovAliases'),
                value:
                  project.domainAliases && project.domainAliases.length > 0
                    ? project.domainAliases.join(', ')
                    : '—',
              },
              {
                label: t('projects.ovDocroot'),
                value: project.docRoot || 'app/public',
              },
              {
                label: t('common.port'),
                value:
                  project.port != null
                    ? String(project.port)
                    : project.preferredPort != null
                      ? `pref ${project.preferredPort}`
                      : '—',
              },
              {
                label: 'Nginx',
                value: project.nginxConfigPath || '—',
              },
              {
                label: t('projects.env'),
                value: project.env ?? '—',
              },
            ]}
          />
        </CardSection>
      </Card>

      {project.lastHealth ? <HealthSummary lastHealth={project.lastHealth} /> : null}
    </div>
  );
}
