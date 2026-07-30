/**
 * Project log discovery + safe tail under home/logs, home/log, and optional extra dirs.
 * Fail-closed: never escape project home.
 */

import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  lstatSync } from 'node:fs';
import { join, relative, sep, normalize } from 'node:path';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import { tailFileLines } from './log-center/file-tail.js';

const MAX_DEPTH = 4;
const MAX_FILES_PER_PROJECT = 80;
const LOG_SUBDIRS = ['logs', 'log'] as const;

export type ProjectLogKind = 'app' | 'rotated' | 'compressed' | 'other';

export interface LogFileInfo {
  /**
   * Relative identifier for API:
   * - under logs/log: e.g. app.out.log or app/debug.log
   * - under extra dir: e.g. ~storage/logs/laravel.log (home-relative with ~ prefix)
   */
  name: string;
  /** Absolute path */
  path: string;
  bytes: number;
  mtime: string;
  /** Which root label */
  root?: string;
  kind?: ProjectLogKind;
  /** Preview not supported (e.g. .gz) */
  previewable?: boolean;
}

export interface LogTailResult {
  ok: boolean;
  file: string;
  path: string;
  lines: string[];
  bytes: number;
  notes: string[];
  truncated?: boolean;
  matchedLines?: number;
}

export interface ProjectRelatedLogSource {
  id: string;
  kind: 'journal' | 'managed-nginx' | 'php-fpm';
  label: string;
  source: string;
  available: boolean;
  meta?: string;
}

export interface ListProjectLogsOpts {
  /** Extra dirs relative to home (e.g. storage/logs, var/log) */
  extraDirs?: string[];
  /** Filter by filename / relative path (case-insensitive substring) */
  nameFilter?: string;
}

/**
 * Normalize user-supplied extra log dirs — only relative paths under home.
 * Rejects absolute paths, .., empty, and reserved logs/log (already scanned).
 */
export function normalizeExtraLogDirs(raw: unknown): {
  dirs: string[];
  notes: string[];
} {
  const notes: string[] = [];
  if (raw == null) return { dirs: [], notes };
  const arr = Array.isArray(raw)
    ? raw.map(String)
    : String(raw)
        .split(/[\n,]+/)
        .map((s) => s.trim());
  const dirs: string[] = [];
  for (const item of arr) {
    let s = item.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!s) continue;
    if (s.startsWith('~/')) s = s.slice(2);
    if (s.startsWith('/') || s.includes('..') || s.includes('\0') || s.includes(':')) {
      notes.push(tl('notes.auto.t0234', { v0: (item) }));
      continue;
    }
    if (!/^[a-zA-Z0-9._@+-]+(?:\/[a-zA-Z0-9._@+-]+)*$/.test(s)) {
      notes.push(tl('notes.auto.t0235', { v0: (item) }));
      continue;
    }
    if (s === 'logs' || s === 'log' || s.startsWith('logs/') || s.startsWith('log/')) {
      notes.push(tl('notes.auto.t0236', { v0: (s) }));
      continue;
    }
    if (!dirs.includes(s)) dirs.push(s);
    if (dirs.length >= 12) {
      notes.push(tl('notes.auto.n0931'));
      break;
    }
  }
  return { dirs, notes };
}

function classifyName(name: string): ProjectLogKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gz') || lower.endsWith('.bz2') || lower.endsWith('.xz')) {
    return 'compressed';
  }
  if (/\.\d+$/.test(lower) || lower.includes('.log.')) return 'rotated';
  if (
    lower.includes('.log') ||
    lower.endsWith('.out') ||
    lower.endsWith('.err') ||
    lower.endsWith('.txt')
  ) {
    return 'app';
  }
  return 'other';
}

function isPreviewable(name: string): boolean {
  return classifyName(name) !== 'compressed';
}

function looksLikeLogFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('.log') ||
    lower.endsWith('.out') ||
    lower.endsWith('.err') ||
    lower.endsWith('.txt') ||
    /\.log\.\d/.test(lower)
  );
}

/**
 * Resolve and validate a log file identifier under home.
 * Accepts:
 * - app.out.log (under logs/ or log/)
 * - ~storage/logs/app.log (home-relative extra)
 */
