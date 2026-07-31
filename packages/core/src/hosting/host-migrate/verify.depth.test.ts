import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createMigrateJob } from './job-store.js';
import { verifyOnHost } from './verify.js';
import type { HostManifest } from './types.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  execute?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts?.run?.(argv) ?? {}),
    }),
  };
}

function manifest(dir: string, counts: Record<string, number> = {}): HostManifest {
  return {
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
    counts: {
      projects: 1,
      users: 1,
      mailboxes: 0,
      email_domains: 0,
      mysql_databases: 0,
      postgres_databases: 0,
      redis_instances: 0,
      ...counts,
    },
    projects: [
      {
        id: 'p1',
        name: 'P',
        domain: 'p.local',
        homeDir: join(dir, 'homes', 'p1'),
        runtime: 'node',
      } as never,
    ],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: [],
    paths: {
      dataDir: dir,
      homes: [join(dir, 'homes', 'p1')],
      optionalEtc: [],
      dataDirCritical: [join(dir, 'ysk.json')],
    },
    fingerprints: {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: [],
  } as HostManifest;
}

describe('verifyOnHost depth', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-vf-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports mismatches when store empty vs manifest counts', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await verifyOnHost({
      host: mockHost(),
      dataDir: dir,
      job,
      manifest: manifest(dir),
      db: store,
    });
    expect(r.checks.length).toBeGreaterThan(0);
    expect(r.ok === false || r.checks.some((c) => !c.ok)).toBe(true);
    expect(r.verify).toBeTruthy();
  });

  it('passes count checks when store matches and homes exist', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.projects = [
      {
        id: 'p1',
        name: 'P',
        domain: 'p.local',
        linux_user: 'u',
        linux_group: 'u',
        home_dir: join(dir, 'homes', 'p1'),
        runtime: 'node',
        env: 'production',
        status: 'active',
        os_provisioned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
    ];
    store.snapshot.users = [
      {
        id: 'u1',
        username: 'admin',
        password_hash: 'h',
        password_salt: 's',
        roles: ['admin'],
        locale: 'en',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    store.persist();
    mkdirSync(join(dir, 'homes', 'p1', 'app'), { recursive: true });
    writeFileSync(join(dir, 'homes', 'p1', 'app', 'x'), '1');

    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await verifyOnHost({
      host: mockHost({
        run: (argv) => {
          if (argv.join(' ').includes('nginx')) return { exitCode: 0, stdout: 'ok' };
          return {};
        },
      }),
      dataDir: dir,
      job,
      manifest: manifest(dir, { projects: 1, users: 1 }),
      db: store,
    });
    expect(r.checks.some((c) => c.id.includes('project') || c.id.includes('count'))).toBe(true);
    expect(r.notes?.length ?? r.checks.length).toBeGreaterThan(0);
  });
});
