/**
 * Live OS-user probe + apply Linux/systemd limits for a project.
 * Honest: applied only with root + YSK_EXECUTE; else written/blocked notes.
 */

import { existsSync, statSync } from 'node:fs';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectRow } from '../repositories/project-repo.js';
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
      notes.push('無法 stat home');
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
    notes.push('系統用戶不存在（尚未 provision 或已刪）');
  }

  if (row.os_provisioned && !live.userExists) {
    notes.push('DB 標記已隔離但 id 找不到用戶 — 請重新建立系統用戶');
  }
  if (live.homeExists && live.homeDir !== canonicalHome) {
    notes.push(`目前 home 非意圖路徑（意圖 ${canonicalHome}）`);
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
    notes.push('限制已寫入控制面；套用到 OS 需 YSK_EXECUTE + root');
    const live = await probeOsUser(input.host, input.row);
    const quota = await checkProjectQuota({
      host: input.host,
      projectId: input.row.id,
      homeDir: input.row.home_dir,
      quotaMb: input.row.quota_mb,
    });
    return {
      ok: false,
      written,
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
      notes.push(`usermod -s 失敗：${(us.stderr || us.stdout).slice(0, 160)}`);
    }

    // Lock / unlock
    if (row.account_locked === true) {
      const lk = await input.host.runCommand(['usermod', '-L', row.linux_user], {
        timeoutMs: 10_000,
      });
      if (lk.exitCode === 0) {
        notes.push('帳號已鎖定 (usermod -L)');
        applied = true;
      } else notes.push(`鎖定失敗：${(lk.stderr || '').slice(0, 120)}`);
    } else if (row.account_locked === false) {
      const uk = await input.host.runCommand(['usermod', '-U', row.linux_user], {
        timeoutMs: 10_000,
      });
      if (uk.exitCode === 0) {
        notes.push('帳號已解鎖 (usermod -U)');
        applied = true;
      } else notes.push(`解鎖失敗：${(uk.stderr || '').slice(0, 120)}`);
    }
  } else {
    notes.push('略過 usermod（未 os_provisioned）');
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
          `set-property 失敗：${(sp.stderr || sp.stdout).slice(0, 160)}（下次 deploy 會寫入 unit）`,
        );
      }
    } else {
      notes.push(`unit ${unit} 未 active — 限制已存 DB，下次 deploy 寫入 unit`);
    }
  }

  // Hard disk quota via setquota when available
  const quotaResult = await applySetquota(input.host, row, notes);
  if (quotaResult) applied = applied || quotaResult;

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
    notes.push('未設定磁碟配額（軟配額關閉）');
    return false;
  }
  if (!row.os_provisioned) {
    notes.push('硬配額略過：未 os_provisioned');
    return false;
  }
  // blocks: soft=hard for simplicity; 0 inodes unlimited-ish large
  const blocks = Math.max(1, Math.floor(row.quota_mb * 1024)); // 1K blocks
  const has = await host.runCommand(
    ['bash', '-c', 'command -v setquota >/dev/null 2>&1 && echo yes || echo no'],
    { timeoutMs: 5_000 },
  );
  if (!has.stdout.includes('yes')) {
    notes.push('setquota 不在 PATH — 僅控制面軟配額（deploy 前 du 擋）');
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
    `setquota 未成功（檔案系統可能未啟 user_xattr/quota）：${out.slice(0, 180) || 'exit ' + r.exitCode}`,
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
      notes: ['chown 需要 YSK_EXECUTE + root'],
    };
  }
  if (!existsSync(row.home_dir)) {
    return { ok: false, notes: [`home 不存在：${row.home_dir}`] };
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
    notes.push(`已 chown ${row.linux_user} → ${row.home_dir}`);
    return { ok: true, notes };
  }
  return {
    ok: false,
    notes: [`chown 失敗：${(r.stderr || r.stdout).slice(0, 200)}`],
  };
}
