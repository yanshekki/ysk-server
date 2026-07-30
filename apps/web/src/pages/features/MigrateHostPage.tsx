/**
 * 整機遷移 — 專業控制台：盤點 → 目標與認證 → 確認執行 → 結果 / cutover
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  OpsResultPanel,
  PageTabs,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  migrateApi,
  type MigrateJob,
  type MigrateOpsResult,
} from '../../features/migrate/api';

const TABS = ['wizard', 'jobs'] as const;

const STEPS = [
  { id: 'scan', label: '盤點' },
  { id: 'target', label: '目標' },
  { id: 'run', label: '執行' },
  { id: 'done', label: '完成' },
] as const;

export function MigrateHostPage() {
  const [tab, setTab] = usePageTab(TABS, 'wizard');
  const [inventory, setInventory] = useState<MigrateOpsResult | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('22');
  const [authMode, setAuthMode] = useState<'password' | 'identityId' | 'agent'>(
    'password',
  );
  const [password, setPassword] = useState('');
  const [identityId, setIdentityId] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [forceWipe, setForceWipe] = useState(false);
  const [targetDataDir, setTargetDataDir] = useState('/var/lib/ysk-server');
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<MigrateOpsResult | null>(null);
  const [jobs, setJobs] = useState<MigrateJob[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const r = await migrateApi.listJobs();
      setJobs(r.jobs ?? []);
    } catch {
      /* list optional */
    }
  }, []);

  /** Single refresh: inventory + job list（頁面只留一顆「重新整理」） */
  const refreshAll = useCallback(async () => {
    setInvLoading(true);
    setErr(null);
    try {
      const [inv] = await Promise.all([
        migrateApi.inventory(),
        loadJobs(),
      ]);
      setInventory(inv);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '重新整理失敗');
      setInventory(null);
    } finally {
      setInvLoading(false);
    }
  }, [loadJobs]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function runMigrate() {
    setBusy(true);
    setErr(null);
    setLast(null);
    try {
      const body: Parameters<typeof migrateApi.runHost>[0] = {
        target: target.trim(),
        port: Number(port) || 22,
        maintenanceAccepted: maintenance,
        forceWipeTarget: forceWipe,
        targetDataDir: targetDataDir.trim() || '/var/lib/ysk-server',
        dryRun,
        execute: !dryRun,
      };
      if (authMode === 'password' && password) {
        body.password = password;
      } else if (authMode === 'identityId' && identityId) {
        body.identityId = identityId.trim();
      }
      const r = await migrateApi.runHost(body);
      setLast(r);
      setPassword('');
      await loadJobs(); // keep job list in sync after run
      if (!r.ok && r.notes?.length) {
        setErr(r.blockMessage || r.notes[0] || '遷移未完成');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '遷移請求失敗');
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const counts = inventory?.manifest?.counts ?? {};
  const warnings = (inventory?.manifest?.warnings as string[] | undefined) ?? [];
  const softwareNeeded =
    (inventory?.manifest?.softwareNeeded as string[] | undefined) ?? [];
  const cutover =
    (last?.manifest?.cutoverHostnames as string[] | undefined) ??
    (inventory?.manifest?.cutoverHostnames as string[] | undefined) ??
    [];

  const canRun = useMemo(() => {
    if (!target.trim()) return false;
    if (!dryRun && !maintenance) return false;
    if (authMode === 'password' && !password && !dryRun) return false;
    if (authMode === 'identityId' && !identityId.trim() && !dryRun) return false;
    return true;
  }, [target, dryRun, maintenance, authMode, password, identityId]);

  const stepIndex = last?.ok
    ? 3
    : last
      ? 2
      : inventory?.ok
        ? 1
        : 0;

  return (
    <FeaturePageLayout
      title="整機遷移"
      subtitle="來源控制面 → 新機全量複製。完成後只改公網 IP／DNS，帳號、路徑與專案保持一致。"
      status={{
        pill: {
          label: invLoading
            ? '盤點中'
            : inventory?.ok
              ? '已盤點'
              : err
                ? '盤點失敗'
                : '待盤點',
          tone: inventory?.ok ? 'ok' : err ? 'danger' : 'neutral',
        },
        items: [
          { label: '專案', value: counts.projects ?? '—' },
          { label: '信箱', value: counts.mailboxes ?? '—' },
          { label: '用戶', value: counts.users ?? '—' },
          {
            label: '軟體',
            value: softwareNeeded.length || '—',
          },
          {
            label: '工作',
            value: jobs.length,
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={invLoading}
            onClick={() => void refreshAll()}
          >
            重新整理
          </Button>
        </ActionBar>
      }
    >
      {err ? (
        <Alert variant="error">
          {err}
          {err.includes('找不到') || err.includes('404') ? (
            <span className="u-block u-mt-2 muted u-text-sm">
              若剛部署新版本，請重啟 API（
              <code>ysk-server serve</code> /{' '}
              <code>pnpm --filter @ysk/server dev</code>
              ）後再按「重新整理」。
            </span>
          ) : null}
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'wizard', label: '遷移精靈' },
          { id: 'jobs', label: '工作紀錄', badge: jobs.length || undefined },
        ]}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {tab === 'wizard' ? (
          <div className="tab-panel mig-wizard">
            {/* Step rail */}
            <nav className="mig-steps" aria-label="遷移步驟">
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  className={`mig-steps__item${
                    i === stepIndex ? ' is-current' : ''
                  }${i < stepIndex ? ' is-done' : ''}`}
                >
                  <span className="mig-steps__num" aria-hidden>
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  <span className="mig-steps__label">{s.label}</span>
                </div>
              ))}
            </nav>

            {/* 1 Inventory */}
            <Card>
              <CardSection
                title="來源盤點"
                description="唯讀掃描控制面與專案路徑，不會修改系統"
              >
                {invLoading && !inventory ? (
                  <LoadingBlock label="正在盤點本機…" />
                ) : inventory?.ok ? (
                  <>
                    <DescriptionList
                      columns={2}
                      items={[
                        {
                          label: '主機',
                          value: String(
                            (inventory.manifest as { source?: { hostname?: string } })
                              ?.source?.hostname ?? '—',
                          ),
                        },
                        {
                          label: 'dataDir',
                          value: (
                            <code className="u-break-all u-text-sm">
                              {String(
                                (inventory.manifest as { source?: { dataDir?: string } })
                                  ?.source?.dataDir ?? '—',
                              )}
                            </code>
                          ),
                        },
                        {
                          label: '專案 / home',
                          value: `${counts.projects ?? 0} / ${counts.homes_on_disk ?? '—'}`,
                        },
                        {
                          label: '信箱',
                          value: String(counts.mailboxes ?? 0),
                        },
                        {
                          label: 'DB / Redis',
                          value: `${
                            (counts.mysql_databases ?? 0) +
                            (counts.postgres_databases ?? 0)
                          } / ${counts.redis_instances ?? 0}`,
                        },
                        {
                          label: '需安裝軟體',
                          value: softwareNeeded.length
                            ? softwareNeeded.slice(0, 6).join(', ') +
                              (softwareNeeded.length > 6 ? '…' : '')
                            : '—',
                        },
                      ]}
                    />
                    {inventory.notes?.length ? (
                      <p className="muted u-text-sm u-mt-3 u-mb-0">
                        {inventory.notes.join(' · ')}
                      </p>
                    ) : null}
                    {warnings.length > 0 ? (
                      <Alert variant="info" className="u-mt-3">
                        <strong>盤點警告（{warnings.length}）</strong>
                        <ul className="mig-warn-list">
                          {warnings.slice(0, 6).map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                          {warnings.length > 6 ? (
                            <li>…另有 {warnings.length - 6} 則</li>
                          ) : null}
                        </ul>
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    title="尚未取得盤點"
                    description="按右上角「重新整理」掃描本機狀態與工作紀錄。API 需已載入 migrate 路由。"
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        loading={invLoading}
                        onClick={() => void refreshAll()}
                      >
                        重新整理
                      </Button>
                    }
                  />
                )}
              </CardSection>
            </Card>

            {/* 2 Target */}
            <Card>
              <CardSection
                title="目標主機"
                description="僅需 root SSH；密碼只用於本次請求，不會寫入資料庫"
              >
                <FormLayout columns={2}>
                  <Field label="SSH 目標" htmlFor="mig-target" required fullWidth>
                    <input
                      id="mig-target"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      placeholder="root@203.0.113.10"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="SSH 埠" htmlFor="mig-port">
                    <input
                      id="mig-port"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="目標 dataDir" htmlFor="mig-dd" fullWidth>
                    <input
                      id="mig-dd"
                      value={targetDataDir}
                      onChange={(e) => setTargetDataDir(e.target.value)}
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="認證方式" htmlFor="mig-auth">
                    <select
                      id="mig-auth"
                      value={authMode}
                      onChange={(e) =>
                        setAuthMode(e.target.value as typeof authMode)
                      }
                    >
                      <option value="password">
                        root 密碼（安裝臨時金鑰後改用 key）
                      </option>
                      <option value="identityId">SSH 身份庫 identityId</option>
                      <option value="agent">本機預設 agent / 金鑰</option>
                    </select>
                  </Field>
                  {authMode === 'password' ? (
                    <Field label="Root 密碼" htmlFor="mig-pw" required fullWidth>
                      <input
                        id="mig-pw"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="不會持久化"
                      />
                    </Field>
                  ) : null}
                  {authMode === 'identityId' ? (
                    <Field label="identityId" htmlFor="mig-id" required fullWidth>
                      <input
                        id="mig-id"
                        value={identityId}
                        onChange={(e) => setIdentityId(e.target.value)}
                        placeholder="vault 內 outbound identity"
                        spellCheck={false}
                      />
                    </Field>
                  ) : null}
                </FormLayout>

                <div className="mig-checks u-mt-4">
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={maintenance}
                      onChange={(e) => setMaintenance(e.target.checked)}
                    />
                    <span>
                      <strong>確認維護窗</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        · 來源將短暫停服以保證 dump 一致（正式遷移必勾）
                      </span>
                    </span>
                  </label>
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={forceWipe}
                      onChange={(e) => setForceWipe(e.target.checked)}
                    />
                    <span>
                      <strong>允許覆寫目標既有 YSK 資料</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        · 目標已有 ysk.json 時需勾選
                      </span>
                    </span>
                  </label>
                  <label className="mig-check">
                    <input
                      type="checkbox"
                      checked={dryRun}
                      onChange={(e) => setDryRun(e.target.checked)}
                    />
                    <span>
                      <strong>僅 dry-run</strong>
                      <span className="muted u-text-sm">
                        {' '}
                        · 只做盤點 + 預檢，不 rsync、不寫目標
                      </span>
                    </span>
                  </label>
                </div>

                <Alert variant="info" className="u-mt-3">
                  本機需 <code>YSK_EXECUTE=1</code> 且以 root 執行 API。遷移完成後請改
                  DNS A/AAAA，並檢查雲防火牆與郵件 PTR。
                </Alert>

                <ActionBar className="u-mt-4">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!canRun || busy}
                    onClick={() => {
                      if (dryRun) void runMigrate();
                      else setConfirmOpen(true);
                    }}
                  >
                    {dryRun ? '執行預檢（dry-run）' : '開始整機遷移'}
                  </Button>
                  {!canRun && !busy ? (
                    <span className="muted u-text-sm">
                      {!target.trim()
                        ? '請填寫 SSH 目標'
                        : !dryRun && !maintenance
                          ? '請勾選維護窗'
                          : authMode === 'password' && !password
                            ? '請輸入 root 密碼'
                            : '請完成必要欄位'}
                    </span>
                  ) : null}
                </ActionBar>
              </CardSection>
            </Card>

            {/* 3 Result */}
            {last ? (
              <Card>
                <CardSection
                  title={last.ok ? '遷移結果' : '遷移未完成'}
                  description={
                    last.job
                      ? `Job ${last.job.id.slice(0, 8)}… · phase ${last.job.phase}`
                      : undefined
                  }
                >
                  <div className="mig-result-head u-mb-3">
                    <Badge
                      tone={
                        last.ok
                          ? 'ok'
                          : last.blocked
                            ? 'warn'
                            : 'danger'
                      }
                    >
                      {last.ok
                        ? '成功'
                        : last.blocked
                          ? '已阻擋'
                          : '失敗'}
                    </Badge>
                    {last.job ? (
                      <Badge tone="neutral">{last.job.phase}</Badge>
                    ) : null}
                    {last.apply_status ? (
                      <span className="muted u-text-sm">
                        apply_status={last.apply_status}
                      </span>
                    ) : null}
                  </div>

                  {last.phases ? (
                    <div className="mig-phases u-mb-3">
                      {Object.entries(last.phases).map(([name, ph]) => (
                        <div
                          key={name}
                          className={`mig-phases__item${
                            ph?.ok === false ? ' is-bad' : ' is-ok'
                          }`}
                        >
                          <span className="mig-phases__name">{name}</span>
                          <Badge tone={ph?.ok === false ? 'danger' : 'ok'}>
                            {ph?.ok === false ? 'fail' : 'ok'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <OpsResultPanel
                    title="詳細說明"
                    result={{
                      ok: last.ok,
                      blocked: last.blocked,
                      blockMessage: last.blockMessage,
                      requiresExecute: last.requiresExecute,
                      notes: last.notes,
                      apply_status: last.apply_status as
                        | 'written'
                        | 'applied'
                        | 'blocked'
                        | 'failed'
                        | 'partial'
                        | undefined,
                    }}
                  />

                  {cutover.length > 0 ? (
                    <div className="mig-cutover u-mt-4">
                      <h4 className="mig-cutover__title">DNS cutover（需人工）</h4>
                      <p className="muted u-text-sm u-mb-2">
                        將下列主機名的 A / AAAA 指到<strong>新機公網 IP</strong>
                        ；並確認 80/443/25/587 等防火牆與郵件 rDNS。
                      </p>
                      <ul className="mig-cutover__list">
                        {cutover.map((h) => (
                          <li key={h}>
                            <code>{h}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === 'jobs' ? (
          <div className="tab-panel">
            <DataTable
              title={`遷移工作（${jobs.length}）`}
              description="狀態落在 dataDir/migrate/；密碼從不寫入 job 檔。按右上角「重新整理」更新。"
              columns={[
                {
                  key: 'id',
                  header: 'Job',
                  nowrap: true,
                  render: (j) => (
                    <code className="u-text-sm" title={j.id}>
                      {j.id.slice(0, 8)}…
                    </code>
                  ),
                },
                {
                  key: 'phase',
                  header: '階段',
                  nowrap: true,
                  render: (j) => (
                    <Badge
                      tone={
                        j.phase === 'done'
                          ? 'ok'
                          : j.phase === 'failed'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {j.phase}
                    </Badge>
                  ),
                },
                {
                  key: 'target',
                  header: '目標',
                  render: (j) =>
                    j.target
                      ? `${j.target.user}@${j.target.host}:${j.target.port}`
                      : '—',
                },
                {
                  key: 'at',
                  header: '更新',
                  nowrap: true,
                  render: (j) =>
                    new Date(j.updatedAt).toLocaleString(),
                },
                {
                  key: 'err',
                  header: '備註',
                  render: (j) => (
                    <span className="muted u-text-sm">
                      {j.lastError || '—'}
                    </span>
                  ),
                },
              ]}
              rows={jobs}
              rowKey={(j) => j.id}
              empty={
                <EmptyState
                  title="尚無遷移工作"
                  description="在「遷移精靈」完成一次 dry-run 或正式遷移後會出現在此。"
                />
              }
            />
          </div>
        ) : null}
      </PageTabs>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void runMigrate()}
        title="確認整機遷移"
        description={`即將對 ${target.trim() || '（未填目標）'} 執行全量 rsync 與目標 bootstrap。來源進入維護窗，過程可能數十分鐘。密碼僅本次使用。`}
        confirmLabel="確認開始"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
