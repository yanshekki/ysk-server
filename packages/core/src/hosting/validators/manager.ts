/**
 * Validator instance orchestrator: create / start / stop / restart / clear.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  defaultValidatorMemoryLimit,
  parseValidatorMemoryBytes,
  VALIDATOR_MEMORY_HEADROOM_BYTES,
  isSafeValidatorDataPath,
  isSafeValidatorLimitCpus,
  isSafeValidatorLimitMemory,
  isValidatorChainId,
  isValidatorInstanceId,
  isValidatorProfileId,
  isValidatorUpgradePolicy,
  tl,
  type ValidatorChainId,
  type ValidatorInstanceDto,
  type ValidatorProfileId,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { collectValidatorDisk } from './disk.js';
import {
  appliedValidatorOp,
  blockedValidatorOp,
  failedValidatorOp,
  writtenValidatorOp,
  type ValidatorOpsResult,
} from './honesty.js';
import {
  composeDown,
  composeFilePath,
  composeLogs,
  composeProjectName,
  composePsInfo,
  composePsRunning,
  composeStayWaits,
  composeUp,
  prepareValidatorDataDir,
  probeDockerCompose,
  writeComposeFile,
} from './compose-runner.js';

import {
  getValidatorChain,
  getValidatorNetwork,
  minFreeBytesFor,
  resolveValidatorClients,
  SUI_NODE_IMAGE,
  suiNodeTag,
} from './registry.js';
import {
  buildValidatorInstance,
  deleteValidatorInstance,
  getValidatorInstance,
  instanceDir,
  upsertValidatorInstance,
} from './store.js';
import { planInstallFor } from './adapters/index.js';
import { probeEthStatus } from './adapters/eth.js';
import { ensureAvaxChainConfig, probeAvaxStatus } from './adapters/avax.js';
import { probeNearStatus } from './adapters/near.js';
import { probeAdaStatus } from './adapters/ada.js';
import {
  ensureAptosFullnodeFiles,
  ensureCosmosNodeFiles,
  ensureSuiFullnodeFiles,
  probeAptosStatus,
  probeBtcStatus,
  probeCosmosStatus,
  probeDotStatus,
  probeSolStatus,
  probeSuiStatus,
} from './adapters/phase2.js';
import { allocateValidatorPorts, parseSsListenPortSet, usedValidatorPorts } from './ports.js';
import { syncServiceExposure } from '../service-exposure/sync.js';
import type { ValidatorNodeStatus } from './adapters/base.js';
import { applyValidatorClientTag, applyValidatorUpgrade, detectUpgradeForInstance } from './upgrade.js';
import { isAllowedClientTag } from './software-catalog.js';
import {
  deriveValidatorRuntimeStatus,
  isValidatorNofileHint,
  isValidatorOomHint,
  pickValidatorContainerHint,
} from './runtime-status.js';
import type { OpsLogFn } from '../ops-log.js';

/** State-sync for pruned/minimal/validator-ready. Full rpc keeps the full state. */
export function specProfileStateSync(profile: string): boolean {
  return profile !== 'rpc';
}

function applyRequestedClientTags(
  clients: ValidatorInstanceDto['clients'],
  input: {
    dataDir: string;
    network: string;
    elTag?: string;
    clTag?: string;
    nodeTag?: string;
  },
): string | null {
  const jobs: Array<{ key: string; tag?: string }> = [
    { key: 'el', tag: input.elTag },
    { key: 'cl', tag: input.clTag },
    { key: 'node', tag: input.nodeTag },
  ];
  for (const job of jobs) {
    const tag = job.tag?.trim();
    if (!tag) continue;
    const cur = clients[job.key];
    if (!cur) return job.key;
    if (
      !isAllowedClientTag({
        clientId: cur.id,
        tag,
        dataDir: input.dataDir,
        extraTags: [cur.tag],
        network: input.network,
      })
    ) {
      return `${cur.id}:${tag}`;
    }
    clients[job.key] = { ...cur, tag };
  }
  return null;
}

export type ValidatorMutateOpts = {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
};

