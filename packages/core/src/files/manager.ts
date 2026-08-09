/**
 * Sandboxed file manager — ownCloud-style ops under a root directory.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
  renameSync,
  copyFileSync,
  cpSync,
  chmodSync } from 'node:fs';
import { join, resolve, relative, dirname, basename, extname, sep } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import { listFileVersions, restoreFileVersion, snapshotFileVersion } from './versions.js';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: string;
  mime?: string;
  ext?: string;
  /** octal mode string e.g. 644 */
  mode?: string;
}

export type ListSort = 'name' | 'size' | 'mtime';
export type ListOrder = 'asc' | 'desc';

export interface ListOptions {
  sort?: ListSort;
  order?: ListOrder;
  q?: string;
}

export interface TrashEntry extends FileEntry {
  originalPath: string;
  deletedAt: string;
  trashId: string;
}

const TRASH_DIR = '.trash';
const HIDDEN_PREFIXES = ['.trash', '.versions', '.ysk'];

/**
 * Resolve `target` under `root` or throw SANDBOX_VIOLATION.
 * Uses boundary-safe prefix check (not bare startsWith) to avoid
 * `/data/file` matching `/data/file-evil` style escapes.
 */
export function assertInside(root: string, target: string): string {
  if (typeof target === 'string' && target.includes('\0')) {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.files.pathOutsideSandbox', { target }), {
      httpStatus: 403,
    });
  }
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, target ?? '.');
  const rel = relative(rootAbs, abs);
  if (rel.startsWith('..') || rel === '..') {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.files.pathOutsideSandbox', { target }), {
      httpStatus: 403,
    });
  }
  // Boundary-safe: abs === root or abs under root + sep
  if (abs !== rootAbs && !abs.startsWith(rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep)) {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.files.pathOutsideSandbox', { target }), {
      httpStatus: 403,
    });
  }
  return abs;
}

function guessMime(name: string): string {
  const ext = extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg' };
  return map[ext] ?? 'application/octet-stream';
}

function toEntry(root: string, abs: string): FileEntry {
  const s = statSync(abs);
  const name = basename(abs);
  const path = relative(root, abs).replace(/\\/g, '/') || name;
  return {
    name,
    path,
    type: s.isDirectory() ? 'dir' : 'file',
    size: s.size,
    mtime: s.mtime.toISOString(),
    mime: s.isFile() ? guessMime(name) : undefined,
    ext: s.isFile() ? extname(name).replace(/^\./, '') : undefined,
    mode: (s.mode & 0o777).toString(8).padStart(3, '0') };
}

export class FileManager {
  constructor(private readonly root: string) {
    mkdirSync(this.root, { recursive: true });
  }

  getRoot(): string {
    return this.root;
  }

  trashRoot(): string {
    const t = join(this.root, TRASH_DIR);
    mkdirSync(t, { recursive: true });
    return t;
  }

