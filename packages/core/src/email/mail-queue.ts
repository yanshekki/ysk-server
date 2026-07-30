import { tl } from '@ysk/shared';
/**
 * Mail queue list / flush via postqueue/postsuper when available.
 * Honest: blocked without execute; never fakes success.
 */

import type { HostExecutor } from '../host/executor.js';

export interface MailQueueResult {
  ok: boolean;
  notes: string[];
  items: Array<{ id: string; raw: string }>;
  requiresExecute: boolean;
  blocked?: boolean;
  flushed?: number;
}

export async function listMailQueue(host: HostExecutor): Promise<MailQueueResult> {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      items: [],
      notes: [tl('notes.auto.n1186')],
    };
  }
  const r = await host.runCommand(['bash', '-c', 'command -v postqueue >/dev/null && postqueue -p || echo NO_POSTQUEUE'], {
    timeoutMs: 15_000,
  });
  const out = (r.stdout || r.stderr || '').trim();
  if (out.includes('NO_POSTQUEUE') || r.exitCode !== 0) {
    return {
      ok: false,
      requiresExecute: false,
      items: [],
      notes: [tl('notes.auto.n0386'), out.slice(0, 500)],
    };
  }
  if (/Mail queue is empty|queue is empty/i.test(out)) {
    return { ok: true, requiresExecute: false, items: [], notes: [tl('notes.auto.n0535')] };
  }
  const items: Array<{ id: string; raw: string }> = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-F0-9]+)\s+/i);
    if (m) items.push({ id: m[1]!, raw: line.trim() });
  }
  return {
    ok: true,
    requiresExecute: false,
    items,
    notes: [tl('notes.auto.t0079', { v0: (items.length) })],
  };
}

export async function flushMailQueue(
  host: HostExecutor,
  opts?: { id?: string; all?: boolean },
): Promise<MailQueueResult> {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      items: [],
      notes: [tl('notes.auto.n1175')],
    };
  }
  if (opts?.all) {
    const r = await host.runCommand(['postsuper', '-d', 'ALL'], { timeoutMs: 30_000 });
    return {
      ok: r.exitCode === 0,
      requiresExecute: false,
      items: [],
      flushed: r.exitCode === 0 ? -1 : 0,
      notes: [
        r.exitCode === 0 ? tl('notes.auto.n0786') : tl('notes.auto.t0080', { v0: (r.stderr || r.stdout) }),
      ],
    };
  }
  if (opts?.id) {
    const id = opts.id.replace(/[^A-Za-z0-9]/g, '');
    const r = await host.runCommand(['postsuper', '-d', id], { timeoutMs: 15_000 });
    return {
      ok: r.exitCode === 0,
      requiresExecute: false,
      items: [],
      flushed: r.exitCode === 0 ? 1 : 0,
      notes: [r.exitCode === 0 ? tl('notes.tpl.deleted', { name: id }) : tl('notes.tpl.failedColon', { detail: r.stderr || r.stdout })],
    };
  }
  return { ok: false, requiresExecute: false, items: [], notes: [tl('notes.auto.n1561')] };
}
