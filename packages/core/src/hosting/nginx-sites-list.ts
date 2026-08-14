/**
 * Merged Nginx site list: project edge + standalone managed nginx_sites.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { JsonStore } from '../db/store.js';
import { listResources } from './managed-resources.js';

export type NginxSiteSource = 'project' | 'standalone';

export type NginxSiteKind = 'proxy' | 'static' | 'php';

export type NginxSiteRow = {
  id: string;
  source: NginxSiteSource;
  projectId?: string;
  projectName?: string;
  serverName: string;
  kind: NginxSiteKind;
  target: string;
  ssl: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  confPath?: string | null;
  apply_status?: string | null;
  runtime?: string | null;
  port?: number | null;
};

function kindFromRuntime(runtime?: string | null): NginxSiteKind {
  const r = String(runtime ?? '').toLowerCase();
  if (r === 'static') return 'static';
  if (r === 'php') return 'php';
  return 'proxy';
}

function certDomainSet(db: JsonStore): Set<string> {
  const set = new Set<string>();
  const certs = (db.snapshot as { certificates?: Array<Record<string, unknown>> }).certificates ?? [];
  for (const c of certs) {
    const d = String(c.domain ?? '').trim().toLowerCase();
    if (d) set.add(d);
  }
  return set;
}

function confMentionsSsl(confPath: string | null | undefined): boolean {
  if (!confPath || !existsSync(confPath)) return false;
  try {
    return /ssl_certificate\s+\S+/.test(readFileSync(confPath, 'utf8'));
  } catch {
    return false;
  }
}

function projectTarget(p: Record<string, unknown>): string {
  const kind = kindFromRuntime(p.runtime as string);
  if (kind === 'static' || kind === 'php') {
    return String(p.docRoot ?? p.home_dir ?? p.homeDir ?? '—');
  }
  const port = p.port != null ? Number(p.port) : null;
  if (port && Number.isFinite(port)) return `127.0.0.1:${port}`;
  return '—';
}

/**
 * Unified rows for Nginx page (one table).
 */
export function listMergedNginxSites(input: {
  db: JsonStore;
  projects: Array<Record<string, unknown>>;
}): NginxSiteRow[] {
  const rows: NginxSiteRow[] = [];
  const certs = certDomainSet(input.db);

  for (const p of input.projects) {
    const domain = String(p.domain ?? '').trim();
    if (!domain && !String(p.nginxConfigPath ?? p.nginx_config_path ?? '').trim()) {
      continue;
    }
    const id = String(p.id ?? '');
    if (!id) continue;
    const confPath = (p.nginxConfigPath ?? p.nginx_config_path) as string | undefined;
    const hasCert = Boolean(domain && certs.has(domain.toLowerCase()));
    rows.push({
      id: `project:${id}`,
      source: 'project',
      projectId: id,
      projectName: String(p.name ?? id),
      serverName: domain || '—',
      kind: kindFromRuntime(p.runtime as string),
      target: projectTarget(p),
      ssl: Boolean(p.ssl ?? p.force_https ?? p.forceHttps) || hasCert || confMentionsSsl(confPath),
      forceHttps: Boolean(p.force_https ?? p.forceHttps),
      hsts: Boolean(p.hsts),
      confPath: confPath ?? null,
      apply_status: confPath ? 'written' : 'draft',
      runtime: (p.runtime as string) ?? null,
      port: p.port != null ? Number(p.port) : null,
    });
  }

  for (const s of listResources(input.db, 'nginx_sites')) {
    const kind = String(s.kind ?? 'proxy') as NginxSiteKind;
    const target =
      kind === 'proxy'
        ? String(s.upstream ?? '—')
        : String(s.root ?? '—');
    rows.push({
      id: String(s.id),
      source: 'standalone',
      serverName: String(s.serverName ?? s.server_name ?? '—'),
      kind: kind === 'static' || kind === 'php' ? kind : 'proxy',
      target,
      ssl:
        Boolean(s.ssl) ||
        certs.has(String(s.serverName ?? s.server_name ?? '').trim().toLowerCase()) ||
        confMentionsSsl((s.confPath as string) ?? null),
      forceHttps: Boolean(s.forceHttps ?? s.force_https),
      hsts: Boolean(s.hsts),
      confPath: (s.confPath as string) ?? null,
      apply_status: (s.apply_status as string) ?? null,
    });
  }

  rows.sort((a, b) =>
    a.serverName.localeCompare(b.serverName, undefined, { sensitivity: 'base' }),
  );
  return rows;
}

export function readNginxSiteConf(confPath: string | null | undefined): string {
  if (!confPath || !existsSync(confPath)) return '';
  try {
    return readFileSync(confPath, 'utf8');
  } catch {
    return '';
  }
}
