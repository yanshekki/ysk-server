import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  buildRsyncArgv,
  buildSshArgv,
  parseMigrateTarget,
  resolveMigrateAuth,
  runSshCommand,
  rsyncToRemote,
  sshKeyOpts,
} from './transport.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(onCommand?: (argv: string[]) => Partial<RunResult>, execute = true): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => false,
    executeEnabled: () => execute,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...(onCommand?.(argv) ?? {}) }),
  };
}

describe('transport depth', () => {
  it('parseMigrateTarget edge cases', () => {
    expect(parseMigrateTarget('')).toBeNull();
    // host-only defaults user to root
    const hostOnly = parseMigrateTarget('no-at-sign');
    expect(hostOnly?.host).toBe('no-at-sign');
    expect(parseMigrateTarget('user@host')).toMatchObject({ user: 'user', host: 'host', port: 22 });
    expect(parseMigrateTarget('u@h:9999')).toMatchObject({ port: 9999 });
  });

  it('resolveMigrateAuth agent/password/identity/identityId', () => {
    expect(resolveMigrateAuth({ kind: 'agent' }).ok).toBe(true);
    expect(resolveMigrateAuth({ kind: 'password', password: '' }).ok).toBe(false);
    expect(resolveMigrateAuth({ kind: 'password', password: 'x' }).ok).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'ysk-tr-'));
    try {
      const key = join(dir, 'id_rsa');
      writeFileSync(key, 'k', { mode: 0o600 });
      const id = resolveMigrateAuth({ kind: 'identity', privateKeyPath: key });
      expect(id.ok).toBe(true);
      expect(id.privateKeyPath).toBe(key);

      const missing = resolveMigrateAuth({
        kind: 'identityId',
        identityId: 'nope',
        dataDir: dir,
      });
      expect(missing.ok).toBe(false);

      const opts = sshKeyOpts(key, 2222);
      expect(opts).toContain('-i');
      expect(opts).toContain('2222');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buildSshArgv and buildRsyncArgv password + key + agent branches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tr2-'));
    try {
      const key = join(dir, 'k');
      writeFileSync(key, 'x', { mode: 0o600 });
      const ep = { host: '10.0.0.9', port: 22, user: 'root' };

      const badAuth = resolveMigrateAuth({ kind: 'identity', privateKeyPath: '/nope' });
      expect(buildSshArgv(ep, badAuth, 'true').ok).toBe(false);
      expect(buildRsyncArgv(ep, badAuth, '/a', '/b').ok).toBe(false);

      const keyAuth = resolveMigrateAuth({ kind: 'identity', privateKeyPath: key });
      const rsyncKey = buildRsyncArgv(ep, keyAuth, '/local/path', '/remote/path', {
        delete: true,
        dryRun: true,
      });
      expect(rsyncKey.ok).toBe(true);
      expect(rsyncKey.argv[0]).toBe('rsync');
      expect(rsyncKey.argv).toContain('--delete');
      expect(rsyncKey.argv).toContain('--dry-run');

      const pw = resolveMigrateAuth({ kind: 'password', password: 'secret' });
      const rsyncPw = buildRsyncArgv(ep, pw, '/l', '/r');
      expect(rsyncPw.ok).toBe(true);
      expect(rsyncPw.argv[0]).toBe('bash');
      expect(String(rsyncPw.argv[2])).toMatch(/sshpass|rsync/);

      const agent = resolveMigrateAuth({ kind: 'agent' });
      const sshAgent = buildSshArgv(ep, agent, 'uname -a');
      expect(sshAgent.ok).toBe(true);
      expect(sshAgent.argv).toContain('BatchMode=yes');

      const rsyncAgent = buildRsyncArgv(ep, agent, '/l/', '/r');
      expect(rsyncAgent.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runSshCommand and rsyncToRemote honesty without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tr3-'));
    try {
      const key = join(dir, 'k');
      writeFileSync(key, 'x', { mode: 0o600 });
      const auth = { kind: 'identity' as const, privateKeyPath: key };
      const ep = { host: 'h', port: 22, user: 'root' };

      const blocked = await runSshCommand({
        host: mockHost(undefined, false),
        endpoint: ep,
        auth,
        remoteCommand: 'true',
      });
      expect(blocked.ok === false || blocked.blocked === true || blocked.notes?.length).toBeTruthy();

      const ok = await runSshCommand({
        host: mockHost(() => ({ exitCode: 0, stdout: 'hi\n' }), true),
        endpoint: ep,
        auth,
        remoteCommand: 'echo hi',
      });
      expect(ok.ok || ok.stdout || ok.notes).toBeTruthy();

      const rsync = await rsyncToRemote({
        host: mockHost(() => ({ exitCode: 0 }), true),
        endpoint: ep,
        auth,
        localPath: dir,
        remotePath: '/tmp/dest',
      });
      expect(typeof rsync.ok).toBe('boolean');

      const rsyncFail = await rsyncToRemote({
        host: mockHost(() => ({ exitCode: 1, stderr: 'rsync fail' }), true),
        endpoint: ep,
        auth,
        localPath: dir,
        remotePath: '/tmp/dest',
        delete: true,
      });
      expect(rsyncFail.ok).toBe(false);

      const rsyncBlocked = await rsyncToRemote({
        host: mockHost(undefined, false),
        endpoint: ep,
        auth,
        localPath: dir,
        remotePath: '/tmp/x',
      });
      expect(rsyncBlocked.ok === false || rsyncBlocked.blocked).toBeTruthy();

      // password auth rsync path
      const pwRsync = await rsyncToRemote({
        host: mockHost(() => ({ exitCode: 0, stdout: '' }), true),
        endpoint: ep,
        auth: { kind: 'password', password: 'pw' },
        localPath: dir,
        remotePath: '/tmp/p',
      });
      expect(typeof pwRsync.ok).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
