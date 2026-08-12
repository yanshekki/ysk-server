import { tl } from '@ysk-server/shared';
/**
 * Log Center facade.
 */

import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import {
  listProjectLogs,
  listProjectRelatedLogSources,
  parseProjectLogSourceRest,
  tailProjectLog } from '../project-logs.js';
import { assertLogPathAllowed, listSourceStatuses } from './catalog.js';
import {
  journalDiskUsage,
  listJournalUnits,
  queryJournal,
  vacuumJournal,
  sanitizeUnit } from './journal.js';
import { queryFileLog, maskSecrets } from './file-tail.js';
import {
  DEFAULT_LOG_SETTINGS,
  type LogBookmark,
  type LogCenterSettings,
  type LogOverview,
  type LogQueryResult } from './types.js';

const SETTINGS_KEY = 'log_center';
const LAST_AUTO_VACUUM_KEY = 'log_center_last_auto_vacuum';

/** Parse human disk strings like "1.2G", "500M", "Archived … 1.2G …" → MB */
export function parseDiskToMb(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([\d.]+)\s*([KMGT])i?B?/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const u = m[2].toUpperCase();
  const mult =
    u === 'K' ? 1 / 1024 : u === 'M' ? 1 : u === 'G' ? 1024 : u === 'T' ? 1024 * 1024 : 1;
  return Math.round(n * mult);
}

function normalizeBookmark(b: Partial<LogBookmark>, fallbackId?: string): LogBookmark | null {
  const name = String(b.name || '').trim().slice(0, 80);
  const source = String(b.source || '').trim().slice(0, 200);
  if (!name || !source) return null;
  return {
    id: String(b.id || fallbackId || randomUUID().slice(0, 12)),
    name,
    source,
    since: b.since ? String(b.since).slice(0, 32) : undefined,
    priority: b.priority ? String(b.priority).slice(0, 16) : undefined,
    grep: b.grep ? String(b.grep).slice(0, 200) : undefined,
    lines: b.lines != null ? Math.max(50, Math.min(5000, Number(b.lines) || 300)) : undefined,
    createdAt: b.createdAt || new Date().toISOString() };
}

export function loadLogSettings(db: JsonStore): LogCenterSettings {
  try {
    const raw = db.snapshot.settings?.[SETTINGS_KEY];
    if (!raw) return { ...DEFAULT_LOG_SETTINGS, bookmarks: [], customAllowPaths: [], disabledSources: [] };
    const p = JSON.parse(raw) as Partial<LogCenterSettings>;
    const bookmarks = Array.isArray(p.bookmarks)
      ? p.bookmarks
          .map((b) => normalizeBookmark(b as Partial<LogBookmark>))
          .filter((x): x is LogBookmark => Boolean(x))
          .slice(0, 50)
      : [];
    const customAllowPaths = Array.isArray(p.customAllowPaths)
      ? p.customAllowPaths.map(String).filter(Boolean).slice(0, 40)
      : [];
    return {
      maxLines: Math.max(50, Math.min(5000, Number(p.maxLines) || DEFAULT_LOG_SETTINGS.maxLines)),
      maxBytes: Math.max(
        64 * 1024,
        Math.min(10 * 1024 * 1024, Number(p.maxBytes) || DEFAULT_LOG_SETTINGS.maxBytes),
      ),
      followIntervalSec: Math.max(
        1,
        Math.min(30, Number(p.followIntervalSec) || DEFAULT_LOG_SETTINGS.followIntervalSec),
      ),
      vacuumDefaultDays: Math.max(
        1,
        Math.min(365, Number(p.vacuumDefaultDays) || DEFAULT_LOG_SETTINGS.vacuumDefaultDays),
      ),
      maskSecrets: p.maskSecrets !== false,
      disabledSources: Array.isArray(p.disabledSources)
        ? p.disabledSources.map(String).slice(0, 100)
        : [],
      customAllowPaths,
      bookmarks,
      autoVacuumEnabled: Boolean(p.autoVacuumEnabled),
      autoVacuumTime:
        typeof p.autoVacuumTime === 'string' && /^\d{1,2}:\d{2}$/.test(p.autoVacuumTime)
          ? p.autoVacuumTime
          : DEFAULT_LOG_SETTINGS.autoVacuumTime,
      journalWarnMb: Math.max(
        64,
        Math.min(100_000, Number(p.journalWarnMb) || DEFAULT_LOG_SETTINGS.journalWarnMb),
      ) };
  } catch {
    return {
      ...DEFAULT_LOG_SETTINGS,
      bookmarks: [],
      customAllowPaths: [],
      disabledSources: [] };
  }
}

