/**
 * Docker — engine, containers, images, compose, volumes, networks, prune, settings.
 * Selection-first forms. Install-first when the engine is missing.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  buttonClassName,
  Card,
  CardHeader,
  CheckboxField,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  Form,
  FormActions,
  FormHint,
  InfoCard,
  InfoCardGrid,
  LoadingBlock,
  JsonViewer,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  type OpsResultLike,
} from '../../shared/components/ui';
import { ServiceLifecycleBar } from '../../features/system/ServiceLifecycleBar';
import { useOpsStreamOptional } from '../../shared/ops-stream/OpsStreamContext';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  dockerApi,
  type DockerComposeProject,
  type DockerContainerRow,
  type DockerDaemonSettings,
  type DockerDfRow,
  type DockerEngineStatus,
  type DockerImageRow,
  type DockerNetworkRow,
  type DockerOpsResponse,
  type DockerVolumeRow,
} from '../../features/docker';
import { validatorsApi } from '../../features/validators';
import { isSafeDockerName, parseDockerArgvLine } from 'ysk-server-shared';

const TABS = [
  'overview',
  'containers',
  'images',
  'compose',
  'volumes',
  'networks',
  'prune',
  'settings',
  'about',
] as const;

const IMAGE_PRESETS = [
  'alpine:3.20',
  'nginx:alpine',
  'redis:7-alpine',
  'busybox:1.36',
  'hello-world',
] as const;

const DEST_PRESETS = ['/data', '/app', '/var/www', '/tmp'] as const;
const LOG_SIZES = ['1m', '10m', '20m', '50m', '100m'] as const;
const CUSTOM = '__custom__';

type DockerDelete =
  | { kind: 'container'; token: string; state?: string }
  | { kind: 'image'; token: string; id: string }
  | { kind: 'volume'; token: string }
  | { kind: 'network'; token: string }
  | { kind: 'compose'; token: string; project: string; validatorId: string | null };

const PORT_PRESETS = [
  { id: '80', host: 80, container: 80, label: '80:80' },
  { id: '443', host: 443, container: 443, label: '443:443' },
  { id: '8080', host: 8080, container: 80, label: '8080:80' },
  { id: '3000', host: 3000, container: 3000, label: '3000:3000' },
] as const;

function formatGiB(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n / 1024 ** 3).toFixed(1)} GiB`;
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function imageRef(row: DockerImageRow): string {
  return `${row.repository}:${row.tag}`;
}

function canonImageRef(ref: string): string {
  return ref.replace(/:latest$/, '');
}

function isValidatorImage(ref: string): boolean {
  return /avalanchego|gaia|bitcoind|cardano|yskval|polkadot|solana|agave/i.test(ref);
}

function loopbackHref(ports: string): string | null {
  const m = String(ports ?? '').match(/127\.0\.0\.1:(\d+)/);
  return m ? `http://127.0.0.1:${m[1]}/` : null;
}

const DOCKER_STATE_KEYS = [
  'running',
  'exited',
  'restarting',
  'paused',
  'created',
  'dead',
  'removing',
] as const;

export function dockerStateKey(state: string | undefined): (typeof DOCKER_STATE_KEYS)[number] | 'unknown' {
  const s = String(state ?? '').toLowerCase();
  return (DOCKER_STATE_KEYS as readonly string[]).includes(s)
    ? (s as (typeof DOCKER_STATE_KEYS)[number])
    : 'unknown';
}

export function parseRestartCount(status: string | undefined): number | null {
  const m = String(status ?? '').match(/Restarting\s*\((\d+)\)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function canStopContainer(state: string | undefined): boolean {
  const s = String(state ?? '').toLowerCase();
  return s === 'running' || s === 'restarting' || s === 'paused';
}

export function dockerDfTypeKey(type: string | undefined): 'images' | 'containers' | 'volumes' | 'builder' | 'other' {
  const n = String(type ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (n.includes('image')) return 'images';
  if (n.includes('container')) return 'containers';
  if (n.includes('volume')) return 'volumes';
  if (n.includes('build') || n.includes('cache')) return 'builder';
  return 'other';
}

export function DockerPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const [status, setStatus] = useState<DockerEngineStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [containers, setContainers] = useState<DockerContainerRow[]>([]);
  const [images, setImages] = useState<DockerImageRow[]>([]);
  const [volumes, setVolumes] = useState<DockerVolumeRow[]>([]);
  const [networks, setNetworks] = useState<DockerNetworkRow[]>([]);
  const [compose, setCompose] = useState<DockerComposeProject[]>([]);
  const [df, setDf] = useState<DockerDfRow[]>([]);
  const [daemon, setDaemon] = useState<DockerDaemonSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<OpsResultLike | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logTitle, setLogTitle] = useState('');
  const [logId, setLogId] = useState('');
  const [logFollow, setLogFollow] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DockerDelete | null>(null);
  const [pendingPrune, setPendingPrune] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [runImage, setRunImage] = useState<string>(IMAGE_PRESETS[0]);
  const [runName, setRunName] = useState('');
  const [runPublish, setRunPublish] = useState(false);
  const [runPortIds, setRunPortIds] = useState<string[]>([]);
  const [runCustomPort, setRunCustomPort] = useState(false);
  const [runHostPort, setRunHostPort] = useState('8080');
  const [runCtrPort, setRunCtrPort] = useState('80');
  const [runEnvOn, setRunEnvOn] = useState(false);
  const [runEnv, setRunEnv] = useState('');
  const [runRestart, setRunRestart] = useState('no');
  const [runNetwork, setRunNetwork] = useState('');
  const [runNetKind, setRunNetKind] = useState<'default' | 'bridge'>('default');
  const [runAttachVol, setRunAttachVol] = useState(false);
  const [runVolName, setRunVolName] = useState('');
  const [runVolDest, setRunVolDest] = useState<string>(DEST_PRESETS[0]);
  const [runVolDestCustom, setRunVolDestCustom] = useState('');
  const [pullImage, setPullImage] = useState<string>(IMAGE_PRESETS[0]);
  const [pullCustom, setPullCustom] = useState('');
  const [runCustom, setRunCustom] = useState('');
  const [volName, setVolName] = useState('');
  const [netName, setNetName] = useState('');
  const [pruneScope, setPruneScope] = useState('containers');
  const [logMaxSize, setLogMaxSize] = useState('10m');
  const [liveRestore, setLiveRestore] = useState(false);
  const [useMirrors, setUseMirrors] = useState(false);
  const [useInsecure, setUseInsecure] = useState(false);
  const [mirrors, setMirrors] = useState('');
  const [insecure, setInsecure] = useState('');
  const [inspectValue, setInspectValue] = useState<unknown>(null);
  const [inspectSummary, setInspectSummary] = useState('');
  const [daemonConfirm, setDaemonConfirm] = useState(false);
  const [runCommand, setRunCommand] = useState('');
  const [runEntrypoint, setRunEntrypoint] = useState('');
  const [runCmdErr, setRunCmdErr] = useState<string | null>(null);
  const [runNewVol, setRunNewVol] = useState('');
  const [volErr, setVolErr] = useState<string | null>(null);
  const stream = useOpsStreamOptional();

  const engineInstalled = status?.installed === true;
  const needEngine = t('docker.needEngineTitle');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [st, c, i, v, n, p, d, dm] = await Promise.all([
        dockerApi.status(),
        dockerApi.containers(),
        dockerApi.images(),
        dockerApi.volumes(),
        dockerApi.networks(),
        dockerApi.compose(),
        dockerApi.df(),
        dockerApi.daemon(),
      ]);
      setStatus(st.status ?? null);
      setContainers(c.items ?? []);
      setImages(i.items ?? []);
      setVolumes(v.items ?? []);
      setNetworks(n.items ?? []);
      setCompose(p.items ?? []);
      setDf(d.items ?? []);
      setDaemon(dm.daemon ?? null);
      if (dm.daemon) {
        setLogMaxSize(dm.daemon.logMaxSize);
        setLiveRestore(dm.daemon.liveRestore);
        const m = (dm.daemon.registryMirrors ?? []).join('\n');
        const ins = (dm.daemon.insecureRegistries ?? []).join('\n');
        setMirrors(m);
        setInsecure(ins);
        setUseMirrors(Boolean(m.trim()));
        setUseInsecure(Boolean(ins.trim()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOps(null);
    setError(null);
  }, [tab]);

  useEffect(() => {
    if (!loaded) return;
    if (!engineInstalled && tab !== 'overview' && tab !== 'about') setTab('overview');
  }, [loaded, engineInstalled, tab, setTab]);

  const imageChoices = useMemo(() => {
    const seen = new Set<string>(IMAGE_PRESETS.map(canonImageRef));
    const extra: string[] = [];
    for (const row of images) {
      const ref = imageRef(row);
      if (!ref || ref.includes('<none>')) continue;
      const canon = canonImageRef(ref);
      if (seen.has(canon) || seen.has(ref)) continue;
      seen.add(canon);
      extra.push(ref);
    }
    return [...IMAGE_PRESETS, ...extra.slice(0, 8)];
  }, [images]);

  const pullValue = imageChoices.includes(pullImage) ? pullImage : CUSTOM;
  const runImageValue = imageChoices.includes(runImage) ? runImage : CUSTOM;
  const resolvedPull = pullValue === CUSTOM ? pullCustom.trim() : pullImage;
  const resolvedRunImage = runImageValue === CUSTOM ? runCustom.trim() : runImage;

  const bridgeNets = useMemo(() => {
    const list = networks.filter((n) => !n.protected && n.name !== 'host' && n.name !== 'none');
    const hasBridge = list.some((n) => n.name === 'bridge') || networks.some((n) => n.name === 'bridge');
    if (hasBridge || list.some((n) => n.name === 'bridge')) return list.length ? list : networks.filter((n) => n.name === 'bridge');
    return [
      {
        name: 'bridge',
        id: 'bridge',
        driver: 'bridge',
        scope: 'local',
        internal: false,
        protected: true,
      },
      ...list,
    ];
  }, [networks]);

  const run = async (
    fn: () => Promise<DockerOpsResponse>,
    streamTitle?: string,
    streamPath?: string,
    streamBody?: Record<string, unknown>,
  ) => {
    setBusy(true);
    const job = streamTitle && stream ? stream.begin({ kind: 'apply', title: streamTitle }) : null;
    try {
      if (job) stream?.appendLog(job.id, { stream: 'status', line: streamTitle ?? '' });
      let r: DockerOpsResponse;
      if (job && streamPath) {
        const streamed = await dockerApi.stream(streamPath, streamBody ?? { execute: true }, {
          onLog: (line) => stream?.appendLog(job.id, line),
          signal: job.signal,
        });
        r = {
          ok: streamed.ops.ok !== false,
          blocked: streamed.ops.blocked,
          notes: streamed.ops.notes,
          blockMessage: streamed.ops.blockMessage,
          apply_status: (streamed.raw as DockerOpsResponse | null)?.apply_status,
        };
      } else {
        r = await fn();
      }
      setOps({
        ok: r.ok,
        blocked: r.blocked,
        apply_status: r.apply_status as OpsResultLike['apply_status'],
        notes: r.notes ?? [],
        blockMessage: r.blockMessage,
      });
      if (job) {
        for (const n of r.notes ?? []) {
          stream?.appendLog(job.id, { stream: 'stdout', line: n });
        }
        stream?.finish(job.id, { ok: r.ok !== false && !r.blocked, error: r.blockMessage, toast: false });
      }
      await load();
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (job) stream?.finish(job.id, { ok: false, error: msg, toast: false });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const fetchLogs = async (id: string) => {
    const r = await dockerApi.logs(id);
    setLogs(r.lines ?? []);
  };

  const openLogs = async (id: string) => {
    setInspectValue(null);
    setInspectSummary('');
    setLogs(null);
    setLogId(id);
    setLogTitle(id);
    setLogFollow(false);
    await fetchLogs(id);
  };

  useEffect(() => {
    if (!logFollow || !logId) return;
    const tick = () => {
      void fetchLogs(logId);
    };
    const timer = window.setInterval(tick, 3000);
    return () => window.clearInterval(timer);
  }, [logFollow, logId]);

  const collectedPorts = () => {
    if (!runPublish) return [];
    const ports: Array<{ host: number; container: number; proto: 'tcp' }> = PORT_PRESETS.filter(
      (p) => runPortIds.includes(p.id),
    ).map((p) => ({
      host: p.host,
      container: p.container,
      proto: 'tcp' as const,
    }));
    if (runCustomPort) {
      const host = Number(runHostPort);
      const container = Number(runCtrPort);
      if (Number.isFinite(host) && Number.isFinite(container) && host > 0 && container > 0) {
        ports.push({ host, container, proto: 'tcp' as const });
      }
    }
    return ports;
  };

  const onRun = async (e: FormEvent) => {
    e.preventDefault();
    if (!engineInstalled) return;
    const image = resolvedRunImage.trim();
    if (!image) return;
    setRunCmdErr(null);
    const cmd = runCommand.trim() ? parseDockerArgvLine(runCommand) : [];
    if (runCommand.trim() && !cmd) {
      setRunCmdErr(t('docker.errors.badCommand'));
      return;
    }
    const ep = runEntrypoint.trim();
    if (ep && (!parseDockerArgvLine(ep) || parseDockerArgvLine(ep)!.length !== 1)) {
      setRunCmdErr(t('docker.errors.badCommand'));
      return;
    }
    const env = runEnvOn ? parseEnv(runEnv) : {};
    const dest = runVolDest === CUSTOM ? runVolDestCustom.trim() : runVolDest;
    let volName = runVolName;
    if (runAttachVol && runNewVol.trim()) {
      if (!isSafeDockerName(runNewVol.trim())) {
        setRunCmdErr(t('docker.errors.badName'));
        return;
      }
      const created = await run(() => dockerApi.createVolume(runNewVol.trim()));
      if (!created?.ok) return;
      volName = runNewVol.trim();
    }
    const r = await run(() =>
      dockerApi.run({
        image,
        name: runName.trim() || undefined,
        ports: collectedPorts(),
        env: Object.keys(env).length ? env : undefined,
        restart: (runRestart || 'no') as 'no' | 'always' | 'unless-stopped' | 'on-failure',
        network: runNetwork.trim() || undefined,
        volumes: runAttachVol && volName && dest ? [{ name: volName, dest }] : [],
        command: cmd && cmd.length ? cmd : undefined,
        entrypoint: ep || undefined,
      }),
    );
    if (r?.ok) setRunOpen(false);
  };

  const visibleTabs = engineInstalled ? TABS : (['overview', 'about'] as const);
  const diskPct = status?.disk.usePct;
  const meterTone =
    diskPct != null && diskPct >= 90 ? 'danger' : diskPct != null && diskPct >= 75 ? 'warn' : 'ok';

  const imageOptions = [
    ...imageChoices.map((value) => ({
      value,
      label: isValidatorImage(value) ? `${value} · ${t('docker.ui.validatorImage')}` : value,
    })),
    { value: CUSTOM, label: t('docker.ui.imageCustom') },
  ];

  return (
    <FeaturePageLayout
      title={t('docker.title')}
      subtitle={t('docker.subtitle')}
      actions={
        <Button size="sm" onClick={() => void load()} disabled={busy}>
          {t('docker.refresh')}
        </Button>
      }
      status={{
        pill: !loaded
          ? undefined
          : !engineInstalled
            ? { label: t('docker.notInstalledValue'), tone: 'warn' }
            : status?.daemonActive
              ? { label: t('docker.state.up'), tone: 'ok' }
              : { label: t('docker.state.down'), tone: 'warn' },
        items: !loaded
          ? []
          : engineInstalled
            ? [
                {
                  label: t('docker.col.engine'),
                  value: status?.daemonActive ? t('docker.state.up') : t('docker.state.down'),
                  tone: status?.daemonActive ? 'ok' : 'warn',
                },
                {
                  label: t('docker.ui.running'),
                  value: `${status?.counts.running ?? 0} / ${status?.counts.containers ?? 0}`,
                },
                {
                  label: t('docker.ui.images'),
                  value: String(status?.counts.images ?? images.length),
                },
                {
                  label: t('docker.col.disk'),
                  value:
                    status?.disk.usedBytes != null
                      ? `${formatGiB(status.disk.usedBytes)}${
                          diskPct != null ? ` · ${Math.round(diskPct)}%` : ''
                        }`
                      : '—',
                  tone: meterTone === 'ok' ? undefined : meterTone,
                },
              ]
            : [
                {
                  label: t('docker.col.engine'),
                  value: t('docker.notInstalledValue'),
                  tone: 'warn',
                },
              ],
      }}
    >
      {loaded && !engineInstalled ? (
        <SoftwareInstallBanner
          feature="docker"
          title={t('docker.notInstalled')}
          showReadyActions={false}
          onInstalled={() => void load()}
        />
      ) : null}
      {engineInstalled ? (
        <ServiceLifecycleBar
          unit="docker"
          label="Docker"
          installed={engineInstalled}
          running={status?.daemonActive === true}
          danger="edge"
          onDone={() => void load()}
          stopDetail={t('docker.stopEngineDesc', { n: containers.length })}
        />
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {ops ? <OpsResultPanel title={t('docker.title')} result={ops} /> : null}

      <PageTabs
        tabs={visibleTabs.map((id) => ({
          id,
          label: id === 'about' ? t('common.about') : t(`docker.tab.${id}`),
          badge:
            engineInstalled && id === 'containers'
              ? containers.length || undefined
              : engineInstalled && id === 'images'
                ? images.length || undefined
                : undefined,
        }))}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="dock-stack">
            {!loaded ? <LoadingBlock /> : null}
            {loaded && !engineInstalled ? (
              <Card>
                <CardHeader title={t('docker.ui.whatYouGet')} description={t('docker.ui.whatYouGetLead')} />
                <div className="dock-caps">
                  <div className="dock-cap">
                    <h3 className="dock-cap__title">{t('docker.ui.capEngine')}</h3>
                    <p className="dock-cap__desc">{t('docker.ui.capEngineDesc')}</p>
                  </div>
                  <div className="dock-cap">
                    <h3 className="dock-cap__title">{t('docker.ui.capWork')}</h3>
                    <p className="dock-cap__desc">{t('docker.ui.capWorkDesc')}</p>
                  </div>
                  <div className="dock-cap">
                    <h3 className="dock-cap__title">{t('docker.ui.capStacks')}</h3>
                    <p className="dock-cap__desc">{t('docker.ui.capStacksDesc')}</p>
                  </div>
                </div>
              </Card>
            ) : null}
            {loaded && engineInstalled && status && !status.daemonActive ? (
              <Alert variant="warn">{t('docker.alerts.daemonBody')}</Alert>
            ) : null}
            {loaded && engineInstalled && status ? (
              <>
                <InfoCardGrid cols={3}>
                  <InfoCard
                    title={t('docker.ui.cardEngine')}
                    badge={{
                      label: status.daemonActive ? t('docker.state.up') : t('docker.state.down'),
                      tone: status.daemonActive ? 'ok' : 'warn',
                    }}
                    facts={[
                      { label: t('docker.col.version'), value: status.version },
                      { label: t('docker.ui.compose'), value: status.composeVersion },
                      { label: t('docker.ui.cgroup'), value: status.cgroupDriver },
                      { label: t('docker.col.dataRoot'), value: status.dataRoot, mono: true },
                    ]}
                  />
                  <InfoCard
                    title={t('docker.ui.cardDisk')}
                    facts={[
                      { label: t('docker.ui.used'), value: formatGiB(status.disk.usedBytes) },
                      { label: t('docker.ui.free'), value: formatGiB(status.disk.availBytes) },
                      {
                        label: t('docker.col.disk'),
                        value:
                          diskPct != null ? t('docker.ui.pctUsed', { n: Math.round(diskPct) }) : '—',
                      },
                    ]}
                    actions={
                      diskPct != null ? (
                        <div className="dock-meter" aria-hidden>
                          <span
                            className={`dock-meter__fill${
                              meterTone === 'ok' ? '' : ` dock-meter__fill--${meterTone}`
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, diskPct))}%` }}
                          />
                        </div>
                      ) : null
                    }
                  />
                  <InfoCard
                    title={t('docker.ui.cardWork')}
                    facts={[
                      {
                        label: t('docker.ui.running'),
                        value: `${status.counts.running} / ${status.counts.containers}`,
                      },
                      { label: t('docker.ui.images'), value: String(status.counts.images) },
                      { label: t('docker.ui.volumes'), value: String(status.counts.volumes) },
                      { label: t('docker.ui.networks'), value: String(status.counts.networks) },
                      {
                        label: t('docker.col.validators'),
                        value: String(status.validatorProjects),
                      },
                    ]}
                  />
                </InfoCardGrid>
                <ActionBar size="md" aria-label={t('docker.title')}>
                  <Button variant="primary" onClick={() => setRunOpen(true)}>
                    {t('docker.actions.run')}
                  </Button>
                  <Button onClick={() => setTab('images')}>{t('docker.ui.goImages')}</Button>
                  <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} to="/validators">
                    {t('docker.ui.goValidators')}
                  </Link>
                </ActionBar>
              </>
            ) : null}
          </div>
        ) : null}

        {tab === 'containers' ? (
          !loaded ? (
            <LoadingBlock label={t('common.loading')} />
          ) : (
          <DataTable<DockerContainerRow>
            rowKey={(row) => row.id || row.name}
            toolbar={
              <Button
                variant="primary"
                disabled={!engineInstalled || busy}
                title={!engineInstalled ? needEngine : undefined}
                onClick={() => setRunOpen(true)}
              >
                {t('docker.actions.run')}
              </Button>
            }
            empty={<EmptyState title={t('docker.empty.containers')} />}
            columns={[
              { key: 'name', header: t('docker.col.name'), render: (row) => row.name },
              { key: 'image', header: t('docker.col.image'), render: (row) => row.image },
              {
                key: 'state',
                header: t('docker.col.status'),
                render: (row) => {
                  const key = dockerStateKey(row.state);
                  const restarts = parseRestartCount(row.status);
                  const exit = String(row.status ?? '').match(/Exited\s*\((\d+)\)/i);
                  const label =
                    key === 'restarting' && restarts != null
                      ? t('docker.state.restartingCount', { n: restarts })
                      : key === 'exited' && exit
                        ? t('docker.state.exitedCode', { n: exit[1] })
                        : t(`docker.state.${key}`);
                  return (
                    <Badge
                      tone={
                        key === 'running'
                          ? 'ok'
                          : key === 'restarting' || key === 'dead'
                            ? 'danger'
                            : 'neutral'
                      }
                      title={row.status || row.state}
                    >
                      {label}
                    </Badge>
                  );
                },
              },
              {
                key: 'ports',
                header: t('docker.col.ports'),
                nowrap: true,
                render: (row) => {
                  const href = loopbackHref(row.ports);
                  return (
                    <span className="u-nowrap">
                      {row.ports || '—'}
                      {href ? (
                        <>
                          {' '}
                          <a href={href} target="_blank" rel="noreferrer">
                            {t('docker.ui.loopbackUrl')}
                          </a>
                          {' · '}
                          <a
                            href={`/nginx?create=1&upstream=${encodeURIComponent(href)}`}
                          >
                            {t('docker.ui.nginxProxy')}
                          </a>
                        </>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                key: 'ysk',
                header: t('docker.col.managed'),
                render: (row) =>
                  row.yskManaged ? <Badge tone="ok">{row.yskFeature ?? 'ysk'}</Badge> : '—',
              },
            ]}
            rows={containers}
            rowActions={(row) => {
              const stoppable = canStopContainer(row.state);
              const id = row.name || row.id;
              return (
                <ActionBar size="sm">
                  {stoppable ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => dockerApi.containerAction(id, 'stop'))}
                    >
                      {t('docker.actions.stop')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => dockerApi.containerAction(id, 'start'))}
                    >
                      {t('docker.actions.start')}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => void openLogs(id)}>
                    {t('docker.actions.logs')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      void dockerApi.inspect(id).then((r) => {
                        setLogFollow(false);
                        setLogId('');
                        setLogs([]);
                        setInspectValue(r.inspect ?? null);
                        setInspectSummary(r.summary ?? '');
                        setLogTitle(`${id} inspect`);
                      })
                    }
                  >
                    {t('docker.actions.inspect')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    data-confirm={id}
                    onClick={() =>
                      setPendingDelete({ kind: 'container', token: id, state: row.state })
                    }
                  >
                    {t('docker.actions.remove')}
                  </Button>
                </ActionBar>
              );
            }}
          />
          )
        ) : null}

        {tab === 'images' ? (
          <DataTable<DockerImageRow>
            rowKey={(row) => `${row.repository}:${row.tag}:${row.id}`}
            toolbar={
              <Button
                variant="primary"
                disabled={!engineInstalled || busy}
                title={!engineInstalled ? needEngine : undefined}
                onClick={() => setPullOpen(true)}
              >
                {t('docker.actions.pull')}
              </Button>
            }
            empty={<EmptyState title={t('docker.empty.images')} />}
            columns={[
              {
                key: 'ref',
                header: t('docker.col.image'),
                render: (row) => imageRef(row),
              },
              { key: 'size', header: t('docker.col.size'), render: (row) => row.size },
            ]}
            rows={images}
            rowActions={(row) => (
              <Button
                size="sm"
                variant="danger"
                disabled={!engineInstalled || busy}
                data-confirm={imageRef(row)}
                onClick={() =>
                  setPendingDelete({
                    kind: 'image',
                    token: imageRef(row),
                    id: row.id || imageRef(row),
                  })
                }
              >
                {t('docker.actions.remove')}
              </Button>
            )}
          />
        ) : null}

        {tab === 'compose' ? (
          <DataTable<DockerComposeProject>
              rowKey={(row) => row.name}
              empty={
                <EmptyState
                  title={t('docker.empty.compose')}
                  description={t('docker.empty.composeDesc')}
                />
              }
              columns={[
                { key: 'name', header: t('docker.col.name'), render: (row) => row.name },
                { key: 'status', header: t('docker.col.status'), render: (row) => row.status },
                {
                  key: 'val',
                  header: t('docker.col.validators'),
                  render: (row) =>
                    row.validatorId ? <Link to="/validators">{row.validatorId}</Link> : '—',
                },
              ]}
              rows={compose}
              rowActions={(row) => (
                <ActionBar size="sm">
                  <Button
                    size="sm"
                    disabled={!engineInstalled || busy}
                    onClick={() =>
                      void run(
                        () => dockerApi.composeAction(row.name, 'up'),
                        t('docker.actions.up'),
                        `/api/v1/docker/compose/${encodeURIComponent(row.name)}/up`,
                        { execute: true },
                      )
                    }
                  >
                    {t('docker.actions.up')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!engineInstalled || busy}
                    onClick={() => void run(() => dockerApi.composeAction(row.name, 'down'))}
                  >
                    {t('docker.actions.down')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!engineInstalled || busy}
                    data-confirm={row.validatorId ?? row.name}
                    onClick={() =>
                      setPendingDelete({
                        kind: 'compose',
                        token: row.validatorId ?? row.name,
                        project: row.name,
                        validatorId: row.validatorId,
                      })
                    }
                  >
                    {t('docker.actions.remove')}
                  </Button>
                </ActionBar>
              )}
            />
        ) : null}

        {tab === 'volumes' ? (
          <DataTable<DockerVolumeRow>
            rowKey={(row) => row.name}
            toolbar={
              <Button
                variant="primary"
                disabled={!engineInstalled || busy}
                title={!engineInstalled ? needEngine : undefined}
                onClick={() => {
                  setVolErr(null);
                  setVolOpen(true);
                }}
              >
                {t('docker.actions.createVolume')}
              </Button>
            }
            empty={<EmptyState title={t('docker.empty.volumes')} />}
            columns={[
              { key: 'name', header: t('docker.col.name'), render: (row) => row.name },
              { key: 'driver', header: t('docker.col.driver'), render: (row) => row.driver },
            ]}
            rows={volumes}
            rowActions={(row) => (
              <Button
                size="sm"
                variant="danger"
                disabled={!engineInstalled || busy}
                data-confirm={row.name}
                onClick={() => setPendingDelete({ kind: 'volume', token: row.name })}
              >
                {t('docker.actions.remove')}
              </Button>
            )}
          />
        ) : null}

        {tab === 'networks' ? (
          <DataTable<DockerNetworkRow>
            rowKey={(row) => row.id || row.name}
            toolbar={
              <Button
                variant="primary"
                disabled={!engineInstalled || busy}
                title={!engineInstalled ? needEngine : undefined}
                onClick={() => setNetOpen(true)}
              >
                {t('docker.actions.createNetwork')}
              </Button>
            }
            empty={<EmptyState title={t('docker.empty.networks')} />}
            columns={[
              { key: 'name', header: t('docker.col.name'), render: (row) => row.name },
              { key: 'driver', header: t('docker.col.driver'), render: (row) => row.driver },
            ]}
            rows={networks}
            rowActions={(row) =>
              row.protected ? (
                <span className="u-text-sm">{t('docker.protected')}</span>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!engineInstalled || busy}
                  data-confirm={row.name || row.id}
                  onClick={() =>
                    setPendingDelete({ kind: 'network', token: row.name || row.id })
                  }
                >
                  {t('docker.actions.remove')}
                </Button>
              )
            }
          />
        ) : null}

        {tab === 'prune' ? (
          <div className="dock-stack">
            <DataTable<DockerDfRow>
              rowKey={(row) => row.type}
              columns={[
                {
                  key: 'type',
                  header: t('docker.col.type'),
                  render: (row) => t(`docker.df.${dockerDfTypeKey(row.type)}`),
                },
                { key: 'size', header: t('docker.col.size'), render: (row) => row.size },
                {
                  key: 'reclaim',
                  header: t('docker.col.reclaimable'),
                  render: (row) => row.reclaimable,
                },
              ]}
              rows={df}
            />
            <Card>
              <CardHeader title={t('docker.tab.prune')} description={t('docker.ui.pruneAckDesc')} />
              <div className="dock-form">
                <Field htmlFor="dock-prune-scope" label={t('docker.ui.pruneWhat')}>
                  <SegRadio
                    name="dock-prune-scope"
                    aria-label={t('docker.ui.pruneWhat')}
                    value={pruneScope}
                    onChange={setPruneScope}
                    options={[
                      { value: 'containers', label: t('docker.ui.scopeContainers') },
                      { value: 'images', label: t('docker.ui.scopeImages') },
                      { value: 'volumes', label: t('docker.ui.scopeVolumes') },
                      { value: 'builder', label: t('docker.ui.scopeBuilder') },
                      { value: 'system', label: t('docker.ui.scopeSystem') },
                    ]}
                  />
                </Field>
                <FormActions>
                  <Button
                    variant="danger"
                    disabled={!engineInstalled || busy}
                    title={!engineInstalled ? needEngine : undefined}
                    data-confirm="PRUNE"
                    onClick={() => setPendingPrune(true)}
                  >
                    {t('docker.ui.pruneNow')}
                  </Button>
                </FormActions>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <Card>
            <CardHeader title={t('docker.tab.settings')} description={t('docker.settingsHint')} />
            <div className="dock-form">
              <Field htmlFor="dock-log-size" label={t('docker.settings.logMaxSize')}>
                <SegRadio
                  name="dock-log-size"
                  aria-label={t('docker.settings.logMaxSize')}
                  value={logMaxSize}
                  onChange={setLogMaxSize}
                  options={LOG_SIZES.map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <CheckboxField
                id="dock-live"
                label={t('docker.settings.liveRestore')}
                checked={liveRestore}
                onChange={setLiveRestore}
              />
              <CheckboxField
                id="dock-use-mirrors"
                label={t('docker.ui.useMirrors')}
                checked={useMirrors}
                onChange={setUseMirrors}
              />
              {useMirrors ? (
                <Field htmlFor="dock-mirrors" label={t('docker.settings.mirrors')}>
                  <textarea
                    id="dock-mirrors"
                    rows={3}
                    value={mirrors}
                    onChange={(e) => setMirrors(e.target.value)}
                  />
                </Field>
              ) : null}
              <CheckboxField
                id="dock-use-insecure"
                label={t('docker.ui.useInsecure')}
                checked={useInsecure}
                onChange={setUseInsecure}
              />
              {useInsecure ? (
                <Field htmlFor="dock-insecure" label={t('docker.settings.insecure')}>
                  <textarea
                    id="dock-insecure"
                    rows={2}
                    value={insecure}
                    onChange={(e) => setInsecure(e.target.value)}
                  />
                </Field>
              ) : null}
              <FormActions>
                <Button
                  variant="danger"
                  disabled={!engineInstalled || busy}
                  title={!engineInstalled ? needEngine : undefined}
                  data-confirm="dialog"
                  onClick={() => setDaemonConfirm(true)}
                >
                  {t('docker.actions.applyDaemon')}
                </Button>
              </FormActions>
              {daemon ? (
                <FormHint>
                  <code>{daemon.path}</code>
                </FormHint>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="docker" /> : null}
      </PageTabs>

      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title={t('docker.actions.run')}
        description={t('docker.runAdvancedHint')}
        size="lg"
        footer={
          <>
            <Button onClick={() => setRunOpen(false)}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              form="dock-run-form"
              variant="primary"
              disabled={busy || !engineInstalled || !resolvedRunImage}
            >
              {t('docker.actions.run')}
            </Button>
          </>
        }
      >
        <Form id="dock-run-form" className="dock-form" onSubmit={(e) => void onRun(e)}>
          <Field htmlFor="dock-run-img" label={t('docker.col.image')} required>
            <SegRadio
              name="dock-run-img"
              aria-label={t('docker.col.image')}
              value={runImageValue}
              onChange={(v) => setRunImage(v === CUSTOM ? CUSTOM : v)}
              options={imageOptions}
            />
          </Field>
          {runImageValue === CUSTOM ? (
            <Field htmlFor="dock-run-img-c" label={t('docker.ui.imageCustom')} required>
              <input
                id="dock-run-img-c"
                value={runCustom}
                spellCheck={false}
                onChange={(e) => {
                  setRunImage(CUSTOM);
                  setRunCustom(e.target.value);
                }}
              />
            </Field>
          ) : null}
          <Field htmlFor="dock-run-name" label={t('docker.col.name')} hint={t('docker.nameHint')}>
            <input id="dock-run-name" value={runName} onChange={(e) => setRunName(e.target.value)} />
          </Field>
          <Field htmlFor="dock-run-restart" label={t('docker.runRestart')}>
            <SegRadio
              name="dock-run-restart"
              aria-label={t('docker.runRestart')}
              value={runRestart}
              onChange={setRunRestart}
              options={[
                { value: 'no', label: t('docker.ui.restartNo') },
                { value: 'unless-stopped', label: t('docker.ui.restartUnless') },
                { value: 'always', label: t('docker.ui.restartAlways') },
                { value: 'on-failure', label: t('docker.ui.restartOnFail') },
              ]}
            />
          </Field>
          <Field htmlFor="dock-run-net-kind" label={t('docker.runNetwork')}>
            <SegRadio
              name="dock-run-net-kind"
              aria-label={t('docker.runNetwork')}
              value={runNetKind}
              onChange={(v) => {
                const kind = v === 'bridge' ? 'bridge' : 'default';
                setRunNetKind(kind);
                if (kind === 'default') {
                  setRunNetwork('');
                } else {
                  setRunNetwork((cur) =>
                    bridgeNets.some((n) => n.name === cur) ? cur : (bridgeNets[0]?.name ?? 'bridge'),
                  );
                }
              }}
              options={[
                { value: 'default', label: t('docker.ui.defaultNet') },
                { value: 'bridge', label: 'bridge' },
              ]}
            />
          </Field>
          {runNetKind === 'bridge' ? (
            <Field htmlFor="dock-run-net" label={t('docker.ui.pickBridge')}>
              <SegRadio
                name="dock-run-net"
                aria-label={t('docker.ui.pickBridge')}
                value={runNetwork || 'bridge'}
                onChange={setRunNetwork}
                options={bridgeNets.map((n) => ({ value: n.name, label: n.name }))}
              />
            </Field>
          ) : null}
          <CheckboxField
            id="dock-run-pub"
            label={t('docker.ui.publishPorts')}
            checked={runPublish}
            onChange={setRunPublish}
          />
          {runPublish ? (
            <>
              <Field htmlFor="dock-run-ports" label={t('docker.runPorts')}>
                <div className="dock-form">
                  {PORT_PRESETS.map((p) => (
                    <CheckboxField
                      key={p.id}
                      id={`dock-port-${p.id}`}
                      label={p.label}
                      checked={runPortIds.includes(p.id)}
                      onChange={(on) =>
                        setRunPortIds((cur) =>
                          on ? [...cur, p.id] : cur.filter((x) => x !== p.id),
                        )
                      }
                    />
                  ))}
                  <CheckboxField
                    id="dock-port-custom"
                    label={t('docker.ui.customPort')}
                    checked={runCustomPort}
                    onChange={setRunCustomPort}
                  />
                </div>
              </Field>
              {runCustomPort ? (
                <Form layoutOnly columns={2}>
                  <Field
                    htmlFor="dock-port-h"
                    label={t('docker.ui.customPortHost')}
                    hint={t('docker.ui.customPortHint')}
                  >
                    <input
                      id="dock-port-h"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={runHostPort}
                      placeholder="8080"
                      onChange={(e) => setRunHostPort(e.target.value)}
                    />
                  </Field>
                  <Field htmlFor="dock-port-c" label={t('docker.ui.customPortContainer')}>
                    <input
                      id="dock-port-c"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={runCtrPort}
                      placeholder="80"
                      onChange={(e) => setRunCtrPort(e.target.value)}
                    />
                  </Field>
                </Form>
              ) : null}
            </>
          ) : null}
          <CheckboxField
            id="dock-run-vol"
            label={t('docker.ui.attachVolume')}
            checked={runAttachVol}
            onChange={(on) => {
              setRunAttachVol(on);
              if (on && !runVolName && volumes[0]) setRunVolName(volumes[0].name);
            }}
          />
          {runAttachVol ? (
            <Field htmlFor="dock-run-newvol" label={t('docker.ui.newVolume')} hint={t('docker.nameHint')}>
              <input
                id="dock-run-newvol"
                value={runNewVol}
                spellCheck={false}
                placeholder={t('docker.volPlaceholder')}
                onChange={(e) => setRunNewVol(e.target.value)}
              />
            </Field>
          ) : null}
          {runAttachVol && volumes.length ? (
            <>
              <Field htmlFor="dock-run-voln" label={t('docker.ui.volumes')}>
                <SegRadio
                  name="dock-run-voln"
                  aria-label={t('docker.ui.volumes')}
                  value={runVolName}
                  onChange={setRunVolName}
                  options={volumes.map((v) => ({ value: v.name, label: v.name }))}
                />
              </Field>
              <Field htmlFor="dock-run-dest" label={t('docker.ui.mountPath')}>
                <SegRadio
                  name="dock-run-dest"
                  aria-label={t('docker.ui.mountPath')}
                  value={DEST_PRESETS.includes(runVolDest as (typeof DEST_PRESETS)[number]) ? runVolDest : CUSTOM}
                  onChange={setRunVolDest}
                  options={[
                    ...DEST_PRESETS.map((d) => ({ value: d, label: d })),
                    { value: CUSTOM, label: t('docker.ui.imageCustom') },
                  ]}
                />
              </Field>
              {runVolDest === CUSTOM ? (
                <Field htmlFor="dock-run-dest-c" label={t('docker.ui.mountPath')} required>
                  <input
                    id="dock-run-dest-c"
                    value={runVolDestCustom}
                    spellCheck={false}
                    onChange={(e) => setRunVolDestCustom(e.target.value)}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          <CheckboxField
            id="dock-run-env"
            label={t('docker.ui.setEnv')}
            checked={runEnvOn}
            onChange={setRunEnvOn}
          />
          {runEnvOn ? (
            <Field htmlFor="dock-run-env-t" label={t('docker.runEnv')} hint={t('docker.runEnvHint')}>
              <textarea
                id="dock-run-env-t"
                rows={3}
                value={runEnv}
                onChange={(e) => setRunEnv(e.target.value)}
              />
            </Field>
          ) : null}
          <Field
            htmlFor="dock-run-ep"
            label={t('docker.ui.entrypoint')}
            hint={t('docker.ui.entrypointHint')}
            error={runCmdErr && runEntrypoint.trim() ? runCmdErr : undefined}
          >
            <input
              id="dock-run-ep"
              value={runEntrypoint}
              spellCheck={false}
              placeholder="nginx"
              onChange={(e) => setRunEntrypoint(e.target.value)}
            />
          </Field>
          <Field
            htmlFor="dock-run-cmd"
            label={t('docker.ui.command')}
            hint={t('docker.ui.commandHint')}
            error={runCmdErr && runCommand.trim() ? runCmdErr : undefined}
          >
            <input
              id="dock-run-cmd"
              value={runCommand}
              spellCheck={false}
              placeholder="-g daemon-off"
              onChange={(e) => setRunCommand(e.target.value)}
            />
          </Field>
        </Form>
      </Modal>

      <Modal
        open={pullOpen}
        onClose={() => setPullOpen(false)}
        title={t('docker.actions.pull')}
        description={t('docker.ui.imagePickHint')}
        footer={
          <>
            <Button onClick={() => setPullOpen(false)}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              form="dock-pull-form"
              variant="primary"
              disabled={!engineInstalled || busy || !resolvedPull}
              title={!engineInstalled ? needEngine : undefined}
            >
              {t('docker.actions.pull')}
            </Button>
          </>
        }
      >
        <Form
          id="dock-pull-form"
          className="dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!resolvedPull) return;
            setPullOpen(false);
            void run(
              () => dockerApi.pull(resolvedPull),
              t('docker.actions.pull'),
              '/api/v1/docker/images/pull',
              { image: resolvedPull, execute: true },
            );
          }}
        >
          <Field htmlFor="dock-pull" label={t('docker.col.image')}>
            <SegRadio
              name="dock-pull"
              aria-label={t('docker.col.image')}
              value={pullValue}
              onChange={(v) => setPullImage(v === CUSTOM ? CUSTOM : v)}
              options={imageOptions}
            />
          </Field>
          {pullValue === CUSTOM ? (
            <Field htmlFor="dock-pull-custom" label={t('docker.ui.imageCustom')} required>
              <input
                id="dock-pull-custom"
                value={pullCustom}
                spellCheck={false}
                onChange={(e) => setPullCustom(e.target.value)}
              />
            </Field>
          ) : null}
        </Form>
      </Modal>

      <Modal
        open={volOpen}
        onClose={() => setVolOpen(false)}
        title={t('docker.actions.createVolume')}
        description={t('docker.ui.driverLocalOnly')}
        footer={
          <>
            <Button onClick={() => setVolOpen(false)}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              form="dock-vol-form"
              variant="primary"
              disabled={!engineInstalled || busy || !volName.trim()}
              title={!engineInstalled ? needEngine : undefined}
            >
              {t('docker.actions.createVolume')}
            </Button>
          </>
        }
      >
        <Form
          id="dock-vol-form"
          className="dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!volName.trim()) {
              setVolErr(t('docker.errors.badName'));
              return;
            }
            const name = volName.trim();
            if (!isSafeDockerName(name)) {
              setVolErr(t('docker.errors.badName'));
              return;
            }
            setVolErr(null);
            setBusy(true);
            void dockerApi
              .createVolume(name)
              .then((r) => {
                if (r?.ok && !r.blocked) {
                  setVolOpen(false);
                  setVolName('');
                  void load();
                  return;
                }
                setVolErr(
                  r.blockMessage ||
                    r.notes?.[0] ||
                    t('docker.errors.badName'),
                );
              })
              .catch((err: unknown) => {
                setVolErr(err instanceof Error ? err.message : t('docker.errors.badName'));
              })
              .finally(() => setBusy(false));
          }}
        >
          <Field
            htmlFor="dock-vol"
            label={t('docker.col.name')}
            hint={t('docker.nameHint')}
            required
            error={volErr ?? undefined}
          >
            <input
              id="dock-vol"
              value={volName}
              placeholder={t('docker.volPlaceholder')}
              spellCheck={false}
              onChange={(e) => {
                setVolName(e.target.value);
                setVolErr(null);
              }}
            />
          </Field>
          <Field htmlFor="dock-vol-drv" label={t('docker.ui.driver')}>
            <p id="dock-vol-drv" className="muted u-text-sm u-mb-0">
              local — {t('docker.ui.driverLocalOnly')}
            </p>
          </Field>
        </Form>
      </Modal>

      <Modal
        open={netOpen}
        onClose={() => setNetOpen(false)}
        title={t('docker.actions.createNetwork')}
        description={t('docker.ui.netDefaultDriver')}
        footer={
          <>
            <Button onClick={() => setNetOpen(false)}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              form="dock-net-form"
              variant="primary"
              disabled={!engineInstalled || busy || !netName.trim()}
              title={!engineInstalled ? needEngine : undefined}
            >
              {t('docker.actions.createNetwork')}
            </Button>
          </>
        }
      >
        <Form
          id="dock-net-form"
          className="dock-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!netName.trim()) return;
            const name = netName.trim();
            setNetOpen(false);
            setNetName('');
            void run(() => dockerApi.createNetwork(name));
          }}
        >
          <Field htmlFor="dock-net" label={t('docker.col.name')} hint={t('docker.nameHint')} required>
            <input
              id="dock-net"
              value={netName}
              placeholder={t('docker.netPlaceholder')}
              spellCheck={false}
              onChange={(e) => setNetName(e.target.value)}
            />
          </Field>
          <Field htmlFor="dock-net-drv" label={t('docker.ui.driver')}>
            <p id="dock-net-drv" className="muted u-text-sm u-mb-0">
              bridge — {t('docker.ui.netDefaultDriver')}
            </p>
          </Field>
        </Form>
      </Modal>

      <ConfirmDialog
        open={pendingPrune}
        onClose={() => setPendingPrune(false)}
        title={t('docker.pruneTitle')}
        description={t('docker.pruneDesc')}
        confirmText="PRUNE"
        confirmLabel={t('docker.ui.pruneNow')}
        severity="critical"
        busy={busy}
        consequences={[
          t('docker.pruneC1'),
          pruneScope === 'volumes' || pruneScope === 'system' ? t('docker.pruneC2') : t('docker.pruneC3'),
        ]}
        onConfirm={() => {
          setPendingPrune(false);
          void run(
            () => dockerApi.prune(pruneScope, 'PRUNE'),
            t('docker.ui.pruneNow'),
            '/api/v1/docker/prune',
            { scope: pruneScope, confirm: 'PRUNE', execute: true },
          );
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={t('docker.deleteTitle', { id: pendingDelete?.token ?? '' })}
        description={t('docker.deleteDesc')}
        confirmText={pendingDelete?.token}
        confirmLabel={t('docker.actions.remove')}
        severity="critical"
        busy={busy}
        consequences={[
          t('docker.deleteC1'),
          ...(pendingDelete?.kind === 'container' &&
          (pendingDelete.state === 'running' || pendingDelete.state === 'restarting')
            ? [t('docker.deleteRunningWarn')]
            : []),
          ...(pendingDelete?.kind === 'compose' && pendingDelete.validatorId
            ? [t('docker.deleteComposeVal')]
            : []),
        ]}
        onConfirm={() => {
          const p = pendingDelete;
          if (!p) return;
          setPendingDelete(null);
          if (p.kind === 'container') {
            setContainers((prev) =>
              prev.filter((c) => c.name !== p.token && c.id !== p.token && !c.id.startsWith(p.token)),
            );
            setStatus((s) =>
              s
                ? {
                    ...s,
                    counts: {
                      ...s.counts,
                      containers: Math.max(0, (s.counts.containers ?? 1) - 1),
                      running: Math.max(
                        0,
                        (s.counts.running ?? 0) -
                          (p.state === 'running' || p.state === 'restarting' ? 1 : 0),
                      ),
                    },
                  }
                : s,
            );
            void run(() => dockerApi.containerAction(p.token, 'remove'));
          } else if (p.kind === 'image') {
            void run(() => dockerApi.removeImage(p.id));
          } else if (p.kind === 'volume') {
            void run(() => dockerApi.removeVolume(p.token));
          } else if (p.kind === 'network') {
            void run(() => dockerApi.removeNetwork(p.token));
          } else if (p.validatorId) {
            void run(() => validatorsApi.remove(p.validatorId!, p.validatorId!));
          } else {
            void run(() => dockerApi.composeAction(p.project, 'rm'));
          }
        }}
      />

      <ConfirmDialog
        open={daemonConfirm}
        onClose={() => setDaemonConfirm(false)}
        title={t('docker.daemonConfirmTitle')}
        description={t('docker.daemonConfirmDesc')}
        severity="destructive"
        onConfirm={() => {
          setDaemonConfirm(false);
          void run(() =>
            dockerApi.patchDaemon({
              logMaxSize,
              liveRestore,
              registryMirrors: useMirrors
                ? mirrors.split(/\s+/).map((s) => s.trim()).filter(Boolean)
                : [],
              insecureRegistries: useInsecure
                ? insecure.split(/\s+/).map((s) => s.trim()).filter(Boolean)
                : [],
            }),
          );
        }}
      />

      <Modal
        open={Boolean(logTitle)}
        onClose={() => {
          setLogTitle('');
          setInspectValue(null);
          setInspectSummary('');
          setLogId('');
          setLogFollow(false);
        }}
        title={logTitle}
        size="lg"
      >
        {inspectValue != null ? (
          <div className="stack">
            {inspectSummary ? <p className="muted u-text-sm u-m-0">{inspectSummary}</p> : null}
            <JsonViewer value={inspectValue} />
          </div>
        ) : (
          <div className="stack">
            <ActionBar size="sm">
              <Button
                size="sm"
                disabled={!logId || busy}
                onClick={() => logId && void fetchLogs(logId)}
              >
                {t('common.refresh')}
              </Button>
              <CheckboxField
                id="dock-log-follow"
                label={t('docker.logs.follow')}
                checked={logFollow}
                onChange={setLogFollow}
              />
            </ActionBar>
            {logs == null ? (
              <LoadingBlock label={t('common.loading')} />
            ) : (
              <pre className="code-block">
                {logs.length ? logs.join('\n') : t('docker.logs.empty')}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </FeaturePageLayout>
  );
}
