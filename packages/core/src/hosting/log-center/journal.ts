import { tl } from '@ysk/shared';
/**
 * Safe journalctl wrappers — fixed argv templates only.
 */

import type { HostExecutor } from '../../host/executor.js';
import type { JournalUnitRow, LogPriority, LogQueryResult, LogSincePreset } from './types.js';

const UNIT_RE = /^[a-zA-Z0-9@._-]+$/;
const PRIORITIES: LogPriority[] = [
  'emerg',
  'alert',
  'crit',
  'err',
  'warning',
  'notice',
  'info',
  'debug',
];

const SINCE_MAP: Record<LogSincePreset, string> = {
  '15m': '15 min ago',
  '1h': '1 hour ago',
  '6h': '6 hours ago',
  '24h': '24 hours ago',
  '7d': '7 days ago',
};

export function sanitizeUnit(unit: string): string | null {
  const u = (unit || '').trim();
  if (!u || u.length > 128 || !UNIT_RE.test(u)) return null;
  // strip path-like
  if (u.includes('/') || u.includes('..')) return null;
  return u;
}

export function sanitizePriority(p?: string): LogPriority | undefined {
  if (!p) return undefined;
  return PRIORITIES.includes(p as LogPriority) ? (p as LogPriority) : undefined;
}

export function sanitizeSince(since?: string): string | undefined {
  if (!since) return undefined;
  const s = since.trim();
  if (SINCE_MAP[s as LogSincePreset]) return SINCE_MAP[s as LogSincePreset];
  // ISO-ish date only
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return s;
  return undefined;
}

export function sanitizeGrep(grep?: string): string | undefined {
  if (!grep) return undefined;
  const g = grep.slice(0, 200);
  // journal -g is regex; reject null bytes
  if (g.includes('\0')) return undefined;
  return g;
}

export function clampLines(n?: number, max = 5000): number {
  const v = Math.floor(Number(n) || 300);
  return Math.max(50, Math.min(max, v));
}

/**
 * List service units (best-effort).
 */
