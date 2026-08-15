/**
 * Docker engine manager — inventory + honesty-gated mutations via HostExecutor.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isSafeDockerImageRef,
  isSafeDockerName,
  isSafeVolumeDest,
  isDockerPruneScope,
  isDockerRestartPolicy,
  tl,
  type DockerComposeProject,
  type DockerContainerRow,
  type DockerDaemonSettings,
  type DockerDfRow,
  type DockerEngineStatus,
  type DockerImageRow,
  type DockerNetworkRow,
  type DockerPruneScope,
  type DockerRunRequest,
  type DockerVolumeRow,
  validatorIdFromComposeProject,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { runOpts, type OpsLogFn } from '../ops-log.js';
import { classifyDockerArgv } from './argv.js';
import {
  applyDaemonPatch,
  readDaemonSettings,
  writeDaemonSettings,
  type DockerDaemonPatch,
} from './daemon.js';
import {
  appliedDockerOp,
  blockedDockerOp,
  failedDockerOp,
  writtenDockerOp,
  type DockerOpsResult,
} from './honesty.js';
import {
  parseComposeLs,
  parseContainers,
  parseDockerInfo,
  parseImages,
  parseNetworks,
  parseSystemDf,
  parseVolumes,
} from './parse.js';
import { composeFilePath, composeProjectName } from '../validators/compose-runner.js';
import { listValidatorInstances } from '../validators/store.js';

export type DockerCtx = {
  host: HostExecutor;
  dataDir: string;
  execute: boolean;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
};

async function docker(
  host: HostExecutor,
  argv: string[],
  opts?: { timeoutMs?: number; dryRun?: boolean; onLog?: OpsLogFn; signal?: AbortSignal },
): Promise<{ exitCode: number; stdout: string; stderr: string; argv: string[] }> {
  const cls = classifyDockerArgv(['docker', ...argv]);
  if (cls === 'blocked') {
    return { exitCode: 2, stdout: '', stderr: 'blocked docker argv', argv: ['docker', ...argv] };
  }
  try {
    const r = await host.runCommand(['docker', ...argv], {
      ...runOpts({
        execute: opts?.dryRun === true ? false : true,
        timeoutMs: opts?.timeoutMs ?? 30_000,
        onLog: opts?.onLog,
        signal: opts?.signal,
      }),
      dryRun: opts?.dryRun,
    });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, argv: ['docker', ...argv] };
  } catch (e) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: e instanceof Error ? e.message : 'docker command failed',
      argv: ['docker', ...argv],
    };
  }
}

export async function probeDockerEngine(host: HostExecutor): Promise<{
  installed: boolean;
  daemonActive: boolean;
  composeAvailable: boolean;
  version: string | null;
  composeVersion: string | null;
  notes: string[];
}> {
  const notes: string[] = [];
  let version: string | null = null;
  let composeVersion: string | null = null;
  let installed = false;
  let daemonActive = false;
  let composeAvailable = false;
  try {
    const ver = await docker(host, ['version', '--format', '{{.Client.Version}}'], { timeoutMs: 4_000 });
    if (ver.exitCode === 0 && ver.stdout.trim()) {
      installed = true;
      version = ver.stdout.trim().split('\n')[0] ?? null;
    } else {
      notes.push(ver.stderr.trim() || tl('docker.errors.notInstalled'));
    }
  } catch (e) {
    notes.push(e instanceof Error ? e.message : tl('docker.errors.notInstalled'));
  }
  if (installed) {
    try {
      const info = await docker(host, ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8_000 });
      daemonActive = info.exitCode === 0 && Boolean(info.stdout.trim());
      if (!daemonActive) notes.push(tl('docker.errors.daemonDown'));
    } catch {
      notes.push(tl('docker.errors.daemonDown'));
    }
    try {
      const cv = await docker(host, ['compose', 'version'], { timeoutMs: 8_000 });
      composeAvailable = cv.exitCode === 0;
      composeVersion = composeAvailable ? cv.stdout.trim().split('\n')[0] ?? null : null;
      if (!composeAvailable) notes.push(tl('docker.errors.needCompose'));
    } catch {
      notes.push(tl('docker.errors.needCompose'));
    }
  }
  return { installed, daemonActive, composeAvailable, version, composeVersion, notes };
}

function scanValidatorCompose(dataDir: string): DockerComposeProject[] {
  const root = join(dataDir, 'validators');
  if (!existsSync(root)) return [];
  const out: DockerComposeProject[] = [];
  for (const inst of listValidatorInstances(dataDir)) {
    const file = composeFilePath(join(root, inst.id));
    out.push({
      name: composeProjectName(inst.id),
      status: existsSync(file) ? 'configured' : 'missing',
      configFiles: existsSync(file) ? file : '',
      yskManaged: true,
      validatorId: inst.id,
    });
  }
  try {
    for (const name of readdirSync(root)) {
      const file = composeFilePath(join(root, name));
      if (!existsSync(file)) continue;
      if (out.some((p) => p.validatorId === name)) continue;
      out.push({
        name: composeProjectName(name),
        status: 'configured',
        configFiles: file,
        yskManaged: true,
        validatorId: name,
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function dockerEngineStatus(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<DockerEngineStatus> {
  const probe = await probeDockerEngine(input.host);
  const validatorProjects = listValidatorInstances(input.dataDir).length;
  const empty: DockerEngineStatus = {
    ...probe,
    dataRoot: null,
    rootless: false,
    cgroupDriver: null,
    counts: { containers: 0, running: 0, images: 0, volumes: 0, networks: 0 },
    disk: { dataRoot: null, usedBytes: null, availBytes: null, usePct: null },
    validatorProjects,
  };
  if (!probe.installed || !probe.daemonActive) return empty;
  try {
    const infoRaw = await docker(input.host, ['info', '--format', '{{json .}}'], { timeoutMs: 12_000 });
    const info = parseDockerInfo(infoRaw.stdout);
    const vols = await listDockerVolumes({ host: input.host });
    const nets = await listDockerNetworks({ host: input.host });
    let disk = { dataRoot: info.dataRoot, usedBytes: null as number | null, availBytes: null as number | null, usePct: null as number | null };
    if (info.dataRoot) {
      try {
        const { parseDfBytes, pickMountForPath } = await import('../validators/disk.js');
        const df = await input.host.runCommand(['df', '-B1', '-T', info.dataRoot], { timeoutMs: 8_000 });
        const mount = pickMountForPath(parseDfBytes(df.stdout), info.dataRoot);
        if (mount) {
          disk = {
            dataRoot: info.dataRoot,
            usedBytes: mount.usedBytes,
            availBytes: mount.availBytes,
            usePct: mount.usePct,
          };
        }
      } catch {
        /* leave nulls */
      }
    }
    return {
      ...probe,
      version: info.version ?? probe.version,
      dataRoot: info.dataRoot,
      rootless: info.rootless,
      cgroupDriver: info.cgroupDriver,
      counts: {
        containers: info.containers,
        running: info.running,
        images: info.images,
        volumes: vols.length,
        networks: nets.length,
      },
      disk,
      validatorProjects,
    };
  } catch (e) {
    return {
      ...empty,
      notes: [...probe.notes, e instanceof Error ? e.message : 'docker info failed'],
    };
  }
}

