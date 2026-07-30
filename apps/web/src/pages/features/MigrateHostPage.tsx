/**
 * 整機遷移 — 來源機精靈：盤點 → 目標 SSH → 預檢/執行 → cutover
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  FeaturePageLayout,
  Field,
  Form,
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

  const loadInventory = useCallback(async () => {
    setInvLoading(true);
    setErr(null);
    try {
      const r = await migrateApi.inventory();
      setInventory(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '盤點失敗');
    } finally {
      setInvLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const r = await migrateApi.listJobs();
      setJobs(r.jobs ?? []);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    void loadInventory();
    void loadJobs();
  }, [loadInventory, loadJobs]);

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
      setPassword(''); // never keep in UI state after submit
      await loadJobs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '遷移請求失敗');
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const counts = inventory?.manifest?.counts ?? {};
  const warnings = inventory?.manifest?.warnings ?? [];
  const cutover = last?.manifest?.cutoverHostnames ??
    inventory?.manifest?.cutoverHostnames ??
    [];

  return (
    <FeaturePageLayout
      title="整機遷移"
      subtitle="將本機全部專案、郵件、資料庫、帳戶與設定遷到新伺服器。新機只換 IP，其餘保持一致。"
      status={{
        pill: {
          label: inventory?.ok ? '已盤點' : '待盤點',
          tone: inventory?.ok ? 'ok' : 'neutral',
        },
        items: [
          { label: '專案', value: counts.projects ?? '—' },
          { label: '信箱', value: counts.mailboxes ?? '—' },
          { label: '用戶', value: counts.users ?? '—' },
        ],
      }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={invLoading}
            onClick={() => void loadInventory()}
          >
            重新盤點
          </Button>
        </ActionBar>
      }
    >
      {err ? <Alert variant="error">{err}</Alert> : null}

      <PageTabs
        tabs={[
          { id: 'wizard', label: '遷移精靈' },
          { id: 'jobs', label: '工作紀錄', badge: jobs.length || undefined },
        ]}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {tab === 'wizard' ? (
          <div className="tab-panel stack-gap">
            <section className="card">
              <h3 className="card__title">1. 本機盤點</h3>
              {invLoading && !inventory ? (
                <LoadingBlock label="盤點中…" />
              ) : inventory ? (
                <>
                  <p className="muted u-text-sm">
                    {(inventory.summary ?? inventory.notes)?.join(' · ')}
                  </p>
                  <ul className="list-plain u-mt-2">
                    <li>專案 {counts.projects ?? '—'}</li>
                    <li>信箱 {counts.mailboxes ?? '—'}</li>
                    <li>用戶 {counts.users ?? '—'}</li>
                    <li>
                      軟體需求{' '}
                      {(inventory.manifest?.softwareNeeded ?? []).length} 項
                    </li>
                  </ul>
                  {warnings.length ? (
                    <Alert variant="info" className="u-mt-3">
                      <strong>警告 {warnings.length}</strong>
                      <ul className="u-mt-1">
                        {warnings.slice(0, 8).map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                        {warnings.length > 8 ? (
                          <li>…另有 {warnings.length - 8} 則</li>
                        ) : null}
                      </ul>
                    </Alert>
                  ) : null}
                </>
              ) : (
                <p className="muted">尚未盤點</p>
              )}
            </section>

            <section className="card">
              <h3 className="card__title">2. 目標主機</h3>
              <Form layoutOnly>
                <Field label="SSH 目標" htmlFor="mig-target">
                  <input
                    id="mig-target"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="root@203.0.113.10"
                    autoComplete="off"
                  />
                </Field>
                <Field label="埠" htmlFor="mig-port">
                  <input
                    id="mig-port"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </Field>
                <Field label="目標 dataDir" htmlFor="mig-dd">
                  <input
                    id="mig-dd"
                    value={targetDataDir}
                    onChange={(e) => setTargetDataDir(e.target.value)}
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
                      root 密碼（一次性臨時金鑰）
                    </option>
                    <option value="identityId">SSH 身份庫 identityId</option>
                    <option value="agent">本機預設 agent/key</option>
                  </select>
                </Field>
                {authMode === 'password' ? (
                  <Field label="Root 密碼" htmlFor="mig-pw">
                    <input
                      id="mig-pw"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                ) : null}
                {authMode === 'identityId' ? (
                  <Field label="identityId" htmlFor="mig-id">
                    <input
                      id="mig-id"
                      value={identityId}
                      onChange={(e) => setIdentityId(e.target.value)}
                      placeholder="vault identity uuid"
                    />
                  </Field>
                ) : null}
                <label className="u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={maintenance}
                    onChange={(e) => setMaintenance(e.target.checked)}
                  />
                  <span>確認維護窗（來源會短暫停服以保證 dump 一致）</span>
                </label>
                <label className="u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={forceWipe}
                    onChange={(e) => setForceWipe(e.target.checked)}
                  />
                  <span>允許覆寫目標既有 YSK 資料（forceWipeTarget）</span>
                </label>
                <label className="u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                  <span>僅 dry-run（盤點 + 預檢，不傳輸）</span>
                </label>
              </Form>
              <ActionBar className="u-mt-3">
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={
                    !target.trim() ||
                    (!dryRun && !maintenance) ||
                    (authMode === 'password' && !password && !dryRun)
                  }
                  onClick={() => {
                    if (dryRun) void runMigrate();
                    else setConfirmOpen(true);
                  }}
                >
                  {dryRun ? '執行預檢' : '開始整機遷移'}
                </Button>
              </ActionBar>
              <p className="muted u-text-sm u-mt-2">
                需本機 <code>YSK_EXECUTE=1</code> 且 root。密碼不會寫入資料庫。
              </p>
            </section>

            {last ? (
              <section className="card">
                <h3 className="card__title">3. 結果</h3>
                <OpsResultPanel
                  title={last.ok ? '遷移結果' : '遷移未完成'}
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
                {last.job ? (
                  <p className="u-mt-2">
                    Job <code>{last.job.id}</code> · phase{' '}
                    <Badge
                      tone={
                        last.job.phase === 'done'
                          ? 'ok'
                          : last.job.phase === 'failed'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {last.job.phase}
                    </Badge>
                  </p>
                ) : null}
                {cutover.length ? (
                  <div className="u-mt-3">
                    <h4>DNS cutover（人為）</h4>
                    <p className="muted u-text-sm">
                      將下列主機名的 A/AAAA 指到新 IP；並檢查雲防火牆、郵件
                      PTR。
                    </p>
                    <ul className="list-plain">
                      {cutover.map((h) => (
                        <li key={h}>
                          <code>{h}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === 'jobs' ? (
          <div className="tab-panel">
            <ActionBar>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadJobs()}
              >
                重新整理
              </Button>
            </ActionBar>
            <DataTable
              className="u-mt-3"
              title={`Migrate jobs (${jobs.length})`}
              columns={[
                {
                  key: 'id',
                  header: 'ID',
                  render: (j) => (
                    <code className="u-text-sm">{j.id.slice(0, 8)}…</code>
                  ),
                },
                {
                  key: 'phase',
                  header: 'Phase',
                  render: (j) => <Badge tone="neutral">{j.phase}</Badge>,
                },
                {
                  key: 'target',
                  header: 'Target',
                  render: (j) =>
                    j.target
                      ? `${j.target.user}@${j.target.host}:${j.target.port}`
                      : '—',
                },
                {
                  key: 'at',
                  header: '更新',
                  render: (j) => new Date(j.updatedAt).toLocaleString(),
                },
                {
                  key: 'err',
                  header: '錯誤',
                  render: (j) => j.lastError || '—',
                },
              ]}
              rows={jobs}
              rowKey={(j) => j.id}
              empty={<p className="muted">尚無遷移工作</p>}
            />
          </div>
        ) : null}
      </PageTabs>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void runMigrate()}
        title="確認整機遷移"
        description={`目標 ${target}。來源將進入維護窗（dump + rsync）。此操作不可輕易復原。`}
        confirmLabel="開始遷移"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
