/**
 * Control-plane export + rebuild managed nginx/mail confs from store (fail-closed).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import { listManagedNginxConfs, syncNginxConfigs } from './nginx-sync.js';

export function exportControlPlaneSnapshot(db: YskDatabase): {
  exportedAt: string;
  counts: Record<string, number>;
  projects: Array<{ id: string; name: string; domain?: string; runtime: string; status: string }>;
  emailDomains: Array<{ id: string; domain: string }>;
  packages: number;
  users: number;
} {
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

export async function rebuildManagedConfigs(input: {
  dataDir: string;
  host: HostExecutor;
  db: YskDatabase;
  /** Write export JSON under dataDir/exports */
  writeExport?: boolean;
  /** Attempt nginx system sync */
  syncNginx?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  exportPath?: string;
  nginxConfs: string[];
  blocked?: boolean;
  blockMessage?: string;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const snap = exportControlPlaneSnapshot(input.db);
  let exportPath: string | undefined;

  if (input.writeExport !== false) {
    const dir = join(input.dataDir, 'exports');
    mkdirSync(dir, { recursive: true });
    exportPath = join(dir, `ysk-export-${Date.now()}.json`);
    writeFileSync(exportPath, JSON.stringify(snap, null, 2), 'utf8');
    written.push(exportPath);
    notes.push(`已匯出控制面摘要 ${exportPath}`);
  }

  const confRows = listManagedNginxConfs(input.dataDir);
  const nginxConfs = confRows.map((c) => c.path);
  notes.push(`managed nginx confs: ${nginxConfs.length}`);

  if (input.syncNginx) {
    if (!input.host.executeEnabled() || !input.host.isRoot()) {
      return {
        ok: false,
        notes: [...notes, '無法 sync nginx：需 YSK_EXECUTE + root'],
        written,
        exportPath,
        nginxConfs,
        blocked: true,
        blockMessage: '需要系統變更權限才能 rebuild 系統 nginx',
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
        rel.exitCode === 0 ? 'nginx reloaded' : `nginx reload failed: ${rel.stderr || rel.stdout}`,
      );
    }
  } else {
    notes.push('未請求 syncNginx — 僅匯出 / 列出 managed conf');
  }

  return {
    ok: true,
    notes,
    written,
    exportPath,
    nginxConfs,
  };
}