export async function createValidatorInstance(
  input: ValidatorMutateOpts & {
    chain: string;
    network: string;
    profile: string;
    slug?: string;
    el?: string;
    cl?: string;
    elTag?: string;
    clTag?: string;
    nodeTag?: string;
    mithril?: boolean;
    dataPath?: string;
    memory?: string;
    cpus?: string;
    rpcPort?: number;
    acceptLowDisk?: boolean;
    acceptLowMem?: boolean;
  },
): Promise<ValidatorOpsResult> {
  if (!isValidatorChainId(input.chain)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }
  if (!isValidatorProfileId(input.profile)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }
  const chain = input.chain as ValidatorChainId;
  const profile = input.profile as ValidatorProfileId;
  const net = getValidatorNetwork(chain, input.network);
  if (!net || !getValidatorChain(chain)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }

  const disk = await collectValidatorDisk({ dataDir: input.dataDir, host: input.host });
  const need = minFreeBytesFor(chain, input.network, profile);
  const lowDisk =
    Boolean(need && disk.availBytes != null && disk.availBytes < need);
  if (lowDisk && !(net.kind === 'mainnet' && input.acceptLowDisk)) {
    return blockedValidatorOp({
      reason: 'validation',
      notes: [
        tl('validators.errors.diskLow'),
        `need>=${need}`,
        `avail=${disk.availBytes}`,
      ],
    });
  }
  if (net.kind === 'mainnet' && disk.availBytes == null) {
    return blockedValidatorOp({
      reason: 'validation',
      notes: [tl('validators.errors.diskUnknownMainnet')],
    });
  }

  const customPath = input.dataPath?.trim();
  if (customPath && !isSafeValidatorDataPath(customPath)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.badDataPath')] });
  }
  if (input.memory && !isSafeValidatorLimitMemory(input.memory)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }
  if (input.cpus && !isSafeValidatorLimitCpus(input.cpus)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }
  const memory = input.memory || defaultValidatorMemoryLimit(chain);
  const memNeed = parseValidatorMemoryBytes(memory);
  const lowMem = Boolean(
    memNeed &&
      disk.memAvailableBytes != null &&
      disk.memAvailableBytes < memNeed + VALIDATOR_MEMORY_HEADROOM_BYTES,
  );
  if (lowMem && !input.acceptLowMem) {
    return blockedValidatorOp({
      reason: 'validation',
      notes: [
        tl('validators.errors.memLow'),
        `need>=${memNeed}`,
        `avail=${disk.memAvailableBytes}`,
      ],
    });
  }

  const clients: ValidatorInstanceDto['clients'] = resolveValidatorClients(chain, {
    el: input.el,
    cl: input.cl,
  });
  if (chain === 'sui' && clients.node) {
    clients.node = { ...clients.node, image: SUI_NODE_IMAGE, tag: suiNodeTag(input.network) };
  }
  const tagErr = applyRequestedClientTags(clients, {
    dataDir: input.dataDir,
    network: input.network,
    elTag: input.elTag,
    clTag: input.clTag,
    nodeTag: input.nodeTag,
  });
  if (tagErr) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.badTag'), tagErr] });
  }
  const extraUsed = new Set<number>();
  try {
    const ss = await input.host.runCommand(['ss', '-lnt'], { timeoutMs: 3_000 });
    if (ss.exitCode === 0) {
      for (const p of parseSsListenPortSet(ss.stdout)) extraUsed.add(p);
    }
  } catch {
    /* ss unavailable — still skip other validator ports */
  }
  const ports = allocateValidatorPorts(input.dataDir, chain, extraUsed);
  if (input.rpcPort != null && Number.isFinite(input.rpcPort)) {
    const n = Number(input.rpcPort);
    if (!Number.isInteger(n) || n <= 1024 || n > 65535) {
      return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
    }
    if (usedValidatorPorts(input.dataDir).has(n) || extraUsed.has(n)) {
      return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.portInUse')] });
    }
    ports.rpc = n;
  }
  const limits =
    memory || input.cpus
      ? { memory, cpus: input.cpus }
      : undefined;
  let inst: ValidatorInstanceDto;
  try {
    inst = buildValidatorInstance({
      dataDir: input.dataDir,
      chain,
      network: input.network,
      profile,
      slug: input.slug,
      clients,
      ports,
      dataPath: input.dataPath,
      limits,
    });
  } catch {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }

  const dir = instanceDir(input.dataDir, inst.id);
  mkdirSync(dir, { recursive: true });
  prepareValidatorDataDir(inst.dataPath);
  const plan = planInstallFor(inst);
  if (plan.jwtPath) {
    writeFileSync(plan.jwtPath, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    try {
      chmodSync(plan.jwtPath, 0o600);
    } catch {
      /* best-effort */
    }
  }
  const composePath = composeFilePath(dir);
  if (inst.chain === 'sui') {
    const sui = await ensureSuiFullnodeFiles(inst.dataPath, inst.network);
    if (!sui.ok && input.execute) {
      return failedValidatorOp({
        instanceId: inst.id,
        written: [inst.dataPath],
        notes: [tl('validators.errors.composeFailed'), ...sui.notes],
      });
    }
  }
  if (inst.chain === 'aptos') {
    await ensureAptosFullnodeFiles(inst.dataPath, inst.network);
  }
  if (inst.chain === 'cosmos') {
    const cosmos = await ensureCosmosNodeFiles(inst.dataPath, inst.network);
    if (!cosmos.ok && input.execute) {
      return failedValidatorOp({
        instanceId: inst.id,
        written: [inst.dataPath],
        notes: [tl('validators.errors.composeFailed'), ...cosmos.notes],
      });
    }
  }
  if (inst.chain === 'avax') {
    ensureAvaxChainConfig(inst.dataPath, specProfileStateSync(inst.profile));
  }
  writeComposeFile(composePath, plan.composeYaml, inst.id, inst.limits);
  upsertValidatorInstance(input.dataDir, inst);
  const written = [join(dir, '..', 'instances.json'), composePath, inst.dataPath];

  const diskAckNotes =
    lowDisk && input.acceptLowDisk ? [tl('validators.wizard.lowDiskAcked')] : [];
  const memAckNotes =
    lowMem && input.acceptLowMem ? [tl('validators.wizard.lowMemAcked')] : [];

  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written,
      notes: [
        ...diskAckNotes,
        ...memAckNotes,
        tl('validators.notes.dryCreate'),
        tl('validators.notes.beta'),
      ],
    });
  }

  const docker = await probeDockerCompose(input.host);
  if (!docker.ok) {
    return blockedValidatorOp({
      reason: 'missing_binary',
      instanceId: inst.id,
      written,
      notes: [tl('validators.errors.needDocker'), ...docker.notes],
    });
  }

  const up = await composeUp({
    host: input.host,
    file: composePath,
    project: composeProjectName(inst.id),
    execute: true,
    onLog: input.onLog,
    signal: input.signal,
  });
  if (!up.ok) {
    const detail = (up.stderr || up.stdout).trim().slice(0, 400);
    upsertValidatorInstance(input.dataDir, {
      ...inst,
      lastStatus: {
        at: new Date().toISOString(),
        status: 'error',
        running: false,
        syncProgress: null,
        peers: null,
        diskUsedBytes: null,
        lastError: detail || tl('validators.errors.composeFailed'),
      },
    });
    return failedValidatorOp({
      instanceId: inst.id,
      written,
      notes: [tl('validators.errors.composeFailed'), detail].filter(Boolean),
    });
  }
  const live = await verifyComposeStayedUp({
    host: input.host,
    file: composePath,
    project: composeProjectName(inst.id),
    waits: composeStayWaits(inst.chain),
  });
  if (!live.ok) {
    return failedValidatorOp({
      instanceId: inst.id,
      written,
      notes: [tl('validators.errors.containerNotUp'), live.hint ?? ''].filter(Boolean),
    });
  }
  upsertValidatorInstance(input.dataDir, { ...inst, desiredState: 'running' });
  await maybeSyncExposure(input, inst, 'start');
  const notes = [...diskAckNotes, ...memAckNotes, tl('validators.notes.created')];
  if (input.mithril && inst.chain === 'ada') {
    const { restoreAdaMithril } = await import('./mithril.js');
    const m = await restoreAdaMithril({
      dataDir: input.dataDir,
      host: input.host,
      execute: true,
      id: inst.id,
      confirm: inst.id,
      onLog: input.onLog,
      signal: input.signal,
    });
    notes.push(...(m.notes ?? []));
    if (!m.ok || m.apply_status === 'failed' || m.blocked) {
      return failedValidatorOp({
        instanceId: inst.id,
        written,
        notes,
      });
    }
  }
  return appliedValidatorOp({
    instanceId: inst.id,
    written,
    notes,
  });
}