  list(relPath = '.', opts: ListOptions = {}): FileEntry[] {
    const abs = assertInside(this.root, relPath || '.');
    if (!existsSync(abs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.notFoundRel', { relPath }), { httpStatus: 404 });
    }
    const st = statSync(abs);
    if (!st.isDirectory()) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0499'), { httpStatus: 400 });
    }
    let items = readdirSync(abs)
      .filter((name) => {
        if (relPath === '.' || relPath === '') {
          return !HIDDEN_PREFIXES.some((h) => name === h || name.startsWith(h + '/'));
        }
        return true;
      })
      .map((name) => toEntry(this.root, join(abs, name)));

    const q = (opts.q ?? '').trim().toLowerCase();
    if (q) {
      items = items.filter((e) => e.name.toLowerCase().includes(q));
    }

    const sort = opts.sort ?? 'name';
    const order = opts.order ?? 'asc';
    const dir = order === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      // dirs first
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      let cmp = 0;
      if (sort === 'size') cmp = a.size - b.size;
      else if (sort === 'mtime') cmp = a.mtime.localeCompare(b.mtime);
      else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return cmp * dir;
    });
    return items;
  }

  readText(relPath: string, maxBytes = 2_000_000): { path: string; content: string; bytes: number; mime?: string } {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.fileNotFoundRel', { relPath }), { httpStatus: 404 });
    }
    const buf = readFileSync(abs);
    if (buf.length > maxBytes) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0003', { v0: (maxBytes) }), {
        httpStatus: 400 });
    }
    return {
      path: relPath,
      content: buf.toString('utf8'),
      bytes: buf.length,
      mime: guessMime(basename(abs)) };
  }

  readBinary(relPath: string): { path: string; buffer: Buffer; mime: string; name: string } {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.fileNotFoundRel', { relPath }), { httpStatus: 404 });
    }
    const name = basename(abs);
    return {
      path: relPath,
      buffer: readFileSync(abs),
      mime: guessMime(name),
      name };
  }

  writeText(relPath: string, content: string): { path: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    this.snapshotIfExists(abs, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return { path: relPath, bytes: Buffer.byteLength(content) };
  }

  writeBase64(relPath: string, base64: string): { path: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    this.snapshotIfExists(abs, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    const buf = Buffer.from(base64, 'base64');
    writeFileSync(abs, buf);
    return { path: relPath, bytes: buf.length };
  }

  /** Snapshot existing file into .versions before overwrite */
  private snapshotIfExists(abs: string, relPath: string): void {
    if (!existsSync(abs) || !statSync(abs).isFile()) return;
    try {
      snapshotFileVersion(this.root, abs, relPath);
    } catch {
      /* versions optional */
    }
  }

  listVersions(relPath: string) {
    return listFileVersions(this.root, relPath);
  }

  restoreVersion(relPath: string, versionId: string): { ok: boolean; notes: string[] } {
    const abs = assertInside(this.root, relPath);
    return restoreFileVersion(
      this.root,
      relPath,
      versionId,
      (buf) => {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
      },
      abs,
    );
  }

  mkdir(relPath: string): { path: string } {
    const abs = assertInside(this.root, relPath);
    mkdirSync(abs, { recursive: true });
    return { path: relPath };
  }

  createTextFile(relPath: string, content = ''): { path: string; bytes: number } {
    const abs = assertInside(this.root, relPath);
    if (existsSync(abs)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0004', { v0: (relPath) }), { httpStatus: 409 });
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return { path: relPath, bytes: Buffer.byteLength(content) };
  }

  /** Permanent delete (used by trash purge) */
  removePermanent(relPath: string): { path: string; deleted: boolean } {
    if (!relPath || relPath === '.' || relPath === '/') {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0494'), {
        httpStatus: 400 });
    }
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      return { path: relPath, deleted: false };
    }
    rmSync(abs, { recursive: true, force: true });
    return { path: relPath, deleted: true };
  }

  /**
   * Soft-delete → .trash/<id>/ with meta.json
   * Legacy remove() now soft-deletes.
   */
  remove(relPath: string): { path: string; deleted: boolean; trashId?: string } {
    if (!relPath || relPath === '.' || relPath === '/' || relPath.startsWith(TRASH_DIR)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0495'), {
        httpStatus: 400 });
    }
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      return { path: relPath, deleted: false };
    }
    const trashId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const destDir = join(this.trashRoot(), trashId);
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, basename(abs));
    renameSync(abs, dest);
    const meta = {
      trashId,
      originalPath: relPath.replace(/\\/g, '/'),
      name: basename(abs),
      deletedAt: new Date().toISOString(),
      type: statSync(dest).isDirectory() ? 'dir' : 'file' };
    writeFileSync(join(destDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return { path: relPath, deleted: true, trashId };
  }

  listTrash(): TrashEntry[] {
    const root = this.trashRoot();
    const out: TrashEntry[] = [];
    for (const id of readdirSync(root)) {
      const dir = join(root, id);
      if (!statSync(dir).isDirectory()) continue;
      const metaPath = join(dir, 'meta.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          trashId: string;
          originalPath: string;
          name: string;
          deletedAt: string;
          type: 'file' | 'dir';
        };
        const itemPath = join(dir, meta.name);
        const s = existsSync(itemPath) ? statSync(itemPath) : null;
        out.push({
          trashId: meta.trashId || id,
          name: meta.name,
          path: `${TRASH_DIR}/${id}/${meta.name}`,
          originalPath: meta.originalPath,
          type: meta.type,
          size: s?.size ?? 0,
          mtime: s?.mtime.toISOString() ?? meta.deletedAt,
          deletedAt: meta.deletedAt });
      } catch {
        /* skip corrupt */
      }
    }
    return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  }

  restoreTrash(trashId: string): { path: string; originalPath: string } {
    const safe = trashId.replace(/[^a-zA-Z0-9._-]/g, '');
    const dir = join(this.trashRoot(), safe);
    const metaPath = join(dir, 'meta.json');
    if (!existsSync(metaPath)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.n0860'), { httpStatus: 404 });
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      originalPath: string;
      name: string;
    };
    const src = join(dir, meta.name);
    const dest = assertInside(this.root, meta.originalPath);
    if (existsSync(dest)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0005', { v0: (meta.originalPath) }), {
        httpStatus: 409 });
    }
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
    rmSync(dir, { recursive: true, force: true });
    return { path: meta.originalPath, originalPath: meta.originalPath };
  }

  purgeTrash(trashId?: string): { ok: boolean; purged: number } {
    const root = this.trashRoot();
    if (trashId) {
      const safe = trashId.replace(/[^a-zA-Z0-9._-]/g, '');
      const dir = join(root, safe);
      if (!existsSync(dir)) return { ok: false, purged: 0 };
      rmSync(dir, { recursive: true, force: true });
      return { ok: true, purged: 1 };
    }
    let n = 0;
    for (const id of readdirSync(root)) {
      rmSync(join(root, id), { recursive: true, force: true });
      n++;
    }
    return { ok: true, purged: n };
  }

  rename(fromPath: string, toPath: string): { from: string; to: string } {
    const fromAbs = assertInside(this.root, fromPath);
    const toAbs = assertInside(this.root, toPath);
    if (!existsSync(fromAbs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.notFoundFrom', { fromPath }), { httpStatus: 404 });
    }
    mkdirSync(dirname(toAbs), { recursive: true });
    renameSync(fromAbs, toAbs);
    return { from: fromPath, to: toPath };
  }

  move(fromPath: string, toPath: string): { from: string; to: string } {
    return this.rename(fromPath, toPath);
  }

  copy(fromPath: string, toPath: string): { from: string; to: string } {
    const fromAbs = assertInside(this.root, fromPath);
    const toAbs = assertInside(this.root, toPath);
    if (!existsSync(fromAbs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.notFoundFrom', { fromPath }), { httpStatus: 404 });
    }
    mkdirSync(dirname(toAbs), { recursive: true });
    const st = statSync(fromAbs);
    if (st.isDirectory()) {
      cpSync(fromAbs, toAbs, { recursive: true });
    } else {
      copyFileSync(fromAbs, toAbs);
    }
    return { from: fromPath, to: toPath };
  }

  stat(relPath: string): FileEntry {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.notFoundRel', { relPath }), { httpStatus: 404 });
    }
    return toEntry(this.root, abs);
  }

  /**
   * chmod path (octal 3–4 digits, e.g. 644 or 0755).
   */
  chmod(relPath: string, mode: string): { path: string; mode: string } {
    const abs = assertInside(this.root, relPath);
    if (!existsSync(abs)) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.files.notFoundRel', { relPath }), { httpStatus: 404 });
    }
    const cleaned = String(mode).trim().replace(/^0x/i, '');
    if (!/^[0-7]{3,4}$/.test(cleaned)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1028'), { httpStatus: 400 });
    }
    const n = parseInt(cleaned, 8);
    chmodSync(abs, n);
    return { path: relPath, mode: cleaned };
  }

  /**
   * Zip one or more relative paths into destZip (relative to root).
   * Uses system `zip` if available.
   */
  zip(paths: string[], destZip: string): { path: string; bytes: number; notes: string[] } {
    if (!paths.length) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.needPath'), { httpStatus: 400 });
    }
    const destAbs = assertInside(this.root, destZip);
    if (!destZip.toLowerCase().endsWith('.zip')) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1283'), { httpStatus: 400 });
    }
    mkdirSync(dirname(destAbs), { recursive: true });
    const rels: string[] = [];
    for (const p of paths) {
      const abs = assertInside(this.root, p);
      if (!existsSync(abs)) {
        throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.t0006', { v0: (p) }), { httpStatus: 404 });
      }
      rels.push(relative(this.root, abs) || '.');
    }
    const r = spawnSync('zip', ['-r', '-q', destAbs, ...rels], {
      cwd: this.root,
      encoding: 'utf8',
      timeout: 120_000 });
    if (r.error || r.status !== 0) {
      throw new YskError(
        ErrorCodes.INTERNAL,
        tl('notes.auto.t0007', { v0: (r.stderr || r.error?.message || 'exit ' + r.status) }),
        { httpStatus: 500 },
      );
    }
    const bytes = existsSync(destAbs) ? statSync(destAbs).size : 0;
    return { path: destZip, bytes, notes: [tl('notes.auto.t0008', { v0: (paths.length), v1: (destZip) })] };
  }

  /**
   * Unzip archive into destDir (relative). Uses system `unzip`.
   */
  unzip(zipPath: string, destDir: string): { path: string; notes: string[] } {
    const zipAbs = assertInside(this.root, zipPath);
    const destAbs = assertInside(this.root, destDir || '.');
    if (!existsSync(zipAbs) || !statSync(zipAbs).isFile()) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.t0009', { v0: (zipPath) }), { httpStatus: 404 });
    }
    mkdirSync(destAbs, { recursive: true });
    const r = spawnSync('unzip', ['-o', '-q', zipAbs, '-d', destAbs], {
      encoding: 'utf8',
      timeout: 120_000 });
    if (r.error || (r.status !== 0 && r.status !== 1)) {
      // unzip exit 1 = warnings
      throw new YskError(
        ErrorCodes.INTERNAL,
        tl('notes.auto.t0010', { v0: (r.stderr || r.error?.message || 'exit ' + r.status) }),
        { httpStatus: 500 },
      );
    }
    return { path: destDir || '.', notes: [tl('notes.auto.t0011', { v0: (zipPath), v1: (destDir || '.') })] };
  }

  /** Disk usage under root (excluding .trash for "used") */
  usage(): { bytes: number; fileCount: number; dirCount: number } {
    let bytes = 0;
    let fileCount = 0;
    let dirCount = 0;
    const walk = (abs: string) => {
      for (const name of readdirSync(abs)) {
        if (name === TRASH_DIR || name === '.versions' || name === '.ysk') continue;
        const p = join(abs, name);
        const s = statSync(p);
        if (s.isDirectory()) {
          dirCount++;
          walk(p);
        } else {
          fileCount++;
          bytes += s.size;
        }
      }
    };
    walk(this.root);
    return { bytes, fileCount, dirCount };
  }
}

