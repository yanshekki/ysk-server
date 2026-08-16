/**
 * Validators (Beta) — list, create wizard, disk, about.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  CardSection,
  CheckboxField,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormLayout,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  StructuredFacts,
  type OpsResultLike,
} from '../../shared/components/ui';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { useOpsStreamOptional } from '../../shared/ops-stream/OpsStreamContext';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  isValidatorUpgradePolicy,
  validatorChainLabel,
  validatorNetworkLabel,
} from 'ysk-server-shared';
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

function profileLabel(id: string, t: (k: string) => string): string {
  const key = `validators.profile.${id}`;
  const out = t(key);
  return out === key ? id : out;
}

const RUNTIME_STATES = ['unknown', 'stopped', 'running', 'syncing', 'error'] as const;

function runtimeStateLabel(code: string | undefined, t: (k: string) => string): string {
  if (!code) return '—';
  return (RUNTIME_STATES as readonly string[]).includes(code)
    ? t(`validators.state.${code}`)
    : code;
}

function networkDisplay(
  network: string,
  t: (k: string) => string,
): { name: string; kind: 'mainnet' | 'testnet'; kindLabel: string; showName: boolean } {
  const proper = validatorNetworkLabel(network);
  const named = proper ?? t(`validators.network.${network}`);
  const kind = network === 'mainnet' ? 'mainnet' : 'testnet';
  const kindLabel = t(`validators.networkKind.${kind}`);
  return {
    name: named,
    kind,
    kindLabel,
    showName: Boolean(proper) || named !== kindLabel,
  };
}

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
  const [customPath, setCustomPath] = useState(false);
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
  const [pendingDelete, setPendingDelete] = useState<ValidatorInstanceDto | null>(null);
  const [pendingPruneId, setPendingPruneId] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState(false);
  const [pendingInstall, setPendingInstall] = useState(false);
  const [pendingAutoClear, setPendingAutoClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<OpsResultLike | null>(null);
  const [detail, setDetail] = useState<ValidatorInstanceDto | null>(null);
  const [status, setStatus] = useState<ValidatorStatusResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const [dockerInstalled, setDockerInstalled] = useState<boolean | null>(null);

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
    setCustomPath(false);
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
        dataPath: customPath ? dataPath.trim() || undefined : undefined,
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

  const diskTone =
    disk == null ? undefined : disk.tone === 'danger' ? 'danger' : disk.tone === 'warn' ? 'warn' : 'ok';

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
              />
            }
            columns={[
              { key: 'id', header: t('validators.col.id'), render: (row) => row.id },
              {
                key: 'chain',
                header: t('validators.col.chain'),
                render: (row) => validatorChainLabel(row.chain),
              },
              {
                key: 'network',
                header: t('validators.col.network'),
                render: (row) => {
                  const net = networkDisplay(row.network, t);
                  return (
                    <span>
                      {net.showName ? <>{net.name} </> : null}
                      <Badge tone={net.kind === 'mainnet' ? 'warn' : 'ok'}>{net.kindLabel}</Badge>
                    </span>
                  );
                },
              },
              {
                key: 'profile',
                header: t('validators.col.profile'),
                render: (row) => profileLabel(row.profile, t),
              },
              {
                key: 'status',
                header: t('validators.col.status'),
                render: (row) => {
                  const s = summaries[row.id];
                  const label = runtimeStateLabel(
                    s?.status ?? row.lastStatus?.status ?? row.desiredState,
                    t,
                  );
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
                <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
                  {t('validators.actions.delete')}
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
                  if (on) {
                    setPendingAutoClear(true);
                    return;
                  }
                  setAutoClear(false);
                  void validatorsApi.saveSettings(false);
                }}
              />
            </Field>
            <DescriptionList
              columns={1}
              items={[
                {
                  label: t('validators.disk.root'),
                  value: (
                    <code>
                      {disk?.rootPath || disk?.instances[0]?.dataPath || '—'}
                    </code>
                  ),
                },
                {
                  label: t('validators.disk.used'),
                  value: formatBytes(
                    disk?.usedBytes ??
                      (disk?.totalBytes != null && disk.availBytes != null
                        ? disk.totalBytes - disk.availBytes
                        : null),
                  ),
                },
                {
                  label: t('validators.disk.free'),
                  value: formatBytes(disk?.availBytes),
                },
              ]}
            />
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
                onClick={() => setPendingInstall(true)}
              >
                {t('validators.wizard.install')}
              </Button>
            )}
          </>
        }
      >
        <div className="stack val-wizard">
        {step === 0 ? (
          <>
            <SegRadio
              name="chain"
              aria-label={t('validators.wizard.stepChain')}
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
              ).map((c) => {
                const spec = chains.find((x) => x.id === c.id);
                const hasMain = spec?.networks.some((n) => n.kind === 'mainnet');
                const hasTest = spec?.networks.some((n) => n.kind !== 'mainnet');
                const kind =
                  hasMain && hasTest
                    ? t('validators.networkKind.mixed')
                    : hasMain
                      ? t('validators.networkKind.mainnet')
                      : t('validators.networkKind.testnet');
                return {
                  value: c.id,
                  label: `${validatorChainLabel(c.id)} · ${kind}`,
                };
              })}
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
              aria-label={t('validators.wizard.stepNetwork')}
              value={network}
              onChange={setNetwork}
              options={(chainSpec?.networks ?? []).map((n) => {
                const d = networkDisplay(n.id, t);
                return {
                  value: n.id,
                  label: d.showName ? `${d.name} · ${d.kindLabel}` : d.kindLabel,
                };
              })}
            />
            {needBytes != null ? (
              <Alert variant={diskShort ? 'error' : 'info'}>
                {t(diskShort ? 'validators.wizard.diskShort' : 'validators.wizard.diskNeed', {
                  need: formatBytes(needBytes),
                  free: formatBytes(disk?.availBytes),
                })}
              </Alert>
            ) : null}
            {netSpec?.kind === 'mainnet' ? (
              <>
                <Alert variant="warn">{t('validators.wizard.mainnetWarn')}</Alert>
                <label className="u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={mainnetOk}
                    onChange={(e) => setMainnetOk(e.target.checked)}
                  />
                  <span>{t('validators.wizard.mainnetAck')}</span>
                </label>
              </>
            ) : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            <SegRadio
              name="profile"
              aria-label={t('validators.wizard.stepProfile')}
              value={profile}
              onChange={setProfile}
              options={['minimal', 'pruned', 'validator-ready', 'rpc'].map((p) => ({
                value: p,
                label: profileLabel(p, t),
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
              <FormLayout>
                <Field htmlFor="val-el" label={t('validators.clients.el')}>
                  <SegRadio
                    name="el"
                    aria-label={t('validators.clients.el')}
                    value={el}
                    onChange={setEl}
                    options={(chainSpec?.clients?.filter((c) => c.role === 'el') ?? []).map((c) => ({
                      value: c.id,
                      label: c.id,
                    }))}
                  />
                </Field>
                <Field htmlFor="val-cl" label={t('validators.clients.cl')}>
                  <SegRadio
                    name="cl"
                    aria-label={t('validators.clients.cl')}
                    value={cl}
                    onChange={setCl}
                    options={(chainSpec?.clients?.filter((c) => c.role === 'cl') ?? []).map((c) => ({
                      value: c.id,
                      label: c.id,
                    }))}
                  />
                </Field>
              </FormLayout>
            ) : null}
            {chain === 'ada' ? (
              <label className="u-flex u-gap-2 u-items-center">
                <input
                  type="checkbox"
                  checked={mithril}
                  onChange={(e) => setMithril(e.target.checked)}
                />
                <span>{t('validators.mithril.label')}</span>
              </label>
            ) : null}
            <FormLayout>
              <Field htmlFor="val-mem" label={t('validators.wizard.memory')}>
                <SegRadio
                  name="mem"
                  aria-label={t('validators.wizard.memory')}
                  value={memory}
                  onChange={setMemory}
                  options={[
                    { value: '', label: t('validators.wizard.limitNone') },
                    { value: '2g', label: '2g' },
                    { value: '4g', label: '4g' },
                    { value: '8g', label: '8g' },
                    { value: '16g', label: '16g' },
                  ]}
                />
              </Field>
              <Field htmlFor="val-cpus" label={t('validators.wizard.cpus')}>
                <SegRadio
                  name="cpus"
                  aria-label={t('validators.wizard.cpus')}
                  value={cpus}
                  onChange={setCpus}
                  options={[
                    { value: '', label: t('validators.wizard.limitNone') },
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '4', label: '4' },
                    { value: '8', label: '8' },
                  ]}
                />
              </Field>
              <Field htmlFor="val-rpcport" label={t('validators.wizard.rpcPort')}>
                <SegRadio
                  name="rpcport"
                  aria-label={t('validators.wizard.rpcPort')}
                  value={rpcPort}
                  onChange={setRpcPort}
                  options={[
                    { value: '', label: t('validators.wizard.rpcDefault') },
                    { value: '8545', label: '8545' },
                    { value: '8551', label: '8551' },
                    { value: '8546', label: '8546' },
                  ]}
                />
              </Field>
            </FormLayout>
            <label className="u-flex u-gap-2 u-items-center">
              <input
                type="checkbox"
                checked={customPath}
                onChange={(e) => {
                  const on = e.target.checked;
                  setCustomPath(on);
                  if (!on) setDataPath('');
                }}
              />
              <span>{t('validators.wizard.customPath')}</span>
            </label>
            {customPath ? (
              <Field htmlFor="val-datapath" label={t('validators.wizard.dataPath')}>
                <input
                  id="val-datapath"
                  value={dataPath}
                  onChange={(e) => setDataPath(e.target.value)}
                  placeholder="/var/lib/ysk-server/validators/…"
                />
              </Field>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <>
            <StructuredFacts
              items={[
                {
                  label: t('validators.col.chain'),
                  value: validatorChainLabel(chain, chainSpec?.title),
                },
                {
                  label: t('validators.col.network'),
                  value:
                    validatorNetworkLabel(network) ?? t(`validators.network.${network}`),
                  hint:
                    netSpec?.kind === 'mainnet'
                      ? t('validators.networkKind.mainnet')
                      : t('validators.networkKind.testnet'),
                },
                {
                  label: t('validators.col.profile'),
                  value: profileLabel(profile, t),
                },
              ]}
            />
            <DescriptionList
              columns={1}
              items={[
                ...(chain === 'eth'
                  ? [
                      { label: t('validators.clients.el'), value: el },
                      { label: t('validators.clients.cl'), value: cl },
                    ]
                  : []),
                ...(chain === 'ada'
                  ? [
                      {
                        label: t('validators.mithril.label'),
                        value: mithril ? t('common.yes') : t('common.no'),
                      },
                    ]
                  : []),
                {
                  label: t('validators.wizard.memory'),
                  value: memory || t('validators.wizard.limitNone'),
                },
                {
                  label: t('validators.wizard.cpus'),
                  value: cpus || t('validators.wizard.limitNone'),
                },
                {
                  label: t('validators.wizard.rpcPort'),
                  value: rpcPort || t('validators.wizard.rpcDefault'),
                },
                ...(customPath && dataPath
                  ? [{ label: t('validators.wizard.dataPath'), value: dataPath }]
                  : []),
              ]}
            />
          </>
        ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.id ?? ''}
        description={
          detail
            ? `${validatorChainLabel(detail.chain)} · ${
                validatorNetworkLabel(detail.network) ?? t(`validators.network.${detail.network}`)
              } · ${profileLabel(detail.profile, t)}`
            : undefined
        }
        size="xl"
        footer={
          detail ? (
            <>
              {status?.running || status?.status === 'running' ? (
                <Button onClick={() => void runAction(() => validatorsApi.stop(detail.id))}>
                  {t('validators.actions.stop')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void runAction(() => validatorsApi.start(detail.id))}
                >
                  {t('validators.actions.start')}
                </Button>
              )}
              <Button onClick={() => void runAction(() => validatorsApi.restart(detail.id))}>
                {t('validators.actions.restart')}
              </Button>
              <Button onClick={() => setDetail(null)}>{t('common.close')}</Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="stack val-detail">
            <CardSection title={t('validators.detail.status')}>
              <StructuredFacts
                items={[
                  { label: t('validators.col.status'), value: runtimeStateLabel(status?.status, t) },
                  {
                    label: t('validators.detail.sync'),
                    value:
                      status?.syncProgress != null
                        ? `${Math.round(status.syncProgress * 100)}%`
                        : '—',
                  },
                  {
                    label: t('validators.detail.peers'),
                    value: status?.peers != null ? String(status.peers) : '—',
                  },
                  { label: t('validators.detail.version'), value: status?.version ?? '—' },
                ]}
              />
              {status?.lastError ? <Alert variant="error">{status.lastError}</Alert> : null}
              {stats.length ? (
                <DescriptionList
                  columns={1}
                  items={stats.map((s) => ({
                    label: String(s.Name ?? s.ID ?? t('validators.col.id')),
                    value: `CPU ${s.CPUPerc ?? '—'} · MEM ${s.MemUsage ?? '—'}`,
                  }))}
                />
              ) : null}
            </CardSection>

            <CardSection title={t('validators.detail.access')}>
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
            </CardSection>

            <CardSection
              title={t('validators.detail.upgrade')}
              description={t('validators.detail.upgradeHint')}
            >
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
                <SegRadio
                  name="val-policy"
                  aria-label={t('validators.policy.label')}
                  value={detail.upgradePolicy}
                  onChange={(v) => {
                    if (!isValidatorUpgradePolicy(v)) return;
                    void validatorsApi.policy(detail.id, v).then(() => {
                      setDetail((d) => (d ? { ...d, upgradePolicy: v } : d));
                      void load();
                    });
                  }}
                  options={['manual', 'notify', 'auto-safe', 'auto-all'].map((p) => ({
                    value: p,
                    label: t(`validators.policy.${p}`),
                  }))}
                />
              </Field>
              <ActionBar>
                <Button
                  disabled={!status?.upgrade}
                  onClick={() =>
                    void runAction(
                      () => validatorsApi.upgrade(detail.id),
                      t('validators.actions.upgrade'),
                      { id: detail.id, action: 'update', body: { execute: true } },
                    )
                  }
                >
                  {t('validators.actions.upgrade')}
                </Button>
              </ActionBar>
            </CardSection>

            <CardSection
              title={t('validators.detail.network')}
              description={t('validators.detail.networkHint')}
            >
              <Field htmlFor="val-switch" label={t('validators.actions.switchNetwork')}>
                <SegRadio
                  name="val-switch"
                  aria-label={t('validators.actions.switchNetwork')}
                  value={switchNet || detail.network}
                  onChange={setSwitchNet}
                  options={(chains.find((c) => c.id === detail.chain)?.networks ?? []).map((n) => ({
                    value: n.id,
                    label: validatorNetworkLabel(n.id) ?? t(`validators.network.${n.id}`),
                  }))}
                />
              </Field>
              <ActionBar>
                <Button
                  disabled={!switchNet || switchNet === detail.network}
                  onClick={() => setPendingSwitch(true)}
                >
                  {t('validators.actions.switchNetwork')}
                </Button>
              </ActionBar>
            </CardSection>

            <CardSection title={t('validators.detail.maintain')}>
              <ActionBar>
                <Button onClick={() => setPendingPruneId(detail.id)}>
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
              </ActionBar>
            </CardSection>

            <div className="danger-zone">
              <h3 className="danger-zone__title">{t('validators.detail.danger')}</h3>
              <p className="danger-zone__desc">{t('validators.detail.dangerHint')}</p>
              <FormLayout>
                <CheckboxField
                  id="val-remove-unit"
                  label={t('validators.actions.removeUnit')}
                  checked={removeUnit}
                  onChange={setRemoveUnit}
                />
                <CheckboxField
                  id="val-restore-after"
                  label={t('validators.actions.restoreAfter')}
                  checked={restoreAfter}
                  onChange={setRestoreAfter}
                />
              </FormLayout>
              <FormActions>
                <Button variant="danger" onClick={() => setPendingClear(true)}>
                  {t('validators.actions.clear')}
                </Button>
              </FormActions>
            </div>

            {checklist ? (
              <CardSection title={t('validators.stake.title')}>
                <ul className="list-plain">
                  {checklist.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
                {checklist.links.length ? (
                  <ul className="list-plain">
                    {checklist.links.map((l) => (
                      <li key={l.href}>
                        <a href={l.href} target="_blank" rel="noreferrer">
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {checklist.snapshot?.notes?.length ? (
                  <Alert variant="info">{checklist.snapshot.notes.join(' ')}</Alert>
                ) : null}
              </CardSection>
            ) : null}

            <CardSection title={t('validators.detail.compose')}>
              <Field htmlFor="val-compose" label={t('validators.compose.label')}>
                <textarea
                  id="val-compose"
                  rows={8}
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  spellCheck={false}
                />
              </Field>
              <ActionBar>
                <Button
                  onClick={() =>
                    void runAction(() => validatorsApi.saveCompose(detail.id, composeText))
                  }
                >
                  {t('validators.compose.save')}
                </Button>
              </ActionBar>
            </CardSection>

            <CardSection title={t('validators.detail.logs')}>
              <CheckboxField
                id="val-follow-logs"
                label={t('validators.logs.follow')}
                checked={followLogs}
                onChange={setFollowLogs}
              />
              <pre className="code-block">{logs.join('\n') || t('validators.logs.empty')}</pre>
            </CardSection>
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={Boolean(pendingPruneId)}
        onClose={() => setPendingPruneId(null)}
        title={t('validators.actions.pruneTitle')}
        description={t('validators.actions.pruneDesc')}
        confirmText={pendingPruneId ?? undefined}
        confirmLabel={t('validators.actions.prune')}
        severity="critical"
        busy={busy}
        consequences={[t('validators.actions.pruneC1')]}
        onConfirm={() => {
          const id = pendingPruneId;
          if (!id) return;
          setPendingPruneId(null);
          void runAction(() => validatorsApi.prune(id));
        }}
      />
      <ConfirmDialog
        open={pendingClear && Boolean(detail)}
        onClose={() => setPendingClear(false)}
        title={t('validators.actions.clearTitle', { id: detail?.id ?? '' })}
        description={t('validators.detail.dangerHint')}
        confirmText={detail?.id}
        confirmLabel={t('validators.actions.clear')}
        severity="critical"
        busy={busy}
        consequences={[
          t('validators.actions.clearC1'),
          removeUnit ? t('validators.actions.deleteC3') : t('validators.actions.clearC2'),
        ]}
        onConfirm={() => {
          if (!detail) return;
          const id = detail.id;
          setPendingClear(false);
          void runAction(() =>
            validatorsApi.clearFull(id, id, {
              removeUnit,
              restoreSnapshot: restoreAfter,
            }),
          ).then(() => setDetail(null));
        }}
      />
      <ConfirmDialog
        open={pendingSwitch && Boolean(detail)}
        onClose={() => setPendingSwitch(false)}
        title={t('validators.actions.switchTitle')}
        description={t('validators.detail.networkHint')}
        confirmText={detail?.id}
        confirmLabel={t('validators.actions.switchNetwork')}
        severity="critical"
        busy={busy}
        consequences={[t('validators.actions.switchC1')]}
        onConfirm={() => {
          if (!detail || !switchNet) return;
          setPendingSwitch(false);
          void runAction(() => validatorsApi.switchNetwork(detail.id, switchNet, detail.id));
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={t('validators.actions.deleteTitle', { id: pendingDelete?.id ?? '' })}
        description={t('validators.actions.deleteDesc')}
        confirmText={pendingDelete?.id}
        confirmLabel={t('validators.actions.delete')}
        severity="critical"
        busy={busy}
        consequences={[
          t('validators.actions.deleteC1'),
          t('validators.actions.deleteC2'),
          t('validators.actions.deleteC3'),
        ]}
        onConfirm={() => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          void runAction(() => validatorsApi.remove(id, id)).then(() => {
            setPendingDelete(null);
            if (detail?.id === id) setDetail(null);
          });
        }}
      />
      <ConfirmDialog
        open={pendingInstall}
        onClose={() => setPendingInstall(false)}
        title={t('validators.wizard.installConfirmTitle')}
        description={t('validators.wizard.installConfirmDesc', {
          chain: validatorChainLabel(chain, chainSpec?.title),
          network: validatorNetworkLabel(network) ?? network,
          profile: profileLabel(profile, t),
          disk: needBytes != null ? formatBytes(needBytes) : '—',
        })}
        confirmLabel={t('validators.wizard.install')}
        severity="destructive"
        busy={busy}
        consequences={[
          t('validators.wizard.installC1'),
          t('validators.wizard.installC2'),
        ]}
        onConfirm={() => {
          setPendingInstall(false);
          setWizard(false);
          void create(true);
        }}
      />
      <ConfirmDialog
        open={pendingAutoClear}
        onClose={() => setPendingAutoClear(false)}
        title={t('validators.disk.autoClearConfirmTitle')}
        description={t('validators.disk.autoClearRisk')}
        confirmText="AUTO-CLEAR"
        confirmLabel={t('common.confirm')}
        severity="critical"
        consequences={[t('validators.disk.autoClearC1')]}
        onConfirm={() => {
          setPendingAutoClear(false);
          setAutoClear(true);
          void validatorsApi.saveSettings(true);
        }}
      />
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