async function verifyComposeStayedUp(input: {
  host: HostExecutor;
  file: string;
  project: string;
  waits?: number[];
}): Promise<{ ok: boolean; hint: string | null }> {
  const waits = input.waits ?? [2_000, 3_000, 5_000];
  for (const ms of waits) {
    await new Promise((r) => setTimeout(r, ms));
    const ps = await composePsInfo(input);
    if (ps.running && !ps.restarting && !ps.exited) return { ok: true, hint: null };
    if (ps.exited && !ps.running) break;
  }
  const logs = await composeLogs({ ...input, tail: 80 });
  const hint = pickValidatorContainerHint(logs.lines);
  return { ok: false, hint };
}

async function withInstance(
  input: ValidatorMutateOpts & { id: string },
  fn: (inst: ValidatorInstanceDto, composePath: string) => Promise<ValidatorOpsResult>,
): Promise<ValidatorOpsResult> {
  if (!isValidatorInstanceId(input.id)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  }
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  }
  const composePath = composeFilePath(instanceDir(input.dataDir, inst.id));
  return fn(inst, composePath);
}

export async function startValidatorInstance(
  input: ValidatorMutateOpts & { id: string },
): Promise<ValidatorOpsResult> {
  return withInstance(input, async (inst, composePath) => {
    if (!input.execute || !input.host.executeEnabled()) {
      return blockedValidatorOp({
        reason: 'no_execute',
        instanceId: inst.id,
        notes: [tl('validators.notes.dryStart')],
      });
    }
    const docker = await probeDockerCompose(input.host);
    if (!docker.ok) {
      return blockedValidatorOp({
        reason: 'missing_binary',
        instanceId: inst.id,
        notes: [tl('validators.errors.needDocker'), ...docker.notes],
      });
    }
    const plan = planInstallFor(inst);
    if (inst.chain === 'sui') await ensureSuiFullnodeFiles(inst.dataPath, inst.network);
    if (inst.chain === 'aptos') await ensureAptosFullnodeFiles(inst.dataPath, inst.network);
    if (inst.chain === 'cosmos') {
      const cosmos = await ensureCosmosNodeFiles(inst.dataPath, inst.network);
      if (!cosmos.ok) {
        return failedValidatorOp({
          instanceId: inst.id,
          notes: [tl('validators.errors.composeFailed'), ...cosmos.notes],
        });
      }
    }
    if (inst.chain === 'avax') ensureAvaxChainConfig(inst.dataPath, specProfileStateSync(inst.profile));
    const limits = inst.limits?.memory
      ? inst.limits
      : { ...inst.limits, memory: defaultValidatorMemoryLimit(inst.chain) };
    writeComposeFile(composePath, plan.composeYaml, inst.id, limits);
    prepareValidatorDataDir(inst.dataPath);
    const up = await composeUp({
      host: input.host,
      file: composePath,
      project: composeProjectName(inst.id),
      execute: true,
      onLog: input.onLog,
      signal: input.signal,
    });
    if (!up.ok) {
      return failedValidatorOp({
        instanceId: inst.id,
        notes: [tl('validators.errors.composeFailed'), up.stderr || up.stdout],
      });
    }
    const live = await verifyComposeStayedUp({
      host: input.host,
      file: composePath,
      project: composeProjectName(inst.id),
      waits: composeStayWaits(inst.chain),
    });
    if (!live.ok) {
      return failedValidatorOp({
        instanceId: inst.id,
        notes: [tl('validators.errors.containerNotUp'), live.hint ?? ''].filter(Boolean),
      });
    }
    upsertValidatorInstance(input.dataDir, { ...inst, desiredState: 'running' });
    await maybeSyncExposure(input, inst, 'start');
    return appliedValidatorOp({ instanceId: inst.id, notes: [tl('validators.notes.started')] });
  });
}

