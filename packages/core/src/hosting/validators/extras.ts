/**
 * Remaining validator ops: summaries, prune, switch-network, compose, snapshot, stats, auto-clear.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultValidatorMemoryLimit,
  dockerNetIoRate,
  isValidatorInstanceId,
  parseDockerNetIo,
  stakingPlaybookMeta,
  tl,
  type ValidatorInstanceDto,
  type ValidatorNetIoDto,
  type ValidatorSummaryDto,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { getValidatorNetwork } from './registry.js';
import { probeAvaxStakingIdentity } from './adapters/avax.js';
import {
  appliedValidatorOp,
  blockedValidatorOp,
  failedValidatorOp,
  writtenValidatorOp,
  type ValidatorOpsResult,
} from './honesty.js';
import {
  composeFilePath,
  composeProjectName,
  composePsRunning,
  prepareValidatorDataDir,
  validatorIdFromContainerName,
  writeComposeFile,
} from './compose-runner.js';
import { parseJsonLines } from '../docker/parse.js';
import { planInstallFor } from './adapters/index.js';
import {
  deleteValidatorInstance,
  getValidatorInstance,
  instanceDir,
  listValidatorInstances,
  nextValidatorInstanceId,
  upsertValidatorInstance,
} from './store.js';
import { collectValidatorDisk } from './disk.js';
import { statusValidatorInstance } from './manager.js';
import { restoreAdaMithril } from './mithril.js';
import { loadValidatorSettings } from './settings.js';
import { clearValidatorInstance } from './manager.js';
import { nativePruneArgvOk, nativePrunePlan } from './native-prune.js';
import { restoreEthSnapshot, restoreNearEpoch } from './snapshots.js';
import { runOpts, type OpsLogFn } from '../ops-log.js';

export async function summarizeValidatorInstances(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<{ summaries: ValidatorSummaryDto[] }> {
  const disk = await collectValidatorDisk({ dataDir: input.dataDir, host: input.host });
  const used = new Map(disk.instances.map((i) => [i.id, i.usedBytes]));
  const summaries: ValidatorSummaryDto[] = [];
  for (const inst of listValidatorInstances(input.dataDir)) {
    const st = await statusValidatorInstance({
      dataDir: input.dataDir,
      host: input.host,
      id: inst.id,
    });
    const diskUsedBytes = used.get(inst.id) ?? st.diskUsedBytes;
    const summary: ValidatorSummaryDto = {
      id: inst.id,
      status: st.status,
      running: st.running,
      syncProgress: st.syncProgress,
      peers: st.peers,
      diskUsedBytes,
      lastError: st.lastError,
      upgrade: st.upgrade ?? null,
      rxBytes: null,
      txBytes: null,
      rxRateBps: null,
      txRateBps: null,
    };
    summaries.push(summary);
    upsertValidatorInstance(input.dataDir, {
      ...inst,
      lastStatus: {
        at: new Date().toISOString(),
        status: summary.status,
        running: summary.running,
        syncProgress: summary.syncProgress,
        peers: summary.peers,
        diskUsedBytes: summary.diskUsedBytes,
        lastError: summary.lastError,
      },
    });
  }
  const net = await collectValidatorNetIo({
    host: input.host,
    ids: summaries.map((s) => s.id),
  });
  const byId = new Map(net.map((n) => [n.id, n]));
  for (const s of summaries) {
    const n = byId.get(s.id);
    if (!n) continue;
    s.rxBytes = n.rxBytes;
    s.txBytes = n.txBytes;
    s.rxRateBps = n.rxRateBps;
    s.txRateBps = n.txRateBps;
  }
  return { summaries };
}

export async function pruneValidatorInstance(input: {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  id: string;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<ValidatorOpsResult> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  const project = composeProjectName(inst.id);
  const argv = ['image', 'prune', '-f', '--filter', `label=com.docker.compose.project=${project}`];
  const native = nativePrunePlan(inst);
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [],
      notes: [
        tl('validators.notes.dryPrune'),
        argv.join(' '),
        ...(native?.notes ?? []),
        ...(native?.argv.length ? [native.argv.join(' ')] : []),
      ],
    });
  }
  const r = await input.host.runCommand(['docker', ...argv], {
    ...runOpts({ execute: true, timeoutMs: 180_000, onLog: input.onLog, signal: input.signal }),
  });
  if (r.exitCode !== 0) {
    return failedValidatorOp({
      instanceId: inst.id,
      notes: [tl('validators.errors.pruneFailed'), r.stderr || r.stdout],
    });
  }
  const notes = [tl('validators.notes.pruned'), tl('validators.notes.pruneProfile'), ...(native?.notes ?? [])];
  if (native?.argv.length) {
    if (!nativePruneArgvOk(native.argv)) {
      notes.push(tl('validators.errors.pruneFailed'));
    } else {
      input.onLog?.({ stream: 'status', line: native.notes[0] ?? 'native prune' });
      const n = await input.host.runCommand(['docker', ...native.argv], {
        ...runOpts({ execute: true, timeoutMs: 600_000, onLog: input.onLog, signal: input.signal }),
      });
      if (n.exitCode !== 0) {
        return failedValidatorOp({
          instanceId: inst.id,
          notes: [...notes, tl('validators.errors.pruneFailed'), n.stderr || n.stdout],
        });
      }
      notes.push(tl('validators.notes.nativePrune'));
    }
  }
  return appliedValidatorOp({
    instanceId: inst.id,
    notes,
  });
}

export async function switchValidatorNetwork(input: {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  id: string;
  network: string;
  confirm?: string;
}): Promise<ValidatorOpsResult> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  const net = getValidatorNetwork(inst.chain, input.network);
  if (!net) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.invalidId')] });
  if (inst.network === input.network) {
    return writtenValidatorOp({ instanceId: inst.id, written: [], notes: [tl('validators.notes.sameNetwork')] });
  }
  const running = await composePsRunning({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, inst.id)),
    project: composeProjectName(inst.id),
  });
  if (running) {
    return blockedValidatorOp({
      reason: 'validation',
      instanceId: inst.id,
      notes: [tl('validators.errors.switchNeedStop')],
    });
  }
  if (input.confirm !== inst.id && String(input.confirm ?? '').toUpperCase() !== 'CLEAR') {
    return blockedValidatorOp({
      reason: 'validation',
      instanceId: inst.id,
      notes: [tl('validators.errors.switchNeedClear')],
    });
  }
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [],
      notes: [tl('validators.notes.drySwitch'), `${inst.network} -> ${input.network}`],
    });
  }
  try {
    rmSync(inst.dataPath, { recursive: true, force: true });
  } catch {
    /* continue */
  }
  prepareValidatorDataDir(inst.dataPath);
  const newId = isValidatorInstanceId(`${inst.chain}-${input.network}-${inst.slug}`)
    ? `${inst.chain}-${input.network}-${inst.slug}`
    : nextValidatorInstanceId(input.dataDir, inst.chain, input.network);
  const next: ValidatorInstanceDto = {
    ...inst,
    id: newId,
    network: input.network,
    dataPath: join(input.dataDir, 'validators', newId, 'data'),
    desiredState: 'stopped',
    updatedAt: new Date().toISOString(),
  };
  prepareValidatorDataDir(next.dataPath);
  const plan = planInstallFor(next);
  writeComposeFile(composeFilePath(instanceDir(input.dataDir, next.id)), plan.composeYaml, next.id);
  if (newId !== inst.id) deleteValidatorInstance(input.dataDir, inst.id);
  upsertValidatorInstance(input.dataDir, next);
  return appliedValidatorOp({
    instanceId: next.id,
    notes: [tl('validators.notes.switched'), `${inst.network} -> ${input.network}`],
  });
}