export function resolveProjectLogPath(
  homeDir: string,
  relPath: string,
  extraDirs: string[] = [],
): { ok: true; path: string; rel: string; root: string } | { ok: false; notes: string[] } {
  if (!homeDir || !relPath || relPath.includes('\0')) {
    return { ok: false, notes: [tl('notes.invalidPath')] };
  }
  let raw = relPath.replace(/\\/g, '/').replace(/^\/+/, '');

  try {
    const homeReal = realpathSync(homeDir);

    // Extra path: ~relative/from/home
    if (raw.startsWith('~')) {
      const homeRel = raw.slice(1).replace(/^\/+/, '');
      if (
        !homeRel ||
        homeRel.includes('..') ||
        !/^[a-zA-Z0-9._@+-]+(?:\/[a-zA-Z0-9._@+-]+)*$/.test(homeRel)
      ) {
        return { ok: false, notes: [tl('notes.auto.n1602')] };
      }
      // must be under one of extraDirs
      const allowed = normalizeExtraLogDirs(extraDirs).dirs;
      const underExtra = allowed.some(
        (d) => homeRel === d || homeRel.startsWith(d + '/'),
      );
      if (!underExtra) {
        return { ok: false, notes: [tl('notes.auto.n1459')] };
      }
      const candidate = join(homeReal, ...homeRel.split('/'));
      if (!existsSync(candidate)) {
        return { ok: false, notes: [tl('notes.tpl.logNotFound', { path: homeRel })] };
      }
      let real: string;
      try {
        const lst = lstatSync(candidate);
        if (lst.isSymbolicLink()) {
          real = realpathSync(candidate);
        } else if (lst.isFile()) {
          real = realpathSync(candidate);
        } else {
          return { ok: false, notes: [tl('notes.notRegularFile')] };
        }
      } catch {
        return { ok: false, notes: [tl('notes.pathResolveFailed')] };
      }
      if (real !== homeReal && !real.startsWith(homeReal + sep)) {
        return { ok: false, notes: [tl('notes.auto.n0441')] };
      }
      return { ok: true, path: real, rel: `~${homeRel}`, root: 'extra' };
    }

    // Default: under logs/ or log/
    let rel = raw;
    if (rel.startsWith('logs/')) rel = rel.slice(5);
    else if (rel.startsWith('log/')) rel = rel.slice(4);

    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes(':')) {
      return { ok: false, notes: [tl('notes.auto.n0879')] };
    }
    if (!/^[a-zA-Z0-9._@+-]+(?:\/[a-zA-Z0-9._@+-]+)*$/.test(rel)) {
      return { ok: false, notes: [tl('notes.auto.n0919')] };
    }

    for (const rootName of LOG_SUBDIRS) {
      const root = join(homeReal, rootName);
      if (!existsSync(root)) continue;
      let rootReal: string;
      try {
        rootReal = realpathSync(root);
      } catch {
        continue;
      }
      if (rootReal !== homeReal && !rootReal.startsWith(homeReal + sep)) {
        continue;
      }
      const candidate = join(rootReal, ...rel.split('/'));
      if (!existsSync(candidate)) continue;
      let real: string;
      try {
        const lst = lstatSync(candidate);
        if (lst.isSymbolicLink()) {
          real = realpathSync(candidate);
        } else if (lst.isFile()) {
          real = realpathSync(candidate);
        } else {
          return { ok: false, notes: [tl('notes.notRegularFile')] };
        }
      } catch {
        return { ok: false, notes: [tl('notes.pathResolveFailed')] };
      }
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        return { ok: false, notes: [tl('notes.auto.n0440')] };
      }
      const st = statSync(real);
      if (!st.isFile()) {
        return { ok: false, notes: [tl('notes.notRegularFile')] };
      }
      return { ok: true, path: real, rel, root: rootName };
    }
    return { ok: false, notes: [tl('notes.tpl.logNotFound', { path: rel })] };
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : tl('notes.pathResolveFailed')] };
  }
}

function walkLogDir(
  rootReal: string,
  dir: string,
  rootLabel: string,
  depth: number,
  out: LogFileInfo[],
  nameMode: 'under-root' | 'home-extra',
  homeReal?: string,
): void {
  if (out.length >= MAX_FILES_PER_PROJECT || depth > MAX_DEPTH) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= MAX_FILES_PER_PROJECT) break;
    if (!name || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        const real = realpathSync(full);
        if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
        if (homeReal && real !== homeReal && !real.startsWith(homeReal + sep)) {
          continue;
        }
        const rst = statSync(real);
        if (rst.isFile() && looksLikeLogFile(name)) {
          pushFile(out, real, rootReal, rootLabel, nameMode, homeReal, rst);
        }
      } catch {
        /* skip */
      }
      continue;
    }
    if (st.isDirectory()) {
      walkLogDir(rootReal, full, rootLabel, depth + 1, out, nameMode, homeReal);
      continue;
    }
    if (!st.isFile()) continue;
    // For default logs/ scan all files; for extra dirs only log-like names
    if (nameMode === 'home-extra' && !looksLikeLogFile(name)) continue;
    let real: string;
    try {
      real = realpathSync(full);
    } catch {
      continue;
    }
    if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
    if (homeReal && real !== homeReal && !real.startsWith(homeReal + sep)) {
      continue;
    }
    pushFile(out, real, rootReal, rootLabel, nameMode, homeReal, st);
  }
}

