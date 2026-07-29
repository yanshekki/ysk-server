/**
 * Deploy tab — runtime-aware cards (Deploy · Git · Env).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
} from '../../../shared/components/ui';
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
    return '預設：venv + pip；ASGI 用 uvicorn（main:app）、Django WSGI 用 gunicorn（pkg.wsgi:application）、腳本則 python app.py。';
  }
  if (runtime === 'go') {
    return '預設：go build -o app . 後啟動 ./app；可略過建置若二進位已存在。';
  }
  if (runtime === 'rust') {
    return '預設：cargo build --release 後啟動 target/release/{crate}；可略過建置。';
  }
  if (runtime === 'node') {
    return '依 Node 啟動行程（entry 預設 server.js）；生產環境建議 systemd。';
  }
  return '依 runtime 啟動；套用後才對外。';
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
  const osFirst = '獨立 Linux 用戶 + /home/ysk-server-{專案 id}（資源分頁可建立）';
  if (runtime === 'python') {
    return [
      osFirst,
      'Python 執行環境已就緒',
      '有 requirements.txt 時需外網 pip',
      '部署後檢查埠與 /health',
      '發布 Nginx 反代',
    ];
  }
  if (runtime === 'go' || runtime === 'rust') {
    return [
      osFirst,
      `${runtime === 'go' ? 'Go' : 'Rust'} toolchain 已就緒`,
      '首次部署會 build（可能較久）',
      'build 成功後才有可執行檔',
      '發布 Nginx 反代',
    ];
  }
  if (runtime === 'php') {
    return [osFirst, 'PHP-FPM 版本正確', '部署 PHP／套用 pool', '發布 Nginx + 可選 SSL'];
  }
  if (runtime === 'static') {
    return [osFirst, '確認 public/ 有內容', '到「網絡」發布 Nginx'];
  }
  return [
    osFirst,
    '確認執行環境頁已安裝對應 toolchain（或主機已有）',
    '確認 app/ 內有程式碼（範本或 Git）',
    '按「部署」啟動；成功後到「網絡」發布 Nginx',
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
  const runtimeLabel = formatRuntimeName(project.runtime);
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
      onOpsMessage?.(`已儲存 ${runtimeLabel} 版本 ${next}（部署時會用此版本）`);
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : '儲存 runtime 版本失敗');
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
    onOpsMessage?.('正在安裝／確認 toolchain…');
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
            (notes || 'Toolchain 安裝未完成（權限或網路）；可改手動到執行環境頁'),
        );
        // Still attempt deploy — host may already have toolchain
      } else {
        onOpsMessage?.(notes || 'Toolchain 步驟完成，開始部署…');
      }
      persist();
      await onDeploy(deployOpts());
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : '安裝 toolchain 失敗');
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
            title="建立完成 — 部署檢查清單"
            description={`${runtimeLabel} 專案骨架已就緒；完成下列步驟才會對外服務`}
          >
            <ol className="u-mt-0" style={{ paddingLeft: '1.25rem', marginBottom: 0 }}>
              {steps.map((s) => (
                <li key={s} className="u-mb-2">
                  {s}
                </li>
              ))}
            </ol>
            <FormHint>
              安裝 toolchain ≠ 專案已上線；部署成功 ≠ Nginx 已對外（需在「網絡」發布）。
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
                安裝 toolchain 並部署
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
                僅部署
              </Button>
              {rtPath ? (
                <Link to={rtPath} className="btn btn--ghost btn--md">
                  開啟 {runtimeLabel} 執行環境
                </Link>
              ) : null}
              <Button variant="ghost" size="md" onClick={onDismissChecklist}>
                稍後再說
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      {ui.showDeploy ? (
        <Card>
          <CardSection
            title={
              ui.deployIsPhp ? t('projects.sectionPhpDeploy') : `${runtimeLabel} 部署`
            }
            description={
              ui.deployIsPhp
                ? t('projects.sectionPhpDeployDesc')
                : `依 ${runtimeLabel} 啟動行程（埠／systemd 或 pidfile）`
            }
          >
            <FormLayout columns={2}>
              {ui.deployIsPhp ? (
                <Field
                  label="PHP 版本"
                  htmlFor="php-ver"
                  hint="本站使用的 PHP 版本（需主機已安裝對應 FPM）"
                  flush
                >
                  {versionChoices.length <= 8 ? (
                    <SegRadio
                      name="php-ver"
                      aria-label="PHP 版本"
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
                  label={`${runtimeLabel} 版本`}
                  htmlFor="rt-ver"
                  hint={
                    rtPath
                      ? '寫入專案後部署會用此版本；安裝請到執行環境頁'
                      : '建立時寫入；部署時參考'
                  }
                  flush
                >
                  {versionChoices.length <= 8 ? (
                    <SegRadio
                      name="rt-ver"
                      aria-label={`${runtimeLabel} 版本`}
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
                <Field label="Runtime 版本" htmlFor="rt-ver-ro" flush>
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
                  label="啟動 entry"
                  htmlFor="deploy-entry"
                  hint={`可留空用預設（${defaultEntryHint(project.runtime)}）；會同步到伺服器`}
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
                  label="略過建置"
                  description="已有 venv／二進位時可勾選，加快重啟（會記住本機偏好）"
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
                className="u-mt-3 u-mb-2"
                style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-subtle, #f6f8fa)',
                  borderRadius: 8,
                }}
              >
                <p className="u-mb-1 u-mt-0">
                  <strong>上次部署</strong>
                  {project.lastDeployAt
                    ? ` · ${new Date(project.lastDeployAt).toLocaleString()}`
                    : ''}
                  {project.port != null ? ` · 埠 ${project.port}` : ''}
                  {project.processStatus ? ` · ${project.processStatus}` : ''}
                </p>
                {project.deployEntry ? (
                  <p className="muted u-text-sm u-mb-1 u-mt-0">
                    entry：<code className="inline">{project.deployEntry}</code>
                  </p>
                ) : null}
                {project.lastDeployNotes?.length ? (
                  <ul className="u-mb-0 u-mt-1" style={{ paddingLeft: '1.1rem' }}>
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
                  裝 toolchain 並部署
                </Button>
              ) : null}
              {rtPath ? (
                <Link to={rtPath} className="btn btn--ghost btn--md">
                  {runtimeLabel} 環境
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
                            ((r as { ok?: boolean }).ok ? '已套用 PHP-FPM pool' : 'FPM 未完成'),
                        );
                      })
                      .catch((e: Error) => onOpsMessage?.(e.message))
                      .finally(() => setPhpBusy(false));
                  }}
                >
                  套用 FPM pool
                </Button>
              ) : null}
            </FormActions>
            <p className="muted u-text-sm u-mt-3 u-mb-0">
              {ui.deployIsPhp
                ? '會寫入站點／pool 設定；真正 reload 需系統變更權限。'
                : '建置／啟動失敗會在操作結果顯示原因，不會假裝成功。entry 會寫入伺服器；略過建置另存本機偏好。'}
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
              靜態站以「發布 Nginx」為主 — 請到「網絡」或總覽快捷操作。
            </p>
          </CardSection>
        </Card>
      )}

      {ui.deployIsPhp ? (
        <Card>
          <CardSection
            title="專案 php.ini 覆寫"
            description="只填要改的鍵；空白＝沿用全域（執行環境 → PHP → php.ini）。部署／套用 FPM 時寫入 php_admin_*"
          >
            <FormLayout columns={2}>
              <Field label="memory_limit" htmlFor="pini-mem" flush hint="例如 256M；留空用全域">
                <PresetChips
                  options={[
                    { value: '', label: '全域' },
                    { value: '128M', label: '128M' },
                    { value: '256M', label: '256M' },
                    { value: '512M', label: '512M' },
                    { value: '1G', label: '1G' },
                  ]}
                  value={phpIniMem}
                  onChange={setPhpIniMem}
                  allowCustom
                  customPlaceholder="自訂"
                />
              </Field>
              <Field label="max_execution_time" htmlFor="pini-exec" flush>
                <PresetChips
                  options={[
                    { value: '', label: '全域' },
                    { value: '30', label: '30' },
                    { value: '60', label: '60' },
                    { value: '120', label: '120' },
                    { value: '300', label: '300' },
                  ]}
                  value={phpIniExec}
                  onChange={setPhpIniExec}
                  allowCustom
                  customPlaceholder="自訂"
                />
              </Field>
              <Field label="upload_max_filesize" htmlFor="pini-up" flush>
                <PresetChips
                  options={[
                    { value: '', label: '全域' },
                    { value: '32M', label: '32M' },
                    { value: '64M', label: '64M' },
                    { value: '128M', label: '128M' },
                    { value: '256M', label: '256M' },
                  ]}
                  value={phpIniUpload}
                  onChange={setPhpIniUpload}
                  allowCustom
                  customPlaceholder="自訂"
                />
              </Field>
              <Field label="display_errors" htmlFor="pini-disp" flush>
                <SegRadio
                  name="pini-disp"
                  aria-label="display_errors"
                  value={phpIniDisplay === null ? '' : phpIniDisplay ? '1' : '0'}
                  onChange={(v) => setPhpIniDisplay(v === '' ? null : v === '1')}
                  options={[
                    { value: '', label: '全域' },
                    { value: '0', label: '關' },
                    { value: '1', label: '開 · 慎' },
                  ]}
                />
              </Field>
            </FormLayout>
            <FormHint>
              完整目錄與 opcache／session 等請到{' '}
              <Link to="/runtimes/php?tab=ini">PHP 執行環境 → php.ini</Link>。
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
                    .then(() => onOpsMessage?.('已儲存專案 php.ini 覆寫；請再部署或套用 FPM'))
                    .catch((e: Error) => onOpsMessage?.(e.message))
                    .finally(() => setPhpIniBusy(false));
                }}
              >
                儲存 php.ini 覆寫
              </Button>
            </FormActions>
          </CardSection>
        </Card>
      ) : null}

      {history.length > 0 ? (
        <Card>
          <CardSection
            title={`部署歷史（${history.length}）`}
            description="來自操作稽核；newest first"
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
                  <li key={h.id} className="btn-row u-justify-between u-flex-wrap">
                    <span>
                      <Badge tone={h.ok ? 'ok' : 'danger'}>{h.ok ? '成功' : '失敗'}</Badge>{' '}
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
                hint="HTTPS 或 SSH 倉庫位址；同步後會依 runtime 自動 redeploy"
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
              若 app/ 為 YSK 範本佔位（含 .ysk-scaffold），會先清除再 clone；已有自訂內容會拒絕覆寫。
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
                hint="每行 KEY=value；# 開頭為註解"
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
