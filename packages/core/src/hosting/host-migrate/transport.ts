/**
 * SSH / rsync transport for host migrate.
 * Reuses identity vault patterns; never persists passwords.
 */

import { existsSync } from 'node:fs';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { OpsResultDto } from '@ysk-server/shared';
import { assertHonestOps, tl} from '@ysk-server/shared';
import {
  buildIdentityFileOpts,
  parseSshTarget,
  resolveIdentityKeyPath } from '../../security/ssh-identity/ops.js';
import { shellRequireBin } from '../software-probe/index.js';

export type MigrateSshAuth =
  | { kind: 'identity'; privateKeyPath: string }
  | { kind: 'identityId'; dataDir: string; identityId: string }
  | { kind: 'password'; password: string }
  | { kind: 'agent' }; // default keys / agent, BatchMode

export type MigrateSshEndpoint = {
  host: string;
  port: number;
  user: string;
};

export type ResolvedSshAuth = {
  ok: boolean;
  privateKeyPath?: string;
  password?: string;
  notes: string[];
  blocked?: boolean;
  blockMessage?: string;
};

/** Parse root@host[:port] */
export function parseMigrateTarget(
  target: string,
  portOverride?: number,
): MigrateSshEndpoint | null {
  const p = parseSshTarget(target);
  if (!p) return null;
  return {
    user: p.user,
    host: p.host,
    port: portOverride && portOverride > 0 ? portOverride : p.port };
}

export function userAtHost(ep: MigrateSshEndpoint): string {
  return `${ep.user}@${ep.host}`;
}

/**
 * Resolve auth material for outbound SSH.
 * identityId → vault path; password kept in memory only.
 */
export function resolveMigrateAuth(auth: MigrateSshAuth): ResolvedSshAuth {
  if (auth.kind === 'identity') {
    if (!existsSync(auth.privateKeyPath)) {
      return {
        ok: false,
        notes: [tl('notes.auto.t0666', { v0: (auth.privateKeyPath) })] };
    }
    return {
      ok: true,
      privateKeyPath: auth.privateKeyPath,
      notes: [`using key ${auth.privateKeyPath}`] };
  }
  if (auth.kind === 'identityId') {
    const key = resolveIdentityKeyPath(auth.dataDir, auth.identityId);
    if (!key.ok || !key.path) {
      return {
        ok: false,
        notes: key.notes.length ? key.notes : [tl('notes.auto.t0667', { v0: (auth.identityId) })] };
    }
    return {
      ok: true,
      privateKeyPath: key.path,
      notes: key.notes };
  }
  if (auth.kind === 'password') {
    if (!auth.password) {
      return { ok: false, notes: [tl('notes.auto.n0664')] };
    }
    return {
      ok: true,
      password: auth.password,
      notes: ['using password (sshpass; not stored)'] };
  }
  return {
    ok: true,
    notes: ['using default agent/keys (BatchMode)'] };
}

/** SSH options common to key-based auth */
export function sshKeyOpts(privateKeyPath: string, port: number): string[] {
  return [
    ...buildIdentityFileOpts(privateKeyPath),
    '-o',
    'ConnectTimeout=12',
    '-p',
    String(port),
  ];
}

/**
 * Build argv for: ssh [opts] user@host -- remoteCommand
 * Password mode wraps with sshpass via bash -c (caller uses runSshCommand).
 */
export function buildSshArgv(
  ep: MigrateSshEndpoint,
  auth: ResolvedSshAuth,
  remoteCommand: string,
): { ok: boolean; argv: string[]; notes: string[]; blocked?: boolean } {
  if (!auth.ok) {
    return { ok: false, argv: [], notes: auth.notes };
  }
  const target = userAtHost(ep);
  if (auth.privateKeyPath) {
    return {
      ok: true,
      argv: [
        'ssh',
        ...sshKeyOpts(auth.privateKeyPath, ep.port),
        target,
        '--',
        remoteCommand,
      ],
      notes: auth.notes };
  }
  if (auth.password) {
    // sshpass + ssh; password via env SSHPASS safer than -p on cmdline in some cases,
    // but HostExecutor may not pass env — use sshpass -p with JSON-quoted password in bash.
    const pw = JSON.stringify(auth.password);
    const remote = JSON.stringify(remoteCommand);
    const script = [
      `${shellRequireBin('sshpass', 'YSK_NEED_SSHPASS')}`,
      `SSHPASS=${pw} sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 -p ${ep.port} ${JSON.stringify(target)} -- ${remote}`,
    ].join(' && ');
    return {
      ok: true,
      argv: ['bash', '-c', script],
      notes: [...auth.notes, 'sshpass required for password auth'] };
  }
  // agent
  return {
    ok: true,
    argv: [
      'ssh',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=12',
      '-p',
      String(ep.port),
      target,
      '--',
      remoteCommand,
    ],
    notes: auth.notes };
}

/**
 * rsync -aHAX --numeric-ids -e "ssh ..." local/ remote:dest/
 */
