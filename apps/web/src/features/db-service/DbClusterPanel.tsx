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
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';

export function statusTone(
  s: string,
): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (s === 'healthy') return 'ok';
  if (s === 'planned' || s === 'draft' || s === 'partial') return 'warn';
  if (s === 'failed' || s === 'degraded') return 'danger';
  return 'neutral';
}

export function defaultKind(engine: DbServiceEngine): DbClusterKind {
  if (engine === 'mariadb') return 'mariadb-galera';
  if (engine === 'mysql') return 'mysql-replica';
  if (engine === 'postgres') return 'postgres-replica';
  return 'redis-replica';
}

export function wizardTitle(kind: DbClusterKind): string {
  if (kind === 'mariadb-galera') return i18n.t('db.cluster.kindGalera');
  if (kind === 'mysql-replica') return i18n.t('db.cluster.kindMysqlReplica');
  if (kind === 'postgres-replica') return i18n.t('db.cluster.kindPgReplica');
  if (kind === 'redis-sentinel') return 'Redis Sentinel';
  return i18n.t('db.cluster.kindRedisReplica');
}

export function ctaLabel(kind: DbClusterKind): string {
  if (kind === 'mariadb-galera') return i18n.t('db.cluster.createGalera');
  if (kind === 'mysql-replica') return i18n.t('db.cluster.createMysqlReplica');
  if (kind === 'postgres-replica') return i18n.t('db.cluster.createPgReplica');
  if (kind === 'redis-sentinel') return i18n.t('db.cluster.createSentinel');
  return i18n.t('db.cluster.createRedisReplica');
}