function pushFile(
  out: LogFileInfo[],
  real: string,
  rootReal: string,
  rootLabel: string,
  nameMode: 'under-root' | 'home-extra',
  homeReal: string | undefined,
  st: { size: number; mtime: Date },
): void {
  let displayName: string;
  if (nameMode === 'home-extra' && homeReal) {
    const homeRel = relative(homeReal, real).split(sep).join('/');
    if (!homeRel || homeRel.includes('..')) return;
    displayName = `~${homeRel}`;
  } else {
    displayName = relative(rootReal, real).split(sep).join('/');
  }
  if (!displayName || displayName.includes('..')) return;
  if (out.some((f) => f.name === displayName || f.path === real)) return;
  out.push({
    name: displayName,
    path: real,
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    root: rootLabel,
    kind: classifyName(displayName),
    previewable: isPreviewable(displayName) });
}

/**
 * List project log files (deep under logs/, log/, and optional extra dirs).
 */
export function listProjectLogs(
  homeDir: string,
  opts?: ListProjectLogsOpts,
): LogFileInfo[] {
  if (!homeDir || !existsSync(homeDir)) return [];
  let homeReal: string;
  try {
    homeReal = realpathSync(homeDir);
  } catch {
    return [];
  }
  const out: LogFileInfo[] = [];
  for (const rootName of LOG_SUBDIRS) {
    const root = join(homeReal, rootName);
    if (!existsSync(root)) continue;
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
    } catch {
      continue;
    }
    if (rootReal !== homeReal && !rootReal.startsWith(homeReal + sep)) continue;
    walkLogDir(rootReal, rootReal, rootName, 0, out, 'under-root', homeReal);
  }

  const extras = normalizeExtraLogDirs(opts?.extraDirs).dirs;
  for (const d of extras) {
    const root = join(homeReal, ...d.split('/'));
    if (!existsSync(root)) continue;
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
    } catch {
      continue;
    }
    if (rootReal !== homeReal && !rootReal.startsWith(homeReal + sep)) continue;
    walkLogDir(rootReal, rootReal, d, 0, out, 'home-extra', homeReal);
  }

  let files = out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  const nf = (opts?.nameFilter || '').trim().toLowerCase();
  if (nf) {
    files = files.filter((f) => f.name.toLowerCase().includes(nf));
  }
  return files;
}

/** Alias for clarity */
export const listProjectLogsDeep = listProjectLogs;

/**
 * Related sources for a project (journal unit, managed nginx, php-fpm).
 */
export function listProjectRelatedLogSources(input: {
  projectId: string;
  linuxUser?: string;
  runtime?: string;
  dataDir?: string;
  phpVersion?: string;
}): ProjectRelatedLogSource[] {
  const items: ProjectRelatedLogSource[] = [];
  const user = (input.linuxUser || '').trim();
  if (user && /^[a-zA-Z0-9._-]+$/.test(user)) {
    const unit = `ysk-project-${user}.service`;
    items.push({
      id: `related-journal:${input.projectId}`,
      kind: 'journal',
      label: 'systemd journal',
      source: `journal:${unit}`,
      available: true,
      meta: unit });

    if (input.dataDir) {
      for (const [suffix, label] of [
        ['access.log', 'nginx access'],
        ['error.log', 'nginx error'],
      ] as const) {
        const name = `${user}.${suffix}`;
        const p = join(input.dataDir, 'nginx', 'logs', name);
        const exists = existsSync(p);
        items.push({
          id: `related-nginx:${input.projectId}:${suffix}`,
          kind: 'managed-nginx',
          label,
          source: exists
            ? `file:managed:${name}`
            : `project-managed:${input.projectId}:${suffix}`,
          available: exists,
          meta: exists ? p : tl('notes.auto.t0237', { v0: (name) }) });
      }
    }

    if (input.runtime === 'php') {
      const ver = (input.phpVersion || '8.3').replace(/[^0-9.]/g, '') || '8.3';
      const p = `/var/log/php${ver}-fpm-${user}.log`;
      const exists = existsSync(p);
      items.push({
        id: `related-php:${input.projectId}`,
        kind: 'php-fpm',
        label: 'PHP-FPM error',
        source: exists
          ? `project-fpm:${input.projectId}`
          : `journal:php${ver}-fpm.service`,
        available: true,
        meta: exists ? p : tl('notes.auto.t0238', { v0: (ver) }) });
    }
  }
  return items;
}

/**
 * Return last N lines of a log file under project log roots (path traversal safe).
 */
