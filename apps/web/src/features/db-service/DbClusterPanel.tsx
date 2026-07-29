/**
 * Engine HA cluster panel — plan-first wizard.
 * MariaDB Galera + MySQL primary/replica. Mounted in ServiceConsole «叢集» tab.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  OpsResultPanel,
  SegRadio,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import type { DbServiceEngine } from './api';
import {
  dbClusterApi,
  type ClusterPlan,
  type DbCluster,
  type DbClusterKind,
} from './cluster-api';
import { useFeatureAction } from '../system/useFeatureAction';
import { api } from '../../shared/services/api';

function statusTone(
  s: string,
): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (s === 'healthy') return 'ok';
  if (s === 'planned' || s === 'draft' || s === 'partial') return 'warn';
  if (s === 'failed' || s === 'degraded') return 'danger';
  return 'neutral';
}

function defaultKind(engine: DbServiceEngine): DbClusterKind {
  if (engine === 'mariadb') return 'mariadb-galera';
  if (engine === 'mysql') return 'mysql-replica';
  if (engine === 'postgres') return 'postgres-replica';
  return 'redis-replica';
}

export function DbClusterPanel({ engine }: { engine: DbServiceEngine }) {
  const [items, setItems] = useState<DbCluster[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizOpen, setWizOpen] = useState(false);
  const [name, setName] = useState('ysk-cluster');
  const [localHost, setLocalHost] = useState('');
  const [peerHost, setPeerHost] = useState('');
  const [sst, setSst] = useState('mariabackup');
  const [lastPlan, setLastPlan] = useState<ClusterPlan | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<{
    id: string;
    bootstrap: boolean;
  } | null>(null);
  const [probeFacts, setProbeFacts] = useState<Record<string, string> | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await dbClusterApi.list(engine);
      setItems(r.items ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kind = defaultKind(engine);
  const wizardReady = engine === 'mariadb' || engine === 'mysql';
  const isGalera = kind === 'mariadb-galera';
  const isMysqlRepl = kind === 'mysql-replica';

  async function onCreatePlan(e: FormEvent) {
    e.preventDefault();
    if (!localHost.trim() || !peerHost.trim()) {
      setError('請填寫本機與 peer 真實 IP／主機名');
      return;
    }
    await run(async () => {
      const members =
        isMysqlRepl
          ? [
              {
                host: localHost.trim(),
                role: 'primary',
                access: 'local' as const,
                label: 'primary',
              },
              {
                host: peerHost.trim(),
                role: 'replica',
                access: 'ssh' as const,
                label: 'replica-1',
              },
            ]
          : [
              {
                host: localHost.trim(),
                role: 'node',
                access: 'local' as const,
                label: 'local',
              },
              {
                host: peerHost.trim(),
                role: 'node',
                access: 'ssh' as const,
                label: 'peer-1',
              },
            ];
      const created = await dbClusterApi.create({
        name: name.trim() || 'ysk-cluster',
        engine,
        kind,
        members,
        params: isGalera
          ? { clusterName: name.trim() || 'ysk-galera', sstMethod: sst }
          : isMysqlRepl
            ? { replUser: 'ysk_repl', serverIdBase: 100 }
            : {},
      });
      const planned = await dbClusterApi.plan(created.cluster.id);
      setActiveId(created.cluster.id);
      setLastPlan(planned.plan);
      setWizOpen(false);
      await refresh();
      return {
        ok: planned.plan.ok,
        dryRun: true,
        notes: [
          ...(planned.plan.notes ?? []),
          `狀態：${planned.cluster.status}（計劃成功 ≠ 叢集健康）`,
          planned.cluster.artifactDir
            ? `產物：${planned.cluster.artifactDir}`
            : '',
        ].filter(Boolean),
      } as OpsResultLike;
    }, '已產生計劃（dry-run）');
  }

  async function replan(id: string) {
    await run(async () => {
      const planned = await dbClusterApi.plan(id);
      setActiveId(id);
      setLastPlan(planned.plan);
      await refresh();
      return {
        ok: planned.plan.ok,
        dryRun: true,
        notes: planned.plan.notes,
      } as OpsResultLike;
    }, '已更新計劃');
  }

  /** Dry-run apply: materialize + mark local written (no system) */
  async function applyDry(id: string) {
    await run(async () => {
      const r = await dbClusterApi.apply(id, { execute: false });
      setActiveId(id);
      await refresh();
      return {
        ok: r.ok,
        dryRun: r.dryRun,
        notes: r.notes,
        written: r.written,
      } as OpsResultLike;
    }, '已寫管理檔（dry-run）');
  }

  async function applySystem(id: string, bootstrap: boolean) {
    await run(async () => {
      const r = await dbClusterApi.apply(id, { execute: true, bootstrap });
      setActiveId(id);
      await refresh();
      return {
        ok: r.ok,
        dryRun: r.dryRun,
        blocked: r.blocked,
        notes: r.notes,
        written: r.written,
        requiresExecute: r.requiresExecute,
        requiresRoot: r.requiresRoot,
      } as OpsResultLike;
    }, bootstrap ? '已嘗試 bootstrap' : '已嘗試套用系統 conf');
  }

  async function doProbe(id: string) {
    await run(async () => {
      const r = await dbClusterApi.probe(id);
      setActiveId(id);
      setProbeFacts(r.facts ?? null);
      await refresh();
      return {
        ok: r.ok || r.localOk,
        notes: [
          ...(r.notes ?? []),
          `status=${r.cluster.status}`,
          r.localOk ? '本機 wsrep 可讀' : '本機 probe 未過',
        ],
      } as OpsResultLike;
    }, '已探測');
  }

  async function downloadBundle(id: string) {
    await run(async () => {
      await dbClusterApi.bundle(id);
      await api.downloadAuthenticated(
        dbClusterApi.bundleDownloadUrl(id),
        `ysk-cluster-${id.slice(0, 8)}.tar.gz`,
      );
      return {
        ok: true,
        notes: ['已下載 peer 打包（.tar.gz）— 解壓後喺 peer 上安裝 conf'],
      } as OpsResultLike;
    }, '已下載');
  }

  async function pushPeers(id: string, execute: boolean) {
    await run(async () => {
      const r = await dbClusterApi.push(id, { execute });
      setActiveId(id);
      await refresh();
      return {
        ok: r.ok || r.dryRun,
        dryRun: r.dryRun,
        blocked: r.blocked,
        notes: [
          ...(r.notes ?? []),
          ...r.targets.map(
            (t) => `${t.host}: ${t.files.length} files → ${t.remotePath}`,
          ),
        ],
      } as OpsResultLike;
    }, execute ? '已推送 peer' : '已產生 push 計劃');
  }

  async function removeCluster(id: string) {
    if (!confirm('刪除叢集登記？系統 conf 唔會自動清（v1）。')) return;
    await run(async () => {
      const r = await dbClusterApi.remove(id);
      if (activeId === id) {
        setActiveId(null);
        setLastPlan(null);
        setProbeFacts(null);
      }
      await refresh();
      return { ok: r.ok, notes: r.notes ?? [] } as OpsResultLike;
    }, '已刪除登記');
  }

  return (
    <div className="stack-gap">
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      {!wizardReady ? (
        <Alert variant="info">
          此引擎（{kind}）計劃器稍後開放。而家可用{' '}
          <strong>MariaDB Galera</strong> 或 <strong>MySQL 主從</strong>。
        </Alert>
      ) : null}

      <Card>
        <CardSection
          title="叢集"
          description="計劃 → 寫管理檔 → 套用 → 探測。預設 dry-run，唔會假 healthy。"
        >
          <div className="btn-row u-mb-3">
            <Button
              variant="primary"
              size="md"
              disabled={busy || !wizardReady}
              onClick={() => {
                setError(null);
                setWizOpen(true);
              }}
            >
              {isGalera ? '建立簡易 Galera' : isMysqlRepl ? '建立主從複製' : '建立叢集'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => void refresh()}
            >
              重新整理
            </Button>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="目前：單機"
              description={
                isMysqlRepl
                  ? '未登記主從。指定 primary + replica 後產生 conf 與 SQL 腳本。'
                  : '未登記 HA。加 peer 節點後產生 conf 計劃，再分步 bootstrap / join。'
              }
              action={
                wizardReady ? (
                  <Button variant="primary" size="md" onClick={() => setWizOpen(true)}>
                    {isGalera ? '建立簡易 Galera' : '建立主從複製'}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>類型</th>
                    <th>狀態</th>
                    <th>節點</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <code className="inline">{c.name}</code>
                      </td>
                      <td className="muted">{c.kind}</td>
                      <td>
                        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                      </td>
                      <td className="muted">
                        {c.members.map((m) => m.host).join(', ')}
                      </td>
                      <td>
                        <div className="btn-row">
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void replan(c.id)}
                          >
                            計劃
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void applyDry(c.id)}
                          >
                            寫檔
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => setApplyTarget({ id: c.id, bootstrap: false })}
                          >
                            套用本機
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => setApplyTarget({ id: c.id, bootstrap: true })}
                          >
                            Bootstrap
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void doProbe(c.id)}
                          >
                            探測
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void downloadBundle(c.id)}
                          >
                            下載包
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void pushPeers(c.id, false)}
                          >
                            Push 計劃
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              if (
                                !confirm(
                                  'scp 檔案到 peer /tmp？需 YSK_EXECUTE=1 與 SSH key。成功 ≠ peer 已 restart。',
                                )
                              )
                                return;
                              void pushPeers(c.id, true);
                            }}
                          >
                            Push 執行
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() => void removeCluster(c.id)}
                          >
                            刪除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </Card>

      {probeFacts && Object.keys(probeFacts).length > 0 ? (
        <Card>
          <CardSection title="最近 probe（本機 wsrep）" description="healthy 必須 probe 通過">
            <DescriptionList
              columns={2}
              items={Object.entries(probeFacts)
                .filter(([k]) =>
                  /wsrep_(ready|connected|cluster_size|local_state)/i.test(k),
                )
                .slice(0, 8)
                .map(([k, v]) => ({ label: k, value: v }))}
            />
          </CardSection>
        </Card>
      ) : null}

      {lastPlan ? (
        <Card>
          <CardSection
            title="計劃預覽"
            description="dry-run · 成功只代表步驟/conf 已生成"
          >
            <DescriptionList
              columns={2}
              items={[
                { label: 'cluster', value: lastPlan.clusterId.slice(0, 8) + '…' },
                {
                  label: '步驟',
                  value: String(lastPlan.steps.length),
                },
                {
                  label: '檔案',
                  value: String(lastPlan.files.length),
                },
                {
                  label: '系統變更',
                  value: lastPlan.requiresExecute ? '套用時需要' : '否',
                },
              ]}
            />
            <ul className="list-plain list-spaced u-mt-3">
              {lastPlan.steps.map((s) => (
                <li key={s.id}>
                  <Badge tone={s.risk === 'execute-host' ? 'warn' : 'neutral'}>
                    {s.kind}
                  </Badge>{' '}
                  {s.title}
                </li>
              ))}
            </ul>
            {lastPlan.files[0]?.body ? (
              <details className="u-mt-3">
                <summary className="muted">本機 conf 預覽</summary>
                <pre className="ops-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 280 }}>
                  {lastPlan.files.find((f) => f.relativePath.includes('99-ysk'))?.body ??
                    lastPlan.files[0].body}
                </pre>
              </details>
            ) : null}
          </CardSection>
        </Card>
      ) : null}

      {result ? <OpsResultPanel result={result} /> : null}

      <Modal
        open={wizOpen}
        onClose={() => setWizOpen(false)}
        title={isGalera ? '簡易 Galera' : 'MySQL 主從複製'}
        description="選擇節點 → 產生計劃（唔會自動改 peer 系統）"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setWizOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="dbc-wiz"
              variant="primary"
              size="md"
              loading={busy}
            >
              產生計劃
            </Button>
          </>
        }
      >
        <form id="dbc-wiz" onSubmit={(e) => void onCreatePlan(e)}>
          <FormLayout columns={1}>
            <Field label="叢集名稱" htmlFor="dbc-name" flush required>
              <input
                id="dbc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                spellCheck={false}
              />
            </Field>
            <Field
              label={isMysqlRepl ? 'Primary IP／主機' : '本機 IP／主機'}
              htmlFor="dbc-local"
              flush
              required
              hint={
                isMysqlRepl
                  ? '通常係控制面所在機（primary + access=local）'
                  : '控制面所在機（access=local）'
              }
            >
              <input
                id="dbc-local"
                value={localHost}
                onChange={(e) => setLocalHost(e.target.value)}
                placeholder="例如 10.0.0.1"
                required
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={isMysqlRepl ? 'Replica IP／主機' : 'Peer IP／主機'}
              htmlFor="dbc-peer"
              flush
              required
              hint={
                isMysqlRepl
                  ? '從庫節點；之後可再加更多 replica'
                  : '第二節點；生產建議再加第三節點'
              }
            >
              <input
                id="dbc-peer"
                value={peerHost}
                onChange={(e) => setPeerHost(e.target.value)}
                placeholder="例如 10.0.0.2"
                required
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            {isGalera ? (
              <Field label="SST 方式" htmlFor="dbc-sst" flush>
                <SegRadio
                  name="dbc-sst"
                  aria-label="SST"
                  value={sst}
                  onChange={setSst}
                  options={[
                    { value: 'mariabackup', label: 'mariabackup' },
                    { value: 'rsync', label: 'rsync' },
                  ]}
                />
              </Field>
            ) : null}
            <FormHint>
              禁止示範 IP（203.0.113.x）。
              {isGalera
                ? '防火牆內網開 3306 / 4567 / 4444 / 4568。'
                : '主從需內網 3306；SQL 腳本內密碼請改 CHANGE_ME。'}
              套用系統 conf 需 YSK_EXECUTE=1 + root。
            </FormHint>
          </FormLayout>
          <FormActions>
            <span className="muted u-text-sm">拓撲：{kind}</span>
          </FormActions>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(applyTarget)}
        onClose={() => setApplyTarget(null)}
        title="套用本機系統 conf？"
        description={
          applyTarget?.bootstrap
            ? '會安裝 Galera drop-in 並 bootstrap（galera_new_cluster）。僅第一個節點用一次。'
            : '會安裝 Galera drop-in 並 systemctl restart mariadb。需 YSK_EXECUTE=1 + root。首節點請改用「Bootstrap」。'
        }
        confirmLabel="確認套用"
        danger
        onConfirm={() => {
          if (!applyTarget) return;
          const t = applyTarget;
          setApplyTarget(null);
          void applySystem(t.id, t.bootstrap);
        }}
      />
    </div>
  );
}
