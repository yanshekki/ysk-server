/**
 * Merged Apache site list: PHP project backends + standalone sites.json.
 *
 * Production PHP path is Nginx → Apache → FPM; project vhosts live under
 * dataDir/apache/sites/ysk-{linux_user}.conf and are not stored in sites.json.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listApacheSites } from './service.js';
import type { ApacheBodySize, ApacheSiteKind } from './types.js';

export type ApacheSiteSource = 'project' | 'standalone' | 'artifact';

export type ApacheSiteRow = {
  id: string;
  source: ApacheSiteSource;
  projectId?: string;
  projectName?: string;
  serverName: string;
  kind: ApacheSiteKind;
  upstream?: string;
  root?: string;
  /** Display target (root or upstream). */
  target: string;
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: ApacheBodySize | 'inherit';
  indexes?: boolean;
  confPath?: string | null;
  apply_status?: string | null;
  linuxUser?: string | null;
  phpVersion?: string | null;
  /** True when source is project or standalone (SSOT). Artifact is never owned. */
  owned?: boolean;
  /** True when another row shares the same ServerName (case-insensitive). */
  conflict?: boolean;
  /** Other row ids that share ServerName when conflict. */
  conflictPeers?: string[];
};

function projectDocRoot(p: Record<string, unknown>): string {
  const home = String(p.home_dir ?? p.homeDir ?? '').trim();
  const docRel = String(p.doc_root ?? p.docRoot ?? 'app/public').trim() || 'app/public';
  if (home) {
    // doc_root is relative to home (same convention as project-ops)
    if (docRel.startsWith('/')) return docRel;
    return join(home, docRel);
  }
  return String(p.docRoot ?? p.doc_root ?? '—');
}

export function confPathForLinuxUser(dataDir: string, linuxUser: string): string {
  return join(dataDir, 'apache', 'sites', `ysk-${linuxUser}.conf`);
}

export function parseServerNameFromConf(content: string): string | null {
  const m = content.match(/^\s*ServerName\s+(\S+)/im);
  return m?.[1]?.trim() || null;
}

function parseDocRootFromConf(content: string): string | null {
  const m = content.match(/^\s*DocumentRoot\s+(\S+)/im);
  return m?.[1]?.trim() || null;
}

/** Basenames under apache/sites that are SSOT-owned (safe to sync to system). */
export function listOwnedApacheConfBasenames(input: {
  dataDir: string;
  projects: Array<Record<string, unknown>>;
}): Set<string> {
  const owned = new Set<string>();
  for (const p of input.projects) {
    const runtime = String(p.runtime ?? '').toLowerCase();
    if (runtime !== 'php') continue;
    const linuxUser = String(p.linux_user ?? p.linuxUser ?? '').trim();
    if (linuxUser) owned.add(`ysk-${linuxUser}.conf`);
  }
  for (const s of listApacheSites(input.dataDir)) {
    if (!s.confPath) continue;
    const base = s.confPath.split(/[/\\]/).pop();
    if (base?.endsWith('.conf')) owned.add(base);
  }
  return owned;
}

function annotateConflicts(rows: ApacheSiteRow[]): ApacheSiteRow[] {
  const byName = new Map<string, ApacheSiteRow[]>();
  for (const r of rows) {
    const key = r.serverName.trim().toLowerCase();
    if (!key || key === '—') continue;
    const list = byName.get(key) ?? [];
    list.push(r);
    byName.set(key, list);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const ids = group.map((g) => g.id);
    for (const g of group) {
      g.conflict = true;
      g.conflictPeers = ids.filter((id) => id !== g.id);
    }
  }
  return rows;
}

/**
 * Unified rows for Apache page (one table): PHP projects + standalone + disk artifacts.
 */