export async function stopValidatorInstance(
  input: ValidatorMutateOpts & { id: string },
): Promise<ValidatorOpsResult> {
  return withInstance(input, async (inst, composePath) => {
    if (!input.execute || !input.host.executeEnabled()) {
      return blockedValidatorOp({
        reason: 'no_execute',
        instanceId: inst.id,
        notes: [tl('validators.notes.dryStop')],
      });
    }
    const down = await composeDown({
      host: input.host,
      file: composePath,
      project: composeProjectName(inst.id),
      execute: true,
      onLog: input.onLog,
      signal: input.signal,
    });
    if (!down.ok) {
      return failedValidatorOp({
        instanceId: inst.id,
        notes: [tl('validators.errors.composeFailed'), down.stderr || down.stdout],
      });
    }
    upsertValidatorInstance(input.dataDir, { ...inst, desiredState: 'stopped' });
    await maybeSyncExposure(input, inst, 'stop');
    return appliedValidatorOp({ instanceId: inst.id, notes: [tl('validators.notes.stopped')] });
  });
}

export async function restartValidatorInstance(
  input: ValidatorMutateOpts & { id: string },
): Promise<ValidatorOpsResult> {
  const stopped = await stopValidatorInstance(input);
  if (!stopped.ok) return stopped;
  return startValidatorInstance(input);
}

