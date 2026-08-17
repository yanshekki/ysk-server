import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BACKUP_TRASH_RETENTION_MS,
  deleteProjectBackup,
  emptyBackupTrash,
  listBackupTrash,
  listBackups,
  purgeBackupTrash,
  purgeExpiredBackupTrash,
  restoreBackupTrash,
} from './backup-cron.js';

describe('backup recycle bin', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function seedArchive(dataDir: string, projectId: string, name: string): string {
    const dir = join(dataDir, 'backups', projectId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, 'tar-bytes');
    return path;
  }

  it('delete moves to trash instead of unlinking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    const live = seedArchive(dir, 'p1', 'a.tar.gz');
    const del = deleteProjectBackup(dir, 'p1', 'a.tar.gz');
    expect(del.ok).toBe(true);
    expect(del.trashed).toBe(true);
    expect(existsSync(live)).toBe(false);
    expect(listBackups(dir).some((x) => x.name === 'a.tar.gz')).toBe(false);
    const trash = listBackupTrash(dir);
    expect(trash).toHaveLength(1);
    expect(trash[0]?.name).toBe('a.tar.gz');
    expect(trash[0]?.projectId).toBe('p1');
    expect(existsSync(trash[0]!.path)).toBe(true);
  });

  it('restore brings the archive back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'a.tar.gz');
    deleteProjectBackup(dir, 'p1', 'a.tar.gz');
    const item = listBackupTrash(dir)[0]!;
    const rest = restoreBackupTrash(dir, item.projectId, item.trashName);
    expect(rest.ok).toBe(true);
    expect(listBackupTrash(dir)).toHaveLength(0);
    expect(listBackups(dir).some((x) => x.name === 'a.tar.gz')).toBe(true);
  });

  it('restore refuses if live name exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'a.tar.gz');
    deleteProjectBackup(dir, 'p1', 'a.tar.gz');
    seedArchive(dir, 'p1', 'a.tar.gz');
    const item = listBackupTrash(dir)[0]!;
    const rest = restoreBackupTrash(dir, item.projectId, item.trashName);
    expect(rest.ok).toBe(false);
  });

  it('purgeExpired removes items older than 7 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'old.tar.gz');
    deleteProjectBackup(dir, 'p1', 'old.tar.gz');
    const item = listBackupTrash(dir)[0]!;
    const metaPath = `${item.path}.json`;
    writeFileSync(
      metaPath,
      JSON.stringify({
        deletedAt: new Date(Date.now() - BACKUP_TRASH_RETENTION_MS - 1000).toISOString(),
        originalName: 'old.tar.gz',
        bytes: 9,
        projectId: 'p1',
      }),
    );
    expect(purgeExpiredBackupTrash(dir)).toBe(1);
    expect(listBackupTrash(dir)).toHaveLength(0);
  });

  it('emptyBackupTrash purges remaining items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'a.tar.gz');
    seedArchive(dir, 'p1', 'b.tar.gz');
    deleteProjectBackup(dir, 'p1', 'a.tar.gz');
    deleteProjectBackup(dir, 'p1', 'b.tar.gz');
    const empty = emptyBackupTrash(dir);
    expect(empty.ok).toBe(true);
    expect(empty.purged).toBe(2);
    expect(listBackupTrash(dir)).toHaveLength(0);
  });

  it('purgeBackupTrash unlinks one item', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'a.tar.gz');
    deleteProjectBackup(dir, 'p1', 'a.tar.gz');
    const item = listBackupTrash(dir)[0]!;
    expect(purgeBackupTrash(dir, item.projectId, item.trashName).ok).toBe(true);
    expect(listBackupTrash(dir)).toHaveLength(0);
  });

  it('listBackups ignores the .trash directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btrash-'));
    dirs.push(dir);
    seedArchive(dir, 'p1', 'live.tar.gz');
    seedArchive(dir, 'p1', 'gone.tar.gz');
    deleteProjectBackup(dir, 'p1', 'gone.tar.gz');
    const list = listBackups(dir);
    expect(list.map((x) => x.name)).toEqual(['live.tar.gz']);
    expect(list.some((x) => x.projectId === '.trash')).toBe(false);
  });
});
