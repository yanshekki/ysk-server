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
} from './transport.js';

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  onCommand?: (argv: string[]) => RunResult;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => opts.root ?? false,
    executeEnabled: () => opts.execute ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      if (opts.onCommand) return opts.onCommand(argv);
      return { ...empty(), argv, exitCode: 0, stdout: 'ok' };
    },
  };
}

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

describe('parseMigrateTarget', () => {
  it('parses user@host:port', () => {
    expect(parseMigrateTarget('root@203.0.113.10:2222')).toEqual({
      user: 'root',
      host: '203.0.113.10',
      port: 2222,
    });
  });

  it('port override wins', () => {
    expect(parseMigrateTarget('root@h.example', 2200)?.port).toBe(2200);
  });
});

describe('resolveMigrateAuth / build argv', () => {
  it('identity file missing → fail', () => {
    const r = resolveMigrateAuth({
      kind: 'identity',
      privateKeyPath: '/no/such/key',
    });
    expect(r.ok).toBe(false);
  });

  it('builds ssh with key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-t-'));
    const key = join(dir, 'id');
    writeFileSync(key, 'fake', { mode: 0o600 });
    const auth = resolveMigrateAuth({ kind: 'identity', privateKeyPath: key });
    expect(auth.ok).toBe(true);
    const built = buildSshArgv(
      { host: '10.0.0.1', port: 22, user: 'root' },
      auth,
      'echo hi',
    );
    expect(built.ok).toBe(true);
    expect(built.argv[0]).toBe('ssh');
    expect(built.argv).toContain('-i');
    expect(built.argv).toContain(key);
    rmSync(dir, { recursive: true, force: true });
  });

  it('password mode needs sshpass wrapper', () => {
    const auth = resolveMigrateAuth({ kind: 'password', password: 's3cret' });
    const built = buildSshArgv(
      { host: 'h', port: 22, user: 'root' },
      auth,
      'id',
    );
    expect(built.ok).toBe(true);
    expect(built.argv[0]).toBe('bash');
    expect(String(built.argv[2])).toContain('sshpass');
  });

  it('rsync argv includes numeric-ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-t-'));
    const key = join(dir, 'id');
    writeFileSync(key, 'k', { mode: 0o600 });
    const auth = resolveMigrateAuth({ kind: 'identity', privateKeyPath: key });
    const built = buildRsyncArgv(
      { host: 'h', port: 22, user: 'root' },
      auth,
      '/var/lib/ysk-server',
      '/var/lib/ysk-server',
    );
    expect(built.argv).toContain('rsync');
    expect(built.argv).toContain('-aHAX');
    expect(built.argv).toContain('--numeric-ids');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('runSshCommand honesty', () => {
  it('blocks without EXECUTE', async () => {
    const r = await runSshCommand({
      host: mockHost({ execute: false }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      remoteCommand: 'true',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
  });

  it('ok when remote exits 0', async () => {
    const r = await runSshCommand({
      host: mockHost({
        execute: true,
        onCommand: (argv) => ({
          ...empty(),
          argv,
          exitCode: 0,
          stdout: 'hello',
        }),
      }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      remoteCommand: 'echo hello',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
  });

  it('failed when remote exits non-zero', async () => {
    const r = await runSshCommand({
      host: mockHost({
        execute: true,
        onCommand: () => ({
          ...empty(),
          exitCode: 255,
          stderr: 'Permission denied',
        }),
      }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      remoteCommand: 'true',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBeFalsy();
    expect(r.apply_status).toBe('failed');
  });

  it('blocks when sshpass missing for password', async () => {
    const r = await runSshCommand({
      host: mockHost({
        execute: true,
        onCommand: () => ({
          ...empty(),
          exitCode: 2,
          stdout: 'YSK_NEED_SSHPASS',
        }),
      }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'password', password: 'x' },
      remoteCommand: 'id',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });
});

describe('rsyncToRemote', () => {
  it('blocks without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rs-'));
    const r = await rsyncToRemote({
      host: mockHost({ execute: false }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      localPath: dir,
      remotePath: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
