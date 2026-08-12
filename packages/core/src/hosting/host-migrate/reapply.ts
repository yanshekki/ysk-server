/**
 * Reapply phase: re-materialize host services from restored dataDir.
 * Reuses existing apply modules — no parallel apply logic.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HostManifest, MigrateJobDto, OpsResultDto } from 'ysk-server-shared';
import { assertHonestOps, tl} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { CronJobService } from '../backup-cron.js';
import { syncNginxConfigs } from '../nginx-sync.js';
import {
  applyEmailStack,
  applyFail2ban,
  applyFirewall,
  installControlPlaneSystemd } from '../system-apply.js';
import { appendMigrateStep, setMigratePhase, writeMigrateProgress } from './job-store.js';

export type ReapplyItem = {
  id: string;
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  apply_status?: OpsResultDto['apply_status'];
};

export type ReapplyResult = OpsResultDto & {
  items: ReapplyItem[];
};

/**
 * Clear project bind_ip that points at old address (notes only if cannot patch store).
 */
export function noteBindIpMigrations(
  db: JsonStore,
  manifest: HostManifest,
): ReapplyItem {
  const notes: string[] = [];
  let changed = 0;
  for (const p of manifest.projects) {
    if (!p.bind_ip) continue;
    notes.push(
      tl('notes.auto.t0662', { v0: (p.id), v1: (p.bind_ip) }),
    );
    const row = db.snapshot.projects.find((x) => x.id === p.id);
    if (row && row.bind_ip) {
      row.bind_ip = '';
      changed += 1;
    }
  }
  if (changed) {
    try {
      db.persist();
      notes.push(tl('notes.auto.t0663', { v0: (changed) }));
    } catch (e) {
      notes.push(tl('notes.auto.t0664', { v0: (e instanceof Error ? e.message : String(e)) }));
    }
  }
  return {
    id: 'bind-ip',
    ok: true,
    notes: notes.length ? notes : [tl('notes.auto.n1073')],
    apply_status: 'written' };
}

/**
 * Full reapply stack on local target.
 */
