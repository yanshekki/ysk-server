/**
 * Validators (Beta) — list, create wizard, disk, about.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  type OpsResultLike,
} from '../../shared/components/ui';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { useOpsStreamOptional } from '../../shared/ops-stream/OpsStreamContext';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { dockerApi } from '../../features/docker';
import {
  streamValidatorAction,
  validatorsApi,
  type ValidatorChainSpec,
  type ValidatorDiskInstance,
  type ValidatorDiskReport,
  type ValidatorInstanceDto,
  type ValidatorOpsResponse,
  type ValidatorStatusResponse,
  type ValidatorSummaryDto,
} from '../../features/validators';

const TABS = ['nodes', 'disk', 'about'] as const;

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(1)} GiB`;
}

export function ValidatorsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'nodes');
  const [instances, setInstances] = useState<ValidatorInstanceDto[]>([]);
  const [chains, setChains] = useState<ValidatorChainSpec[]>([]);
  const [disk, setDisk] = useState<ValidatorDiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [chain, setChain] = useState('eth');
  const [network, setNetwork] = useState('hoodi');
  const [profile, setProfile] = useState('minimal');
  const [mainnetOk, setMainnetOk] = useState(false);
  const [el, setEl] = useState('reth');
  const [cl, setCl] = useState('lighthouse');
  const [mithril, setMithril] = useState(true);
  const [memory, setMemory] = useState('');
  const [cpus, setCpus] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [rpcPort, setRpcPort] = useState('');
  const stream = useOpsStreamOptional();
  const [summaries, setSummaries] = useState<Record<string, ValidatorSummaryDto>>({});
  const [autoClear, setAutoClear] = useState(false);
  const [followLogs, setFollowLogs] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [stats, setStats] = useState<Record<string, string>[]>([]);
  const [checklist, setChecklist] = useState<{
    items: string[];
    links: Array<{ label: string; href: string }>;
    snapshot?: { kind: string; notes: string[] };
  } | null>(null);
  const [switchNet, setSwitchNet] = useState('');
  const [removeUnit, setRemoveUnit] = useState(false);
  const [restoreAfter, setRestoreAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<OpsResultLike | null>(null);
  const [detail, setDetail] = useState<ValidatorInstanceDto | null>(null);
  const [status, setStatus] = useState<ValidatorStatusResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearText, setClearText] = useState('');
  const [dockerInstalled, setDockerInstalled] = useState<boolean | null>(null);
  const [copiedCli, setCopiedCli] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, diskRes, chainRes, dock] = await Promise.all([
        validatorsApi.list(),
        validatorsApi.disk(),
        validatorsApi.chains(),
        dockerApi.status().catch(() => null),
      ]);
      setInstances(list.instances ?? []);
      setDisk(diskRes.disk ?? null);
      setChains(chainRes.chains ?? []);
      const map: Record<string, ValidatorSummaryDto> = {};
      for (const s of list.summaries ?? []) map[s.id] = s;
      setSummaries(map);
      setAutoClear(list.settings?.autoClear === true);
      setDockerInstalled(dock?.status?.installed === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!followLogs || !detail) return;
    const tmr = window.setInterval(() => {
      void validatorsApi.logs(detail.id).then((lg) => setLogs(lg.lines ?? []));
    }, 4000);
    return () => window.clearInterval(tmr);
  }, [followLogs, detail]);

  const chainSpec = useMemo(() => chains.find((c) => c.id === chain), [chains, chain]);
  const netSpec = chainSpec?.networks.find((n) => n.id === network);
  const needBytes =
    chainSpec?.minFreeBytes?.[network]?.[profile as 'minimal'] ??
    chainSpec?.minFreeBytes?.[network]?.minimal ??
    null;
  const diskShort =
    needBytes != null && disk?.availBytes != null && disk.availBytes < needBytes;
  const canCreate =
    dockerInstalled === true &&
    Boolean(chainSpec && netSpec) &&
    (netSpec?.kind !== 'mainnet' || mainnetOk) &&
    !diskShort;

  const openWizard = () => {
    setWizard(true);
    setStep(0);
    setChain('eth');
    setNetwork(chainSpec?.networks.find((n) => n.recommended)?.id ?? 'hoodi');
    setProfile('minimal');
    setMainnetOk(false);
    setEl('reth');
    setCl('lighthouse');
    setMithril(true);
    setMemory('');
    setCpus('');
    setDataPath('');
    setRpcPort('');
    setOps(null);
  };

  const create = async (execute: boolean) => {
    setBusy(true);
    try {
      const r = await validatorsApi.create({
        chain,
        network,
        profile,
        el: chain === 'eth' ? el : undefined,
        cl: chain === 'eth' ? cl : undefined,
        mithril: chain === 'ada' ? mithril : undefined,
        memory: memory.trim() || undefined,
        cpus: cpus.trim() || undefined,
        dataPath: dataPath.trim() || undefined,
        rpcPort: rpcPort.trim() ? Number(rpcPort) : undefined,
        execute,
      });
      setOps(toOps(r));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (
    fn: () => Promise<ValidatorOpsResponse>,
    streamTitle?: string,
    streamSpec?: { id: string; action: string; body?: Record<string, unknown> },
  ) => {
    setBusy(true);
    const job = streamTitle && stream ? stream.begin({ kind: 'apply', title: streamTitle }) : null;
    try {
      if (job) stream?.appendLog(job.id, { stream: 'status', line: streamTitle ?? '' });
      let r: ValidatorOpsResponse;
      if (job && streamSpec) {
        const streamed = await streamValidatorAction(streamSpec.id, streamSpec.action, streamSpec.body ?? { execute: true }, {
          onLog: (line: { stream: 'stdout' | 'stderr' | 'status'; line: string }) =>
            stream?.appendLog(job.id, line),
          signal: job.signal,
        });
        r = {
          ok: streamed.ops.ok !== false,
          blocked: streamed.ops.blocked,
          notes: streamed.ops.notes,
          blockMessage: streamed.ops.blockMessage,
          apply_status: (streamed.raw as ValidatorOpsResponse | null)?.apply_status,
          instanceId: (streamed.raw as ValidatorOpsResponse | null)?.instanceId,
        };
      } else {
        r = await fn();
      }
      setOps(toOps(r));
      if (job) {
        stream?.finish(job.id, { ok: r.ok !== false && !r.blocked, error: r.blockMessage, toast: false });
      }
      await load();
      if (detail) {
        const st = await validatorsApi.status(detail.id);
        setStatus(st);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (job) stream?.finish(job.id, { ok: false, error: msg, toast: false });
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (row: ValidatorInstanceDto) => {
    setDetail(row);
    setClearText('');
    setLogs([]);
    setComposeText('');
    setStats([]);
    setChecklist(null);
    setSwitchNet(row.network);
    setRemoveUnit(false);
    setRestoreAfter(false);
    try {
      const [st, lg, cmp, stt, ck] = await Promise.all([
        validatorsApi.status(row.id),
        validatorsApi.logs(row.id),
        validatorsApi.compose(row.id),
        validatorsApi.stats(row.id),
        validatorsApi.checklist(row.id),
      ]);
      setStatus(st);
      setLogs(lg.lines ?? []);
      setComposeText(cmp.content ?? '');
      setStats(stt.items ?? []);
      setChecklist(ck);
    } catch {
      setStatus(null);
    }
  };

  const diskTone = disk?.tone === 'danger' ? 'danger' : disk?.tone === 'warn' ? 'warn' : 'ok';

  return (
    <FeaturePageLayout
      title={t('validators.title')}
      subtitle={t('validators.subtitle')}
      actions={
        <Button size="sm" onClick={() => void load()}>
          {t('validators.refresh')}
        </Button>
      }
      status={{
        pill: { label: t('validators.beta'), tone: 'warn' },
        items: [
          { label: t('validators.col.status'), value: String(instances.length) },
          {
            label: t('validators.disk.free'),
            value: formatBytes(disk?.availBytes),
            tone: diskTone,
          },
        ],
      }}
    >
      <SoftwareInstallBanner
        feature="docker"
        title={t('validators.errors.needDocker')}
        showReadyActions={false}
      />
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`validators.tab.${id}`) }))}
        active={tab}
        onChange={setTab}
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {ops ? <OpsResultPanel title={t('validators.title')} result={ops} /> : null}

        {tab === 'nodes' ? (
          <DataTable<ValidatorInstanceDto>
            rowKey={(row) => row.id}
            toolbar={
              <Button variant="primary" onClick={openWizard}>
                {t('validators.create')}
              </Button>
            }
            empty={
              <EmptyState
                title={t('validators.empty.title')}
                description={t('validators.empty.desc')}
                action={
                  <div>
                    <pre className="code-block u-mt-2">{t('validators.empty.cli')}</pre>
                    <Button
                      size="sm"
                      className="u-mt-2"
                      onClick={() => {
                        void navigator.clipboard?.writeText(t('validators.empty.cli')).then(() => {
                          setCopiedCli(true);
                          window.setTimeout(() => setCopiedCli(false), 2000);
                        });
                      }}
                    >
                      {copiedCli ? t('validators.empty.copied') : t('validators.empty.copyCli')}
                    </Button>
                  </div>
                }
              />
            }
            columns={[
              { key: 'id', header: t('validators.col.id'), render: (row) => row.id },
              {
                key: 'chain',
                header: t('validators.col.chain'),
                render: (row) => t(`validators.chain.${row.chain}`),
              },
              {
                key: 'network',
                header: t('validators.col.network'),
                render: (row) => (
                  <span>
                    {t(`validators.network.${row.network}`)}{' '}
                    <Badge tone={row.network === 'mainnet' ? 'warn' : 'ok'}>
                      {row.network === 'mainnet'
                        ? t('validators.networkKind.mainnet')
                        : t('validators.networkKind.testnet')}
                    </Badge>
                  </span>
                ),
              },
              {
                key: 'profile',
                header: t('validators.col.profile'),
                render: (row) => t(`validators.profile.${row.profile}`),
              },
              {
                key: 'status',
                header: t('validators.col.status'),
                render: (row) => {
                  const s = summaries[row.id];
                  const label = s?.status ?? row.lastStatus?.status ?? row.desiredState;
                  return (
                    <span>
                      <Badge
                        tone={
                          s?.status === 'error'
                            ? 'danger'
                            : s?.status === 'syncing'
                              ? 'warn'
                              : s?.running
                                ? 'ok'
                                : 'neutral'
                        }
                      >
                        {label}
                      </Badge>
                      {s?.syncProgress != null ? ` ${Math.round(s.syncProgress * 100)}%` : ''}
                      {s?.upgrade ? (
                        <Badge tone="warn">{t('validators.actions.upgrade')}</Badge>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                key: 'disk',
                header: t('validators.col.disk'),
                render: (row) => formatBytes(summaries[row.id]?.diskUsedBytes ?? row.lastStatus?.diskUsedBytes),
              },
            ]}
            rows={loading ? [] : instances}
            rowActions={(row) => (
              <>
                <Button size="sm" onClick={() => void openDetail(row)}>
                  {t('validators.actions.detail')}
                </Button>
                <Button size="sm" onClick={() => void runAction(() => validatorsApi.start(row.id))}>
                  {t('validators.actions.start')}
                </Button>
                <Button size="sm" onClick={() => void runAction(() => validatorsApi.stop(row.id))}>
                  {t('validators.actions.stop')}
                </Button>
              </>
            )}
          />
        ) : null}

        {tab === 'disk' ? (
          <>
            {disk?.tone === 'danger' ? (
              <Alert variant="error">{t('validators.disk.danger')}</Alert>
            ) : disk?.tone === 'warn' ? (
              <Alert variant="warn">{t('validators.disk.warn')}</Alert>
            ) : null}
            <Alert variant="error">{t('validators.disk.autoClearRisk')}</Alert>
            <Field htmlFor="val-autoclear" label={t('validators.disk.autoClear')}>
              <input
                id="val-autoclear"
                type="checkbox"
                checked={autoClear}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAutoClear(on);
                  void validatorsApi.saveSettings(on);
                }}
              />
            </Field>
            <dl className="desc-list">
              <div>
                <dt>{t('validators.disk.root')}</dt>
                <dd>
                  <code>{disk?.rootPath ?? '—'}</code>
                </dd>
              </div>
              <div>
                <dt>{t('validators.disk.used')}</dt>
                <dd>{formatBytes(disk?.usedBytes)}</dd>
              </div>
              <div>
                <dt>{t('validators.disk.free')}</dt>
                <dd>{formatBytes(disk?.availBytes)}</dd>
              </div>
            </dl>
            {disk?.instances.length ? (
              <DataTable<ValidatorDiskInstance>
                rowKey={(row) => row.id}
                columns={[
                  { key: 'id', header: t('validators.col.id'), render: (row) => row.id },
                  {
                    key: 'disk',
                    header: t('validators.col.disk'),
                    render: (row) => formatBytes(row.usedBytes),
                  },
                ]}
                rows={disk.instances}
              />
            ) : (
              <EmptyState title={t('validators.disk.none')} />
            )}
          </>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="validators" /> : null}
      </PageTabs>

      <Modal
        open={wizard}
        onClose={() => setWizard(false)}
        title={`${t('validators.wizard.title')} · ${t('validators.wizard.stepOf', { n: step + 1, total: 4 })}`}
        description={
          step === 0
            ? t('validators.wizard.stepChain')
            : step === 1
              ? t('validators.wizard.stepNetwork')
              : step === 2
                ? t('validators.wizard.stepProfile')
                : t('validators.wizard.stepSummary')
        }
        size="lg"
        footer={
          <>
            <Button onClick={() => setWizard(false)}>{t('common.cancel')}</Button>
            {step > 0 ? (
              <Button onClick={() => setStep((s) => s - 1)}>{t('validators.wizard.back')}</Button>
            ) : null}
            {step < 3 ? (
              <Button
                variant="primary"
                disabled={step === 1 && netSpec?.kind === 'mainnet' && !mainnetOk}
                onClick={() => setStep((s) => s + 1)}
              >
                {t('validators.wizard.next')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy || !canCreate}
                title={
                  dockerInstalled === false
                    ? t('validators.wizard.needDocker')
                    : diskShort
                      ? t('validators.wizard.diskShort')
                      : undefined
                }
                onClick={() => void create(true)}
              >
                {t('validators.wizard.install')}
              </Button>
            )}
          </>
        }
      >
        {step === 0 ? (
          <>
            <SegRadio
              name="chain"
              value={chain}
              onChange={(v) => {
                setChain(v);
                const c = chains.find((x) => x.id === v);
                setNetwork(c?.networks.find((n) => n.recommended)?.id ?? c?.networks[0]?.id ?? '');
              }}
              options={(chains.length
                ? chains
                : [
                    { id: 'eth' },
                    { id: 'avax' },
                    { id: 'near' },
                    { id: 'ada' },
                    { id: 'btc' },
                    { id: 'cosmos' },
                    { id: 'sui' },
                    { id: 'aptos' },
                    { id: 'dot' },
                    { id: 'sol' },
                  ]
              ).map((c) => ({
                value: c.id,
                label: t(`validators.chain.${c.id}`),
              }))}
            />
            {chainSpec?.heavy ? <Alert variant="warn">{t('validators.wizard.heavyWarn')}</Alert> : null}
            {dockerInstalled === false ? (
              <Alert variant="warn">{t('validators.wizard.needDocker')}</Alert>
            ) : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <SegRadio
              name="network"
              value={network}
              onChange={setNetwork}
              options={(chainSpec?.networks ?? []).map((n) => ({
                value: n.id,
                label: t(`validators.network.${n.id}`),
              }))}
            />
            {netSpec?.kind === 'mainnet' ? (
              <>
                <Alert variant="warn">{t('validators.wizard.mainnetWarn')}</Alert>
                <Field htmlFor="val-mainnet-ack" label={t('validators.wizard.mainnetAck')}>
                  <input
                    id="val-mainnet-ack"
                    type="checkbox"
                    checked={mainnetOk}
                    onChange={(e) => setMainnetOk(e.target.checked)}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            <SegRadio
              name="profile"
              value={profile}
              onChange={setProfile}
              options={['minimal', 'pruned', 'validator-ready', 'rpc'].map((p) => ({
                value: p,
                label: t(`validators.profile.${p}`),
              }))}
            />
            {needBytes != null ? (
              <Alert variant={diskShort ? 'error' : 'info'}>
                {t(diskShort ? 'validators.wizard.diskShort' : 'validators.wizard.diskNeed', {
                  need: formatBytes(needBytes),
                  free: formatBytes(disk?.availBytes),
                })}
              </Alert>
            ) : null}
            {chain === 'eth' ? (
              <>
                <Field htmlFor="val-el" label={t('validators.clients.el')}>
                  <select id="val-el" value={el} onChange={(e) => setEl(e.target.value)}>
                    {(chainSpec?.clients.filter((c) => c.role === 'el') ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="val-cl" label={t('validators.clients.cl')}>
                  <select id="val-cl" value={cl} onChange={(e) => setCl(e.target.value)}>
                    {(chainSpec?.clients.filter((c) => c.role === 'cl') ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            {chain === 'ada' ? (
              <Field htmlFor="val-mithril" label={t('validators.mithril.label')}>
                <input
                  id="val-mithril"
                  type="checkbox"
                  checked={mithril}
                  onChange={(e) => setMithril(e.target.checked)}
                />
              </Field>
            ) : null}
            <Field htmlFor="val-mem" label={t('validators.wizard.memory')}>
              <input id="val-mem" value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="4g" />
            </Field>
            <Field htmlFor="val-cpus" label={t('validators.wizard.cpus')}>
              <input id="val-cpus" value={cpus} onChange={(e) => setCpus(e.target.value)} placeholder="2.0" />
            </Field>
            <Field htmlFor="val-datapath" label={t('validators.wizard.dataPath')}>
              <input
                id="val-datapath"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
                placeholder="/var/lib/ysk-server/validators/…"
              />
            </Field>
            <Field htmlFor="val-rpcport" label={t('validators.wizard.rpcPort')}>
              <input
                id="val-rpcport"
                value={rpcPort}
                onChange={(e) => setRpcPort(e.target.value)}
                placeholder="8545"
              />
            </Field>
          </>
        ) : null}
        {step === 3 ? (
          <dl className="desc-list">
            <div>
              <dt>{t('validators.col.chain')}</dt>
              <dd>{t(`validators.chain.${chain}`)}</dd>
            </div>
            <div>
              <dt>{t('validators.col.network')}</dt>
              <dd>{t(`validators.network.${network}`)}</dd>
            </div>
            <div>
              <dt>{t('validators.col.profile')}</dt>
              <dd>{t(`validators.profile.${profile}`)}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.id ?? ''}
        size="lg"
        footer={
          detail ? (
            <>
              <Button onClick={() => void runAction(() => validatorsApi.restart(detail.id))}>
                {t('validators.actions.restart')}
              </Button>
              <Button
                onClick={() =>
                  void runAction(
                    () => validatorsApi.upgrade(detail.id),
                    t('validators.actions.upgrade'),
                    { id: detail.id, action: 'update', body: { execute: true } },
                  )
                }
                disabled={!status?.upgrade}
              >
                {t('validators.actions.upgrade')}
              </Button>
              <Button onClick={() => void runAction(() => validatorsApi.prune(detail.id))}>
                {t('validators.actions.prune')}
              </Button>
              {detail.chain === 'ada' ? (
                <Button
                  onClick={() =>
                    void runAction(
                      () => validatorsApi.mithril(detail.id, detail.id),
                      t('validators.mithril.action'),
                      {
                        id: detail.id,
                        action: 'mithril',
                        body: { confirm: detail.id, execute: true },
                      },
                    )
                  }
                >
                  {t('validators.mithril.action')}
                </Button>
              ) : null}
              <Button
                onClick={() =>
                  void runAction(
                    () => validatorsApi.snapshot(detail.id, detail.id),
                    t('validators.snapshot.action'),
                    {
                      id: detail.id,
                      action: 'snapshot',
                      body: { confirm: detail.id, execute: true },
                    },
                  )
                }
              >
                {t('validators.snapshot.action')}
              </Button>
              <Button
                variant="danger"
                disabled={clearText !== detail.id && clearText.toUpperCase() !== 'CLEAR'}
                onClick={() =>
                  void runAction(() =>
                    validatorsApi.clearFull(detail.id, clearText, {
                      removeUnit,
                      restoreSnapshot: restoreAfter,
                    }),
                  ).then(() => setDetail(null))
                }
              >
                {t('validators.actions.clear')}
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <p className="u-text-sm">
              {status?.status ?? '—'} · {t('validators.col.disk')}{' '}
              {status?.syncProgress != null
                ? `${Math.round(status.syncProgress * 100)}%`
                : '—'}
            </p>
            <ServiceAccessStrip
              serviceId={`val-${detail.id}`.slice(0, 48)}
              heading={detail.id}
              ports={[
                ...(detail.ports.p2p
                  ? [{ role: 'p2p', port: String(detail.ports.p2p), proto: 'tcp' }]
                  : []),
                ...(detail.ports.rpc
                  ? [{ role: 'rpc', port: String(detail.ports.rpc), proto: 'tcp' }]
                  : []),
              ]}
              compact
            />
            {status?.upgrade ? (
              <Alert variant="info">
                {status.upgrade.clientId} {status.upgrade.currentTag} → {status.upgrade.nextTag}
                {status.upgrade.changelogUrl ? (
                  <>
                    {' '}
                    <a href={status.upgrade.changelogUrl} target="_blank" rel="noreferrer">
                      {t('validators.upgrade.changelog')}
                    </a>
                  </>
                ) : null}
              </Alert>
            ) : null}
            <Field htmlFor="val-policy" label={t('validators.policy.label')}>
              <select
                id="val-policy"
                value={detail.upgradePolicy}
                onChange={(e) => {
                  const v = e.target.value;
                  void validatorsApi.policy(detail.id, v).then(() => load());
                }}
              >
                {['manual', 'notify', 'auto-safe', 'auto-all'].map((p) => (
                  <option key={p} value={p}>
                    {t(`validators.policy.${p}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="val-clear" label={t('validators.actions.clearConfirm')}>
              <input
                id="val-clear"
                value={clearText}
                onChange={(e) => setClearText(e.target.value)}
              />
            </Field>
            <label className="u-flex u-gap-2">
              <input type="checkbox" checked={removeUnit} onChange={(e) => setRemoveUnit(e.target.checked)} />
              {t('validators.actions.removeUnit')}
            </label>
            <label className="u-flex u-gap-2">
              <input type="checkbox" checked={restoreAfter} onChange={(e) => setRestoreAfter(e.target.checked)} />
              {t('validators.actions.restoreAfter')}
            </label>
            <Field htmlFor="val-switch" label={t('validators.actions.switchNetwork')}>
              <input id="val-switch" value={switchNet} onChange={(e) => setSwitchNet(e.target.value)} />
            </Field>
            <Button
              size="sm"
              onClick={() =>
                void runAction(() =>
                  validatorsApi.switchNetwork(detail.id, switchNet, clearText || detail.id),
                )
              }
            >
              {t('validators.actions.switchNetwork')}
            </Button>
            {stats.length ? (
              <pre className="code-block">
                {stats
                  .map((s) => `${s.Name ?? s.ID ?? ''} CPU ${s.CPUPerc ?? '—'} MEM ${s.MemUsage ?? '—'}`)
                  .join('\n')}
              </pre>
            ) : null}
            {checklist ? (
              <>
                <p className="u-text-sm">{t('validators.stake.title')}</p>
                <ul>
                  {checklist.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
                {checklist.links.map((l) => (
                  <p key={l.href}>
                    <a href={l.href} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  </p>
                ))}
                {checklist.snapshot?.notes?.length ? (
                  <Alert variant="info">{checklist.snapshot.notes.join(' ')}</Alert>
                ) : null}
              </>
            ) : null}
            <Field htmlFor="val-compose" label={t('validators.compose.label')}>
              <textarea
                id="val-compose"
                rows={8}
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              onClick={() =>
                void runAction(() => validatorsApi.saveCompose(detail.id, composeText))
              }
            >
              {t('validators.compose.save')}
            </Button>
            <label className="u-flex u-gap-2">
              <input
                type="checkbox"
                checked={followLogs}
                onChange={(e) => setFollowLogs(e.target.checked)}
              />
              {t('validators.logs.follow')}
            </label>
            <pre className="code-block">{logs.join('\n') || t('validators.logs.empty')}</pre>
          </>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}

function toOps(r: ValidatorOpsResponse): OpsResultLike {
  return {
    ok: r.ok,
    blocked: r.blocked,
    apply_status: r.apply_status as OpsResultLike['apply_status'],
    notes: r.notes ?? [],
    blockMessage: r.blockMessage,
  };
}
