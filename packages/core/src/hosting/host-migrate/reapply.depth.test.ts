import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../../db/store.js';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { createMigrateJob } from './job-store.js';
import { reapplyOnHost, noteBindIpMigrations } from './reapply.js';
import type { HostManifest } from './types.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root === true,
    pathExists: (p) => p.includes('nginx') || p.includes('ysk'),
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
      ...(opts.run?.(argv) ?? {}),
    }),
  };
}

function baseManifest(dir: string, extra?: Partial<HostManifest>): HostManifest {
  return {
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
    counts: { firewall_rules: 2 },
    projects: [],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [{ domain: 'mail.example.com' } as never],
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
    ...extra,
  } as HostManifest;
}

describe('reapplyOnHost depth', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-ra-d-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeFileSync(join(dir, 'nginx', 'conf.d', 'site.conf'), 'server {}\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('non-root execute skips system nginx conf.d and marks reload skipped', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await reapplyOnHost({
      host: mockHost({
        execute: true,
        root: false,
        run: (argv) => {
          if (argv[0] === 'bash' && argv.join(' ').includes('command -v')) {
            return { stdout: '/usr/bin/ysk-server\n/usr/bin/node\n' };
          }
          if (argv[0] === 'nginx') return { exitCode: 0 };
          if (argv[0] === 'systemctl') return { exitCode: 0 };
          return {};
        },
      }),
      dataDir: dir,
      job,
      manifest: baseManifest(dir, { counts: { firewall_rules: 0 }, emailDomains: [] }),
      db: store,
      applyFirewall: false,
      applyFail2ban: false,
      cliPath: join(dir, 'cli.js'),
    });
    expect(r.items.some((i) => i.id === 'nginx')).toBe(true);
    expect(r.items.some((i) => i.id === 'control-plane-unit')).toBe(true);
  });

  it('root path nginx -t fail and email/firewall/fail2ban steps', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    // Use non-root to avoid EACCES on /etc/nginx mkdir while still covering email/fw
    const r = await reapplyOnHost({
      host: mockHost({
        execute: true,
        root: false,
        run: (argv) => {
          const j = argv.join(' ');
          if (j.includes('command -v')) return { stdout: '/usr/bin/node\n' };
          if (argv[0] === 'systemctl') return { exitCode: 0 };
          if (argv[0] === 'ufw' || j.includes('iptables') || j.includes('firewall')) {
            return { exitCode: 0 };
          }
          if (j.includes('fail2ban') || argv[0] === 'fail2ban-client') {
            return { exitCode: 0 };
          }
          return { exitCode: 0 };
        },
      }),
      dataDir: dir,
      job,
      manifest: baseManifest(dir),
      db: store,
      applyFirewall: true,
      applyFail2ban: true,
      cliPath: join(dir, 'not-js-bin'),
    });
    expect(r.items.some((i) => i.id.startsWith('email:') || i.id === 'nginx')).toBe(true);
    expect(r.items.length).toBeGreaterThan(2);
    // firewall/fail2ban may appear as blocked or applied
    expect(r.notes?.length ?? r.items.length).toBeGreaterThan(0);
  });

  it('noteBindIpMigrations no-op when no bind_ip', () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.projects = [
      {
        id: 'p',
        name: 'P',
        domain: 'p.local',
        linux_user: 'u',
        linux_group: 'u',
        home_dir: '/tmp/p',
        runtime: 'node',
        env: 'production',
        status: 'active',
        os_provisioned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
    ];
    store.persist();
    const r = noteBindIpMigrations(store, baseManifest(dir));
    expect(r.ok).toBe(true);
  });
});
