/**
 * Project overview — facts + real project ops.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Button,
  Badge,
  Card,
  CardSection,
  DescriptionList,
  SummaryStrip,
} from '../../../shared/components/ui';
import { HealthSummary } from './HealthSummary';
import { ProjectChecklist } from './ProjectChecklist';
import { ProjectNextStep } from './ProjectNextStep';
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
  onPublishNginx?: () => void;
  onPublishSsl?: () => void;
  onBackup?: () => void;
  onHealth?: () => void;
}

export function ProjectOverviewTab({
  project,
  busy,
  onPublishNginx,
  onPublishSsl,
  onBackup,
  onHealth,
}: ProjectOverviewTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const copy = t('common.copy');
  const hasDomain = Boolean(project.domain?.trim());
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
    notes: string[];
    daily?: Array<{ day: string; hits: number; status2xx: number; status5xx: number }>;
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
          notes: r.notes ?? [],
          daily: (r as { daily?: Array<{ day: string; hits: number; status2xx: number; status5xx: number }> })
            .daily,
        }),
      )
      .catch(() => setWebStats(null));
  }, [project.id, project.quotaMb]);

  return (
    <div className="stack">
      <ProjectNextStep project={project} />
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
            {
              label: t('projects.ovDocroot'),
              value: project.docRoot || 'app/public',
            },
            ...(webStats
              ? [
                  {
                    label: t('projects.ovAccessSample'),
                    value: t('projects.ovLines', { count: webStats.linesRead }),
                  },
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
                  {
                    label: t('projects.ovDailyDays'),
                    value: String(webStats.daily?.length ?? 0),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {webStats?.daily && webStats.daily.length > 0 ? (
        <Card>
          <CardSection title={t('projects.ovDailyTitle')} description={t('projects.ovDailyDesc')}>
            <ul className="list-plain list-spaced">
              {webStats.daily
                .slice(-14)
                .reverse()
                .map((d) => (
                  <li key={d.day}>
                    <strong>{d.day}</strong> · hits {d.hits} · 2xx {d.status2xx} · 5xx{' '}
                    {d.status5xx}
                  </li>
                ))}
            </ul>
          </CardSection>
        </Card>
      ) : null}
      <Card>
        <CardSection title={t('projects.checklist.title')} description={t('projects.checklist.desc')}>
          <ProjectChecklist project={project} />
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.ovQuickTitle')}
          description={t('projects.ovQuickDesc')}
        >
          <div className="lifecycle-toolbar">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishNginx}
              title={!hasDomain ? t('projects.ovNeedNetworkDomain') : undefined}
              onClick={onPublishNginx}
            >
              {t('projects.ovPublishNginx')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishSsl}
              title={!hasDomain ? t('projects.ovNeedNetworkDomain') : undefined}
              onClick={onPublishSsl}
            >
              {t('projects.ovPublishSsl')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!onBackup}
              onClick={onBackup}
            >
              {t('projects.advBackupProject')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate(`/files?root=${encodeURIComponent(`project:${project.id}`)}`)}
            >
              {t('projects.ovOpenFiles')}
            </Button>
          </div>
          {!hasDomain ? (
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              {t('projects.ovNoDomainHint')}
            </p>
          ) : (
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              {t('projects.ovPublishNote')}
            </p>
          )}
        </CardSection>
      </Card>

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
                    <Badge>
                      {project.runtime === 'php'
                        ? 'PHP'
                        : project.runtime === 'node'
                          ? 'Node.js'
                          : project.runtime === 'static'
                            ? t('common.static')
                            : project.runtime === 'python'
                              ? 'Python'
                              : project.runtime === 'go'
                                ? 'Go'
                                : project.runtime === 'rust'
                                  ? 'Rust'
                                  : project.runtime}
                    </Badge>
                    {project.runtime !== 'static' && project.runtimeVersion
                      ? ` ${project.runtimeVersion}`
                      : ''}
                  </>
                ),
              },
              {
                label: t('projects.ovAliases'),
                value:
                  project.domainAliases && project.domainAliases.length > 0 ? (
                    <span className="muted">{project.domainAliases.join(', ')}</span>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
              {
                label: 'HTTPS',
                value: (
                  <span className="muted">
                    {project.forceHttps ? t('projects.ovForceOn') : t('projects.ovForceOff')}
                    {project.hsts ? ' · HSTS' : ''}
                  </span>
                ),
              },
              {
                label: t('projects.env'),
                value: project.env ?? '—',
              },
              {
                label: 'Git',
                value: (
                  <span className="muted">
                    {project.gitUrl ?? '—'}
                    {project.gitCommit ? ` @ ${project.gitCommit.slice(0, 8)}` : ''}
                  </span>
                ),
              },
              {
                label: t('projects.lastDeploy'),
                value: (
                  <span className="muted">
                    {project.lastDeployAt
                      ? new Date(project.lastDeployAt).toLocaleString()
                      : t('projects.neverDeployed')}
                  </span>
                ),
              },
              {
                label: t('projects.backup'),
                value: (
                  <span className="muted">
                    {project.lastBackupPath ?? '—'}
                    {project.lastBackupAt
                      ? ` (${new Date(project.lastBackupAt).toLocaleString()})`
                      : ''}
                  </span>
                ),
              },
              {
                label: t('projects.resources'),
                value: (
                  <span className="muted">
                    {project.memoryMax ?? '—'} mem · {project.cpuQuotaPercent ?? '—'}% CPU ·{' '}
                    {project.quotaMb != null
                      ? `${project.quotaMb} MiB`
                      : t('projects.quotaUnlimited')}
                  </span>
                ),
              },
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('projects.lastHealth')}>
          <HealthSummary lastHealth={project.lastHealth} />
        </CardSection>
      </Card>
    </div>
  );
}
