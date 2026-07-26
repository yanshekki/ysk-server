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
  }, [project.id, project.quotaMb]);

  return (
    <div className="stack">
      <ProjectNextStep project={project} />
      {usage ? (
        <SummaryStrip
          items={[
            { label: '已用', value: `${usage.usedMb} MiB` },
            {
              label: '配額',
              value: usage.quotaMb != null ? `${usage.quotaMb} MiB` : '未設',
            },
            {
              label: '配額狀態',
              value:
                usage.withinQuota === false
                  ? '超額'
                  : usage.withinQuota === true
                    ? '正常'
                    : '—',
              tone:
                usage.withinQuota === false
                  ? 'danger'
                  : usage.withinQuota === true
                    ? 'ok'
                    : 'default',
            },
            {
              label: 'Document root',
              value: project.docRoot || 'app/public',
            },
          ]}
        />
      ) : null}
      <Card>
        <CardSection title={t('projects.checklist.title')} description={t('projects.checklist.desc')}>
          <ProjectChecklist project={project} />
        </CardSection>
      </Card>

      <Card>
        <CardSection title="本專案操作">
          <div className="lifecycle-toolbar">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishNginx}
              title={!hasDomain ? '請先設定域名' : undefined}
              onClick={() => onPublishNginx?.()}
            >
              發布 Nginx
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishSsl}
              title={!hasDomain ? '請先設定域名' : undefined}
              onClick={() => onPublishSsl?.()}
            >
              發布 Nginx + SSL
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!onBackup}
              onClick={() => onBackup?.()}
            >
              備份本專案
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!onHealth}
              onClick={() => onHealth?.()}
            >
              健康檢查
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate(`/files?root=${encodeURIComponent(`project:${project.id}`)}`)}
            >
              開啟專案檔案
            </Button>
          </div>
          {!hasDomain ? (
            <p className="muted u-text-sm u-mt-2" style={{ marginBottom: 0 }}>
              未設定域名，無法發布站點
            </p>
          ) : null}
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
                    <Badge>{project.runtime}</Badge> {project.runtimeVersion ?? ''}
                  </>
                ),
              },
              {
                label: '別名',
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
                    {project.forceHttps ? '強制' : '唔強制'}
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