export async function listDockerContainers(input: {
  host: HostExecutor;
  all?: boolean;
}): Promise<DockerContainerRow[]> {
  const argv = ['ps', '--format', '{{json .}}'];
  if (input.all !== false) argv.splice(1, 0, '-a');
  const r = await docker(input.host, argv);
  if (r.exitCode !== 0) return [];
  return parseContainers(r.stdout);
}

export async function listDockerImages(host: HostExecutor): Promise<DockerImageRow[]> {
  const r = await docker(host, ['images', '--format', '{{json .}}']);
  return r.exitCode === 0 ? parseImages(r.stdout) : [];
}

export async function listDockerVolumes(input: { host: HostExecutor }): Promise<DockerVolumeRow[]> {
  const r = await docker(input.host, ['volume', 'ls', '--format', '{{json .}}']);
  return r.exitCode === 0 ? parseVolumes(r.stdout) : [];
}

export async function listDockerNetworks(input: { host: HostExecutor }): Promise<DockerNetworkRow[]> {
  const r = await docker(input.host, ['network', 'ls', '--format', '{{json .}}']);
  return r.exitCode === 0 ? parseNetworks(r.stdout) : [];
}

export async function listDockerComposeProjects(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<DockerComposeProject[]> {
  const fromDisk = scanValidatorCompose(input.dataDir);
  const r = await docker(input.host, ['compose', 'ls', '--format', 'json']);
  const live = r.exitCode === 0 ? parseComposeLs(r.stdout) : [];
  const byName = new Map<string, DockerComposeProject>();
  for (const p of fromDisk) byName.set(p.name, p);
  for (const p of live) {
    const prev = byName.get(p.name);
    byName.set(p.name, {
      ...p,
      yskManaged: p.yskManaged || Boolean(prev?.yskManaged),
      validatorId: p.validatorId ?? prev?.validatorId ?? validatorIdFromComposeProject(p.name),
      configFiles: p.configFiles || prev?.configFiles || '',
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function dockerContainerLogs(input: {
  host: HostExecutor;
  id: string;
  tail?: number;
}): Promise<{ lines: string[]; notes: string[] }> {
  const id = String(input.id ?? '').trim();
  if (!isSafeDockerName(id) && !/^[a-f0-9]{6,64}$/i.test(id)) {
    return { lines: [], notes: [tl('docker.errors.badName')] };
  }
  const tail = Math.min(500, Math.max(20, input.tail ?? 200));
  const r = await docker(input.host, ['logs', '--tail', String(tail), id], { timeoutMs: 20_000 });
  const text = `${r.stdout}\n${r.stderr}`.trim();
  return {
    lines: text ? text.split('\n') : [],
    notes: r.exitCode === 0 ? [] : [r.stderr.trim() || tl('docker.errors.logsFailed')],
  };
}

export function inferExecBin(image: string): string | null {
  const s = String(image ?? '').toLowerCase();
  if (s.includes('client-go') || /\/geth(?::|$)/.test(s) || s.includes('ethereum/client-go')) return 'geth';
  if (s.includes('reth')) return 'reth';
  if (s.includes('nethermind')) return 'nethermind';
  if (s.includes('lighthouse')) return 'lighthouse';
  if (s.includes('prysm')) return 'beacon-chain';
  if (s.includes('teku')) return 'teku';
  if (s.includes('nimbus')) return 'nimbus_beacon_node';
  if (s.includes('avalanche')) return 'avalanchego';
  if (s.includes('near')) return 'neard';
  if (s.includes('cardano')) return 'cardano-node';
  if (s.includes('bitcoin')) return 'bitcoin-cli';
  if (s.includes('gaia') || s.includes('cosmos')) return 'gaiad';
  if (s.includes('sui')) return 'sui';
  if (s.includes('aptos')) return 'aptos';
  if (s.includes('agave') || s.includes('solana')) return 'solana';
  if (s.includes('polkadot')) return 'polkadot';
  if (s.includes('alpine') || s.includes('busybox')) return 'busybox';
  return null;
}

export function buildDockerExecArgv(input: {
  id: string;
  preset: 'version' | 'help' | 'hostname';
  bin?: string;
  image?: string;
}): { ok: true; argv: string[] } | { ok: false; notes: string[] } {
  const id = String(input.id ?? '').trim();
  if (!isSafeDockerName(id) && !/^[a-f0-9]{6,64}$/i.test(id)) {
    return { ok: false, notes: [tl('docker.errors.badName')] };
  }
  const bin = (input.bin?.trim() || inferExecBin(input.image ?? '') || '').trim();
  if (!bin) return { ok: false, notes: [tl('docker.errors.badExec')] };
  const tail =
    input.preset === 'hostname'
      ? bin === 'busybox'
        ? ['busybox', 'hostname']
        : ['hostname']
      : input.preset === 'help'
        ? [bin, '--help']
        : bin === 'geth'
          ? ['geth', 'version']
          : [bin, '--version'];
  const argv = ['exec', id, ...tail];
  if (classifyDockerArgv(['docker', ...argv]) === 'blocked') {
    return { ok: false, notes: [tl('docker.errors.badExec')] };
  }
  return { ok: true, argv };
}

export async function dockerExec(
  input: DockerCtx & {
    id: string;
    preset?: 'version' | 'help' | 'hostname';
    bin?: string;
  },
): Promise<DockerOpsResult> {
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  let image = '';
  const ins = await inspectDocker({ host: input.host, id: input.id });
  if (ins.ok && ins.raw && typeof ins.raw === 'object') {
    const arr = Array.isArray(ins.raw) ? ins.raw : [ins.raw];
    const cfg = arr[0] as { Config?: { Image?: string }; Image?: string };
    image = String(cfg?.Config?.Image ?? cfg?.Image ?? '');
  }
  const built = buildDockerExecArgv({
    id: input.id,
    preset: input.preset ?? 'version',
    bin: input.bin,
    image,
  });
  if (!built.ok) return blockedDockerOp({ reason: 'validation', notes: built.notes });
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), built.argv.join(' ')] });
  }
  const r = await docker(input.host, built.argv, {
    timeoutMs: 30_000,
    onLog: input.onLog,
    signal: input.signal,
  });
  if (r.exitCode !== 0) {
    return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed'), r.stdout.trim()] });
  }
  return appliedDockerOp({
    notes: [tl('docker.notes.exec'), r.stdout.trim() || r.stderr.trim()].filter(Boolean),
  });
}