export function buildRsyncArgv(
  ep: MigrateSshEndpoint,
  auth: ResolvedSshAuth,
  localPath: string,
  remotePath: string,
  opts?: { delete?: boolean; dryRun?: boolean },
): { ok: boolean; argv: string[]; notes: string[] } {
  if (!auth.ok) {
    return { ok: false, argv: [], notes: auth.notes };
  }
  const target = userAtHost(ep);
  const remoteSpec = `${target}:${remotePath.replace(/\/?$/, '/')}`;
  const local = localPath.endsWith('/') ? localPath : `${localPath}/`;

  let sshCmd: string;
  if (auth.privateKeyPath) {
    sshCmd = [
      'ssh',
      `-i ${JSON.stringify(auth.privateKeyPath)}`,
      '-o IdentitiesOnly=yes',
      '-o BatchMode=yes',
      '-o StrictHostKeyChecking=accept-new',
      `-o ConnectTimeout=12`,
      `-p ${ep.port}`,
    ].join(' ');
  } else if (auth.password) {
    const pw = JSON.stringify(auth.password);
    sshCmd = `sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 -p ${ep.port}`;
    // Will set SSHPASS in bash wrapper
    const rsyncArgs = [
      'rsync',
      '-aHAX',
      '--numeric-ids',
      '--info=progress2',
      ...(opts?.delete ? ['--delete'] : []),
      ...(opts?.dryRun ? ['--dry-run'] : []),
      '-e',
      sshCmd,
      local,
      remoteSpec,
    ];
    const script = [
      `${shellRequireBin('sshpass', 'YSK_NEED_SSHPASS')}`,
      `${shellRequireBin('rsync', 'YSK_NEED_RSYNC')}`,
      `export SSHPASS=${pw}`,
      rsyncArgs.map((a) => JSON.stringify(a)).join(' '),
    ].join(' && ');
    return {
      ok: true,
      argv: ['bash', '-c', script],
      notes: [...auth.notes, 'rsync via sshpass'] };
  } else {
    sshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12 -p ${ep.port}`;
  }

  const argv = [
    'rsync',
    '-aHAX',
    '--numeric-ids',
    '--info=progress2',
    ...(opts?.delete ? ['--delete'] : []),
    ...(opts?.dryRun ? ['--dry-run'] : []),
    '-e',
    sshCmd,
    local,
    remoteSpec,
  ];
  return { ok: true, argv, notes: auth.notes };
}

export type SshCommandResult = OpsResultDto & {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function needToolNote(out: string): string | undefined {
  if (out.includes('YSK_NEED_SSHPASS')) return tl('notes.auto.n1279');
  if (out.includes('YSK_NEED_RSYNC')) return tl('notes.auto.n0547');
  return undefined;
}

/**
 * Run remote command over SSH. Requires YSK_EXECUTE on source host.
 */
export async function runSshCommand(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  remoteCommand: string;
  timeoutMs?: number;
  /** Allow dry connection check without full execute? still needs execute for real ssh */
  name?: string;
}): Promise<SshCommandResult> {
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n0530'),
      notes: [tl('notes.auto.n0187')],
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const resolved = resolveMigrateAuth(input.auth);
  if (!resolved.ok) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: resolved.notes,
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const built = buildSshArgv(input.endpoint, resolved, input.remoteCommand);
  if (!built.ok) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: built.notes,
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const r = await input.host.runCommand(built.argv, {
    timeoutMs: input.timeoutMs ?? 60_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const tool = needToolNote(out);
  if (tool) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      blockMessage: tool,
      notes: [tool, ...built.notes],
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode }) as SshCommandResult;
  }

  const ok = r.exitCode === 0;
  return assertHonestOps({
    ok,
    apply_status: ok ? 'applied' : 'failed',
    notes: [
      ok
        ? `SSH ok ${userAtHost(input.endpoint)}`
        : tl('notes.auto.t0668', { v0: (r.exitCode), v1: (out.slice(0, 400)) }),
      ...built.notes,
    ],
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode }) as SshCommandResult;
}

/**
 * Rsync local directory tree to remote path.
 */
export async function rsyncToRemote(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  localPath: string;
  remotePath: string;
  delete?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
}): Promise<SshCommandResult> {
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n0036'),
      notes: [tl('notes.auto.n0422')],
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }
  if (!existsSync(input.localPath)) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [tl('notes.auto.t0669', { v0: (input.localPath) })],
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const resolved = resolveMigrateAuth(input.auth);
  if (!resolved.ok) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: resolved.notes,
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const built = buildRsyncArgv(
    input.endpoint,
    resolved,
    input.localPath,
    input.remotePath,
    { delete: input.delete, dryRun: input.dryRun },
  );
  if (!built.ok) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: built.notes,
      stdout: '',
      stderr: '',
      exitCode: -1 }) as SshCommandResult;
  }

  const r = await input.host.runCommand(built.argv, {
    timeoutMs: input.timeoutMs ?? 3_600_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const tool = needToolNote(out);
  if (tool) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      blockMessage: tool,
      notes: [tool],
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode }) as SshCommandResult;
  }
  const ok = r.exitCode === 0;
  return assertHonestOps({
    ok,
    apply_status: ok ? (input.dryRun ? 'written' : 'applied') : 'failed',
    notes: [
      ok
        ? `rsync ${input.dryRun ? 'dry-run ' : ''}${input.localPath} → ${userAtHost(input.endpoint)}:${input.remotePath}`
        : tl('notes.auto.t0670', { v0: (r.exitCode), v1: (out.slice(0, 400)) }),
      ...built.notes,
    ],
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode }) as SshCommandResult;
}

/** Exported for tests */
export function summarizeRunResult(r: RunResult): string {
  return `exit=${r.exitCode} ${(r.stderr || r.stdout || '').slice(0, 200)}`;
}
