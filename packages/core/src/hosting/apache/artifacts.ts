/**
 * Apache disk-artifact (orphan conf) remove + ServerName clash retirement.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { tl } from '@ysk/shared';
import {
  listMergedApacheSites,
  listOwnedApacheConfBasenames,
  parseServerNameFromConf,
} from './sites-list.js';

const SAFE_CONF = /^[A-Za-z0-9._-]+\.conf$/;

export function sanitizeApacheConfBasename(file: string): string | null {
  let raw = String(file ?? '').trim();
  if (raw.startsWith('artifact:')) raw = raw.slice('artifact:'.length);
  // Reject path segments — only bare basenames allowed.
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    return null;
  }
  if (!SAFE_CONF.test(raw)) return null;
  return raw;
}

export type RemoveApacheArtifactResult = {
  ok: boolean;
  notes: string[];
  removed?: string;
  blocked?: boolean;
  requiresExecute?: boolean;
  code?: 'not_found' | 'owned' | 'invalid' | 'conflict_projects';
};

/**
 * Remove an unclaimed managed conf under dataDir/apache/sites.
 * Optionally disable/remove the system twin `ysk-{file}` when execute is on.
 */
export async function removeApacheArtifact(opts: {
  dataDir: string;
  host: HostExecutor;
  /** Basename or `artifact:basename` id */
  fileOrId: string;
  projects?: Array<Record<string, unknown>>;
  /** When true, skip system disable (caller batches reload). */
  skipSystem?: boolean;
}): Promise<RemoveApacheArtifactResult> {
  let raw = String(opts.fileOrId ?? '').trim();
  if (raw.startsWith('artifact:')) raw = raw.slice('artifact:'.length);
  const file = sanitizeApacheConfBasename(raw);
  if (!file) {
    return {
      ok: false,
      notes: [tl('notes.apache.artifactInvalid')],
      code: 'invalid',
    };
  }

  const projects = opts.projects ?? [];
  const owned = listOwnedApacheConfBasenames({
    dataDir: opts.dataDir,
    projects,
  });
  if (owned.has(file)) {
    return {
      ok: false,
      notes: [tl('notes.apache.artifactOwned', { file })],
      code: 'owned',
    };
  }

  const path = join(opts.dataDir, 'apache', 'sites', file);
  if (!existsSync(path)) {
    return {
      ok: false,
      notes: [tl('notes.apache.artifactNotFound', { file })],
      code: 'not_found',
    };
  }

  try {
    unlinkSync(path);
  } catch (e) {
    return {
      ok: false,
      notes: [
        tl('notes.apache.artifactRemoveFailed', {
          file,
          detail: e instanceof Error ? e.message : String(e),
        }),
      ],
    };
  }

  const notes = [tl('notes.apache.artifactRemoved', { file })];

  if (opts.skipSystem) {
    return { ok: true, notes, removed: file };
  }

  if (!opts.host.executeEnabled()) {
    notes.push(tl('notes.apache.artifactSystemPending'));
    return {
      ok: true,
      notes,
      removed: file,
      blocked: true,
      requiresExecute: true,
    };
  }

  const systemNotes = await disableSystemApacheSite(opts.host, file);
  notes.push(...systemNotes);
  notes.push(...(await configtestAndReload(opts.host)));
  return { ok: true, notes, removed: file };
}

/**
 * Remove all artifact rows that conflict on ServerName with an owned row.
 * Does not delete when the only conflict is between two projects.
 */
export async function cleanupApacheServerNameConflicts(opts: {
  dataDir: string;
  host: HostExecutor;
  projects: Array<Record<string, unknown>>;
}): Promise<{
  ok: boolean;
  notes: string[];
  removed: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const rows = listMergedApacheSites({
    dataDir: opts.dataDir,
    projects: opts.projects,
  });
  const notes: string[] = [];
  const toRemove = new Set<string>();

  const byName = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.conflict) continue;
    const key = r.serverName.trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(r);
    byName.set(key, list);
  }

  for (const [name, group] of byName) {
    const projects = group.filter((g) => g.source === 'project');
    const artifacts = group.filter((g) => g.source === 'artifact');
    if (projects.length > 1 && artifacts.length === 0) {
      notes.push(tl('notes.apache.conflictProjectsOnly', { name }));
      continue;
    }
    for (const a of artifacts) {
      const base =
        a.confPath?.split(/[/\\]/).pop() ||
        (a.id.startsWith('artifact:') ? a.id.slice('artifact:'.length) : '');
      if (base) toRemove.add(base);
    }
  }

  const removed: string[] = [];
  let anyBlocked = false;
  let needsExec = false;

  for (const file of toRemove) {
    const r = await removeApacheArtifact({
      dataDir: opts.dataDir,
      host: opts.host,
      fileOrId: file,
      projects: opts.projects,
      skipSystem: true,
    });
    notes.push(...r.notes.slice(0, 3));
    if (r.ok && r.removed) removed.push(r.removed);
    if (r.blocked) anyBlocked = true;
    if (r.requiresExecute) needsExec = true;
  }

  if (removed.length === 0) {
    notes.push(tl('notes.apache.cleanupNothing'));
    return { ok: true, notes, removed: [] };
  }

  if (!opts.host.executeEnabled()) {
    notes.push(tl('notes.apache.artifactSystemPending'));
    return {
      ok: true,
      notes,
      removed,
      blocked: true,
      requiresExecute: true,
    };
  }

  for (const file of removed) {
    notes.push(...(await disableSystemApacheSite(opts.host, file)).slice(0, 2));
  }
  const reloadNotes = await configtestAndReload(opts.host);
  notes.push(...reloadNotes);

  return {
    ok: true,
    notes,
    removed,
    blocked: anyBlocked,
    requiresExecute: needsExec,
  };
}

