import { tl } from 'ysk-server-shared';
/**
 * Control-plane export + rebuild managed nginx confs from store (fail-closed).
 */

import {
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  statSync,
  readFileSync } from 'node:fs';
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
      cron_jobs: (s.cron_jobs ?? []).length },
    projects: s.projects.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      runtime: p.runtime,
      status: p.status })),
    emailDomains: s.email_domains.map((e) => ({
      id: String(e.id ?? ''),
      domain: String(e.domain ?? '') })),
    packages: (s.packages ?? []).length,
    users: s.users.length };
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
        mtime: st.mtime.toISOString() });
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
    return { ok: false, notes: [tl('notes.auto.n1102')] };
  }
  const dir = join(dataDir, 'exports');
  const path = join(dir, base);
  if (!existsSync(path)) {
    return { ok: false, notes: [tl('notes.auto.n1022')] };
  }
  try {
    const real = path; // already under dataDir/exports + basename
    if (!real.startsWith(dir)) {
      return { ok: false, notes: [tl('notes.auto.n1458')] };
    }
  } catch {
    return { ok: false, notes: [tl('notes.pathResolveFailed')] };
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
    notes.push(tl('notes.auto.t0129', { v0: (w.path), v1: (w.bytes) }));
    mode = 'export_only';
  }

  const nginxConfDetails = listManagedNginxDetailed(input.dataDir);
  const nginxConfs = nginxConfDetails.map((c) => c.path);
  notes.push(tl('notes.auto.t0130', { v0: (nginxConfs.length) }));

  if (input.dryRun) {
    mode = 'dry_run';
    const keepLinuxUsers = (input.db.snapshot.projects ?? [])
      .map((p) => String((p as { linux_user?: string }).linux_user ?? '').trim())
      .filter(Boolean);
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: true,
      keepLinuxUsers });
    notes.push(...sync.notes);
    notes.push(
      executeEnabled && isRoot
        ? tl('notes.auto.n1015')
        : tl('notes.auto.n1016'),
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
      isRoot };
  }

  if (input.syncNginx) {
    mode = 'sync';
    if (!executeEnabled || !isRoot) {
      return {
        ok: false,
        notes: [...notes, tl('notes.auto.n1147')],
        written,
        exportPath,
        nginxConfs,
        nginxConfDetails,
        blocked: true,
        blockMessage: tl('notes.auto.n1588'),
        mode,
        executeEnabled,
        isRoot };
    }
    const keepLinuxUsers = (input.db.snapshot.projects ?? [])
      .map((p) => String((p as { linux_user?: string }).linux_user ?? '').trim())
      .filter(Boolean);
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: false,
      keepLinuxUsers });
    written.push(...sync.copied);
    notes.push(...sync.notes);
    if (sync.tested) {
      const rel = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
        timeoutMs: 15_000 });
      notes.push(
        rel.exitCode === 0
          ? tl('notes.auto.n0811')
          : tl('notes.tpl.nginxReloadFailed', { detail: (rel.stderr || rel.stdout || '').slice(0, 300) }),
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
          isRoot };
      }
    } else {
      notes.push(tl('notes.auto.n0952'));
    }
  } else if (input.writeExport === false) {
    mode = 'list';
    notes.push(tl('notes.auto.n0565'));
  } else {
    notes.push(tl('notes.auto.n0982'));
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
    isRoot };
}

/** Read managed conf text (basename only under dataDir/nginx/conf.d). */
export function readManagedNginxConf(
  dataDir: string,
  name: string,
): { ok: boolean; content?: string; notes: string[] } {
  const base = basename(name || '');
  if (!base.endsWith('.conf') || base !== name || base.includes('..')) {
    return { ok: false, notes: [tl('notes.auto.n1100')] };
  }
  const path = join(dataDir, 'nginx', 'conf.d', base);
  if (!existsSync(path)) return { ok: false, notes: [tl('notes.fileMissing')] };
  try {
    const content = readFileSync(path, 'utf8');
    return { ok: true, content: content.slice(0, 200_000), notes: [`${base} · ${content.length} chars`] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : tl('notes.readFailed')] };
  }
}
