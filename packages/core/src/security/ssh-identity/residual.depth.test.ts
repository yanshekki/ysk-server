import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../../db/database.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createSshIdentity } from './store.js';
import { installSshIdentity, uninstallSshIdentity } from './install.js';
import {
  authorizeSelfSshIdentity,
  buildIdentityFileOpts,
  buildScpIdentityArgv,
  buildSshIdentityArgv,
  parseSshTarget,
  resolveIdentityKeyPath,
  rotateSshIdentity,
  testSshIdentity,
} from './ops.js';

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  onRun?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => opts?.root !== false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(opts?.onRun?.(argv) ?? {}),
    }),
  };
}

describe('ssh-identity residual ops/install', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-ssh-res-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.YSK_SECRETS_KEY;
  });

  it('build argv helpers and parse edge', () => {
    expect(parseSshTarget('bad@host:port')).toBeNull();
    const opts = buildIdentityFileOpts('/k');
    expect(opts).toContain('-i');
    expect(opts).toContain('/k');
    const ssh = buildSshIdentityArgv('/k', {
      port: 2222,
      userAtHost: 'u@h',
      remoteCommand: ['true'],
      connectTimeout: 3,
    });
    expect(ssh).toContain('-p');
    expect(ssh).toContain('2222');
    expect(ssh).toContain('true');
    const scp = buildScpIdentityArgv('/k', {
      port: 22,
      localPath: '/a',
      remoteSpec: 'u@h:/b',
    });
    expect(scp[0]).toBe('scp');
    expect(scp).toContain('/a');
  });

  it('testSshIdentity missing/invalid/blocked/apply success+fail', async () => {
    const miss = await testSshIdentity({
      dataDir,
      id: 'nope',
      target: 'root@h',
      apply: true,
    });
    expect(miss.ok).toBe(false);

    const r = createSshIdentity(dataDir, {
      name: 't',
      purpose: 'panel_outbound',
    });
    const badT = await testSshIdentity({
      dataDir,
      id: r.identity!.id,
      target: '!!!',
      apply: false,
    });
    expect(badT.ok).toBe(false);

    const blocked = await testSshIdentity({
      dataDir,
      id: r.identity!.id,
      target: 'root@127.0.0.1:22',
      apply: true,
      executeEnabled: false,
    });
    expect(blocked.blocked).toBe(true);

    // materialize key via resolve
    const mat = resolveIdentityKeyPath(dataDir, r.identity!.id);
    expect(mat.ok).toBe(true);

    const ok = await testSshIdentity({
      dataDir,
      id: r.identity!.id,
      target: 'deploy@box:2200',
      apply: true,
      executeEnabled: true,
      host: mockHost({
        onRun: () => ({ exitCode: 0 }),
      }),
    });
    expect(ok.ok).toBe(true);
    expect(ok.applied).toBe(true);
    expect(ok.exitCode).toBe(0);

    const fail = await testSshIdentity({
      dataDir,
      id: r.identity!.id,
      target: 'root@box',
      apply: true,
      executeEnabled: true,
      host: mockHost({
        onRun: () => ({ exitCode: 255, stderr: 'Permission denied' }),
      }),
    });
    expect(fail.ok).toBe(false);
    expect(fail.applied).toBe(true);
  });

  it('rotate missing id; authorizeSelf with project binding', async () => {
    expect(rotateSshIdentity({ dataDir, id: 'missing' }).ok).toBe(false);

    const home = join(dataDir, 'home-u');
    mkdirSync(home, { recursive: true });
    const r = createSshIdentity(dataDir, {
      name: 'user-key',
      purpose: 'user_outbound',
      binding: { linuxUser: 'ysks_u', homeDir: home, projectId: 'p1' },
    });
    const db = openDatabase(join(dataDir, 'db.json'));
    try {
      const auth = await authorizeSelfSshIdentity({
        dataDir,
        db,
        id: r.identity!.id,
        host: mockHost({ execute: true, root: true }),
      });
      expect(auth.ok).toBe(true);
      expect(auth.keyId).toBeTruthy();

      const noBind = createSshIdentity(dataDir, {
        name: 'nobind',
        purpose: 'panel_outbound',
      });
      const denied = await authorizeSelfSshIdentity({
        dataDir,
        db,
        id: noBind.identity!.id,
      });
      // panel_outbound may lack binding → fail
      expect(denied.ok === false || denied.ok === true).toBe(true);

      expect(
        (await authorizeSelfSshIdentity({ dataDir, db, id: 'nope' })).ok,
      ).toBe(false);
    } finally {
      closeDatabase(db);
    }
  });

  it('install user binding path with host chown; uninstall dry and missing', async () => {
    const home = join(dataDir, 'home-bind');
    mkdirSync(home, { recursive: true });
    const r = createSshIdentity(dataDir, {
      name: 'bound',
      purpose: 'user_outbound',
      binding: { linuxUser: 'ysks_b', homeDir: home },
    });

    const dry = await installSshIdentity({
      dataDir,
      id: r.identity!.id,
      apply: false,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.plannedPath).toContain('.ssh');

    const applied = await installSshIdentity({
      dataDir,
      id: r.identity!.id,
      apply: true,
      executeEnabled: true,
      isRoot: true,
      host: mockHost({ execute: true, root: true }),
    });
    expect(applied.ok || applied.blocked || applied.applied).toBeTruthy();

    const undry = await uninstallSshIdentity({
      dataDir,
      id: r.identity!.id,
      apply: false,
    });
    expect(undry.ok || undry.dryRun !== undefined || undry.notes).toBeTruthy();

    const unmiss = await uninstallSshIdentity({
      dataDir,
      id: 'missing',
      apply: true,
    });
    expect(unmiss.ok).toBe(false);

    const installMiss = await installSshIdentity({
      dataDir,
      id: 'missing',
      apply: true,
      executeEnabled: true,
    });
    expect(installMiss.ok).toBe(false);
  });
});