export async function inspectDocker(input: {
  host: HostExecutor;
  id: string;
}): Promise<{ ok: boolean; raw: unknown; notes: string[] }> {
  const id = String(input.id ?? '').trim();
  if (!id) return { ok: false, raw: null, notes: [tl('docker.errors.badName')] };
  const r = await docker(input.host, ['inspect', id]);
  if (r.exitCode !== 0) return { ok: false, raw: null, notes: [r.stderr.trim() || 'inspect failed'] };
  try {
    return { ok: true, raw: JSON.parse(r.stdout) as unknown, notes: [] };
  } catch {
    return { ok: true, raw: r.stdout, notes: [] };
  }
}

export async function dockerSystemDf(host: HostExecutor): Promise<DockerDfRow[]> {
  const r = await docker(host, ['system', 'df']);
  return parseSystemDf(r.stdout);
}

function needDocker(probe: Awaited<ReturnType<typeof probeDockerEngine>>): DockerOpsResult | null {
  if (!probe.installed) {
    return blockedDockerOp({ reason: 'missing_binary', notes: [tl('docker.errors.notInstalled'), ...probe.notes] });
  }
  if (!probe.daemonActive) {
    return blockedDockerOp({ reason: 'other', notes: [tl('docker.errors.daemonDown'), ...probe.notes] });
  }
  return null;
}