export function isClearConfirm(id: string, confirm: string | undefined): boolean {
  const c = String(confirm ?? '').trim();
  return c === id || c.toUpperCase() === 'CLEAR';
}

export async function clearValidatorInstance(
  input: ValidatorMutateOpts & {
    id: string;
    confirm?: string;
    removeUnit?: boolean;
    restoreSnapshot?: boolean;
  },
): Promise<ValidatorOpsResult> {
  return withInstance(input, async (inst, composePath) => {
    if (!isClearConfirm(inst.id, input.confirm)) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.needConfirm')],
      });
    }
    if (!input.execute || !input.host.executeEnabled()) {
      return blockedValidatorOp({
        reason: 'no_execute',
        instanceId: inst.id,
        notes: [input.removeUnit ? tl('validators.notes.dryDelete') : tl('validators.notes.dryClear')],
      });
    }
    await composeDown({
      host: input.host,
      file: composePath,
      project: composeProjectName(inst.id),
      execute: true,
    });
    try {
      rmSync(inst.dataPath, { recursive: true, force: true });
    } catch {
      /* continue */
    }
    if (input.restoreSnapshot && inst.chain === 'ada') {
      const { restoreAdaMithril } = await import('./mithril.js');
      await restoreAdaMithril({
        dataDir: input.dataDir,
        host: input.host,
        execute: true,
        id: inst.id,
        confirm: inst.id,
      });
    }
    if (input.removeUnit) {
      deleteValidatorInstance(input.dataDir, inst.id);
      try {
        rmSync(instanceDir(input.dataDir, inst.id), { recursive: true, force: true });
      } catch {
        /* continue */
      }
      return appliedValidatorOp({ instanceId: inst.id, notes: [tl('validators.notes.deleted')] });
    }
    mkdirSync(inst.dataPath, { recursive: true });
    upsertValidatorInstance(input.dataDir, { ...inst, desiredState: 'stopped' });
    return appliedValidatorOp({ instanceId: inst.id, notes: [tl('validators.notes.cleared')] });
  });
}

