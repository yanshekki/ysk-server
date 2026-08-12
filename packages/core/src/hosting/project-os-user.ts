import { tl } from '@ysk-server/shared';
/**
 * Live OS-user probe + apply Linux/systemd limits for a project.
 * Honest: applied only with root + YSK_EXECUTE; else written/blocked notes.
 */

import { existsSync, statSync } from 'node:fs';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectRow } from '../repositories/project-repo.js';
import { syncPm2EcosystemMemory } from './pm2-apply.js';
import { projectHomeDir } from './project.js';
import { shellQuote } from './project-user-run.js';
import { checkProjectQuota } from './quota.js';

export interface OsUserLive {
  linuxUser: string;
  linuxGroup: string;
  homeDir: string;
  canonicalHome: string;
  osProvisioned: boolean;
  userExists: boolean;
  uid?: number;
  gid?: number;
  shellLive?: string;
  homeExists: boolean;
  homeMode?: string;
  homeOwner?: string;
  locked?: boolean | null;
  notes: string[];
}

export interface ApplyOsLimitsResult {
  ok: boolean;
  written: boolean;
  applied: boolean;
  blocked: boolean;
  notes: string[];
  requiresRoot: boolean;
  requiresExecute: boolean;
  live?: OsUserLive;
  quota?: Awaited<ReturnType<typeof checkProjectQuota>>;
}

export async function probeOsUser(
  host: HostExecutor,
  row: ProjectRow,
): Promise<OsUserLive> {
  const notes: string[] = [];
  const canonicalHome = projectHomeDir(row.id);
  const live: OsUserLive = {
    linuxUser: row.linux_user,
    linuxGroup: row.linux_group,
    homeDir: row.home_dir,
    canonicalHome,
    osProvisioned: Boolean(row.os_provisioned),
    userExists: false,
    homeExists: existsSync(row.home_dir),
    notes,
  };

  if (live.homeExists) {
    try {
      const st = statSync(row.home_dir);
      live.homeMode = (st.mode & 0o777).toString(8).padStart(3, '0');
    } catch {
      notes.push(tl('notes.auto.n1137'));
    }
  }

  const idR = await host.runCommand(
    [
      'bash',
      '-c',
      `id -u ${shellQuote(row.linux_user)} 2>/dev/null; id -g ${shellQuote(row.linux_user)} 2>/dev/null; getent passwd ${shellQuote(row.linux_user)} 2>/dev/null || true`,
    ],
    { timeoutMs: 8_000 },
  );
  const lines = idR.stdout
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2 && /^\d+$/.test(lines[0]) && /^\d+$/.test(lines[1])) {
    live.userExists = true;
    live.uid = Number(lines[0]);
    live.gid = Number(lines[1]);
  }
  const passwd = lines.find((l) => l.includes(':'));
  if (passwd) {
    const parts = passwd.split(':');
    if (parts.length >= 7) {
      live.shellLive = parts[6];
      live.homeOwner = `${parts[2]}:${parts[3]}`;
    }
  }

  // passwd -S: "user L ..." locked, "user P" password set
  if (live.userExists) {
    const ps = await host.runCommand(
      ['bash', '-c', `passwd -S ${shellQuote(row.linux_user)} 2>/dev/null || true`],
      { timeoutMs: 5_000 },
    );
    const out = ps.stdout.trim();
    if (/\sL\s/.test(out) || out.includes(' locked')) live.locked = true;
    else if (/\s[PN]\s/.test(out) || out.length > 0) live.locked = false;
    else live.locked = null;
  } else {
    notes.push(tl('notes.auto.n1307'));
  }

  if (row.os_provisioned && !live.userExists) {
    notes.push(tl('notes.auto.n0093'));
  }
  if (live.homeExists && live.homeDir !== canonicalHome) {
    notes.push(tl('notes.auto.t0429', { v0: (canonicalHome) }));
  }

  return live;
}