export async function dockerContainerAction(input: DockerCtx & {
  id: string;
  action: 'start' | 'stop' | 'restart' | 'remove';
}): Promise<DockerOpsResult> {
  const id = String(input.id ?? '').trim();
  if (!id) return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badName')] });
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  const argv =
    input.action === 'remove' ? ['rm', '-f', id] : [input.action, id];
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), argv.join(' ')] });
  }
  const r = await docker(input.host, argv, { timeoutMs: 60_000 });
  if (r.exitCode !== 0) {
    return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  }
  return appliedDockerOp({ notes: [tl(`docker.notes.${input.action}`)] });
}

export function buildDockerRunArgv(req: DockerRunRequest): { ok: true; argv: string[] } | { ok: false; notes: string[] } {
  if (!isSafeDockerImageRef(req.image)) {
    return { ok: false, notes: [tl('docker.errors.badImage')] };
  }
  if (req.name && !isSafeDockerName(req.name)) {
    return { ok: false, notes: [tl('docker.errors.badName')] };
  }
  const restart = req.restart ?? 'unless-stopped';
  if (!isDockerRestartPolicy(restart)) {
    return { ok: false, notes: [tl('docker.errors.badRestart')] };
  }
  const network = (req.network ?? 'bridge').trim() || 'bridge';
  if (network === 'host' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,64}$/.test(network)) {
    return { ok: false, notes: [tl('docker.errors.badNetwork')] };
  }
  const argv = ['run', '-d', '--restart', restart, '--network', network];
  if (req.name) argv.push('--name', req.name);
  argv.push('--label', 'com.ysk-server.managed=true', '--label', 'com.ysk-server.feature=docker-run');
  for (const p of req.ports ?? []) {
    const host = Number(p.host);
    const cont = Number(p.container);
    if (!Number.isInteger(host) || host < 1 || host > 65535) {
      return { ok: false, notes: [tl('docker.errors.badPort')] };
    }
    if (!Number.isInteger(cont) || cont < 1 || cont > 65535) {
      return { ok: false, notes: [tl('docker.errors.badPort')] };
    }
    const bind = (p.bind ?? '127.0.0.1').trim() || '127.0.0.1';
    if (bind !== '127.0.0.1' && bind !== '0.0.0.0') {
      return { ok: false, notes: [tl('docker.errors.badPort')] };
    }
    const proto = p.proto === 'udp' ? '/udp' : '';
    argv.push('-p', `${bind}:${host}:${cont}${proto}`);
  }
  for (const [k, v] of Object.entries(req.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      return { ok: false, notes: [tl('docker.errors.badEnv')] };
    }
    if (String(v).includes('\n')) {
      return { ok: false, notes: [tl('docker.errors.badEnv')] };
    }
    argv.push('-e', `${k}=${v}`);
  }
  for (const vol of req.volumes ?? []) {
    if (!isSafeDockerName(vol.name) || !isSafeVolumeDest(vol.dest)) {
      return { ok: false, notes: [tl('docker.errors.badVolume')] };
    }
    argv.push('-v', `${vol.name}:${vol.dest}`);
  }
  argv.push(req.image);
  return { ok: true, argv };
}

