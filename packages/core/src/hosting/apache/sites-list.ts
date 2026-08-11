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

function confPathForLinuxUser(dataDir: string, linuxUser: string): string {
  return join(dataDir, 'apache', 'sites', `ysk-${linuxUser}.conf`);
}

function parseServerNameFromConf(content: string): string | null {
  const m = content.match(/^\s*ServerName\s+(\S+)/im);
  return m?.[1]?.trim() || null;
}

function parseDocRootFromConf(content: string): string | null {
  const m = content.match(/^\s*DocumentRoot\s+(\S+)/im);
  return m?.[1]?.trim() || null;
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
      });
    }
  }

  rows.sort((a, b) =>
    a.serverName.localeCompare(b.serverName, undefined, { sensitivity: 'base' }),
  );
  return rows;
}

export function readApacheSiteConf(confPath: string | null | undefined): string {
  if (!confPath || !existsSync(confPath)) return '';
  try {
    return readFileSync(confPath, 'utf8');
  } catch {
    return '';
  }
}
