/**
 * Control-plane export + rebuild managed nginx confs from store (fail-closed).
 */

import {
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  statSync,
  readFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import { listManagedNginxConfs, syncNginxConfigs } from './nginx-sync.js';

export type ControlPlaneSnapshot = {
  exportedAt: string;
  counts: Record<string, number>;
  projects: Array<{ id: string; name: string; domain?: string; runtime: string; status: string }>;
  emailDomains: Array<{ id: string; domain: string }>;
  packages: number;
  users: number;
};

export type ManagedNginxConfInfo = {
  name: string;
  path: string;
  bytes: number;
  mtime?: string;
};

export type ExportArchiveInfo = {
  name: string;
  path: string;
  bytes: number;
  mtime: string;
};

export function exportControlPlaneSnapshot(db: YskDatabase): ControlPlaneSnapshot {
  const s = db.snapshot;
  return {
    exportedAt: new Date().toISOString(),
    counts: {
      projects: s.projects.length,
      users: s.users.length,
      packages: (s.packages ?? []).length,
      email_domains: s.email_domains.length,
      certificates: (s.certificates ?? []).length,
      dns_zones: (s.dns_zones ?? []).length,
      cron_jobs: (s.cron_jobs ?? []).length,
    },
    projects: s.projects.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      runtime: p.runtime,
      status: p.status,
    })),
    emailDomains: s.email_domains.map((e) => ({
      id: String(e.id ?? ''),
      domain: String(e.domain ?? ''),
    })),
    packages: (s.packages ?? []).length,
    users: s.users.length,
  };
}

/** Managed nginx conf.d under dataDir (with mtime). */
export function listManagedNginxDetailed(dataDir: string): ManagedNginxConfInfo[] {
  const base = listManagedNginxConfs(dataDir);
  return base.map((c) => {
    let mtime: string | undefined;
    try {
      mtime = statSync(c.path).mtime.toISOString();
    } catch {
      /* */
    }
    return { ...c, mtime };
  });
}

/** List JSON exports written under dataDir/exports (newest first). */
export function listControlPlaneExports(dataDir: string): ExportArchiveInfo[] {
  const dir = join(dataDir, 'exports');
  if (!existsSync(dir)) return [];
  const out: ExportArchiveInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || !name.startsWith('ysk-export-')) continue;
    // path safety: basename only
    if (name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      out.push({
        name,
        path,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
      });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1)).slice(0, 40);
}

/**
 * Resolve a safe export file path by basename only.
 */
export function resolveExportFile(
  dataDir: string,
  name: string,
): { ok: true; path: string } | { ok: false; notes: string[] } {
  const base = basename(name || '');
  if (!base || base !== name || !/^ysk-export-\d+\.json$/.test(base)) {
    return { ok: false, notes: ['無效 export 檔名'] };
  }
  const dir = join(dataDir, 'exports');
  const path = join(dir, base);
  if (!existsSync(path)) {
    return { ok: false, notes: ['檔案不存在或已刪除'] };
  }
  try {
    const real = path; // already under dataDir/exports + basename
    if (!real.startsWith(dir)) {
      return { ok: false, notes: ['路徑不允許'] };
    }
  } catch {
    return { ok: false, notes: ['路徑解析失敗'] };
  }
  return { ok: true, path };
}

export function writeControlPlaneExport(
  dataDir: string,
  db: YskDatabase,
): { path: string; bytes: number; snapshot: ControlPlaneSnapshot } {
  const snap = exportControlPlaneSnapshot(db);
  const dir = join(dataDir, 'exports');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `ysk-export-${Date.now()}.json`);
  const body = JSON.stringify(snap, null, 2);
  writeFileSync(path, body, 'utf8');
  return { path, bytes: Buffer.byteLength(body), snapshot: snap };
}

