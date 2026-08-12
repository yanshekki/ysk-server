import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest } from '@ysk-server/shared';
import { preflightSource, preflightTarget, formatBytes } from './preflight.js';

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
    executeEnabled: () => opts.execute ?? true,
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
      // Source tool probes
      if (argv[0] === 'bash' && script.includes('command -v')) {
        return { ...empty(), stdout: 'ok\n', argv };
      }
      if (script.includes('du -sb') || joined.includes('du -sb')) {
        return { ...empty(), stdout: '1048576\n', argv };
      }
      // Outbound SSH (target preflight / anything else with execute)
      if (opts.sshFail) {
        return {
          ...empty(),
          exitCode: 255,
          stderr: 'Connection refused',
          argv,
        };
      }
      // Default success payload = remote preflight KEY=value
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

function miniManifest(dataDir: string): HostManifest {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      hostname: 'src',
      os: 'linux',
      arch: 'x64',
      dataDir,
      yskVersion: '0.1.0',
      nodeVersion: process.version,
    },
    counts: { projects: 0 },
    projects: [],
    databases: [],
    redis: [],
    mailboxes: [],
    emailDomains: [],
    softwareNeeded: ['nginx'],
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

describe('preflightSource', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-pf-'));
    writeFileSync(join(dir, 'ysk.json'), '{}');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('blocks without execute and maintenance', async () => {
    const r = await preflightSource({
      host: mockHost({ execute: false, root: false }),
      dataDir: dir,
      maintenanceAccepted: false,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.checks.some((c) => c.id === 'execute' && !c.ok)).toBe(true);
    expect(r.checks.some((c) => c.id === 'maintenance' && !c.ok)).toBe(true);
  });

  it('passes when execute+root+maintenance', async () => {
    const r = await preflightSource({
      host: mockHost({ execute: true, root: true }),
      dataDir: dir,
      manifest: miniManifest(dir),
      maintenanceAccepted: true,
    });
    expect(r.ok).toBe(true);
    expect(r.estimatedBytes).toBeGreaterThan(0);
  });
});

describe('preflightTarget', () => {
  it('fails on ssh error', async () => {
    const r = await preflightTarget({
      host: mockHost({ execute: true, sshFail: true }),
      endpoint: { host: 'x', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      targetDataDir: '/var/lib/ysk-server',
      estimatedBytes: 1024 * 1024 * 1024,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.id === 'ssh' && !c.ok)).toBe(true);
  });

  it('blocks non-debian and existing ysk without force', async () => {
    const remoteOut = [
      'USER=root',
      'UID=0',
      'OS_ID=fedora',
      'OS_LIKE=',
      'TARGET_EXISTS=1',
      'YSK_JSON=1',
      'FREE_KB=50000000',
      'HAS_RSYNC=1',
      'HAS_APT=0',
      `TIME_UTC=${Math.floor(Date.now() / 1000)}`,
    ].join('\n');
    const r = await preflightTarget({
      host: mockHost({ execute: true, remoteOut }),
      endpoint: { host: 'x', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      targetDataDir: '/var/lib/ysk-server',
      estimatedBytes: 1024 * 1024,
      forceWipeTarget: false,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.id === 'os' && !c.ok)).toBe(true);
    expect(r.checks.some((c) => c.id === 'target_clean' && !c.ok)).toBe(true);
  });

  it('ok on clean ubuntu root target', async () => {
    const r = await preflightTarget({
      host: mockHost({ execute: true }),
      endpoint: { host: 'x', port: 22, user: 'root' },
      auth: { kind: 'agent' },
      targetDataDir: '/var/lib/ysk-server',
      estimatedBytes: 1024 * 1024,
    });
    expect(r.ok).toBe(true);
    expect(r.targetFreeBytes).toBeGreaterThan(0);
  });
});

describe('formatBytes', () => {
  it('formats', () => {
    expect(formatBytes(500)).toContain('B');
    expect(formatBytes(5 * 1024 ** 3)).toContain('GB');
  });
});
