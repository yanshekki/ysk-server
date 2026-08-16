/**
 * Validator instance orchestrator: create / start / stop / restart / clear.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
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
  composePsRunning,
  composeUp,
  probeDockerCompose,
  writeComposeFile,
} from './compose-runner.js';
import {
  getValidatorChain,
  getValidatorNetwork,
  minFreeBytesFor,
  resolveValidatorClients,
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
import { probeAvaxStatus } from './adapters/avax.js';
import { probeNearStatus } from './adapters/near.js';
import { probeAdaStatus } from './adapters/ada.js';
import {
  probeAptosStatus,
  probeBtcStatus,
  probeCosmosStatus,
  probeDotStatus,
  probeSolStatus,
  probeSuiStatus,
} from './adapters/phase2.js';
import { allocateValidatorPorts, usedValidatorPorts } from './ports.js';
import { syncServiceExposure } from '../service-exposure/sync.js';
import type { ValidatorNodeStatus } from './adapters/base.js';
import { applyValidatorUpgrade, detectUpgradeForInstance } from './upgrade.js';
import { loadRemoteClientTags } from './releases.js';
import type { OpsLogFn } from '../ops-log.js';

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
    mithril?: boolean;
    dataPath?: string;
    memory?: string;
    cpus?: string;
    rpcPort?: number;
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
  if (need && disk.availBytes != null && disk.availBytes < need) {
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

  const clients: ValidatorInstanceDto['clients'] = resolveValidatorClients(chain, {
    el: input.el,
    cl: input.cl,
  });
  const ports = allocateValidatorPorts(input.dataDir, chain);
  if (input.rpcPort != null && Number.isFinite(input.rpcPort)) {
    const n = Number(input.rpcPort);
    if (!Number.isInteger(n) || n <= 1024 || n > 65535) {
      return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
    }
    if (usedValidatorPorts(input.dataDir).has(n)) {
      return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.portInUse')] });
    }
    ports.rpc = n;
  }
  const limits =
    input.memory || input.cpus
      ? { memory: input.memory, cpus: input.cpus }
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
  mkdirSync(inst.dataPath, { recursive: true });
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
  writeComposeFile(composePath, plan.composeYaml, inst.id, inst.limits);
  upsertValidatorInstance(input.dataDir, inst);
  const written = [join(dir, '..', 'instances.json'), composePath, inst.dataPath];

  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written,
      notes: [tl('validators.notes.dryCreate'), tl('validators.notes.beta')],
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
  });
  if (!up.ok) {
    return failedValidatorOp({
      instanceId: inst.id,
      written,
      notes: [tl('validators.errors.composeFailed'), up.stderr || up.stdout],
    });
  }
  upsertValidatorInstance(input.dataDir, { ...inst, desiredState: 'running' });
  await maybeSyncExposure(input, inst, 'start');
  const notes = [tl('validators.notes.created')];
  if (input.mithril && inst.chain === 'ada') {
    const { restoreAdaMithril } = await import('./mithril.js');
    const m = await restoreAdaMithril({
      dataDir: input.dataDir,
      host: input.host,
      execute: true,
      id: inst.id,
      confirm: inst.id,
    });
    notes.push(...(m.notes ?? []));
  }
  return appliedValidatorOp({
    instanceId: inst.id,
    written,
    notes,
  });
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
    writeComposeFile(composePath, plan.composeYaml, inst.id, inst.limits);
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
  const running = await composePsRunning({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, inst.id)),
    project: composeProjectName(inst.id),
  });
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
  const status: ValidatorNodeStatus['status'] = !running
    ? 'stopped'
    : extra.syncProgress != null && extra.syncProgress < 1
      ? 'syncing'
      : extra.lastError
        ? 'error'
        : 'running';
  return {
    status,
    running,
    diskUsedBytes: null,
    notes: [],
    instance: inst,
    upgrade: detectUpgradeForInstance(inst, loadRemoteClientTags(input.dataDir)),
    ...extra,
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
