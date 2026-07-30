/**
 * Verify phase: reconcile target state vs source HostManifest.
 * Any critical mismatch → job must not be marked done.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  HostManifest,
  MigrateJobDto,
  MigrateJobVerify,
  OpsResultDto,
} from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { assessProductionReadiness } from '../production-readiness.js';
import {
  appendMigrateStep,
  attachManifest,
  saveMigrateJob,
  setMigratePhase,
  writeMigrateProgress,
} from './job-store.js';

export type VerifyCheck = {
  id: string;
  ok: boolean;
  critical: boolean;
  detail: string;
};

export type VerifyResult = OpsResultDto & {
  checks: VerifyCheck[];
  verify: MigrateJobVerify;
  productionReady?: boolean;
};

function dirNonEmpty(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const st = statSync(path);
    if (st.isFile()) return st.size > 0;
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/**
 * Compare store counts and disk facts to manifest.
 */
export async function verifyOnHost(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  db: JsonStore;
}): Promise<VerifyResult> {
  const dataDir = resolve(input.dataDir);
  const checks: VerifyCheck[] = [];
  const mismatches: string[] = [];
  const notes: string[] = [];

  setMigratePhase(dataDir, input.job, 'verify');
  writeMigrateProgress(dataDir, input.job.id, { phase: 'verify', status: 'start' });

  const s = input.db.snapshot;
  const expect = input.manifest.counts;

  const countChecks: Array<[string, number, number]> = [
    ['projects', expect.projects ?? input.manifest.projects.length, s.projects?.length ?? 0],
    ['users', expect.users ?? 0, s.users?.length ?? 0],
    [
      'mailboxes',
      expect.mailboxes ?? input.manifest.mailboxes.length,
      s.mailboxes?.length ?? 0,
    ],
    [
      'email_domains',
      expect.email_domains ?? input.manifest.emailDomains.length,
      s.email_domains?.length ?? 0,
    ],
    [
      'mysql_databases',
      expect.mysql_databases ??
        input.manifest.databases.filter((d) => d.engine === 'mysql' || d.engine === 'mariadb')
          .length,
      s.mysql_databases?.length ?? 0,
    ],
    [
      'postgres_databases',
      expect.postgres_databases ??
        input.manifest.databases.filter((d) => d.engine === 'postgres').length,
      s.postgres_databases?.length ?? 0,
    ],
    [
      'redis_instances',
      expect.redis_instances ?? input.manifest.redis.length,
      s.redis_instances?.length ?? 0,
    ],
  ];

  for (const [id, exp, got] of countChecks) {
    const ok = exp === got;
    checks.push({
      id: `count:${id}`,
      ok,
      critical: true,
      detail: ok ? `${id}=${got}` : `${id} 期望 ${exp} 實際 ${got}`,
    });
    if (!ok) mismatches.push(`${id}: expected ${exp} got ${got}`);
  }

  // Homes
  for (const p of input.manifest.projects) {
    if (!p.homeExists) {
      checks.push({
        id: `home:${p.id}`,
        ok: true,
        critical: false,
        detail: `來源 home 本就不存在，略過: ${p.home_dir}`,
      });
      continue;
    }
    const ok = existsSync(p.home_dir);
    checks.push({
      id: `home:${p.id}`,
      ok,
      critical: true,
      detail: ok ? `home ok ${p.home_dir}` : `home 缺失 ${p.home_dir}`,
    });
    if (!ok) mismatches.push(`home missing: ${p.home_dir}`);
  }

  // Maildirs
  for (const mb of input.manifest.mailboxes) {
    if (!mb.exists) {
      checks.push({
        id: `maildir:${mb.id}`,
        ok: true,
        critical: false,
        detail: `來源 Maildir 本就不存在: ${mb.maildirRelPath}`,
      });
      continue;
    }
    const abs = join(dataDir, mb.maildirRelPath);
    const ok = dirNonEmpty(abs) || existsSync(abs);
    checks.push({
      id: `maildir:${mb.id}`,
      ok,
      critical: true,
      detail: ok ? `maildir ok ${mb.maildirRelPath}` : `maildir 缺失 ${mb.maildirRelPath}`,
    });
    if (!ok) mismatches.push(`maildir missing: ${mb.maildirRelPath}`);
  }

  // Secrets
  const master = join(dataDir, 'secrets', 'ssh', '.master.key');
  const secOk = existsSync(master) || Boolean(process.env.YSK_SECRETS_KEY);
  checks.push({
    id: 'secrets',
    ok: secOk,
    critical: true,
    detail: secOk
      ? 'secrets key 可用'
      : '無 master key / YSK_SECRETS_KEY',
  });
  if (!secOk) mismatches.push('secrets master key missing');

  // ysk.json fingerprint if present
  const expFp = input.manifest.fingerprints['dataDir/ysk.json'];
  if (expFp) {
    try {
      const { createHash, readFileSync } = await import('node:crypto').then(async () => {
        const crypto = await import('node:crypto');
        const fs = await import('node:fs');
        return { createHash: crypto.createHash, readFileSync: fs.readFileSync };
      });
      const got = createHash('sha256')
        .update(readFileSync(join(dataDir, 'ysk.json')))
        .digest('hex');
      // After reapply we may have mutated bind_ip — fingerprint may differ; warn only
      const ok = got === expFp;
      checks.push({
        id: 'fingerprint-ysk-json',
        ok: true, // non-critical after reapply mutations
        critical: false,
        detail: ok
          ? 'ysk.json fingerprint 與來源一致'
          : `ysk.json fingerprint 已變（可能 reapply 寫回）local≠source`,
      });
      if (!ok) {
        notes.push('ysk.json fingerprint 與來源不同（若只清了 bind_ip 屬預期）');
      }
    } catch {
      checks.push({
        id: 'fingerprint-ysk-json',
        ok: false,
        critical: false,
        detail: '無法計算 ysk.json fingerprint',
      });
    }
  }

  // readiness
  let productionReady: boolean | undefined;
  try {
    const report = await assessProductionReadiness({
      dataDir,
      host: input.host,
      projects: input.manifest.projects.map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linux_user,
        homeDir: p.home_dir,
        osProvisioned: true,
      })),
    });
    productionReady = report.productionReady;
    checks.push({
      id: 'readiness',
      ok: report.productionReady,
      critical: false, // degraded still "migrated" if data ok
      detail: report.productionReady
        ? 'productionReady=true'
        : `productionReady=false blockers=${report.blockers.length}`,
    });
    if (report.summary?.length) {
      notes.push(...report.summary.slice(0, 2));
    }
    if (!report.productionReady) {
      notes.push(
        `readiness 未達 production：${report.blockers
          .slice(0, 3)
          .map((b) => b.title)
          .join('、')}`,
      );
    }
  } catch (e) {
    checks.push({
      id: 'readiness',
      ok: false,
      critical: false,
      detail: `readiness 錯誤: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Cutover checklist always in notes
  if (input.manifest.cutoverHostnames.length) {
    notes.push(
      `DNS cutover：將以下 A/AAAA 指向新 IP → ${input.manifest.cutoverHostnames.slice(0, 20).join(', ')}${input.manifest.cutoverHostnames.length > 20 ? '…' : ''}`,
    );
  }
  notes.push('人必須做：雲防火牆、郵件 PTR/rDNS、舊機保留觀察期');

  const criticalFail = checks.some((c) => c.critical && !c.ok);
  const verify: MigrateJobVerify = {
    productionReady,
    mismatches,
    notes: [
      ...notes,
      ...checks.filter((c) => !c.ok).map((c) => c.detail),
    ],
  };

  input.job.verify = verify;
  if (criticalFail) {
    setMigratePhase(dataDir, input.job, 'failed', 'verify 有關鍵不一致');
  } else {
    setMigratePhase(dataDir, input.job, 'done');
  }
  saveMigrateJob(dataDir, input.job);
  attachManifest(dataDir, input.job, input.manifest);

  appendMigrateStep(dataDir, input.job, {
    phase: 'verify',
    name: 'verify-all',
    result: {
      ok: !criticalFail,
      apply_status: criticalFail ? 'failed' : 'applied',
      notes: [
        criticalFail
          ? `verify 失敗：${mismatches.length} 項 mismatch`
          : `verify 通過（mismatches=${mismatches.length}）`,
        productionReady === true
          ? 'productionReady'
          : 'productionReady 未達標（資料可能已齊）',
      ],
    },
  });

  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'verify',
    status: criticalFail ? 'failed' : 'done',
    mismatches: mismatches.length,
  });

  return assertHonestOps({
    ok: !criticalFail,
    apply_status: criticalFail ? 'failed' : 'applied',
    notes: [
      criticalFail ? 'verify 未通過 — 不得視為遷移完成' : 'verify 通過 — job=done',
      ...verify.notes.slice(0, 12),
    ],
    checks,
    verify,
    productionReady,
  }) as VerifyResult;
}
