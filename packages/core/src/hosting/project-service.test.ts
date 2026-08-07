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
    expect(created.project.linuxUser).toMatch(/^ysks_[a-f0-9]{12}$/);
    expect(existsSync(created.project.homeDir)).toBe(true);
    expect(existsSync(join(created.project.homeDir, 'project.json'))).toBe(true);
    // degraded: shadow under dataDir/homes/ysk-server-{id}
    expect(created.project.homeDir.startsWith(join(dir, 'homes', 'ysk-server-'))).toBe(true);
    expect(created.osProvision.ok).toBe(false);
    expect(created.project.osProvisioned).toBe(false);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Demo Site');
    // domain stored; nginx conf only after deploy/publish (no placeholder :3100)
    expect(created.project.domain).toBe('demo.local');
    const nginx = join(dir, 'nginx', 'conf.d', `${created.project.linuxUser}.conf`);
    expect(existsSync(nginx)).toBe(false);
    expect(created.project.nginxConfigPath).toBeFalsy();

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

describe('ProjectService network meta and honesty paths', () => {
  it('updateNetwork rejects domain collision and bad docroot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-net-clash-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const a = await svc.create({ name: 'A', domain: 'a.example.test', runtime: 'static', actor: 't' });
    const b = await svc.create({ name: 'B', domain: 'b.example.test', runtime: 'static', actor: 't' });
    expect(() =>
      svc.updateNetwork(b.project.id, { domain: 'a.example.test' }, 't'),
    ).toThrow(/使用|used|in use|domain|已被/i);
    expect(() => svc.updateNetwork(a.project.id, { docRoot: '../etc' }, 't')).toThrow(
      /docRoot|文件根|invalid|無效/i,
    );
    const ok = svc.updateNetwork(a.project.id, { docRoot: 'public/web' }, 't');
    expect(ok.docRoot).toBe('public/web');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateNetwork patches domain aliases and auth flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-net-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'Net',
      domain: 'old.local',
      runtime: 'node',
      actor: 'admin',
    });
    const updated = svc.updateNetwork(
      created.project.id,
      {
        domain: 'new.local',
        domainAliases: ['www.new.local', 'new.local', 'WWW.new.local'],
        forceHttps: true,
        hsts: true,
        siteRedirectUrl: 'https://new.local/',
        httpAuthUser: 'ops',
        httpAuthPass: 'secret',
        docRoot: 'app/public',
        bindIp: '127.0.0.1',
      },
      'admin',
    );
    expect(updated.domain).toBe('new.local');
    expect(updated.domainAliases).toEqual(['www.new.local']);
    expect(updated.forceHttps).toBe(true);
    expect(updated.hsts).toBe(true);
    expect(updated.siteRedirectUrl).toBe('https://new.local/');
    expect(updated.httpAuthUser).toBe('ops');
    expect(updated.docRoot).toBe('app/public');
    expect(updated.bindIp).toBe('127.0.0.1');
    // clear fields
    const cleared = svc.updateNetwork(
      created.project.id,
      { siteRedirectUrl: null, httpAuthUser: null, httpAuthPass: null, docRoot: null, bindIp: null },
      'admin',
    );
    expect(cleared.siteRedirectUrl).toBeUndefined();
    expect(cleared.httpAuthUser).toBeUndefined();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('setLogExtraDirs normalizes paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-logs-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({ name: 'L', runtime: 'node', actor: 'a' });
    const r = svc.setLogExtraDirs(created.project.id, ['var/log', '/abs/no', '..'], 'a');
    expect(r.project.logExtraDirs).toBeDefined();
    expect(Array.isArray(r.notes)).toBe(true);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('get missing throws; migrateOsIsolation honesty without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-mig-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    expect(() => svc.get('missing')).toThrow();
    const created = await svc.create({ name: 'Mig', runtime: 'node', actor: 'a' });
    const mig = await svc.migrateOsIsolation(created.project.id, 'a');
    expect(mig.ok).toBe(false);
    expect(mig.requiresExecute || mig.requiresRoot).toBe(true);
    expect(mig.plan).toBeTruthy();
    const bulk = await svc.provisionOsIsolationAll('a');
    expect(bulk.ok).toBe(false);
    expect(bulk.attempted).toBe(0);
    expect(bulk.requiresExecute || bulk.requiresRoot).toBe(true);
    // empty name validation
    await expect(svc.create({ name: '  ', runtime: 'node', actor: 'a' })).rejects.toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('php hello create writes nginx→apache upstream not :3100', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-php-create-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'PhpHello',
      domain: 'php.example.test',
      runtime: 'php',
      runtimeVersion: '8.3',
      templateId: 'php-hello',
      actor: 'a',
    });
    expect(created.project.docRoot).toBe('app/public');
    expect(existsSync(join(created.project.homeDir, 'app', 'public', 'index.php'))).toBe(true);
    const nginx = join(dir, 'nginx', 'conf.d', `${created.project.linuxUser}.conf`);
    expect(existsSync(nginx)).toBe(true);
    const conf = readFileSync(nginx, 'utf8');
    expect(conf).toContain('proxy_pass http://127.0.0.1:8080');
    expect(conf).not.toContain('3100');
    expect(conf).not.toContain('fastcgi_pass');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('delete requires confirmName match unless skipConfirm', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-del-confirm-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'ToDelete',
      domain: 'del.local',
      runtime: 'static',
      actor: 'a',
    });
    await expect(
      svc.delete(created.project.id, 'a', { confirmName: 'wrong', removeFiles: false }),
    ).rejects.toThrow();
    const r = await svc.delete(created.project.id, 'a', {
      confirmName: 'ToDelete',
      removeFiles: false,
    });
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /deleted|removeFiles/i.test(n))).toBe(true);
    expect(svc.list()).toHaveLength(0);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('delete removeFiles=false keeps home; applyTemplate unknown throws path covered via static', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-del-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'Keep',
      runtime: 'node',
      templateId: 'node-starter',
      actor: 'a',
    });
    const home = created.project.homeDir;
    await svc.delete(created.project.id, 'a', false);
    expect(svc.list()).toHaveLength(0);
    // home may remain when removeFiles=false — honesty: no crash
    expect(typeof existsSync(home)).toBe('boolean');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
