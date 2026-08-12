/**
 * Apache managed sites CRUD + apply.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ErrorCodes, YskError, tl } from '@yanshekki/shared';
import type { HostExecutor } from '../../host/executor.js';
import { renderApacheSite } from './render-site.js';
import { syncApacheConfigs } from './sync.js';
import type { ApacheSiteKind, ApacheSiteRecord } from './types.js';

function sitesPath(dataDir: string): string {
  return join(dataDir, 'apache', 'sites.json');
}

function sitesDir(dataDir: string): string {
  return join(dataDir, 'apache', 'sites');
}

export function listApacheSites(dataDir: string): ApacheSiteRecord[] {
  const p = sitesPath(dataDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as { items?: ApacheSiteRecord[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function saveApacheSites(dataDir: string, items: ApacheSiteRecord[]): void {
  mkdirSync(join(dataDir, 'apache'), { recursive: true });
  writeFileSync(
    sitesPath(dataDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
}

export function createApacheSite(
  dataDir: string,
  input: {
    serverName: string;
    kind?: ApacheSiteKind;
    upstream?: string;
    root?: string;
    ssl?: boolean;
  },
): ApacheSiteRecord {
  const serverName = String(input.serverName ?? '').trim().toLowerCase();
  if (!serverName) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.apache.needServerName'), {
      httpStatus: 400,
    });
  }
  const items = listApacheSites(dataDir);
  if (items.some((s) => s.serverName === serverName)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.apache.siteExists'), {
      httpStatus: 409,
    });
  }
  const now = new Date().toISOString();
  const rec: ApacheSiteRecord = {
    id: randomUUID(),
    serverName,
    kind: input.kind === 'static' || input.kind === 'php' ? input.kind : 'proxy',
    upstream: input.upstream,
    root: input.root,
    ssl: Boolean(input.ssl),
    apply_status: 'draft',
    created_at: now,
    updated_at: now,
  };
  items.unshift(rec);
  saveApacheSites(dataDir, items);
  return rec;
}

export function updateApacheSite(
  dataDir: string,
  id: string,
  patch: Partial<ApacheSiteRecord>,
): ApacheSiteRecord {
  const items = listApacheSites(dataDir);
  const i = items.findIndex((s) => s.id === id);
  if (i < 0) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.apache.siteNotFound'), {
      httpStatus: 404,
    });
  }
  const next = {
    ...items[i],
    ...patch,
    id: items[i].id,
    updated_at: new Date().toISOString(),
  };
  items[i] = next;
  saveApacheSites(dataDir, items);
  return next;
}

export function deleteApacheSite(dataDir: string, id: string): boolean {
  const items = listApacheSites(dataDir);
  const rec = items.find((s) => s.id === id);
  if (!rec) return false;
  const next = items.filter((s) => s.id !== id);
  saveApacheSites(dataDir, next);
  if (rec.confPath && existsSync(rec.confPath)) {
    try {
      unlinkSync(rec.confPath);
    } catch {
      /* ignore */
    }
  }
  return true;
}

export async function applyApacheSite(opts: {
  dataDir: string;
  host: HostExecutor;
  id: string;
}): Promise<{
  ok: boolean;
  site: ApacheSiteRecord | null;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const items = listApacheSites(opts.dataDir);
  const rec = items.find((s) => s.id === opts.id);
  if (!rec) {
    return { ok: false, site: null, notes: [tl('notes.apache.siteNotFound')] };
  }
  mkdirSync(sitesDir(opts.dataDir), { recursive: true });
  const slug = rec.serverName.replace(/[^a-zA-Z0-9._-]/g, '_') || rec.id.slice(0, 8);
  const confPath = join(sitesDir(opts.dataDir), `ysk_site_${slug}.conf`);
  const conf = renderApacheSite({
    serverName: rec.serverName,
    kind: rec.kind,
    upstream: rec.upstream,
    root: rec.root,
    ssl: rec.ssl,
    forceHttps: rec.forceHttps,
    hsts: rec.hsts,
    clientMaxBody:
      rec.clientMaxBody && rec.clientMaxBody !== 'inherit'
        ? rec.clientMaxBody
        : undefined,
    indexes: rec.indexes,
  });
  writeFileSync(confPath, conf, 'utf8');
  const notes = [tl('notes.apache.wroteConf', { path: confPath })];
  const updated = updateApacheSite(opts.dataDir, rec.id, {
    confPath,
    apply_status: 'written',
  });

  if (!opts.host.executeEnabled()) {
    notes.push(tl('notes.apache.needExecute'));
    return {
      ok: false,
      site: updated,
      notes,
      blocked: true,
      requiresExecute: true,
    };
  }

  // Standalone apply: only push this site's conf (+ other standalone records),
  // never unclaimed orphan artifacts (ServerName clash risk).
  const onlyBasenames = new Set<string>([basename(confPath)]);
  for (const s of listApacheSites(opts.dataDir)) {
    if (s.confPath) {
      const b = basename(s.confPath);
      if (b.endsWith('.conf')) onlyBasenames.add(b);
    }
  }
  const sync = await syncApacheConfigs({
    dataDir: opts.dataDir,
    host: opts.host,
    onlyBasenames,
  });
  notes.push(...sync.notes.slice(0, 5));
  const final = updateApacheSite(opts.dataDir, rec.id, {
    confPath,
    apply_status: sync.ok ? 'applied' : 'failed',
  });
  return {
    ok: sync.ok,
    site: final,
    notes,
    blocked: sync.blocked,
    requiresExecute: sync.requiresExecute,
  };
}
