/**
 * Docker — engine, containers, images, compose, volumes, networks, prune, settings.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  Modal,
  OpsResultPanel,
  PageTabs,
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

export function DockerPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const [status, setStatus] = useState<DockerEngineStatus | null>(null);
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
  const [logs, setLogs] = useState<string[]>([]);
  const [logTitle, setLogTitle] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const [runImage, setRunImage] = useState('alpine:3.20');
  const [runName, setRunName] = useState('');
  const [pullImage, setPullImage] = useState('alpine:3.20');
  const [volName, setVolName] = useState('');
  const [netName, setNetName] = useState('');
  const [pruneConfirm, setPruneConfirm] = useState('');
  const [logMaxSize, setLogMaxSize] = useState('10m');
  const [liveRestore, setLiveRestore] = useState(false);
  const [mirrors, setMirrors] = useState('');
  const [insecure, setInsecure] = useState('');
  const [inspectText, setInspectText] = useState('');
  const stream = useOpsStreamOptional();

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
        setMirrors((dm.daemon.registryMirrors ?? []).join('\n'));
        setInsecure((dm.daemon.insecureRegistries ?? []).join('\n'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (job) stream?.finish(job.id, { ok: false, error: msg, toast: false });
    } finally {
      setBusy(false);
    }
  };

  const openLogs = async (id: string) => {
    setLogTitle(id);
    const r = await dockerApi.logs(id);
    setLogs(r.lines ?? []);
  };

  const onRun = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => dockerApi.run({ image: runImage.trim(), name: runName.trim() || undefined }));
    setRunOpen(false);
  };

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
        items: [
          {
            label: t('docker.col.engine'),
            value: status?.daemonActive ? t('docker.state.up') : t('docker.state.down'),
            tone: status?.daemonActive ? 'ok' : 'warn',
          },
          {
            label: t('docker.col.containers'),
            value: String(status?.counts.running ?? 0),
          },
        ],
      }}
    >
      <SoftwareInstallBanner feature="docker" title={t('docker.notInstalled')} showReadyActions={false} />
      <div className="u-mb-3">
        <ServiceLifecycleBar unit="docker" label="Docker" />
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {ops ? <OpsResultPanel title={t('docker.title')} result={ops} /> : null}

      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`docker.tab.${id}`) }))}
        active={tab}
        onChange={setTab}
      >
        {tab === 'overview' ? (
          <>
            {!status?.installed ? <Alert variant="warn">{t('docker.notInstalled')}</Alert> : null}
            {status?.installed && !status.daemonActive ? (
              <Alert variant="warn">{t('docker.alerts.daemonBody')}</Alert>
            ) : null}
            <dl className="desc-list">
              <div>
                <dt>{t('docker.col.version')}</dt>
                <dd>{status?.version ?? '—'}</dd>
              </div>
              <div>
                <dt>Compose</dt>
                <dd>{status?.composeVersion ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('docker.col.dataRoot')}</dt>
                <dd>
                  <code>{status?.dataRoot ?? '—'}</code>
                </dd>
              </div>
              <div>
                <dt>{t('docker.col.disk')}</dt>
                <dd>
                  {status?.disk.usedBytes != null
                    ? `${(status.disk.usedBytes / 1024 ** 3).toFixed(1)} GiB / ${
                        status.disk.availBytes != null
                          ? `${(status.disk.availBytes / 1024 ** 3).toFixed(1)} GiB free`
                          : '—'
                      }`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{t('docker.col.validators')}</dt>
                <dd>
                  <Link to="/validators">{status?.validatorProjects ?? 0}</Link>
                </dd>
              </div>
            </dl>
            <div className="u-flex u-gap-2 u-mt-3">
              <Button size="sm" onClick={() => void run(() => dockerApi.engine('start'))}>
                {t('docker.actions.startEngine')}
              </Button>
              <Button size="sm" onClick={() => void run(() => dockerApi.engine('restart'))}>
                {t('docker.actions.restartEngine')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void run(() => dockerApi.engine('stop'))}
              >
                {t('docker.actions.stopEngine')}
              </Button>
            </div>
          </>
        ) : null}

        {tab === 'containers' ? (
          <DataTable<DockerContainerRow>
            rowKey={(row) => row.id || row.name}
            toolbar={
              <Button variant="primary" onClick={() => setRunOpen(true)}>
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
                render: (row) => (
                  <Badge tone={row.state === 'running' ? 'ok' : 'neutral'}>{row.state || row.status}</Badge>
                ),
              },
              { key: 'ports', header: t('docker.col.ports'), render: (row) => row.ports || '—' },
              {
                key: 'ysk',
                header: t('docker.col.managed'),
                render: (row) =>
                  row.yskManaged ? <Badge tone="ok">{row.yskFeature ?? 'ysk'}</Badge> : '—',
              },
            ]}
            rows={containers}
            rowActions={(row) => (
              <>
                <Button size="sm" onClick={() => void run(() => dockerApi.containerAction(row.name || row.id, 'start'))}>
                  {t('docker.actions.start')}
                </Button>
                <Button size="sm" onClick={() => void run(() => dockerApi.containerAction(row.name || row.id, 'stop'))}>
                  {t('docker.actions.stop')}
                </Button>
                <Button size="sm" onClick={() => void openLogs(row.name || row.id)}>
                  {t('docker.actions.logs')}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    void run(
                      () => dockerApi.exec(row.name || row.id, 'version'),
                      t('docker.actions.exec'),
                      `/api/v1/docker/containers/${encodeURIComponent(row.name || row.id)}/exec`,
                      { preset: 'version', execute: true },
                    )
                  }
                >
                  {t('docker.actions.exec')}
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    void dockerApi.inspect(row.name || row.id).then((r) => {
                      setInspectText(JSON.stringify(r.inspect, null, 2));
                      setLogTitle(`${row.name || row.id} inspect`);
                    })
                  }
                >
                  {t('docker.actions.inspect')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run(() => dockerApi.containerAction(row.name || row.id, 'remove'))}
                >
                  {t('docker.actions.remove')}
                </Button>
              </>
            )}
          />
        ) : null}

        {tab === 'images' ? (
          <>
            <div className="u-flex u-gap-2 u-mb-3">
              <Field htmlFor="dock-pull" label={t('docker.actions.pull')}>
                <input id="dock-pull" value={pullImage} onChange={(e) => setPullImage(e.target.value)} />
              </Field>
              <Button
                onClick={() =>
                  void run(
                    () => dockerApi.pull(pullImage.trim()),
                    t('docker.actions.pull'),
                    '/api/v1/docker/images/pull',
                    { image: pullImage.trim(), execute: true },
                  )
                }
              >
                {t('docker.actions.pull')}
              </Button>
            </div>
            <DataTable<DockerImageRow>
              rowKey={(row) => `${row.repository}:${row.tag}:${row.id}`}
              empty={<EmptyState title={t('docker.empty.images')} />}
              columns={[
                {
                  key: 'ref',
                  header: t('docker.col.image'),
                  render: (row) => `${row.repository}:${row.tag}`,
                },
                { key: 'size', header: t('docker.col.size'), render: (row) => row.size },
              ]}
              rows={images}
              rowActions={(row) => (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run(() => dockerApi.removeImage(row.id || `${row.repository}:${row.tag}`))}
                >
                  {t('docker.actions.remove')}
                </Button>
              )}
            />
          </>
        ) : null}

        {tab === 'compose' ? (
          <DataTable<DockerComposeProject>
            rowKey={(row) => row.name}
            empty={<EmptyState title={t('docker.empty.compose')} />}
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
              <>
                <Button
                  size="sm"
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
                <Button size="sm" onClick={() => void run(() => dockerApi.composeAction(row.name, 'down'))}>
                  {t('docker.actions.down')}
                </Button>
              </>
            )}
          />
        ) : null}

        {tab === 'volumes' ? (
          <>
            <div className="u-flex u-gap-2 u-mb-3">
              <Field htmlFor="dock-vol" label={t('docker.actions.createVolume')}>
                <input id="dock-vol" value={volName} onChange={(e) => setVolName(e.target.value)} />
              </Field>
              <Button onClick={() => void run(() => dockerApi.createVolume(volName.trim()))}>
                {t('docker.actions.createVolume')}
              </Button>
            </div>
            <DataTable<DockerVolumeRow>
              rowKey={(row) => row.name}
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
                  onClick={() => void run(() => dockerApi.removeVolume(row.name))}
                >
                  {t('docker.actions.remove')}
                </Button>
              )}
            />
          </>
        ) : null}

        {tab === 'networks' ? (
          <>
            <div className="u-flex u-gap-2 u-mb-3">
              <Field htmlFor="dock-net" label={t('docker.actions.createNetwork')}>
                <input id="dock-net" value={netName} onChange={(e) => setNetName(e.target.value)} />
              </Field>
              <Button onClick={() => void run(() => dockerApi.createNetwork(netName.trim()))}>
                {t('docker.actions.createNetwork')}
              </Button>
            </div>
            <DataTable<DockerNetworkRow>
              rowKey={(row) => row.id || row.name}
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
                    onClick={() => void run(() => dockerApi.removeNetwork(row.name || row.id))}
                  >
                    {t('docker.actions.remove')}
                  </Button>
                )
              }
            />
          </>
        ) : null}

        {tab === 'prune' ? (
          <>
            <DataTable<DockerDfRow>
              rowKey={(row) => row.type}
              columns={[
                { key: 'type', header: t('docker.col.type'), render: (row) => row.type },
                { key: 'size', header: t('docker.col.size'), render: (row) => row.size },
                {
                  key: 'reclaim',
                  header: t('docker.col.reclaimable'),
                  render: (row) => row.reclaimable,
                },
              ]}
              rows={df}
            />
            <Field htmlFor="dock-prune-c" label={t('docker.pruneConfirm')}>
              <input id="dock-prune-c" value={pruneConfirm} onChange={(e) => setPruneConfirm(e.target.value)} />
            </Field>
            <div className="u-flex u-gap-2 u-mt-3">
              <Button onClick={() => void run(() => dockerApi.prune('containers'))}>
                {t('docker.actions.pruneContainers')}
              </Button>
              <Button onClick={() => void run(() => dockerApi.prune('images'))}>
                {t('docker.actions.pruneImages')}
              </Button>
              <Button onClick={() => void run(() => dockerApi.prune('volumes', pruneConfirm))}>
                {t('docker.actions.pruneVolumes')}
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  void run(
                    () => dockerApi.prune('system', pruneConfirm),
                    t('docker.actions.pruneSystem'),
                    '/api/v1/docker/prune',
                    { scope: 'system', confirm: pruneConfirm, execute: true },
                  )
                }
              >
                {t('docker.actions.pruneSystem')}
              </Button>
            </div>
          </>
        ) : null}

        {tab === 'settings' ? (
          <>
            <Alert variant="info">{t('docker.settingsHint')}</Alert>
            <Field htmlFor="dock-log-size" label={t('docker.settings.logMaxSize')}>
              <select id="dock-log-size" value={logMaxSize} onChange={(e) => setLogMaxSize(e.target.value)}>
                {['1m', '10m', '20m', '50m', '100m'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <label className="u-flex u-gap-2 u-mt-2">
              <input
                type="checkbox"
                checked={liveRestore}
                onChange={(e) => setLiveRestore(e.target.checked)}
              />
              {t('docker.settings.liveRestore')}
            </label>
            <Field htmlFor="dock-mirrors" label={t('docker.settings.mirrors')}>
              <textarea
                id="dock-mirrors"
                rows={3}
                value={mirrors}
                onChange={(e) => setMirrors(e.target.value)}
              />
            </Field>
            <Field htmlFor="dock-insecure" label={t('docker.settings.insecure')}>
              <textarea
                id="dock-insecure"
                rows={2}
                value={insecure}
                onChange={(e) => setInsecure(e.target.value)}
              />
            </Field>
            <Button
              className="u-mt-3"
              onClick={() =>
                void run(() =>
                  dockerApi.patchDaemon({
                    logMaxSize,
                    liveRestore,
                    registryMirrors: mirrors.split(/\s+/).map((s) => s.trim()).filter(Boolean),
                    insecureRegistries: insecure.split(/\s+/).map((s) => s.trim()).filter(Boolean),
                  }),
                )
              }
            >
              {t('docker.actions.applyDaemon')}
            </Button>
            {daemon ? (
              <p className="u-text-sm u-mt-2">
                <code>{daemon.path}</code>
              </p>
            ) : null}
          </>
        ) : null}

        {tab === 'about' ? (
          <div className="prose">
            <p>{t('docker.about.body')}</p>
            <p>{t('docker.about.honesty')}</p>
            <p>
              <Link to="/validators">{t('docker.about.validators')}</Link>
            </p>
          </div>
        ) : null}
      </PageTabs>

      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title={t('docker.actions.run')}
        size="md"
      >
        <form onSubmit={(e) => void onRun(e)}>
          <Field htmlFor="dock-run-img" label={t('docker.col.image')}>
            <input
              id="dock-run-img"
              value={runImage}
              onChange={(e) => setRunImage(e.target.value)}
              required
            />
          </Field>
          <Field htmlFor="dock-run-name" label={t('docker.col.name')}>
            <input id="dock-run-name" value={runName} onChange={(e) => setRunName(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('docker.actions.run')}
          </Button>
        </form>
      </Modal>

      <Modal
        open={Boolean(logTitle)}
        onClose={() => {
          setLogTitle('');
          setInspectText('');
        }}
        title={logTitle}
        size="lg"
      >
        <pre className="code-block">
          {inspectText || logs.join('\n') || t('docker.logs.empty')}
        </pre>
      </Modal>
    </FeaturePageLayout>
  );
}
