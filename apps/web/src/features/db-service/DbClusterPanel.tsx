/**
 * Engine HA cluster panel — plan-first wizard.
 * MariaDB Galera + MySQL primary/replica. Mounted in ServiceConsole «叢集» tab.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
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

function wizardTitle(kind: DbClusterKind): string {
  if (kind === 'mariadb-galera') return '簡易 Galera';
  if (kind === 'mysql-replica') return 'MySQL 主從複製';
  if (kind === 'postgres-replica') return 'PostgreSQL 串流複製';
  if (kind === 'redis-sentinel') return 'Redis Sentinel';
  return 'Redis 主從';
}

function ctaLabel(kind: DbClusterKind): string {
  if (kind === 'mariadb-galera') return '建立簡易 Galera';
  if (kind === 'mysql-replica') return '建立主從複製';
  if (kind === 'postgres-replica') return '建立串流複製';
  if (kind === 'redis-sentinel') return '建立 Sentinel';
  return '建立 Redis 主從';
}

export function DbClusterPanel({ engine }: { engine: DbServiceEngine }) {
  const [items, setItems] = useState<DbCluster[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizOpen, setWizOpen] = useState(false);
  const [name, setName] = useState('ysk-cluster');
  const [localHost, setLocalHost] = useState('');
  const [peerHost, setPeerHost] = useState('');
  const [peer3Host, setPeer3Host] = useState('');
  const [sst, setSst] = useState('mariabackup');
  const [lastPlan, setLastPlan] = useState<ClusterPlan | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<{
    id: string;
    bootstrap: boolean;
  } | null>(null);
  const [probeFacts, setProbeFacts] = useState<Record<string, string> | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'remove'; id: string }
    | { kind: 'installPeers'; id: string }
    | { kind: 'push'; id: string }
    | { kind: 'fleetSync'; id: string }
    | { kind: 'fleetApply'; id: string }
    | null
  >(null);
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
  const wizardReady = true;
  const isGalera = kind === 'mariadb-galera';
  const isRepl =
    kind === 'mysql-replica' ||
    kind === 'postgres-replica' ||
    kind === 'redis-replica' ||
    kind === 'redis-sentinel';

  async function onCreatePlan(e: FormEvent) {
    e.preventDefault();
    if (!localHost.trim() || !peerHost.trim()) {
      setError('請填寫本機與 peer 真實 IP／主機名');
      return;
    }
    await run(async () => {
      const primaryRole =
        kind === 'redis-replica' || kind === 'redis-sentinel' ? 'master' : 'primary';
      const members: Array<{
        host: string;
        role: string;
        access: 'local' | 'ssh' | 'fleet';
        label: string;
      }> = isGalera
        ? [
            {
              host: localHost.trim(),
              role: 'node',
              access: 'local',
              label: 'local',
            },
            {
              host: peerHost.trim(),
              role: 'node',
              access: 'ssh',
              label: 'peer-1',
            },
          ]
        : [
            {
              host: localHost.trim(),
              role: primaryRole,
              access: 'local',
              label: primaryRole,
            },
            {
              host: peerHost.trim(),
              role: 'replica',
              access: 'ssh',
              label: 'replica-1',
            },
          ];
      if (peer3Host.trim()) {
        members.push({
          host: peer3Host.trim(),
          role: isGalera ? 'node' : 'replica',
          access: 'ssh',
          label: isGalera ? 'peer-2' : 'replica-2',
        });
      }
      const params: Record<string, string | number | boolean> = {};
      if (isGalera) {
        params.clusterName = name.trim() || 'ysk-galera';
        params.sstMethod = sst;
      } else if (kind === 'mysql-replica') {
        params.replUser = 'ysk_repl';
        params.serverIdBase = 100;
      } else if (kind === 'postgres-replica') {
        params.replUser = 'ysk_repl';
      } else if (kind.startsWith('redis')) {
        params.port = 6379;
        params.sentinelName = name.trim() || 'ysk-redis';
      }
      const created = await dbClusterApi.create({
        name: name.trim() || 'ysk-cluster',
        engine,
        kind,
        members,
        params,
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

  async function doProbe(id: string, peers = false) {
    await run(async () => {
      const r = await dbClusterApi.probe(id, { peers });
      setActiveId(id);
      setProbeFacts(r.facts ?? null);
      await refresh();
      return {
        ok: r.ok || r.localOk,
        notes: [
          ...(r.notes ?? []),
          `status=${r.cluster.status}`,
          peers
            ? `peersProbed=${r.peersProbed ?? 0}`
            : r.localOk
              ? '本機 OK'
              : '本機 probe 未過',
        ],
      } as OpsResultLike;
    }, peers ? '已探測（含 peer）' : '已探測本機');
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

      <Card>
        <CardSection
          title="叢集"
          description="計劃 → 寫管理檔 → 套用 → 探測 → peer 分發 / fleet。預設 dry-run。"
        >
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              disabled={busy || !wizardReady}
              onClick={() => {
                setError(null);
                setWizOpen(true);
              }}
            >
              {ctaLabel(kind)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => void refresh()}
            >
              重新整理
            </Button>
          </ActionBar>

          <DataTable
            columns={[
              {
                key: 'name',
                header: '名稱',
                render: (c) => <code className="inline">{c.name}</code>,
              },
              {
                key: 'kind',
                header: '類型',
                className: 'muted',
                nowrap: true,
                render: (c) => c.kind,
              },
              {
                key: 'status',
                header: '狀態',
                nowrap: true,
                render: (c) => (
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                ),
              },
              {
                key: 'members',
                header: '節點',
                className: 'muted',
                render: (c) => c.members.map((m) => m.host).join(', '),
              },
            ]}
            rows={items}
            rowKey={(c) => c.id}
            rowActions={(c) => (
              <ActionBar align="end">
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
                  onClick={() => void doProbe(c.id, false)}
                >
                  探測
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void doProbe(c.id, true)}
                >
                  全節點探測
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await dbClusterApi.installPeers(c.id, {
                        execute: false,
                      });
                      return {
                        ok: r.ok || r.dryRun,
                        dryRun: r.dryRun,
                        notes: r.notes,
                      } as OpsResultLike;
                    }, '遠端安裝計劃')
                  }
                >
                  遠端安裝計劃
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    setPendingConfirm({ kind: 'installPeers', id: c.id })
                  }
                >
                  遠端安裝
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
                  onClick={() => setPendingConfirm({ kind: 'push', id: c.id })}
                >
                  Push 執行
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await dbClusterApi.fleet(c.id, {
                        execute: false,
                        op: 'sync',
                      });
                      return {
                        ok: r.ok || r.dryRun,
                        dryRun: r.dryRun,
                        notes: r.notes,
                      } as OpsResultLike;
                    }, 'Fleet sync 計劃')
                  }
                >
                  Fleet 同步計劃
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    setPendingConfirm({ kind: 'fleetSync', id: c.id })
                  }
                >
                  Fleet 同步
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    setPendingConfirm({ kind: 'fleetApply', id: c.id })
                  }
                >
                  Fleet Apply
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  onClick={() => setPendingConfirm({ kind: 'remove', id: c.id })}
                >
                  刪除
                </Button>
              </ActionBar>
            )}
            empty={
              <EmptyState
                title="目前：單機"
                description={
                  isRepl
                    ? '未登記主從／串流。指定 primary/master + replica 後產生 conf 與腳本。'
                    : '未登記 HA。加 peer 節點後產生 conf 計劃，再分步 bootstrap / join。'
                }
                action={
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setWizOpen(true)}
                  >
                    {ctaLabel(kind)}
                  </Button>
                }
              />
            }
          />
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
        title={wizardTitle(kind)}
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
              label={isRepl ? 'Primary / Master IP' : '本機 IP／主機'}
              htmlFor="dbc-local"
              flush
              required
              hint={
                isRepl
                  ? '控制面所在機（primary/master + access=local）'
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
              label={isRepl ? 'Replica IP／主機' : 'Peer IP／主機'}
              htmlFor="dbc-peer"
              flush
              required
              hint={
                isRepl
                  ? '從庫節點'
                  : '第二節點（Galera 建議 3 節點）'
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
            <Field
              label="第 3 節點（可選）"
              htmlFor="dbc-peer3"
              flush
              hint="Galera / 多 replica 建議填"
            >
              <input
                id="dbc-peer3"
                value={peer3Host}
                onChange={(e) => setPeer3Host(e.target.value)}
                placeholder="例如 10.0.0.3"
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
                : kind === 'postgres-replica'
                  ? '串流需內網 5432；腳本密碼改 CHANGE_ME。'
                  : kind.startsWith('redis')
                    ? 'Redis 內網 6379（sentinel 26379）。'
                    : '主從需內網對應埠；腳本密碼改 CHANGE_ME。'}
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

      <ConfirmDialog
        open={pendingConfirm != null}
        onClose={() => !busy && setPendingConfirm(null)}
        title={
          pendingConfirm?.kind === 'remove'
            ? '刪除叢集登記？'
            : pendingConfirm?.kind === 'installPeers'
              ? '遠端安裝 peer？'
              : pendingConfirm?.kind === 'push'
                ? 'Push 到 peer？'
                : pendingConfirm?.kind === 'fleetSync'
                  ? 'Fleet 同步？'
                  : pendingConfirm?.kind === 'fleetApply'
                    ? 'Fleet Apply？'
                    : '確認操作'
        }
        description={
          pendingConfirm?.kind === 'remove'
            ? '系統 conf 唔會自動清（v1）。'
            : pendingConfirm?.kind === 'installPeers'
              ? '在 peer 上 install conf + restart。需 YSK_EXECUTE + SSH。'
              : pendingConfirm?.kind === 'push'
                ? 'scp 檔案到 peer /tmp？需 YSK_EXECUTE=1 與 SSH key。成功 ≠ peer 已 restart。'
                : pendingConfirm?.kind === 'fleetSync'
                  ? '同步 cluster 快照到 fleet 邊緣，再可 apply。'
                  : pendingConfirm?.kind === 'fleetApply'
                    ? 'enqueue apply 到 fleet 成員。'
                    : ''
        }
        confirmLabel="確認"
        cancelLabel="取消"
        danger={pendingConfirm?.kind === 'remove'}
        busy={busy}
        onConfirm={() => {
          const p = pendingConfirm;
          setPendingConfirm(null);
          if (!p) return;
          if (p.kind === 'remove') void removeCluster(p.id);
          else if (p.kind === 'installPeers') {
            void run(async () => {
              const r = await dbClusterApi.installPeers(p.id, { execute: true });
              return { ok: r.ok, notes: r.notes } as OpsResultLike;
            }, '遠端已安裝');
          } else if (p.kind === 'push') void pushPeers(p.id, true);
          else if (p.kind === 'fleetSync') {
            void run(async () => {
              const sync = await dbClusterApi.fleet(p.id, {
                execute: true,
                op: 'sync',
              });
              return { ok: sync.ok, notes: sync.notes } as OpsResultLike;
            }, 'Fleet 已同步排隊');
          } else if (p.kind === 'fleetApply') {
            void run(async () => {
              const r = await dbClusterApi.fleet(p.id, {
                execute: true,
                op: 'apply',
                edgeExecute: true,
              });
              return { ok: r.ok, notes: r.notes } as OpsResultLike;
            }, 'Fleet apply 已排隊');
          }
        }}
      />
    </div>
  );
}
