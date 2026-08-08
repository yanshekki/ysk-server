/**
 * Project detail — single chrome (FeaturePageLayout) + KPI status + tabs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  ProjectAdvancedTab,
  ProjectDeleteDialog,
  ProjectDeployTab,
  ProjectDetailHeader,
  ProjectLogsTab,
  ProjectNetworkTab,
  ProjectOverviewTab,
  ProjectResourcesTab,
  projectsApi,
  useProjectOps } from '../features/projects';
import { envToText, formatRuntimeLabel } from '../features/projects/model/ops';
import { getProjectUiProfile } from '../features/projects/model/runtime-ui';
import { deriveProjectStatus } from '../features/projects/model/status';
import {
  ActionBar,
  Alert,
  Button,
  ConfirmDialog,
  FeaturePageLayout,
  LoadingBlock,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs } from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useCapabilities } from '../shared/hooks/useCapabilities';
import { bindSet, bindRun, bindVoid, bindNavigate } from './bind-handlers';

type ConfirmKind = 'stop' | 'delete' | null;

/** Tab ids for project detail chrome from UI profile flags. */
export function projectTabIds(
  ui: {
    showDeployTab?: boolean;
    showResourcesTab?: boolean;
    showLogsTab?: boolean;
  } | null,
): string[] {
  if (!ui) return ['overview'];
  const ids = ['overview'];
  // `app` is the deploy surface; keep `deploy` alias for deep links via resolveActiveTab
  if (ui.showDeployTab) ids.push('app');
  ids.push('network');
  if (ui.showResourcesTab) ids.push('isolation');
  ids.push('more');
  return ids;
}

export function resolveActiveTab(
  tabs: Array<{ id: string }>,
  tab: string,
): string {
  // Legacy deep links
  const alias: Record<string, string> = {
    deploy: 'app',
    resources: 'isolation',
    logs: 'more',
    advanced: 'more',
    about: 'overview' };
  const id = alias[tab] ?? tab;
  return tabs.some((x) => x.id === id) ? id : 'overview';
}

/** Format the log viewer header line (`# file · notes`). */
export function formatLogTailHeader(
  file: string,
  notes?: string | string[] | null,
): string {
  const noteStr = Array.isArray(notes)
    ? notes.filter(Boolean).join(' · ')
    : (notes ?? '');
  return `# ${file}${noteStr ? ` · ${noteStr}` : ''}\n`;
}

/** Project runtime status badge tone. */
export function projectStatusTone(
  status: string | null | undefined,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  const s = (status ?? '').toLowerCase();
  if (s === 'running' || s === 'active' || s === 'online') return 'ok';
  if (s === 'stopped' || s === 'inactive' || s === 'idle') return 'warn';
  if (s === 'failed' || s === 'error' || s === 'crashed') return 'danger';
  return 'neutral';
}

