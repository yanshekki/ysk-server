import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from 'ysk-server-shared';
import { JsonStore } from '../../db/store.js';
import { createMigrateJob } from './job-store.js';
import { noteBindIpMigrations, reapplyOnHost } from './reapply.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts?: { execute?: boolean; root?: boolean }): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => opts?.root ?? true,
    executeEnabled: () => opts?.execute ?? true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const joined = argv.join(' ');
      if (joined.includes('nginx -t') || argv.includes('nginx')) {
        return { ...empty(), exitCode: 0, argv };
      }
      if (joined.includes('systemctl') || joined.includes('crontab')) {
        return { ...empty(), exitCode: 0, argv };
      }
      if (joined.includes('command -v')) {
        return { ...empty(), stdout: '/usr/bin/ysk-server\n/usr/bin/node\n', argv };
      }
      return { ...empty(), argv };
    },
  };
}

describe('noteBindIpMigrations', () => {
  it('clears bind_ip on store projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bip-'));
    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.projects.push({
      id: 'p1',
      name: 'n',
      linux_user: 'u',
      linux_group: 'u',
      home_dir: '/home/x',
      runtime: 'node',
      env: 'production',
      status: 'ready',
      os_provisioned: false,
      bind_ip: '203.0.113.1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    store.persist();
    const m: HostManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      source: {
        hostname: 's',
        os: 'linux',
        arch: 'x64',
        dataDir: dir,
        yskVersion: '0.1.0',
        nodeVersion: process.version,
      },
      counts: {},
      projects: [
        {
          id: 'p1',
          name: 'n',
          home_dir: '/home/x',
          linux_user: 'u',
          runtime: 'node',
          homeExists: true,
          bind_ip: '203.0.113.1',
        },
      ],
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
    const r = noteBindIpMigrations(store, m);
    expect(r.ok).toBe(true);
    expect(store.snapshot.projects[0]?.bind_ip).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('reapplyOnHost', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-ra-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeFileSync(join(dir, 'nginx', 'conf.d', 'site.conf'), 'server {}\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await reapplyOnHost({
      host: mockHost({ execute: false }),
      dataDir: dir,
      job,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        source: {
          hostname: 's',
          os: 'linux',
          arch: 'x64',
          dataDir: dir,
          yskVersion: '0.1.0',
          nodeVersion: process.version,
        },
        counts: {},
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
      },
      db: store,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('runs nginx + unit steps', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await reapplyOnHost({
      host: mockHost({ execute: true, root: true }),
      dataDir: dir,
      job,
      manifest: {
        version: 1,
        createdAt: new Date().toISOString(),
        source: {
          hostname: 's',
          os: 'linux',
          arch: 'x64',
          dataDir: dir,
          yskVersion: '0.1.0',
          nodeVersion: process.version,
        },
        counts: { firewall_rules: 0 },
        projects: [],
        databases: [],
        redis: [],
        mailboxes: [],
        emailDomains: [],
        softwareNeeded: ['nginx'],
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
      },
      db: store,
      applyFirewall: false,
      applyFail2ban: false,
    });
    expect(r.items.some((i) => i.id === 'nginx')).toBe(true);
    expect(r.items.some((i) => i.id === 'control-plane-unit')).toBe(true);
    // may be partial if unit template paths odd, but should not throw
    expect(r.apply_status).toBeTruthy();
  });
});
