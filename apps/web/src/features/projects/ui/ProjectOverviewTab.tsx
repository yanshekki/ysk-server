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
              label: '文件根目錄',
              value: project.docRoot || 'app/public',
            },
            ...(webStats
              ? [
                  {
                    label: 'Access 樣本',
                    value: `${webStats.linesRead} 行`,
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
                    label: '日統計天數',
                    value: String(webStats.daily?.length ?? 0),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {webStats?.daily && webStats.daily.length > 0 ? (
        <Card>
          <CardSection title="訪問日統計（最多 60 日）" description="由 access log 樣本滾動記錄">
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
          title="站點快捷操作"
          description="發布與備份（主部署請用頁頂按鈕或「部署」分頁）"
        >
          <div className="lifecycle-toolbar">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishNginx}
              title={!hasDomain ? '請先到「網絡」分頁設定域名' : undefined}
              onClick={() => onPublishNginx?.()}
            >
              發布 Nginx
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!hasDomain || !onPublishSsl}
              title={!hasDomain ? '請先到「網絡」分頁設定域名' : undefined}
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
              onClick={() => navigate(`/files?root=${encodeURIComponent(`project:${project.id}`)}`)}
            >
              開啟專案檔案
            </Button>
          </div>
          {!hasDomain ? (
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              未設定域名 — 請到「網絡」分頁設定後再發布站點。
            </p>
          ) : (
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              發布會寫入管理設定；真正 reload 系統 Nginx 需系統變更權限。
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
                            ? '靜態'
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