export async function reapplyOnHost(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  db: JsonStore;
  /** Path to ysk-server CLI js for systemd unit */
  cliPath?: string;
  applyFirewall?: boolean;
  applyFail2ban?: boolean;
}): Promise<ReapplyResult> {
  const dataDir = resolve(input.dataDir);
  const items: ReapplyItem[] = [];
  const host = input.host;

  if (!host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n0402'),
      notes: [tl('ops.blocked.needExecuteShort')],
      items: [] }) as ReapplyResult;
  }

  setMigratePhase(dataDir, input.job, 'reapply');
  writeMigrateProgress(dataDir, input.job.id, { phase: 'reapply', status: 'start' });

  // 0) bind_ip cleanup
  const bind = noteBindIpMigrations(input.db, input.manifest);
  items.push(bind);
  appendMigrateStep(dataDir, input.job, {
    phase: 'reapply',
    name: 'bind-ip',
    result: {
      ok: bind.ok,
      apply_status: 'written',
      notes: bind.notes } });

  // 1) control plane unit
  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'reapply',
    status: 'systemd' });
  const cliPath =
    input.cliPath ||
    (existsSync('/usr/bin/ysk-server')
      ? '/usr/bin/ysk-server'
      : existsSync('/usr/local/bin/ysk-server')
        ? '/usr/local/bin/ysk-server'
        : 'ysk-server');
  // installControlPlaneSystemd expects node path to cli js; if CLI is shell wrapper, write unit with which node
  const { resolveBin } = await import('../software-probe/index.js');
  const resolvedCli =
    (await resolveBin(host, 'ysk-server')) || (await resolveBin(host, 'node')) || cliPath;
  // Prefer running via `ysk-server` binary if it's the npm bin
  const unit = await installControlPlaneSystemd({
    dataDir,
    // unit template uses: node cliPath serve — if cli is bin, use a small wrapper path under dataDir
    cliPath: resolvedCli.endsWith('.js')
      ? resolvedCli
      : join(dataDir, 'systemd', 'ysk-serve-entry.js'),
    host,
    enable: true });
  // If we pointed at a missing entry, write a tiny launcher
  if (!resolvedCli.endsWith('.js')) {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(join(dataDir, 'systemd'), { recursive: true });
      writeFileSync(
        join(dataDir, 'systemd', 'ysk-serve-entry.js'),
        `#!/usr/bin/env node\nimport { spawn } from 'node:child_process';\nconst bin = ${JSON.stringify(resolvedCli)};\nconst child = spawn(bin, ['serve', '--config', ${JSON.stringify(join(dataDir, 'config.json'))}], { stdio: 'inherit' });\nchild.on('exit', (c) => process.exit(c ?? 1));\n`,
        'utf8',
      );
    } catch {
      /* */
    }
  }
  items.push({
    id: 'control-plane-unit',
    ok: unit.ok,
    blocked: unit.blocked,
    notes: unit.notes,
    apply_status: unit.blocked
      ? 'blocked'
      : unit.ok
        ? unit.executed
          ? 'applied'
          : 'written'
        : 'failed' });
  appendMigrateStep(dataDir, input.job, {
    phase: 'reapply',
    name: 'control-plane-unit',
    result: {
      ok: unit.ok,
      blocked: unit.blocked,
      apply_status: items[items.length - 1]!.apply_status,
      notes: unit.notes,
      written: unit.written } });

  // 2) nginx
  writeMigrateProgress(dataDir, input.job.id, { phase: 'reapply', status: 'nginx' });
  let ngxNotes: string[] = [];
  let ngxOk = false;
  let ngxReloadOk = true;
  try {
    // Only push to system conf.d when root (avoid EACCES on mkdir in degraded/tests)
    const systemConfDir =
      host.isRoot() && host.executeEnabled() ? '/etc/nginx/conf.d' : undefined;
    const ngx = await syncNginxConfigs({
      dataDir,
      host,
      systemConfDir });
    ngxNotes = [...ngx.notes];
    ngxOk = ngx.ok !== false;
    if (systemConfDir && host.executeEnabled() && host.isRoot()) {
      const t = await host.runCommand(['nginx', '-t'], { timeoutMs: 15_000 });
      if (t.exitCode === 0) {
        const rel = await host.runCommand(['systemctl', 'reload', 'nginx'], {
          timeoutMs: 15_000 });
        ngxReloadOk = rel.exitCode === 0;
      } else {
        ngxReloadOk = false;
        ngxNotes.push(tl('notes.tpl.nginxTestFailed', { detail: (t.stderr || t.stdout).slice(0, 120) }));
      }
    } else {
      ngxNotes.push(tl('notes.auto.n0978'));
      ngxReloadOk = true;
    }
  } catch (e) {
    ngxOk = false;
    ngxReloadOk = false;
    ngxNotes.push(
      tl('notes.auto.t0665', { v0: (e instanceof Error ? e.message : String(e)) }),
    );
  }
  items.push({
    id: 'nginx',
    ok: ngxOk && ngxReloadOk,
    notes: [
      ...ngxNotes,
      ngxReloadOk ? 'nginx reload ok / skipped' : tl('notes.auto.n0341'),
    ],
    apply_status: ngxOk && ngxReloadOk ? 'applied' : 'partial' });
  appendMigrateStep(dataDir, input.job, {
    phase: 'reapply',
    name: 'nginx',
    result: {
      ok: items[items.length - 1]!.ok,
      apply_status: items[items.length - 1]!.apply_status,
      notes: items[items.length - 1]!.notes } });

  // 3) email per domain
  for (const d of input.manifest.emailDomains) {
    if (!d.domain) continue;
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'reapply',
      status: 'email',
      domain: d.domain });
    try {
      const em = await applyEmailStack({
        dataDir,
        domain: d.domain,
        host,
        installPackages: false });
      items.push({
        id: `email:${d.domain}`,
        ok: em.ok,
        blocked: em.blocked,
        notes: em.notes,
        apply_status: em.blocked
          ? 'blocked'
          : em.ok
            ? em.executed
              ? 'applied'
              : 'written'
            : 'failed' });
    } catch (e) {
      items.push({
        id: `email:${d.domain}`,
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
        apply_status: 'failed' });
    }
    appendMigrateStep(dataDir, input.job, {
      phase: 'reapply',
      name: `email:${d.domain}`,
      result: {
        ok: items[items.length - 1]!.ok,
        blocked: items[items.length - 1]!.blocked,
        apply_status: items[items.length - 1]!.apply_status,
        notes: items[items.length - 1]!.notes } });
  }

  // 4) firewall / fail2ban optional
  if (input.applyFirewall !== false && (input.manifest.counts.firewall_rules ?? 0) > 0) {
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'reapply',
      status: 'firewall' });
    const fw = await applyFirewall({
      host,
      dataDir,
      apply: true });
    items.push({
      id: 'firewall',
      ok: fw.ok,
      blocked: fw.blocked,
      notes: fw.notes,
      apply_status: fw.blocked ? 'blocked' : fw.ok ? 'applied' : 'failed' });
    appendMigrateStep(dataDir, input.job, {
      phase: 'reapply',
      name: 'firewall',
      result: {
        ok: fw.ok,
        blocked: fw.blocked,
        apply_status: items[items.length - 1]!.apply_status,
        notes: fw.notes } });
  }

  if (input.applyFail2ban !== false) {
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'reapply',
      status: 'fail2ban' });
    const f2b = await applyFail2ban({
      host,
      dataDir,
      apply: true });
    items.push({
      id: 'fail2ban',
      ok: f2b.ok,
      blocked: f2b.blocked,
      notes: f2b.notes,
      apply_status: f2b.blocked ? 'blocked' : f2b.ok ? 'applied' : 'partial' });
    appendMigrateStep(dataDir, input.job, {
      phase: 'reapply',
      name: 'fail2ban',
      result: {
        ok: f2b.ok,
        blocked: f2b.blocked,
        apply_status: items[items.length - 1]!.apply_status,
        notes: f2b.notes } });
  }

  // 5) cron
  writeMigrateProgress(dataDir, input.job.id, { phase: 'reapply', status: 'cron' });
  try {
    const cron = new CronJobService(input.db, host, dataDir);
    const inst = await cron.installCrontab('migrate-reapply');
    items.push({
      id: 'cron',
      ok: Boolean(inst.ok),
      blocked: inst.blocked,
      notes: inst.notes,
      apply_status: inst.blocked
        ? 'blocked'
        : inst.ok
          ? 'applied'
          : 'failed' });
  } catch (e) {
    items.push({
      id: 'cron',
      ok: false,
      notes: [e instanceof Error ? e.message : String(e)],
      apply_status: 'failed' });
  }
  appendMigrateStep(dataDir, input.job, {
    phase: 'reapply',
    name: 'cron',
    result: {
      ok: items[items.length - 1]!.ok,
      blocked: items[items.length - 1]!.blocked,
      apply_status: items[items.length - 1]!.apply_status,
      notes: items[items.length - 1]!.notes } });

  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'reapply',
    status: 'done' });

  // Critical: nginx + control plane; email/fw soft
  const criticalIds = new Set(['control-plane-unit', 'nginx']);
  const criticalFail = items.some((i) => criticalIds.has(i.id) && !i.ok && !i.blocked);
  const blocked = items.some((i) => i.blocked && criticalIds.has(i.id));
  const anyBlocked = items.some((i) => i.blocked);

  const ok = !criticalFail && !blocked;
  if (!ok) {
    setMigratePhase(dataDir, input.job, 'failed', tl('notes.auto.n0037'));
  }

  return assertHonestOps({
    ok,
    blocked: anyBlocked || undefined,
    apply_status: ok
      ? items.some((i) => !i.ok)
        ? 'partial'
        : 'applied'
      : blocked
        ? 'blocked'
        : 'failed',
    notes: [
      ok ? tl('notes.tpl.reapplyDone') : tl('notes.auto.n0037'),
      ...items.filter((i) => !i.ok).flatMap((i) => [`[${i.id}] ${i.notes[0] ?? ''}`]),
    ],
    items }) as ReapplyResult;
}