export function readValidatorCompose(dataDir: string, id: string): { ok: boolean; path: string; content: string; notes: string[] } {
  const inst = getValidatorInstance(dataDir, id);
  if (!inst) return { ok: false, path: '', content: '', notes: [tl('validators.errors.notFound')] };
  const path = composeFilePath(instanceDir(dataDir, inst.id));
  if (!existsSync(path)) return { ok: false, path, content: '', notes: [tl('validators.errors.composeMissing')] };
  return { ok: true, path, content: readFileSync(path, 'utf8'), notes: [] };
}

export function writeValidatorCompose(input: {
  dataDir: string;
  id: string;
  content: string;
  execute: boolean;
}): ValidatorOpsResult {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  const body = String(input.content ?? '');
  if (!body.includes('ysk-server validators') && !body.includes(inst.id)) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.composeNotManaged')] });
  }
  const path = composeFilePath(instanceDir(input.dataDir, inst.id));
  if (!input.execute) {
    return writtenValidatorOp({ instanceId: inst.id, written: [path], notes: [tl('validators.notes.dryCompose')] });
  }
  writeComposeFile(path, body, inst.id);
  return appliedValidatorOp({ instanceId: inst.id, written: [path], notes: [tl('validators.notes.composeWrote')] });
}

export function regenerateValidatorCompose(input: {
  dataDir: string;
  id: string;
  execute: boolean;
}): ValidatorOpsResult {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  }
  const path = composeFilePath(instanceDir(input.dataDir, inst.id));
  const plan = planInstallFor(inst);
  if (!input.execute) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [path],
      notes: [tl('validators.notes.dryCompose')],
    });
  }
  const limits = inst.limits?.memory
    ? inst.limits
    : { ...inst.limits, memory: defaultValidatorMemoryLimit(inst.chain) };
  writeComposeFile(path, plan.composeYaml, inst.id, limits);
  return appliedValidatorOp({
    instanceId: inst.id,
    written: [path],
    notes: [tl('validators.notes.composeWrote')],
  });
}

