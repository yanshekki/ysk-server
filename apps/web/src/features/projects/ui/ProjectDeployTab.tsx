/**
 * Deploy tab — runtime-aware cards (Deploy · Git · Env).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../../shared/lib/i18n';
import type { ProjectDto } from '@ysk/shared';
import {
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  PresetChips,
  SegRadio,

  buttonClassName,} from '../../../shared/components/ui';
import { formatRuntimeName, getProjectUiProfile } from '../model/runtime-ui';
import {
  defaultRuntimeInstallVersion,
  loadDeployPrefs,
  runtimeInstallKind,
  runtimePagePath,
  runtimeVersionChoices,
  saveDeployPrefs,
} from '../model/deploy-prefs';
import { projectsApi } from '../api';
import { systemApi } from '../../system/api';

export interface ProjectDeployTabProps {
  project: ProjectDto;
  busy?: boolean;
  gitUrl: string;
  setGitUrl: (v: string) => void;
  envText: string;
  setEnvText: (v: string) => void;
  onDeploy: (opts?: { entry?: string; skipBuild?: boolean }) => void | Promise<unknown>;
  onGitDeploy: (opts?: { entry?: string; skipBuild?: boolean }) => void;
  onSaveEnv: () => void;
  onPhpVersionChange?: (v: string) => void;
  /** After process runtime version PATCH */
  onRuntimeVersionSaved?: (v: string) => void;
  onOpsMessage?: (msg: string) => void;
  /** Show first-run checklist after create */
  showFreshChecklist?: boolean;
  onDismissChecklist?: () => void;
}

function processDeployHint(runtime: string): string {
  if (runtime === 'python') {
    return i18n.t('projects.deployPyHint');
  }
  if (runtime === 'go') {
    return i18n.t('projects.deployGoHint');
  }
  if (runtime === 'rust') {
    return i18n.t('projects.deployRustHint');
  }
  if (runtime === 'node') {
    return i18n.t('projects.deployNodeHint');
  }
  return i18n.t('projects.deployDefaultHint');
}

function defaultEntryHint(runtime: string): string {
  if (runtime === 'python') return 'main:app · app.py · mysite.wsgi:application';
  if (runtime === 'go') return './app';
  if (runtime === 'rust') return './target/release/<crate>';
  if (runtime === 'node') return 'server.js';
  return '';
}

function envPlaceholder(runtime: string, deployIsPhp: boolean): string {
  if (deployIsPhp) return 'APP_ENV=production\n# KEY=value';
  if (runtime === 'python') return 'APP_ENV=production\n# DATABASE_URL=\n';
  if (runtime === 'go' || runtime === 'rust') return 'APP_ENV=production\n# KEY=value\n';
  return 'NODE_ENV=production\n# KEY=value';
}

function checklistItems(runtime: string): string[] {
  const osFirst = i18n.t('projects.deployOsStep');
  if (runtime === 'python') {
    return [
      osFirst,
      i18n.t('projects.deployPyReady'),
      i18n.t('projects.deployPipNet'),
      i18n.t('projects.deployCheckPort'),
      i18n.t('projects.deployPublishProxy'),
    ];
  }
  if (runtime === 'go' || runtime === 'rust') {
    return [
      osFirst,
      i18n.t('projects.deployToolchainReady', { runtime: runtime === 'go' ? 'Go' : 'Rust' }),
      i18n.t('projects.deployFirstBuild'),
      i18n.t('projects.deployNeedBinary'),
      i18n.t('projects.deployPublishProxy'),
    ];
  }
  if (runtime === 'php') {
    return [osFirst, i18n.t('projects.deployPhpFpmOk'), i18n.t('projects.deployPhpPool'), i18n.t('projects.deployNginxSsl')];
  }
  if (runtime === 'static') {
    return [osFirst, i18n.t('projects.deployPublicContent'), i18n.t('projects.deployNetPublish')];
  }
  return [
    osFirst,
    i18n.t('projects.deployConfirmToolchain'),
    i18n.t('projects.deployConfirmCode'),
    i18n.t('projects.deployPressDeploy'),
  ];
}

