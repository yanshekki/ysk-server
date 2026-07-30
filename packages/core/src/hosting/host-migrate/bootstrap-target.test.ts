import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk/shared';
import { createMigrateJob } from './job-store.js';
import {
  aptPackagesForSoftwareIds,
  buildAptInstallScript,
  buildNodeInstallScript,
  buildYskCliInstallScript,
  bootstrapTargetMinimal,
  bootstrapTargetFull,
  transferThenBootstrap,
} from './bootstrap-target.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  markers?: string[];
  failStage?: string;
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
      if (opts.failStage && joined.includes(opts.failStage)) {
        return { ...empty(), exitCode: 1, stderr: 'fail', argv };
      }
      // Return all success markers so any stage passes
      const markers = opts.markers ?? [
        'YSK_APT_OK',
        'YSK_NODE_OK',
        'YSK_CLI_OK',
        'YSK_UNITS_END',
        'YSK_MKDIR_OK',
        'YSK_HAS_RSYNC',
        'YSK_SHA_DONE',
      ];
      // For verify need real-looking sha if present in fingerprints — transfer tests separate
      if (joined.includes('sha256sum')) {
        return {
          ...empty(),
          exitCode: 0,
          stdout: `${'ab'.repeat(32)}\nYSK_SHA_DONE\n`,
          argv,
        };
      }
      // Only real rsync binary argv — not apt install 'rsync' package name in script
      if (argv[0] === 'rsync') {
        return { ...empty(), exitCode: 0, argv };
      }
      return {
        ...empty(),
        exitCode: 0,
        stdout: markers.join('\n') + '\n',
        argv,
      };
    },
  };
}

function miniManifest(dataDir: string): HostManifest {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    packagedAt: new Date().toISOString(),
    source: {
      hostname: 's',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: {},
    projects: [{ id: 'p1', name: 'n', home_dir: '/home/x', linux_user: 'u', runtime: 'node', homeExists: false }],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: ['nginx', 'redis-server', 'node'],
    paths: {
      dataDir,
      homes: [],
      optionalEtc: [],
      dataDirCritical: [],
    },
    fingerprints: {},
    warnings: [],
    exclusions: [],
    cutoverHostnames: [],
  };
}

describe('aptPackagesForSoftwareIds', () => {
  it('maps catalog ids to apt packages + rsync', () => {
    const pkgs = aptPackagesForSoftwareIds(['nginx', 'redis-server']);
    expect(pkgs).toContain('nginx');
    expect(pkgs).toContain('redis-server');
    expect(pkgs).toContain('rsync');
  });
});

describe('script builders', () => {
  it('buildAptInstallScript is noninteractive', () => {
    const s = buildAptInstallScript(['nginx', 'curl']);
    expect(s).toContain('DEBIAN_FRONTEND=noninteractive');
    expect(s).toContain("'nginx'");
    expect(s).toContain('YSK_APT_OK');
  });

  it('buildNodeInstallScript checks major >= 20', () => {
    const s = buildNodeInstallScript();
    expect(s).toContain('YSK_NODE_OK');
    expect(s).toContain('setup_20.x');
  });

  it('buildYskCliInstallScript', () => {
    const s = buildYskCliInstallScript({ version: '0.1.0' });
    expect(s).toContain('ysk-server');
    expect(s).toContain('YSK_CLI');
  });
});

describe('bootstrapTargetMinimal/Full', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-bs-'));
    writeFileSync(join(dir, 'ysk.json'), '{}\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('minimal blocks without execute', async () => {
    const r = await bootstrapTargetMinimal({
      host: mockHost({ execute: false }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('minimal succeeds with markers', async () => {
    const r = await bootstrapTargetMinimal({
      host: mockHost({ execute: true }),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(true);
    expect(r.stages[0]?.id).toBe('minimal');
  });

  it('full bootstrap runs apt+node+cli+units', async () => {
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    const r = await bootstrapTargetFull({
      host: mockHost({ execute: true }),
      dataDir: dir,
      job,
      manifest: miniManifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
    });
    expect(r.ok).toBe(true);
    expect(r.stages.map((s) => s.id)).toEqual(
      expect.arrayContaining(['apt-software', 'node', 'ysk-cli', 'enable-units']),
    );
  });
});

describe('transferThenBootstrap', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-ttb-'));
    writeFileSync(join(dir, 'ysk.json'), '{"ok":true}\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('dry-run transfer skips full bootstrap', async () => {
    const job = createMigrateJob({ dataDir: dir, maintenanceAccepted: true });
    // dry-run won't verify sha
    const r = await transferThenBootstrap({
      host: mockHost({ execute: true }),
      dataDir: dir,
      job,
      manifest: miniManifest(dir),
      endpoint: { host: 'h', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.bootstrapFull).toBeUndefined();
    expect(r.transfer?.ok).toBe(true);
  });
});