export function DbClusterPanel({ engine }: { engine: DbServiceEngine }) {
  const { t } = useTranslation();
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
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
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
      setError(t('db.cluster.needRealIps'));
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
          t('db.cluster.statusNote', { status: planned.cluster.status }),
          planned.cluster.artifactDir
            ? t('db.cluster.artifactNote', { dir: planned.cluster.artifactDir })
            : '',
        ].filter(Boolean),
      } as OpsResultLike;
    }, t('db.cluster.planGenerated'));
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
    }, t('db.cluster.planUpdated'));
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
    }, t('db.cluster.manageWritten'));
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
    }, bootstrap ? t('db.cluster.bootstrapTried') : t('db.cluster.applyTried'));
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
              ? t('db.cluster.localOk')
              : t('db.cluster.localProbeFail'),
        ],
      } as OpsResultLike;
    }, peers ? t('db.cluster.probedWithPeers') : t('db.cluster.probedLocal'));
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
        notes: [t('db.cluster.peerTarNote')],
      } as OpsResultLike;
    }, t('protection.downloaded'));
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
    }, execute ? t('db.cluster.peerPushed') : t('db.cluster.pushPlanGenerated'));
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
    }, t('db.cluster.registrationDeleted'));
  }

  return (
    <div className="stack-gap">
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <Card>
        <CardSection
          title={t('dns.tabs.cluster')}
          description={t('db.cluster.description')}
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
              {t('common.refresh')}
            </Button>
          </ActionBar>

          <DataTable
            columns={[
              {
                key: 'name',
                header: t('common.name'),
                render: (c) => <code className="inline">{c.name}</code>,
              },
              {
                key: 'kind',
                header: t('common.type'),
                className: 'muted',
                nowrap: true,
                render: (c) => c.kind,
              },
              {
                key: 'status',
                header: t('common.status'),
                nowrap: true,
                render: (c) => (
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                ),
              },
              {
                key: 'members',
                header: t('db.cluster.nodes'),
                className: 'muted',
                render: (c) => (c.members ?? []).map((m) => m.host).join(', '),
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
                  {t('db.cluster.plan')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void applyDry(c.id)}
                >
                  {t('db.cluster.writeFile')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => setApplyTarget({ id: c.id, bootstrap: false })}
                >
                  {t('db.cluster.applyLocal')}
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
                  {t('common.probe')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void doProbe(c.id, true)}
                >
                  {t('db.cluster.probeAll')}
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
                    }, t('db.cluster.remoteInstallPlan'))
                  }
                >
                  {t('db.cluster.remoteInstallPlan')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    setPendingConfirm({ kind: 'installPeers', id: c.id })
                  }
                >
                  {t('db.cluster.remoteInstall')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void downloadBundle(c.id)}
                >
                  {t('db.cluster.downloadBundle')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void pushPeers(c.id, false)}
                >
                  {t('db.cluster.pushPlan')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => setPendingConfirm({ kind: 'push', id: c.id })}
                >
                  {t('db.cluster.pushExecute')}
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
                    }, t('db.cluster.fleetSyncPlan'))
                  }
                >
                  {t('db.cluster.fleetSyncPlan')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    setPendingConfirm({ kind: 'fleetSync', id: c.id })
                  }
                >
                  {t('db.cluster.fleetSync')}
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
                  {t('common.delete')}
                </Button>
              </ActionBar>
            )}
            empty={
              <EmptyState
                title={t('db.cluster.standaloneTitle')}
                description={
                  isRepl
                    ? t('db.cluster.standaloneRepl')
                    : t('db.cluster.standaloneHa')
                }
              />
            }
          />
        </CardSection>
      </Card>

      {probeFacts && Object.keys(probeFacts).length > 0 ? (
        <Card>
          <CardSection title={t('db.cluster.recentProbe')} description={t('db.cluster.probeRequired')}>
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
            title={t('db.cluster.planPreview')}
            description={t('db.cluster.planPreviewDesc')}
          >
            <DescriptionList
              columns={2}
              items={[
                { label: 'cluster', value: lastPlan.clusterId.slice(0, 8) + '…' },
                {
                  label: t('common.steps'),
                  value: String(lastPlan.steps.length),
                },
                {
                  label: t('common.files'),
                  value: String(lastPlan.files.length),
                },
                {
                  label: t('db.systemChange'),
                  value: lastPlan.requiresExecute ? t('db.cluster.systemChangeNeed') : t('common.no'),
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
                <summary className="muted">{t('db.cluster.localConfPreview')}</summary>
                <pre className="ops-pre u-pre-wrap u-scroll-md">
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
        description={t('db.cluster.planModalDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setWizOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="dbc-wiz"
              variant="primary"
              size="md"
              loading={busy}
            >
              {t('db.cluster.generatePlan')}
            </Button>
          </>
        }
      >
        <form id="dbc-wiz" onSubmit={(e) => void onCreatePlan(e)}>
          <FormLayout columns={1}>
            <Field label={t('db.cluster.clusterName')} htmlFor="dbc-name" flush required>
              <input
                id="dbc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                spellCheck={false}
              />
            </Field>
            <Field
              label={isRepl ? 'Primary / Master IP' : t('db.cluster.localIp')}
              htmlFor="dbc-local"
              flush
              required
              hint={
                isRepl
                  ? t('db.cluster.primaryIpHint')
                  : t('db.cluster.localIpHint')
              }
            >
              <input
                id="dbc-local"
                value={localHost}
                onChange={(e) => setLocalHost(e.target.value)}
                placeholder={t('db.cluster.ipExample1')}
                required
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={isRepl ? t('db.cluster.replicaIp') : t('db.cluster.peerIp')}
              htmlFor="dbc-peer"
              flush
              required
              hint={
                isRepl
                  ? t('db.cluster.replicaHint')
                  : t('db.cluster.peerHint')
              }
            >
              <input
                id="dbc-peer"
                value={peerHost}
                onChange={(e) => setPeerHost(e.target.value)}
                placeholder={t('db.cluster.ipExample2')}
                required
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('db.cluster.thirdNode')}
              htmlFor="dbc-peer3"
              flush
              hint={t('db.cluster.thirdNodeHint')}
            >
              <input
                id="dbc-peer3"
                value={peer3Host}
                onChange={(e) => setPeer3Host(e.target.value)}
                placeholder={t('db.cluster.ipExample3')}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            {isGalera ? (
              <Field label={t('db.cluster.sstMethod')} htmlFor="dbc-sst" flush>
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
              {t('db.cluster.forbidDemoIp')}
              {isGalera
                ? t('db.cluster.fwGalera')
                : kind === 'postgres-replica'
                  ? t('db.cluster.fwPg')
                  : kind.startsWith('redis')
                    ? t('db.cluster.fwRedis')
                    : t('db.cluster.fwRepl')}
              {t('db.cluster.needExecuteRoot')}
            </FormHint>
          </FormLayout>
          <FormActions>
            <span className="muted u-text-sm">{t('db.cluster.topology', { kind })}</span>
          </FormActions>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(applyTarget)}
        onClose={() => setApplyTarget(null)}
        title={t('db.cluster.applyLocalTitle')}
        description={
          applyTarget?.bootstrap
            ? t('db.cluster.applyBootstrapDesc')
            : t('db.cluster.applyJoinDesc')
        }
        confirmLabel={t('db.cluster.confirmApply')}
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
            ? t('db.cluster.deleteClusterTitle')
            : pendingConfirm?.kind === 'installPeers'
              ? t('db.cluster.remoteInstallTitle')
              : pendingConfirm?.kind === 'push'
                ? t('db.cluster.pushTitle')
                : pendingConfirm?.kind === 'fleetSync'
                  ? t('db.cluster.fleetSyncTitle')
                  : pendingConfirm?.kind === 'fleetApply'
                    ? 'Fleet Apply？'
                    : t('db.cluster.confirmOp')
        }
        description={
          pendingConfirm?.kind === 'remove'
            ? t('db.cluster.deleteClusterDesc')
            : pendingConfirm?.kind === 'installPeers'
              ? t('db.cluster.remoteInstallDesc')
              : pendingConfirm?.kind === 'push'
                ? t('db.cluster.pushDesc')
                : pendingConfirm?.kind === 'fleetSync'
                  ? t('db.cluster.fleetSyncDesc')
                  : pendingConfirm?.kind === 'fleetApply'
                    ? t('db.cluster.fleetApplyDesc')
                    : ''
        }
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
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
            }, t('db.cluster.remoteInstalled'));
          } else if (p.kind === 'push') void pushPeers(p.id, true);
          else if (p.kind === 'fleetSync') {
            void run(async () => {
              const sync = await dbClusterApi.fleet(p.id, {
                execute: true,
                op: 'sync',
              });
              return { ok: sync.ok, notes: sync.notes } as OpsResultLike;
            }, t('db.cluster.fleetSynced'));
          } else if (p.kind === 'fleetApply') {
            void run(async () => {
              const r = await dbClusterApi.fleet(p.id, {
                execute: true,
                op: 'apply',
                edgeExecute: true,
              });
              return { ok: r.ok, notes: r.notes } as OpsResultLike;
            }, t('db.cluster.fleetApplyQueued'));
          }
        }}
      />
    </div>
  );
}