export function ProjectDeployTab({
  project,
  busy,
  gitUrl,
  setGitUrl,
  envText,
  setEnvText,
  onDeploy,
  onGitDeploy,
  onSaveEnv,
  onPhpVersionChange,
  onRuntimeVersionSaved,
  onOpsMessage,
  showFreshChecklist,
  onDismissChecklist,
}: ProjectDeployTabProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);
  const [phpVer, setPhpVer] = useState(project.runtimeVersion ?? '8.2');
  const [rtVer, setRtVer] = useState(
    project.runtimeVersion || defaultRuntimeInstallVersion(project.runtime) || '',
  );
  const [phpBusy, setPhpBusy] = useState(false);
  const [phpIniBusy, setPhpIniBusy] = useState(false);
  const [phpIniMem, setPhpIniMem] = useState('');
  const [phpIniExec, setPhpIniExec] = useState('');
  const [phpIniUpload, setPhpIniUpload] = useState('');
  const [phpIniDisplay, setPhpIniDisplay] = useState<boolean | null>(null);
  const [verBusy, setVerBusy] = useState(false);
  const [chainBusy, setChainBusy] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      actor: string;
      action: string;
      ok: boolean;
      created_at: string;
      detail: unknown;
    }>
  >([]);
  const prefs = useMemo(() => loadDeployPrefs(project.id), [project.id]);
  // Prefer server-side deployEntry, then localStorage
  const [entry, setEntry] = useState(
    () => project.deployEntry || prefs.entry || '',
  );
  const [skipBuild, setSkipBuild] = useState(Boolean(prefs.skipBuild));
  const runtimeLabel = formatRuntimeName(project.runtime, t);
  const processRuntime =
    project.runtime === 'node' ||
    project.runtime === 'python' ||
    project.runtime === 'go' ||
    project.runtime === 'rust';
  const rtKind = runtimeInstallKind(project.runtime);
  const rtPath = runtimePagePath(project.runtime);

  const steps = useMemo(() => checklistItems(project.runtime), [project.runtime]);

  useEffect(() => {
    const p = loadDeployPrefs(project.id);
    setEntry(project.deployEntry || p.entry || '');
    setSkipBuild(Boolean(p.skipBuild));
  }, [project.id, project.deployEntry]);

  useEffect(() => {
    setPhpVer(project.runtimeVersion ?? '8.2');
    setRtVer(
      project.runtimeVersion || defaultRuntimeInstallVersion(project.runtime) || '',
    );
  }, [project.id, project.runtimeVersion, project.runtime]);

  useEffect(() => {
    if (project.runtime !== 'php') return;
    void projectsApi
      .phpIniGet(project.id, project.runtimeVersion ?? '8.2')
      .then((r) => {
        const v = r.project?.values ?? {};
        setPhpIniMem(v.memory_limit != null ? String(v.memory_limit) : '');
        setPhpIniExec(v.max_execution_time != null ? String(v.max_execution_time) : '');
        setPhpIniUpload(v.upload_max_filesize != null ? String(v.upload_max_filesize) : '');
        if (v.display_errors === true || v.display_errors === 1 || v.display_errors === '1') {
          setPhpIniDisplay(true);
        } else if (
          v.display_errors === false ||
          v.display_errors === 0 ||
          v.display_errors === '0'
        ) {
          setPhpIniDisplay(false);
        } else {
          setPhpIniDisplay(null);
        }
      })
      .catch(() => {
        /* optional */
      });
  }, [project.id, project.runtime, project.runtimeVersion]);

  useEffect(() => {
    void projectsApi
      .deployHistory(project.id, 12)
      .then((r) => setHistory(r.items ?? []))
      .catch(() => setHistory([]));
  }, [project.id, project.lastDeployAt]);

  function persist(next?: { entry?: string; skipBuild?: boolean }) {
    const e = next?.entry ?? entry;
    const s = next?.skipBuild ?? skipBuild;
    saveDeployPrefs(project.id, { entry: e, skipBuild: s });
    // Best-effort server sync (cross-device)
    if (e !== (project.deployEntry ?? '')) {
      void projectsApi.setDeployEntry(project.id, e.trim() || null).catch(() => undefined);
    }
  }

  function deployOpts() {
    return {
      entry: entry.trim() || undefined,
      skipBuild:
        processRuntime && project.runtime !== 'node' ? skipBuild : undefined,
    };
  }

  async function saveRuntimeVersion(next: string) {
    setRtVer(next);
    setVerBusy(true);
    try {
      await projectsApi.setRuntimeVersion(project.id, next);
      onRuntimeVersionSaved?.(next);
      onOpsMessage?.(t('projects.deployVersionSaved', { runtime: runtimeLabel, version: next }));
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('projects.deployVersionSaveFailed'));
    } finally {
      setVerBusy(false);
    }
  }

  async function installToolchainThenDeploy() {
    if (!rtKind) {
      onDeploy(deployOpts());
      return;
    }
    setChainBusy(true);
    onOpsMessage?.(t('projects.deployInstallingToolchain'));
    try {
      const version =
        rtVer ||
        project.runtimeVersion ||
        defaultRuntimeInstallVersion(project.runtime);
      if (rtVer && rtVer !== project.runtimeVersion) {
        await projectsApi.setRuntimeVersion(project.id, rtVer).catch(() => undefined);
      }
      const r = (await systemApi.runtimeInstall({
        kind: rtKind,
        version,
        install: true,
      })) as { ok?: boolean; notes?: string[]; blocked?: boolean; blockMessage?: string };
      const notes = r.notes?.join('；') ?? '';
      if (r.blocked || r.ok === false) {
        onOpsMessage?.(
          r.blockMessage ??
            (notes || t('projects.deployToolchainIncomplete')),
        );
        // Still attempt deploy — host may already have toolchain
      } else {
        onOpsMessage?.(notes || t('projects.deployToolchainDone'));
      }
      persist();
      await onDeploy(deployOpts());
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('projects.deployToolchainFailed'));
    } finally {
      setChainBusy(false);
    }
  }

  const anyBusy = Boolean(busy || phpBusy || chainBusy || verBusy);
  const versionChoices = runtimeVersionChoices(project.runtime);

  return (
    <div className="tab-panel">
      {showFreshChecklist ? (
        <Card>
          <CardSection
            title={t('projects.deployChecklistTitle')}
            description={t('projects.deployChecklistDesc', { runtime: runtimeLabel })}
          >
            <ol className="u-mt-0 u-pl-5 u-mb-0">
              {steps.map((s) => (
                <li key={s} className="u-mb-2">
                  {s}
                </li>
              ))}
            </ol>
            <FormHint>
              {t('projects.toolchainNote')}
            </FormHint>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={anyBusy}
                onClick={() => {
                  persist();
                  void installToolchainThenDeploy();
                }}
              >
                {t('projects.installToolchainDeploy')}
              </Button>
              <Button
                variant="secondary"
                size="md"
                loading={anyBusy}
                onClick={() => {
                  persist();
                  onDeploy(deployOpts());
                }}
              >
                {t('projects.deployOnly')}
              </Button>
              {rtPath ? (
                <Link to={rtPath} className={buttonClassName({ variant: 'ghost', size: 'md' })}>
                  {t('projects.openRuntime', { runtime: runtimeLabel })}
                </Link>
              ) : null}
              <Button variant="ghost" size="md" onClick={onDismissChecklist}>
                {t('projects.later')}
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      {ui.showDeploy ? (
        <Card>
          <CardSection
            title={
              ui.deployIsPhp ? t('projects.sectionPhpDeploy') : t('projects.deploySectionTitle', { runtime: runtimeLabel })
            }
            description={
              ui.deployIsPhp
                ? t('projects.sectionPhpDeployDesc')
                : t('projects.deploySectionDesc', { runtime: runtimeLabel })
            }
          >
            <FormLayout columns={2}>
              {ui.deployIsPhp ? (
                <Field
                  label={t('runtime.phpVersion')}
                  htmlFor="php-ver"
                  hint={t('projects.deployPhpVersionHint')}
                  flush
                >
                  {versionChoices.length <= 8 ? (
                    <SegRadio
                      name="php-ver"
                      aria-label={t('runtime.phpVersion')}
                      value={phpVer}
                      onChange={(v) => {
                        setPhpVer(v);
                        onPhpVersionChange?.(v);
                      }}
                      options={versionChoices.map((v) => ({ value: v, label: v }))}
                    />
                  ) : (
                    <select
                      id="php-ver"
                      value={phpVer}
                      onChange={(e) => {
                        setPhpVer(e.target.value);
                        onPhpVersionChange?.(e.target.value);
                      }}
                    >
                      {versionChoices.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : versionChoices.length > 0 ? (
                <Field
                  label={t('projects.deployRuntimeVersion', { runtime: runtimeLabel })}
                  htmlFor="rt-ver"
                  hint={
                    rtPath
                      ? t('projects.deployRuntimeVersionHint')
                      : t('projects.deployRuntimeVersionCreateHint')
                  }
                  flush
                >
                  {versionChoices.length <= 8 ? (
                    <SegRadio
                      name="rt-ver"
                      aria-label={t('projects.deployRuntimeVersion', { runtime: runtimeLabel })}
                      value={rtVer}
                      onChange={(v) => {
                        if (!(verBusy || anyBusy)) void saveRuntimeVersion(v);
                      }}
                      options={versionChoices.map((v) => ({ value: v, label: v }))}
                    />
                  ) : (
                    <select
                      id="rt-ver"
                      value={rtVer}
                      disabled={verBusy || anyBusy}
                      onChange={(e) => {
                        void saveRuntimeVersion(e.target.value);
                      }}
                    >
                      {versionChoices.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : (
                <Field label={t('projects.deployRuntimeVersionGeneric')} htmlFor="rt-ver-ro" flush>
                  <input
                    id="rt-ver-ro"
                    value={project.runtimeVersion || '—'}
                    readOnly
                    disabled
                  />
                </Field>
              )}
              {processRuntime ? (
                <Field
                  label={t('projects.deployEntry')}
                  htmlFor="deploy-entry"
                  hint={t('projects.deployEntryHint', { hint: defaultEntryHint(project.runtime) })}
                  flush
                >
                  <input
                    id="deploy-entry"
                    value={entry}
                    onChange={(e) => {
                      setEntry(e.target.value);
                      saveDeployPrefs(project.id, {
                        entry: e.target.value,
                        skipBuild,
                      });
                    }}
                    onBlur={() => persist()}
                    placeholder={defaultEntryHint(project.runtime)}
                    spellCheck={false}
                  />
                </Field>
              ) : null}
            </FormLayout>
            {processRuntime &&
            (project.runtime === 'python' ||
              project.runtime === 'go' ||
              project.runtime === 'rust') ? (
              <div className="form-check-row u-mt-3">
                <CheckboxField
                  id="skip-build"
                  label={t('projects.deploySkipBuild')}
                  description={t('projects.deploySkipBuildHint')}
                  checked={skipBuild}
                  onChange={(v) => {
                    setSkipBuild(v);
                    saveDeployPrefs(project.id, { entry, skipBuild: v });
                  }}
                />
              </div>
            ) : null}
            <FormHint>{processDeployHint(project.runtime)}</FormHint>
            {project.lastDeployAt || (project.lastDeployNotes && project.lastDeployNotes.length) ? (
              <div
                className="u-mt-3 u-mb-2 u-callout"
              >
                <p className="u-mb-1 u-mt-0">
                  <strong>{t('projects.lastDeploy')}</strong>
                  {project.lastDeployAt
                    ? ` · ${new Date(project.lastDeployAt).toLocaleString()}`
                    : ''}
                  {project.port != null ? t('projects.deployPort', { port: project.port }) : ''}
                  {project.processStatus ? ` · ${project.processStatus}` : ''}
                </p>
                {project.deployEntry ? (
                  <p className="muted u-text-sm u-mb-1 u-mt-0">
                    entry：<code className="inline">{project.deployEntry}</code>
                  </p>
                ) : null}
                {project.lastDeployNotes?.length ? (
                  <ul className="u-mb-0 u-mt-1 u-pl-5">
                    {project.lastDeployNotes.slice(0, 5).map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={anyBusy}
                onClick={() => {
                  persist();
                  onDeploy(deployOpts());
                }}
              >
                {ui.deployIsPhp ? t('projects.deployPhp') : t('projects.deploy')}
              </Button>
              {rtKind && !ui.deployIsPhp ? (
                <Button
                  variant="secondary"
                  size="md"
                  loading={anyBusy}
                  onClick={() => void installToolchainThenDeploy()}
                >
                  {t('projects.installToolchainDeployShort')}
                </Button>
              ) : null}
              {rtPath ? (
                <Link to={rtPath} className={buttonClassName({ variant: 'ghost', size: 'md' })}>
                  {t('projects.runtimeEnv', { runtime: runtimeLabel })}
                </Link>
              ) : null}
              {ui.deployIsPhp ? (
                <Button
                  variant="secondary"
                  size="md"
                  loading={phpBusy || busy}
                  onClick={() => {
                    setPhpBusy(true);
                    void projectsApi
                      .applyPhpFpm(project.id, { phpVersion: phpVer, enable: true })
                      .then((r) => {
                        const notes = (r as { notes?: string[] }).notes;
                        onOpsMessage?.(
                          notes?.join('；') ??
                            ((r as { ok?: boolean }).ok ? t('projects.deployFpmApplied') : t('projects.deployFpmIncomplete')),
                        );
                      })
                      .catch((e: Error) => onOpsMessage?.(e.message))
                      .finally(() => setPhpBusy(false));
                  }}
                >
                  {t('projects.applyFpmPool')}
                </Button>
              ) : null}
            </FormActions>
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              {ui.deployIsPhp
                ? t('projects.deployFpmNote')
                : t('projects.deployBuildNote')}
            </p>
          </CardSection>
        </Card>
      ) : (
        <Card>
          <CardSection
            title={t('projects.sectionStaticDeploy')}
            description={t('projects.sectionStaticDeployDesc')}
          >
            <p className="muted">{t('projects.staticDeployHint')}</p>
            <p className="muted u-text-sm u-mt-2">
              {t('projects.staticNginxHint')}
            </p>
          </CardSection>
        </Card>
      )}

      {ui.deployIsPhp ? (
        <Card>
          <CardSection
            title={t('projects.deployPhpIniTitle')}
            description={t('projects.deployPhpIniDesc')}
          >
            <FormLayout columns={2}>
              <Field label="memory_limit" htmlFor="pini-mem" flush hint={t('projects.deployPhpIniExample')}>
                <PresetChips
                  options={[
                    { value: '', label: t('projects.deployGlobal') },
                    { value: '128M', label: '128M' },
                    { value: '256M', label: '256M' },
                    { value: '512M', label: '512M' },
                    { value: '1G', label: '1G' },
                  ]}
                  value={phpIniMem}
                  onChange={setPhpIniMem}
                  allowCustom
                  customPlaceholder={t('common.custom')}
                />
              </Field>
              <Field label="max_execution_time" htmlFor="pini-exec" flush>
                <PresetChips
                  options={[
                    { value: '', label: t('projects.deployGlobal') },
                    { value: '30', label: '30' },
                    { value: '60', label: '60' },
                    { value: '120', label: '120' },
                    { value: '300', label: '300' },
                  ]}
                  value={phpIniExec}
                  onChange={setPhpIniExec}
                  allowCustom
                  customPlaceholder={t('common.custom')}
                />
              </Field>
              <Field label="upload_max_filesize" htmlFor="pini-up" flush>
                <PresetChips
                  options={[
                    { value: '', label: t('projects.deployGlobal') },
                    { value: '32M', label: '32M' },
                    { value: '64M', label: '64M' },
                    { value: '128M', label: '128M' },
                    { value: '256M', label: '256M' },
                  ]}
                  value={phpIniUpload}
                  onChange={setPhpIniUpload}
                  allowCustom
                  customPlaceholder={t('common.custom')}
                />
              </Field>
              <Field label="display_errors" htmlFor="pini-disp" flush>
                <SegRadio
                  name="pini-disp"
                  aria-label="display_errors"
                  value={phpIniDisplay === null ? '' : phpIniDisplay ? '1' : '0'}
                  onChange={(v) => setPhpIniDisplay(v === '' ? null : v === '1')}
                  options={[
                    { value: '', label: t('projects.deployGlobal') },
                    { value: '0', label: t('common.off') },
                    { value: '1', label: t('projects.deployOnCareful') },
                  ]}
                />
              </Field>
            </FormLayout>
            <FormHint>
              {t('projects.fullIniLink')}{' '}
              <Link to="/runtimes/php?tab=ini">{t('projects.phpIniLink')}</Link>。
            </FormHint>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={phpIniBusy}
                onClick={() => {
                  setPhpIniBusy(true);
                  const values: Record<string, string | number | boolean> = {};
                  if (phpIniMem.trim()) values.memory_limit = phpIniMem.trim();
                  if (phpIniExec.trim()) {
                    const n = Number(phpIniExec);
                    values.max_execution_time = Number.isFinite(n) ? n : phpIniExec.trim();
                  }
                  if (phpIniUpload.trim()) values.upload_max_filesize = phpIniUpload.trim();
                  if (phpIniDisplay !== null) values.display_errors = phpIniDisplay;
                  void projectsApi
                    .phpIniSave(project.id, { version: phpVer, values })
                    .then(() => onOpsMessage?.(t('projects.deployPhpIniSaved')))
                    .catch((e: Error) => onOpsMessage?.(e.message))
                    .finally(() => setPhpIniBusy(false));
                }}
              >
                {t('projects.savePhpIniOverride')}
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <CardSection
            title={t('projects.deployHistory', { count: history.length })}
            description={t('projects.deployHistoryDesc')}
          >
            <ul className="list-plain list-spaced u-mb-0">
              {history.map((h) => {
                const detail = h.detail as {
                  port?: number;
                  entry?: string;
                  processStatus?: string;
                  runtime?: string;
                } | null;
                return (
                  <li key={h.id} className="u-justify-between u-flex-wrap">
                    <span>
                      <Badge tone={h.ok ? 'ok' : 'danger'}>{h.ok ? t('common.success') : t('common.failed')}</Badge>{' '}
                      <code className="inline u-text-sm">{h.action.replace(/^project\./, '')}</code>
                      {detail?.entry ? (
                        <span className="muted u-text-sm"> · {detail.entry}</span>
                      ) : null}
                      {detail?.port != null ? (
                        <span className="muted u-text-sm"> · :{detail.port}</span>
                      ) : null}
                    </span>
                    <span className="muted u-text-sm u-nowrap">
                      {new Date(h.created_at).toLocaleString()} · {h.actor}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardSection>
        </Card>
      ) : null}

      {ui.showGit ? (
        <Card>
          <CardSection title={t('projects.sectionGit')} description={t('projects.sectionGitDesc')}>
            <FormLayout>
              <Field
                label={t('projects.gitUrl')}
                htmlFor="giturl"
                hint={t('projects.deployGitUrlHint')}
                flush
              >
                <input
                  id="giturl"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                />
              </Field>
            </FormLayout>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() => {
                  persist();
                  onGitDeploy(deployOpts());
                }}
              >
                {t('projects.gitDeploy')}
              </Button>
            </FormActions>
            <FormHint>
              {t('projects.scaffoldNote')}
            </FormHint>
          </CardSection>
        </Card>
      ) : null}

      {ui.showEnv ? (
        <Card>
          <CardSection title={t('projects.sectionEnv')} description={t('projects.sectionEnvDesc')}>
            <FormLayout>
              <Field
                label={t('projects.envFile')}
                htmlFor="penv"
                hint={t('projects.deployEnvHint')}
                flush
              >
                <textarea
                  id="penv"
                  rows={8}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={envPlaceholder(project.runtime, ui.deployIsPhp)}
                />
              </Field>
            </FormLayout>
            <FormActions>
              <Button variant="primary" size="md" loading={busy} onClick={onSaveEnv}>
                {t('projects.saveEnv')}
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}
    </div>
  );
}
