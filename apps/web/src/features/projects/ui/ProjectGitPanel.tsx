/**
 * Project Git console — status, remote, auth, sync, inbound hook.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from 'ysk-server-shared';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  SegRadio,
} from '../../../shared/components/ui';
import { bindInput } from '../../../pages/bind-handlers';
import { projectsApi } from '../api';
import { projectGitHookAbsoluteUrl } from '../model/git-hook-url';

const CUSTOM_REF = '__custom__';

export type GitDeployOpts = {
  entry?: string;
  skipBuild?: boolean;
  enableSystemd?: boolean;
  branch?: string;
};

export type ProjectGitPanelProps = {
  project: ProjectDto;
  busy?: boolean;
  gitUrl: string;
  setGitUrl: (v: string) => void;
  onGitDeploy: (opts?: GitDeployOpts) => void;
  onGitChanged?: () => void;
  onOpsMessage?: (msg: string) => void;
  persist?: () => void;
  deployOpts?: () => Omit<GitDeployOpts, 'branch'>;
};

type GitSt = Awaited<ReturnType<typeof projectsApi.gitStatus>>;

function schemeFromUrl(url: string): 'https' | 'ssh' {
  const u = url.trim();
  if (u.startsWith('git@') || u.startsWith('ssh://')) return 'ssh';
  return 'https';
}

export function ProjectGitPanel({
  project,
  busy,
  gitUrl,
  setGitUrl,
  onGitDeploy,
  onGitChanged,
  onOpsMessage,
  persist,
  deployOpts,
}: ProjectGitPanelProps) {
  const { t } = useTranslation();
  const [gitBranch, setGitBranch] = useState(project.gitBranch ?? '');
  const [customOpen, setCustomOpen] = useState(false);
  const [gitConfirmOpen, setGitConfirmOpen] = useState(false);
  const [gitResetOpen, setGitResetOpen] = useState(false);
  const [gitToken, setGitToken] = useState('');
  const [gitHookSecret, setGitHookSecret] = useState<string | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitSt, setGitSt] = useState<GitSt | null>(null);
  const [gitLog, setGitLog] = useState<Array<{ hash: string; subject: string; at?: string }>>([]);
  const [authOverride, setAuthOverride] = useState<'https' | 'ssh' | null>(null);
  const [showFullKey, setShowFullKey] = useState(false);
  const [hookHelpOpen, setHookHelpOpen] = useState(false);
  const [hookPlat, setHookPlat] = useState<'github' | 'gitea' | 'gitlab'>('github');
  const [refsBusy, setRefsBusy] = useState(false);
  const [remoteRefs, setRemoteRefs] = useState<{
    ok: boolean;
    defaultBranch?: string;
    branches: string[];
    tags: string[];
    notes: string[];
    code?: string;
  } | null>(null);
  const [loadedUrl, setLoadedUrl] = useState('');

  const urlScheme = schemeFromUrl(gitUrl);
  const authMode = authOverride ?? urlScheme;

  useEffect(() => {
    setGitBranch(project.gitBranch ?? '');
  }, [project.id, project.gitBranch]);

  const reloadGit = useCallback(async () => {
    try {
      const [st, log] = await Promise.all([
        projectsApi.gitStatus(project.id),
        projectsApi.gitLog(project.id, 10).catch(() => ({
          ok: false,
          items: [] as Array<{ hash: string; subject: string; at?: string }>,
        })),
      ]);
      setGitSt(st);
      setGitLog((log.items ?? []).filter((c) => c?.hash));
    } catch {
      setGitSt(null);
    }
  }, [project.id]);

  useEffect(() => {
    void reloadGit();
  }, [reloadGit, project.gitCommit]);

  const loadRefs = useCallback(
    async (url = gitUrl) => {
      const u = url.trim();
      if (!u) {
        setRemoteRefs({
          ok: false,
          branches: [],
          tags: [],
          notes: [t('projects.gitRefsNeedUrl')],
        });
        return;
      }
      setRefsBusy(true);
      try {
        const r = await projectsApi.gitRefs(project.id, { gitUrl: u });
        setRemoteRefs(r);
        setLoadedUrl(u);
        if (r.ok && r.defaultBranch && !gitBranch.trim()) {
          setGitBranch(r.defaultBranch);
          setCustomOpen(false);
        }
      } catch (e) {
        setRemoteRefs({
          ok: false,
          branches: [],
          tags: [],
          notes: [e instanceof Error ? e.message : t('common.opFailed')],
        });
      } finally {
        setRefsBusy(false);
      }
    },
    [gitUrl, gitBranch, project.id, t],
  );

  useEffect(() => {
    if (gitUrl.trim() && gitUrl.trim() !== loadedUrl) {
      void loadRefs(gitUrl);
    }
    // first paint only when project/url identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function runGitOp(fn: () => Promise<{ ok: boolean; notes?: string[] }>) {
    setGitBusy(true);
    try {
      const r = await fn();
      onOpsMessage?.(
        r.notes?.filter(Boolean).join('；') || (r.ok ? t('common.savedOk') : t('common.opFailed')),
      );
      await reloadGit();
      onGitChanged?.();
      return r;
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('common.opFailed'));
      return { ok: false as const };
    } finally {
      setGitBusy(false);
    }
  }

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const h of gitSt?.heads ?? []) if (h) set.add(h);
    for (const h of remoteRefs?.branches ?? []) if (h) set.add(h);
    return [...set];
  }, [gitSt?.heads, remoteRefs?.branches]);

  const tags = remoteRefs?.tags ?? [];
  const inList = Boolean(gitBranch) && (branches.includes(gitBranch) || tags.includes(gitBranch));
  const selectValue = customOpen || (gitBranch && !inList) ? CUSTOM_REF : gitBranch;

  const hookUrl = projectGitHookAbsoluteUrl(
    gitSt?.hook?.path || `/api/v1/hooks/git/${project.id}`,
  );

  function doSync() {
    persist?.();
    onGitDeploy({ ...deployOpts?.(), branch: gitBranch.trim() || undefined });
  }

  function onSyncClick() {
    const firstClone = !project.gitCommit && !gitSt?.isRepo;
    const urlChanged =
      Boolean(gitSt?.isRepo) &&
      Boolean(project.gitUrl) &&
      gitUrl.trim() !== '' &&
      project.gitUrl !== gitUrl.trim();
    if (firstClone || urlChanged) {
      setGitConfirmOpen(true);
      return;
    }
    doSync();
  }

  const refsNeedAuth =
    remoteRefs &&
    !remoteRefs.ok &&
    (remoteRefs.code === 'auth' || remoteRefs.code === 'hostkey');

  return (
    <div className="git-ctl">
      <div className="git-ctl__bar">
        <div className="git-ctl__status">
          {gitSt && !gitSt.gitInstalled ? (
            <Badge tone="danger">{t('projects.gitMissing')}</Badge>
          ) : null}
          {gitSt && gitSt.gitInstalled && !gitSt.isRepo ? (
            <Badge tone="warn">{t('projects.gitNotCloned')}</Badge>
          ) : null}
          {gitSt?.isRepo ? (
            <span className="git-ctl__meta">
              <span
                className={`git-ctl__dot ${gitSt.dirty ? 'git-ctl__dot--warn' : 'git-ctl__dot--ok'}`}
              />
              <span>
                {gitSt.branch || project.gitBranch || '—'}
                {' · '}
                <span className="git-ctl__hash">
                  {(gitSt.commit || project.gitCommit || '').slice(0, 8) || '—'}
                </span>
                {gitSt.commitSubject ? ` · ${gitSt.commitSubject}` : ''}
              </span>
              {gitSt.dirty ? (
                <Badge tone="warn">
                  {t('projects.gitDirtyShort', { count: gitSt.dirtyFiles.length })}
                </Badge>
              ) : null}
              {gitSt.behind > 0 ? (
                <Badge tone="info">{t('projects.gitBehindShort', { count: gitSt.behind })}</Badge>
              ) : null}
              {gitSt.ahead > 0 ? (
                <Badge tone="info">{t('projects.gitAheadShort', { count: gitSt.ahead })}</Badge>
              ) : null}
              {gitSt.detached ? <Badge tone="info">{t('projects.gitDetached')}</Badge> : null}
              {gitSt.shallow ? <Badge tone="neutral">{t('projects.gitShallow')}</Badge> : null}
            </span>
          ) : null}
          {gitSt?.auth?.hasToken ? <Badge tone="ok">{t('projects.gitTokenSet')}</Badge> : null}
          {gitSt?.auth?.kind === 'ssh' && gitSt.auth.publicKey ? (
            <Badge tone="ok">{t('projects.gitDeployKeyOn')}</Badge>
          ) : null}
          {gitSt?.auth?.scheme === 'ssh' && gitSt.auth.host && !gitSt.auth.hostPinned ? (
            <Badge tone="warn">{t('projects.gitHostUnpinned')}</Badge>
          ) : null}
        </div>
        <a className="git-ctl__files" href={`/files?root=project:${project.id}&path=app`}>
          {t('projects.gitFilesLink')}
        </a>
      </div>

      {gitSt?.dirty ? (
        <Alert variant="warn">
          <strong>{t('projects.gitDirtyTitle')}</strong>
          <p className="u-mb-0">{t('projects.gitDirtyBody', { count: gitSt.dirtyFiles.length })}</p>
          {gitSt.dirtyFiles.length ? (
            <p className="muted u-text-sm u-mb-0">{gitSt.dirtyFiles.join(', ')}</p>
          ) : null}
          <p className="u-text-sm u-mb-0">{t('projects.gitSyncBlockedDirty')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="u-mt-2"
            loading={gitBusy}
            onClick={() =>
              void runGitOp(async () => {
                const d = await projectsApi.gitDiff(project.id);
                return {
                  ok: d.ok,
                  notes: d.text ? [d.text] : d.notes,
                };
              })
            }
          >
            {t('projects.gitViewDiff')}
          </Button>
        </Alert>
      ) : null}
      {gitSt?.lastError ? <Alert variant="error">{gitSt.lastError.message}</Alert> : null}

      <div className="git-ctl__grid">
        <div>
          <div className="git-ctl__url-row">
            <Field label={t('projects.gitUrl')} htmlFor="giturl" hint={t('projects.deployGitUrlHint')} flush>
              <input
                id="giturl"
                value={gitUrl}
                onChange={bindInput(setGitUrl)}
                onBlur={() => {
                  if (gitUrl.trim() && gitUrl.trim() !== loadedUrl) void loadRefs();
                }}
                placeholder="https://github.com/org/repo.git"
                autoComplete="off"
              />
            </Field>
            <Button
              variant="secondary"
              size="sm"
              loading={refsBusy}
              disabled={!gitUrl.trim()}
              onClick={() => void loadRefs()}
            >
              {t('projects.gitLoadRefs')}
            </Button>
          </div>
        </div>
        <Field label={t('projects.gitBranch')} htmlFor="gitbranch" hint={t('projects.gitRefsHint')} flush>
          <select
            id="gitbranch"
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_REF) {
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              setGitBranch(v);
            }}
          >
            <option value="">{t('projects.gitRefDefault')}</option>
            {branches.length ? (
              <optgroup label={t('projects.gitRefBranches')}>
                {branches.map((h) => (
                  <option key={`b-${h}`} value={h}>
                    {h}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {tags.length ? (
              <optgroup label={t('projects.gitRefTags')}>
                {tags.map((h) => (
                  <option key={`t-${h}`} value={h}>
                    {h}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value={CUSTOM_REF}>{t('projects.gitRefOther')}</option>
          </select>
          {customOpen || (gitBranch && !inList) ? (
            <input
              className="u-mt-2"
              value={gitBranch}
              onChange={bindInput(setGitBranch)}
              placeholder={t('projects.gitRefCustom')}
              aria-label={t('projects.gitRefCustom')}
            />
          ) : null}
        </Field>
      </div>
      {refsNeedAuth ? (
        <p className="muted u-text-sm u-mb-0">{t('projects.gitRefsNeedAuth')}</p>
      ) : null}
      {remoteRefs && !remoteRefs.ok && !refsNeedAuth && remoteRefs.notes[0] ? (
        <p className="muted u-text-sm u-mb-0">{remoteRefs.notes[0]}</p>
      ) : null}

      <SegRadio
        name="git-auth-mode"
        size="sm"
        aria-label={t('projects.gitAuthHttps')}
        value={authMode}
        onChange={(v) => setAuthOverride(v)}
        options={[
          { value: 'https', label: t('projects.gitAuthHttps') },
          { value: 'ssh', label: t('projects.gitAuthSsh') },
        ]}
      />

      {authMode === 'https' ? (
        <div className="git-ctl__url-row">
          <Field label={t('projects.gitToken')} htmlFor="gittoken" hint={t('projects.gitTokenHint')} flush>
            <input
              id="gittoken"
              type="password"
              value={gitToken}
              onChange={bindInput(setGitToken)}
              autoComplete="new-password"
              placeholder={
                gitSt?.auth?.hasToken ? '••••••••' : t('projects.gitTokenPlaceholder')
              }
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            loading={gitBusy}
            disabled={gitToken.trim().length < 8}
            onClick={() => {
              const tok = gitToken.trim();
              setGitToken('');
              void runGitOp(() =>
                projectsApi.gitAuth(project.id, {
                  action: 'set-token',
                  token: tok,
                  gitUrl: gitUrl.trim() || undefined,
                }),
              ).then((r) => {
                if (r.ok) void loadRefs();
              });
            }}
          >
            {t('projects.gitSaveToken')}
          </Button>
          {gitSt?.auth?.hasToken ? (
            <Button
              variant="ghost"
              size="sm"
              loading={gitBusy}
              onClick={() =>
                void runGitOp(() =>
                  projectsApi.gitAuth(project.id, {
                    action: 'clear-token',
                    gitUrl: gitUrl.trim() || undefined,
                  }),
                )
              }
            >
              {t('projects.gitClearToken')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div>
          {gitSt?.auth?.scheme === 'ssh' && gitSt.auth.host && !gitSt.auth.hostPinned ? (
            <Alert variant="warn">
              {t('projects.gitPinHostBody', { host: gitSt.auth.host })}
              {gitSt.auth.hostKeys?.length ? (
                <p className="muted u-text-sm u-mb-0">
                  {gitSt.auth.hostKeys.map((k) => k.fingerprint).join(' · ')}
                </p>
              ) : null}
            </Alert>
          ) : null}
          {gitSt?.auth?.publicKey ? (
            <p className="git-ctl__pubkey muted u-mb-2">
              {showFullKey
                ? gitSt.auth.publicKey
                : `${gitSt.auth.publicKey.slice(0, 40)}…`}
            </p>
          ) : null}
          <div className="git-ctl__toolbar">
            <Button
              variant="secondary"
              size="sm"
              loading={gitBusy}
              onClick={() =>
                void runGitOp(() =>
                  projectsApi.gitAuth(project.id, {
                    action: 'make-deploy-key',
                    gitUrl: gitUrl.trim() || undefined,
                  }),
                )
              }
            >
              {t('projects.gitMakeKey')}
            </Button>
            {gitSt?.auth?.publicKey ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(gitSt.auth?.publicKey ?? '');
                    onOpsMessage?.(t('projects.gitKeyCopied'));
                  }}
                >
                  {t('projects.gitCopyPub')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowFullKey((v) => !v)}>
                  {showFullKey ? t('projects.gitHideKey') : t('projects.gitShowKey')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={gitBusy}
                  onClick={() =>
                    void runGitOp(() =>
                      projectsApi.gitAuth(project.id, {
                        action: 'clear-deploy-key',
                        gitUrl: gitUrl.trim() || undefined,
                      }),
                    )
                  }
                >
                  {t('projects.gitClearKey')}
                </Button>
              </>
            ) : null}
            {gitSt?.auth?.host && !gitSt.auth.hostPinned ? (
              <Button
                variant="secondary"
                size="sm"
                loading={gitBusy}
                onClick={() =>
                  void runGitOp(() =>
                    projectsApi.gitAuth(project.id, {
                      action: 'pin-host',
                      gitUrl: gitUrl.trim() || undefined,
                    }),
                  ).then((r) => {
                    if (r.ok) void loadRefs();
                  })
                }
              >
                {t('projects.gitPinHost')}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div className="git-ctl__toolbar">
        <Button
          variant="primary"
          size="md"
          loading={busy || gitBusy}
          disabled={!gitUrl.trim() || gitSt?.dirty}
          title={gitSt?.dirty ? t('projects.gitSyncBlockedDirty') : undefined}
          onClick={onSyncClick}
        >
          {t('projects.gitSync')}
        </Button>
        <Button
          variant="secondary"
          size="md"
          loading={gitBusy}
          disabled={!gitSt?.isRepo}
          onClick={() => void runGitOp(() => projectsApi.gitFetch(project.id))}
        >
          {t('projects.gitFetch')}
        </Button>
        <Button
          variant="secondary"
          size="md"
          loading={gitBusy}
          disabled={!gitSt?.isRepo || !gitBranch.trim() || gitSt?.dirty}
          onClick={() =>
            void runGitOp(() => projectsApi.gitCheckout(project.id, { ref: gitBranch.trim() }))
          }
        >
          {t('projects.gitCheckout')}
        </Button>
        <div className="git-ctl__toolbar-right">
          {gitSt?.shallow ? (
            <Button
              variant="ghost"
              size="sm"
              loading={gitBusy}
              onClick={() =>
                void runGitOp(() => projectsApi.gitFetch(project.id, { unshallow: true }))
              }
            >
              {t('projects.gitDeepen')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            loading={gitBusy}
            disabled={!gitSt?.isRepo}
            onClick={() => setGitResetOpen(true)}
          >
            {t('projects.gitReset')}
          </Button>
        </div>
      </div>

      <div className="git-ctl__hook">
        <div className="git-ctl__hook-row">
          <strong>{t('projects.gitHookTitle')}</strong>
          {gitSt?.hook?.enabled ? (
            <Badge tone="ok">{t('projects.gitHookOn')}</Badge>
          ) : (
            <Badge tone="neutral">{t('projects.gitHookOff')}</Badge>
          )}
          <code className="inline git-ctl__url">{hookUrl}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(hookUrl);
              onOpsMessage?.(t('projects.gitHookCopied'));
            }}
          >
            {t('projects.gitHookCopyUrl')}
          </Button>
          {!gitSt?.hook?.enabled ? (
            <Button
              variant="secondary"
              size="sm"
              loading={gitBusy}
              onClick={() =>
                void runGitOp(async () => {
                  const r = await projectsApi.gitHook(project.id, { action: 'enable' });
                  if (r.hookSecret) setGitHookSecret(r.hookSecret);
                  return r;
                })
              }
            >
              {t('projects.gitHookEnable')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              loading={gitBusy}
              onClick={() =>
                void runGitOp(async () => {
                  setGitHookSecret(null);
                  return projectsApi.gitHook(project.id, { action: 'disable' });
                })
              }
            >
              {t('projects.gitHookDisable')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={gitBusy}
            disabled={!gitSt?.hook?.hasSecret}
            onClick={() =>
              void runGitOp(async () => {
                const r = await projectsApi.gitHook(project.id, { action: 'rotate' });
                if (r.hookSecret) setGitHookSecret(r.hookSecret);
                return r;
              })
            }
          >
            {t('projects.gitHookRotate')}
          </Button>
        </div>
        {gitHookSecret ? (
          <div className="git-ctl__secret">
            <Alert variant="warn">
              {t('projects.gitHookSecretOnce')} <code className="inline u-text-sm">{gitHookSecret}</code>
            </Alert>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(gitHookSecret);
                onOpsMessage?.(t('projects.gitHookCopied'));
              }}
            >
              {t('projects.gitHookCopySecret')}
            </Button>
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm u-mt-2"
          onClick={() => setHookHelpOpen((v) => !v)}
        >
          {t('projects.gitHookSetupToggle')}
        </button>
        {hookHelpOpen ? (
          <div className="git-ctl__help">
            <SegRadio
              name="git-hook-plat"
              size="sm"
              value={hookPlat}
              onChange={setHookPlat}
              options={[
                { value: 'github', label: 'GitHub' },
                { value: 'gitea', label: 'Gitea' },
                { value: 'gitlab', label: 'GitLab' },
              ]}
            />
            <div className="git-ctl__help-body">
              <p>{t('projects.gitHookHint')}</p>
              <p>
                {hookPlat === 'github'
                  ? t('projects.gitHookGithub')
                  : hookPlat === 'gitea'
                    ? t('projects.gitHookGitea')
                    : t('projects.gitHookGitlab')}
              </p>
              <p>{t('projects.gitHookOneLiner')}</p>
              <p>{t('projects.gitHookSkipOther')}</p>
              <p>{t('projects.gitHookExecuteHint')}</p>
            </div>
          </div>
        ) : null}
      </div>

      {gitLog.length ? (
        <div>
          <p className="muted u-text-sm u-mb-1">{t('projects.gitLogTitle')}</p>
          <ul className="git-ctl__log">
            {gitLog.map((c) => (
              <li key={c.hash}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={gitBusy || gitSt?.dirty}
                  onClick={() => {
                    setGitBranch(c.hash);
                    setCustomOpen(true);
                    void runGitOp(() => projectsApi.gitCheckout(project.id, { ref: c.hash }));
                  }}
                >
                  <code className="inline u-text-sm">{(c.hash ?? '').slice(0, 8)}</code>
                </button>
                <span className="git-ctl__subj">{c.subject}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={gitConfirmOpen}
        onClose={() => setGitConfirmOpen(false)}
        title={t('projects.gitConfirmTitle')}
        description={
          project.gitCommit &&
          project.gitUrl &&
          gitUrl.trim() &&
          project.gitUrl !== gitUrl.trim()
            ? t('projects.gitConfirmRemoteBody')
            : t('projects.gitConfirmBody')
        }
        confirmLabel={t('projects.gitDeploy')}
        onConfirm={() => {
          setGitConfirmOpen(false);
          doSync();
        }}
      />
      <ConfirmDialog
        open={gitResetOpen}
        onClose={() => setGitResetOpen(false)}
        title={t('projects.gitResetConfirmTitle')}
        description={t('projects.gitResetConfirmBody')}
        confirmLabel={t('projects.gitReset')}
        danger
        onConfirm={() => {
          setGitResetOpen(false);
          void runGitOp(() =>
            projectsApi.gitReset(project.id, {
              ref: gitBranch.trim() || undefined,
            }),
          );
        }}
      />
    </div>
  );
}
