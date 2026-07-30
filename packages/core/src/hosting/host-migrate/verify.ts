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
import { assertHonestOps, tl} from '@ysk/shared';
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
      detail: ok ? `${id}=${got}` : tl('notes.auto.t0676', { v0: (id), v1: (exp), v2: (got) }),
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
        detail: tl('notes.auto.t0677', { v0: (p.home_dir) }),
      });
      continue;
    }
    const ok = existsSync(p.home_dir);
    checks.push({
      id: `home:${p.id}`,
      ok,
      critical: true,
      detail: ok ? `home ok ${p.home_dir}` : tl('notes.auto.t0678', { v0: (p.home_dir) }),
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
        detail: tl('notes.auto.t0679', { v0: (mb.maildirRelPath) }),
      });
      continue;
    }
    const abs = join(dataDir, mb.maildirRelPath);
    const ok = dirNonEmpty(abs) || existsSync(abs);
    checks.push({
      id: `maildir:${mb.id}`,
      ok,
      critical: true,
      detail: ok ? `maildir ok ${mb.maildirRelPath}` : tl('notes.auto.t0680', { v0: (mb.maildirRelPath) }),
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
      ? tl('notes.auto.n0425')
      : tl('notes.auto.n1081'),
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
          ? tl('notes.auto.n0477')
          : tl('notes.auto.t0681'),
      });
      if (!ok) {
        notes.push(tl('notes.auto.n0478'));
      }
    } catch {
      checks.push({
        id: 'fingerprint-ysk-json',
        ok: false,
        critical: false,
        detail: tl('notes.auto.n1181'),
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
        tl('notes.tpl.readinessNotProduction', {
          list: report.blockers
            .slice(0, 3)
            .map((b) => b.title)
            .join('、'),
        }),
      );
    }
  } catch (e) {
    checks.push({
      id: 'readiness',
      ok: false,
      critical: false,
      detail: tl('notes.auto.t0682', { v0: (e instanceof Error ? e.message : String(e)) }),
    });
  }

  // Cutover checklist always in notes
  if (input.manifest.cutoverHostnames.length) {
    notes.push(
      tl('notes.auto.t0683', { v0: (input.manifest.cutoverHostnames.slice(0, 20).join(', ')), v1: (input.manifest.cutoverHostnames.length > 20 ? '…' : '') }),
    );
  }
  notes.push(tl('notes.auto.n0510'));

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
    setMigratePhase(dataDir, input.job, 'failed', tl('notes.auto.n0461'));
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
          ? tl('notes.auto.t0684', { v0: (mismatches.length) })
          : tl('notes.auto.t0685', { v0: (mismatches.length) }),
        productionReady === true
          ? 'productionReady'
          : tl('notes.auto.n0390'),
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
      criticalFail ? tl('notes.auto.n0462') : tl('notes.auto.n0463'),
      ...verify.notes.slice(0, 12),
    ],
    checks,
    verify,
    productionReady,
  }) as VerifyResult;
}
