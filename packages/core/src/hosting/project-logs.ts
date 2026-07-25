/**
 * Tail project log files under home/logs.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface LogFileInfo {
  name: string;
  path: string;
  bytes: number;
  mtime: string;
}

export interface LogTailResult {
  ok: boolean;
  file: string;
  path: string;
  lines: string[];
  bytes: number;
  notes: string[];
}

export function listProjectLogs(homeDir: string): LogFileInfo[] {
  const dir = join(homeDir, 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      const path = join(dir, name);
      try {
        const st = statSync(path);
        if (!st.isFile()) return null;
        return {
          name,
          path,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is LogFileInfo => x !== null)
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

/**
 * Return last N lines of a log file under project logs/ (path traversal safe).
 */
export function tailProjectLog(
  homeDir: string,
  fileName: string,
  maxLines = 200,
): LogTailResult {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe !== fileName) {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid log file name', { httpStatus: 400 });
  }
  const logsDir = join(homeDir, 'logs');
  const path = join(logsDir, safe);
  if (!path.startsWith(logsDir) || !existsSync(path)) {
    throw new YskError(ErrorCodes.NOT_FOUND, `Log not found: ${safe}`, { httpStatus: 404 });
  }
  const raw = readFileSync(path, 'utf8');
  const all = raw.split(/\r?\n/);
  const lines = all.slice(Math.max(0, all.length - maxLines));
  return {
    ok: true,
    file: safe,
    path,
    lines,
    bytes: Buffer.byteLength(raw),
    notes: [`Showing last ${lines.length} of ${all.length} lines`],
  };
}