export async function dockerRun(input: DockerCtx & { req: DockerRunRequest }): Promise<DockerOpsResult> {
  const built = buildDockerRunArgv(input.req);
  if (!built.ok) return blockedDockerOp({ reason: 'validation', notes: built.notes });
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), built.argv.join(' ')] });
  }
  const r = await docker(input.host, built.argv, { timeoutMs: 180_000 });
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.ran'), r.stdout.trim()].filter(Boolean) });
}

export async function dockerPull(input: DockerCtx & { image: string }): Promise<DockerOpsResult> {
  if (!isSafeDockerImageRef(input.image)) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badImage')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker pull ${input.image}`] });
  }
  const r = await docker(input.host, ['pull', input.image], {
    timeoutMs: 600_000,
    onLog: input.onLog,
    signal: input.signal,
  });
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.pulled')] });
}

export async function dockerRemoveImage(input: DockerCtx & { id: string }): Promise<DockerOpsResult> {
  const id = String(input.id ?? '').trim();
  if (!id) return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badImage')] });
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker rmi ${id}`] });
  }
  const r = await docker(input.host, ['rmi', id], { timeoutMs: 120_000 });
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.imageRemoved')] });
}

export async function dockerCreateVolume(input: DockerCtx & { name: string }): Promise<DockerOpsResult> {
  if (!isSafeDockerName(input.name)) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badName')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker volume create ${input.name}`] });
  }
  const r = await docker(input.host, ['volume', 'create', input.name]);
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.volumeCreated')] });
}

export async function dockerRemoveVolume(input: DockerCtx & { name: string }): Promise<DockerOpsResult> {
  if (!isSafeDockerName(input.name)) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badName')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker volume rm ${input.name}`] });
  }
  const r = await docker(input.host, ['volume', 'rm', input.name]);
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.volumeRemoved')] });
}

export async function dockerCreateNetwork(input: DockerCtx & { name: string }): Promise<DockerOpsResult> {
  if (!isSafeDockerName(input.name) || input.name === 'bridge' || input.name === 'host' || input.name === 'none') {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badNetwork')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker network create ${input.name}`] });
  }
  const r = await docker(input.host, ['network', 'create', input.name]);
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.networkCreated')] });
}

export async function dockerRemoveNetwork(input: DockerCtx & { id: string }): Promise<DockerOpsResult> {
  const id = String(input.id ?? '').trim();
  if (!id || id === 'bridge' || id === 'host' || id === 'none' || id === 'docker0') {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.protectedNetwork')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), `docker network rm ${id}`] });
  }
  const r = await docker(input.host, ['network', 'rm', id]);
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.networkRemoved')] });
}

function composeFileFor(dataDir: string, project: string): string | null {
  const fromName = validatorIdFromComposeProject(project);
  if (fromName) {
    const p = composeFilePath(join(dataDir, 'validators', fromName));
    if (existsSync(p)) return p;
  }
  const direct = composeFilePath(join(dataDir, 'validators', project));
  return existsSync(direct) ? direct : null;
}

export async function dockerComposeAction(input: DockerCtx & {
  project: string;
  action: 'up' | 'down' | 'restart';
}): Promise<DockerOpsResult> {
  const project = String(input.project ?? '').trim();
  if (!isSafeDockerName(project)) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badName')] });
  }
  const file = composeFileFor(input.dataDir, project);
  if (!file) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.composeMissing')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  if (!probe.composeAvailable) {
    return blockedDockerOp({ reason: 'missing_binary', notes: [tl('docker.errors.needCompose')] });
  }
  const argv =
    input.action === 'up'
      ? ['compose', '-f', file, '-p', project, 'up', '-d']
      : input.action === 'down'
        ? ['compose', '-f', file, '-p', project, 'down']
        : ['compose', '-f', file, '-p', project, 'restart'];
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryMutate'), argv.join(' ')] });
  }
  const r = await docker(input.host, argv, {
    timeoutMs: 600_000,
    onLog: input.onLog,
    signal: input.signal,
  });
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl(`docker.notes.compose.${input.action}`)] });
}