/** Short project id for UI chips. */
export function shortProjectId(id: string | null | undefined, n = 8): string {
  const s = id ?? '';
  if (!s) return '—';
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Whether stop confirm token matches project name. */
export function matchesStopConfirm(
  projectName: string,
  typed: string,
): boolean {
  return projectName.trim() === typed.trim() && projectName.length > 0;
}

/** Grep filter for log lines (case-insensitive). */
export function filterLogLines(
  lines: string[] | null | undefined,
  grep: string,
): string[] {
  const list = lines ?? [];
  const g = grep.trim().toLowerCase();
  if (!g) return list;
  return list.filter((l) => l.toLowerCase().includes(g));
}

/** Join directory path crumbs for logs save dialog. */
export function joinLogDirs(dirs: string[] | null | undefined): string {
  return (dirs ?? []).filter(Boolean).join('\n');
}

/** Parse multi-line dir list. */
export function parseLogDirs(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resource provision payload defaults. */
export function defaultResourceBody(
  kind: string,
  name: string,
): Record<string, unknown> {
  return {
    kind: kind.trim() || 'generic',
    name: name.trim() || 'resource' };
}

/** Whether project shows deploy tab from flags. */
export function hasDeployTab(ui: {
  showDeployTab?: boolean;
} | null): boolean {
  return Boolean(ui?.showDeployTab);
}

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gitUrl, setGitUrl] = useState('');
  const [envText, setEnvText] = useState('');
  const [quotaMb, setQuotaMb] = useState('1024');
  const [memoryMax, setMemoryMax] = useState('512M');
  const [cpuQuota, setCpuQuota] = useState('100');
  const [logTail, setLogTail] = useState('');
  const [logFiles, setLogFiles] = useState<
    Array<{ name: string; bytes?: number; mtime?: string; root?: string }>
  >([]);
  const [logFile, setLogFile] = useState<string>('');
  const [logExtraDirs, setLogExtraDirs] = useState<string[]>([]);
  const [logHits, setLogHits] = useState<
    Array<{ file: string; lines: string[]; matched: number }>
  >([]);
  const [logSearchNotes, setLogSearchNotes] = useState<string[]>([]);
  const [logRelated, setLogRelated] = useState<
    Array<{
      id: string;
      kind: string;
      label: string;
      source: string;
      available: boolean;
      meta?: string;
    }>
  >([]);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [guideOpen, setGuideOpen] = useState(false);
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
      if (found.logExtraDirs) setLogExtraDirs(found.logExtraDirs);
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

  async function loadLogs(opts?: {
    fileName?: string;
    name?: string;
    grep?: string;
  }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const name = opts?.name;
      const grep = opts?.grep;
      const r = await projectsApi.logs(project.id, { name, grep });
      setLogFiles(r.files ?? []);
      if (r.extraDirs) setLogExtraDirs(r.extraDirs);
      setLogHits(r.hits ?? []);
      setLogSearchNotes(r.notes ?? []);
      if (r.related) setLogRelated(r.related);

      // Multi-file content search: show first hit preview if no file selected
      if (grep && r.hits?.length && !opts?.fileName) {
        const first = r.hits[0]!;
        setLogFile(first.file);
        const tail = await projectsApi.logs(project.id, {
          file: first.file,
          lines: 200,
          grep });
        const header = formatLogTailHeader(
          tail.tail?.file ?? first.file,
          tail.tail?.notes?.[0],
        );
        setLogTail(header + (tail.tail?.lines ?? first.lines).join('\n'));
        return;
      }

      const pick = opts?.fileName || logFile || r.files[0]?.name;
      if (pick) {
        setLogFile(pick);
        const tail = await projectsApi.logs(project.id, {
          file: pick,
          lines: 200,
          grep });
        setLogTail(
          formatLogTailHeader(tail.tail?.file ?? pick, tail.tail?.notes) +
            (tail.tail?.lines ?? []).join('\n'),
        );
      } else {
        setLogTail(t('projects.logsNoFiles'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('projects.logsLoadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmAction() {
    if (!project || !confirm) return;
    if (confirm === 'stop') {
      setConfirm(null);
      await run('stop', project.id).catch(() => undefined);
    }
  }

  const ui = project ? getProjectUiProfile(project.runtime) : null;
  const tabIds = useMemo(() => projectTabIds(ui), [ui]);

  const rawTab = searchParams.get('tab');
  const defaultTab =
    rawTab === 'deploy' || rawTab === 'app'
      ? (tabIds as readonly string[]).includes('app')
        ? 'app'
        : 'overview'
      : 'overview';
  const [tab, setTab] = usePageTab(tabIds as string[], defaultTab);

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (loadError || !project || !ui) {
    return (
      <FeaturePageLayout
        title={t('projects.title')}
        backTo="/projects"
        backLabel={t('projects.backToList')}
      >
        <Alert variant="error">{loadError ?? t('projects.notFound')}</Alert>
        <Button variant="secondary" size="md" onClick={bindNavigate(navigate, '/projects')}>
          {t('projects.backToList')}
        </Button>
      </FeaturePageLayout>
    );
  }

  const tabs = [
    { id: 'overview', label: t('projects.tabOverview') },
    ...(ui.showDeployTab
      ? [{ id: 'app', label: t('projects.tabApp', { defaultValue: t('projects.tabDeploy') }) }]
      : []),
    { id: 'network', label: t('projects.tabNetwork') },
    ...(ui.showResourcesTab
      ? [
          {
            id: 'isolation',
            label: t('projects.tabIsolation', { defaultValue: t('projects.tabResources') }) },
        ]
      : []),
    { id: 'more', label: t('projects.tabMore', { defaultValue: t('projects.tabAdvanced') }) },
  ];
  const activeTab = resolveActiveTab(tabs, tab);
  const display = deriveProjectStatus(project);
  const statusHint = display.hintKey
    ? t(display.hintKey, { defaultValue: display.hintFallback ?? '' })
    : display.hintFallback;

  const subtitle = [
    project.domain ?? t('projects.noDomain'),
    formatRuntimeLabel(project.runtime, project.runtimeVersion, t),
  ].join(' · ');

  return (
    <FeaturePageLayout
      title={project.name}
      subtitle={subtitle}
      backTo="/projects"
      backLabel={t('projects.backToList')}
      status={{
        pill: {
          label: project.runtime,
          tone: 'ok' },
        items: [
          {
            label: t('common.status'),
            value: project.status ?? project.processStatus ?? '—' },
          {
            label: t('common.port'),
            value: project.port != null ? String(project.port) : '—' },
          {
            label: t('common.user'),
            value: project.linuxUser || '—' },
          {
            label: 'Nginx',
            value: (() => {
              const lh = (project.lastHealth ?? {}) as {
                nginxReloaded?: boolean;
                nginxStatus?: string;
              };
              if (!project.nginxConfigPath) return t('projects.nginxValueNone');
              if (lh.nginxReloaded || lh.nginxStatus === 'reloaded') {
                return t('projects.nginxLive');
              }
              return t('projects.nginxWritten');
            })(),
            tone: project.nginxConfigPath ? 'ok' : 'neutral' },
          {
            label: 'OS',
            value: project.osProvisioned ? t('projects.osValueReady') : t('projects.osValuePending'),
            tone: project.osProvisioned ? 'ok' : 'warn' },
        ],
        note: statusHint ? <span>{statusHint}</span> : undefined }}
      actions={
        <ActionBar>
          <ProjectDetailHeader
            project={project}
            busy={busy}
            onDeploy={() =>
              void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id, {
                phpVersion }).catch(() => undefined)
            }
            onStop={bindSet(setConfirm, 'stop')}
            onHealth={bindRun(run, 'health', project.id)}
            onRefresh={bindVoid(refreshProject)}
          />
          <Button
            variant="ghost"
            size="md"
            onClick={() => setGuideOpen(true)}
            title={t('common.about')}
          >
            ?
          </Button>
        </ActionBar>
      }
    >
      <PageTabs tabs={tabs} active={activeTab} onChange={setTab} variant="scroll">
        {activeTab === 'overview' ? (
          <ProjectOverviewTab
            project={project}
            busy={busy}
            onRetryDeploy={() =>
              void run(ui.deployIsPhp ? 'deploy-php' : 'deploy', project.id, {
                phpVersion }).catch(() => undefined)
            }
            onRetryPublish={bindRun(run, 'publish-nginx', project.id)}
          />
        ) : null}
        {activeTab === 'app' ? (
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
                enableSystemd: opts?.enableSystemd }).catch(() => undefined)
            }
            onGitDeploy={(opts) =>
              void run('git-deploy', project.id, {
                gitUrl,
                entry: opts?.entry,
                skipBuild: opts?.skipBuild }).catch(() => undefined)
            }
            onSaveEnv={bindRun(run, 'env', project.id, { envText })}
            onPhpVersionChange={setPhpVersion}
            onRuntimeVersionSaved={(v) => {
              setProject((prev) => (prev ? { ...prev, runtimeVersion: v } : prev));
              void refreshProject();
            }}
            onOpsMessage={(m) => setMsg(m)}
          />
        ) : null}
        {activeTab === 'network' ? (
          <div className="tab-panel">
            <ProjectNetworkTab
              project={project}
              busy={busy}
              onPublish={bindRun(run, 'publish-nginx', project.id)}
              onPublishSsl={bindRun(run, 'publish-nginx-ssl', project.id)}
              onSaved={bindVoid(refreshProject)}
              onOpsResult={(_result, message) => {
                if (message) setMsg(message);
              }}
            />
          </div>
        ) : null}
        {activeTab === 'isolation' ? (
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
              onProjectRefresh={bindVoid(refreshProject)}
              onProvisionOs={() => {
                setBusy(true);
                setError(null);
                void projectsApi
                  .osProvision(project.id)
                  .then((r) => {
                    const d = r.osProvision?.detail ?? '';
                    if (r.ok) {
                      setMsg(t('projects.osUserReadyMsg', { detail: d }));
                    } else {
                      setMsg(
                        r.requiresRoot || r.requiresExecute
                          ? t('projects.osUserNeedRoot', { detail: d })
                          : d || t('projects.osUserIncomplete'),
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
              onSetResources={bindRun(run, 'resources', project.id, {
                  memoryMax,
                  cpuQuotaPercent: Number(cpuQuota) || 100 })}
            />
          </div>
        ) : null}
        {activeTab === 'more' ? (
          <div className="tab-panel stack">
            <ProjectLogsTab
              busy={busy}
              logTail={logTail}
              files={logFiles}
              selectedFile={logFile}
              extraDirs={logExtraDirs}
              hits={logHits}
              searchNotes={logSearchNotes}
              related={logRelated}
              projectId={project?.id}
              onSelectFile={(name, opts) =>
                void loadLogs({ fileName: name, grep: opts?.grep })
              }
              onLoad={(opts) => void loadLogs(opts)}
              onRefreshFile={(opts) =>
                void loadLogs({ fileName: logFile, grep: opts?.grep })
              }
              onSaveExtraDirs={async (dirs) => {
                if (!project) return;
                setBusy(true);
                setError(null);
                try {
                  const r = await projectsApi.setLogDirs(project.id, dirs);
                  setLogExtraDirs(r.extraDirs ?? dirs);
                  if (r.notes?.length) setMsg(r.notes.join(' · '));
                  await loadLogs();
                } catch (e) {
                  setError(e instanceof Error ? e.message : t('projects.saveLogDirsFailed'));
                } finally {
                  setBusy(false);
                }
              }}
            />
            <ProjectAdvancedTab
              project={project}
              busy={busy}
              onBackup={bindRun(run, 'backup', project.id)}
              onWordpress={bindRun(run, 'wordpress', project.id)}
              onSuspend={bindRun(run, 'suspend', project.id)}
              onUnsuspend={bindRun(run, 'unsuspend', project.id)}
              onDelete={can('projects.delete') ? bindSet(setConfirm, 'delete') : undefined}
              onOpsMessage={(m) => setMsg(m)}
            />
          </div>
        ) : null}
      </PageTabs>

      <OpsResultPanel title={t('projects.opsResult')} result={opsLog} message={msg} busy={busy} />

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title={t('common.about')}
        size="lg"
      >
        <PageGuide guideId="projectDetail" />
      </Modal>

      <ConfirmDialog
        open={confirm === 'stop'}
        onClose={bindSet(setConfirm, null)}
        onConfirm={onConfirmAction}
        title={t('projects.confirmStopTitle')}
        description={t('projects.confirmStopDesc', { name: project.name })}
        confirmLabel={t('projects.stop')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
      <ProjectDeleteDialog
        project={project}
        open={confirm === 'delete'}
        busy={busy}
        onClose={bindSet(setConfirm, null)}
        onDeleted={(r) => {
          setConfirm(null);
          const parts = [
            ...(r.notes ?? []).slice(0, 4),
            ...(r.warnings ?? []).slice(0, 2),
          ];
          setMsg(
            parts.length
              ? parts.join('；')
              : t('projects.deletedOk'),
          );
          navigate('/projects', { replace: true });
        }}
      />
    </FeaturePageLayout>
  );
}
