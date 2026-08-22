/**
 * In-place host crontab line edit. Does not go through installCrontab (no -u).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { assertSafeCronCommand, assertSafeCronSchedule } from './extras.js';

const AT_SCHEDULE =
  /^@(reboot|hourly|daily|weekly|monthly|yearly|annually)$/i;

export type HostCronRewriteKind = 'replace' | 'comment' | 'uncomment' | 'delete' | 'adopt';

export type HostCronRewriteNext =
  | { type: 'replace'; schedule: string; command: string }
  | { type: 'comment' }
  | { type: 'uncomment' }
  | { type: 'delete' }
  | { type: 'adopt'; managedId: string };

export function splitCrontabBody(text: string): string[] {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function findRawLineIndexes(lines: string[], oldRaw: string): number[] {
  const want = String(oldRaw ?? '').replace(/\r$/, '');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === want) hits.push(i);
  }
  return hits;
}

export function assertHostCronUser(user: string): string {
  const u = String(user ?? '').trim();
  if (u === 'current') return u;
  if (!u || !/^[a-zA-Z0-9_.-]+$/.test(u)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.cron.hostUserInvalid'), { httpStatus: 400 });
  }
  return u;
}

export function assertHostCronSchedule(schedule: string): string {
  const s = String(schedule ?? '').trim();
  if (!s || /[\r\n]/.test(s)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.cron.hostScheduleInvalid'), { httpStatus: 400 });
  }
  if (AT_SCHEDULE.test(s)) return s.toLowerCase();
  return assertSafeCronSchedule(s);
}

export function buildHostCronJobLine(schedule: string, command: string, managedId?: string): string {
  const sched = assertHostCronSchedule(schedule);
  const cmd = assertSafeCronCommand(command);
  const tag = managedId?.trim() ? ` # ysk:${managedId.trim()}` : '';
  return `${sched} ${cmd}${tag}`;
}

export function applyHostCronLineEdit(
  lines: string[],
  index: number,
  next: HostCronRewriteNext,
): { lines: string[]; preview: string } {
  const current = lines[index] ?? '';
  let replacement: string | null;
  if (next.type === 'delete') {
    replacement = null;
  } else if (next.type === 'comment') {
    replacement = current.trimStart().startsWith('#') ? current : `# ${current}`;
  } else if (next.type === 'uncomment') {
    replacement = current.replace(/^#\s?/, '');
  } else if (next.type === 'replace') {
    const live = buildHostCronJobLine(next.schedule, next.command);
    replacement = current.trimStart().startsWith('#') ? `# ${live}` : live;
  } else {
    const stripped = current.replace(/^#\s?/, '');
    const parsed = parseJobFields(stripped);
    if (!parsed) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.cron.hostLineNotJob'), { httpStatus: 400 });
    }
    replacement = buildHostCronJobLine(parsed.schedule, parsed.command, next.managedId);
  }
  const out = [...lines];
  if (replacement == null) out.splice(index, 1);
  else out[index] = replacement;
  const preview = replacement == null ? '' : replacement;
  return { lines: out, preview };
}

export function joinCrontabBody(lines: string[]): string {
  const body = lines.join('\n');
  return body.endsWith('\n') ? body : `${body}\n`;
}

export function parseJobFields(text: string): { schedule: string; command: string } | null {
  const t = String(text ?? '').trim();
  if (!t || t.startsWith('#')) return null;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) return null;
  if (t.startsWith('@')) {
    const sp = t.search(/\s+/);
    if (sp < 0) return null;
    const schedule = t.slice(0, sp);
    let command = t.slice(sp).trim();
    command = command.replace(/\s+#\s*ysk:[^\s#]+/i, '').trim();
    if (!command) return null;
    return { schedule, command };
  }
  const m = t.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
  if (!m) return null;
  const command = (m[2] ?? '').replace(/\s+#\s*ysk:[^\s#]+/i, '').trim();
  if (!command) return null;
  return { schedule: m[1] ?? '', command };
}

/** Crontabs `installCrontab` actually writes (process user, usually root). */
export function isInstallOwnedCronUser(user: string, processUser?: string): boolean {
  const u = String(user ?? '').trim();
  if (u === 'current' || u === 'root') return true;
  const self = (processUser ?? '').trim();
  return Boolean(self) && u === self;
}

export function crontabReadArgv(user: string, isRoot: boolean): string[] {
  if (isRoot && user && user !== 'current') return ['crontab', '-u', user, '-l'];
  return ['crontab', '-l'];
}

export function crontabWriteArgv(user: string, isRoot: boolean, file: string): string[] {
  if (isRoot && user && user !== 'current') return ['crontab', '-u', user, file];
  return ['crontab', file];
}

export type HostCronRewriteResult = {
  ok: boolean;
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  notes: string[];
  preview?: string;
  user: string;
  written?: boolean;
};