export async function removeValidatorInstance(
  input: ValidatorMutateOpts & { id: string; confirm?: string },
): Promise<ValidatorOpsResult> {
  return clearValidatorInstance({ ...input, removeUnit: true, restoreSnapshot: false });
}

async function maybeSyncExposure(
  input: ValidatorMutateOpts,
  inst: ValidatorInstanceDto,
  reason: 'start' | 'stop',
): Promise<void> {
  const p2p = inst.ports.p2p;
  if (!p2p) return;
  try {
    await syncServiceExposure({
      host: input.host,
      dataDir: input.dataDir,
      serviceId: `val-${inst.id}`.slice(0, 48),
      ports: [{ role: 'p2p', port: String(p2p), proto: 'tcp' }],
      reason,
      requireDecision: false,
    });
  } catch {
    /* non-fatal */
  }
}

export async function statusValidatorInstance(input: {
  dataDir: string;
  host: HostExecutor;
  id: string;
}): Promise<ValidatorNodeStatus & { instance?: ValidatorInstanceDto; upgrade?: ReturnType<typeof detectUpgradeForInstance> }> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) {
    return {
      status: 'unknown',
      running: false,
      syncProgress: null,
      peers: null,
      version: null,
      diskUsedBytes: null,
      lastError: tl('validators.errors.notFound'),
      notes: [],
    };
  }
  const ps = await composePsInfo({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, inst.id)),
    project: composeProjectName(inst.id),
  });
  const running = ps.running;
  let extra: Pick<ValidatorNodeStatus, 'syncProgress' | 'peers' | 'version' | 'lastError'> = {
    syncProgress: null,
    peers: null,
    version: null,
    lastError: null,
  };
  if (running && inst.chain === 'eth') extra = await probeEthStatus(inst);
  else if (running && inst.chain === 'avax') extra = await probeAvaxStatus(inst);
  else if (running && inst.chain === 'near') extra = await probeNearStatus(inst);
  else if (running && inst.chain === 'ada') extra = await probeAdaStatus(inst);
  else if (running && inst.chain === 'btc') extra = await probeBtcStatus(inst);
  else if (running && inst.chain === 'cosmos') extra = await probeCosmosStatus(inst);
  else if (running && inst.chain === 'sui') extra = await probeSuiStatus(inst);
  else if (running && inst.chain === 'aptos') extra = await probeAptosStatus(inst);
  else if (running && inst.chain === 'dot') extra = await probeDotStatus(inst);
  else if (running && inst.chain === 'sol') extra = await probeSolStatus(inst);
  const status = deriveValidatorRuntimeStatus({
    running,
    restarting: ps.restarting,
    created: ps.created,
    missing: ps.missing,
    syncProgress: extra.syncProgress,
    lastError: extra.lastError,
  });
  let lastError = extra.lastError;
  if (status === 'rpc_wait') {
    lastError = tl('validators.errors.probeFailed');
  } else if (ps.missing) {
    lastError = tl('validators.errors.noContainer');
  } else if (!running || ps.restarting) {
    const logs = await composeLogs({
      host: input.host,
      file: composeFilePath(instanceDir(input.dataDir, inst.id)),
      project: composeProjectName(inst.id),
      tail: 80,
    });
    const hint = pickValidatorContainerHint(logs.lines);
    if (ps.exitCode === 137 || (hint && isValidatorOomHint(hint))) {
      lastError = tl('validators.errors.oom');
    } else if (hint && isValidatorNofileHint(hint)) {
      lastError = tl('validators.errors.nofile');
    } else if (hint) lastError = hint;
    else if (ps.restarting) {
      lastError =
        ps.restartCount != null
          ? tl('validators.errors.restartingCount', { n: ps.restartCount })
          : tl('validators.errors.restarting');
    }
  }
  return {
    status,
    running,
    diskUsedBytes: null,
    notes: [],
    instance: inst,
    // List / status: only when this instance is behind the shipped pin.
    // Remote GitHub tags must not paint a brand-new node as "upgrade".
    upgrade: detectUpgradeForInstance(inst),
    ...extra,
    lastError,
  };
}

