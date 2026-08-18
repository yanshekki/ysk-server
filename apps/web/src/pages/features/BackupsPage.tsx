/**
 * Server-wide backups — list / run-all / restore / delete (honest ok).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  LoadingBlock,
  FeaturePageLayout,
  Field,
  FormLayout,
  OpsResultPanel,
  PageTabs,
  FormActions,
  SegRadio,
  PromptDialog } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { sshApi } from '../../features/security/ssh/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { bindCall1, bindCheck, bindInput, bindSet, bindVoid } from '../bind-handlers';
import { formatDateTime } from '../../shared/lib/datetime';

function localizeBackupNote(
  raw: string,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  let s = String(raw || '').replace(/Wrotebackup/gi, 'Wrote backup');
  s = s.replace(/\bkept:\s*(\d+)/gi, (_m, n) => t('backups.noteKept', { n }));
  s = s.replace(/\bskipped:\s*/gi, t('backups.noteSkipped'));
  s = s.replace(/Home tar only — no SQL dump\./gi, t('backups.noteHomeTarOnly'));
  s = s.replace(/\.env \/ \.db\.env excluded\./gi, t('backups.noteEnvExcluded'));
  return s;
}

const BK_TABS = ['files', 'trash', 'ops', 'remote', 'about'] as const;

type BackupItem = {
  projectId: string;
  name: string;
  path: string;
  bytes: number;
  mtime: string;
};

type BackupTrashItem = BackupItem & {
  deletedAt: string;
  expiresAt: string;
  trashName: string;
};

type RemoteSettings = {
  enabled: boolean;
  kind: 'sftp' | 'local' | 's3';
  host?: string;
  port?: number;
  username?: string;
  path?: string;
  password?: string;
  identityId?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
};

type ResticSettings = {
  enabled: boolean;
  repoPath?: string;
  password?: string;
  s3Repo?: string;
};

export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short project id chip. */
export function shortProjectId(id: string | null | undefined, n = 10): string {
  const s = (id ?? '—').toString();
  if (s === '—') return s;
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Restore mode is a dry-run preview. */
export function isDryRunMode(mode: string): boolean {
  return mode === 'dry-run' || mode === 'preview';
}

/** Remote kind needs host field. */
export function remoteNeedsHost(kind: string): boolean {
  return kind === 'sftp' || kind === 's3';
}

/** Restic repo configured enough to list. */
export function resticReady(settings: {
  enabled?: boolean;
  repoPath?: string;
  s3Repo?: string;
  password?: string;
}): boolean {
  if (!settings.enabled) return false;
  const repo = (settings.repoPath || settings.s3Repo || '').trim();
  return Boolean(repo && (settings.password ?? '').length > 0);
}

/** Sort backups newest first by mtime. */
export function sortBackupsByMtime<T extends { mtime?: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) =>
    String(b.mtime ?? '').localeCompare(String(a.mtime ?? '')),
  );
}

/** Filter backups by free-text. */
export function filterBackups<
  T extends { name?: string; projectId?: string; path?: string },
>(items: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return items;
  return items.filter((b) => {
    const hay = `${b.name ?? ''} ${b.projectId ?? ''} ${b.path ?? ''}`.toLowerCase();
    return hay.includes(s);
  });
}

/** Total bytes across backup items. */
export function totalBackupBytes(
  items: Array<{ bytes?: number }> | null | undefined,
): number {
  return (items ?? []).reduce((acc, b) => acc + (Number(b.bytes) || 0), 0);
}

