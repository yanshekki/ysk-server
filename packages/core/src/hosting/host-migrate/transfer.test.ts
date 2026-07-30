import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk/shared';
import { createMigrateJob } from './job-store.js';
import { transferMigratePayload, verifyRemoteYskJson } from './transfer.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  /** Record rsync/ssh commands */
  log?: string[];
  failRsyncPath?: string;
  remoteSha?: string;
}): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => opts.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const joined = argv.join(' ');
      opts.log?.push(joined);
      if (opts.failRsyncPath && joined.includes('rsync') && joined.includes(opts.failRsyncPath)) {
        return { ...empty(), exitCode: 1, stderr: 'rsync error', argv };
      }
      if (joined.includes('rsync') || argv[0] === 'rsync') {
        return { ...empty(), exitCode: 0, stdout: 'sent 1 bytes\n', argv };
      }
      if (joined.includes('sha256sum') || joined.includes('YSK_SHA')) {
        const sha = opts.remoteSha ?? 'deadbeef';
        return {
          ...empty(),
          exitCode: 0,
          stdout: `${sha}\nYSK_SHA_DONE\n`,
          argv,
        };
      }
      if (joined.includes('mkdir') || joined.includes('YSK_MKDIR')) {
        return { ...empty(), exitCode: 0, stdout: 'YSK_MKDIR_OK\n', argv };
      }
      // generic ssh
      if (argv[0] === 'ssh' || joined.includes('ssh ')) {
        return { ...empty(), exitCode: 0, stdout: 'YSK_MKDIR_OK\n', argv };
      }
      return { ...empty(), argv };
    },
  };
}

function manifest(dataDir: string, homes: string[] = []): HostManifest {
  const ysk = join(dataDir, 'ysk.json');
  let fp = '';
  try {
    fp = createHash('sha256').update(readFileSync(ysk)).digest('hex');
  } catch {
    fp = '';
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    packagedAt: new Date().toISOString(),
    source: {
      hostname: 'src',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: {},
    projects: [],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: ['nginx'],
    paths: {
      dataDir,
      homes,
      optionalEtc: [],
      dataDirCritical: [],
    },
    fingerprints: fp ? { 'dataDir/ysk.json': fp } : {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: [],
  };
}

describe('ensureRemoteDirs / verify', () => {
  it('blocks transfer without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-tr-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await transferMigratePayload({
      host: mockHost({ execute: false }),
      dataDir: dir,
      job,
      manifest: manifest(dir),
      endpoint: { host: '10.0.0.2', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('transferMigratePayload', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-tr2-'));
    writeFileSync(join(dir, 'ysk.json'), '{"v":1}\n');
    home = join(dir, 'external-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'app.js'), 'console.log(1)\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rsync dataDir + home and verifies sha', async () => {
    const body = readFileSync(join(dir, 'ysk.json'));
    const sha = createHash('sha256').update(body).digest('hex');
    const log: string[] = [];
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const m = manifest(dir, [home]);
    m.fingerprints['dataDir/ysk.json'] = sha;

    const r = await transferMigratePayload({
      host: mockHost({ execute: true, log, remoteSha: sha }),
      dataDir: dir,
      job,
      manifest: m,
      endpoint: { host: '203.0.113.9', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      targetDataDir: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(r.items.some((i) => i.kind === 'dataDir' && i.ok)).toBe(true);
    expect(r.items.some((i) => i.kind === 'home' && i.ok)).toBe(true);
    expect(r.items.some((i) => i.id === 'verify-ysk-json' && i.ok)).toBe(true);
    expect(log.some((l) => l.includes('rsync'))).toBe(true);
  });

  it('fails when ysk.json hash mismatches', async () => {
    const sha = createHash('sha256')
      .update(readFileSync(join(dir, 'ysk.json')))
      .digest('hex');
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const m = manifest(dir);
    m.fingerprints['dataDir/ysk.json'] = sha;
    const r = await transferMigratePayload({
      host: mockHost({ execute: true, remoteSha: '0'.repeat(64) }),
      dataDir: dir,
      job,
      manifest: m,
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/不一致|校驗/);
  });

  it('dry-run skips verify', async () => {
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await transferMigratePayload({
      host: mockHost({ execute: true }),
      dataDir: dir,
      job,
      manifest: manifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.id === 'verify-ysk-json')).toBe(false);
  });
});

describe('verifyRemoteYskJson', () => {
  it('reports missing local file', async () => {
    const r = await verifyRemoteYskJson({
      host: mockHost({ execute: true }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      localDataDir: '/no/such/dir',
      targetDataDir: '/var/lib/ysk-server',
    });
    expect(r.ok).toBe(false);
  });
});