/**
 * Apply shell lock/unlock, setquota, systemctl set-property for running unit.
 */
export async function applyOsUserLimits(input: {
  host: HostExecutor;
  row: ProjectRow;
  dataDir: string;
}): Promise<ApplyOsLimitsResult> {
  const notes: string[] = [];
  const requiresRoot = !input.host.isRoot();
  const requiresExecute = !input.host.executeEnabled();
  const can = input.host.executeEnabled() && input.host.isRoot();
  let applied = false;
  let written = true; // DB already updated by caller
  let blocked = false;

  if (!can) {
    blocked = true;
    notes.push(tl('notes.auto.n1530'));
    // Still patch ecosystem file when present (no root needed for home write on panel host)
    const pm2Sync = await syncPm2EcosystemMemory({
      host: input.host,
      homeDir: input.row.home_dir,
      linuxUser: input.row.linux_user,
      memoryMax: input.row.memory_max,
    });
    notes.push(...pm2Sync.notes);
    const live = await probeOsUser(input.host, input.row);
    const quota = await checkProjectQuota({
      host: input.host,
      projectId: input.row.id,
      homeDir: input.row.home_dir,
      quotaMb: input.row.quota_mb,
    });
    return {
      ok: false,
      written: written || pm2Sync.written,
      applied: false,
      blocked,
      notes: [...notes, ...live.notes, ...quota.notes],
      requiresRoot,
      requiresExecute,
      live,
      quota,
    };
  }

  const row = input.row;
  const unit = `ysk-project-${row.linux_user}.service`;

  // Shell
  const shell = row.shell?.trim() || '/usr/sbin/nologin';
  if (row.os_provisioned && row.linux_user) {
    const us = await input.host.runCommand(
      ['usermod', '-s', shell, row.linux_user],
      { timeoutMs: 10_000 },
    );
    if (us.exitCode === 0) {
      notes.push(`shell → ${shell}`);
      applied = true;
    } else {
      notes.push(tl('notes.auto.t0430', { v0: ((us.stderr || us.stdout).slice(0, 160)) }));
    }

    // Lock / unlock
    if (row.account_locked === true) {
      const lk = await input.host.runCommand(['usermod', '-L', row.linux_user], {
        timeoutMs: 10_000,
      });
      if (lk.exitCode === 0) {
        notes.push(tl('notes.auto.n0816'));
        applied = true;
      } else notes.push(tl('notes.auto.t0431', { v0: ((lk.stderr || '').slice(0, 120)) }));
    } else if (row.account_locked === false) {
      const uk = await input.host.runCommand(['usermod', '-U', row.linux_user], {
        timeoutMs: 10_000,
      });
      if (uk.exitCode === 0) {
        notes.push(tl('notes.auto.n0815'));
        applied = true;
      } else notes.push(tl('notes.auto.t0432', { v0: ((uk.stderr || '').slice(0, 120)) }));
    }
  } else {
    notes.push(tl('notes.auto.n1259'));
  }

  // systemd set-property (live unit if active)
  const props: string[] = [];
  if (row.memory_max) props.push(`MemoryMax=${row.memory_max}`);
  if (row.cpu_quota_percent != null && row.cpu_quota_percent > 0) {
    props.push(`CPUQuota=${Math.floor(row.cpu_quota_percent)}%`);
  }
  if (row.tasks_max != null && row.tasks_max > 0) {
    props.push(`TasksMax=${Math.floor(row.tasks_max)}`);
  }
  if (row.limit_nofile != null && row.limit_nofile > 0) {
    props.push(`LimitNOFILE=${Math.floor(row.limit_nofile)}`);
  }
  if (props.length) {
    const active = await input.host.runCommand(['systemctl', 'is-active', unit], {
      timeoutMs: 5_000,
    });
    if (active.stdout.trim() === 'active') {
      const sp = await input.host.runCommand(
        ['systemctl', 'set-property', unit, ...props],
        { timeoutMs: 15_000 },
      );
      if (sp.exitCode === 0) {
        notes.push(`systemctl set-property ${unit}: ${props.join(' ')}`);
        applied = true;
      } else {
        notes.push(
          tl('notes.auto.t0433', { v0: ((sp.stderr || sp.stdout).slice(0, 160)) }),
        );
      }
    } else {
      notes.push(tl('notes.auto.t0434', { v0: (unit) }));
    }
  }

  // Hard disk quota via setquota when available
  const quotaResult = await applySetquota(input.host, row, notes);
  if (quotaResult) applied = applied || quotaResult;

  // PM2: map memory_max → ecosystem max_memory_restart (+ reload if app online)
  const pm2Sync = await syncPm2EcosystemMemory({
    host: input.host,
    homeDir: row.home_dir,
    linuxUser: row.linux_user,
    memoryMax: row.memory_max,
  });
  notes.push(...pm2Sync.notes);
  if (pm2Sync.written) written = true;
  if (pm2Sync.reloaded) applied = true;

  const live = await probeOsUser(input.host, row);
  const quota = await checkProjectQuota({
    host: input.host,
    projectId: row.id,
    homeDir: row.home_dir,
    quotaMb: row.quota_mb,
  });

  return {
    ok: applied || (!blocked && written),
    written,
    applied,
    blocked,
    notes: [...notes, ...live.notes],
    requiresRoot: false,
    requiresExecute: false,
    live,
    quota,
  };
}

