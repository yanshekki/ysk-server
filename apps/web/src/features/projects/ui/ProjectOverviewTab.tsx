/**
 * Project overview — facts + usage + retry strip when live path broken.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from 'ysk-server-shared';
import {
  Alert,
  Button,
  Badge,
  Card,
  CardSection,
  DescriptionList,
  FormActions,
  SummaryStrip,
  buttonClassName } from '../../../shared/components/ui';
import { HealthSummary } from './HealthSummary';
import { projectNeedsLiveRetry } from '../model/status';
import { isRuntimeBinFallback } from '../model/ops';
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
  onProvisionOs?: () => void;
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
  onProvisionOs }: ProjectOverviewTabProps) {
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
  const [homeExists, setHomeExists] = useState<boolean | null>(null);

  useEffect(() => {
    void projectsApi
      .usage(project.id)
      .then((r) =>
        setUsage({
          usedMb: r.usedMb,
          quotaMb: r.quotaMb,
          withinQuota: r.withinQuota }),
      )
      .catch(() => setUsage(null));
    void projectsApi
      .webStats(project.id)
      .then((r) =>
        setWebStats({
          linesRead: r.linesRead,
          status2xx: r.status2xx,
          status4xx: r.status4xx,
          status5xx: r.status5xx }),
      )
      .catch(() => setWebStats(null));
    void projectsApi
      .getOsUser(project.id)
      .then((r) => setHomeExists(r.live.homeExists))
      .catch(() => setHomeExists(null));
  }, [project.id, project.quotaMb, project.homeDir, project.osProvisioned]);

  const notes = (project.lastDeployNotes ?? []).slice(0, 6);

  return (
    <div className="stack">
      {needRetry ? (
        <Alert variant="warn">
          <strong>
            {t('projects.retryLiveTitle')}
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
              {t('projects.retryLiveBody', { })}
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
                {t('projects.retryDeploy')}
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
                {t('projects.retryPublish')}
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
              value: usage.quotaMb != null ? `${usage.quotaMb} MiB` : t('projects.ovQuotaUnset') },
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
                    : 'default' },
            ...(webStats && webStats.linesRead > 0
              ? [
                  {
                    label: '2xx / 4xx / 5xx',
                    value: `${webStats.status2xx}/${webStats.status4xx}/${webStats.status5xx}`,
                    hint: t('projects.httpStatsHint'),
                    tone:
                      webStats.status5xx > 0
                        ? ('danger' as const)
                        : webStats.status4xx > webStats.status2xx
                          ? ('warn' as const)
                          : ('ok' as const) },
                ]
              : [
                  {
                    label: '2xx / 4xx / 5xx',
                    value: '—',
                    hint: t('projects.httpStatsNone'),
                    tone: 'default' as const,
                  },
                ]),
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
                value: <PathValue value={project.id} copyLabel={copy} /> },
              {
                label: t('projects.home'),
                value: (
                  <>
                    <PathValue value={project.homeDir} copyLabel={copy} />
                    {homeExists === false || project.osProvisioned === false ? (
                      <p className="muted u-text-sm u-mt-1">
                        <Badge tone="danger">
                          {homeExists === false
                            ? t('projects.homeMissing')
                            : t('projects.resOsNotCreated')}
                        </Badge>
                        {onProvisionOs ? (
                          <>
                            {' · '}
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              onClick={onProvisionOs}
                            >
                              {t('projects.resProvisionUser')}
                            </Button>
                          </>
                        ) : null}
                        {' · '}
                        <Link
                          to={`/projects/${encodeURIComponent(project.id)}?tab=isolation`}
                        >
                          {t('projects.goIsolation')}
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) },
              {
                label: t('projects.runtime'),
                value: (
                  <>
                    <Badge>{project.runtime}</Badge>
                    {project.runtime !== 'static' && project.runtimeVersion
                      ? ` ${project.runtimeVersion}`
                      : ''}
                    {project.runtimeBin ? (
                      <span className="muted u-text-sm">
                        {' '}
                        ·{' '}
                        {t(
                          isRuntimeBinFallback(
                            project.runtime,
                            project.runtimeVersion,
                            project.runtimeBin,
                          )
                            ? 'projects.runtimeFallback'
                            : 'projects.runtimeActual',
                          {
                            path: project.runtimeBin,
                            version: project.runtimeVersion || '',
                          },
                        )}
                      </span>
                    ) : null}
                  </>
                ) },
              {
                label: t('common.domain'),
                value: project.domain || '—' },
              {
                label: t('projects.ovAliases'),
                value:
                  project.domainAliases && project.domainAliases.length > 0
                    ? project.domainAliases.join(', ')
                    : '—' },
              {
                label: t('projects.ovDocroot'),
                value: project.docRoot || 'app/public' },
              {
                label: t('common.port'),
                value:
                  project.port != null
                    ? String(project.port)
                    : project.preferredPort != null
                      ? `pref ${project.preferredPort}`
                      : '—' },
              {
                label: 'Nginx',
                value: project.nginxConfigPath || '—' },
              {
                label: t('projects.env'),
                value: project.env ?? '—' },
            ]}
          />
          <FormActions>
            <Link
              to={`/files?root=project:${encodeURIComponent(project.id)}`}
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
            >
              {t('projects.ovOpenFiles')}
            </Link>
            <Link
              to={`/ftp?project=${encodeURIComponent(project.id)}`}
              className={buttonClassName({ variant: 'secondary', size: 'md' })}
            >
              {t('projects.advFtpManage')}
            </Link>
          </FormActions>
        </CardSection>
      </Card>

      {project.lastHealth ? <HealthSummary lastHealth={project.lastHealth} /> : null}
    </div>
  );
}
