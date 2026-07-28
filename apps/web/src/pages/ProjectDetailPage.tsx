/**
 * Project detail — single chrome (FeaturePageLayout) + KPI status + tabs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  ProjectAdvancedTab,
  ProjectDeployTab,
  ProjectDetailHeader,
  ProjectLogsTab,
  ProjectNetworkTab,
  ProjectOverviewTab,
  ProjectResourcesTab,
  ProjectStatusBadge,
  ProjectStatusRail,
  projectsApi,
  useProjectOps,
} from '../features/projects';
import { envToText, formatRuntimeLabel } from '../features/projects/model/ops';
import { getProjectUiProfile } from '../features/projects/model/runtime-ui';
import { deriveProjectStatus } from '../features/projects/model/status';
import {
  Alert,
  Button,
  ConfirmDialog,
  FeaturePageLayout,
  LoadingBlock,
  OpsHero,
  OpsResultPanel,
  Tabs,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';

type ConfirmKind = 'stop' | 'delete' | null;

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [freshChecklist, setFreshChecklist] = useState(
    () => searchParams.get('fresh') === '1',
  );
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gitUrl, setGitUrl] = useState('');
  const [envText, setEnvText] = useState('');
  const [quotaMb, setQuotaMb] = useState('1024');
  const [memoryMax, setMemoryMax] = useState('512M');
  const [cpuQuota, setCpuQuota] = useState('100');
  const [logTail, setLogTail] = useState('');
  const [logFiles, setLogFiles] = useState<Array<{ name: string; bytes?: number; mtime?: string }>>(
    [],
  );
  const [logFile, setLogFile] = useState<string>('');
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [phpVersion, setPhpVersion] = useState('8.2');

  const refreshProject = useCallback(async () => {
    const list = await projectsApi.list();
    const found = list.items.find((p) => p.id === id) ?? null;
    setProject(found);
    if (found) {
      setGitUrl(found.gitUrl ?? '');
      setEnvText(envToText(found.envVars, found.runtime));
      if (found.quotaMb != null) setQuotaMb(String(found.quotaMb));
      if (found.memoryMax) setMemoryMax(found.memoryMax);
      if (found.cpuQuotaPercent != null) setCpuQuota(String(found.cpuQuotaPercent));
      if (found.runtimeVersion) setPhpVersion(found.runtimeVersion);
    }
    return found;
  }, [id]);

  const { busy, setBusy, error, setError, msg, setMsg, opsLog, run } = useProjectOps(async () => {
    await refreshProject();
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refreshProject()
      .then((found) => {
        if (cancelled) return;
        if (!found) setLoadError(t('projects.notFound'));
        else setLoadError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshProject, t]);

  async function loadLogs(fileName?: string) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const r = await projectsApi.logs(project.id);
      setLogFiles(r.files ?? []);
      const pick = fileName || logFile || r.files[0]?.name;
      if (pick) {
        setLogFile(pick);
        const tail = await projectsApi.logs(project.id, pick, 200);
        setLogTail(`# ${tail.tail?.file ?? pick}\n` + (tail.tail?.lines ?? []).join('\n'));
      } else {
        setLogTail(t('projects.logsNoFiles'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取日誌失敗');
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmAction() {
    if (!project || !confirm) return;
    if (confirm === 'stop') {
      setConfirm(null);
      await run('stop', project.id).catch(() => undefined);
      return;
    }
    if (confirm === 'delete') {
      setConfirm(null);
      setBusy(true);
      setError(null);
      try {
        await projectsApi.remove(project.id);
        navigate('/projects', { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : '刪除失敗');
      } finally {
        setBusy(false);
      }
    }
  }

  const ui = project ? getProjectUiProfile(project.runtime) : null;
  const tabIds = useMemo(() => {
    if (!ui) return ['overview'] as const;
    const ids = ['overview'];
    if (ui.showDeployTab) ids.push('deploy');
    ids.push('network');
    if (ui.showResourcesTab) ids.push('resources');
    if (ui.showLogsTab) ids.push('logs');
    ids.push('advanced');
    return ids;
  }, [ui]);

  const defaultTab =
    searchParams.get('tab') === 'deploy' && (tabIds as readonly string[]).includes('deploy')
      ? 'deploy'
      : 'overview';
  const [tab, setTab] = usePageTab(tabIds as string[], defaultTab);

  useEffect(() => {
    if (searchParams.get('fresh') === '1') {
      setFreshChecklist(true);
      // Prefer deploy tab for new projects
      if ((tabIds as readonly string[]).includes('deploy')) {
        setTab('deploy');
      }
      // Drop query so refresh doesn't re-show forever (state keeps checklist until dismiss)
      const next = new URLSearchParams(searchParams);
      next.delete('fresh');
      if (next.get('tab') === 'deploy') {
        /* keep tab= in URL optional */
      }
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (loadError || !project || !ui) {
    return (
      <FeaturePageLayout
        title={t('projects.title')}
        backTo="/projects"
        backLabel={t('projects.backToList')}
      >
        <Alert variant="error">{loadError ?? t('projects.notFound')}</Alert>
        <Button variant="secondary" size="md" onClick={() => navigate('/projects')}>
          {t('projects.backToList')}
        </Button>
      </FeaturePageLayout>
    );
  }

  const tabs = [
    { id: 'overview', label: t('projects.tabOverview') },
    ...(ui.showDeployTab ? [{ id: 'deploy', label: t('projects.tabDeploy') }] : []),
    { id: 'network', label: t('projects.tabNetwork') },
    ...(ui.showResourcesTab ? [{ id: 'resources', label: t('projects.tabResources') }] : []),
    ...(ui.showLogsTab ? [{ id: 'logs', label: t('projects.tabLogs') }] : []),
    { id: 'advanced', label: t('projects.tabAdvanced') },
  ];
  const activeTab = tabs.some((x) => x.id === tab) ? tab : 'overview';
  const display = deriveProjectStatus(project);
  const statusHint = display.hintKey
    ? t(display.hintKey, { defaultValue: display.hintFallback ?? '' })
    : display.hintFallback;

  const subtitle = [
    project.domain ?? t('projects.noDomain'),
    formatRuntimeLabel(project.runtime, project.runtimeVersion),
  ].join(' · ');

  return (
    <FeaturePageLayout
      title={project.name}
      subtitle={subtitle}
      backTo="/projects"
      backLabel={t('projects.backToList')}
      actions={
        <ProjectDetailHeader
          project={project}
          busy={busy}
          onDeploy={() =>
            void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id, {
              phpVersion,
            }).catch(() => undefined)
          }
          onStop={() => setConfirm('stop')}
          onHealth={() => void run('health', project.id).catch(() => undefined)}
          onRefresh={() => void refreshProject()}
        />
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <OpsHero
        eyebrow="Project"
        title={project.name}
        pill={project.runtime}
        pillTone="ok"
        tone="ok"
        hint={
          <>
            {project.domain ?? t('projects.noDomain')} · 發布 Nginx 後需 reload
            才算上線 · written ≠ live
          </>
        }
        meta={
          <>
            <ProjectStatusBadge project={project} />
            {statusHint ? (
              <>
                <span className="ops-hero__dot" />
                <span>{statusHint}</span>
              </>
            ) : null}
          </>
        }
        cta={
          <>
            <Link
              to={`/files?root=project:${project.id}`}
              className="btn btn--secondary btn--md"
            >
              檔案
            </Link>
            <Link
              to={`/ssl?domain=${encodeURIComponent(project.domain || '')}&action=le`}
              className="btn btn--ghost btn--md"
            >
              SSL
            </Link>
            <Link to="/logs" className="btn btn--ghost btn--md">
              日誌
            </Link>
          </>
        }
        stats={[
          {
            label: 'Runtime',
            value: formatRuntimeLabel(project.runtime, project.runtimeVersion),
          },
          {
            label: 'Port',
            value: project.port != null ? String(project.port) : '—',
          },
          {
            label: '狀態',
            value: project.status ?? project.processStatus ?? '—',
          },
          {
            label: '用戶',
            value: project.linuxUser || '—',
          },
        ]}
        rail={
          <li>
            <span className="ops-rail__k">home</span>
            <code className="ops-rail__code">{project.homeDir}</code>
          </li>
        }
      />

      <ProjectStatusRail project={project} />

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} variant="scroll">
        {activeTab === 'overview' ? (
          <ProjectOverviewTab
            project={project}
            busy={busy}
            onPublishNginx={() => void run('publish-nginx', project.id).catch(() => undefined)}
            onPublishSsl={() => void run('publish-nginx-ssl', project.id).catch(() => undefined)}
            onBackup={() => void run('backup', project.id).catch(() => undefined)}
            onHealth={() => void run('health', project.id).catch(() => undefined)}
          />
        ) : null}
        {activeTab === 'deploy' ? (
          <ProjectDeployTab
            project={project}
            busy={busy}
            gitUrl={gitUrl}
            setGitUrl={setGitUrl}
            envText={envText}
            setEnvText={setEnvText}
            onDeploy={(opts) =>
              void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id, {
                phpVersion,
                entry: opts?.entry,
                skipBuild: opts?.skipBuild,
              }).catch(() => undefined)
            }
            onGitDeploy={(opts) =>
              void run('git-deploy', project.id, {
                gitUrl,
                entry: opts?.entry,
                skipBuild: opts?.skipBuild,
              }).catch(() => undefined)
            }
            onSaveEnv={() => void run('env', project.id, { envText }).catch(() => undefined)}
            onPhpVersionChange={setPhpVersion}
            onRuntimeVersionSaved={(v) => {
              setProject((prev) => (prev ? { ...prev, runtimeVersion: v } : prev));
              void refreshProject();
            }}
            onOpsMessage={(m) => setMsg(m)}
            showFreshChecklist={freshChecklist}
            onDismissChecklist={() => setFreshChecklist(false)}
          />
        ) : null}
        {activeTab === 'network' ? (
          <div className="tab-panel">
            <ProjectNetworkTab
              project={project}
              busy={busy}
              onPublish={() => void run('publish-nginx', project.id).catch(() => undefined)}
              onPublishSsl={() => void run('publish-nginx-ssl', project.id).catch(() => undefined)}
              onSaved={() => void refreshProject()}
              onOpsResult={(_result, message) => {
                if (message) setMsg(message);
              }}
            />
          </div>
        ) : null}
        {activeTab === 'resources' ? (
          <div className="tab-panel">
            <ProjectResourcesTab
              busy={busy}
              project={project}
              quotaMb={quotaMb}
              setQuotaMb={setQuotaMb}
              memoryMax={memoryMax}
              setMemoryMax={setMemoryMax}
              cpuQuota={cpuQuota}
              setCpuQuota={setCpuQuota}
              onOpsMessage={(m) => setMsg(m)}
              onProjectRefresh={() => void refreshProject()}
              onProvisionOs={() => {
                setBusy(true);
                setError(null);
                void projectsApi
                  .osProvision(project.id)
                  .then((r) => {
                    const d = r.osProvision?.detail ?? '';
                    if (r.ok) {
                      setMsg(`系統用戶已就緒。${d}`);
                    } else {
                      setMsg(
                        r.requiresRoot || r.requiresExecute
                          ? `無法建立系統用戶：需要 YSK_EXECUTE + root。${d}`
                          : d || '系統用戶建立未完成',
                      );
                    }
                    return refreshProject();
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
              onSetQuota={() =>
                void run('quota', project.id, { quotaMb: Number(quotaMb) || 1024 }).catch(
                  () => undefined,
                )
              }
              onSetResources={() =>
                void run('resources', project.id, {
                  memoryMax,
                  cpuQuotaPercent: Number(cpuQuota) || 100,
                }).catch(() => undefined)
              }
            />
          </div>
        ) : null}
        {activeTab === 'logs' ? (
          <div className="tab-panel">
            <ProjectLogsTab
              busy={busy}
              logTail={logTail}
              files={logFiles}
              selectedFile={logFile}
              projectId={project?.id}
              onSelectFile={(name) => void loadLogs(name)}
              onLoad={() => void loadLogs()}
              onRefreshFile={() => void loadLogs(logFile)}
            />
          </div>
        ) : null}
        {activeTab === 'advanced' ? (
          <div className="tab-panel">
            <ProjectAdvancedTab
              project={project}
              busy={busy}
              onBackup={() => void run('backup', project.id).catch(() => undefined)}
              onWordpress={() => void run('wordpress', project.id).catch(() => undefined)}
              onSuspend={() => void run('suspend', project.id).catch(() => undefined)}
              onUnsuspend={() => void run('unsuspend', project.id).catch(() => undefined)}
              onDelete={() => setConfirm('delete')}
              onOpsMessage={(m) => setMsg(m)}
            />
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title={t('projects.opsResult')} result={opsLog} message={msg} busy={busy} />

      <ConfirmDialog
        open={confirm === 'stop'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void onConfirmAction()}
        title={t('projects.confirmStopTitle')}
        description={t('projects.confirmStopDesc', { name: project.name })}
        confirmLabel={t('projects.stop')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => void onConfirmAction()}
        title={t('projects.confirmDeleteTitle')}
        description={t('projects.confirmDeleteDesc', { name: project.name })}
        confirmLabel={t('projects.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
