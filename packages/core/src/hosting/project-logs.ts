/**
 * Project log discovery + safe tail under home/logs and home/log.
 * Fail-closed: never escape project home log roots.
 */

import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  lstatSync,
} from 'node:fs';
import { join, relative, sep, normalize } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import { tailFileLines } from './log-center/file-tail.js';

const MAX_DEPTH = 3;
const MAX_FILES_PER_PROJECT = 50;
const LOG_SUBDIRS = ['logs', 'log'] as const;

export type ProjectLogKind = 'app' | 'rotated' | 'compressed' | 'other';

export interface LogFileInfo {
  /** Relative path under logs/ or log/ (e.g. app.out.log or app/debug.log) */
  name: string;
  /** Absolute path */
  path: string;
  bytes: number;
  mtime: string;
  /** Which root: logs | log */
  root?: 'logs' | 'log';
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
}

export interface ProjectRelatedLogSource {
  id: string;
  kind: 'journal' | 'managed-nginx' | 'php-fpm';
  label: string;
  source: string;
  available: boolean;
  meta?: string;
}

function classifyName(name: string): ProjectLogKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gz') || lower.endsWith('.bz2') || lower.endsWith('.xz')) {
    return 'compressed';
  }
  if (/\.\d+$/.test(lower) || lower.includes('.log.')) return 'rotated';
  if (lower.includes('.log') || lower.endsWith('.out') || lower.endsWith('.err')) {
    return 'app';
  }
  return 'other';
}

function isPreviewable(name: string): boolean {
  return classifyName(name) !== 'compressed';
}

/**
 * Resolve and validate a relative log path under home/logs or home/log.
 * Accepts "app.out.log" or "subdir/app.log" (forward slashes).
 */
export function resolveProjectLogPath(
  homeDir: string,
  relPath: string,
): { ok: true; path: string; rel: string; root: 'logs' | 'log' } | { ok: false; notes: string[] } {
  if (!homeDir || !relPath || relPath.includes('\0')) {
    return { ok: false, notes: ['無效路徑'] };
  }
  let rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  // strip accidental logs/ or log/ prefix for convenience
  if (rel.startsWith('logs/')) rel = rel.slice(5);
  else if (rel.startsWith('log/')) rel = rel.slice(4);

  if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes(':')) {
    return { ok: false, notes: ['拒絕路徑穿越或非法字元'] };
  }
  // allow common log name chars + path segments
  if (!/^[a-zA-Z0-9._@+-]+(?:\/[a-zA-Z0-9._@+-]+)*$/.test(rel)) {
    return { ok: false, notes: ['日誌相對路徑含不允許字元'] };
  }

  try {
    const homeReal = realpathSync(homeDir);
    for (const rootName of LOG_SUBDIRS) {
      const root = join(homeReal, rootName);
      if (!existsSync(root)) continue;
      let rootReal: string;
      try {
        rootReal = realpathSync(root);
      } catch {
        continue;
      }
      // root must stay under home
      if (rootReal !== homeReal && !rootReal.startsWith(homeReal + sep)) {
        continue;
      }
      const candidate = join(rootReal, ...rel.split('/'));
      if (!existsSync(candidate)) continue;
      let real: string;
      try {
        // reject symlink escape: lstat then realpath must stay under root
        const lst = lstatSync(candidate);
        if (lst.isSymbolicLink()) {
          real = realpathSync(candidate);
        } else if (lst.isFile()) {
          real = realpathSync(candidate);
        } else {
          return { ok: false, notes: ['不是一般檔案'] };
        }
      } catch {
        return { ok: false, notes: ['路徑解析失敗'] };
      }
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        return { ok: false, notes: ['symlink 逃出 log 目錄'] };
      }
      const st = statSync(real);
      if (!st.isFile()) {
        return { ok: false, notes: ['不是一般檔案'] };
      }
      return { ok: true, path: real, rel, root: rootName };
    }
    return { ok: false, notes: [`找不到日誌：${rel}`] };
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : '路徑解析失敗'],
    };
  }
}

