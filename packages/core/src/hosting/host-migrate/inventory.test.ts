import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  buildHostManifest,
  parsePasswdUidGid,
  summarizeManifest,
} from './inventory.js';
import {
  createMigrateJob,
  loadMigrateJob,
  attachManifest,
  appendMigrateStep,
  listMigrateJobs,
} from './job-store.js';

function mockHost(opts?: { passwd?: string }): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => false,
    executeEnabled: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => emptyRun(),
    runCommand: async (argv) => {
      if (argv[0] === 'getent' && opts?.passwd) {
        return {
          ...emptyRun(),
          exitCode: 0,
          stdout: opts.passwd,
          argv,
        };
      }
      if (argv[0] === 'bash' && String(argv[2] ?? '').includes('command -v')) {
        // pretend rsync/ssh exist; others missing
        const cmd = String(argv[2] ?? '');
        if (cmd.includes('rsync') || cmd.includes('ssh')) {
          return { ...emptyRun(), exitCode: 0, stdout: 'ok\n', argv };
        }
        return { ...emptyRun(), exitCode: 0, stdout: '', argv };
      }
      return { ...emptyRun(), exitCode: 1, argv };
    },
  };
}

function emptyRun(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

describe('parsePasswdUidGid', () => {
  it('parses getent line', () => {
    expect(parsePasswdUidGid('ysks_abc:x:1201:1201::/home/x:/usr/sbin/nologin')).toEqual({
      uid: 1201,
      gid: 1201,
    });
  });
});

describe('buildHostManifest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-migrate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('inventories store entities and fingerprints ysk.json', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const pid = '11111111-1111-1111-1111-111111111111';
    store.snapshot.projects.push({
      id: pid,
      name: 'demo',
      domain: 'demo.example',
      linux_user: 'ysks_demo',
      linux_group: 'ysks_demo',
      home_dir: join(dir, 'homes', `ysk-server-${pid}`),
      runtime: 'node',
      env: 'production',
      status: 'ready',
      os_provisioned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    store.snapshot.email_domains.push({
      id: 'ed1',
      domain: 'mail.example',
    });
    store.snapshot.mailboxes.push({
      id: 'mb1',
      domain: 'mail.example',
      local: 'admin',
    });
    store.snapshot.mysql_databases.push({
      id: 'db1',
      name: 'app_db',
      username: 'app',
    });
    store.snapshot.redis_instances.push({ id: 'r1', name: 'cache' });
    store.snapshot.users.push({
      id: 'u1',
      username: 'admin',
      password_hash: 'x',
      password_salt: 'y',
      roles: ['admin'],
      locale: 'zh-TW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    store.persist();

    mkdirSync(join(dir, 'email', 'mail.example', 'mailboxes', 'admin', 'Maildir'), {
      recursive: true,
    });
    writeFileSync(join(dir, 'config.json'), '{}');

    const m = await buildHostManifest({
      db: store,
      dataDir: dir,
      host: mockHost({
        passwd: 'ysks_demo:x:1500:1500::/home/x:/usr/sbin/nologin',
      }),
      yskVersion: '0.1.0-test',
    });

    expect(m.version).toBe(1);
    expect(m.counts.projects).toBe(1);
    expect(m.counts.mailboxes).toBe(1);
    expect(m.counts.users).toBe(1);
    expect(m.projects[0]?.uid).toBe(1500);
    expect(m.projects[0]?.homeExists).toBe(false);
    expect(m.databases.some((d) => d.name === 'app_db')).toBe(true);
    expect(m.redis).toHaveLength(1);
    expect(m.mailboxes[0]?.exists).toBe(true);
    expect(m.softwareNeeded.length).toBeGreaterThan(0);
    expect(m.softwareNeeded).toContain('nginx');
    expect(m.cutoverHostnames).toEqual(
      expect.arrayContaining(['demo.example', 'mail.example']),
    );
    expect(m.fingerprints['dataDir/ysk.json']).toMatch(/^[a-f0-9]{64}$/);
    expect(m.warnings.some((w) => w.includes('home 不存在'))).toBe(true);

    const sum = summarizeManifest(m);
    expect(sum.lines.length).toBeGreaterThan(2);
  });

  it('job store create → attach manifest → steps honest', () => {
    const job = createMigrateJob({
      dataDir: dir,
      target: { host: '203.0.113.10', port: 22, user: 'root' },
    });
    expect(job.phase).toBe('inventory');
    expect(loadMigrateJob(dir, job.id)?.id).toBe(job.id);

    attachManifest(dir, job, {
      version: 1,
      createdAt: new Date().toISOString(),
      source: {
        hostname: 'src',
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
    });

    appendMigrateStep(dir, job, {
      phase: 'inventory',
      name: '盤點完成',
      result: {
        ok: true,
        apply_status: 'written',
        notes: ['inventory ok'],
      },
    });

    // dishonest blocked+ok gets corrected
    appendMigrateStep(dir, job, {
      phase: 'preflight',
      name: '壞步驟',
      result: {
        ok: true,
        blocked: true,
        notes: ['should fix'],
      },
    });

    const reloaded = loadMigrateJob(dir, job.id)!;
    expect(reloaded.manifest?.source.hostname).toBe('src');
    expect(reloaded.steps).toHaveLength(2);
    expect(reloaded.steps[1]?.result.ok).toBe(false);
    expect(listMigrateJobs(dir).some((j) => j.id === job.id)).toBe(true);
  });
});