/**
 * After writing the authoritative project conf, retire other dataDir confs
 * with the same ServerName (orphans). Never deletes another live project's conf.
 */
export async function retireOrphanApacheConfsForDomain(opts: {
  dataDir: string;
  host: HostExecutor;
  domain: string;
  /** Basename of the conf just written (keep). */
  keepBasename: string;
  projects: Array<Record<string, unknown>>;
}): Promise<{ notes: string[]; removed: string[] }> {
  const domain = opts.domain.trim().toLowerCase();
  const keep = sanitizeApacheConfBasename(opts.keepBasename) || opts.keepBasename;
  const notes: string[] = [];
  const removed: string[] = [];
  if (!domain) return { notes, removed };

  const owned = listOwnedApacheConfBasenames({
    dataDir: opts.dataDir,
    projects: opts.projects,
  });
  const sitesDir = join(opts.dataDir, 'apache', 'sites');
  if (!existsSync(sitesDir)) return { notes, removed };

  let files: string[] = [];
  try {
    files = readdirSync(sitesDir).filter((f) => f.endsWith('.conf'));
  } catch {
    return { notes, removed };
  }

  for (const f of files) {
    if (f === keep) continue;
    // Never auto-delete another owned project/standalone conf
    if (owned.has(f) && f !== keep) {
      let content = '';
      try {
        content = readFileSync(join(sitesDir, f), 'utf8');
      } catch {
        continue;
      }
      const sn = parseServerNameFromConf(content)?.toLowerCase();
      if (sn === domain) {
        notes.push(tl('notes.apache.conflictOwnedKeep', { file: f, domain: opts.domain }));
      }
      continue;
    }

    let content = '';
    try {
      content = readFileSync(join(sitesDir, f), 'utf8');
    } catch {
      continue;
    }
    const sn = parseServerNameFromConf(content)?.toLowerCase();
    if (sn !== domain) continue;

    const r = await removeApacheArtifact({
      dataDir: opts.dataDir,
      host: opts.host,
      fileOrId: f,
      projects: opts.projects,
      skipSystem: !opts.host.executeEnabled(),
    });
    notes.push(...r.notes.slice(0, 2));
    if (r.ok && r.removed) {
      removed.push(r.removed);
      notes.push(
        tl('notes.apache.retiredOrphan', { file: r.removed, domain: opts.domain }),
      );
    }
  }

  if (removed.length > 0 && opts.host.executeEnabled()) {
    notes.push(...(await configtestAndReload(opts.host)));
  }

  return { notes, removed };
}

async function disableSystemApacheSite(
  host: HostExecutor,
  file: string,
): Promise<string[]> {
  const notes: string[] = [];
  const stem = file.replace(/\.conf$/i, '');
  // sync installs as ysk-{filename} e.g. ysk-orphan.conf → site name ysk-orphan
  const siteName = `ysk-${stem}`;
  try {
    const isDebian = await binOk(host, 'apache2ctl');
    if (isDebian) {
      await host.runCommand(
        ['bash', '-c', `a2dissite ${shell(siteName)} 2>/dev/null || true`],
        { timeoutMs: 10_000 },
      );
      await host.runCommand(
        [
          'bash',
          '-c',
          `rm -f ${shell(`/etc/apache2/sites-available/${siteName}.conf`)} ${shell(`/etc/apache2/sites-enabled/${siteName}.conf`)} 2>/dev/null || true`,
        ],
        { timeoutMs: 10_000 },
      );
      notes.push(tl('notes.apache.artifactSystemDisabled', { site: siteName }));
    } else {
      await host.runCommand(
        [
          'bash',
          '-c',
          `rm -f ${shell(`/etc/httpd/conf.d/${siteName}.conf`)} 2>/dev/null || true`,
        ],
        { timeoutMs: 10_000 },
      );
      notes.push(tl('notes.apache.artifactSystemDisabled', { site: siteName }));
    }
  } catch (e) {
    notes.push(
      tl('notes.apache.artifactSystemFailed', {
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  return notes;
}

async function configtestAndReload(host: HostExecutor): Promise<string[]> {
  const notes: string[] = [];
  const isDebian = await binOk(host, 'apache2ctl');
  const testCmd = isDebian
    ? (['apache2ctl', 'configtest'] as string[])
    : (['httpd', '-t'] as string[]);
  const test = await host.runCommand(testCmd, { timeoutMs: 15_000 });
  if (test.exitCode !== 0) {
    notes.push(
      tl('notes.apache.configFailed', {
        detail: (test.stderr || test.stdout || '').slice(0, 160),
      }),
    );
    return notes;
  }
  notes.push(tl('notes.apache.configOk'));
  const unit = isDebian ? 'apache2' : 'httpd';
  const rel = await host.runCommand(['systemctl', 'reload', unit], {
    timeoutMs: 30_000,
  });
  if (rel.exitCode === 0) notes.push(tl('notes.apache.reloaded'));
  else notes.push(tl('notes.apache.reloadFailed'));
  return notes;
}

async function binOk(host: HostExecutor, bin: string): Promise<boolean> {
  try {
    const r = await host.runCommand(
      ['bash', '-c', `command -v ${bin} >/dev/null 2>&1 && echo ok || true`],
      { timeoutMs: 5_000 },
    );
    return r.stdout.includes('ok');
  } catch {
    return existsSync(`/usr/sbin/${bin}`) || existsSync(`/usr/bin/${bin}`);
  }
}

function shell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
