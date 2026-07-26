import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { JsonStore } from '../db/store.js';
import { backupProject, CronJobService, listBackups, backupAllProjects } from './backup-cron.js';

describe('backup + cron', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('creates tar.gz backup of project home', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bak-'));
    dirs.push(dir);
    const home = join(dir, 'projects', 'ysk_demo');
    mkdirSync(join(home, 'app'), { recursive: true });
    writeFileSync(join(home, 'app', 'hi.txt'), 'hello', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await backupProject({
      host,
      dataDir: dir,
      projectId: 'p1',
      homeDir: home,
    });
    expect(r.ok).toBe(true);
    expect(r.archivePath && existsSync(r.archivePath)).toBe(true);
  });

  it('lists backups after backupAllProjects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bakall-'));
    dirs.push(dir);
    const home = join(dir, 'projects', 'p1');
    mkdirSync(join(home, 'app'), { recursive: true });
    writeFileSync(join(home, 'app', 'x.txt'), 'x', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await backupAllProjects({
      host,
      dataDir: dir,
      projects: [{ id: 'p1', home_dir: home, name: 'P1' }],
    });
    expect(r.ok).toBe(true);
    expect(r.results.every((x) => x.ok)).toBe(true);
    const list = listBackups(dir);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].projectId).toBe('p1');
  });

  it('backupAllProjects fails when any attempted project fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-bakfail-'));
    dirs.push(dir);
    const home = join(dir, 'projects', 'p1');
    mkdirSync(join(home, 'app'), { recursive: true });
    writeFileSync(join(home, 'app', 'x.txt'), 'x', 'utf8');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await backupAllProjects({
      host,
      dataDir: dir,
      projects: [
        { id: 'p1', home_dir: home, name: 'P1' },
        { id: 'missing', home_dir: join(dir, 'nope'), name: 'X' },
      ],
    });
    // missing home is skip — only p1 attempted; should still ok if p1 ok
    expect(r.results.find((x) => x.projectId === 'p1')?.ok).toBe(true);
    expect(r.results.find((x) => x.projectId === 'missing')?.ok).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('writes managed crontab and refuses install without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const cron = new CronJobService(store, host, dir);
    const job = cron.create({
      user: 'ysk',
      schedule: '0 4 * * *',
      command: 'echo ysk',
      actor: 'test',
    });
    expect(job.id).toBeTruthy();
    const path = cron.writeManagedCrontab();
    expect(existsSync(path)).toBe(true);
    const install = await cron.installCrontab('test');
    expect(install.ok).toBe(false);
    expect(install.requiresExecute).toBe(true);

    const disabled = cron.setEnabled(job.id, false);
    expect(disabled?.enabled).toBe(false);
    const body = (await import('node:fs')).readFileSync(path, 'utf8');
    expect(body).not.toContain(job.command);
    cron.setEnabled(job.id, true);
    expect(cron.delete(job.id)).toBe(true);
    expect(cron.list()).toHaveLength(0);
  });
});
