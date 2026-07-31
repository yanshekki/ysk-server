import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import type { HostManifest, MigrateJobDto } from '@ysk/shared';
import type { JsonStore } from '../../db/store.js';
import { runPostTransferOnHost } from './post-transfer.js';

vi.mock('./restore.js', () => ({
  restoreOnHost: vi.fn(),
}));
vi.mock('./reapply.js', () => ({
  reapplyOnHost: vi.fn(),
}));
vi.mock('./verify.js', () => ({
  verifyOnHost: vi.fn(),
}));

import { restoreOnHost } from './restore.js';
import { reapplyOnHost } from './reapply.js';
import { verifyOnHost } from './verify.js';

const restoreOnHostMock = vi.mocked(restoreOnHost);
const reapplyOnHostMock = vi.mocked(reapplyOnHost);
const verifyOnHostMock = vi.mocked(verifyOnHost);

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(execute = false): HostExecutor {
  return {
    pathExists: () => true,
    isRoot: () => false,
    executeEnabled: () => execute,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv }),
  };
}

function job(): MigrateJobDto {
  return {
    id: 'job-1',
    phase: 'restore',
    targetDataDir: '/var/lib/ysk-server',
    forceWipeTarget: false,
    maintenanceAccepted: true,
    steps: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function manifest(): HostManifest {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {
      hostname: 's',
      os: 'linux',
      arch: 'x64',
      dataDir: '/var/lib/ysk-server',
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
      dataDir: '/var/lib/ysk-server',
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

const db = {} as JsonStore;

describe('runPostTransferOnHost', () => {
  beforeEach(() => {
    restoreOnHostMock.mockReset();
    reapplyOnHostMock.mockReset();
    verifyOnHostMock.mockReset();
  });

  it('fails when restore fails and does not reapply', async () => {
    restoreOnHostMock.mockResolvedValue({
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      notes: ['restore blocked'],
    } as never);
    const r = await runPostTransferOnHost({
      host: mockHost(false),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.restore?.ok).toBe(false);
    expect(reapplyOnHostMock).not.toHaveBeenCalled();
    expect(verifyOnHostMock).not.toHaveBeenCalled();
  });

  it('skipReapply returns partial after restore', async () => {
    restoreOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['restored'],
    } as never);
    const r = await runPostTransferOnHost({
      host: mockHost(true),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
      skipReapply: true,
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('partial');
    expect(r.restore?.ok).toBe(true);
    expect(reapplyOnHostMock).not.toHaveBeenCalled();
  });

  it('fails when reapply fails', async () => {
    restoreOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['restored'],
    } as never);
    reapplyOnHostMock.mockResolvedValue({
      ok: false,
      apply_status: 'failed',
      notes: ['reapply failed'],
    } as never);
    const r = await runPostTransferOnHost({
      host: mockHost(true),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
    });
    expect(r.ok).toBe(false);
    expect(r.reapply?.ok).toBe(false);
    expect(verifyOnHostMock).not.toHaveBeenCalled();
  });

  it('skipVerify returns partial after reapply', async () => {
    restoreOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['r1', 'r2'],
    } as never);
    reapplyOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['a1'],
    } as never);
    const r = await runPostTransferOnHost({
      host: mockHost(true),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
      skipVerify: true,
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('partial');
    expect(verifyOnHostMock).not.toHaveBeenCalled();
  });

  it('full pipeline returns verify result honesty', async () => {
    restoreOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['restored-ok'],
    } as never);
    reapplyOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['reapplied-ok'],
    } as never);
    verifyOnHostMock.mockResolvedValue({
      ok: true,
      apply_status: 'applied',
      notes: ['verified'],
    } as never);
    const r = await runPostTransferOnHost({
      host: mockHost(true),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(r.verify?.ok).toBe(true);
    expect(r.notes.some((n) => n.includes('verified') || n.includes('restored'))).toBe(
      true,
    );

    verifyOnHostMock.mockResolvedValue({
      ok: false,
      apply_status: 'failed',
      notes: ['mismatch'],
    } as never);
    const bad = await runPostTransferOnHost({
      host: mockHost(true),
      dataDir: '/tmp/x',
      job: job(),
      manifest: manifest(),
      db,
    });
    expect(bad.ok).toBe(false);
    expect(bad.apply_status).toBe('failed');
  });
});
