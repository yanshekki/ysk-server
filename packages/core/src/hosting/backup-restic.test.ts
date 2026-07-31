import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import {
  getResticSettings,
  getResticSettingsPublic,
  resticBackupProject,
  setResticSettings,
  listResticSnapshots,
  resticRestoreProject,
  RESTIC_OVERWRITE_CONFIRM,
} from './backup-restic.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function mockHost(opts: {
  execute?: boolean;
  resticOut?: string;
  resticExit?: number;
  hasRestic?: boolean;
  failCmd?: string;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => true,
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
    runCommand: async (argv) => {
      const j = argv.join(' ');
      if (j.includes('command -v restic')) {
        return {
          stdout: opts.hasRestic === false ? '' : '/usr/bin/restic',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (opts.failCmd && j.includes(opts.failCmd)) {
        return {
          stdout: '',
          stderr: 'boom',
          exitCode: 1,
          argv,
          dryRun: false,
        };
      }
      return {
        stdout: opts.resticOut ?? 'snapshot abcd1234 saved\n',
        stderr: '',
        exitCode: opts.resticExit ?? 0,
        argv,
        dryRun: false,
      };
    },
  };
}

describe('backup-restic honesty', () => {
  it('disabled → skipped not fake success for operators', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const r = await resticBackupProject({
      host: mockHost({ execute: false }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(r.skipped).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('settings get/set masks secrets and keeps *** password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-set-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.settings.restic_settings = 'not-json';
    expect(getResticSettings(store).enabled).toBe(false);

    setResticSettings(store, {
      enabled: true,
      password: 's3cret',
      awsSecretAccessKey: 'awskey',
      awsAccessKeyId: 'AKIA',
      s3Repo: 's3:s3.amazonaws.com/b/p',
    });
    const pub = getResticSettingsPublic(store);
    expect(pub.password).toBe('***');
    expect(pub.awsSecretAccessKey).toBe('***');
    expect(getResticSettings(store).password).toBe('s3cret');

    // preserve secrets when patch uses ***
    setResticSettings(store, { password: '***', awsSecretAccessKey: '***', enabled: true });
    expect(getResticSettings(store).password).toBe('s3cret');
  });

  it('enabled without password fails closed; blocked without execute; missing restic', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-pw-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.settings.restic_settings = JSON.stringify({
      enabled: true,
      repoPath: join(dir, 'repo'),
    });
    store.persist();
    expect(getResticSettings(store).password).toBeFalsy();

    const noPw = await resticBackupProject({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(noPw.ok).toBe(false);

    setResticSettings(store, { enabled: true, password: 'pw' });
    const blocked = await resticBackupProject({
      host: mockHost({ execute: false }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(blocked.blocked).toBe(true);

    const noBin = await resticBackupProject({
      host: mockHost({ execute: true, hasRestic: false }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: join(dir, 'home'),
    });
    expect(noBin.ok).toBe(false);
  });

  it('successful backup writes last-restic.json; missing home fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-ok-'));
    dirs.push(dir);
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'a.txt'), 'x');
    const store = new JsonStore(join(dir, 'ysk.json'));
    setResticSettings(store, {
      enabled: true,
      password: 'pw',
      repoPath: join(dir, 'repo'),
      s3Repo: 's3:s3.amazonaws.com/b/p',
      awsAccessKeyId: 'AKIA',
      awsSecretAccessKey: 'secret',
    });

    const r = await resticBackupProject({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: home,
    });
    expect(r.ok).toBe(true);
    expect(r.snapshotId).toBe('abcd1234');
    expect(existsSync(join(dir, 'backups', 'p1', 'last-restic.json'))).toBe(true);

    const miss = await resticBackupProject({
      host: mockHost({ execute: true }),
      dataDir: dir,
      db: store,
      projectId: 'p2',
      homeDir: join(dir, 'no-home'),
    });
    expect(miss.ok).toBe(false);

    const fail = await resticBackupProject({
      host: mockHost({ execute: true, resticExit: 1, resticOut: 'err' }),
      dataDir: dir,
      db: store,
      projectId: 'p1',
      homeDir: home,
    });
    expect(fail.ok).toBe(false);
  });

  it('listResticSnapshots covers gates and JSON parse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-ls-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));

    expect((await listResticSnapshots({ host: mockHost({}), db: store, dataDir: dir })).ok).toBe(
      false,
    );

    setResticSettings(store, { enabled: true, password: '' });
    store.snapshot.settings.restic_settings = JSON.stringify({ enabled: true });
    store.persist();
    expect(
      (await listResticSnapshots({ host: mockHost({ execute: true }), db: store, dataDir: dir }))
        .ok,
    ).toBe(false);

    setResticSettings(store, { enabled: true, password: 'pw' });
    expect(
      (
        await listResticSnapshots({
          host: mockHost({ execute: false }),
          db: store,
          dataDir: dir,
        })
      ).blocked,
    ).toBe(true);
    expect(
      (
        await listResticSnapshots({
          host: mockHost({ execute: true, hasRestic: false }),
          db: store,
          dataDir: dir,
        })
      ).ok,
    ).toBe(false);

    const ok = await listResticSnapshots({
      host: mockHost({
        execute: true,
        resticOut: JSON.stringify([
          {
            short_id: 'abc',
            time: 't',
            hostname: 'h',
            tags: ['project:p1'],
            paths: ['/x'],
          },
        ]),
      }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
    });
    expect(ok.ok).toBe(true);
    expect(ok.snapshots).toHaveLength(1);
    expect(ok.snapshots[0].id).toBe('abc');

    const badJson = await listResticSnapshots({
      host: mockHost({ execute: true, resticOut: 'not-json' }),
      db: store,
      dataDir: dir,
    });
    expect(badJson.ok).toBe(false);
  });

  it('resticRestoreProject dry-run, overwrite gates, and restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-restic-rs-'));
    dirs.push(dir);
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const store = new JsonStore(join(dir, 'ysk.json'));

    expect(
      (
        await resticRestoreProject({
          host: mockHost({}),
          db: store,
          dataDir: dir,
          projectId: 'p1',
          homeDir: home,
          snapshotId: 'abc',
        })
      ).ok,
    ).toBe(false);

    setResticSettings(store, { enabled: true, password: 'pw' });
    expect(
      (
        await resticRestoreProject({
          host: mockHost({ execute: false }),
          db: store,
          dataDir: dir,
          projectId: 'p1',
          homeDir: home,
          snapshotId: 'abc',
        })
      ).blocked,
    ).toBe(true);

    expect(
      (
        await resticRestoreProject({
          host: mockHost({ execute: true }),
          db: store,
          dataDir: dir,
          projectId: 'p1',
          homeDir: home,
          snapshotId: '!!!',
        })
      ).ok,
    ).toBe(false);

    expect(
      (
        await resticRestoreProject({
          host: mockHost({ execute: true }),
          db: store,
          dataDir: dir,
          projectId: 'p1',
          homeDir: home,
          snapshotId: 'deadbeef',
          overwriteHome: true,
          confirmPhrase: 'NOPE',
        })
      ).blocked,
    ).toBe(true);

    expect(
      (
        await resticRestoreProject({
          host: mockHost({ execute: true, hasRestic: false }),
          db: store,
          dataDir: dir,
          projectId: 'p1',
          homeDir: home,
          snapshotId: 'deadbeef',
        })
      ).ok,
    ).toBe(false);

    const dry = await resticRestoreProject({
      host: mockHost({ execute: true, resticOut: '/data/a\n/data/b\n' }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef',
      dryRun: true,
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect((dry.paths ?? []).length).toBeGreaterThan(0);

    const dryFail = await resticRestoreProject({
      host: mockHost({ execute: true, resticExit: 1 }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef',
      dryRun: true,
    });
    expect(dryFail.ok).toBe(false);

    // target == home without overwrite refused
    const refuse = await resticRestoreProject({
      host: mockHost({ execute: true }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef',
      targetDir: home,
    });
    expect(refuse.ok).toBe(false);

    const ok = await resticRestoreProject({
      host: mockHost({ execute: true }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef01',
    });
    expect(ok.ok).toBe(true);
    expect(ok.targetDir).toContain('.restic-restore');

    const over = await resticRestoreProject({
      host: mockHost({ execute: true }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef01',
      overwriteHome: true,
      confirmPhrase: RESTIC_OVERWRITE_CONFIRM,
    });
    expect(over.ok).toBe(true);
    expect(over.targetDir).toBe(home);

    const fail = await resticRestoreProject({
      host: mockHost({ execute: true, resticExit: 2 }),
      db: store,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
      snapshotId: 'deadbeef01',
    });
    expect(fail.ok).toBe(false);
  });
});
