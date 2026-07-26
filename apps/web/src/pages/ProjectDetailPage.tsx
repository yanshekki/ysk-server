/**
 * Project detail — FeaturePageLayout shell + tabs (ops logic unchanged).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  ProjectStatusRail,
  projectsApi,
  useProjectOps,
} from '../features/projects';
import { envToText } from '../features/projects/model/ops';
import { getProjectUiProfile } from '../features/projects/model/runtime-ui';
import {
  Alert,
  Button,
  ConfirmDialog,
  FeaturePageLayout,
  LoadingBlock,
  OpsResultPanel,
  Tabs,
} from '../shared/components/ui';

type ConfirmKind = 'stop' | 'delete' | null;

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [gitUrl, setGitUrl] = useState('');
  const [envText, setEnvText] = useState('NODE_ENV=production\n');
  const [quotaMb, setQuotaMb] = useState('1024');
  const [memoryMax, setMemoryMax] = useState('512M');
  const [cpuQuota, setCpuQuota] = useState('100');
  const [logTail, setLogTail] = useState('');
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  const refreshProject = useCallback(async () => {
    const list = await projectsApi.list();
    const found = list.items.find((p) => p.id === id) ?? null;
    setProject(found);
    if (found) {
      setGitUrl(found.gitUrl ?? '');
      setEnvText(envToText(found.envVars));
      if (found.quotaMb != null) setQuotaMb(String(found.quotaMb));
      if (found.memoryMax) setMemoryMax(found.memoryMax);
      if (found.cpuQuotaPercent != null) setCpuQuota(String(found.cpuQuotaPercent));
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

  async function loadLogs() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const r = await projectsApi.logs(project.id);
      if (r.files[0]) {
        const tail = await projectsApi.logs(project.id, r.files[0].name, 80);
        setLogTail(
          `# ${tail.tail?.file ?? r.files[0].name}\n` + (tail.tail?.lines ?? []).join('\n'),
        );
      } else {
        setLogTail(t('projects.logsNoFiles'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'logs failed');
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
        setError(e instanceof Error ? e.message : 'delete failed');
      } finally {
        setBusy(false);
      }
    }
  }

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (loadError || !project) {
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

  const ui = getProjectUiProfile(project.runtime);
  const tabs = [
    { id: 'overview', label: t('projects.tabOverview') },
    ...(ui.showDeployTab ? [{ id: 'deploy', label: t('projects.tabDeploy') }] : []),
    { id: 'network', label: t('projects.tabNetwork') },
    ...(ui.showResourcesTab ? [{ id: 'resources', label: t('projects.tabResources') }] : []),
    ...(ui.showLogsTab ? [{ id: 'logs', label: t('projects.tabLogs') }] : []),
    { id: 'advanced', label: t('projects.tabAdvanced') },
  ];

  const activeTab = tabs.some((x) => x.id === tab) ? tab : 'overview';

  return (
    <FeaturePageLayout
      title={project.name}
      subtitle={
        project.domain
          ? `${project.domain} · ${project.runtime}`
          : `${t('projects.noDomain')} · ${project.runtime}`
      }
      backTo="/projects"
      backLabel={t('projects.backToList')}
      actions={
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() => void refreshProject()}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      <ProjectDetailHeader
        project={project}
        busy={busy}
        onDeploy={() =>
          void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id).catch(() => undefined)
        }
        onStop={() => setConfirm('stop')}
        onHealth={() => void run('health', project.id).catch(() => undefined)}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

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
            onDeploy={() =>
              void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id).catch(() => undefined)
            }
            onGitDeploy={() =>
              void run('git-deploy', project.id, { gitUrl }).catch(() => undefined)
            }
            onSaveEnv={() => void run('env', project.id, { envText }).catch(() => undefined)}
          />
        ) : null}
        {activeTab === 'network' ? (
          <ProjectNetworkTab
            project={project}
            busy={busy}
            onPublish={() => void run('publish-nginx', project.id).catch(() => undefined)}
            onPublishSsl={() => void run('publish-nginx-ssl', project.id).catch(() => undefined)}
            onSaved={() => void refreshProject()}
            onOpsResult={(result, message) => {
              if (result) {
                /* show via ops panel after refresh */
              }
              if (message) setMsg(message);
            }}
          />
        ) : null}
        {activeTab === 'resources' ? (
          <ProjectResourcesTab
            busy={busy}
            quotaMb={quotaMb}
            setQuotaMb={setQuotaMb}
            memoryMax={memoryMax}
            setMemoryMax={setMemoryMax}
            cpuQuota={cpuQuota}
            setCpuQuota={setCpuQuota}
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
        ) : null}
        {activeTab === 'logs' ? (
          <ProjectLogsTab busy={busy} logTail={logTail} onLoad={() => void loadLogs()} />
        ) : null}
        {activeTab === 'advanced' ? (
          <ProjectAdvancedTab
            project={project}
            busy={busy}
            onBackup={() => void run('backup', project.id).catch(() => undefined)}
            onWordpress={() => void run('wordpress', project.id).catch(() => undefined)}
            onSuspend={() => void run('suspend', project.id).catch(() => undefined)}
            onUnsuspend={() => void run('unsuspend', project.id).catch(() => undefined)}
            onDelete={() => setConfirm('delete')}
          />
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