export function listMergedApacheSites(input: {
  dataDir: string;
  projects: Array<Record<string, unknown>>;
}): ApacheSiteRow[] {
  const rows: ApacheSiteRow[] = [];
  const claimedConf = new Set<string>();

  for (const p of input.projects) {
    const runtime = String(p.runtime ?? '').toLowerCase();
    if (runtime !== 'php') continue;
    const id = String(p.id ?? '');
    if (!id) continue;

    const linuxUser = String(p.linux_user ?? p.linuxUser ?? '').trim();
    const domain = String(p.domain ?? '').trim();
    const confPath = linuxUser ? confPathForLinuxUser(input.dataDir, linuxUser) : null;
    const confExists = Boolean(confPath && existsSync(confPath));
    if (confPath) claimedConf.add(confPath);

    const root = projectDocRoot(p);
    rows.push({
      id: `project:${id}`,
      source: 'project',
      projectId: id,
      projectName: String(p.name ?? id),
      serverName: domain || (linuxUser ? `${linuxUser}.local` : '—'),
      kind: 'php',
      root: root !== '—' ? root : undefined,
      target: root,
      ssl: Boolean(p.ssl ?? p.force_https ?? p.forceHttps),
      forceHttps: Boolean(p.force_https ?? p.forceHttps),
      hsts: Boolean(p.hsts),
      confPath: confPath ?? null,
      apply_status: confExists ? 'written' : 'draft',
      linuxUser: linuxUser || null,
      phpVersion: (p.runtime_version ?? p.runtimeVersion) as string | null,
      owned: true,
      conflict: false,
    });
  }

  for (const s of listApacheSites(input.dataDir)) {
    if (s.confPath) claimedConf.add(s.confPath);
    const kind: ApacheSiteKind =
      s.kind === 'static' || s.kind === 'php' ? s.kind : 'proxy';
    const target =
      kind === 'proxy' ? String(s.upstream ?? '—') : String(s.root ?? '—');
    rows.push({
      id: s.id,
      source: 'standalone',
      serverName: s.serverName,
      kind,
      upstream: s.upstream,
      root: s.root,
      target,
      ssl: s.ssl,
      forceHttps: s.forceHttps,
      hsts: s.hsts,
      clientMaxBody: s.clientMaxBody,
      indexes: s.indexes,
      confPath: s.confPath ?? null,
      apply_status: s.apply_status ?? null,
      owned: true,
      conflict: false,
    });
  }

  // Disk artifacts under dataDir/apache/sites not already claimed
  const sitesDir = join(input.dataDir, 'apache', 'sites');
  if (existsSync(sitesDir)) {
    let files: string[] = [];
    try {
      files = readdirSync(sitesDir).filter((f) => f.endsWith('.conf'));
    } catch {
      files = [];
    }
    for (const f of files) {
      const confPath = join(sitesDir, f);
      if (claimedConf.has(confPath)) continue;
      let content = '';
      try {
        content = readFileSync(confPath, 'utf8');
      } catch {
        continue;
      }
      const serverName = parseServerNameFromConf(content) || f.replace(/\.conf$/i, '');
      const root = parseDocRootFromConf(content) ?? undefined;
      const owner = input.projects.find((p) => {
        const home = String(p.home_dir ?? p.homeDir ?? '').trim();
        if (!home || !root) return false;
        const normHome = home.replace(/\/+$/, '');
        const normRoot = root.replace(/\/+$/, '');
        return normRoot === normHome || normRoot.startsWith(`${normHome}/`);
      });
      if (owner) {
        claimedConf.add(confPath);
        continue;
      }
      const isPhp =
        /proxy:unix:.*fpm|\.php|SetHandler/i.test(content) || f.startsWith('ysk-');
      rows.push({
        id: `artifact:${f}`,
        source: 'artifact',
        serverName,
        kind: isPhp ? 'php' : root ? 'static' : 'proxy',
        root,
        target: root ?? '—',
        confPath,
        apply_status: 'written',
        owned: false,
        conflict: false,
      });
    }
  }

  rows.sort((a, b) =>
    a.serverName.localeCompare(b.serverName, undefined, { sensitivity: 'base' }),
  );
  return annotateConflicts(rows);
}

export function readApacheSiteConf(confPath: string | null | undefined): string {
  if (!confPath || !existsSync(confPath)) return '';
  try {
    return readFileSync(confPath, 'utf8');
  } catch {
    return '';
  }
}