export function snapshotOffer(chain: string, network: string): {
  kind: 'mithril' | 'checkpoint' | 'archive' | 'epoch' | 'none';
  notes: string[];
} {
  if (chain === 'ada') return { kind: 'mithril', notes: [tl('validators.snapshot.mithril')] };
  if (chain === 'eth' && (network === 'hoodi' || network === 'sepolia')) {
    return { kind: 'archive', notes: [tl('validators.snapshot.ethEl')] };
  }
  if (chain === 'eth') return { kind: 'checkpoint', notes: [tl('validators.snapshot.eth')] };
  if (chain === 'avax') return { kind: 'none', notes: [tl('validators.snapshot.avax')] };
  if (chain === 'near') return { kind: 'epoch', notes: [tl('validators.snapshot.near')] };
  return { kind: 'none', notes: [tl('validators.snapshot.none')] };
}

export async function restoreValidatorSnapshot(input: {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  id: string;
  confirm?: string;
  fetchFn?: typeof fetch;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<ValidatorOpsResult> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  const offer = snapshotOffer(inst.chain, inst.network);
  if (offer.kind === 'mithril') {
    return restoreAdaMithril({
      dataDir: input.dataDir,
      host: input.host,
      execute: input.execute,
      id: inst.id,
      confirm: input.confirm ?? inst.id,
      onLog: input.onLog,
      signal: input.signal,
    });
  }
  if (offer.kind === 'archive' || offer.kind === 'checkpoint') {
    return restoreEthSnapshot({
      dataDir: input.dataDir,
      host: input.host,
      execute: input.execute,
      id: inst.id,
      confirm: input.confirm ?? inst.id,
      fetchFn: input.fetchFn,
      onLog: input.onLog,
      signal: input.signal,
    });
  }
  if (offer.kind === 'epoch') {
    return restoreNearEpoch({
      dataDir: input.dataDir,
      host: input.host,
      execute: input.execute,
      id: inst.id,
      confirm: input.confirm ?? inst.id,
      onLog: input.onLog,
      signal: input.signal,
    });
  }
  return writtenValidatorOp({
    instanceId: inst.id,
    written: [],
    notes: offer.notes,
  });
}

type ValidatorNetIoPrev = {
  rxBytes: number;
  txBytes: number;
  at: number;
  rxRateBps: number | null;
  txRateBps: number | null;
};

const validatorNetIoPrev = new Map<string, ValidatorNetIoPrev>();
let validatorNetIoLock: Promise<void> = Promise.resolve();

export function resetValidatorNetIoCache(): void {
  validatorNetIoPrev.clear();
}

async function withValidatorNetIoLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prev = validatorNetIoLock;
  validatorNetIoLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function parseValidatorDockerStatsStdout(
  stdout: string,
  ids: readonly string[],
): Array<{ id: string; rxBytes: number; txBytes: number }> {
  const totals = new Map<string, { rxBytes: number; txBytes: number }>();
  for (const row of parseJsonLines(stdout)) {
    const name = String(row.Name ?? row.Container ?? row.Names ?? '');
    const id = validatorIdFromContainerName(name, ids);
    if (!id) continue;
    const io = parseDockerNetIo(String(row.NetIO ?? ''));
    if (!io) continue;
    const prev = totals.get(id) ?? { rxBytes: 0, txBytes: 0 };
    totals.set(id, {
      rxBytes: prev.rxBytes + io.rxBytes,
      txBytes: prev.txBytes + io.txBytes,
    });
  }
  return [...totals.entries()].map(([id, v]) => ({ id, ...v }));
}

export function mergeValidatorNetIo(input: {
  ids: readonly string[];
  samples: Array<{ id: string; rxBytes: number; txBytes: number }>;
  prev: ReadonlyMap<string, ValidatorNetIoPrev>;
  at: number;
}): { items: ValidatorNetIoDto[]; next: Map<string, ValidatorNetIoPrev> } {
  const byId = new Map(input.samples.map((s) => [s.id, s]));
  const next = new Map<string, ValidatorNetIoPrev>();
  const items: ValidatorNetIoDto[] = input.ids.map((id) => {
    const s = byId.get(id);
    if (!s) {
      return { id, rxBytes: null, txBytes: null, rxRateBps: null, txRateBps: null };
    }
    const prev = input.prev.get(id);
    const rate = prev
      ? dockerNetIoRate({
          prevRx: prev.rxBytes,
          prevTx: prev.txBytes,
          prevAt: prev.at,
          rx: s.rxBytes,
          tx: s.txBytes,
          at: input.at,
        })
      : null;
    const rxRateBps = rate?.rxRateBps ?? null;
    const txRateBps = rate?.txRateBps ?? null;
    next.set(id, {
      rxBytes: s.rxBytes,
      txBytes: s.txBytes,
      at: input.at,
      rxRateBps,
      txRateBps,
    });
    return {
      id,
      rxBytes: s.rxBytes,
      txBytes: s.txBytes,
      rxRateBps,
      txRateBps,
    };
  });
  return { items, next };
}

function emptyValidatorNetIo(ids: readonly string[]): ValidatorNetIoDto[] {
  return ids.map((id) => ({
    id,
    rxBytes: null,
    txBytes: null,
    rxRateBps: null,
    txRateBps: null,
  }));
}

function cachedValidatorNetIo(ids: readonly string[]): ValidatorNetIoDto[] {
  return ids.map((id) => {
    const prev = validatorNetIoPrev.get(id);
    if (!prev) {
      return { id, rxBytes: null, txBytes: null, rxRateBps: null, txRateBps: null };
    }
    return {
      id,
      rxBytes: prev.rxBytes,
      txBytes: prev.txBytes,
      rxRateBps: prev.rxRateBps,
      txRateBps: prev.txRateBps,
    };
  });
}

export async function collectValidatorNetIo(input: {
  host: HostExecutor;
  ids?: readonly string[];
  dataDir?: string;
}): Promise<ValidatorNetIoDto[]> {
  return withValidatorNetIoLock(() => collectValidatorNetIoUnlocked(input));
}

async function collectValidatorNetIoUnlocked(input: {
  host: HostExecutor;
  ids?: readonly string[];
  dataDir?: string;
}): Promise<ValidatorNetIoDto[]> {
  const ids =
    input.ids ??
    (input.dataDir ? listValidatorInstances(input.dataDir).map((i) => i.id) : []);
  if (!ids.length) {
    validatorNetIoPrev.clear();
    return [];
  }
  try {
    const ps = await input.host.runCommand(['docker', 'ps', '-q', '--filter', 'name=yskval-'], {
      timeoutMs: 15_000,
    });
    const cids = ps.stdout
      .trim()
      .split(/\s+/)
      .filter((id) => /^[a-f0-9]{12,64}$/i.test(id));
    if (ps.exitCode !== 0) return cachedValidatorNetIo(ids);
    if (!cids.length) {
      validatorNetIoPrev.clear();
      return emptyValidatorNetIo(ids);
    }
    const st = await input.host.runCommand(
      ['docker', 'stats', '--no-stream', '--format', '{{json .}}', ...cids],
      { timeoutMs: 20_000 },
    );
    if (st.exitCode !== 0) return cachedValidatorNetIo(ids);
    const samples = parseValidatorDockerStatsStdout(st.stdout, ids);
    const { items, next } = mergeValidatorNetIo({
      ids,
      samples,
      prev: validatorNetIoPrev,
      at: Date.now(),
    });
    validatorNetIoPrev.clear();
    for (const [k, v] of next) validatorNetIoPrev.set(k, v);
    return items;
  } catch {
    return cachedValidatorNetIo(ids);
  }
}

export async function validatorContainerStats(input: {
  dataDir: string;
  host: HostExecutor;
  id: string;
}): Promise<{ ok: boolean; items: Array<Record<string, string>>; notes: string[] }> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return { ok: false, items: [], notes: [tl('validators.errors.notFound')] };
  const file = composeFilePath(instanceDir(input.dataDir, inst.id));
  const project = composeProjectName(inst.id);
  const ps = await input.host.runCommand(
    ['docker', 'compose', '-f', file, '-p', project, 'ps', '-q'],
    { timeoutMs: 15_000 },
  );
  const ids = ps.stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return { ok: true, items: [], notes: [tl('validators.notes.statsEmpty')] };
  const st = await input.host.runCommand(
    ['docker', 'stats', '--no-stream', '--format', '{{json .}}', ...ids],
    { timeoutMs: 20_000 },
  );
  const items: Array<Record<string, string>> = [];
  for (const line of st.stdout.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      items.push(JSON.parse(s) as Record<string, string>);
    } catch {
      /* skip */
    }
  }
  return { ok: st.exitCode === 0, items, notes: st.exitCode === 0 ? [] : [st.stderr] };
}