export async function listJournalUnits(host: HostExecutor): Promise<{
  items: JournalUnitRow[];
  notes: string[];
}> {
  const notes: string[] = [];
  const items: JournalUnitRow[] = [];
  const r = await host.runCommand(
    [
      'systemctl',
      'list-units',
      '--type=service',
      '--all',
      '--no-pager',
      '--no-legend',
      '--plain',
    ],
    { timeoutMs: 15_000 },
  );
  if (r.exitCode !== 0) {
    notes.push(tl('notes.auto.t0758', { v0: ((r.stderr || r.stdout || '').slice(0, 200)) }));
    // fallback common units
    for (const u of [
      'nginx.service',
      'ssh.service',
      'sshd.service',
      'fail2ban.service',
      'postfix.service',
      'dovecot.service',
    ]) {
      items.push({ unit: u });
    }
    return { items, notes };
  }
  for (const line of (r.stdout || '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]?.endsWith('.service')) continue;
    const unit = sanitizeUnit(parts[0]);
    if (!unit) continue;
    items.push({
      unit,
      active: parts[2],
      description: parts.slice(4).join(' ').slice(0, 120) || undefined,
    });
    if (items.length >= 200) break;
  }
  notes.push(tl('notes.auto.t0759', { v0: (items.length) }));
  return { items, notes };
}

export async function queryJournal(
  host: HostExecutor,
  opts: {
    unit?: string;
    lines?: number;
    since?: string;
    priority?: string;
    grep?: string;
    maxBytes?: number;
  },
): Promise<LogQueryResult> {
  const notes: string[] = [];
  const linesN = clampLines(opts.lines);
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;

  const unitCandidates: string[] = [];
  if (opts.unit) {
    const u = sanitizeUnit(opts.unit);
    if (!u) {
      return {
        ok: false,
        source: `journal:${opts.unit}`,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [tl('notes.auto.n1108')],
      };
    }
    unitCandidates.push(u);
    // ssh.service ↔ sshd.service fallback (Debian vs RHEL naming)
    if (u === 'ssh.service') unitCandidates.push('sshd.service');
    if (u === 'sshd.service') unitCandidates.push('ssh.service');
  }

  const since = sanitizeSince(opts.since);
  const pri = sanitizePriority(opts.priority);
  const grep = sanitizeGrep(opts.grep);

  const runOnce = async (unit?: string) => {
    const a = ['journalctl', '--no-pager', '-o', 'short-iso', '-n', String(linesN)];
    if (unit) a.push('-u', unit);
    if (since) a.push('--since', since);
    if (pri) a.push('-p', pri);
    if (grep) a.push('-g', grep);
    return host.runCommand(a, { timeoutMs: 30_000 });
  };

  let r =
    unitCandidates.length > 0
      ? await runOnce(unitCandidates[0])
      : await runOnce(undefined);
  let usedUnit = unitCandidates[0];

  // Empty or failed unit → try alternate ssh name
  if (
    unitCandidates.length > 1 &&
    (r.exitCode !== 0 || !(r.stdout || '').trim())
  ) {
    const r2 = await runOnce(unitCandidates[1]);
    if (r2.exitCode === 0 && (r2.stdout || '').trim()) {
      r = r2;
      usedUnit = unitCandidates[1];
      notes.push(tl('notes.auto.t0760', { v0: (usedUnit) }));
    }
  }

  const raw = `${r.stdout || ''}${r.stderr && r.exitCode !== 0 ? '\n' + r.stderr : ''}`;
  let text = raw;
  let truncated = false;
  if (Buffer.byteLength(text) > maxBytes) {
    text = text.slice(-maxBytes);
    truncated = true;
    notes.push(tl('notes.auto.t0761', { v0: (maxBytes) }));
  }
  let lines = text.split(/\r?\n/).filter((l, i, a) => l.length || i < a.length - 1);
  if (lines.length > linesN) {
    lines = lines.slice(-linesN);
    truncated = true;
  }

  if (r.exitCode !== 0) {
    const err = (r.stderr || r.stdout || '').toLowerCase();
    const needsRoot =
      err.includes('permission') || err.includes('not running') || err.includes('access');
    notes.push(
      needsRoot
        ? tl('notes.auto.n0312')
        : `journalctl exit ${r.exitCode}`,
    );
    return {
      ok: lines.length > 0,
      source: usedUnit ? `journal:${usedUnit}` : 'journal',
      lines,
      lineCount: lines.length,
      truncated,
      notes,
      blocked: lines.length === 0,
      requiresRoot: needsRoot && !host.isRoot(),
      rawBytes: Buffer.byteLength(raw),
    };
  }

  notes.push(tl('notes.auto.t0762', { v0: (lines.length) }));
  return {
    ok: true,
    source: usedUnit ? `journal:${usedUnit}` : 'journal',
    lines,
    lineCount: lines.length,
    truncated,
    notes,
    rawBytes: Buffer.byteLength(raw),
  };
}

export async function journalDiskUsage(host: HostExecutor): Promise<string | undefined> {
  const r = await host.runCommand(['journalctl', '--disk-usage'], { timeoutMs: 10_000 });
  if (r.exitCode !== 0) return undefined;
  return (r.stdout || r.stderr || '').trim().slice(0, 200) || undefined;
}

export async function vacuumJournal(
  host: HostExecutor,
  mode: 'time' | 'size',
  value: string,
): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  applied?: boolean;
}> {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      notes: [tl('notes.auto.n1543')],
    };
  }
  if (!host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      requiresRoot: true,
      notes: [tl('notes.auto.n1547')],
    };
  }
  let arg: string;
  if (mode === 'time') {
    if (!/^\d+[dwmh]?$/i.test(value) && !/^\d+days?$/i.test(value)) {
      return { ok: false, notes: [tl('notes.auto.n1110')] };
    }
    arg = `--vacuum-time=${value}`;
  } else {
    if (!/^\d+[KMG]?$/i.test(value)) {
      return { ok: false, notes: [tl('notes.auto.n1109')] };
    }
    arg = `--vacuum-size=${value}`;
  }
  const r = await host.runCommand(['journalctl', arg], { timeoutMs: 120_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return {
    ok: r.exitCode === 0,
    applied: r.exitCode === 0,
    notes: [
      r.exitCode === 0 ? tl('notes.auto.t0763', { v0: (arg) }) : tl('notes.auto.t0764', { v0: (out.slice(0, 300)) }),
      out.slice(0, 200),
    ].filter(Boolean),
  };
}
