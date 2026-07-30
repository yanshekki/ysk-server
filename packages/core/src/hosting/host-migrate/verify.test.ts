import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk/shared';
import { JsonStore } from '../../db/store.js';
import { createMigrateJob } from './job-store.js';
import { verifyOnHost } from './verify.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => true,
    executeEnabled: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      // readiness probes bins
      const joined = argv.join(' ');
      if (joined.includes('command -v') || argv[0] === 'bash') {
        return { ...empty(), stdout: '/usr/bin/x\n', argv };
      }
      return { ...empty(), argv };
    },
  };
}

describe('verifyOnHost', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-vf-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
    mkdirSync(join(dir, 'secrets', 'ssh'), { recursive: true });
    writeFileSync(join(dir, 'secrets', 'ssh', '.master.key'), 'k');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fails when project count mismatches', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    // no projects in store
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const manifest: HostManifest = {
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
      counts: { projects: 1, users: 0, mailboxes: 0 },
      projects: [
        {
          id: 'p1',
          name: 'n',
          home_dir: join(dir, 'missing-home'),
          linux_user: 'u',
          runtime: 'node',
          homeExists: true,
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
      cutoverHostnames: ['a.example'],
    };
    const r = await verifyOnHost({
      host: mockHost(),
      dataDir: dir,
      job,
      manifest,
      db: store,
    });
    expect(r.ok).toBe(false);
    expect(r.verify.mismatches.length).toBeGreaterThan(0);
    expect(job.phase).toBe('failed');
  });

  it('passes matching empty counts and marks done', async () => {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const manifest: HostManifest = {
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
      counts: {
        projects: 0,
        users: 0,
        mailboxes: 0,
        email_domains: 0,
        mysql_databases: 0,
        postgres_databases: 0,
        redis_instances: 0,
      },
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
    const r = await verifyOnHost({
      host: mockHost(),
      dataDir: dir,
      job,
      manifest,
      db: store,
    });
    expect(r.ok).toBe(true);
    expect(job.phase).toBe('done');
    expect(r.notes.join(' ')).toMatch(/cutover|DNS|防火牆|PTR|verify/i);
  });
});