export function BackupsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useCapabilities();
  const canRestore = can('backups.restore');
  const canRun = can('backups.run');
  const [items, setItems] = useState<BackupItem[]>([]);
  const [trashItems, setTrashItems] = useState<BackupTrashItem[]>([]);
  const [purgeTrashTarget, setPurgeTrashTarget] = useState<BackupTrashItem | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null);
  const [liveProjectCount, setLiveProjectCount] = useState(0);
  const [headerReady, setHeaderReady] = useState(false);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [restoreMode, setRestoreMode] = useState<'full' | 'web' | 'dry-run'>('full');
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [remote, setRemote] = useState<RemoteSettings>({
    enabled: false,
    kind: 'sftp',
    port: 22,
    path: '/backups/ysk' });
  const [restic, setRestic] = useState<ResticSettings>({ enabled: false });
  /** true when server already has a password (masked as ***) */
  const [resticPasswordSet, setResticPasswordSet] = useState(false);
  const [exclusionsText, setExclusionsText] = useState(
    'node_modules\n.git\nvendor\n.cache',
  );
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Array<{ id: string; time?: string; tags?: string[]; paths?: string[] }>
  >([]);
  const [restoreProjectId, setRestoreProjectId] = useState('');
  const [resticSafe, setResticSafe] = useState<{
    projectId: string;
    snapshotId: string;
  } | null>(null);
  const [resticOverwrite, setResticOverwrite] = useState<{
    projectId: string;
    snapshotId: string;
  } | null>(null);
  const { busy, error: actErr, result, msg, run, setMsg } = useFeatureAction();
  const [identities, setIdentities] = useState<Array<{ id: string; name?: string }>>([]);

  const refresh = useCallback(async () => {
    const [r, s, proj, ids, trash] = await Promise.all([
      api.requestRaw<{
        items: BackupItem[];
        lastRun?: Record<string, unknown> | null;
      }>('/api/v1/backups'),
      api.requestRaw<{
        remote?: RemoteSettings;
        exclusions?: string[];
        restic?: ResticSettings;
      }>('/api/v1/backups/settings'),
      api.listProjects().catch(() => ({ items: [] })),
      sshApi.listIdentities().catch(() => ({ items: [] as Array<{ id: string; name?: string }> })),
      api
        .requestRaw<{ items: BackupTrashItem[] }>('/api/v1/backups/trash')
        .catch(() => ({ items: [] as BackupTrashItem[] })),
    ]);
    setIdentities(ids.items ?? []);
    setItems(r.items ?? []);
    setTrashItems(trash.items ?? []);
    setLastRun(r.lastRun ?? null);
    setLiveProjectCount(proj.items?.length ?? 0);
    setHeaderReady(true);
    setProjectNames(
      Object.fromEntries(
        (proj.items ?? []).map((p: { id?: string; name?: string }) => [
          String(p.id ?? ''),
          String(p.name || p.id || ''),
        ]),
      ),
    );
    if (s.remote) {
      const kind =
        s.remote.kind === 'local' || s.remote.kind === 's3' ? s.remote.kind : 'sftp';
      setRemote({
        enabled: Boolean(s.remote.enabled),
        kind,
        host: s.remote.host ?? '',
        port: s.remote.port ?? 22,
        username: s.remote.username ?? '',
        path: s.remote.path ?? '/backups/ysk',
        password: s.remote.password === '***' ? '' : (s.remote.password ?? ''),
        s3Bucket: s.remote.s3Bucket ?? '',
        s3Region: s.remote.s3Region ?? 'us-east-1',
        s3Endpoint: s.remote.s3Endpoint ?? '',
        awsAccessKeyId: s.remote.awsAccessKeyId ?? '',
        awsSecretAccessKey:
          s.remote.awsSecretAccessKey === '***' ? '' : (s.remote.awsSecretAccessKey ?? ''),
        identityId: s.remote.identityId ?? '',
      });
    }
    if (s.restic) {
      const hasPw =
        s.restic.password === '***' ||
        Boolean(s.restic.password && s.restic.password !== '***');
      setResticPasswordSet(hasPw);
      setRestic({
        enabled: Boolean(s.restic.enabled),
        repoPath: s.restic.repoPath ?? '',
        password: s.restic.password === '***' ? '' : (s.restic.password ?? ''),
        s3Repo: s.restic.s3Repo ?? '' });
    }
    if (s.exclusions?.length) {
      setExclusionsText(s.exclusions.join('\n'));
    }
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  async function saveSettings() {
    setSettingsBusy(true);
    setError(null);
    try {
      const exclusions = exclusionsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        remote: {
          enabled: remote.enabled,
          kind: remote.kind,
          host: remote.host || undefined,
          port: Number(remote.port) || 22,
          username: remote.username || undefined,
          path: remote.path || undefined,
          s3Bucket: remote.s3Bucket || undefined,
          s3Region: remote.s3Region || undefined,
          s3Endpoint: remote.s3Endpoint || undefined,
          awsAccessKeyId: remote.awsAccessKeyId || undefined,
          ...(remote.password ? { password: remote.password } : {}),
          ...(remote.awsSecretAccessKey
            ? { awsSecretAccessKey: remote.awsSecretAccessKey }
            : {}) },
        exclusions,
        restic: {
          enabled: restic.enabled,
          repoPath: restic.repoPath || undefined,
          s3Repo: restic.s3Repo || undefined,
          ...(restic.password ? { password: restic.password } : {}) } };
      await api.requestRaw('/api/v1/backups/settings', {
        method: 'POST',
        body: JSON.stringify(body) });
      setMsg(t('backups.settingsSaved'));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }

  const lastOk = lastRun?.ok;
  /** Unique project ids that have archives — not live hosting project count */
  const archiveProjectCount = new Set(items.map((i) => i.projectId)).size;
  const lastResults = Array.isArray(lastRun?.results)
    ? (lastRun!.results as Array<{
        projectId?: string;
        ok?: boolean;
        skipped?: boolean;
        notes?: string[];
        archivePath?: string;
      }>)
    : [];
  const sideResults = Array.isArray(lastRun?.sideResults)
    ? (lastRun!.sideResults as Array<{
        projectId?: string;
        kind?: string;
        ok?: boolean;
        skipped?: boolean;
        notes?: string[];
      }>)
    : [];
  const lastSkipped = lastResults.some((x) => x.skipped);

  const [tab, setTab] = usePageTab(BK_TABS, 'files');

  async function downloadBackup(b: BackupItem) {
    setError(null);
    try {
      const q = new URLSearchParams({ projectId: b.projectId, name: b.name });
      await api.downloadAuthenticated(`/api/v1/backups/download?${q}`, b.name);
      setMsg(t('backups.downloadStarted', { name: b.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.downloadFailed'));
    }
  }

  const latestArchiveAt = items.reduce<string | null>((best, b) => {
    if (!b.mtime) return best;
    if (!best) return b.mtime;
    return b.mtime > best ? b.mtime : best;
  }, null);
  const lastLabel =
    lastOk === true && lastSkipped
      ? t('backups.partialSkipped')
      : lastOk === true
        ? lastRun?.empty
          ? t('backups.nothingToDo')
          : lastRun?.sideOk === false
            ? t('backups.tarOkSideFail')
            : t('common.success')
        : lastOk === false
          ? t('backups.hasFailures')
          : !headerReady
            ? '…'
            : latestArchiveAt
              ? formatDateTime(latestArchiveAt, { locale: i18n.language })
              : t('backups.notYet');
  const lastTone =
    lastOk === true && lastSkipped
      ? 'warn'
      : lastOk === true
        ? lastRun?.sideOk === false
          ? 'warn'
          : 'ok'
        : lastOk === false
          ? 'danger'
          : 'ok';
  const resticLabel = restic.enabled
    ? resticPasswordSet || restic.password
      ? t('common.enabled')
      : t('backups.needPassword')
    : t('common.close');
  const resticTone = restic.enabled
    ? resticPasswordSet || restic.password
      ? 'ok'
      : 'warn'
    : 'neutral';
  return (
    <FeaturePageLayout
      title={t('nav.backups', { defaultValue: t('projects.backup') })}
      showCapability={false}
      status={{
        pill: {
          label: t('backups.lastRun', { label: lastLabel }),
          tone:
            lastTone === 'danger'
              ? 'danger'
              : lastTone === 'warn'
                ? 'warn'
                : 'ok' },
        items: [
          { label: t('backups.backupFiles'), value: headerReady ? items.length : '…' },
          { label: t('common.project'), value: headerReady ? liveProjectCount : '…' },
          {
            label: lastRun?.at ? t('backups.lastAll') : t('backups.latestFile'),
            value: lastLabel,
            tone:
              lastTone === 'danger'
                ? 'danger'
                : lastTone === 'warn'
                  ? 'warn'
                  : 'ok' },
          {
            label: 'restic',
            value: resticLabel,
            tone: resticTone as 'ok' | 'warn' | 'neutral' },
          {
            label: t('backups.remoteStep'),
            value: remote.enabled ? remote.kind : t('common.close'),
            tone: remote.enabled ? 'ok' : 'neutral' },
          { label: t('backups.withBackups'), value: headerReady ? archiveProjectCount : '…' },
        ] }}
      actions={<>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={bindSet(setTab, 'ops')}>
            {t('common.operation')}
          </Button>
        </>
      }
    >
      {error || actErr ? <Alert variant="error">{error ?? actErr}</Alert> : null}
      <div className="ops">
      <PageTabs
        tabs={[
          { id: 'files', label: t('backups.backupFiles'), badge: headerReady ? items.length || undefined : undefined },
          { id: 'trash', label: t('backups.tabTrash'), badge: trashItems.length || undefined },
          { id: 'ops', label: t('common.operation') },
          { id: 'remote', label: t('backups.remoteExclude') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'files' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">
                    {headerReady
                      ? t('backups.filesTitle', { count: items.length })
                      : t('common.loading')}
                  </h3>
                  <p className="ops-panel__sub">
                    {t('backups.filesSub')}
                  </p>
                </div>
                {canRun ? (
                  <Button variant="secondary" size="sm" onClick={bindSet(setTab, 'ops')}>
                    {t('backups.backupAllBtn')}
                  </Button>
                ) : null}
              </header>
          {!headerReady ? (
            <LoadingBlock label={t('common.loading')} />
          ) : items.length === 0 ? (
            <EmptyState
              title={t('backups.noBackups')}
              description={t('backups.noBackupsDesc')}
            />
          ) : (
            <div className="ops-svc-list">
                  {items.map((b) => (
                    <article key={`${b.projectId}:${b.name}`} className="ops-svc ops-svc--ok">
                      <div className="ops-svc__body">
                        <div className="ops-svc__head">
                          <h4 className="ops-svc__name">{b.name}</h4>
                          <Badge tone="neutral">{formatBytes(b.bytes)}</Badge>
                        </div>
                        <div className="ops-svc__meta">
                          <span>
                            {t('common.project')}{' '}
                            <code>{shortProjectId(b.projectId)}</code>
                          </span>
                          <span>
                            {b.mtime
                              ? formatDateTime(b.mtime, { locale: i18n.language })
                              : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="ops-svc__actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={bindCall1(downloadBackup, b)}
                          >
                            {t('system.download')}
                          </Button>
                          {canRestore && b.projectId === 'control-plane' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                setRestoreMode('dry-run');
                                setRestoreTarget(b);
                              }}
                            >
                              {t('system.preview')}
                            </Button>
                          ) : null}
                          {canRestore && b.projectId !== 'control-plane' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={busy}
                                title={t('backups.previewTitle')}
                                onClick={() => {
                                  setRestoreMode('dry-run');
                                  setRestoreTarget(b);
                                }}
                              >
                                {t('system.preview')}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={busy}
                                title={t('backups.restoreWebTitle')}
                                onClick={() => {
                                  setRestoreMode('web');
                                  setRestoreTarget(b);
                                }}
                              >
                                {t('backups.restoreWeb')}
                              </Button>
                              <details className="ops-svc__more">
                                <summary className="btn btn--ghost btn--sm">{t('common.more')}</summary>
                                <div className="ops-svc__more-panel">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={busy}
                                    title={t('backups.restoreFullTitle')}
                                    onClick={() => {
                                      setRestoreMode('full');
                                      setRestoreTarget(b);
                                    }}
                                  >
                                    {t('backups.restoreFull')}
                                  </Button>
                                  {canRun ? (
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      loading={busy}
                                      title={t('backups.deleteTitle')}
                                      onClick={bindSet(setDeleteTarget, b)}
                                    >
                                      {t('common.delete')}
                                    </Button>
                                  ) : null}
                                </div>
                              </details>
                            </>
                          ) : null}
                          {canRun && b.projectId === 'control-plane' ? (
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              title={t('backups.deleteTitle')}
                              onClick={bindSet(setDeleteTarget, b)}
                            >
                              {t('common.delete')}
                            </Button>
                          ) : null}
                      </div>
                    </article>
                  ))}
            </div>
          )}
            </section>
          </div>
        ) : null}

        {tab === 'trash' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">{t('backups.trashTitle', { count: trashItems.length })}</h3>
                  <p className="ops-panel__sub">{t('backups.trashSub')}</p>
                </div>
                {canRun && trashItems.length > 0 ? (
                  <Button variant="danger" size="sm" onClick={() => setEmptyTrashOpen(true)}>
                    {t('backups.trashEmptyAll')}
                  </Button>
                ) : null}
              </header>
              {trashItems.length === 0 ? (
                <EmptyState title={t('backups.trashEmpty')} description={t('backups.trashEmptyDesc')} />
              ) : (
                <div className="ops-svc-list">
                  {trashItems.map((b) => (
                    <article key={`${b.projectId}:${b.trashName}`} className="ops-svc">
                      <div className="ops-svc__body">
                        <div className="ops-svc__head">
                          <h4 className="ops-svc__name">{b.name}</h4>
                          <Badge tone="neutral">{formatBytes(b.bytes)}</Badge>
                        </div>
                        <div className="ops-svc__meta">
                          <span>
                            {t('common.project')} <code>{shortProjectId(b.projectId)}</code>
                          </span>
                          <span>
                            {t('backups.trashExpires', {
                              at: b.expiresAt
                                ? formatDateTime(b.expiresAt, { locale: i18n.language })
                                : '—',
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="ops-svc__actions">
                        {canRun ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy}
                              onClick={() =>
                                void run(async () => {
                                  const r = await api.requestRaw('/api/v1/backups/trash/restore', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      projectId: b.projectId,
                                      name: b.trashName,
                                    }),
                                  });
                                  await refresh();
                                  return r as OpsResultLike;
                                }, t('backups.trashRestored'))
                              }
                            >
                              {t('backups.trashRestore')}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              onClick={() => setPurgeTrashTarget(b)}
                            >
                              {t('backups.trashPurge')}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel">
      <section className="ops-panel">
        <header className="ops-panel__head">
          <div>
            <h3 className="ops-panel__title">{t('common.operation')}</h3>
            <p className="ops-panel__sub">
              {t('backups.opsHint')}
            </p>
          </div>
        </header>
          <div className="lifecycle-toolbar">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    const r = (await api.requestRaw('/api/v1/backups/run-all', {
                      method: 'POST' })) as OpsResultLike & {
                      results?: Array<{
                        projectId?: string;
                        ok?: boolean;
                        skipped?: boolean;
                        notes?: string[];
                      }>;
                      empty?: boolean;
                    };
                    await refresh();
                    const extra =
                      r.empty
                        ? t('backups.noProjects')
                        : Array.isArray(r.results)
                          ? t('backups.successRatio', { ok: r.results.filter((x) => x.ok && !x.skipped).length, total: r.results.filter((x) => !x.skipped).length })
                          : '';
                    return {
                      ...r,
                      notes: [
                        ...(r.notes ?? []),
                        extra ? t('backups.summary', { extra }) : '',
                      ].filter(Boolean) };
                  } catch (e) {
                    const m = e instanceof Error ? e.message : t('backups.backupFailed');
                    return { ok: false, notes: [m], blockMessage: m };
                  }
                }, t('backups.backupDone'))
              }
            >
              {t('backups.backupAll')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = (await api.requestRaw('/api/v1/backups/schedule', {
                    method: 'POST',
                    body: JSON.stringify({ schedule: '0 3 * * *', install: true }) })) as OpsResultLike & {
                    install?: { ok?: boolean; notes?: string[]; requiresExecute?: boolean };
                  };
                  return {
                    ...r,
                    notes: [
                      ...(r.notes ?? []),
                      ...(r.install?.notes ?? []),
                      t('backups.cronCmd'),
                      t('backups.cronHint'),
                    ] };
                }, t('backups.dailyCronRegistered'))
              }
            >
              {t('backups.registerDailyCron')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!canRun}
              onClick={() =>
                void run(async () => {
                  try {
                    const r = (await api.requestRaw('/api/v1/backups/control-plane', {
                      method: 'POST',
                      body: '{}' })) as OpsResultLike;
                    await refresh();
                    return r;
                  } catch (e) {
                    const m = e instanceof Error ? e.message : t('backups.backupFailed');
                    return { ok: false, notes: [m], blockMessage: m };
                  }
                }, t('backups.controlPlaneDone', { defaultValue: 'Control-plane backup done' }))
              }
            >
              {t('backups.controlPlane', { defaultValue: 'Backup control plane' })}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              disabled={!restic.enabled}
              title={
                !restic.enabled
                  ? t('backups.resticNeedConfig')
                  : undefined
              }
              onClick={() =>
                void run(async () => {
                  try {
                    return (await api.requestRaw('/api/v1/backups/restic/run', {
                      method: 'POST',
                      body: '{}' })) as OpsResultLike;
                  } catch (e) {
                    const m = e instanceof Error ? e.message : t('backups.resticFailed');
                    return { ok: false, notes: [m], blockMessage: m };
                  }
                }, t('backups.resticDone'))
              }
            >
              {t('backups.resticOnly')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => {
                void api
                  .requestRaw<{
                    ok?: boolean;
                    snapshots?: Array<{
                      id: string;
                      time?: string;
                      tags?: string[];
                      paths?: string[];
                    }>;
                    notes?: string[];
                  }>(
                    `/api/v1/backups/restic/snapshots${
                      restoreProjectId
                        ? `?projectId=${encodeURIComponent(restoreProjectId)}`
                        : ''
                    }`,
                  )
                  .then((r) => {
                    setSnapshots(r.snapshots ?? []);
                    setMsg(r.notes?.join('；') ?? `snapshots ${r.snapshots?.length ?? 0}`);
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              {t('backups.listSnapshots')}
            </Button>
          </div>

          {lastRun ? (
            <div className="u-mt-4">
              <h4 className="u-mb-2">
                {t('backups.lastAllDetail')}
              </h4>
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: t('common.time'),
                    value: lastRun.at
                      ? formatDateTime(String(lastRun.at), { locale: i18n.language })
                      : '—' },
                  {
                    label: t('projects.healthDetail.overall'),
                    value:
                      lastOk === true
                        ? lastRun.empty
                          ? t('backups.nothingZero')
                          : t('common.success')
                        : lastOk === false
                          ? t('backups.hasFailures')
                          : '—' },
                  {
                    label: t('common.notes'),
                    value: Array.isArray(lastRun.notes)
                      ? (lastRun.notes as string[])
                          .map((n) => localizeBackupNote(n, t))
                          .join(
                          i18n.language?.toLowerCase().startsWith('en') ? '; ' : '；',
                        )
                      : '—' },
                ]}
              />
              {lastSkipped ? (
                <Alert variant="warn" className="u-mt-3">
                  <p>{t('backups.skippedListHint')}</p>
                  <ul className="list-plain">
                    {lastResults
                      .filter((x) => x.skipped)
                      .map((x) => {
                        const pid = String(x.projectId ?? '');
                        return (
                        <li key={pid || String(x.archivePath)}>
                          {projectNames[pid] || shortProjectId(x.projectId, 12)}
                          {' · '}
                          {t('backups.skippedPendingOs')}
                          {pid ? (
                            <>
                              {' · '}
                              <Link
                                to={`/projects/${encodeURIComponent(pid)}?tab=isolation`}
                              >
                                {t('projects.goIsolation')}
                              </Link>
                            </>
                          ) : null}
                        </li>
                        );
                      })}
                  </ul>
                  <p className="muted u-text-sm">
                    <Link to="/logs">{t('backups.goLogs')}</Link>
                    {' · '}
                    <Link to="/backups?tab=about">{t('backups.goAbout')}</Link>
                  </p>
                </Alert>
              ) : null}
              {lastResults.length > 0 ? (
                <div className="u-mt-3">
                  <DataTable
                    columns={[
                      {
                        key: 'project',
                        header: t('common.project'),
                        render: (row) => (
                          <code className="inline">
                            {(row.projectId ?? '—').slice(0, 8)}
                            {(row.projectId?.length ?? 0) > 8 ? '…' : ''}
                          </code>
                        ) },
                      {
                        key: 'status',
                        header: t('common.status'),
                        nowrap: true,
                        render: (row) =>
                          row.skipped ? (
                            <Badge tone="neutral">{t('ssl.step.skipped')}</Badge>
                          ) : row.ok ? (
                            <Badge tone="ok">{t('common.success')}</Badge>
                          ) : (
                            <Badge tone="danger">{t('common.failed')}</Badge>
                          ) },
                      {
                        key: 'notes',
                        header: t('common.notes'),
                        className: 'muted u-text-sm',
                        render: (row) => {
                          const notes = (row.notes ?? []).join('；') || '—';
                          if (!row.skipped || !row.projectId) return notes;
                          return (
                            <>
                              {notes}
                              {' · '}
                              {t('backups.skippedPendingOs')}
                              {' · '}
                              <Link
                                to={`/projects/${encodeURIComponent(row.projectId)}?tab=isolation`}
                              >
                                {t('projects.goIsolation')}
                              </Link>
                            </>
                          );
                        } },
                    ]}
                    rows={lastResults}
                    rowKey={(row, i) => String(row.projectId ?? i)}
                  />
                </div>
              ) : (
                <p className="muted u-text-sm u-mt-2">
                  {lastRun.empty
                    ? t('backups.lastNoProjects')
                    : t('backups.noPerProject')}
                </p>
              )}
              {sideResults.length > 0 ? (
                <div className="u-mt-3">
                  <DataTable
                    title={t('backups.remoteSide')}
                    columns={[
                      {
                        key: 'project',
                        header: t('common.project'),
                        render: (row) => (
                          <code className="inline">
                            {(row.projectId ?? '—').slice(0, 8)}
                            {(row.projectId?.length ?? 0) > 8 ? '…' : ''}
                          </code>
                        ) },
                      {
                        key: 'kind',
                        header: t('common.steps'),
                        nowrap: true,
                        render: (row) =>
                          row.kind === 'restic' ? 'restic' : t('backups.remoteStep') },
                      {
                        key: 'status',
                        header: t('common.status'),
                        nowrap: true,
                        render: (row) =>
                          row.skipped ? (
                            <Badge tone="neutral">{t('ssl.step.skipped')}</Badge>
                          ) : row.ok ? (
                            <Badge tone="ok">{t('common.success')}</Badge>
                          ) : (
                            <Badge tone="danger">{t('common.failed')}</Badge>
                          ) },
                      {
                        key: 'notes',
                        header: t('common.notes'),
                        className: 'muted u-text-sm',
                        render: (row) =>
                          (row.notes ?? []).slice(0, 3).join('；') || '—' },
                    ]}
                    rows={sideResults}
                    rowKey={(row, i) =>
                      `side-${row.projectId ?? i}-${row.kind ?? i}`
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {snapshots.length > 0 ? (
            <div className="u-mt-4">
              <Field label={t('backups.restoreProjectId')} htmlFor="rs-pid" flush>
                <input
                  id="rs-pid"
                  value={restoreProjectId}
                  onChange={bindInput(setRestoreProjectId)}
                  placeholder="uuid"
                />
              </Field>
              <div className="u-mt-2">
                <DataTable
                  columns={[
                    {
                      key: 'id',
                      header: 'Snapshot',
                      render: (s) => <code className="inline">{s.id}</code> },
                    {
                      key: 'time',
                      header: t('common.time'),
                      className: 'muted',
                      nowrap: true,
                      render: (s) =>
                        s.time ? formatDateTime(s.time, { locale: i18n.language }) : '—' },
                    {
                      key: 'tags',
                      header: 'Tags',
                      className: 'muted u-text-sm',
                      render: (s) => (s.tags ?? []).join(', ') || '—' },
                  ]}
                  rows={snapshots}
                  rowKey={(s) => s.id}
                  rowActions={(s) => (
                    <ActionBar align="end">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const pid =
                            restoreProjectId ||
                            (s.tags ?? [])
                              .find((t) => t.startsWith('project:'))
                              ?.replace('project:', '') ||
                            '';
                          if (!pid) {
                            setError(
                              t('backups.needProjectOrTag'),
                            );
                            return;
                          }
                          void run(async () => {
                            return (await api.requestRaw(
                              '/api/v1/backups/restic/restore',
                              {
                                method: 'POST',
                                body: JSON.stringify({
                                  projectId: pid,
                                  snapshotId: s.id,
                                  dryRun: true }) },
                            )) as OpsResultLike;
                          }, t('backups.dryRunDone'));
                        }}
                      >
                        {t('system.preview')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const pid =
                            restoreProjectId ||
                            (s.tags ?? [])
                              .find((t) => t.startsWith('project:'))
                              ?.replace('project:', '') ||
                            '';
                          if (!pid) {
                            setError(
                              t('backups.needProjectOrTag'),
                            );
                            return;
                          }
                          setResticSafe({ projectId: pid, snapshotId: s.id });
                        }}
                      >
                        {t('backups.safeDir')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const pid =
                            restoreProjectId ||
                            (s.tags ?? [])
                              .find((t) => t.startsWith('project:'))
                              ?.replace('project:', '') ||
                            '';
                          if (!pid) {
                            setError(
                              t('backups.needProjectOrTag'),
                            );
                            return;
                          }
                          setResticOverwrite({
                            projectId: pid,
                            snapshotId: s.id });
                        }}
                      >
                        {t('backups.overwriteHome')}
                      </Button>
                    </ActionBar>
                  )}
                />
              </div>
            </div>
          ) : null}
          {lastRun ? (
            <div className="u-mt-4">
              <DescriptionList
                columns={2}
                items={[
                  {
                    label: t('projects.healthDetail.overall'),
                    value: (
                      <Badge tone={lastTone}>
                        {lastLabel}
                      </Badge>
                    ) },
                  {
                    label: t('common.time'),
                    value: lastRun.at
                      ? formatDateTime(String(lastRun.at), { locale: i18n.language })
                      : '—' },
                  ...(Array.isArray(lastRun.notes) && lastRun.notes.length
                    ? [
                        {
                          label: t('common.notes'),
                          value: (
                            <ul className="list-plain list-spaced">
                              {(lastRun.notes as string[])
                                .slice(0, 6)
                                .map((n) => (
                                  <li key={n}>{localizeBackupNote(n, t)}</li>
                                ))}
                            </ul>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          ) : null}
      </section>
          </div>
        ) : null}

        {tab === 'remote' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">{t('backups.remotePushTitle')}</h3>
                  <p className="ops-panel__sub">
                    {t('backups.remotePushSub')}
                  </p>
                </div>
                <Badge tone={remote.enabled ? 'ok' : 'neutral'}>
                  {remote.enabled ? remote.kind : t('common.close')}
                </Badge>
              </header>
                <FormLayout columns={2}>
                  <Field label={t('backups.enableRemote')} htmlFor="bk-en" flush>
                    <SegRadio
                      name="bk-en"
                      aria-label={t('backups.enableRemote')}
                      value={remote.enabled ? 'yes' : 'no'}
                      onChange={(v) =>
                        setRemote((r) => ({ ...r, enabled: v === 'yes' }))
                      }
                      options={[
                        { value: 'no', label: t('common.no') },
                        { value: 'yes', label: t('common.yes') },
                      ]}
                    />
                  </Field>
                  <Field label={t('backups.targetKind')} htmlFor="bk-kind" flush>
                    <SegRadio
                      name="bk-kind"
                      aria-label={t('backups.remoteKindAria')}
                      disabled={!remote.enabled}
                      value={remote.kind}
                      onChange={(v) =>
                        setRemote((r) => ({
                          ...r,
                          kind: v === 'local' || v === 's3' ? v : 'sftp' }))
                      }
                      options={[
                        { value: 'sftp', label: 'SFTP / scp' },
                        { value: 'local', label: t('backups.localPath') },
                        { value: 's3', label: 'S3' },
                      ]}
                    />
                  </Field>
                  {remote.kind === 'sftp' ? (
                    <>
                      <Field label={t('common.host')} htmlFor="bk-host" flush>
                        <input
                          id="bk-host"
                          value={remote.host ?? ''}
                          onChange={(e) => setRemote((r) => ({ ...r, host: e.target.value }))}
                          placeholder="backup.example.com"
                          disabled={!remote.enabled}
                        />
                      </Field>
                      <Field label={t('common.port')} htmlFor="bk-port" flush>
                        <input
                          id="bk-port"
                          value={String(remote.port ?? 22)}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, port: Number(e.target.value) || 22 }))
                          }
                          disabled={!remote.enabled}
                        />
                      </Field>
                      <Field label={t('common.username')} htmlFor="bk-user" flush>
                        <input
                          id="bk-user"
                          value={remote.username ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, username: e.target.value }))
                          }
                          disabled={!remote.enabled}
                        />
                      </Field>
                      <Field
                        label={t('common.password')}
                        htmlFor="bk-pass"
                        hint={t('backups.passwordSshHint')}
                        flush
                      >
                        <input
                          id="bk-pass"
                          type="password"
                          value={remote.password ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, password: e.target.value }))
                          }
                          placeholder={t('backups.savedLeaveEmpty')}
                          disabled={!remote.enabled}
                        />
                      </Field>
                      <Field
                        label={t('backups.identityId')}
                        htmlFor="bk-ident"
                        hint={t('backups.identityHint')}
                        flush
                      >
                        <select
                          id="bk-ident"
                          value={remote.identityId ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, identityId: e.target.value || undefined }))
                          }
                          disabled={!remote.enabled}
                        >
                          <option value="">{t('backups.identityNone')}</option>
                          {identities.map((i) => (
                            <option key={i.id} value={i.id}>
                              {(i.name || i.id).slice(0, 48)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : null}
                  {remote.kind === 's3' ? (
                    <>
                      <Field label={t('backups.s3Bucket')} htmlFor="bk-s3b" flush>
                        <input
                          id="bk-s3b"
                          value={remote.s3Bucket ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Bucket: e.target.value }))
                          }
                          placeholder="my-bucket/ysk"
                        />
                      </Field>
                      <Field label={t('backups.region')} htmlFor="bk-s3r" flush>
                        <input
                          id="bk-s3r"
                          value={remote.s3Region ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Region: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t('backups.endpointOptional')} htmlFor="bk-s3e" flush>
                        <input
                          id="bk-s3e"
                          value={remote.s3Endpoint ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, s3Endpoint: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t('backups.accessKey')} htmlFor="bk-ak" flush>
                        <input
                          id="bk-ak"
                          value={remote.awsAccessKeyId ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({ ...r, awsAccessKeyId: e.target.value }))
                          }
                        />
                      </Field>
                      <Field label={t('backups.secretKey')} htmlFor="bk-sk" flush>
                        <input
                          id="bk-sk"
                          type="password"
                          value={remote.awsSecretAccessKey ?? ''}
                          onChange={(e) =>
                            setRemote((r) => ({
                              ...r,
                              awsSecretAccessKey: e.target.value }))
                          }
                          placeholder={t('backups.savedLeaveEmpty')}
                        />
                      </Field>
                    </>
                  ) : null}
                  {remote.kind !== 's3' ? (
                    <Field
                      label={remote.kind === 'local' ? t('backups.localMirror') : t('backups.remotePath')}
                      htmlFor="bk-path"
                      fullWidth
                      flush
                      hint={
                        remote.kind === 'sftp'
                          ? t('backups.remotePathHint')
                          : undefined
                      }
                    >
                      <input
                        id="bk-path"
                        value={remote.path ?? ''}
                        onChange={(e) => setRemote((r) => ({ ...r, path: e.target.value }))}
                        placeholder="/backups/ysk"
                        disabled={!remote.enabled}
                      />
                    </Field>
                  ) : null}
                </FormLayout>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">{t('backups.resticTitle')}</h3>
                  <p className="ops-panel__sub">
                    {t('backups.resticDesc')}
                  </p>
                </div>
                <Badge tone={resticTone as 'ok' | 'warn' | 'neutral'}>
                  {resticLabel}
                </Badge>
              </header>
                <FormLayout columns={2}>
                  <Field label={t('backups.enableRestic')} htmlFor="rs-en" flush>
                    <SegRadio
                      name="rs-en"
                      aria-label={t('backups.enableRestic')}
                      value={restic.enabled ? 'yes' : 'no'}
                      onChange={(v) =>
                        setRestic((r) => ({ ...r, enabled: v === 'yes' }))
                      }
                      options={[
                        { value: 'no', label: t('common.no') },
                        { value: 'yes', label: t('common.yes') },
                      ]}
                    />
                  </Field>
                  <Field label={t('backups.repoPath')} htmlFor="rs-path" flush>
                    <input
                      id="rs-path"
                      value={restic.repoPath ?? ''}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, repoPath: e.target.value }))
                      }
                      placeholder={t('backups.resticRepoPh')}
                      disabled={!restic.enabled}
                    />
                  </Field>
                  <Field
                    label={t('backups.repoPassword')}
                    htmlFor="rs-pw"
                    flush
                    required={restic.enabled}
                    hint={
                      resticPasswordSet
                        ? t('backups.repoPassSaved')
                        : t('backups.repoPassRequired')
                    }
                  >
                    <input
                      id="rs-pw"
                      type="password"
                      value={restic.password ?? ''}
                      onChange={(e) => {
                        setRestic((r) => ({ ...r, password: e.target.value }));
                        if (e.target.value) setResticPasswordSet(true);
                      }}
                      placeholder={resticPasswordSet ? t('backups.savedPlaceholder') : t('backups.required')}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label={t('backups.s3RepoUrl')} htmlFor="rs-s3" flush>
                    <input
                      id="rs-s3"
                      value={restic.s3Repo ?? ''}
                      onChange={(e) =>
                        setRestic((r) => ({ ...r, s3Repo: e.target.value }))
                      }
                      placeholder="s3:s3.amazonaws.com/bucket/path"
                    />
                  </Field>
                </FormLayout>
            </section>

            <section className="ops-panel">
              <header className="ops-panel__head">
                <div>
                  <h3 className="ops-panel__title">{t('backups.excludeTitle')}</h3>
                  <p className="ops-panel__sub">{t('backups.excludeSub')}</p>
                </div>
              </header>
                <FormLayout>
                  <Field label={t('backups.excludeList')} htmlFor="bk-ex" fullWidth flush>
                    <textarea
                      id="bk-ex"
                      rows={5}
                      value={exclusionsText}
                      onChange={bindInput(setExclusionsText)}
                      placeholder={'node_modules\n.git'}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={settingsBusy}
                    onClick={bindVoid(saveSettings)}
                  >
                    {t('backups.saveAll')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    disabled={!remote.enabled}
                    title={
                      !remote.enabled
                        ? t('backups.testDisabledHint')
                        : t('backups.testRemoteHint')
                    }
                    onClick={() => {
                      void run(async () => {
                        try {
                          return (await api.requestRaw('/api/v1/backups/remote/test', {
                            method: 'POST',
                            body: JSON.stringify({
                              remote: {
                                ...remote,
                                password:
                                  !remote.password || remote.password === '***'
                                    ? undefined
                                    : remote.password,
                              },
                            }),
                          })) as OpsResultLike;
                        } catch (e) {
                          const m = e instanceof Error ? e.message : t('backups.testRemoteFailed');
                          return { ok: false, notes: [m], blockMessage: m };
                        }
                      }, t('backups.testRemoteDone'));
                    }}
                  >
                    {t('backups.testRemote')}
                  </Button>
                </FormActions>
            </section>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="backups" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={bindSet(setRestoreTarget, null)}
        onConfirm={() => {
          if (!restoreTarget) return;
          void run(async () => {
            try {
              const path =
                restoreTarget.projectId === 'control-plane'
                  ? '/api/v1/backups/control-plane/restore'
                  : '/api/v1/backups/restore';
              const r = await api.requestRaw(path, {
                method: 'POST',
                body: JSON.stringify(
                  restoreTarget.projectId === 'control-plane'
                    ? { name: restoreTarget.name, mode: 'dry-run' }
                    : {
                        projectId: restoreTarget.projectId,
                        name: restoreTarget.name,
                        mode: restoreMode,
                      },
                ),
              });
              setRestoreTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : t('backups.restoreFailed');
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, restoreMode === 'dry-run' ? t('backups.previewDone') : t('backups.restoreDone'));
        }}
        title={
          restoreMode === 'dry-run'
            ? t('backups.previewQ')
            : restoreMode === 'web'
              ? t('backups.restoreWebQ')
              : t('backups.restoreFullQ')
        }
        description={
          restoreTarget
            ? restoreMode === 'dry-run'
              ? t('backups.previewDesc', { name: restoreTarget.name })
              : restoreMode === 'web'
                ? t('backups.restoreWebDesc', { name: restoreTarget.name })
                : t('backups.restoreFullDesc', { name: restoreTarget.name })
            : ''
        }
        confirmLabel={restoreMode === 'dry-run' ? t('system.preview') : t('files.restore')}
        confirmText={
          restoreMode === 'full' && restoreTarget ? restoreTarget.name : undefined
        }
        cancelLabel={t('common.cancel')}
        danger={restoreMode === 'full'}
        busy={busy}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={bindSet(setDeleteTarget, null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void run(async () => {
            try {
              const r = await api.requestRaw('/api/v1/backups', {
                method: 'DELETE',
                body: JSON.stringify({
                  projectId: deleteTarget.projectId,
                  name: deleteTarget.name }) });
              setDeleteTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : t('common.deleteFailed');
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, t('backups.trashedOk'));
        }}
        title={t('backups.deleteTitle')}
        description={deleteTarget ? t('backups.deleteDesc', { name: deleteTarget.name }) : ''}
        confirmText={deleteTarget?.name}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        severity="destructive"
        busy={busy}
      />

      <ConfirmDialog
        open={Boolean(purgeTrashTarget)}
        onClose={bindSet(setPurgeTrashTarget, null)}
        onConfirm={() => {
          if (!purgeTrashTarget) return;
          void run(async () => {
            try {
              const r = await api.requestRaw('/api/v1/backups/trash', {
                method: 'DELETE',
                body: JSON.stringify({
                  projectId: purgeTrashTarget.projectId,
                  name: purgeTrashTarget.trashName,
                }),
              });
              setPurgeTrashTarget(null);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : t('common.deleteFailed');
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, t('backups.trashPurged'));
        }}
        title={t('backups.trashPurgeTitle')}
        description={
          purgeTrashTarget ? t('backups.trashPurgeDesc', { name: purgeTrashTarget.name }) : ''
        }
        confirmText={purgeTrashTarget?.name}
        confirmLabel={t('backups.trashPurge')}
        cancelLabel={t('common.cancel')}
        severity="destructive"
        busy={busy}
      />

      <ConfirmDialog
        open={emptyTrashOpen}
        onClose={() => setEmptyTrashOpen(false)}
        onConfirm={() => {
          void run(async () => {
            try {
              const r = await api.requestRaw('/api/v1/backups/trash/empty', {
                method: 'DELETE',
                body: '{}',
              });
              setEmptyTrashOpen(false);
              await refresh();
              return r as OpsResultLike;
            } catch (e) {
              const m = e instanceof Error ? e.message : t('common.deleteFailed');
              return { ok: false, notes: [m], blockMessage: m };
            }
          }, t('backups.trashPurged'));
        }}
        title={t('backups.trashEmptyTitle')}
        description={t('backups.trashEmptyDescConfirm', { count: trashItems.length })}
        confirmText={String(trashItems.length)}
        confirmLabel={t('backups.trashEmptyAll')}
        cancelLabel={t('common.cancel')}
        severity="destructive"
        busy={busy}
      />

      <ConfirmDialog
        open={resticSafe != null}
        onClose={bindSet(setResticSafe, null)}
        title={t('backups.resticSafeTitle')}
        description={
          resticSafe
            ? t('backups.resticSafeDesc', { snapshot: resticSafe.snapshotId, project: resticSafe.projectId.slice(0, 8)+'…' })
            : ''
        }
        confirmLabel={t('files.restore')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onConfirm={() => {
          const tgt = resticSafe;
          setResticSafe(null);
          if (!tgt) return;
          void run(async () => {
            return (await api.requestRaw('/api/v1/backups/restic/restore', {
              method: 'POST',
              body: JSON.stringify({
                projectId: tgt.projectId,
                snapshotId: tgt.snapshotId,
                overwriteHome: false }) })) as OpsResultLike;
          }, t('backups.resticRestoreDone'));
        }}
      />

      <PromptDialog
        open={resticOverwrite != null}
        onClose={bindSet(setResticOverwrite, null)}
        title={t('backups.overwriteTitle')}
        description={
          resticOverwrite
            ? t('backups.overwriteDesc', { project: resticOverwrite.projectId.slice(0, 8)+'…' })
            : ''
        }
        label={t('security.ssh.confirmString')}
        placeholder="OVERWRITE"
        expectExact="OVERWRITE"
        confirmLabel={t('backups.overwriteHome')}
        danger
        busy={busy}
        onSubmit={() => {
          const tgt = resticOverwrite;
          setResticOverwrite(null);
          if (!tgt) return true;
          void run(async () => {
            return (await api.requestRaw('/api/v1/backups/restic/restore', {
              method: 'POST',
              body: JSON.stringify({
                projectId: tgt.projectId,
                snapshotId: tgt.snapshotId,
                overwriteHome: true,
                confirmPhrase: 'OVERWRITE' }) })) as OpsResultLike;
          }, t('backups.resticOverwriteDone'));
          return true;
        }}
      />

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />
      </div>
    </FeaturePageLayout>
  );
}
