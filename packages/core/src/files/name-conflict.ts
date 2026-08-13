/**
 * Destination name-conflict helpers for FileManager write/copy/rename.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  ErrorCodes,
  uniqueFileName,
  YskError,
  tl,
  type FileIfExists,
} from 'ysk-server-shared';

export function alreadyExistsError(relPath: string, type: 'file' | 'dir'): YskError {
  const name = basename(relPath);
  return new YskError(ErrorCodes.VALIDATION, tl('notes.files.alreadyExists', { name, path: relPath }), {
    httpStatus: 409,
    details: { reason: 'EEXIST', path: relPath, name, type },
  });
}

export function siblingNames(abs: string): Set<string> {
  const dir = dirname(abs);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return new Set();
  return new Set(readdirSync(dir));
}

export function resolveDestPath(
  abs: string,
  relPath: string,
  ifExists: FileIfExists,
  kind: 'file' | 'dir',
): { abs: string; relPath: string } {
  if (!existsSync(abs)) return { abs, relPath };
  if (ifExists === 'overwrite') return { abs, relPath };
  if (ifExists === 'rename') {
    const newName = uniqueFileName(basename(abs), siblingNames(abs), { kind });
    const parentRel = dirname(relPath).replace(/\\/g, '/');
    const newRel =
      !parentRel || parentRel === '.' || parentRel === '/'
        ? newName
        : `${parentRel.replace(/\/$/, '')}/${newName}`;
    return { abs: join(dirname(abs), newName), relPath: newRel };
  }
  const st = statSync(abs);
  throw alreadyExistsError(relPath, st.isDirectory() ? 'dir' : 'file');
}

export type { FileIfExists };