export function saveLogSettings(
  db: JsonStore,
  patch: Partial<LogCenterSettings>,
): LogCenterSettings {
  const cur = loadLogSettings(db);
  const next: LogCenterSettings = { ...cur, ...patch };

  if (patch.disabledSources) {
    next.disabledSources = patch.disabledSources.map(String).slice(0, 100);
  }
  if (patch.bookmarks) {
    next.bookmarks = patch.bookmarks
      .map((b) => normalizeBookmark(b))
      .filter((x): x is LogBookmark => Boolean(x))
      .slice(0, 50);
  }
  if (patch.customAllowPaths) {
    const cleaned: string[] = [];
    for (const p of patch.customAllowPaths.map(String).slice(0, 40)) {
      const r = assertLogPathAllowed(p);
      if (r.ok && r.path) cleaned.push(r.path);
      else if (p.startsWith('/var/log/') || p.startsWith('/run/log/')) {
        // allow registering path even if file not yet present (no realpath)
        if (!p.includes('..') && !p.includes('\0')) cleaned.push(p);
      }
    }
    next.customAllowPaths = cleaned;
  }
  if (patch.followIntervalSec != null) {
    next.followIntervalSec = Math.max(1, Math.min(30, Number(patch.followIntervalSec) || 3));
  }
  if (patch.maxLines != null) {
    next.maxLines = Math.max(50, Math.min(5000, Number(patch.maxLines) || 500));
  }
  if (patch.maxBytes != null) {
    next.maxBytes = Math.max(
      64 * 1024,
      Math.min(10 * 1024 * 1024, Number(patch.maxBytes) || DEFAULT_LOG_SETTINGS.maxBytes),
    );
  }
  if (patch.vacuumDefaultDays != null) {
    next.vacuumDefaultDays = Math.max(1, Math.min(365, Number(patch.vacuumDefaultDays) || 14));
  }
  if (patch.journalWarnMb != null) {
    next.journalWarnMb = Math.max(64, Math.min(100_000, Number(patch.journalWarnMb) || 1024));
  }
  if (patch.autoVacuumTime != null) {
    next.autoVacuumTime = /^\d{1,2}:\d{2}$/.test(String(patch.autoVacuumTime))
      ? String(patch.autoVacuumTime)
      : cur.autoVacuumTime;
  }
  if (patch.autoVacuumEnabled != null) {
    next.autoVacuumEnabled = Boolean(patch.autoVacuumEnabled);
  }
  if (patch.maskSecrets != null) {
    next.maskSecrets = Boolean(patch.maskSecrets);
  }

  db.snapshot.settings[SETTINGS_KEY] = JSON.stringify(next);
  db.persist();
  return next;
}

export function addLogBookmark(
  db: JsonStore,
  input: Omit<LogBookmark, 'id' | 'createdAt'> & { id?: string },
): LogCenterSettings {
  const cur = loadLogSettings(db);
  const b = normalizeBookmark({ ...input, createdAt: new Date().toISOString() });
  if (!b) return cur;
  const bookmarks = [b, ...cur.bookmarks.filter((x) => x.id !== b.id)].slice(0, 50);
  return saveLogSettings(db, { bookmarks });
}

export function removeLogBookmark(db: JsonStore, id: string): LogCenterSettings {
  const cur = loadLogSettings(db);
  return saveLogSettings(db, {
    bookmarks: cur.bookmarks.filter((b) => b.id !== id) });
}

export async function getLogrotateStatus(host: HostExecutor): Promise<{
  installed: boolean;
  statusText?: string;
  notes: string[];
}> {
  const notes: string[] = [];
  const { binPresent } = await import('../software-probe/index.js');
  const installed = await binPresent(host, 'logrotate');
  if (!installed) {
    return { installed: false, notes: [tl('notes.auto.n0323')] };
  }
  const st = await host.runCommand(
    [
      'bash',
      '-c',
      'test -r /var/lib/logrotate/status && tail -n 40 /var/lib/logrotate/status || echo "(no status file)"',
    ],
    { timeoutMs: 8_000 },
  );
  const statusText = (st.stdout || '').trim().slice(0, 2000) || undefined;
  notes.push(tl('notes.auto.n0322'));
  return { installed: true, statusText, notes };
}

