/**
 * Validators (Beta) — list, create wizard, disk, about.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  buttonClassName,
  Card,
  CardSection,
  CheckboxField,
  CodeEditor,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormLayout,
  LoadingBlock,
  LogViewer,
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
  defaultValidatorMemoryLimit,
  parseValidatorMemoryBytes,
  VALIDATOR_MEMORY_HEADROOM_BYTES,
  isLiveValidatorStatus,
  isSafeValidatorDataPath,
  isValidatorUpgradePolicy,
  validatorChainLabel,
  validatorNetworkLabel,
  validatorNetworkLabelFor,
  VALIDATOR_DISK_DANGER_PCT,
  VALIDATOR_RUNTIME_STATUSES,
  type ValidatorDiskLeftover,
} from 'ysk-server-shared';
import { dockerApi } from '../../features/docker';
import {
  ValidatorPlaybookCard,
  ValidatorStakingGuide,
} from '../../features/validators/ValidatorStakingGuide';
import {
  defaultDataPath,
  previewComposeProject,
  previewInstanceId,
  validatorWizardBlockReason,
  validatorWizardCanInstall,
} from './validators-wizard';
import {
  streamValidatorAction,
  validatorsApi,
  type ValidatorChainSpec,
  type ValidatorDiskInstance,
  type ValidatorDiskReport,
  type ValidatorInstanceDto,
  type ValidatorOpsResponse,
  type ValidatorSoftwareReportDto,
  type ValidatorStatusResponse,
  type ValidatorSummaryDto,
} from '../../features/validators';
import type { ValidatorClientVersionsDto, ValidatorOfficialVersionDto } from 'ysk-server-shared';

const TABS = ['nodes', 'disk', 'stack', 'about'] as const;

function profileLabel(id: string, t: (k: string) => string): string {
  const key = `validators.profile.${id}`;
  const out = t(key);
  return out === key ? id : out;
}

function runtimeStateLabel(code: string | undefined, t: (k: string) => string): string {
  if (!code) return '—';
  return (VALIDATOR_RUNTIME_STATUSES as readonly string[]).includes(code)
    ? t(`validators.state.${code}`)
    : code;
}

function networkDisplay(
  network: string,
  t: (k: string) => string,
  chain?: string,
): { name: string; kind: 'mainnet' | 'testnet'; kindLabel: string; showName: boolean } {
  const proper = (chain ? validatorNetworkLabelFor(chain, network) : null) ?? validatorNetworkLabel(network);
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

function formatSpeed(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

function formatTraffic(s: ValidatorSummaryDto | undefined): string {
  if (!s || (s.rxRateBps == null && s.txRateBps == null)) return '—';
  return `↓ ${formatSpeed(s.rxRateBps)} · ↑ ${formatSpeed(s.txRateBps)}`;
}

export function officialLatestDockerTag(list?: ValidatorClientVersionsDto | null): string {
  if (!list) return '';
  const versions = list.versions ?? [];
  return (
    list.latest ||
    versions.find((v) => !v.prerelease)?.dockerTag ||
    versions[0]?.dockerTag ||
    list.pin ||
    ''
  );
}

function wizardPickedTag(userTag: string, list?: ValidatorClientVersionsDto | null): string {
  return userTag || officialLatestDockerTag(list);
}

export function versionOptionLabel(
  v: ValidatorOfficialVersionDto,
  pin: string,
  current: string | undefined,
  latest: string | undefined,
  t: (k: string) => string,
): string {
  const marks: string[] = [];
  if (latest && v.dockerTag === latest) marks.push(t('validators.software.official'));
  else if (v.dockerTag === pin) marks.push(t('validators.clients.pin'));
  if (current && v.dockerTag === current) marks.push(t('validators.clients.current'));
  if (v.prerelease) marks.push(t('validators.clients.prerelease'));
  return marks.length ? `${v.dockerTag} · ${marks.join(' · ')}` : v.dockerTag;
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
  const [elTag, setElTag] = useState('');
  const [clTag, setClTag] = useState('');
  const [nodeTag, setNodeTag] = useState('');
  const [versionMap, setVersionMap] = useState<Record<string, ValidatorClientVersionsDto>>({});
  const [pendingVersion, setPendingVersion] = useState<{
    clientId: string;
    tag: string;
    ref: string;
  } | null>(null);
  const [versionMainnetOk, setVersionMainnetOk] = useState(false);
  const [mithril, setMithril] = useState(false);
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
    nodeId?: string | null;
    blsPublicKey?: string | null;
    blsProofOfPossession?: string | null;
    cardanoProducer?: import('ysk-server-shared').CardanoProducerStatusDto;
    near?: import('ysk-server-shared').NearStakingIdentityDto;
    cosmos?: import('ysk-server-shared').CosmosStakingIdentityDto;
    sol?: import('ysk-server-shared').SolStakingIdentityDto;
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
  const [leftoverTarget, setLeftoverTarget] = useState<ValidatorDiskLeftover | null>(null);
  const [pendingRewrite, setPendingRewrite] = useState(false);
  const [pendingProducer, setPendingProducer] = useState<{
    kes?: string;
    vrf?: string;
    opcert?: string;
  } | null>(null);
  const [pendingProducerDetach, setPendingProducerDetach] = useState(false);
  const [producerMainnetOk, setProducerMainnetOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<OpsResultLike | null>(null);
  const [detail, setDetail] = useState<ValidatorInstanceDto | null>(null);
  const [status, setStatus] = useState<ValidatorStatusResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const [dockerInstalled, setDockerInstalled] = useState<boolean | null>(null);
  const [software, setSoftware] = useState<ValidatorSoftwareReportDto | null>(null);
  const [softwareErr, setSoftwareErr] = useState<string | null>(null);
  const [pullingRef, setPullingRef] = useState<string | null>(null);

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
      setDockerInstalled(
        dock?.status?.installed === true ||
          dock?.status?.daemonActive === true ||
          (list.instances?.length ?? 0) > 0,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSoftware = useCallback(async (refresh = false) => {
    setSoftwareErr(null);
    try {
      const r = await validatorsApi.software(refresh);
      setSoftware(r);
      if (typeof r.dockerInstalled === 'boolean') setDockerInstalled(r.dockerInstalled);
    } catch (e) {
      setSoftwareErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadClientVersions = useCallback(async (clientId: string, net?: string, refresh = false) => {
    if (!clientId) return;
    try {
      const r = await validatorsApi.clientVersions(clientId, { network: net, refresh });
      setVersionMap((prev) => ({ ...prev, [clientId]: r }));
    } catch {
      /* pin-only fallback */
    }
  }, []);

  useEffect(() => {
    if (tab === 'stack') void loadSoftware();
  }, [tab, loadSoftware]);

  useEffect(() => {
    if (!detail) return;
    for (const c of Object.values(detail.clients ?? {})) {
      void loadClientVersions(c.id, detail.network, true);
    }
  }, [detail, loadClientVersions]);

  useEffect(() => {
    if (!followLogs || !detail) return;
    const tmr = window.setInterval(() => {
      void validatorsApi.logs(detail.id).then((lg) => setLogs(lg.lines ?? []));
    }, 4000);
    return () => window.clearInterval(tmr);
  }, [followLogs, detail]);

  useEffect(() => {
    if (tab !== 'nodes') return;
    let inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const r = await validatorsApi.netio();
        setSummaries((prev) => {
          const next = { ...prev };
          for (const item of r.items ?? []) {
            const cur = next[item.id];
            if (!cur) continue;
            next[item.id] = {
              ...cur,
              rxBytes: item.rxBytes,
              txBytes: item.txBytes,
              rxRateBps: item.rxRateBps,
              txRateBps: item.txRateBps,
            };
          }
          return next;
        });
      } catch {
        /* keep last rates */
      } finally {
        inflight = false;
      }
    };
    const tmr = window.setInterval(() => void tick(), 5_000);
    const first = window.setTimeout(() => void tick(), 2_000);
    return () => {
      window.clearInterval(tmr);
      window.clearTimeout(first);
    };
  }, [tab]);

  const chainSpec = useMemo(() => chains.find((c) => c.id === chain), [chains, chain]);
  const netSpec = chainSpec?.networks.find((n) => n.id === network);

  useEffect(() => {
    if (!wizard) return;
    if (chain === 'eth') {
      void loadClientVersions(el, network, true);
      void loadClientVersions(cl, network, true);
      return;
    }
    const nodeId = chainSpec?.clients.find((c) => c.role === 'node')?.id;
    if (nodeId) void loadClientVersions(nodeId, network, true);
  }, [wizard, chain, network, el, cl, chainSpec, loadClientVersions]);
  const needBytes =
    chainSpec?.minFreeBytes?.[network]?.[profile as 'minimal'] ??
    chainSpec?.minFreeBytes?.[network]?.minimal ??
    null;
  const networkNeedBytes = chainSpec?.minFreeBytes?.[network]?.minimal ?? null;
  const diskShort =
    needBytes != null && disk?.availBytes != null && disk.availBytes < needBytes;
  const memNeedBytes = parseValidatorMemoryBytes(memory || defaultValidatorMemoryLimit(chain));
  const memShort =
    memNeedBytes != null &&
    disk?.memAvailableBytes != null &&
    disk.memAvailableBytes < memNeedBytes + VALIDATOR_MEMORY_HEADROOM_BYTES;
  const canCreate = validatorWizardCanInstall({
    dockerInstalled,
    hasSpec: Boolean(chainSpec && netSpec),
    isMainnet: netSpec?.kind === 'mainnet',
    mainnetAck: mainnetOk,
    diskShort,
    memShort,
    customPath,
    dataPath,
  });
  const blockReason = validatorWizardBlockReason({
    dockerInstalled,
    hasSpec: Boolean(chainSpec && netSpec),
    isMainnet: netSpec?.kind === 'mainnet',
    mainnetAck: mainnetOk,
    diskShort,
    memShort,
    customPath,
    dataPath,
  });
  const previewId = previewInstanceId(
    instances.map((i) => i.id),
    chain,
    network,
  );
  const resolvedPath = customPath
    ? dataPath.trim()
    : defaultDataPath(disk?.rootPath, previewId);
  const diskShortTitle =
    diskShort && needBytes != null
      ? t('validators.wizard.diskShortDetail', {
          need: formatBytes(needBytes),
          free: formatBytes(disk?.availBytes),
          short: formatBytes(Math.max(0, needBytes - (disk?.availBytes ?? 0))),
        })
      : t('validators.wizard.diskShort');
  const memShortTitle =
    memShort && memNeedBytes != null
      ? t('validators.wizard.memShortDetail', {
          need: formatBytes(memNeedBytes + VALIDATOR_MEMORY_HEADROOM_BYTES),
          free: formatBytes(disk?.memAvailableBytes),
          short: formatBytes(
            Math.max(0, memNeedBytes + VALIDATOR_MEMORY_HEADROOM_BYTES - (disk?.memAvailableBytes ?? 0)),
          ),
        })
      : t('validators.wizard.memShort');
  const installDisabledTitle =
    blockReason === 'docker'
      ? t('validators.wizard.needDocker')
      : blockReason === 'disk'
        ? diskShortTitle
        : blockReason === 'mainnet'
          ? t('validators.wizard.mainnetAck')
          : blockReason === 'path'
            ? t('validators.wizard.needCustomPath')
            : undefined;
  const canAdvanceFromDisk = !diskShort || (netSpec?.kind === 'mainnet' && mainnetOk);
  const autoClearCandidates = [...instances]
    .map((i) => {
      const st = summaries[i.id]?.status ?? i.desiredState;
      const running = isLiveValidatorStatus(st);
      return {
        id: i.id,
        usedBytes: summaries[i.id]?.diskUsedBytes ?? i.lastStatus?.diskUsedBytes ?? 0,
        running,
      };
    })
    .filter((i) => !i.running)
    .sort((a, b) => {
      const aEmpty = a.usedBytes <= 0 ? 1 : 0;
      const bEmpty = b.usedBytes <= 0 ? 1 : 0;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;
      return b.usedBytes - a.usedBytes;
    });

  const openWizard = () => {
    setWizard(true);
    setStep(0);
    setChain('eth');
    setNetwork(chainSpec?.networks.find((n) => n.recommended)?.id ?? 'hoodi');
    setProfile('minimal');
    setMainnetOk(false);
    setEl('reth');
    setCl('lighthouse');
    setElTag('');
    setClTag('');
    setNodeTag('');
    setMithril(false);
    setMemory('');
    setCpus('');
    setDataPath('');
    setCustomPath(false);
    setRpcPort('');
    setOps(null);
  };

  const create = async (execute: boolean) => {
    setBusy(true);
    const job = stream?.begin({
      kind: 'install',
      title: t('validators.wizard.install'),
    });
    try {
      const streamed = await validatorsApi.create(
        {
          chain,
          network,
          profile,
          el: chain === 'eth' ? el : undefined,
          cl: chain === 'eth' ? cl : undefined,
          elTag: chain === 'eth' ? wizardPickedTag(elTag, versionMap[el]) || undefined : undefined,
          clTag: chain === 'eth' ? wizardPickedTag(clTag, versionMap[cl]) || undefined : undefined,
          nodeTag:
            chain !== 'eth'
              ? wizardPickedTag(
                  nodeTag,
                  versionMap[chainSpec?.clients.find((c) => c.role === 'node')?.id ?? ''],
                ) || undefined
              : undefined,
          mithril: chain === 'ada' ? mithril : undefined,
          memory: memory.trim() || undefined,
          cpus: cpus.trim() || undefined,
          dataPath: customPath ? dataPath.trim() || undefined : undefined,
          rpcPort: rpcPort.trim() ? Number(rpcPort) : undefined,
          acceptLowDisk: netSpec?.kind === 'mainnet' && mainnetOk,
          acceptLowMem: memShort,
          execute,
        },
        {
          onLog: (line) => {
            if (job) stream?.appendLog(job.id, line);
          },
          signal: job?.signal,
        },
      );
      const raw = (streamed.raw ?? {}) as ValidatorOpsResponse;
      const result: OpsResultLike = {
        ok: streamed.ops.ok !== false && !streamed.ops.blocked && raw.apply_status !== 'failed',
        blocked: streamed.ops.blocked,
        apply_status: raw.apply_status as OpsResultLike['apply_status'],
        notes: streamed.ops.notes ?? raw.notes ?? [],
        blockMessage: streamed.ops.blockMessage ?? raw.blockMessage,
      };
      setOps(result);
      if (job) stream?.finish(job.id, { ok: result.ok !== false, error: result.blockMessage, toast: false });
      await load();
      if (result.ok && result.apply_status === 'applied') setWizard(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (job) stream?.finish(job.id, { ok: false, error: msg, toast: false });
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

  const pullImage = async (image: string, tag: string) => {
    const ref = `${image}:${tag}`;
    setPullingRef(ref);
    const job = stream?.begin({
      kind: 'install',
      title: t('validators.software.pulling', { ref }),
    });
    try {
      const r = await validatorsApi.pullSoftware(image, tag, {
        onLog: (line) => {
          if (job) stream?.appendLog(job.id, line);
        },
        signal: job?.signal,
      });
      setOps(r.ops);
      if (job) {
        stream?.finish(job.id, {
          ok: r.ops.ok !== false && !r.ops.blocked,
          error: r.ops.blockMessage,
          toast: false,
        });
      }
      await loadSoftware();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSoftwareErr(msg);
      if (job) stream?.finish(job.id, { ok: false, error: msg, toast: false });
    } finally {
      setPullingRef(null);
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
        items: loading
          ? []
          : [
              {
                label: t('validators.col.status'),
                value: String(instances.length),
              },
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

        {tab === 'nodes' && loading ? (
          <LoadingBlock label={t('common.loading')} />
        ) : null}
        {tab === 'nodes' && !loading ? (
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
                  const net = networkDisplay(row.network, t, row.chain);
                  return (
                    <div className="val-net">
                      <span className="val-net__name">
                        {net.showName ? net.name : net.kindLabel}
                      </span>
                      {net.showName ? (
                        <span className={`val-net__kind val-net__kind--${net.kind}`}>
                          {net.kindLabel}
                        </span>
                      ) : null}
                    </div>
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
                  const code = s?.status ?? row.lastStatus?.status ?? 'unknown';
                  const label = runtimeStateLabel(code, t);
                  const err = s?.lastError ?? row.lastStatus?.lastError;
                  const tone =
                    code === 'error'
                      ? 'danger'
                      : code === 'syncing' ||
                          code === 'starting' ||
                          code === 'rpc_wait'
                        ? 'warn'
                        : s?.running || isLiveValidatorStatus(code)
                          ? 'ok'
                          : 'neutral';
                  return (
                    <div className="val-status">
                      <Badge tone={tone}>{label}</Badge>
                      {s?.syncProgress != null && s.syncProgress < 1 ? (
                        <span className="val-status__meta">
                          {Math.round(s.syncProgress * 100)}%
                        </span>
                      ) : null}
                      {err && (code === 'error' || code === 'rpc_wait') ? (
                        <span className="val-status__meta muted u-text-sm">{err}</span>
                      ) : null}
                    </div>
                  );
                },
              },
              {
                key: 'traffic',
                header: t('validators.col.traffic'),
                render: (row) => (
                  <span className="val-traffic">{formatTraffic(summaries[row.id])}</span>
                ),
              },
              {
                key: 'disk',
                header: t('validators.col.disk'),
                render: (row) => formatBytes(summaries[row.id]?.diskUsedBytes ?? row.lastStatus?.diskUsedBytes),
              },
            ]}
            rows={instances}
            rowActions={(row) => (
              <ActionBar>
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
              </ActionBar>
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
                data-confirm="AUTO-CLEAR"
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
            <p className="muted u-text-sm u-mt-0">
              {t('validators.disk.autoClearThreshold', { n: VALIDATOR_DISK_DANGER_PCT })}
              {' · '}
              {autoClearCandidates.length
                ? t('validators.disk.autoClearCandidates', {
                    list: autoClearCandidates
                      .map((c) => `${c.id} (${formatBytes(c.usedBytes)})`)
                      .join(' · '),
                  })
                : t('validators.disk.autoClearNone')}
            </p>
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
                  value: formatBytes(disk?.usedBytes),
                },
                {
                  label: t('validators.disk.fsUsed'),
                  value: formatBytes(disk?.fsUsedBytes ?? disk?.totalBytes),
                },
                {
                  label: t('validators.disk.free'),
                  value: formatBytes(disk?.availBytes),
                },
              ]}
            />
            {disk?.rootPath ? (
              <p className="u-mt-3 u-mb-0">
                <Link
                  to={`/browse?path=${encodeURIComponent(disk.rootPath)}`}
                  className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                >
                  {t('validators.disk.browseRoot')}
                </Link>
              </p>
            ) : null}
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
            <DataTable<ValidatorDiskLeftover>
              title={t('validators.disk.leftoverTitle', {
                count: disk?.leftovers?.length ?? 0,
              })}
              description={t('validators.disk.leftoverDesc')}
              rowKey={(row) => row.path}
              columns={[
                {
                  key: 'name',
                  header: t('validators.col.id'),
                  render: (row) => (
                    <div>
                      <strong>{row.name}</strong>
                      <code className="u-block u-text-sm u-break-all">{row.path}</code>
                    </div>
                  ),
                },
                {
                  key: 'disk',
                  header: t('validators.col.disk'),
                  render: (row) => formatBytes(row.usedBytes),
                },
              ]}
              rows={disk?.leftovers ?? []}
              empty={<EmptyState title={t('validators.disk.leftoverEmpty')} />}
              rowActions={(row) => (
                <Button
                  variant="danger"
                  size="sm"
                  data-confirm={row.name}
                  onClick={() => setLeftoverTarget(row)}
                >
                  {t('validators.disk.leftoverRemove')}
                </Button>
              )}
            />
          </>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel stack">
            {softwareErr ? <Alert variant="error">{softwareErr}</Alert> : null}
            <Card>
              <CardSection
                title={t('validators.software.engine')}
                description={t('validators.software.engineDesc')}
              >
                <DescriptionList
                  columns={2}
                  items={[
                    {
                      label: 'Docker',
                      value: software
                        ? software.dockerInstalled
                          ? software.dockerVersion || t('common.installed')
                          : t('common.notInstalled')
                        : '…',
                    },
                    {
                      label: 'Compose',
                      value: software
                        ? software.composeAvailable
                          ? software.composeVersion || t('common.installed')
                          : t('common.notInstalled')
                        : '…',
                    },
                    {
                      label: t('common.status'),
                      value: software?.dockerRunning
                        ? t('common.running')
                        : software
                          ? t('common.stopped')
                          : '…',
                    },
                  ]}
                />
                <ActionBar className="u-mt-3">
                  <Link
                    to="/docker"
                    className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  >
                    Docker
                  </Link>
                  <Button size="sm" onClick={() => void loadSoftware(true)}>
                    {t('common.refresh')}
                  </Button>
                </ActionBar>
              </CardSection>
            </Card>
            <DataTable
              rowKey={(row) => `${row.chain}:${row.clientId}:${row.ref}`}
              empty={
                <EmptyState
                  title={t('validators.software.empty')}
                  description={t('validators.software.emptyDesc')}
                />
              }
              columns={[
                {
                  key: 'chain',
                  header: t('validators.col.chain'),
                  render: (row) => validatorChainLabel(row.chain),
                },
                {
                  key: 'client',
                  header: t('validators.software.client'),
                  render: (row) => `${row.clientId} · ${row.role}`,
                },
                {
                  key: 'ref',
                  header: t('validators.software.image'),
                  render: (row) => (
                    <div>
                      <code className="inline">{row.ref}</code>
                      {row.sourceGithub ? (
                        <p className="muted u-text-sm u-mb-0">
                          {t('validators.software.source')}: {row.registryHost} ·{' '}
                          <a href={`https://github.com/${row.sourceGithub}`} target="_blank" rel="noreferrer">
                            github.com/{row.sourceGithub}
                          </a>
                          {row.changelogUrl ? (
                            <>
                              {' '}
                              ·{' '}
                              <a href={row.changelogUrl} target="_blank" rel="noreferrer">
                                {t('validators.software.openRelease')}
                              </a>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'official',
                  header: t('validators.software.official'),
                  render: (row) =>
                    row.officialDockerTag && row.officialDockerTag !== row.tag ? (
                      <Badge tone="info">{row.officialDockerTag}</Badge>
                    ) : row.officialError ? (
                      <span className="muted u-text-sm">{row.officialError}</span>
                    ) : (
                      <span className="muted">{row.officialDockerTag || '—'}</span>
                    ),
                },
                {
                  key: 'present',
                  header: t('validators.software.present'),
                  render: (row) =>
                    row.present == null ? (
                      <Badge tone="neutral">{t('common.unknown')}</Badge>
                    ) : row.present ? (
                      <Badge tone="ok">{t('validators.software.local')}</Badge>
                    ) : (
                      <Badge tone="warn">{t('validators.software.missing')}</Badge>
                    ),
                },
                {
                  key: 'size',
                  header: t('validators.software.size'),
                  render: (row) => row.size || '—',
                },
                {
                  key: 'used',
                  header: t('validators.software.usedBy'),
                  render: (row) =>
                    row.usedBy.length ? row.usedBy.join(', ') : t('validators.software.unused'),
                },
                {
                  key: 'stale',
                  header: t('validators.software.stale'),
                  render: (row) =>
                    row.staleInstances?.length
                      ? row.staleInstances
                          .map((s) => t('validators.software.staleItem', { id: s.id, tag: s.tag }))
                          .join(', ')
                      : '—',
                },
              ]}
              rows={software?.images ?? []}
              rowActions={(row) => (
                <Button
                  size="sm"
                  loading={pullingRef === row.ref}
                  disabled={
                    !software?.dockerInstalled ||
                    !software.dockerRunning ||
                    pullingRef != null
                  }
                  title={
                    !software?.dockerInstalled
                      ? t('validators.wizard.needDocker')
                      : !software.dockerRunning
                        ? t('validators.software.daemonDown')
                        : t('validators.software.pull')
                  }
                  onClick={() => void pullImage(row.image, row.tag)}
                >
                  {row.present ? t('validators.software.pulled') : t('validators.software.pull')}
                </Button>
              )}
            />
          </div>
        ) : null}

        {tab === 'about' ? (
          <div className="stack">
            <PageGuide guideId="validators" />
            <ValidatorStakingGuide />
            <DataTable
              title={t('validators.profileHelp.title')}
              description={t('validators.profileHelp.desc')}
              rowKey={(row) => row.id}
              rows={[
                {
                  id: 'minimal',
                  name: t('validators.profile.minimal'),
                  use: t('validators.profileHelp.useMinimal'),
                  disk: t('validators.profileHelp.diskMinimal'),
                  stake: t('validators.profileHelp.stakeNo'),
                },
                {
                  id: 'pruned',
                  name: t('validators.profile.pruned'),
                  use: t('validators.profileHelp.usePruned'),
                  disk: t('validators.profileHelp.diskPruned'),
                  stake: t('validators.profileHelp.stakeNo'),
                },
                {
                  id: 'validator-ready',
                  name: t('validators.profile.validator-ready'),
                  use: t('validators.profileHelp.useValidatorReady'),
                  disk: t('validators.profileHelp.diskValidatorReady'),
                  stake: t('validators.profileHelp.stakeYes'),
                },
                {
                  id: 'rpc',
                  name: t('validators.profile.rpc'),
                  use: t('validators.profileHelp.useRpc'),
                  disk: t('validators.profileHelp.diskRpc'),
                  stake: t('validators.profileHelp.stakeRpc'),
                },
              ]}
              columns={[
                {
                  key: 'name',
                  header: t('validators.profileHelp.colName'),
                  render: (row) => <strong>{row.name}</strong>,
                },
                {
                  key: 'use',
                  header: t('validators.profileHelp.colUse'),
                  render: (row) => row.use,
                },
                {
                  key: 'disk',
                  header: t('validators.profileHelp.colDisk'),
                  render: (row) => row.disk,
                },
                {
                  key: 'stake',
                  header: t('validators.profileHelp.colStake'),
                  render: (row) => row.stake,
                },
              ]}
            />
            <Card>
              <CardSection title="Docker">
                <p>
                  {dockerInstalled
                    ? t('validators.wizard.dockerAboutOk')
                    : t('validators.wizard.dockerAboutMissing')}
                </p>
                <p className="muted u-text-sm u-mt-2">{t('validators.wizard.dockerAbout')}</p>
                <ActionBar className="u-mt-3">
                  <Link
                    to="/docker"
                    className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  >
                    Docker
                  </Link>
                </ActionBar>
              </CardSection>
            </Card>
          </div>
        ) : null}
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
                disabled={
                  (step === 1 && netSpec?.kind === 'mainnet' && !mainnetOk) ||
                  (step >= 1 && !canAdvanceFromDisk) ||
                  (step === 2 && customPath && !isSafeValidatorDataPath(dataPath.trim()))
                }
                title={
                  step >= 1 && !canAdvanceFromDisk
                    ? diskShortTitle
                    : step === 2 && customPath && !isSafeValidatorDataPath(dataPath.trim())
                      ? t('validators.wizard.needCustomPath')
                      : step === 1 && netSpec?.kind === 'mainnet' && !mainnetOk
                        ? t('validators.wizard.mainnetAck')
                        : undefined
                }
                onClick={() => setStep((s) => s + 1)}
              >
                {t('validators.wizard.next')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={busy || !canCreate}
                title={installDisabledTitle}
                data-confirm="dialog"
                onClick={() => setPendingInstall(true)}
              >
                {t('validators.wizard.install')}
              </Button>
            )}
          </>
        }
      >
        <div className="stack val-wizard">
        {ops ? <OpsResultPanel title={t('validators.wizard.install')} result={ops} /> : null}
        {memShort ? (
          <Alert variant="error">
            {t('validators.wizard.memShort')} {memShortTitle}
          </Alert>
        ) : null}
        {step === 0 ? (
          <>
            {loading && chains.length === 0 ? (
              <LoadingBlock label={t('common.loading')} />
            ) : null}
            <SegRadio
              name="chain"
              aria-label={t('validators.wizard.stepChain')}
              value={chain}
              onChange={(v) => {
                setChain(v);
                const c = chains.find((x) => x.id === v);
                setNetwork(c?.networks.find((n) => n.recommended)?.id ?? c?.networks[0]?.id ?? '');
                setMemory(defaultValidatorMemoryLimit(v) ?? '');
              }}
              options={(chains.length ? chains : []).map((c) => {
                const spec = chains.find((x) => x.id === c.id);
                let minNeed = Infinity;
                for (const n of spec?.networks ?? []) {
                  const v = spec?.minFreeBytes?.[n.id]?.minimal;
                  if (typeof v === 'number' && v < minNeed) minNeed = v;
                }
                const diskBit = Number.isFinite(minNeed)
                  ? t('validators.wizard.chainMeta', {
                      disk: formatBytes(minNeed),
                      clients: spec?.clients.length ?? 0,
                    })
                  : '';
                return {
                  value: c.id,
                  label: diskBit
                    ? `${validatorChainLabel(c.id)} · ${diskBit}`
                    : validatorChainLabel(c.id),
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
              onChange={(v) => {
                setNetwork(v);
                setMainnetOk(false);
              }}
              options={(chainSpec?.networks ?? []).map((n) => {
                const d = networkDisplay(n.id, t, chain);
                const name = d.showName && d.name !== d.kindLabel ? d.name : n.id;
                return {
                  value: n.id,
                  label: `${name} · ${d.kindLabel}`,
                };
              })}
            />
            {networkNeedBytes != null ? (
              <Alert
                variant={
                  disk?.availBytes != null && disk.availBytes < networkNeedBytes
                    ? 'error'
                    : 'info'
                }
              >
                {disk?.availBytes != null && disk.availBytes < networkNeedBytes
                  ? `${t('validators.wizard.diskShort')} ${t('validators.wizard.diskShortDetail', {
                      need: formatBytes(networkNeedBytes),
                      free: formatBytes(disk.availBytes),
                      short: formatBytes(Math.max(0, networkNeedBytes - disk.availBytes)),
                    })}`
                  : t('validators.wizard.diskNeedNetwork', {
                      need: formatBytes(networkNeedBytes),
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
                hint: t(`validators.wizard.profileHint.${p}`),
              }))}
            />
            <p className="muted u-text-sm">
              {t(`validators.wizard.profileHint.${profile}`)}{' '}
              <Link to="/validators?tab=about">{t('validators.wizard.profileSeeAbout')}</Link>
            </p>
            {needBytes != null ? (
              <Alert variant={diskShort ? 'error' : 'info'}>
                {diskShort
                  ? `${t('validators.wizard.diskShort')} ${diskShortTitle}`
                  : t('validators.wizard.diskNeed', {
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
                <Field htmlFor="val-el-tag" label={`${t('validators.clients.el')} · ${t('validators.clients.version')}`}>
                  <select
                    id="val-el-tag"
                    value={wizardPickedTag(elTag, versionMap[el])}
                    onChange={(e) => setElTag(e.target.value)}
                  >
                    {(versionMap[el]?.versions ?? [{ gitTag: '', dockerTag: versionMap[el]?.pin || '', prerelease: false, htmlUrl: '' }]).map((v) => (
                      <option key={v.dockerTag} value={v.dockerTag}>
                        {versionOptionLabel(
                          v,
                          versionMap[el]?.pin || v.dockerTag,
                          undefined,
                          officialLatestDockerTag(versionMap[el]),
                          t,
                        )}
                      </option>
                    ))}
                  </select>
                  {versionMap[el]?.github ? (
                    <p className="muted u-text-sm u-mb-0">
                      {t('validators.clients.source')}: {versionMap[el]?.registryHost} · github.com/{versionMap[el]?.github}
                    </p>
                  ) : null}
                </Field>
                <Field htmlFor="val-cl-tag" label={`${t('validators.clients.cl')} · ${t('validators.clients.version')}`}>
                  <select
                    id="val-cl-tag"
                    value={wizardPickedTag(clTag, versionMap[cl])}
                    onChange={(e) => setClTag(e.target.value)}
                  >
                    {(versionMap[cl]?.versions ?? [{ gitTag: '', dockerTag: versionMap[cl]?.pin || '', prerelease: false, htmlUrl: '' }]).map((v) => (
                      <option key={v.dockerTag} value={v.dockerTag}>
                        {versionOptionLabel(
                          v,
                          versionMap[cl]?.pin || v.dockerTag,
                          undefined,
                          officialLatestDockerTag(versionMap[cl]),
                          t,
                        )}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormLayout>
            ) : (
              <Field htmlFor="val-node-tag" label={t('validators.clients.version')}>
                <select
                  id="val-node-tag"
                  value={wizardPickedTag(
                    nodeTag,
                    versionMap[chainSpec?.clients.find((c) => c.role === 'node')?.id ?? ''],
                  )}
                  onChange={(e) => setNodeTag(e.target.value)}
                >
                  {(() => {
                    const nid = chainSpec?.clients.find((c) => c.role === 'node')?.id ?? '';
                    const list = versionMap[nid];
                    const rows = list?.versions ?? [
                      { gitTag: '', dockerTag: list?.pin || '', prerelease: false, htmlUrl: '' },
                    ];
                    const latest = officialLatestDockerTag(list);
                    return rows.filter((v) => v.dockerTag).map((v) => (
                      <option key={v.dockerTag} value={v.dockerTag}>
                        {versionOptionLabel(v, list?.pin || v.dockerTag, undefined, latest, t)}
                      </option>
                    ));
                  })()}
                </select>
                {(() => {
                  const nid = chainSpec?.clients.find((c) => c.role === 'node')?.id ?? '';
                  const list = versionMap[nid];
                  return list?.github ? (
                    <p className="muted u-text-sm u-mb-0">
                      {t('validators.clients.source')}: {list.registryHost} · github.com/{list.github}
                    </p>
                  ) : null;
                })()}
              </Field>
            )}
            {chain === 'ada' ? (
              <div>
                <label className="u-flex u-gap-2 u-items-center">
                  <input
                    type="checkbox"
                    checked={mithril}
                    onChange={(e) => setMithril(e.target.checked)}
                  />
                  <span>{t('validators.mithril.label')}</span>
                </label>
                <p className="muted u-text-sm u-mt-2">{t('validators.mithril.hint')}</p>
              </div>
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
                    { value: '12g', label: '12g' },
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
              <Field
                htmlFor="val-datapath"
                label={t('validators.wizard.dataPath')}
                hint={
                  dataPath.trim() && !isSafeValidatorDataPath(dataPath.trim())
                    ? t('validators.wizard.needCustomPath')
                    : undefined
                }
              >
                <input
                  id="val-datapath"
                  value={dataPath}
                  onChange={(e) => setDataPath(e.target.value)}
                  placeholder="/var/lib/ysk-server/validators/…"
                  required
                />
              </Field>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <>
            {dockerInstalled === false ? (
              <Alert variant="warn">{t('validators.wizard.needDocker')}</Alert>
            ) : null}
            {netSpec?.kind === 'mainnet' ? (
              <>
                <Alert variant="warn">{t('validators.wizard.mainnetWarn')}</Alert>
                <label className="u-flex u-gap-2 u-items-start">
                  <input
                    type="checkbox"
                    checked={mainnetOk}
                    onChange={(e) => setMainnetOk(e.target.checked)}
                  />
                  <span>{t('validators.wizard.mainnetAck')}</span>
                </label>
              </>
            ) : null}
            <StructuredFacts
              items={[
                {
                  label: t('validators.col.chain'),
                  value: validatorChainLabel(chain, chainSpec?.title),
                },
                {
                  label: t('validators.col.network'),
                  value:
                    validatorNetworkLabelFor(chain, network) ??
                    validatorNetworkLabel(network) ??
                    t(`validators.network.${network}`),
                  hint:
                    (validatorNetworkLabelFor(chain, network) ??
                      validatorNetworkLabel(network)) ===
                    t(`validators.networkKind.${netSpec?.kind === 'mainnet' ? 'mainnet' : 'testnet'}`)
                      ? undefined
                      : netSpec?.kind === 'mainnet'
                        ? t('validators.networkKind.mainnet')
                        : t('validators.networkKind.testnet'),
                },
                {
                  label: t('validators.col.profile'),
                  value: profileLabel(profile, t),
                  hint: t(`validators.wizard.profileHint.${profile}`),
                },
                {
                  label: t('validators.wizard.previewId'),
                  value: previewId,
                },
                {
                  label: t('validators.wizard.previewCompose'),
                  value: previewComposeProject(previewId),
                },
                {
                  label: t('validators.wizard.dataPath'),
                  value: resolvedPath || '—',
                },
                {
                  label: t('validators.disk.used'),
                  value:
                    needBytes != null
                      ? t('validators.wizard.diskNeed', {
                          need: formatBytes(needBytes),
                          free: formatBytes(disk?.availBytes),
                        })
                      : '—',
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
              ]}
            />
            {diskShort ? (
              <Alert variant={mainnetOk ? 'warn' : 'error'}>
                {mainnetOk
                  ? t('validators.wizard.lowDiskAcked')
                  : t('validators.wizard.diskShort')}
              </Alert>
            ) : null}
            {profile === 'validator-ready' || netSpec?.kind === 'mainnet' ? (
              <ValidatorPlaybookCard chain={chain} compact />
            ) : null}
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
              {status?.running || isLiveValidatorStatus(status?.status) ? (
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
                  {
                    label: t('validators.detail.traffic'),
                    value: formatTraffic(detail ? summaries[detail.id] : undefined),
                  },
                  { label: t('validators.detail.version'), value: status?.version ?? '—' },
                ]}
              />
              {status?.lastError ? (
                <Alert
                  variant={
                    status.status === 'rpc_wait' ||
                    status.status === 'missing' ||
                    status.status === 'created'
                      ? 'warn'
                      : 'error'
                  }
                >
                  {status.lastError}
                </Alert>
              ) : null}
              {stats.length ? (
                <DescriptionList
                  columns={1}
                  items={stats.map((s) => ({
                    label: String(s.Name ?? s.ID ?? t('validators.col.id')),
                    value: [
                      `CPU ${s.CPUPerc ?? '—'}`,
                      `MEM ${s.MemUsage ?? '—'}`,
                      s.NetIO ? `NET ${s.NetIO}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
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
                  ...(detail.ports.beacon
                    ? [{ role: 'beacon', port: String(detail.ports.beacon), proto: 'tcp' }]
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
              <p className="muted u-text-sm">{t('validators.detail.setVersionHint')}</p>
              {Object.values(detail.clients ?? {}).map((c) => {
                const list = versionMap[c.id];
                return (
                  <Field key={c.id} htmlFor={`val-set-${c.id}`} label={`${c.id} · ${c.tag}`}>
                    <select
                      id={`val-set-${c.id}`}
                      value={pendingVersion?.clientId === c.id ? pendingVersion.tag : c.tag}
                      onChange={(e) => {
                        const tag = e.target.value;
                        if (!tag || tag === c.tag) {
                          setPendingVersion(null);
                          return;
                        }
                        setVersionMainnetOk(false);
                        setPendingVersion({
                          clientId: c.id,
                          tag,
                          ref: `${c.image}:${tag}`,
                        });
                      }}
                    >
                      {(list?.versions?.length
                        ? list.versions
                        : [{ gitTag: c.tag, dockerTag: c.tag, prerelease: false, htmlUrl: '' }]
                      ).map((v) => (
                        <option key={v.dockerTag} value={v.dockerTag}>
                          {versionOptionLabel(
                            v,
                            list?.pin || c.tag,
                            c.tag,
                            officialLatestDockerTag(list),
                            t,
                          )}
                        </option>
                      ))}
                    </select>
                    {list?.github ? (
                      <p className="muted u-text-sm u-mb-0">
                        {t('validators.clients.source')}: {list.registryHost} · github.com/{list.github}
                        {list.changelogUrl ? (
                          <>
                            {' '}
                            ·{' '}
                            <a href={list.changelogUrl} target="_blank" rel="noreferrer">
                              {t('validators.detail.releaseNotes')}
                            </a>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </Field>
                );
              })}
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

            <ValidatorPlaybookCard
              chain={detail.chain}
              variant="instance"
              nodeId={checklist?.nodeId}
              blsPublicKey={checklist?.blsPublicKey}
              blsProofOfPossession={checklist?.blsProofOfPossession}
              near={checklist?.near}
              cosmos={checklist?.cosmos}
              sol={checklist?.sol}
              adaP2pPort={detail.chain === 'ada' ? (detail.ports?.p2p ?? 3001) : undefined}
              p2pPort={detail.ports?.p2p}
              ethBeaconUrl={
                detail.chain === 'eth' && detail.ports?.beacon
                  ? `http://127.0.0.1:${detail.ports.beacon}`
                  : detail.chain === 'eth'
                    ? 'http://127.0.0.1:5052'
                    : undefined
              }
              network={detail.network}
              cardanoProducer={detail.cardanoProducer ?? checklist?.cardanoProducer}
              producerMainnet={
                chains.find((c) => c.id === detail.chain)?.networks.find((n) => n.id === detail.network)
                  ?.kind === 'mainnet'
              }
              onProducerApply={(files) => {
                setProducerMainnetOk(false);
                setPendingProducer(files);
              }}
              onProducerDetach={() => setPendingProducerDetach(true)}
            />
            {checklist?.snapshot?.notes?.length ? (
              <Alert variant="info">{checklist.snapshot.notes.join(' ')}</Alert>
            ) : null}

            <CardSection title={t('validators.detail.compose')}>
              <Field htmlFor="val-compose" label={t('validators.compose.label')}>
                <CodeEditor
                  id="val-compose"
                  value={composeText}
                  filename="compose.yml"
                  ariaLabel={t('validators.compose.label')}
                  onChange={setComposeText}
                  onSave={() =>
                    void runAction(() => validatorsApi.saveCompose(detail.id, composeText))
                  }
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
                <Button onClick={() => setPendingRewrite(true)}>
                  {t('validators.wizard.rewriteCompose')}
                </Button>
              </ActionBar>
            </CardSection>

            <CardSection title={t('validators.detail.logs')}>
              <LogViewer
                lines={logs}
                emptyLabel={t('validators.logs.empty')}
                follow={followLogs}
                onFollowChange={setFollowLogs}
                downloadName={`${detail.id}.log`}
                maxHeight="min(52vh, 28rem)"
              />
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
        confirmText={netSpec?.kind === 'mainnet' || memShort ? previewId : undefined}
        severity={netSpec?.kind === 'mainnet' || memShort ? 'critical' : 'destructive'}
        dataConfirm="install"
        busy={busy}
        consequences={[
          t('validators.wizard.installC1'),
          t('validators.wizard.installC2'),
          ...(netSpec?.kind === 'mainnet' ? [t('validators.wizard.installC3')] : []),
          ...(diskShort ? [t('validators.wizard.lowDiskAcked')] : []),
          ...(memShort ? [t('validators.wizard.lowMemAcked')] : []),
          ...(dockerInstalled === false ? [t('validators.wizard.needDocker')] : []),
        ]}
        onConfirm={() => {
          setPendingInstall(false);
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
        consequences={[
          t('validators.disk.autoClearC1'),
          t('validators.disk.autoClearThreshold', { n: VALIDATOR_DISK_DANGER_PCT }),
          autoClearCandidates.length
            ? t('validators.disk.autoClearCandidates', {
                list: autoClearCandidates
                  .map((c) => `${c.id} (${formatBytes(c.usedBytes)})`)
                  .join(' · '),
              })
            : t('validators.disk.autoClearNone'),
        ]}
        onConfirm={() => {
          setPendingAutoClear(false);
          setAutoClear(true);
          void validatorsApi.saveSettings(true);
        }}
      />
      <ConfirmDialog
        open={Boolean(leftoverTarget)}
        onClose={() => setLeftoverTarget(null)}
        title={t('validators.disk.leftoverRemoveTitle')}
        description={t('validators.disk.leftoverRemoveDesc', {
          path: leftoverTarget?.path ?? '',
        })}
        confirmText={leftoverTarget?.name ?? 'DELETE'}
        confirmLabel={t('validators.disk.leftoverRemove')}
        severity="critical"
        danger
        busy={busy}
        onConfirm={() => {
          const row = leftoverTarget;
          if (!row) return;
          setBusy(true);
          void validatorsApi
            .removeLeftover(row.path, row.name)
            .then((r) => {
              setOps(toOps(r));
              setLeftoverTarget(null);
              return load();
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      />
      <ConfirmDialog
        open={pendingRewrite}
        onClose={() => setPendingRewrite(false)}
        title={t('validators.wizard.rewriteComposeTitle')}
        description={t('validators.wizard.rewriteComposeDesc', { id: detail?.id ?? '' })}
        confirmLabel={t('validators.wizard.rewriteCompose')}
        danger
        busy={busy}
        onConfirm={() => {
          if (!detail) return;
          setPendingRewrite(false);
          void runAction(() => validatorsApi.rewriteCompose(detail.id)).then(() => {
            if (detail) void openDetail(detail);
          });
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingVersion && detail)}
        onClose={() => setPendingVersion(null)}
        title={t('validators.detail.setVersionConfirmTitle', {
          id: detail?.id ?? '',
          tag: pendingVersion?.tag ?? '',
        })}
        description={t('validators.detail.setVersionConfirmDesc', { ref: pendingVersion?.ref ?? '' })}
        confirmText={detail?.id}
        confirmLabel={t('validators.actions.setVersion')}
        dataConfirm={detail?.id}
        consequences={[t('validators.detail.setVersionC1'), t('validators.detail.setVersionC2')]}
        busy={busy}
        onConfirm={() => {
          if (!detail || !pendingVersion) return;
          const isMainnet =
            chains.find((c) => c.id === detail.chain)?.networks.find((n) => n.id === detail.network)
              ?.kind === 'mainnet';
          if (isMainnet && !versionMainnetOk) return;
          const req = pendingVersion;
          const body = {
            clientId: req.clientId,
            tag: req.tag,
            confirm: detail.id,
            acceptMainnet: isMainnet,
            execute: true,
          };
          setPendingVersion(null);
          void runAction(
            () => validatorsApi.setVersion(detail.id, body),
            t('validators.actions.setVersion'),
            { id: detail.id, action: 'set-version', body },
          ).then(() => {
            void openDetail(detail);
          });
        }}
      >
        {chains.find((c) => c.id === detail?.chain)?.networks.find((n) => n.id === detail?.network)
          ?.kind === 'mainnet' ? (
          <label className="u-flex u-gap-2 u-items-center">
            <input
              type="checkbox"
              checked={versionMainnetOk}
              onChange={(e) => setVersionMainnetOk(e.target.checked)}
            />
            <span>{t('validators.detail.setVersionMainnet')}</span>
          </label>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingProducer && detail)}
        onClose={() => setPendingProducer(null)}
        title={t('validators.producer.applyTitle', { id: detail?.id ?? '' })}
        description={t('validators.producer.applyDesc')}
        confirmText={detail?.id}
        confirmLabel={t('validators.producer.apply')}
        severity="critical"
        busy={busy}
        consequences={[
          t('validators.producer.applyC1'),
          t('validators.producer.applyC2'),
          ...(chains.find((c) => c.id === detail?.chain)?.networks.find((n) => n.id === detail?.network)
            ?.kind === 'mainnet'
            ? [t('validators.producer.applyC3')]
            : []),
        ]}
        onConfirm={() => {
          if (!detail || !pendingProducer) return;
          const isMainnet =
            chains.find((c) => c.id === detail.chain)?.networks.find((n) => n.id === detail.network)
              ?.kind === 'mainnet';
          if (isMainnet && !producerMainnetOk) return;
          const files = pendingProducer;
          const body = {
            ...files,
            confirm: detail.id,
            acceptMainnet: isMainnet,
            execute: true,
          };
          setPendingProducer(null);
          void runAction(
            () => validatorsApi.attachProducerKeys(detail.id, body),
            t('validators.producer.apply'),
            { id: detail.id, action: 'producer-keys', body },
          ).then(() => {
            void openDetail(detail);
          });
        }}
      >
        {chains.find((c) => c.id === detail?.chain)?.networks.find((n) => n.id === detail?.network)
          ?.kind === 'mainnet' ? (
          <label className="u-flex u-gap-2 u-items-center">
            <input
              type="checkbox"
              checked={producerMainnetOk}
              onChange={(e) => setProducerMainnetOk(e.target.checked)}
            />
            <span>{t('validators.producer.mainnet')}</span>
          </label>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingProducerDetach && Boolean(detail)}
        onClose={() => setPendingProducerDetach(false)}
        title={t('validators.producer.detachTitle', { id: detail?.id ?? '' })}
        description={t('validators.producer.detachDesc')}
        confirmText={detail?.id}
        confirmLabel={t('validators.producer.detach')}
        severity="critical"
        busy={busy}
        consequences={[t('validators.producer.detachC1')]}
        onConfirm={() => {
          if (!detail) return;
          setPendingProducerDetach(false);
          void runAction(
            () => validatorsApi.detachProducerKeys(detail.id, detail.id),
            t('validators.producer.detach'),
            {
              id: detail.id,
              action: 'producer-keys/detach',
              body: { confirm: detail.id, execute: true },
            },
          ).then(() => {
            void openDetail(detail);
          });
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
