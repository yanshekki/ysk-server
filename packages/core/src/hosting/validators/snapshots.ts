/**
 * Allowlisted snapshot restore: ETH (ethPandaOps testnet + checkpoint),
 * NEAR (official genesis / epoch sync — free third-party tarballs were retired).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { classifyDockerArgv } from '../docker/argv.js';
import { runOpts, type OpsLogFn } from '../ops-log.js';
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
  composeProjectName,
  composeUp,
} from './compose-runner.js';
import { ETH_CHECKPOINT } from './adapters/eth-clients.js';
import { getValidatorInstance, instanceDir } from './store.js';

export const ETH_PANDAOPS_HOST = 'snapshots.ethpandaops.io';
export const SNAPSHOT_FETCH_IMAGE = 'alpine:3.20';

export function ethPandaopsLatestUrl(network: string, clientId: string): string {
  return `https://${ETH_PANDAOPS_HOST}/${network}/${clientId}/latest`;
}

export function ethPandaopsArchiveUrl(network: string, clientId: string, block: string): string {
  return `https://${ETH_PANDAOPS_HOST}/${network}/${clientId}/${block}/snapshot.tar.zst`;
}

export function isEthPandaopsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === ETH_PANDAOPS_HOST && u.pathname.includes('/snapshot.tar.zst');
  } catch {
    return false;
  }
}

export async function resolveEthPandaopsArchive(input: {
  network: string;
  clientId: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: true; url: string; block: string } | { ok: false; notes: string[] }> {
  const net = input.network === 'sepolia' ? 'sepolia' : input.network === 'hoodi' ? 'hoodi' : '';
  const client = ['geth', 'reth', 'nethermind'].includes(input.clientId) ? input.clientId : '';
  if (!net || !client) return { ok: false, notes: [tl('validators.errors.snapshotUnsupported')] };
  const fetchFn = input.fetchFn ?? fetch;
  try {
    const res = await fetchFn(ethPandaopsLatestUrl(net, client));
    const block = (await res.text()).trim();
    if (!res.ok || !/^\d+$/.test(block)) {
      return { ok: false, notes: [tl('validators.errors.snapshotLookup'), `http ${res.status}`] };
    }
    const url = ethPandaopsArchiveUrl(net, client, block);
    if (!isEthPandaopsUrl(url)) return { ok: false, notes: [tl('validators.errors.snapshotUnsupported')] };
    return { ok: true, url, block };
  } catch (e) {
    return { ok: false, notes: [tl('validators.errors.snapshotLookup'), e instanceof Error ? e.message : 'fetch'] };
  }
}

function buildSnapshotExtractArgv(dataPath: string, url: string): string[] {
  return [
    'run',
    '--rm',
    '--network',
    'bridge',
    '--entrypoint',
    '/bin/sh',
    '-v',
    `${dataPath}:/data`,
    SNAPSHOT_FETCH_IMAGE,
    '-c',
    `set -e; apk add --no-cache wget zstd tar >/dev/null; wget -qO- ${JSON.stringify(url)} | zstd -d | tar -x -C /data`,
  ];
}

export async function restoreEthSnapshot(input: {
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
  if (inst.chain !== 'eth') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.snapshotUnsupported')] });
  }
  if (input.confirm !== inst.id && String(input.confirm ?? '').toUpperCase() !== 'SNAPSHOT') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.needSnapshotConfirm')] });
  }
  const elId = inst.clients.el?.id ?? 'reth';
  const clId = inst.clients.cl?.id ?? 'lighthouse';
  const elDir = join(inst.dataPath, elId);
  const clDir = join(inst.dataPath, clId);
  const checkpoint = ETH_CHECKPOINT[inst.network] ?? ETH_CHECKPOINT.hoodi;
  const testnet = inst.network === 'hoodi' || inst.network === 'sepolia';
  let archive: { url: string; block: string } | null = null;
  if (testnet) {
    const resolved = await resolveEthPandaopsArchive({
      network: inst.network,
      clientId: elId,
      fetchFn: input.fetchFn,
    });
    if (resolved.ok) archive = { url: resolved.url, block: resolved.block };
    else input.onLog?.({ stream: 'status', line: resolved.notes.join(' ') });
  }

  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [],
      notes: [
        tl('validators.notes.drySnapshot'),
        archive ? `el ${archive.url}` : tl('validators.snapshot.eth'),
        `cl checkpoint ${checkpoint}`,
      ],
    });
  }

  const composePath = composeFilePath(instanceDir(input.dataDir, inst.id));
  const project = composeProjectName(inst.id);
  input.onLog?.({ stream: 'status', line: 'compose down' });
  await composeDown({
    host: input.host,
    file: composePath,
    project,
    execute: true,
    onLog: input.onLog,
    signal: input.signal,
  });

  if (archive) {
    const argv = buildSnapshotExtractArgv(elDir, archive.url);
    if (classifyDockerArgv(['docker', ...argv]) === 'blocked') {
      return blockedValidatorOp({
        reason: 'validation',
        instanceId: inst.id,
        notes: [tl('validators.errors.snapshotBlocked')],
      });
    }
    mkdirSync(elDir, { recursive: true });
    input.onLog?.({ stream: 'status', line: `el snapshot ${archive.block}` });
    const run = await input.host.runCommand(['docker', ...argv], {
      ...runOpts({ execute: true, timeoutMs: 3_600_000, onLog: input.onLog, signal: input.signal }),
    });
    if (run.exitCode !== 0) {
      return failedValidatorOp({
        instanceId: inst.id,
        notes: [tl('validators.errors.snapshotFailed'), run.stderr || run.stdout],
      });
    }
  }

  try {
    rmSync(clDir, { recursive: true, force: true });
  } catch {
    /* continue */
  }
  mkdirSync(clDir, { recursive: true });
  input.onLog?.({ stream: 'status', line: `cl checkpoint ${checkpoint}` });
  const up = await composeUp({
    host: input.host,
    file: composePath,
    project,
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
  return appliedValidatorOp({
    instanceId: inst.id,
    notes: [
      archive ? tl('validators.notes.snapshotEthEl') : tl('validators.notes.snapshotEthCl'),
      checkpoint,
    ],
  });
}

export async function restoreNearEpoch(input: {
  dataDir: string;
  host: HostExecutor;
  execute: boolean;
  id: string;
  confirm?: string;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<ValidatorOpsResult> {
  const inst = getValidatorInstance(input.dataDir, input.id);
  if (!inst) return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.notFound')] });
  if (inst.chain !== 'near') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.snapshotUnsupported')] });
  }
  if (input.confirm !== inst.id && String(input.confirm ?? '').toUpperCase() !== 'SNAPSHOT') {
    return blockedValidatorOp({ reason: 'validation', notes: [tl('validators.errors.needSnapshotConfirm')] });
  }
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenValidatorOp({
      instanceId: inst.id,
      written: [],
      notes: [tl('validators.notes.drySnapshot'), tl('validators.snapshot.near')],
    });
  }
  const composePath = composeFilePath(instanceDir(input.dataDir, inst.id));
  const project = composeProjectName(inst.id);
  await composeDown({
    host: input.host,
    file: composePath,
    project,
    execute: true,
    onLog: input.onLog,
    signal: input.signal,
  });
  try {
    rmSync(inst.dataPath, { recursive: true, force: true });
  } catch {
    /* continue */
  }
  mkdirSync(inst.dataPath, { recursive: true });
  const up = await composeUp({
    host: input.host,
    file: composePath,
    project,
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
  return appliedValidatorOp({
    instanceId: inst.id,
    notes: [tl('validators.notes.snapshotNear')],
  });
}