export async function dockerComposeLogs(input: {
  host: HostExecutor;
  dataDir: string;
  project: string;
  tail?: number;
}): Promise<{ lines: string[]; notes: string[] }> {
  const file = composeFileFor(input.dataDir, input.project);
  if (!file) return { lines: [], notes: [tl('docker.errors.composeMissing')] };
  const tail = Math.min(500, Math.max(20, input.tail ?? 200));
  const r = await docker(input.host, [
    'compose',
    '-f',
    file,
    '-p',
    input.project,
    'logs',
    '--no-color',
    '--tail',
    String(tail),
  ]);
  const text = `${r.stdout}\n${r.stderr}`.trim();
  return { lines: text ? text.split('\n') : [], notes: r.exitCode === 0 ? [] : [r.stderr] };
}

export async function dockerPrune(input: DockerCtx & {
  scope: string;
  confirm?: string;
}): Promise<DockerOpsResult> {
  if (!isDockerPruneScope(input.scope)) {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.badPrune')] });
  }
  const scope = input.scope as DockerPruneScope;
  if ((scope === 'volumes' || scope === 'system') && input.confirm !== 'PRUNE') {
    return blockedDockerOp({ reason: 'validation', notes: [tl('docker.errors.needPruneConfirm')] });
  }
  const probe = await probeDockerEngine(input.host);
  const missing = needDocker(probe);
  if (missing) return missing;
  const argv =
    scope === 'containers'
      ? ['container', 'prune', '-f']
      : scope === 'images'
        ? ['image', 'prune', '-f']
        : scope === 'volumes'
          ? ['volume', 'prune', '-f']
          : scope === 'builder'
            ? ['builder', 'prune', '-f']
            : ['system', 'prune', '-f'];
  // builder prune is classified blocked at argv — map to image prune --filter dangling
  const safeArgv = scope === 'builder' ? ['image', 'prune', '-f'] : argv;
  if (!input.execute || !input.host.executeEnabled()) {
    const df = await dockerSystemDf(input.host);
    return writtenDockerOp({
      notes: [
        tl('docker.notes.dryPrune'),
        safeArgv.join(' '),
        ...df.map((r) => `${r.type} ${r.size} reclaimable ${r.reclaimable}`),
      ],
    });
  }
  const r = await docker(input.host, safeArgv, {
    timeoutMs: 300_000,
    onLog: input.onLog,
    signal: input.signal,
  });
  if (r.exitCode !== 0) return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.mutateFailed')] });
  return appliedDockerOp({ notes: [tl('docker.notes.pruned'), r.stdout.trim()].filter(Boolean) });
}

export async function dockerEngineControl(input: DockerCtx & {
  action: 'start' | 'stop' | 'restart';
}): Promise<DockerOpsResult> {
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryEngine'), `systemctl ${input.action} docker`] });
  }
  const r = await input.host.runCommand(['systemctl', input.action, 'docker'], { timeoutMs: 60_000 });
  if (r.exitCode !== 0) {
    return failedDockerOp({ notes: [r.stderr.trim() || tl('docker.errors.engineFailed')] });
  }
  return appliedDockerOp({ notes: [tl(`docker.notes.engine.${input.action}`)] });
}

export function getDockerDaemonSettings(): DockerDaemonSettings {
  return readDaemonSettings();
}

export async function patchDockerDaemon(input: DockerCtx & {
  patch: DockerDaemonPatch;
}): Promise<DockerOpsResult> {
  const cur = readDaemonSettings();
  const applied = applyDaemonPatch(cur.raw, input.patch);
  if (!applied.ok) return blockedDockerOp({ reason: 'validation', notes: applied.notes });
  if (!input.execute || !input.host.executeEnabled()) {
    return writtenDockerOp({ notes: [tl('docker.notes.dryDaemon')] });
  }
  const w = writeDaemonSettings({ next: applied.next, execute: true });
  const restart = await input.host.runCommand(['systemctl', 'restart', 'docker'], { timeoutMs: 90_000 });
  if (restart.exitCode !== 0) {
    return failedDockerOp({
      notes: [tl('docker.errors.engineFailed'), restart.stderr.trim()],
      written: w.written,
    });
  }
  return appliedDockerOp({ notes: [...w.notes, tl('docker.notes.engine.restart')], written: w.written });
}