export async function logsValidatorInstance(input: {
  dataDir: string;
  host: HostExecutor;
  id: string;
  tail?: number;
}): Promise<{ lines: string[]; notes: string[] }> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return { lines: [], notes: [tl('validators.errors.notFound')] };
  return composeLogs({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, inst.id)),
    project: composeProjectName(inst.id),
    tail: input.tail,
  });
}

export function setValidatorPolicy(
  dataDir: string,
  id: string,
  policy: string,
): { ok: boolean; instance?: ValidatorInstanceDto; notes: string[] } {
  if (!isValidatorUpgradePolicy(policy)) {
    return { ok: false, notes: [tl('validators.errors.invalidId')] };
  }
  const inst = getValidatorInstance(dataDir, id);
  if (!inst) return { ok: false, notes: [tl('validators.errors.notFound')] };
  const next = upsertValidatorInstance(dataDir, { ...inst, upgradePolicy: policy });
  return { ok: true, instance: next, notes: [] };
}

export async function setValidatorClientVersion(
  input: ValidatorMutateOpts & {
    id: string;
    clientId: string;
    tag: string;
    confirm: string;
    acceptMainnet?: boolean;
  },
): Promise<ValidatorOpsResult> {
  return withInstance(input, async (inst) => {
    const tag = String(input.tag ?? '').trim();
    const clientId = String(input.clientId ?? '').trim();
    if (!clientId || !tag) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.badTag')],
      });
    }
    const have = Object.values(inst.clients).find((c) => c.id === clientId);
    if (!have) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.badTag')],
      });
    }
    if (input.confirm !== inst.id) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.needVersionConfirm')],
      });
    }
    const kind = getValidatorNetwork(inst.chain, inst.network)?.kind;
    if (kind === 'mainnet' && !input.acceptMainnet) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.needMainnetVersionAck')],
      });
    }
    if (
      !isAllowedClientTag({
        clientId,
        tag,
        dataDir: input.dataDir,
        extraTags: [have.tag],
        network: inst.network,
      })
    ) {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.badTag')],
      });
    }
    if (!input.execute || !input.host.executeEnabled()) {
      const dry = await applyValidatorClientTag({
        dataDir: input.dataDir,
        host: input.host,
        spec: inst,
        clientId,
        nextTag: tag,
        execute: false,
      });
      return writtenValidatorOp({
        instanceId: inst.id,
        written: [],
        notes: dry.notes,
      });
    }
    const r = await applyValidatorClientTag({
      dataDir: input.dataDir,
      host: input.host,
      spec: inst,
      clientId,
      nextTag: tag,
      execute: true,
      onLog: input.onLog,
      signal: input.signal,
    });
    if (!r.ok) return failedValidatorOp({ instanceId: inst.id, notes: r.notes });
    return appliedValidatorOp({ instanceId: inst.id, notes: r.notes });
  });
}

export async function upgradeValidatorInstance(
  input: ValidatorMutateOpts & { id: string },
): Promise<ValidatorOpsResult> {
  return withInstance(input, async (inst) => {
    if (!input.execute || !input.host.executeEnabled()) {
      const dry = await applyValidatorUpgrade({
        dataDir: input.dataDir,
        host: input.host,
        spec: inst,
        execute: false,
      });
      return writtenValidatorOp({
        instanceId: inst.id,
        written: [],
        notes: dry.notes,
      });
    }
    const r = await applyValidatorUpgrade({
      dataDir: input.dataDir,
      host: input.host,
      spec: inst,
      execute: true,
      onLog: input.onLog,
      signal: input.signal,
    });
    if (!r.ok) return failedValidatorOp({ instanceId: inst.id, notes: r.notes });
    return appliedValidatorOp({ instanceId: inst.id, notes: r.notes });
  });
}

export async function validatorInstanceRunning(
  input: { dataDir: string; host: HostExecutor; id: string },
): Promise<boolean> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return false;
  return composePsRunning({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, inst.id)),
    project: composeProjectName(inst.id),
  });
}