export function tailProjectLog(
  homeDir: string,
  fileName: string,
  maxLines = 200,
  maxBytes = 2 * 1024 * 1024,
  opts?: { extraDirs?: string[]; grep?: string },
): LogTailResult {
  const resolved = resolveProjectLogPath(
    homeDir,
    fileName,
    opts?.extraDirs ?? [],
  );
  if (!resolved.ok) {
    throw new YskError(ErrorCodes.VALIDATION, resolved.notes[0] || tl('notes.auto.n0921'), {
      httpStatus: 400 });
  }
  if (!isPreviewable(resolved.rel)) {
    return {
      ok: false,
      file: resolved.rel,
      path: resolved.path,
      lines: [],
      bytes: 0,
      notes: [tl('notes.auto.n0636')] };
  }
  try {
    let { lines, bytes, truncated } = tailFileLines(
      resolved.path,
      Math.max(50, Math.min(5000, maxLines)),
      maxBytes,
    );
    const g = (opts?.grep || '').trim().slice(0, 200);
    let matchedLines: number | undefined;
    if (g) {
      const lower = g.toLowerCase();
      const before = lines.length;
      lines = lines.filter((l) => l.toLowerCase().includes(lower));
      matchedLines = lines.length;
      truncated = truncated || before > lines.length;
    }
    return {
      ok: true,
      file: resolved.rel,
      path: resolved.path,
      lines,
      bytes,
      truncated,
      matchedLines,
      notes: [
        g
          ? tl('notes.auto.t0239', { v0: (g), v1: (matchedLines ?? 0), v2: (bytes) })
          : truncated
            ? tl('notes.auto.t0240', { v0: (lines.length), v1: (bytes) })
            : tl('notes.auto.t0241', { v0: (lines.length), v1: (bytes) }),
      ] };
  } catch (e) {
    throw new YskError(
      ErrorCodes.INTERNAL,
      e instanceof Error ? e.message : tl('notes.auto.n1441'),
      { httpStatus: 500 },
    );
  }
}

/**
 * Search across project log files by name and/or content keyword.
 * Scans tail of each previewable file (bounded) — honest, not full-file grep for huge logs.
 */
export function searchProjectLogs(
  homeDir: string,
  opts: {
    extraDirs?: string[];
    nameFilter?: string;
    grep?: string;
    maxFiles?: number;
    maxLinesPerFile?: number;
    maxBytesPerFile?: number;
  },
): {
  ok: boolean;
  files: LogFileInfo[];
  hits: Array<{ file: string; lines: string[]; matched: number }>;
  notes: string[];
} {
  const notes: string[] = [];
  const files = listProjectLogs(homeDir, {
    extraDirs: opts.extraDirs,
    nameFilter: opts.nameFilter });
  const grep = (opts.grep || '').trim().slice(0, 200);
  if (!grep) {
    return {
      ok: true,
      files,
      hits: [],
      notes: files.length
        ? [tl('notes.auto.t0242', { v0: (files.length) })]
        : [tl('notes.auto.n1092')] };
  }
  const maxFiles = Math.min(40, Math.max(1, opts.maxFiles ?? 20));
  const maxLines = Math.min(500, Math.max(20, opts.maxLinesPerFile ?? 120));
  const maxBytes = Math.min(
    4 * 1024 * 1024,
    Math.max(64 * 1024, opts.maxBytesPerFile ?? 512 * 1024),
  );
  const hits: Array<{ file: string; lines: string[]; matched: number }> = [];
  let scanned = 0;
  for (const f of files) {
    if (hits.length >= maxFiles) break;
    if (!f.previewable) continue;
    scanned += 1;
    try {
      const { lines } = tailFileLines(f.path, maxLines * 4, maxBytes);
      const lower = grep.toLowerCase();
      const matched = lines.filter((l) => l.toLowerCase().includes(lower));
      if (matched.length) {
        hits.push({
          file: f.name,
          lines: matched.slice(-maxLines),
          matched: matched.length });
      }
    } catch {
      notes.push(tl('notes.auto.t0243', { v0: (f.name) }));
    }
  }
  notes.push(
    tl('notes.auto.t0244', { v0: (grep), v1: (scanned), v2: (hits.length) }),
  );
  return { ok: true, files, hits, notes };
}

/**
 * Normalize source segment after project:<id>:
 * Supports "app.out.log" and "app/debug.log" (encode / as / not :).
 */
export function parseProjectLogSourceRest(rest: string): {
  projectId: string;
  fileName?: string;
} {
  const idx = rest.indexOf(':');
  if (idx < 0) {
    return { projectId: rest, fileName: undefined };
  }
  return {
    projectId: rest.slice(0, idx),
    fileName: rest.slice(idx + 1) || undefined };
}

export { normalize };