export function publicFilesRoot(dataDir: string): string {
  const root = join(dataDir, 'files', 'public');
  mkdirSync(root, { recursive: true });
  return root;
}

/** Public share link store helpers */
export type FileShareRecord = {
  id: string;
  token: string;
  root: string; // public | project:id
  path: string;
  passwordHash?: string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  downloadCount: number;
};

/**
 * Hash a user-chosen share password.
 * Format: `scrypt$<saltHex>$<hashHex>` (salted; resists offline cracking).
 * Legacy rows may still store bare SHA-256 hex — verified in verifySharePasswordHash.
 */
export function hashSharePassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verify password against stored hash (scrypt preferred; legacy SHA-256 hex supported).
 */
export function verifySharePasswordHash(stored: string, password: string): boolean {
  const s = String(stored || '');
  if (!s || !password) return false;
  if (s.startsWith('scrypt$')) {
    const parts = s.split('$');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    try {
      const actual = scryptSync(password, parts[1], 32).toString('hex');
      return safeHexEqual(actual, parts[2]);
    } catch {
      return false;
    }
  }
  // Legacy unsalted SHA-256 (Phase 0 short-term; still accepted for existing shares)
  const legacy = createHash('sha256').update(password).digest('hex');
  return safeHexEqual(legacy, s);
}

/** Constant-time compare of hex digests (share / token hashes). */
export function safeHexEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function newShareToken(): string {
  return randomBytes(16).toString('hex');
}
