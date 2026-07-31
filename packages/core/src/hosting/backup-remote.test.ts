import { describe, expect, it, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { openDatabase, closeDatabase } from '../db/database.js';
import { makeHost } from '../test/host.js';
import {
  getBackupExclusions,
  getBackupRemote,
  getBackupRemotePublic,
  pushBackupRemote,
  setBackupExclusions,
  setBackupRemote,
} from './backup-remote.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(executeEnabled = false) {
  const { host, dir, cleanup } = makeHost({ executeEnabled });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  return { host, dir, db };
}

function mockHost(opts: {
  executeEnabled?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled === true,
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
      const partial = opts.run?.(argv) ?? {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
  };
}

describe('backup-remote settings', () => {
  it('defaults and public masking for secrets', () => {
    const { db } = setup();
    const def = getBackupRemote(db);
    expect(def.enabled).toBe(false);
    expect(def.kind).toBe('sftp');

    const pub = setBackupRemote(db, {
      enabled: true,
      kind: 'sftp',
      host: 'backup.example.com',
      username: 'ysk',
      path: '/backups',
      password: 'super-secret',
      awsSecretAccessKey: 'aws-secret',
    });
    expect(pub.password).toBe('***');
    expect(pub.awsSecretAccessKey).toBe('***');
    expect(pub.host).toBe('backup.example.com');

    // empty / *** patch keeps previous secret
    setBackupRemote(db, { password: '' });
    setBackupRemote(db, { password: '***' });
    const internal = getBackupRemote(db);
    expect(internal.password).toBe('super-secret');
    expect(getBackupRemotePublic(db).password).toBe('***');
  });

  it('setBackupExclusions trims and persists', () => {
    const { db } = setup();
    const list = setBackupExclusions(db, ['  node_modules  ', '', '*.tmp']);
    expect(list).toEqual(['node_modules', '*.tmp']);
    expect(getBackupExclusions(db)).toEqual(['node_modules', '*.tmp']);
  });
});

describe('pushBackupRemote honesty', () => {
  it('skips when disabled', async () => {
    const { host, db, dir } = setup(false);
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'data');
    const r = await pushBackupRemote({
      host,
      db,
      localArchivePath: archive,
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('fails when archive missing', async () => {
    const { host, db, dir } = setup(true);
    setBackupRemote(db, { enabled: true, kind: 'local', path: join(dir, 'remote') });
    const r = await pushBackupRemote({
      host,
      db,
      localArchivePath: join(dir, 'missing.tgz'),
    });
    expect(r.ok).toBe(false);
  });

  it('blocks when execute disabled even if remote enabled', async () => {
    const { host, db, dir } = setup(false);
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'data');
    setBackupRemote(db, {
      enabled: true,
      kind: 'local',
      path: join(dir, 'remote-out'),
    });
    const r = await pushBackupRemote({ host, db, localArchivePath: archive });
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('local kind copies when execute enabled', async () => {
    const { dir, cleanup } = makeHost({ executeEnabled: true });
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'payload');
    const dest = join(dir, 'remote-out');
    setBackupRemote(db, { enabled: true, kind: 'local', path: dest });

    const host = mockHost({
      executeEnabled: true,
      run: (argv) => {
        // simulate success without actually needing root
        if (argv[0] === 'bash') return { exitCode: 0, stdout: 'ok' };
        return {};
      },
    });
    const r = await pushBackupRemote({ host, db, localArchivePath: archive });
    expect(r.ok).toBe(true);
  });

  it('sftp incomplete settings fail closed', async () => {
    const host = mockHost({ executeEnabled: true });
    const { db, dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const store = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(store));
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'x');
    setBackupRemote(store, {
      enabled: true,
      kind: 'sftp',
      host: '',
      username: '',
      path: '',
    });
    const r = await pushBackupRemote({
      host,
      db: store,
      localArchivePath: archive,
    });
    expect(r.ok).toBe(false);
  });

  it('s3 without aws cli reports need cli', async () => {
    const host = mockHost({
      executeEnabled: true,
      run: () => ({ exitCode: 0, stdout: 'NEED_AWS_CLI\n' }),
    });
    const { db, dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const store = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(store));
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'x');
    setBackupRemote(store, {
      enabled: true,
      kind: 's3',
      s3Bucket: 'my-bucket',
      s3Region: 'us-east-1',
    });
    const r = await pushBackupRemote({
      host,
      db: store,
      localArchivePath: archive,
    });
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('scp path without password uses BatchMode scp', async () => {
    const calls: string[][] = [];
    const host = mockHost({
      executeEnabled: true,
      run: (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: '' };
      },
    });
    const { db, dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const store = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(store));
    const archive = join(dir, 'a.tgz');
    writeFileSync(archive, 'x');
    setBackupRemote(store, {
      enabled: true,
      kind: 'sftp',
      host: 'b.example.com',
      username: 'ysk',
      path: '/backups',
      port: 2222,
      password: undefined,
    });
    // clear password if any
    store.snapshot.backup_remote = {
      ...getBackupRemote(store),
      password: undefined,
    };
    store.persist();

    const r = await pushBackupRemote({
      host,
      db: store,
      localArchivePath: archive,
    });
    expect(r.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'scp' && a.includes('2222'))).toBe(true);
  });
});