export async function getLogOverview(input: {
  host: HostExecutor;
  dataDir: string;
  db: JsonStore;
}): Promise<LogOverview> {
  const settings = loadLogSettings(input.db);
  const notes: string[] = [];
  const sources = listSourceStatuses({
    disabledIds: settings.disabledSources,
    extraManagedLogDirs: [join(input.dataDir, 'nginx', 'logs')],
    customAllowPaths: settings.customAllowPaths });
  const journalDisk = await journalDiskUsage(input.host);
  const journalDiskMb = parseDiskToMb(journalDisk);

  let varLogHint: string | undefined;
  let varLogMb: number | undefined;
  try {
    const r = await input.host.runCommand(
      ['bash', '-c', 'du -sh /var/log 2>/dev/null | cut -f1'],
      { timeoutMs: 10_000 },
    );
    varLogHint = (r.stdout || '').trim() || undefined;
    varLogMb = parseDiskToMb(varLogHint);
  } catch {
    /* */
  }

  if (journalDiskMb != null && journalDiskMb >= settings.journalWarnMb) {
    notes.push(tl('notes.auto.t0768', { v0: (journalDiskMb), v1: (settings.journalWarnMb) }));
  }

  let recentErrors: number | undefined;
  try {
    const q = await queryJournal(input.host, {
      lines: 200,
      since: '1h',
      priority: 'err' });
    if (q.ok) recentErrors = q.lineCount;
    else notes.push(...q.notes.slice(0, 1));
  } catch {
    /* */
  }

  const logrotate = await getLogrotateStatus(input.host);

  return {
    at: new Date().toISOString(),
    journalDisk,
    journalDiskMb,
    varLogHint,
    varLogMb,
    logrotate,
    quickUnits: [
      { unit: 'nginx.service', label: 'nginx' },
      { unit: 'ssh.service', label: 'ssh' },
      { unit: 'fail2ban.service', label: 'fail2ban' },
      { unit: 'postfix.service', label: 'postfix' },
      { unit: 'dovecot.service', label: 'dovecot' },
    ],
    sourceCount: {
      total: sources.length,
      available: sources.filter((s) => s.available).length },
    recentErrors,
    notes,
    executeEnabled: input.host.executeEnabled(),
    isRoot: input.host.isRoot(),
    settings,
    projectLogs: (() => {
      const idx = listProjectLogIndex(input.db, { dataDir: input.dataDir });
      return {
        projectCount: idx.length,
        fileCount: idx.reduce((n, p) => n + p.fileCount, 0),
        withFiles: idx.filter((p) => p.fileCount > 0).length };
    })() };
}

