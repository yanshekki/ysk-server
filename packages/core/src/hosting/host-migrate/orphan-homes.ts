/**
 * Leftover /home/ysk-server-<uuid> with no store row.
 * Inventory lists them; delete is confirm + EXECUTE only.
 */
import { resolve } from 'node:path';
import { tl } from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';

const HOME_RE = /^\/home\/ysk-server-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function parseOrphanProjectHome(path: string): { abs: string; projectId: string } | undefined {
  const abs = resolve(String(path || '').trim());
  const m = HOME_RE.exec(abs);
  if (!m) return undefined;
  return { abs, projectId: m[1]!.toLowerCase() };
}

export function storeProjectIds(db: JsonStore): Set<string> {
  return new Set((db.snapshot.projects ?? []).map((p) => String(p.id).toLowerCase()));
}

export async function removeOrphanProjectHome(input: {
  host: HostExecutor;
  db: JsonStore;
  path: string;
  confirmPath: string;
}): Promise<{ ok: boolean; notes: string[]; requiresExecute?: boolean; blocked?: boolean }> {
  const parsed = parseOrphanProjectHome(input.path);
  if (!parsed || input.confirmPath.trim() !== parsed.abs) {
    return { ok: false, notes: [tl('notes.migrate.orphanConfirm')] };
  }
  if (storeProjectIds(input.db).has(parsed.projectId)) {
    return { ok: false, notes: [tl('notes.migrate.orphanStillInStore')] };
  }
  if (!input.host.pathExists(parsed.abs)) {
    return { ok: false, notes: [tl('notes.migrate.orphanMissing', { path: parsed.abs })] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: [tl('notes.migrate.orphanNeedExecute', { path: parsed.abs })],
    };
  }
  const r = await input.host.runCommand(['rm', '-rf', '--', parsed.abs], { timeoutMs: 120_000 });
  if (r.exitCode !== 0) {
    return {
      ok: false,
      notes: [tl('notes.migrate.orphanRmFailed', { detail: (r.stderr || r.stdout || '').slice(0, 200) })],
    };
  }
  return { ok: true, notes: [tl('notes.migrate.orphanRemoved', { path: parsed.abs })] };
}