export async function rebuildManagedConfigs(input: {
  dataDir: string;
  host: HostExecutor;
  db: YskDatabase;
  /** Write export JSON under dataDir/exports */
  writeExport?: boolean;
  /** Attempt nginx system sync */
  syncNginx?: boolean;
  /** Dry-run sync: list what would copy, no system write/reload */
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  exportPath?: string;
  nginxConfs: string[];
  nginxConfDetails: ManagedNginxConfInfo[];
  blocked?: boolean;
  blockMessage?: string;
  dryRun?: boolean;
  mode: 'export_only' | 'list' | 'sync' | 'dry_run';
  executeEnabled: boolean;
  isRoot: boolean;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const executeEnabled = input.host.executeEnabled();
  const isRoot = input.host.isRoot();
  let exportPath: string | undefined;
  let mode: 'export_only' | 'list' | 'sync' | 'dry_run' = 'list';

  if (input.writeExport !== false) {
    const w = writeControlPlaneExport(input.dataDir, input.db);
    exportPath = w.path;
    written.push(w.path);
    notes.push(`已寫入控制面摘要 ${w.path}（${w.bytes} bytes）`);
    mode = 'export_only';
  }

  const nginxConfDetails = listManagedNginxDetailed(input.dataDir);
  const nginxConfs = nginxConfDetails.map((c) => c.path);
  notes.push(`管理面 Nginx conf：${nginxConfs.length} 個（dataDir/nginx/conf.d）`);

  if (input.dryRun) {
    mode = 'dry_run';
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: true,
    });
    notes.push(...sync.notes);
    notes.push(
      executeEnabled && isRoot
        ? '模擬完成 — 未複製、未 reload（正式同步請關 dryRun）'
        : '模擬完成 — 正式同步仍需 root + YSK_EXECUTE',
    );
    return {
      ok: true,
      notes,
      written,
      exportPath,
      nginxConfs,
      nginxConfDetails,
      dryRun: true,
      mode,
      executeEnabled,
      isRoot,
    };
  }

  if (input.syncNginx) {
    mode = 'sync';
    if (!executeEnabled || !isRoot) {
      return {
        ok: false,
        notes: [...notes, '無法同步 Nginx：需開啟系統變更權限與管理員（root）'],
        written,
        exportPath,
        nginxConfs,
        nginxConfDetails,
        blocked: true,
        blockMessage: '需要系統變更權限才能重建系統 Nginx',
        mode,
        executeEnabled,
        isRoot,
      };
    }
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: false,
    });
    written.push(...sync.copied);
    notes.push(...sync.notes);
    if (sync.tested) {
      const rel = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
        timeoutMs: 15_000,
      });
      notes.push(
        rel.exitCode === 0
          ? '已重載 Nginx（systemctl reload）'
          : `nginx reload 失敗：${(rel.stderr || rel.stdout || '').slice(0, 300)}`,
      );
      if (rel.exitCode !== 0) {
        return {
          ok: false,
          notes,
          written,
          exportPath,
          nginxConfs,
          nginxConfDetails,
          mode,
          executeEnabled,
          isRoot,
        };
      }
    } else {
      notes.push('未執行 nginx -t 成功路徑 — 請檢查 sync 備註');
    }
  } else if (input.writeExport === false) {
    mode = 'list';
    notes.push('僅列出 managed conf（未寫 export、未同步系統）');
  } else {
    notes.push('未請求同步系統 — dataDir 管理檔 ≠ /etc/nginx 已套用');
  }

  return {
    ok: true,
    notes,
    written,
    exportPath,
    nginxConfs,
    nginxConfDetails,
    mode,
    executeEnabled,
    isRoot,
  };
}

/** Read managed conf text (basename only under dataDir/nginx/conf.d). */
export function readManagedNginxConf(
  dataDir: string,
  name: string,
): { ok: boolean; content?: string; notes: string[] } {
  const base = basename(name || '');
  if (!base.endsWith('.conf') || base !== name || base.includes('..')) {
    return { ok: false, notes: ['無效 conf 名稱'] };
  }
  const path = join(dataDir, 'nginx', 'conf.d', base);
  if (!existsSync(path)) return { ok: false, notes: ['檔案不存在'] };
  try {
    const content = readFileSync(path, 'utf8');
    return { ok: true, content: content.slice(0, 200_000), notes: [`${base} · ${content.length} chars`] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : '讀取失敗'] };
  }
}
