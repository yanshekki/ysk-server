/**
 * Source-side migrate host orchestration + remote post-transfer trigger.
 */

import type {
  HostManifest,
  MigrateJobDto,
  OpsResultDto,
} from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { buildHostManifest, summarizeManifest } from './inventory.js';
import {
  attachManifest,
  createMigrateJob,
  loadMigrateJob,
  listMigrateJobs,
  saveMigrateJob,
  setMigratePhase,
} from './job-store.js';
import { preflightMigrate } from './preflight.js';
import { packageSourceForMigrate } from './package-source.js';
import { transferThenBootstrap } from './bootstrap-target.js';
import { runPostTransferOnHost } from './post-transfer.js';
import {
  type MigrateSshAuth,
  type MigrateSshEndpoint,
  parseMigrateTarget,
  runSshCommand,
  userAtHost,
} from './transport.js';
import { bootstrapTempKeyAuth } from './temp-key.js';
import { openDatabase, closeDatabase } from '../../db/database.js';
import { join } from 'node:path';

export type SourceMigrateResult = OpsResultDto & {
  job?: MigrateJobDto;
  manifest?: HostManifest;
  phases?: Record<string, OpsResultDto>;
};

/**
 * Build inventory only (read-only).
 */
export async function migrateInventory(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  yskVersion?: string;
}): Promise<OpsResultDto & { manifest: HostManifest; summary: string[] }> {
  const manifest = await buildHostManifest({
    db: input.db,
    dataDir: input.dataDir,
    host: input.host,
    yskVersion: input.yskVersion,
  });
  const sum = summarizeManifest(manifest);
  return assertHonestOps({
    ok: true,
    apply_status: 'written',
    notes: sum.lines,
    manifest,
    summary: sum.lines,
  }) as OpsResultDto & { manifest: HostManifest; summary: string[] };
}

/**
 * Full source migrate: inventory → preflight → package → transfer+bootstrap
 * → optional remote post (restore/reapply/verify on target via CLI).
 */
