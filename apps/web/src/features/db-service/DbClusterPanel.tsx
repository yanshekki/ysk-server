/**
 * Engine HA cluster panel — plan-first wizard.
 * MariaDB Galera + MySQL primary/replica. Mounted in ServiceConsole «叢集» tab.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  TableMore,
  buttonClassName } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import type { DbServiceEngine } from './api';
import {
  dbClusterApi,
  type ClusterPlan,
  type DbCluster,
  type DbClusterKind } from './cluster-api';
import { useFeatureAction } from '../system/useFeatureAction';
import { api } from '../../shared/services/api';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { bindSet, bindInput, bindVoid, bindCall1, bindCall2 } from '../../pages/bind-handlers';
import { agentsApi, type FleetAgent } from '../agents/api';
import { formatDateTime } from '../../shared/lib/datetime';
import { hostTimeZoneOpts } from '../../shared/lib/host-timezone';
import {
  CLUSTER_ENGINE_ORDER,
  clusterServicePath,
  clusterStatusLabel,
  clusterStatusTone,
  isStaleClusterPlan,
} from '../../pages/features/cluster-landing';

export { clusterStatusLabel };
export const statusTone = clusterStatusTone;

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

export function DbClusterPanel({
  engine,
  engineInstalled = true,
}: {
  engine: DbServiceEngine;
  engineInstalled?: boolean;
}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const fromClusterPath = params.get('from') === 'cluster';
  const [items, setItems] = useState<DbCluster[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wizOpen, setWizOpen] = useState(false);
  const [name, setName] = useState('ysk-cluster');
  const [localHost, setLocalHost] = useState('');
  const [peerHost, setPeerHost] = useState('');
  const [peer3Host, setPeer3Host] = useState('');
  const [fleetAgentId, setFleetAgentId] = useState('');
  const [sst, setSst] = useState('mariabackup');
  const [lastPlan, setLastPlan] = useState<ClusterPlan | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<{
    id: string;
    bootstrap: boolean;
  } | null>(null);
  const [fleetAgents, setFleetAgents] = useState<FleetAgent[]>([]);
  const [probeFacts, setProbeFacts] = useState<Record<string, string> | null>(null);
  const [otherClusters, setOtherClusters] = useState<
    Array<{ id: string; name: string; engine: string; status: string }>
  >([]);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'remove'; id: string; name: string; engine: string }
    | { kind: 'installPeers'; id: string }
    | { kind: 'push'; id: string }
    | { kind: 'fleetSync'; id: string }
    | { kind: 'fleetApply'; id: string }
    | { kind: 'clearStale' }
    | null
  >(null);
  const [wizFieldErr, setWizFieldErr] = useState<{
    name?: string;
    local?: string;
    peer?: string;
  }>({});
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await dbClusterApi.list(engine);
      setItems(r.items ?? []);
      try {
        const ov = await dbClusterApi.overview();
        setOtherClusters(
          (ov.items ?? []).filter((x) => x.engine !== engine).map((x) => ({
            id: x.id,
            name: x.name,
            engine: x.engine,
            status: x.status,
          })),
        );
      } catch {
        setOtherClusters([]);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void agentsApi
      .listFleet()
      .then((r) => setFleetAgents(r.items ?? []))
      .catch(() => setFleetAgents([]));
  }, []);

  const kind = defaultKind(engine);
  const wizardReady = engineInstalled;
  const isGalera = kind === 'mariadb-galera';
  const isRepl =
    kind === 'mysql-replica' ||
    kind === 'postgres-replica' ||
    kind === 'redis-replica' ||
    kind === 'redis-sentinel';

  async function onCreatePlan(e: FormEvent) {
    e.preventDefault();
    const nextErr: { name?: string; local?: string; peer?: string } = {};
    if (!name.trim()) nextErr.name = t('common.pleaseFill');
    if (!localHost.trim()) nextErr.local = t('common.pleaseFill');
    if (!peerHost.trim()) nextErr.peer = t('common.pleaseFill');
    if (nextErr.name || nextErr.local || nextErr.peer) {
      setWizFieldErr(nextErr);
      if (nextErr.local || nextErr.peer) setError(t('db.cluster.needRealIps'));
      return;
    }
    setWizFieldErr({});
    await run(async () => {
      const primaryRole =
        kind === 'redis-replica' || kind === 'redis-sentinel' ? 'master' : 'primary';
      const peerAccess = fleetAgentId.trim() ? 'fleet' : 'ssh';
      const members: Array<{
        host: string;
        role: string;
        access: 'local' | 'ssh' | 'fleet';
        label: string;
        fleetAgentId?: string;
      }> = isGalera
        ? [
            {
              host: localHost.trim(),
              role: 'node',
              access: 'local',
              label: 'local' },
            {
              host: peerHost.trim(),
              role: 'node',
              access: peerAccess,
              label: 'peer-1',
              fleetAgentId: fleetAgentId.trim() || undefined },
          ]
        : [
            {
              host: localHost.trim(),
              role: primaryRole,
              access: 'local',
              label: primaryRole },
            {
              host: peerHost.trim(),
              role: 'replica',
              access: peerAccess,
              label: 'replica-1',
              fleetAgentId: fleetAgentId.trim() || undefined },
          ];
      if (peer3Host.trim()) {
        members.push({
          host: peer3Host.trim(),
          role: isGalera ? 'node' : 'replica',
          access: 'ssh',
          label: isGalera ? 'peer-2' : 'replica-2' });
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
        params });
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
        ].filter(Boolean) } as OpsResultLike;
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
        notes: planned.plan.notes } as OpsResultLike;
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
        written: r.written } as OpsResultLike;
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
        requiresRoot: r.requiresRoot } as OpsResultLike;
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
        ] } as OpsResultLike;
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
        notes: [t('db.cluster.peerTarNote')] } as OpsResultLike;
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
        ] } as OpsResultLike;
    }, execute ? t('db.cluster.peerPushed') : t('db.cluster.pushPlanGenerated'));
  }

  const stalePlans = items.filter((c) => isStaleClusterPlan(c));

  async function clearStalePlans() {
    await run(async () => {
      const ids = items.filter((c) => isStaleClusterPlan(c)).map((c) => c.id);
      const notes: string[] = [];
      let ok = true;
      for (const id of ids) {
        const r = await dbClusterApi.remove(id);
        if (!r.ok) ok = false;
        notes.push(...(r.notes ?? []));
        if (activeId === id) {
          setActiveId(null);
          setLastPlan(null);
          setProbeFacts(null);
        }
      }
      await refresh();
      return { ok, notes } as OpsResultLike;
    }, t('db.cluster.registrationDeleted'));
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
      {fromClusterPath ? (
        <>
          <Alert variant="info">{t('db.cluster.redirectedFromCluster')}</Alert>
          <ActionBar className="u-mb-3">
            {CLUSTER_ENGINE_ORDER.map((eng) => (
              <Link
                key={eng}
                to={clusterServicePath(eng)}
                className={buttonClassName({
                  variant: eng === engine ? 'primary' : 'secondary',
                  size: 'sm',
                })}
              >
                {t('db.cluster.openEngine', { engine: eng })}
              </Link>
            ))}
          </ActionBar>
        </>
      ) : null}
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={bindSet(setMsg, null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <Card>
        <CardSection
          title={t('dns.tabs.cluster')}
          description={t('db.cluster.description')}
        >
          {!engineInstalled ? (
            <Alert variant="warn">
              {t('db.cluster.engineNotInstalled', { engine })}
            </Alert>
          ) : null}
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              disabled={busy || !wizardReady}
              title={
                wizardReady
                  ? t('db.cluster.createWizardTitle')
                  : t('db.cluster.engineNotInstalled', { engine })
              }
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
              onClick={bindVoid(refresh)}
            >
              {t('common.refresh')}
            </Button>
            {stalePlans.length > 0 ? (
              <Button
                variant="danger"
                size="md"
                loading={busy}
                title={t('db.cluster.clearStalePlansTitle')}
                onClick={() => setPendingConfirm({ kind: 'clearStale' })}
              >
                {t('db.cluster.clearStalePlans')}
              </Button>
            ) : null}
          </ActionBar>

          <DataTable
            columns={[
              {
                key: 'name',
                header: t('common.name'),
                render: (c) => <code className="inline">{c.name}</code> },
              {
                key: 'kind',
                header: t('common.type'),
                className: 'muted',
                nowrap: true,
                render: (c) => c.kind },
              {
                key: 'status',
                header: t('common.status'),
                nowrap: true,
                render: (c) => (
                  <span title={c.notes?.[0]}>
                    <Badge tone={statusTone(c.status)}>
                      {clusterStatusLabel(c.status, t)}
                    </Badge>
                    {c.status === 'planned' || c.status === 'draft' ? (
                      <span className="muted u-text-sm">
                        {' · '}
                        {t('db.cluster.notApplied')}
                        {c.createdAt
                          ? ` · ${t('db.cluster.plannedAt', {
                              when: formatDateTime(c.createdAt, hostTimeZoneOpts()),
                            })}`
                          : ''}
                      </span>
                    ) : null}
                    {c.status === 'failed' && c.notes?.[0] ? (
                      <span className="muted u-text-sm"> · {c.notes[0]}</span>
                    ) : null}
                  </span>
                ) },
              {
                key: 'members',
                header: t('db.cluster.nodes'),
                className: 'muted',
                render: (c) =>
                  (c.members ?? [])
                    .map((m) => {
                      const host = String(m.host ?? '')
                        .replace(/\s*\(none\)/gi, '')
                        .trim();
                      const roleRaw = String((m as { role?: string }).role ?? '').trim();
                      const role =
                        !roleRaw || roleRaw === 'none' || roleRaw === '(none)'
                          ? t('db.cluster.roleUnassigned')
                          : roleRaw;
                      const base = host ? `${host} · ${role}` : role;
                      return m.applyStatus && m.applyStatus !== 'applied'
                        ? `${base}（${clusterStatusLabel(m.applyStatus, t)}）`
                        : base;
                    })
                    .join(', ') },
            ]}
            rows={items}
            rowKey={(c) => c.id}
            rowActions={(c) => (
              <ActionBar align="end" wrap={false}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  title={t('db.cluster.planTitle')}
                  onClick={bindCall1(replan, c.id)}
                >
                  {t('db.cluster.plan')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  title={t('db.cluster.probeLocalTitle')}
                  onClick={bindCall2(doProbe, c.id, false)}
                >
                  {t('common.probe')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  title={t('db.cluster.applyLocalTitle')}
                  onClick={() => setApplyTarget({ id: c.id, bootstrap: false })}
                >
                  {t('db.cluster.applyLocal')}
                </Button>
                <TableMore label={t('common.more')}>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.writeFileTitle')}
                      onClick={bindCall1(applyDry, c.id)}
                    >
                      {t('db.cluster.writeFile')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.bootstrapTitle')}
                      onClick={() => setApplyTarget({ id: c.id, bootstrap: true })}
                    >
                      {t('db.cluster.bootstrap')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.probeAllTitle')}
                      onClick={bindCall2(doProbe, c.id, true)}
                    >
                      {t('db.cluster.probeAll')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.remoteInstallPlanTitle')}
                      onClick={() =>
                        void run(async () => {
                          const r = await dbClusterApi.installPeers(c.id, {
                            execute: false });
                          return {
                            ok: r.ok || r.dryRun,
                            dryRun: r.dryRun,
                            notes: r.notes } as OpsResultLike;
                        }, t('db.cluster.remoteInstallPlan'))
                      }
                    >
                      {t('db.cluster.remoteInstallPlan')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.remoteInstallTitle')}
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
                      title={t('db.cluster.downloadBundleTitle')}
                      onClick={bindCall1(downloadBundle, c.id)}
                    >
                      {t('db.cluster.downloadBundle')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.pushPlanTitle')}
                      onClick={bindCall2(pushPeers, c.id, false)}
                    >
                      {t('db.cluster.pushPlan')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.pushTitle')}
                      onClick={() => setPendingConfirm({ kind: 'push', id: c.id })}
                    >
                      {t('db.cluster.pushExecute')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.fleetSyncPlanTitle')}
                      onClick={() =>
                        void run(async () => {
                          const r = await dbClusterApi.fleet(c.id, {
                            execute: false,
                            op: 'sync' });
                          return {
                            ok: r.ok || r.dryRun,
                            dryRun: r.dryRun,
                            notes: r.notes } as OpsResultLike;
                        }, t('db.cluster.fleetSyncPlan'))
                      }
                    >
                      {t('db.cluster.fleetSyncPlan')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.fleetSyncTitle')}
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
                      title={t('db.cluster.fleetApplyTitle')}
                      onClick={() =>
                        setPendingConfirm({ kind: 'fleetApply', id: c.id })
                      }
                    >
                      {t('db.cluster.fleetApply')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      title={t('db.cluster.deleteClusterTitle', {
                        name: c.name,
                        engine: c.engine || engine,
                      })}
                      data-confirm={c.name}
                      onClick={() =>
                        setPendingConfirm({
                          kind: 'remove',
                          id: c.id,
                          name: c.name,
                          engine: c.engine || engine,
                        })
                      }
                    >
                      {t('common.delete')}
                    </Button>
                </TableMore>
              </ActionBar>
            )}
            empty={
              <EmptyState
                title={t('db.cluster.standaloneTitle')}
                description={
                  otherClusters.length
                    ? t('db.cluster.standaloneOtherEngines', {
                        names: otherClusters
                          .map((c) => `${c.name}（${c.engine}）`)
                          .join(' · '),
                      })
                    : isRepl
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
                  value: String(lastPlan.steps.length) },
                {
                  label: t('common.files'),
                  value: String(lastPlan.files.length) },
                {
                  label: t('db.systemChange'),
                  value: lastPlan.requiresExecute ? t('db.cluster.systemChangeNeed') : t('common.no') },
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
        onClose={bindSet(setWizOpen, false)}
        title={wizardTitle(kind)}
        description={t('db.cluster.planModalDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setWizOpen, false)}>
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
        <form id="dbc-wiz" noValidate onSubmit={(e) => void onCreatePlan(e)}>
          <FormLayout columns={1}>
            <Field
              label={t('db.cluster.clusterName')}
              htmlFor="dbc-name"
              flush
              required
              error={wizFieldErr.name}
            >
              <input
                id="dbc-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (wizFieldErr.name) setWizFieldErr((p) => ({ ...p, name: undefined }));
                }}
                spellCheck={false}
              />
            </Field>
            <Field
              label={isRepl ? 'Primary / Master IP' : t('db.cluster.localIp')}
              htmlFor="dbc-local"
              flush
              required
              error={wizFieldErr.local}
              hint={
                isRepl
                  ? t('db.cluster.primaryIpHint')
                  : t('db.cluster.localIpHint')
              }
            >
              <input
                id="dbc-local"
                value={localHost}
                onChange={(e) => {
                  setLocalHost(e.target.value);
                  if (wizFieldErr.local) setWizFieldErr((p) => ({ ...p, local: undefined }));
                }}
                placeholder={t('db.cluster.ipExample1')}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={isRepl ? t('db.cluster.replicaIp') : t('db.cluster.peerIp')}
              htmlFor="dbc-peer"
              flush
              required
              error={wizFieldErr.peer}
              hint={
                isRepl
                  ? t('db.cluster.replicaHint')
                  : t('db.cluster.peerHint')
              }
            >
              <input
                id="dbc-peer"
                value={peerHost}
                onChange={(e) => {
                  setPeerHost(e.target.value);
                  if (wizFieldErr.peer) setWizFieldErr((p) => ({ ...p, peer: undefined }));
                }}
                placeholder={t('db.cluster.ipExample2')}
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
                onChange={bindInput(setPeer3Host)}
                placeholder={t('db.cluster.ipExample3')}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('db.cluster.fleetSession')}
              htmlFor="dbc-fleet"
              flush
              hint={t('db.cluster.fleetSessionHint')}
            >
              <select
                id="dbc-fleet"
                value={fleetAgentId}
                onChange={(e) => setFleetAgentId(e.target.value)}
              >
                <option value="">{t('db.cluster.fleetSessionNone')}</option>
                {fleetAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.agent_id} · {a.id}
                  </option>
                ))}
              </select>
              <FormHint>
                <Link to="/agents">{t('db.cluster.fleetSessionOpenAgents')}</Link>
              </FormHint>
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
        onClose={bindSet(setApplyTarget, null)}
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
        dataConfirm={
          pendingConfirm?.kind === 'remove' ? pendingConfirm.name : undefined
        }
        title={
          pendingConfirm?.kind === 'remove'
            ? t('db.cluster.deleteClusterTitle', {
                name: pendingConfirm.name,
                engine: pendingConfirm.engine,
              })
            : pendingConfirm?.kind === 'clearStale'
              ? t('db.cluster.clearStalePlansTitle')
            : pendingConfirm?.kind === 'installPeers'
              ? t('db.cluster.remoteInstallTitle')
              : pendingConfirm?.kind === 'push'
                ? t('db.cluster.pushTitle')
                : pendingConfirm?.kind === 'fleetSync'
                  ? t('db.cluster.fleetSyncTitle')
                  : pendingConfirm?.kind === 'fleetApply'
                    ? t('db.cluster.fleetApplyTitle')
                    : t('db.cluster.confirmOp')
        }
        description={
          pendingConfirm?.kind === 'remove'
            ? t('db.cluster.deleteClusterDesc', {
                name: pendingConfirm.name,
                engine: pendingConfirm.engine,
              })
            : pendingConfirm?.kind === 'clearStale'
              ? t('db.cluster.clearStalePlansDesc', { n: stalePlans.length })
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
        danger={pendingConfirm?.kind === 'remove' || pendingConfirm?.kind === 'clearStale'}
        busy={busy}
        onConfirm={() => {
          const p = pendingConfirm;
          setPendingConfirm(null);
          if (!p) return;
          if (p.kind === 'remove') void removeCluster(p.id);
          if (p.kind === 'clearStale') void clearStalePlans();
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
                op: 'sync' });
              return { ok: sync.ok, notes: sync.notes } as OpsResultLike;
            }, t('db.cluster.fleetSynced'));
          } else if (p.kind === 'fleetApply') {
            void run(async () => {
              const r = await dbClusterApi.fleet(p.id, {
                execute: true,
                op: 'apply',
                edgeExecute: true });
              return { ok: r.ok, notes: r.notes } as OpsResultLike;
            }, t('db.cluster.fleetApplyQueued'));
          }
        }}
      />
    </div>
  );
}
