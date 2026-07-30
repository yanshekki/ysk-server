import { tl } from '@ysk/shared';
/**
 * Path-safe file tail for log center.
 */

import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { assertManagedOrSystemLogPath } from './catalog.js';
import type { LogQueryResult } from './types.js';
import { clampLines } from './journal.js';

const SECRET_RE =
  /(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*['"]?[^\s'"]+/gi;

export function maskSecrets(line: string): string {
  return line.replace(SECRET_RE, '$1=***');
}

/**
 * Tail last N lines efficiently for large files (read tail chunk).
 */
export function tailFileLines(
  path: string,
  maxLines: number,
  maxBytes: number,
): { lines: string[]; bytes: number; truncated: boolean } {
  const fd = openSync(path, 'r');
  try {
    const st = fstatSync(fd);
    const size = st.size;
    const readSize = Math.min(size, Math.max(maxBytes, 64 * 1024));
    const buf = Buffer.alloc(readSize);
    const start = Math.max(0, size - readSize);
    readSync(fd, buf, 0, readSize, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    const all = text.split(/\r?\n/);
    const truncated = start > 0 || all.length > maxLines;
    const lines = all.slice(Math.max(0, all.length - maxLines));
    return { lines, bytes: size, truncated };
  } finally {
    closeSync(fd);
  }
}

export function queryFileLog(opts: {
  path: string;
  dataDir?: string;
  lines?: number;
  grep?: string;
  maxBytes?: number;
  maskSecrets?: boolean;
  customAllowPaths?: string[];
}): LogQueryResult {
  const notes: string[] = [];
  const allowed = assertManagedOrSystemLogPath(
    opts.path,
    opts.dataDir,
    opts.customAllowPaths,
  );
  if (!allowed.ok || !allowed.path) {
    return {
      ok: false,
      source: opts.path,
      lines: [],
      lineCount: 0,
      truncated: false,
      notes: allowed.notes,
      blocked: true };
  }
  const maxLines = clampLines(opts.lines);
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  try {
    let { lines, bytes, truncated } = tailFileLines(allowed.path, maxLines, maxBytes);
    const g = (opts.grep || '').trim().slice(0, 200);
    if (g) {
      const lower = g.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(lower));
      notes.push(tl('notes.auto.t0765', { v0: (lines.length) }));
    }
    if (opts.maskSecrets !== false) {
      lines = lines.map(maskSecrets);
    }
    notes.push(tl('notes.auto.t0766', { v0: (allowed.path), v1: (bytes), v2: (lines.length) }));
    return {
      ok: true,
      source: allowed.path,
      lines,
      lineCount: lines.length,
      truncated,
      notes,
      rawBytes: bytes };
  } catch (e) {
    return {
      ok: false,
      source: opts.path,
      lines: [],
      lineCount: 0,
      truncated: false,
      notes: [e instanceof Error ? e.message : tl('notes.readFailed')],
      blocked: true };
  }
}
