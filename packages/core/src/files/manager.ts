/**
 * Sandboxed file manager under a root directory (project home or public files).
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: string;
}

function assertInside(root: string, target: string): string {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, target);
  const rel = relative(rootAbs, abs);
  if (rel.startsWith('..') || rel === '..' || abs === rootAbs + '/..') {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, `Path escapes sandbox: ${target}`, {
      httpStatus: 403,
    });
  }
  // also reject absolute that left root
  if (!abs.startsWith(rootAbs)) {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, `Path escapes sandbox: ${target}`, {
      httpStatus: 403,
    });
  }
  return abs;
}

export class FileManager {
  constructor(private readonly root: string) {
    mkdirSync(this.root, { recursive: true });
  }

  list(relPath = '.'): FileEntry[] {
    const abs = assertInside(this.root, relPath || '.');
    if (!existsSync(abs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Not found: ${relPath}`, { httpStatus: 404 });
    }
    const st = statSync(abs);
    if (!st.isDirectory()) {
      throw new YskError(ErrorCodes.VALIDATION, 'Not a directory', { httpStatus: 400 });
    }
    return readdirSync(abs).map((name) => {
      const p = join(abs, name);
      const s = statSync(p);
      return {
        name,
        path: relative(this.root, p).replace(/\\/g, '/') || name,
        type: s.isDirectory() ? ('dir' as const) : ('file' as const),
        size: s.size,
        mtime: s.mtime.toISOString(),
      };
    });
  }

  readText(relPath: string, maxBytes = 512_000): { path: string; content: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new YskError(ErrorCodes.NOT_FOUND, `File not found: ${relPath}`, { httpStatus: 404 });
    }
    const buf = readFileSync(abs);
    if (buf.length > maxBytes) {
      throw new YskError(ErrorCodes.VALIDATION, `File too large (>${maxBytes} bytes)`, {
        httpStatus: 400,
      });
    }
    return {
      path: relPath,
      content: buf.toString('utf8'),
      bytes: buf.length,
    };
  }

  writeText(relPath: string, content: string): { path: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return { path: relPath, bytes: Buffer.byteLength(content) };
  }

  writeBase64(relPath: string, base64: string): { path: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    const buf = Buffer.from(base64, 'base64');
    writeFileSync(abs, buf);
    return { path: relPath, bytes: buf.length };
  }

  mkdir(relPath: string): { path: string } {
    const abs = assertInside(this.root, relPath);
    mkdirSync(abs, { recursive: true });
    return { path: relPath };
  }

  remove(relPath: string): { path: string; deleted: boolean } {
    if (!relPath || relPath === '.' || relPath === '/') {
      throw new YskError(ErrorCodes.VALIDATION, 'Refusing to delete sandbox root', {
        httpStatus: 400,
      });
    }
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      return { path: relPath, deleted: false };
    }
    rmSync(abs, { recursive: true, force: true });
    return { path: relPath, deleted: true };
  }

  stat(relPath: string): FileEntry {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, `Not found: ${relPath}`, { httpStatus: 404 });
    }
    const s = statSync(abs);
    return {
      name: basename(abs),
      path: relative(this.root, abs).replace(/\\/g, '/') || '.',
      type: s.isDirectory() ? 'dir' : 'file',
      size: s.size,
      mtime: s.mtime.toISOString(),
    };
  }
}

export function publicFilesRoot(dataDir: string): string {
  const root = join(dataDir, 'files', 'public');
  mkdirSync(root, { recursive: true });
  return root;
}
