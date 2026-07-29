/**
 * Engine HA cluster panel — plan-first Galera wizard (v1).
 * Mounted inside ServiceConsole «叢集» tab.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  OpsResultPanel,
  PresetChips,
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
  const galeraReady = engine === 'mariadb';

  async function onCreatePlan(e: FormEvent) {
    e.preventDefault();
    if (!localHost.trim() || !peerHost.trim()) {
      setError('請填寫本機與 peer 真實 IP／主機名');
      return;
    }
    await run(async () => {
      const created = await dbClusterApi.create({
        name: name.trim() || 'ysk-cluster',
        engine,
        kind,
        members: [
          { host: localHost.trim(), role: 'node', access: 'local', label: 'local' },
          { host: peerHost.trim(), role: 'node', access: 'ssh', label: 'peer-1' },
        ],
        params:
          kind === 'mariadb-galera'
            ? { clusterName: name.trim() || 'ysk-galera', sstMethod: sst }
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

  async function removeCluster(id: string) {
    if (!confirm('刪除叢集登記？系統 conf 唔會自動清（v1）。')) return;
    await run(async () => {
      const r = await dbClusterApi.remove(id);
      if (activeId === id) {
        setActiveId(null);
        setLastPlan(null);
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

      {!galeraReady ? (
        <Alert variant="info">
          此引擎的簡易 HA（{kind}）計劃器會喺後續版本開放。而家可先用{' '}
          <strong>MariaDB 服務 → 叢集</strong> 做 Galera 計劃。
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
              disabled={busy || !galeraReady}
              onClick={() => {
                setError(null);
                setWizOpen(true);
              }}
            >
              建立簡易 Galera
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
              description="未登記 HA。加 peer 節點後產生 conf 計劃，再分步 bootstrap / join。"
              action={
                galeraReady ? (
                  <Button variant="primary" size="md" onClick={() => setWizOpen(true)}>
                    建立簡易 Galera
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
        title="簡易 Galera"
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
              label="本機 IP／主機"
              htmlFor="dbc-local"
              flush
              required
              hint="控制面所在機（access=local）"
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
              label="Peer IP／主機"
              htmlFor="dbc-peer"
              flush
              required
              hint="第二節點；生產建議再加第三節點（稍後可擴）"
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
            <FormHint>
              禁止示範 IP（203.0.113.x）。防火牆只對內網開 3306 / 4567 / 4444 /
              4568。套用系統 conf 需 YSK_EXECUTE（後續版本）。
            </FormHint>
            <PresetChips
              options={[
                { value: 'hint', label: '最少 2 節點' },
                { value: 'hint2', label: '先計劃後 bootstrap' },
              ]}
              value=""
              onChange={() => undefined}
            />
          </FormLayout>
          <FormActions>
            <span className="muted u-text-sm">拓撲：{kind}</span>
          </FormActions>
        </form>
      </Modal>
    </div>
  );
}