function walkLogDir(
  rootReal: string,
  dir: string,
  rootName: 'logs' | 'log',
  depth: number,
  out: LogFileInfo[],
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
      // only follow if realpath stays under root
      try {
        const real = realpathSync(full);
        if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
        const rst = statSync(real);
        if (rst.isFile()) {
          const rel = relative(rootReal, real).split(sep).join('/');
          out.push({
            name: rel,
            path: real,
            bytes: rst.size,
            mtime: rst.mtime.toISOString(),
            root: rootName,
            kind: classifyName(rel),
            previewable: isPreviewable(rel),
          });
        }
      } catch {
        /* skip */
      }
      continue;
    }
    if (st.isDirectory()) {
      walkLogDir(rootReal, full, rootName, depth + 1, out);
      continue;
    }
    if (!st.isFile()) continue;
    let real: string;
    try {
      real = realpathSync(full);
    } catch {
      continue;
    }
    if (real !== rootReal && !real.startsWith(rootReal + sep)) continue;
    const rel = relative(rootReal, real).split(sep).join('/');
    if (!rel || rel.includes('..')) continue;
    out.push({
      name: rel,
      path: real,
      bytes: st.size,
      mtime: st.mtime.toISOString(),
      root: rootName,
      kind: classifyName(rel),
      previewable: isPreviewable(rel),
    });
  }
}

/**
 * List project log files (deep under logs/ and log/).
 * `name` is relative path for use in project:<id>:<name>.
 */
export function listProjectLogs(homeDir: string): LogFileInfo[] {
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
    walkLogDir(rootReal, rootReal, rootName, 0, out);
  }
  return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
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
      meta: unit,
    });

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
          source: exists ? `file:managed:${name}` : `project-managed:${input.projectId}:${suffix}`,
          available: exists,
          meta: exists ? p : `${name}（未產生）`,
        });
      }
    }

    // PHP-FPM pool error log (common path; may need root to read)
    if (input.runtime === 'php') {
      const ver = (input.phpVersion || '8.3').replace(/[^0-9.]/g, '') || '8.3';
      const p = `/var/log/php${ver}-fpm-${user}.log`;
      const exists = existsSync(p);
      items.push({
        id: `related-php:${input.projectId}`,
        kind: 'php-fpm',
        label: 'PHP-FPM error',
        source: exists ? `project-fpm:${input.projectId}` : `journal:php${ver}-fpm.service`,
        available: true,
        meta: exists ? p : `journal php${ver}-fpm（pool log 未見）`,
      });
    }
  }
  return items;
}

/**
 * Return last N lines of a log file under project logs/ (path traversal safe).
 * Efficient tail — does not load whole file into memory.
 */
export function tailProjectLog(
  homeDir: string,
  fileName: string,
  maxLines = 200,
  maxBytes = 2 * 1024 * 1024,
): LogTailResult {
  const resolved = resolveProjectLogPath(homeDir, fileName);
  if (!resolved.ok) {
    throw new YskError(ErrorCodes.VALIDATION, resolved.notes[0] || '日誌路徑無效', {
      httpStatus: 400,
    });
  }
  if (!isPreviewable(resolved.rel)) {
    return {
      ok: false,
      file: resolved.rel,
      path: resolved.path,
      lines: [],
      bytes: 0,
      notes: ['壓縮檔唔支援預覽（.gz 等）'],
    };
  }
  try {
    const { lines, bytes, truncated } = tailFileLines(
      resolved.path,
      Math.max(50, Math.min(5000, maxLines)),
      maxBytes,
    );
    return {
      ok: true,
      file: resolved.rel,
      path: resolved.path,
      lines,
      bytes,
      truncated,
      notes: [
        truncated
          ? `顯示尾端 ${lines.length} 行（檔案 ${bytes} bytes，已截斷）`
          : `顯示尾端 ${lines.length} 行（檔案 ${bytes} bytes）`,
      ],
    };
  } catch (e) {
    throw new YskError(
      ErrorCodes.INTERNAL,
      e instanceof Error ? e.message : '讀取日誌失敗',
      { httpStatus: 500 },
    );
  }
}

/**
 * Normalize source segment after project:<id>:
 * Supports "app.out.log" and "app/debug.log" (encode / as / not :).
 */
export function parseProjectLogSourceRest(rest: string): {
  projectId: string;
  fileName?: string;
} {
  // project id is first segment before first colon; remainder is file path
  // But project ids are typically uuid without colons... still use first :
  const idx = rest.indexOf(':');
  if (idx < 0) {
    return { projectId: rest, fileName: undefined };
  }
  return {
    projectId: rest.slice(0, idx),
    fileName: rest.slice(idx + 1) || undefined,
  };
}

export { normalize };
