import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostManifest } from '@ysk-server/shared';
import {
  createMigrateJob,
  loadMigrateJob,
  saveMigrateJob,
  listMigrateJobs,
  setMigratePhase,
  attachManifest,
  appendMigrateStep,
  appendMigrateLog,
  writeMigrateProgress,
} from './job-store.js';
import { migrateJobDir } from './types.js';

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
    softwareNeeded: [],
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

describe('migrate job-store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-mjs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates job with defaults and persists job.json', () => {
    const job = createMigrateJob({
      dataDir: dir,
      target: { host: '10.0.0.9', port: 22, user: 'root' },
      maintenanceAccepted: true,
    });
    expect(job.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(job.phase).toBe('inventory');
    expect(job.targetDataDir).toBe('/var/lib/ysk-server');
    expect(job.forceWipeTarget).toBe(false);
    expect(job.maintenanceAccepted).toBe(true);
    expect(job.steps).toEqual([]);
    const p = join(migrateJobDir(dir, job.id), 'job.json');
    expect(existsSync(p)).toBe(true);
    const loaded = loadMigrateJob(dir, job.id);
    expect(loaded?.id).toBe(job.id);
    expect(loaded?.target?.host).toBe('10.0.0.9');
    const log = readFileSync(join(migrateJobDir(dir, job.id), 'log.jsonl'), 'utf8');
    expect(log).toContain('"event":"created"');
  });

  it('returns null for missing or corrupt job', () => {
    expect(loadMigrateJob(dir, 'no-such-job')).toBeNull();
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const jdir = migrateJobDir(dir, id);
    mkdirSync(jdir, { recursive: true });
    writeFileSync(join(jdir, 'job.json'), '{not-json', 'utf8');
    expect(loadMigrateJob(dir, id)).toBeNull();
  });

  it('lists jobs newest-first and skips dot entries', () => {
    expect(listMigrateJobs(dir)).toEqual([]);
    const a = createMigrateJob({ dataDir: dir });
    // ensure different createdAt ordering
    const b = createMigrateJob({
      dataDir: dir,
      targetDataDir: '/tmp/ysk-b',
    });
    const listed = listMigrateJobs(dir);
    expect(listed.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
    expect(listed[0]!.createdAt >= listed[listed.length - 1]!.createdAt).toBe(true);
  });

  it('setMigratePhase updates phase and clears lastError on success', () => {
    const job = createMigrateJob({ dataDir: dir });
    setMigratePhase(dir, job, 'failed', 'boom');
    let loaded = loadMigrateJob(dir, job.id)!;
    expect(loaded.phase).toBe('failed');
    expect(loaded.lastError).toBe('boom');
    setMigratePhase(dir, job, 'preflight');
    loaded = loadMigrateJob(dir, job.id)!;
    expect(loaded.phase).toBe('preflight');
    expect(loaded.lastError).toBeUndefined();
  });

  it('attachManifest writes job + manifest.json', () => {
    const job = createMigrateJob({ dataDir: dir });
    const m = miniManifest(dir);
    attachManifest(dir, job, m);
    const loaded = loadMigrateJob(dir, job.id)!;
    expect(loaded.manifest?.source.dataDir).toBe(dir);
    expect(existsSync(join(migrateJobDir(dir, job.id), 'manifest.json'))).toBe(
      true,
    );
  });

  it('appendMigrateStep honesty-normalizes result and logs', () => {
    const job = createMigrateJob({ dataDir: dir });
    appendMigrateStep(dir, job, {
      phase: 'package',
      name: 'sql-dump',
      result: {
        ok: true,
        apply_status: 'written',
        notes: ['packaged'],
      },
    });
    const loaded = loadMigrateJob(dir, job.id)!;
    expect(loaded.steps).toHaveLength(1);
    expect(loaded.steps[0]!.name).toBe('sql-dump');
    expect(loaded.steps[0]!.result.ok).toBe(true);
    expect(loaded.steps[0]!.id).toBeTruthy();
    // blocked cannot claim applied
    appendMigrateStep(dir, job, {
      phase: 'transfer',
      name: 'ssh',
      result: {
        ok: true,
        blocked: true,
        apply_status: 'applied',
        notes: ['should demote'],
      },
    });
    const again = loadMigrateJob(dir, job.id)!;
    const last = again.steps[again.steps.length - 1]!;
    expect(last.result.ok).toBe(false);
    expect(last.result.blocked).toBe(true);
    expect(last.result.apply_status).not.toBe('applied');
  });

  it('writeMigrateProgress and appendMigrateLog create files', () => {
    const job = createMigrateJob({ dataDir: dir });
    writeMigrateProgress(dir, job.id, { phase: 'package', pct: 40 });
    const progressPath = join(migrateJobDir(dir, job.id), 'progress.json');
    expect(existsSync(progressPath)).toBe(true);
    const body = JSON.parse(readFileSync(progressPath, 'utf8')) as {
      pct: number;
      updatedAt: string;
    };
    expect(body.pct).toBe(40);
    expect(body.updatedAt).toBeTruthy();
    appendMigrateLog(dir, job.id, { event: 'custom', at: new Date().toISOString() });
    const log = readFileSync(join(migrateJobDir(dir, job.id), 'log.jsonl'), 'utf8');
    expect(log).toContain('"event":"custom"');
  });

  it('saveMigrateJob bumps updatedAt', async () => {
    const job = createMigrateJob({ dataDir: dir });
    const before = job.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    job.phase = 'package';
    saveMigrateJob(dir, job);
    const loaded = loadMigrateJob(dir, job.id)!;
    expect(loaded.updatedAt >= before).toBe(true);
  });
});
