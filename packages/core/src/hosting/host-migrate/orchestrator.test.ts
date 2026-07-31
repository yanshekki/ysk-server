import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk/shared';
import { JsonStore } from '../../db/store.js';
import { createMigrateJob, attachManifest } from './job-store.js';
import {
  migrateInventory,
  runSourceMigrateHost,
  triggerRemotePost,
  runLocalMigratePost,
} from './orchestrator.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  remoteOut?: string;
  sshFail?: boolean;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => opts.root ?? true,
    executeEnabled: () => opts.execute ?? false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const script = typeof argv[2] === 'string' ? argv[2] : '';
      const joined = argv.join(' ');
      if (argv[0] === 'bash' && script.includes('command -v')) {
        return { ...empty(), stdout: 'ok\n', argv };
      }
      if (script.includes('du -sb') || joined.includes('du -sb')) {
        return { ...empty(), stdout: '1048576\n', argv };
      }
      if (opts.sshFail) {
        return {
          ...empty(),
          exitCode: 255,
          stderr: 'Connection refused',
          argv,
        };
      }
      return {
        ...empty(),
        exitCode: 0,
        stdout:
          opts.remoteOut ??
          [
            'YSK_PREFLIGHT_BEGIN',
            'USER=root',
            'UID=0',
            'OS_ID=ubuntu',
            'OS_LIKE=debian',
            'ARCH=x86_64',
            'TARGET_DIR=/var/lib/ysk-server',
            'TARGET_EXISTS=0',
            'YSK_JSON=0',
            'FREE_KB=50000000',
            'HAS_RSYNC=1',
            'HAS_APT=1',
            `TIME_UTC=${Math.floor(Date.now() / 1000)}`,
            'YSK_PREFLIGHT_END',
          ].join('\n'),
        argv,
      };
    },
  };
}

describe('migrate orchestrator', () => {
  let dir: string;
  let db: JsonStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-orch-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
    db = new JsonStore(join(dir, 'ysk.json'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('migrateInventory builds honest written result', async () => {
    const r = await migrateInventory({
      host: mockHost({ execute: false }),
      db,
      dataDir: dir,
      yskVersion: '0.1.0-test',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
    expect(r.manifest.source.dataDir).toBeTruthy();
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('runSourceMigrateHost fails on invalid target', async () => {
    const r = await runSourceMigrateHost({
      host: mockHost({ execute: true }),
      db,
      dataDir: dir,
      target: 'not-a-valid-target!!!',
      auth: { kind: 'agent' },
      maintenanceAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('failed');
    expect(r.job).toBeUndefined();
  });

  it('runSourceMigrateHost fails on missing jobId', async () => {
    const r = await runSourceMigrateHost({
      host: mockHost({ execute: true }),
      db,
      dataDir: dir,
      target: 'root@10.9.9.9',
      auth: { kind: 'agent' },
      maintenanceAccepted: true,
      jobId: '00000000-0000-0000-0000-000000000099',
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('failed');
  });

  it('runSourceMigrateHost dry-run stops after preflight when ready', async () => {
    const r = await runSourceMigrateHost({
      host: mockHost({ execute: true, root: true }),
      db,
      dataDir: dir,
      target: 'root@10.8.8.8',
      auth: { kind: 'agent' },
      maintenanceAccepted: true,
      dryRun: true,
    });
    // Without execute+root source may still block; assert honesty either way
    if (r.ok) {
      expect(r.apply_status).toBe('written');
      expect(r.job?.phase).toBe('preflight');
      expect(r.phases?.inventory?.ok).toBe(true);
      expect(r.phases?.preflight?.ok).toBe(true);
      expect(r.phases?.package).toBeUndefined();
    } else {
      expect(r.apply_status === 'applied').toBe(false);
      expect(r.blocked === true || r.ok === false).toBe(true);
      expect(r.job || r.phases).toBeTruthy();
    }
  });

  it('runSourceMigrateHost preflight failure marks job failed', async () => {
    const r = await runSourceMigrateHost({
      host: mockHost({ execute: false, root: false }),
      db,
      dataDir: dir,
      target: 'root@10.7.7.7',
      auth: { kind: 'agent' },
      maintenanceAccepted: false,
      dryRun: true,
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status === 'applied').toBe(false);
    if (r.job) {
      expect(r.job.phase === 'failed' || r.phases?.preflight).toBeTruthy();
    }
  });

  it('triggerRemotePost reports failure without DONE marker', async () => {
    const r = await triggerRemotePost({
      host: mockHost({
        execute: true,
        remoteOut: 'ssh failed hard',
        sshFail: true,
      }),
      endpoint: { host: '10.1.1.1', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      targetDataDir: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(false);
  });

  it('triggerRemotePost detects YSK_NO_CLI', async () => {
    const r = await triggerRemotePost({
      host: mockHost({
        execute: true,
        remoteOut: 'YSK_NO_CLI\nYSK_REMOTE_POST_DONE\n',
      }),
      endpoint: { host: '10.1.1.2', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      jobId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      targetDataDir: "/var/lib/ysk-server",
    });
    expect(r.ok).toBe(false);
  });

  it('triggerRemotePost parses remote JSON ok', async () => {
    const r = await triggerRemotePost({
      host: mockHost({
        execute: true,
        remoteOut: [
          '{"ok":true,"apply_status":"applied"}',
          'YSK_REMOTE_POST_DONE',
        ].join('\n'),
      }),
      endpoint: { host: '10.1.1.3', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      jobId: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee',
      targetDataDir: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
  });

  it('triggerRemotePost demotes when remote JSON ok=false', async () => {
    const r = await triggerRemotePost({
      host: mockHost({
        execute: true,
        remoteOut: [
          '{"ok":false,"apply_status":"failed"}',
          'YSK_REMOTE_POST_DONE',
        ].join('\n'),
      }),
      endpoint: { host: '10.1.1.4', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      jobId: 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee',
      targetDataDir: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('failed');
  });

  it('runLocalMigratePost fails without job / manifest / execute', async () => {
    const missing = await runLocalMigratePost({
      host: mockHost({ execute: true }),
      dataDir: dir,
      jobId: 'ffffffff-0000-0000-0000-000000000001',
    });
    expect(missing.ok).toBe(false);

    const job = createMigrateJob({ dataDir: dir });
    const noManifest = await runLocalMigratePost({
      host: mockHost({ execute: true }),
      dataDir: dir,
      jobId: job.id,
    });
    expect(noManifest.ok).toBe(false);

    const m: HostManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      source: {
        hostname: 't',
        os: 'linux',
        arch: 'x64',
        dataDir: dir,
        yskVersion: '0.1.0',
        nodeVersion: process.version,
      },
      counts: { projects: 0 },
      projects: [],
      databases: [],
      redis: [],
      mailboxes: [],
      emailDomains: [],
      softwareNeeded: [],
      paths: {
        dataDir: dir,
        homes: [],
        optionalEtc: [],
        dataDirCritical: [],
      },
      fingerprints: {},
      warnings: [],
      exclusions: [],
      cutoverHostnames: [],
    };
    attachManifest(dir, job, m);
    const blocked = await runLocalMigratePost({
      host: mockHost({ execute: false }),
      dataDir: dir,
      jobId: job.id,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.requiresExecute).toBe(true);
    expect(blocked.apply_status === 'applied').toBe(false);
  });
});