export async function runValidatorAutoClear(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<{ cleared: string[]; notes: string[] }> {
  const settings = loadValidatorSettings(input.dataDir);
  if (!settings.autoClear) return { cleared: [], notes: ['auto-clear off'] };
  const disk = await collectValidatorDisk({ dataDir: input.dataDir, host: input.host });
  if (disk.tone !== 'danger') return { cleared: [], notes: ['disk not critical'] };
  const running = new Set<string>();
  for (const inst of listValidatorInstances(input.dataDir)) {
    const on = await composePsRunning({
      host: input.host,
      file: composeFilePath(instanceDir(input.dataDir, inst.id)),
      project: composeProjectName(inst.id),
    });
    if (on) running.add(inst.id);
  }
  const candidates = rankValidatorAutoClearCandidates(
    disk.instances.map((i) => ({ id: i.id, usedBytes: i.usedBytes, running: running.has(i.id) })),
  );
  const target = candidates[0];
  if (!target) return { cleared: [], notes: [tl('validators.notes.autoClearNone')] };
  const r = await clearValidatorInstance({
    dataDir: input.dataDir,
    host: input.host,
    execute: input.host.executeEnabled(),
    id: target.id,
    confirm: target.id,
  });
  return {
    cleared: r.ok && r.apply_status === 'applied' ? [target.id] : [],
    notes: r.notes ?? [],
  };
}

export async function stakingChecklistForInstance(inst: ValidatorInstanceDto): Promise<{
  items: string[];
  links: Array<{ label: string; href: string }>;
  nodeId?: string | null;
  blsPublicKey?: string | null;
  blsProofOfPossession?: string | null;
}> {
  const base = stakingChecklist(inst.chain);
  if (inst.chain !== 'avax') return base;
  return { ...base, ...(await probeAvaxStakingIdentity(inst)) };
}

export function stakingChecklist(chain: string): { items: string[]; links: Array<{ label: string; href: string }> } {
  const meta = stakingPlaybookMeta(chain);
  const items =
    chain === 'btc'
      ? [tl('validators.playbook.notPosBody')]
      : playbookLines(chain, 'steps');
  return {
    items: items.length ? items : [tl('validators.stake.offlineKeys'), tl('validators.stake.monitor')],
    links: [...(meta?.links ?? [])],
  };
}

function playbookLines(chain: string, field: 'steps' | 'yskDoes' | 'youDo' | 'never'): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const key = `validators.playbook.${chain}.${field}.${i}`;
    const line = tl(key);
    if (line === key) break;
    out.push(line);
  }
  return out;
}

export function rankValidatorAutoClearCandidates(
  items: Array<{ id: string; usedBytes: number; running?: boolean }>,
): Array<{ id: string; usedBytes: number }> {
  return items
    .filter((i) => !i.running)
    .map((i) => ({ id: i.id, usedBytes: i.usedBytes }))
    .sort((a, b) => {
      const aEmpty = a.usedBytes <= 0 ? 1 : 0;
      const bEmpty = b.usedBytes <= 0 ? 1 : 0;
      if (aEmpty !== bEmpty) return aEmpty - bEmpty;
      return b.usedBytes - a.usedBytes;
    });
}

export function dataDirHasChainData(dataPath: string): boolean {
  if (!existsSync(dataPath)) return false;
  try {
    const names = readdirSync(dataPath);
    return names.some((n) => {
      try {
        return statSync(join(dataPath, n)).isDirectory() || statSync(join(dataPath, n)).size > 0;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
