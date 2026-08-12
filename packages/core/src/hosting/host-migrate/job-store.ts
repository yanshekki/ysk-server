/**
 * Persist migrate jobs under dataDir/migrate/<id>/.
 * Never stores SSH passwords.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  HostManifest,
  MigrateJobDto,
  MigrateJobStep,
  MigrateJobTarget,
  MigratePhase,
  OpsResultDto,
} from 'ysk-server-shared';
import { assertHonestOps } from 'ysk-server-shared';
import { migrateJobDir } from './types.js';

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function createMigrateJob(input: {
  dataDir: string;
  target?: MigrateJobTarget;
  targetDataDir?: string;
  forceWipeTarget?: boolean;
  maintenanceAccepted?: boolean;
}): MigrateJobDto {
  const id = randomUUID();
  const now = new Date().toISOString();
  const job: MigrateJobDto = {
    id,
    phase: 'inventory',
    target: input.target,
    targetDataDir: input.targetDataDir ?? '/var/lib/ysk-server',
    forceWipeTarget: input.forceWipeTarget === true,
    maintenanceAccepted: input.maintenanceAccepted === true,
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
  saveMigrateJob(input.dataDir, job);
  appendMigrateLog(input.dataDir, id, {
    event: 'created',
    phase: job.phase,
    at: now,
  });
  return job;
}

export function loadMigrateJob(
  dataDir: string,
  jobId: string,
): MigrateJobDto | null {
  const p = join(migrateJobDir(dataDir, jobId), 'job.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as MigrateJobDto;
  } catch {
    return null;
  }
}

export function saveMigrateJob(dataDir: string, job: MigrateJobDto): void {
  const dir = migrateJobDir(dataDir, job.id);
  mkdirSync(dir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  atomicWriteJson(join(dir, 'job.json'), job);
  if (job.manifest) {
    atomicWriteJson(join(dir, 'manifest.json'), job.manifest);
  }
}

export function listMigrateJobs(dataDir: string): MigrateJobDto[] {
  const root = join(dataDir, 'migrate');
  if (!existsSync(root)) return [];
  const out: MigrateJobDto[] = [];
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const job = loadMigrateJob(dataDir, name);
    if (job) out.push(job);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function setMigratePhase(
  dataDir: string,
  job: MigrateJobDto,
  phase: MigratePhase,
  lastError?: string,
): MigrateJobDto {
  job.phase = phase;
  if (lastError !== undefined) job.lastError = lastError;
  else if (phase !== 'failed') delete job.lastError;
  saveMigrateJob(dataDir, job);
  appendMigrateLog(dataDir, job.id, {
    event: 'phase',
    phase,
    at: new Date().toISOString(),
    lastError: job.lastError,
  });
  return job;
}

export function attachManifest(
  dataDir: string,
  job: MigrateJobDto,
  manifest: HostManifest,
): MigrateJobDto {
  job.manifest = manifest;
  saveMigrateJob(dataDir, job);
  return job;
}

export function appendMigrateStep(
  dataDir: string,
  job: MigrateJobDto,
  step: Omit<MigrateJobStep, 'id' | 'at' | 'result'> & {
    result: OpsResultDto;
  },
): MigrateJobDto {
  const honest = assertHonestOps(step.result);
  const full: MigrateJobStep = {
    id: randomUUID(),
    phase: step.phase,
    name: step.name,
    at: new Date().toISOString(),
    result: honest,
  };
  job.steps.push(full);
  saveMigrateJob(dataDir, job);
  appendMigrateLog(dataDir, job.id, {
    event: 'step',
    phase: full.phase,
    name: full.name,
    ok: honest.ok,
    blocked: honest.blocked,
    at: full.at,
  });
  return job;
}

export function appendMigrateLog(
  dataDir: string,
  jobId: string,
  entry: Record<string, unknown>,
): void {
  const dir = migrateJobDir(dataDir, jobId);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ...entry, ts: entry.at ?? new Date().toISOString() });
  appendFileSync(join(dir, 'log.jsonl'), line + '\n', 'utf8');
}

export function writeMigrateProgress(
  dataDir: string,
  jobId: string,
  progress: Record<string, unknown>,
): void {
  const dir = migrateJobDir(dataDir, jobId);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, 'progress.json'), {
    ...progress,
    updatedAt: new Date().toISOString(),
  });
}
