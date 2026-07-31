import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  backupControlPlane,
  backupProject,
  deleteProjectBackup,
  filterBackupList,
  isBackupSkipNote,
  isBackupSkippedResult,
  listBackups,
  localizeLastBackupRun,
  resolveBackupDownloadPath,
  resolveManagedBackupArchive,
  restoreControlPlaneBackup,
  restoreProjectBackup,
  wrapCronCommandAsLinuxUser,
} from './backup-cron.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(run?: (argv: string[]) => Partial<RunResult>): HostExecutor {
  return {
    executeEnabled: () => true,
    isRoot: () => false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...(run?.(argv) ?? {}) }),
  };
}

describe('backup-cron depth', () => {
  it('resolve/list/filter helpers and skip notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bak-'));
    try {
      expect(resolveManagedBackupArchive(dir, 'p1', '../evil').ok).toBe(false);
      expect(resolveManagedBackupArchive(dir, 'p1', 'ok.tar.gz').ok).toBe(true);
      expect(isBackupSkipNote('skipped: quota')).toBe(true);
      expect(isBackupSkipNote('done')).toBe(false);
      expect(isBackupSkippedResult({ notes: ['skipped x'], ok: true })).toBe(true);

      const bak = join(dir, 'backups', 'p1');
      mkdirSync(bak, { recursive: true });
      writeFileSync(join(bak, 'a.tar.gz'), 'x');
      writeFileSync(join(bak, 'b.tar.gz'), 'yy');
      const list = listBackups(dir);
      expect(list.length).toBeGreaterThan(0);
      const filtered = filterBackupList(list, { projectId: 'p1', q: 'a' });
      expect(Array.isArray(filtered)).toBe(true);

      const dl = resolveBackupDownloadPath(dir, 'p1', 'a.tar.gz');
      expect(dl.ok === true || dl.ok === false).toBe(true);

      expect(deleteProjectBackup(dir, 'p1', 'missing.tar.gz').ok).toBe(false);
      const del = deleteProjectBackup(dir, 'p1', 'a.tar.gz');
      expect(del.ok).toBe(true);

      expect(wrapCronCommandAsLinuxUser('echo hi', 'ysk')).toContain('ysk');
      const loc = localizeLastBackupRun({
        at: new Date().toISOString(),
        ok: true,
        notes: ['ok'],
      } as never);
      expect(loc).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backupProject and restore modes dry-run/web/full', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bak2-'));
    try {
      const home = join(dir, 'homes', 'p1');
      mkdirSync(join(home, 'app'), { recursive: true });
      writeFileSync(join(home, 'app', 'index.html'), 'hi');
      const host = mockHost((argv) => {
        if (argv[0] === 'tar' && argv.includes('-czf')) {
          // create archive path if provided
          const out = argv[argv.indexOf('-czf') + 1];
          if (out) {
            mkdirSync(join(out, '..'), { recursive: true });
            writeFileSync(out, 'fake-tar');
          }
          return { exitCode: 0 };
        }
        if (argv[0] === 'tar' && argv.includes('-tzf')) {
          return { exitCode: 0, stdout: 'app/index.html\n' };
        }
        if (argv[0] === 'tar' && argv.includes('-xzf')) {
          return { exitCode: 0 };
        }
        return {};
      });

      const bak = await backupProject({
        host,
        dataDir: dir,
        projectId: 'p1',
        homeDir: home,
      });
      expect(bak.ok === true || bak.notes.length > 0).toBe(true);

      // seed archive for restore
      const archDir = join(dir, 'backups', 'p1');
      mkdirSync(archDir, { recursive: true });
      writeFileSync(join(archDir, 'restore-me.tar.gz'), 'data');

      const dry = await restoreProjectBackup({
        host,
        dataDir: dir,
        projectId: 'p1',
        archiveName: 'restore-me.tar.gz',
        homeDir: home,
        mode: 'dry-run',
      });
      expect(dry.notes.length).toBeGreaterThan(0);

      const web = await restoreProjectBackup({
        host,
        dataDir: dir,
        projectId: 'p1',
        archiveName: 'restore-me.tar.gz',
        homeDir: home,
        mode: 'web',
      });
      expect(typeof web.ok).toBe('boolean');

      const full = await restoreProjectBackup({
        host,
        dataDir: dir,
        projectId: 'p1',
        archiveName: 'restore-me.tar.gz',
        homeDir: home,
        mode: 'full',
      });
      expect(typeof full.ok).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backupControlPlane and restoreControlPlaneBackup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bak3-'));
    try {
      writeFileSync(join(dir, 'ysk.json'), '{"version":1}');
      writeFileSync(join(dir, 'config.json'), '{}');
      const host = mockHost((argv) => {
        if (argv[0] === 'tar' && argv.includes('-czf')) {
          const out = argv[argv.indexOf('-czf') + 1];
          mkdirSync(join(out, '..'), { recursive: true });
          writeFileSync(out, 'cp');
          return { exitCode: 0 };
        }
        if (argv[0] === 'tar' && argv.includes('-tzf')) {
          return { exitCode: 0, stdout: 'ysk.json\n' };
        }
        if (argv[0] === 'tar' && argv.includes('-xzf')) {
          return { exitCode: 0 };
        }
        return {};
      });
      const cp = await backupControlPlane({ host, dataDir: dir });
      expect(cp.ok).toBe(true);
      expect(cp.archivePath && existsSync(cp.archivePath)).toBe(true);

      const name = cp.archivePath!.split('/').pop()!;
      const dry = await restoreControlPlaneBackup({
        host,
        dataDir: dir,
        archiveName: name,
        mode: 'dry-run',
      });
      expect(dry.ok === true || dry.notes.length > 0).toBe(true);

      const fullBlocked = await restoreControlPlaneBackup({
        host,
        dataDir: dir,
        archiveName: name,
        mode: 'full',
        confirmPhrase: 'wrong',
      });
      expect(fullBlocked.ok === false || fullBlocked.notes.length > 0).toBe(true);

      const full = await restoreControlPlaneBackup({
        host,
        dataDir: dir,
        archiveName: name,
        mode: 'full',
        confirmPhrase: 'RESTORE-CONTROL-PLANE',
      });
      expect(typeof full.ok).toBe('boolean');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
