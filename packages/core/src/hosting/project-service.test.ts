import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { LocalHostExecutor } from '../host/executor.js';
import { ProjectService } from './project-service.js';

describe('ProjectService real lifecycle', () => {
  it('creates project home on disk and lists from DB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-'));
    const db = openDatabase(join(dir, 'db.sqlite'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'Demo Site',
      domain: 'demo.local',
      runtime: 'node',
      runtimeVersion: '20',
      actor: 'admin',
    });
    expect(created.project.linuxUser).toMatch(/^ysk_/);
    expect(existsSync(created.project.homeDir)).toBe(true);
    expect(existsSync(join(created.project.homeDir, 'project.json'))).toBe(true);
    expect(created.project.homeDir.startsWith(join(dir, 'projects'))).toBe(true);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Demo Site');
    // nginx conf written
    expect(created.project.domain).toBe('demo.local');
    const nginx = join(dir, 'nginx', 'conf.d', `${created.project.linuxUser}.conf`);
    expect(existsSync(nginx)).toBe(true);
    expect(readFileSync(nginx, 'utf8')).toContain('demo.local');

    await svc.delete(created.project.id, 'admin');
    expect(svc.list()).toHaveLength(0);
    expect(existsSync(created.project.homeDir)).toBe(false);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('os-provision refuses without EXECUTE/root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-os-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'OsPend',
      runtime: 'node',
      actor: 'admin',
    });
    const r = await svc.provisionOsIsolation(created.project.id, 'admin');
    expect(r.ok).toBe(false);
    expect(r.requiresExecute || r.requiresRoot).toBe(true);
    expect(r.osProvision.attempted).toBe(false);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates with node-starter template scaffold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-tpl-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'TplApp',
      runtime: 'node',
      templateId: 'node-starter',
      actor: 'admin',
    });
    expect(created.scaffold?.ok).toBe(true);
    expect(existsSync(join(created.project.homeDir, 'app', 'server.js'))).toBe(true);
    expect(existsSync(join(created.project.homeDir, 'app', 'package.json'))).toBe(true);

    const applied = svc.applyTemplate(created.project.id, 'static-site', 'admin', true);
    expect(applied.scaffold.ok).toBe(true);
    expect(existsSync(join(created.project.homeDir, 'app', 'public', 'index.html'))).toBe(true);
    expect(svc.get(created.project.id).runtime).toBe('static');

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