export async function runSourceMigrateHost(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  target: string;
  port?: number;
  auth: MigrateSshAuth;
  /** One-shot password: install temp key then switch to identity */
  passwordForTempKey?: string;
  maintenanceAccepted: boolean;
  forceWipeTarget?: boolean;
  targetDataDir?: string;
  dryRun?: boolean;
  /** After transfer, SSH run ysk-server migrate post on target */
  remotePost?: boolean;
  yskVersion?: string;
  jobId?: string;
}): Promise<SourceMigrateResult> {
  const phases: Record<string, OpsResultDto> = {};
  const ep = parseMigrateTarget(input.target, input.port);
  if (!ep) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [`無效 target: ${input.target}（需要 root@host 或 host）`],
      phases,
    }) as SourceMigrateResult;
  }

  let auth: MigrateSshAuth = input.auth;
  let job: MigrateJobDto;

  if (input.jobId) {
    const existing = loadMigrateJob(input.dataDir, input.jobId);
    if (!existing) {
      return assertHonestOps({
        ok: false,
        apply_status: 'failed',
        notes: [`找不到 job ${input.jobId}`],
        phases,
      }) as SourceMigrateResult;
    }
    job = existing;
    job.target = {
      host: ep.host,
      port: ep.port,
      user: ep.user,
      identityId:
        auth.kind === 'identityId' ? auth.identityId : job.target?.identityId,
    };
    job.maintenanceAccepted = input.maintenanceAccepted;
    job.forceWipeTarget = input.forceWipeTarget;
    if (input.targetDataDir) job.targetDataDir = input.targetDataDir;
    saveMigrateJob(input.dataDir, job);
  } else {
    job = createMigrateJob({
      dataDir: input.dataDir,
      target: {
        host: ep.host,
        port: ep.port,
        user: ep.user,
        identityId: auth.kind === 'identityId' ? auth.identityId : undefined,
      },
      targetDataDir: input.targetDataDir,
      forceWipeTarget: input.forceWipeTarget,
      maintenanceAccepted: input.maintenanceAccepted,
    });
  }

  // Temp key bootstrap from password
  if (input.passwordForTempKey) {
    const tk = await bootstrapTempKeyAuth({
      host: input.host,
      dataDir: input.dataDir,
      jobId: job.id,
      endpoint: ep,
      password: input.passwordForTempKey,
    });
    phases.tempKey = tk;
    if (!tk.ok || !tk.auth) {
      setMigratePhase(input.dataDir, job, 'failed', '臨時金鑰失敗');
      return assertHonestOps({
        ok: false,
        blocked: tk.blocked,
        apply_status: tk.apply_status ?? 'failed',
        notes: ['臨時金鑰安裝失敗', ...tk.notes],
        job,
        phases,
      }) as SourceMigrateResult;
    }
    auth = tk.auth;
  }

  // Inventory
  const inv = await migrateInventory({
    host: input.host,
    db: input.db,
    dataDir: input.dataDir,
    yskVersion: input.yskVersion,
  });
  phases.inventory = inv;
  const manifest = inv.manifest;
  attachManifest(input.dataDir, job, manifest);

  // Preflight
  const pf = await preflightMigrate({
    host: input.host,
    dataDir: input.dataDir,
    endpoint: ep,
    auth,
    targetDataDir: job.targetDataDir,
    manifest,
    maintenanceAccepted: job.maintenanceAccepted,
    forceWipeTarget: job.forceWipeTarget,
    usingPassword: auth.kind === 'password',
  });
  phases.preflight = pf;
  if (!pf.ok) {
    setMigratePhase(input.dataDir, job, 'failed', 'preflight 失敗');
    return assertHonestOps({
      ok: false,
      blocked: pf.blocked,
      apply_status: pf.apply_status ?? 'failed',
      notes: pf.notes,
      job: loadMigrateJob(input.dataDir, job.id) ?? job,
      manifest,
      phases,
    }) as SourceMigrateResult;
  }

  if (input.dryRun) {
    setMigratePhase(input.dataDir, job, 'preflight');
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [
        'dry-run：inventory + preflight 通過，未 package/transfer',
        ...pf.notes.slice(0, 4),
      ],
      job: loadMigrateJob(input.dataDir, job.id) ?? job,
      manifest,
      phases,
    }) as SourceMigrateResult;
  }

  // Package
  const pkg = await packageSourceForMigrate({
    host: input.host,
    db: input.db,
    dataDir: input.dataDir,
    job,
    manifest,
  });
  phases.package = pkg;
  const packedManifest = pkg.manifest;
  if (!pkg.ok) {
    return assertHonestOps({
      ok: false,
      blocked: pkg.blocked,
      apply_status: pkg.apply_status ?? 'failed',
      notes: pkg.notes,
      job: loadMigrateJob(input.dataDir, job.id) ?? job,
      manifest: packedManifest,
      phases,
    }) as SourceMigrateResult;
  }

  // Transfer + bootstrap
  const xfer = await transferThenBootstrap({
    host: input.host,
    dataDir: input.dataDir,
    job,
    manifest: packedManifest,
    endpoint: ep,
    auth,
    targetDataDir: job.targetDataDir,
    dryRun: false,
    yskVersion: input.yskVersion,
  });
  phases.transferBootstrap = xfer;
  if (!xfer.ok) {
    setMigratePhase(input.dataDir, job, 'failed', 'transfer/bootstrap 失敗');
    return assertHonestOps({
      ok: false,
      blocked: xfer.blocked,
      apply_status: xfer.apply_status ?? 'failed',
      notes: xfer.notes,
      job: loadMigrateJob(input.dataDir, job.id) ?? job,
      manifest: packedManifest,
      phases,
    }) as SourceMigrateResult;
  }

  // Remote post-transfer on target
  if (input.remotePost !== false) {
    const post = await triggerRemotePost({
      host: input.host,
      endpoint: ep,
      auth,
      jobId: job.id,
      targetDataDir: job.targetDataDir,
    });
    phases.remotePost = post;
    if (!post.ok) {
      setMigratePhase(
        input.dataDir,
        job,
        'failed',
        'remote post 失敗 — 可於目標機手動 migrate post',
      );
      return assertHonestOps({
        ok: false,
        blocked: post.blocked,
        apply_status: post.apply_status ?? 'failed',
        notes: [
          'transfer 已完成，但目標 restore/reapply/verify 失敗',
          ...post.notes,
          `手動：在目標執行 YSK_EXECUTE=1 ysk-server migrate post --job ${job.id} --data-dir ${job.targetDataDir}`,
        ],
        job: loadMigrateJob(input.dataDir, job.id) ?? job,
        manifest: packedManifest,
        phases,
      }) as SourceMigrateResult;
    }
  }

  const finalJob = loadMigrateJob(input.dataDir, job.id) ?? job;
  // Source job may still be at bootstrap; remote post updates target job copy
  setMigratePhase(input.dataDir, finalJob, 'done');

  return assertHonestOps({
    ok: true,
    apply_status: 'applied',
    notes: [
      `整機遷移完成 → ${userAtHost(ep)}`,
      `job=${finalJob.id}`,
      `cutover 主機名: ${(packedManifest.cutoverHostnames ?? []).slice(0, 8).join(', ')}`,
      '請將 DNS A/AAAA 指向新 IP；檢查雲防火牆與郵件 PTR',
      ...xfer.notes.slice(0, 3),
    ],
    job: loadMigrateJob(input.dataDir, job.id) ?? finalJob,
    manifest: packedManifest,
    phases,
  }) as SourceMigrateResult;
}