export async function queryLogSource(input: {
  host: HostExecutor;
  dataDir: string;
  db: JsonStore;
  source: string;
  lines?: number;
  since?: string;
  priority?: string;
  grep?: string;
}): Promise<LogQueryResult> {
  const settings = loadLogSettings(input.db);
  const source = (input.source || '').trim();
  const lines = input.lines ?? settings.maxLines;
  const mask = settings.maskSecrets;

  if (source.startsWith('journal:')) {
    const unit = source.slice('journal:'.length);
    const r = await queryJournal(input.host, {
      unit: unit || undefined,
      lines,
      since: input.since,
      priority: input.priority,
      grep: input.grep,
      maxBytes: settings.maxBytes });
    if (mask) r.lines = r.lines.map(maskSecrets);
    return r;
  }

  if (source.startsWith('file:')) {
    const sources = listSourceStatuses({
      disabledIds: settings.disabledSources,
      extraManagedLogDirs: [join(input.dataDir, 'nginx', 'logs')],
      customAllowPaths: settings.customAllowPaths });
    const def = sources.find((s) => s.id === source);
    // custom id file:custom:… may resolve via resolvedPath
    const path = def?.resolvedPath || def?.paths?.[0];
    if (!path) {
      return {
        ok: false,
        source,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [tl('notes.auto.n0542')],
        blocked: true };
    }
    return queryFileLog({
      path,
      dataDir: input.dataDir,
      lines,
      grep: input.grep,
      maxBytes: settings.maxBytes,
      maskSecrets: mask,
      customAllowPaths: settings.customAllowPaths });
  }

  if (source.startsWith('project:')) {
    const rest = source.slice('project:'.length);
    const { projectId, fileName } = parseProjectLogSourceRest(rest);
    const projects = (input.db.snapshot.projects ?? []) as Array<{
      id: string;
      home_dir?: string;
      name?: string;
    }>;
    const proj = projects.find((p) => p.id === projectId);
    if (!proj?.home_dir) {
      return {
        ok: false,
        source,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [tl('notes.auto.n0688')],
        blocked: true };
    }
    if (!fileName) {
      const files = listProjectLogs(proj.home_dir);
      return {
        ok: true,
        source,
        lines: files.map(
          (f) => `${f.name}\t${f.bytes}B\t${f.mtime}${f.previewable === false ? '\tno-preview' : ''}`,
        ),
        lineCount: files.length,
        truncated: false,
        notes: [tl('notes.auto.t0769', { v0: (proj.name ?? projectId), v1: (files.length) })] };
    }
    try {
      const t = tailProjectLog(proj.home_dir, fileName, lines, settings.maxBytes);
      let outLines = t.lines;
      if (input.grep) {
        const g = input.grep.toLowerCase();
        outLines = outLines.filter((l) => l.toLowerCase().includes(g));
      }
      if (mask) outLines = outLines.map(maskSecrets);
      return {
        ok: t.ok,
        source,
        lines: outLines,
        lineCount: outLines.length,
        truncated: Boolean(t.truncated),
        notes: t.notes };
    } catch (e) {
      return {
        ok: false,
        source,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [e instanceof Error ? e.message : tl('notes.readFailed')],
        blocked: true };
    }
  }

  // project-managed:<id>:access.log|error.log → managed nginx under dataDir
  if (source.startsWith('project-managed:')) {
    const rest = source.slice('project-managed:'.length);
    const [projectId, suffix] = rest.split(':');
    const projects = (input.db.snapshot.projects ?? []) as Array<{
      id: string;
      linux_user?: string;
    }>;
    const proj = projects.find((p) => p.id === projectId);
    const user = proj?.linux_user;
    if (!user || !suffix) {
      return {
        ok: false,
        source,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [tl('notes.auto.n0686')],
        blocked: true };
    }
    const path = join(input.dataDir, 'nginx', 'logs', `${user}.${suffix}`);
    return queryFileLog({
      path,
      dataDir: input.dataDir,
      lines,
      grep: input.grep,
      maxBytes: settings.maxBytes,
      maskSecrets: mask,
      customAllowPaths: settings.customAllowPaths });
  }

  // project-fpm:<id> → /var/log/php*-fpm-{linux_user}.log
  if (source.startsWith('project-fpm:')) {
    const projectId = source.slice('project-fpm:'.length);
    const projects = (input.db.snapshot.projects ?? []) as Array<{
      id: string;
      linux_user?: string;
      runtime_version?: string;
    }>;
    const proj = projects.find((p) => p.id === projectId);
    const user = proj?.linux_user;
    if (!user) {
      return {
        ok: false,
        source,
        lines: [],
        lineCount: 0,
        truncated: false,
        notes: [tl('notes.auto.n0694')],
        blocked: true };
    }
    const ver = (proj?.runtime_version || '8.3').replace(/[^0-9.]/g, '') || '8.3';
    const path = `/var/log/php${ver}-fpm-${user}.log`;
    return queryFileLog({
      path,
      dataDir: input.dataDir,
      lines,
      grep: input.grep,
      maxBytes: settings.maxBytes,
      maskSecrets: mask,
      customAllowPaths: settings.customAllowPaths });
  }

  return {
    ok: false,
    source,
    lines: [],
    lineCount: 0,
    truncated: false,
    notes: [tl('notes.auto.n0965')] };
}

export function listProjectLogIndex(
  db: JsonStore,
  opts?: { dataDir?: string },
): Array<{
  projectId: string;
  name: string;
  domain?: string;
  runtime?: string;
  status?: string;
  linuxUser?: string;
  homeDir?: string;
  files: Array<{
    name: string;
    bytes: number;
    mtime: string;
    kind?: string;
    previewable?: boolean;
    root?: string;
  }>;
  related: Array<{
    id: string;
    kind: string;
    label: string;
    source: string;
    available: boolean;
    meta?: string;
  }>;
  fileCount: number;
}> {
  const projects = (db.snapshot.projects ?? []) as Array<{
    id: string;
    name?: string;
    domain?: string;
    home_dir?: string;
    linux_user?: string;
    runtime?: string;
    runtime_version?: string;
    status?: string;
  }>;
  return projects
    .filter((p) => p.home_dir || p.linux_user)
    .map((p) => {
      const files = p.home_dir
        ? listProjectLogs(p.home_dir).map((f) => ({
            name: f.name,
            bytes: f.bytes,
            mtime: f.mtime,
            kind: f.kind,
            previewable: f.previewable !== false,
            root: f.root }))
        : [];
      const related = listProjectRelatedLogSources({
        projectId: p.id,
        linuxUser: p.linux_user,
        runtime: p.runtime,
        dataDir: opts?.dataDir,
        phpVersion: p.runtime_version });
      return {
        projectId: p.id,
        name: p.name ?? p.domain ?? p.id,
        domain: p.domain,
        runtime: p.runtime,
        status: p.status,
        linuxUser: p.linux_user,
        homeDir: p.home_dir,
        files,
        related,
        fileCount: files.length };
    });
}