export async function rewriteHostCronLine(input: {
  host: HostExecutor;
  dataDir: string;
  user: string;
  oldRaw: string;
  next: HostCronRewriteNext;
}): Promise<HostCronRewriteResult> {
  const user = assertHostCronUser(input.user);
  const isRoot = input.host.isRoot();
  if (!isRoot && user !== 'current') {
    return {
      ok: false,
      blocked: true,
      requiresRoot: true,
      user,
      notes: [tl('notes.cron.hostRewriteNeedRoot')],
    };
  }
  const oldRaw = String(input.oldRaw ?? '').replace(/\r$/, '');
  if (!oldRaw.trim()) {
    return { ok: false, user, notes: [tl('notes.cron.hostLineMissing')] };
  }

  const read = await input.host.runCommand(crontabReadArgv(user, isRoot), { timeoutMs: 8_000 });
  const text =
    read.exitCode === 0
      ? String(read.stdout || '')
      : /no crontab/i.test(String(read.stderr || '')) || /no crontab/i.test(String(read.stdout || ''))
        ? ''
        : null;
  if (text == null) {
    return {
      ok: false,
      user,
      notes: [tl('notes.cron.hostReadFailed', { detail: (read.stderr || read.stdout || `exit=${read.exitCode}`).slice(0, 200) })],
    };
  }

  const lines = splitCrontabBody(text);
  const hits = findRawLineIndexes(lines, oldRaw);
  if (hits.length === 0) {
    return { ok: false, user, notes: [tl('notes.cron.hostLineMissing')] };
  }
  if (hits.length > 1) {
    return { ok: false, user, notes: [tl('notes.cron.hostLineDuplicate', { count: hits.length })] };
  }
  const index = hits[0]!;
  let edited: { lines: string[]; preview: string };
  try {
    edited = applyHostCronLineEdit(lines, index, input.next);
  } catch (e) {
    const msg = e instanceof YskError ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, user, notes: [msg] };
  }
  const body = joinCrontabBody(edited.lines);

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      user,
      preview: edited.preview,
      notes: [tl('notes.cron.hostRewriteNeedExecute'), edited.preview ? tl('notes.cron.hostPreview', { line: edited.preview }) : tl('notes.cron.hostPreviewDelete')],
    };
  }

  const dir = join(input.dataDir.replace(/\/+$/, ''), 'cron');
  mkdirSync(dir, { recursive: true });
  const safeUser = user.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'user';
  const file = join(dir, `host-${safeUser}.crontab`);
  writeFileSync(file, body, 'utf8');
  const run = await input.host.runCommand(crontabWriteArgv(user, isRoot, file), { timeoutMs: 12_000 });
  const ok = run.exitCode === 0;
  return {
    ok,
    user,
    written: ok,
    preview: edited.preview,
    notes: ok
      ? [tl('notes.cron.hostRewritten', { user }), edited.preview ? tl('notes.cron.hostPreview', { line: edited.preview }) : tl('notes.cron.hostPreviewDelete')]
      : [tl('notes.cron.hostWriteFailed', { detail: (run.stderr || `exit=${run.exitCode}`).slice(0, 240) })],
  };
}

export async function runHostCronCommand(input: {
  host: HostExecutor;
  user: string;
  command: string;
}): Promise<HostCronRewriteResult & { exitCode?: number; stdout?: string; stderr?: string }> {
  const user = assertHostCronUser(input.user);
  const cmd = assertSafeCronCommand(input.command);
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      user,
      notes: [tl('notes.cron.hostRunNeedExecute')],
    };
  }
  const isRoot = input.host.isRoot();
  if (!isRoot && user !== 'current') {
    return {
      ok: false,
      blocked: true,
      requiresRoot: true,
      user,
      notes: [tl('notes.cron.hostRewriteNeedRoot')],
    };
  }
  const argv =
    isRoot && user && user !== 'current' && user !== 'root'
      ? ['runuser', '-u', user, '--', 'bash', '-lc', cmd]
      : ['bash', '-lc', cmd];
  const r = await input.host.runCommand(argv, { timeoutMs: 120_000 });
  return {
    ok: r.exitCode === 0,
    user,
    exitCode: r.exitCode,
    stdout: (r.stdout || '').slice(0, 4000),
    stderr: (r.stderr || '').slice(0, 4000),
    notes: [
      tl('notes.cron.hostRan', { user }),
      `exit=${r.exitCode}`,
      r.exitCode === 0 ? tl('notes.tpl.success') : tl('notes.failed'),
    ],
  };
}

export function findHostJobRaw(
  text: string,
  schedule: string,
  command: string,
): { ok: true; raw: string } | { ok: false; reason: 'missing' | 'duplicate'; count: number } {
  const sched = String(schedule ?? '').trim();
  const cmd = String(command ?? '').trim();
  const lines = splitCrontabBody(text);
  const hits: string[] = [];
  for (const raw of lines) {
    const parsed = parseJobFields(raw.replace(/^#\s?/, ''));
    if (!parsed) continue;
    if (parsed.schedule === sched && parsed.command === cmd) hits.push(raw);
  }
  if (hits.length === 1) return { ok: true, raw: hits[0]! };
  if (hits.length === 0) return { ok: false, reason: 'missing', count: 0 };
  return { ok: false, reason: 'duplicate', count: hits.length };
}