/**
 * SSH to target and run ysk-server migrate post (restore+reapply+verify).
 */
export async function triggerRemotePost(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  jobId: string;
  targetDataDir: string;
}): Promise<OpsResultDto> {
  const td = input.targetDataDir.replace(/'/g, `'\\''`);
  const jid = input.jobId.replace(/[^a-f0-9-]/gi, '');
  const script = [
    'set -e',
    'export YSK_EXECUTE=1',
    'export DEBIAN_FRONTEND=noninteractive',
    'if ! command -v ysk-server >/dev/null 2>&1; then echo YSK_NO_CLI; exit 2; fi',
    `ysk-server migrate post --job ${JSON.stringify(jid)} --data-dir ${JSON.stringify(td)} --execute --json 2>&1 || true`,
    'echo YSK_REMOTE_POST_DONE',
  ].join('\n');

  const r = await runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: script,
    timeoutMs: 3_600_000,
    name: 'remote-post',
  });

  if (!r.ok && !r.stdout.includes('YSK_REMOTE_POST_DONE')) {
    return assertHonestOps({
      ok: false,
      blocked: r.blocked,
      apply_status: r.apply_status ?? 'failed',
      notes: [
        '遠端 migrate post 失敗',
        ...r.notes,
        (r.stdout || r.stderr || '').slice(0, 400),
      ],
    });
  }
  const out = r.stdout + r.stderr;
  if (out.includes('YSK_NO_CLI')) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [
        '目標尚無 ysk-server CLI — 請確認 bootstrap 或手動 npm i -g ysk-server',
      ],
    });
  }
  // Try parse last JSON line for ok
  let remoteOk = true;
  try {
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.startsWith('{')) {
        const j = JSON.parse(lines[i]!) as { ok?: boolean };
        if (typeof j.ok === 'boolean') remoteOk = j.ok;
        break;
      }
    }
  } catch {
    /* keep remoteOk true if post marker present */
  }

  return assertHonestOps({
    ok: remoteOk,
    apply_status: remoteOk ? 'applied' : 'failed',
    notes: [
      remoteOk
        ? `遠端 post 完成 @ ${userAtHost(input.endpoint)}`
        : '遠端 post 回報 ok=false',
      out.slice(0, 300),
    ],
  });
}

/**
 * Local post-transfer (run on target after dataDir restored).
 */
export async function runLocalMigratePost(input: {
  host: HostExecutor;
  dataDir: string;
  jobId: string;
}): Promise<OpsResultDto & { job?: MigrateJobDto }> {
  const job = loadMigrateJob(input.dataDir, input.jobId);
  if (!job) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [`找不到 job ${input.jobId}（確認 dataDir 已 rsync）`],
    });
  }
  if (!job.manifest) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: ['job 無 manifest'],
      job,
    });
  }
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: ['migrate post 需要 YSK_EXECUTE=1'],
      job,
    });
  }

  const dbPath = join(input.dataDir, 'ysk.json');
  const db = openDatabase(dbPath);
  try {
    const r = await runPostTransferOnHost({
      host: input.host,
      dataDir: input.dataDir,
      job,
      manifest: job.manifest,
      db,
    });
    return assertHonestOps({
      ...r,
      ok: r.ok,
      blocked: r.blocked,
      apply_status: r.apply_status,
      notes: r.notes,
      job: loadMigrateJob(input.dataDir, job.id) ?? job,
    }) as OpsResultDto & { job?: MigrateJobDto };
  } finally {
    closeDatabase(db);
  }
}

export { listMigrateJobs, loadMigrateJob };