export async function exportLogQuery(input: {
  host: HostExecutor;
  dataDir: string;
  db: JsonStore;
  source: string;
  lines?: number;
  since?: string;
  priority?: string;
  grep?: string;
  format?: 'text' | 'jsonl';
}): Promise<{
  ok: boolean;
  id?: string;
  path?: string;
  bytes?: number;
  format?: 'text' | 'jsonl';
  notes: string[];
}> {
  const format = input.format === 'jsonl' ? 'jsonl' : 'text';
  const q = await queryLogSource({
    ...input,
    lines: Math.min(input.lines ?? 2000, 5000) });
  if (!q.ok && !q.lines.length) {
    return { ok: false, notes: q.notes, format };
  }
  const dir = join(input.dataDir, 'logs-export');
  mkdirSync(dir, { recursive: true });
  const id = randomUUID().slice(0, 12);
  const ext = format === 'jsonl' ? 'jsonl' : 'log';
  const path = join(dir, `${id}.${ext}`);
  let body: string;
  if (format === 'jsonl') {
    body =
      q.lines
        .map((line, i) =>
          JSON.stringify({
            i,
            source: q.source,
            line }),
        )
        .join('\n') + (q.lines.length ? '\n' : '');
  } else {
    body = q.lines.join('\n') + (q.lines.length ? '\n' : '');
  }
  writeFileSync(path, body, 'utf8');
  try {
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const fp = join(dir, f);
      try {
        const st = statSync(fp);
        if (now - st.mtimeMs > 3600_000) unlinkSync(fp);
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
  return {
    ok: true,
    id,
    path,
    bytes: Buffer.byteLength(body),
    format,
    notes: [tl('notes.auto.t0770', { v0: (q.lineCount), v1: (format) }), ...q.notes.slice(0, 2)] };
}

/**
 * Daily auto-vacuum tick — call from scheduler ~every 15–60 min.
 * Honest: only runs when autoVacuumEnabled + EXECUTE + root + time window + not yet today.
 */
export async function runLogAutoVacuumTick(input: {
  host: HostExecutor;
  db: JsonStore;
}): Promise<{ ran: boolean; notes: string[] }> {
  const settings = loadLogSettings(input.db);
  const notes: string[] = [];
  if (!settings.autoVacuumEnabled) {
    return { ran: false, notes: [tl('notes.auto.n0229')] };
  }
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return { ran: false, notes: [tl('notes.auto.n1537')] };
  }

  const [hhStr, mmStr] = settings.autoVacuumTime.split(':');
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  const now = new Date();
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const minsTarget = hh * 60 + (Number.isFinite(mm) ? mm : 0);
  // window: target time .. + 90 minutes
  if (minsNow < minsTarget || minsNow > minsTarget + 90) {
    return { ran: false, notes: [tl('notes.auto.t0771', { v0: (settings.autoVacuumTime) })] };
  }

  const today = now.toISOString().slice(0, 10);
  const last = input.db.snapshot.settings?.[LAST_AUTO_VACUUM_KEY];
  if (last === today) {
    return { ran: false, notes: [tl('notes.auto.n0511')] };
  }

  const days = settings.vacuumDefaultDays;
  const value = `${days}d`;
  const r = await vacuumJournal(input.host, 'time', value);
  notes.push(...r.notes);
  if (r.ok) {
    input.db.snapshot.settings[LAST_AUTO_VACUUM_KEY] = today;
    input.db.persist();
  }
  return { ran: Boolean(r.ok), notes };
}

export { listJournalUnits, vacuumJournal, sanitizeUnit, listSourceStatuses, queryJournal };