async function applySetquota(
  host: HostExecutor,
  row: ProjectRow,
  notes: string[],
): Promise<boolean> {
  if (row.quota_mb == null || row.quota_mb <= 0) {
    notes.push(tl('notes.auto.n0981'));
    return false;
  }
  if (!row.os_provisioned) {
    notes.push(tl('notes.auto.n1286'));
    return false;
  }
  // blocks: soft=hard for simplicity; 0 inodes unlimited-ish large
  const blocks = Math.max(1, Math.floor(row.quota_mb * 1024)); // 1K blocks
  const { binPresent } = await import('./software-probe/index.js');
  if (!(await binPresent(host, 'setquota'))) {
    notes.push(tl('notes.auto.n0431'));
    return false;
  }
  // Try root filesystem; if fails, report honestly
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `setquota -u ${shellQuote(row.linux_user)} ${blocks} ${blocks} 0 0 / 2>&1 || setquota -u ${shellQuote(row.linux_user)} ${blocks} ${blocks} 0 0 /home 2>&1 || true`,
    ],
    { timeoutMs: 15_000 },
  );
  const out = (r.stdout || r.stderr || '').trim();
  if (r.exitCode === 0 && !/error|not found|cannot|No such/i.test(out)) {
    notes.push(`setquota：${row.quota_mb} MiB（user ${row.linux_user}）`);
    return true;
  }
  notes.push(
    tl('notes.auto.t0435', { v0: (out.slice(0, 180) || 'exit ' + r.exitCode) }),
  );
  return false;
}

export async function chownHomeNow(
  host: HostExecutor,
  row: ProjectRow,
): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0237')],
    };
  }
  if (!existsSync(row.home_dir)) {
    return { ok: false, notes: [tl('notes.auto.t0436', { v0: (row.home_dir) })] };
  }
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `chown -R ${shellQuote(row.linux_user)}:${shellQuote(row.linux_group || row.linux_user)} ${shellQuote(row.home_dir)} && chmod 750 ${shellQuote(row.home_dir)}`,
    ],
    { timeoutMs: 60_000 },
  );
  if (r.exitCode === 0) {
    notes.push(tl('notes.auto.t0437', { v0: (row.linux_user), v1: (row.home_dir) }));
    return { ok: true, notes };
  }
  return {
    ok: false,
    notes: [tl('notes.tpl.chownFailed', { detail: (r.stderr || r.stdout).slice(0, 200) })],
  };
}
