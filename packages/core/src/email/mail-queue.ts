import { tl } from 'ysk-server-shared';
/**
 * Mail queue list / flush via postqueue/postsuper when available.
 * Honest: blocked without execute; never fakes success.
 * Auto-heals common Postfix install gaps when execute is on.
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

function needsPostfixQueueHeal(out: string): boolean {
  return (
    /setgid_group/i.test(out) ||
    /Mail system is down/i.test(out) ||
    /showq/i.test(out) ||
    /malformed showq/i.test(out) ||
    /open directory hold/i.test(out) ||
    /scan_dir_push/i.test(out) ||
    /No such file or directory/i.test(out)
  );
}

function classifyQueueError(out: string): string {
  if (/setgid_group/i.test(out)) return tl('notes.email.postqueueSetgidBroken');
  if (/Mail system is down|showq|malformed showq/i.test(out)) {
    return tl('notes.email.postqueueMailDown');
  }
  if (/open directory hold|scan_dir_push/i.test(out)) {
    return tl('notes.email.postqueueSpoolMissing');
  }
  return tl('notes.auto.n0386');
}

async function tryHealPostfixQueue(
  host: HostExecutor,
  out: string,
): Promise<{ notes: string[]; healed: boolean }> {
  if (!host.executeEnabled() || !needsPostfixQueueHeal(out)) {
    return { notes: [], healed: false };
  }
  try {
    const { ensurePostfixRuntimeForQueue } = await import(
      '../hosting/postfix-bootstrap.js'
    );
    const heal = await ensurePostfixRuntimeForQueue(host);
    return { notes: heal.notes.slice(0, 6), healed: true };
  } catch (e) {
    return {
      notes: [e instanceof Error ? e.message : String(e)],
      healed: false,
    };
  }
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
  const { shellBinExists, binPresent } = await import('../hosting/software-probe/index.js');
  if (!(await binPresent(host, 'postqueue'))) {
    return {
      ok: false,
      requiresExecute: false,
      items: [],
      notes: [tl('notes.auto.n0386'), 'NO_POSTQUEUE'],
    };
  }
  const runPostqueue = async () =>
    host.runCommand(
      [
        'bash',
        '-c',
        `if ${shellBinExists('postqueue')}; then postqueue -p 2>&1; else echo NO_POSTQUEUE; fi`,
      ],
      { timeoutMs: 15_000 },
    );

  let r = await runPostqueue();
  let out = (r.stdout || r.stderr || '').trim();
  const healNotes: string[] = [];

  if (
    (out.includes('NO_POSTQUEUE') || r.exitCode !== 0 || needsPostfixQueueHeal(out)) &&
    needsPostfixQueueHeal(out)
  ) {
    const heal = await tryHealPostfixQueue(host, out);
    healNotes.push(...heal.notes);
    if (heal.healed) {
      r = await runPostqueue();
      out = (r.stdout || r.stderr || '').trim();
    }
  }

  if (out.includes('NO_POSTQUEUE') || r.exitCode !== 0) {
    // After heal still down — empty queue while mail is down is still not "ok"
    // unless postqueue truly succeeds with empty message
    if (/Mail queue is empty|queue is empty/i.test(out) && r.exitCode === 0) {
      return {
        ok: true,
        requiresExecute: false,
        items: [],
        notes: [tl('notes.auto.n0535'), ...healNotes.slice(0, 2)],
      };
    }
    return {
      ok: false,
      requiresExecute: false,
      items: [],
      notes: [classifyQueueError(out), ...healNotes.slice(0, 3), out.slice(0, 500)],
    };
  }
  if (/Mail queue is empty|queue is empty/i.test(out)) {
    return {
      ok: true,
      requiresExecute: false,
      items: [],
      notes: [tl('notes.auto.n0535'), ...healNotes.slice(0, 2)],
    };
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
    notes: [
      tl('notes.auto.t0079', { v0: items.length }),
      ...healNotes.slice(0, 2),
    ],
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

  const runFlush = async (): Promise<{ exitCode: number; out: string }> => {
    if (opts?.all) {
      const r = await host.runCommand(['bash', '-c', 'postsuper -d ALL 2>&1'], {
        timeoutMs: 30_000,
      });
      return {
        exitCode: r.exitCode,
        out: (r.stdout || r.stderr || '').trim(),
      };
    }
    if (opts?.id) {
      const id = opts.id.replace(/[^A-Za-z0-9]/g, '');
      const r = await host.runCommand(
        ['bash', '-c', `postsuper -d ${JSON.stringify(id)} 2>&1`],
        { timeoutMs: 15_000 },
      );
      return {
        exitCode: r.exitCode,
        out: (r.stdout || r.stderr || '').trim(),
      };
    }
    return { exitCode: 1, out: '' };
  };

  if (!opts?.all && !opts?.id) {
    return { ok: false, requiresExecute: false, items: [], notes: [tl('notes.auto.n1561')] };
  }

  let { exitCode, out } = await runFlush();
  const healNotes: string[] = [];

  if (exitCode !== 0 && needsPostfixQueueHeal(out)) {
    const heal = await tryHealPostfixQueue(host, out);
    healNotes.push(...heal.notes);
    if (heal.healed) {
      ({ exitCode, out } = await runFlush());
    }
  }

  if (opts?.all) {
    return {
      ok: exitCode === 0,
      requiresExecute: false,
      items: [],
      flushed: exitCode === 0 ? -1 : 0,
      notes:
        exitCode === 0
          ? [tl('notes.auto.n0786'), ...healNotes.slice(0, 2)]
          : [
              tl('notes.auto.t0080', { v0: out || 'postsuper failed' }),
              ...healNotes.slice(0, 3),
              classifyQueueError(out),
            ],
    };
  }

  const id = String(opts?.id ?? '').replace(/[^A-Za-z0-9]/g, '');
  return {
    ok: exitCode === 0,
    requiresExecute: false,
    items: [],
    flushed: exitCode === 0 ? 1 : 0,
    notes:
      exitCode === 0
        ? [tl('notes.tpl.deleted', { name: id }), ...healNotes.slice(0, 2)]
        : [
            tl('notes.tpl.failedColon', { detail: out || 'postsuper failed' }),
            ...healNotes.slice(0, 3),
            classifyQueueError(out),
          ],
  };
}
