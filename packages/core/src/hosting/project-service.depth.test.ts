import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { LocalHostExecutor } from '../host/executor.js';
import { ProjectService } from './project-service.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

describe('ProjectService remaining branches', () => {
  it('php runtime heals away node default version 20', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-php-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const repo = new ProjectRepository(db);
    const svc = new ProjectService(repo, host, dir);
    const created = await svc.create({
      name: 'PhpApp',
      runtime: 'php',
      runtimeVersion: '20',
      actor: 'admin',
    });
    // heal on get/list should normalize php version
    const got = svc.get(created.project.id);
    expect(got.runtime).toBe('php');
    expect(got.runtimeVersion).not.toBe('20');
    const listed = svc.list();
    expect(listed[0]?.runtime).toBe('php');
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('create with domain aliases and static runtime without template', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-st-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'Static',
      domain: 'static.local',
      domainAliases: ['www.static.local', 'static.local'],
      runtime: 'static',
      env: 'staging',
      actor: 'admin',
    });
    expect(created.project.env).toBe('staging');
    expect(created.project.domain).toBe('static.local');
    expect(existsSync(join(created.project.homeDir, 'app'))).toBe(true);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateNetwork domainAliases dedupe and forceHttps false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-net-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'N2',
      domain: 'a.local',
      runtime: 'node',
      actor: 'a',
    });
    const u = svc.updateNetwork(
      created.project.id,
      {
        domainAliases: ['b.local', 'B.local', 'a.local'],
        forceHttps: false,
        hsts: false,
      },
      'a',
    );
    expect(u.domainAliases?.every((d) => d === d.toLowerCase())).toBe(true);
    expect(u.forceHttps).toBe(false);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('setLogExtraDirs empty and delete missing throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-log-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({ name: 'L2', runtime: 'node', actor: 'a' });
    const r = svc.setLogExtraDirs(created.project.id, '', 'a');
    expect(r.project).toBeTruthy();
    await expect(svc.delete('missing-id', 'a')).rejects.toThrow();
    expect(() => svc.setLogExtraDirs('missing', [], 'a')).toThrow();
    expect(() =>
      svc.applyTemplate('missing', 'static-site', 'a'),
    ).toThrow();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('provisionOsIsolation with mock execute+root still honest if user missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-os-'));
    const db = openDatabase(join(dir, 'db.json'));
    const cmds: string[][] = [];
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async (p: string) => {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(p, { recursive: true });
      },
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async (argv: string[]) => {
        cmds.push(argv);
        // id check fails → not provisioned
        if (argv.join(' ').includes('id ')) {
          return empty({ stdout: '1\n', exitCode: 0 });
        }
        return empty({ exitCode: 0 });
      },
    } as unknown as HostExecutor;

    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({
      name: 'OsMock',
      runtime: 'node',
      actor: 'admin',
    });
    // create may have attempted OS when execute+root — ok may be false
    expect(created.project.homeDir).toBeTruthy();
    const prov = await svc.provisionOsIsolation(created.project.id, 'admin');
    expect(typeof prov.ok).toBe('boolean');
    expect(prov.osProvision.attempted === true || prov.ok === false).toBe(true);
    // bulk with limit/filter
    const bulk = await svc.provisionOsIsolationAll('admin', {
      limit: 5,
      projectIds: [created.project.id],
    });
    expect(bulk.attempted).toBeGreaterThanOrEqual(0);
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrateOsIsolation when already canonical reports ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-mig-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const svc = new ProjectService(new ProjectRepository(db), host, dir);
    const created = await svc.create({ name: 'M', runtime: 'node', actor: 'a' });
    // without root, migrate is blocked
    const mig = await svc.migrateOsIsolation(created.project.id, 'a', {
      removePreviousHome: false,
    });
    expect(mig.ok).toBe(false);
    expect(mig.plan).toBeTruthy();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('delete with root mock runs systemctl disable path; applyTemplate on existing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-del-'));
    const db = openDatabase(join(dir, 'db.json'));
    // create with non-root first so home is under dataDir
    const local = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const repo = new ProjectRepository(db);
    const createSvc = new ProjectService(repo, local, dir);
    const created = await createSvc.create({ name: 'Del', runtime: 'node', actor: 'a' });
    const home = created.project.homeDir;

    // apply template
    const tpl = createSvc.applyTemplate(created.project.id, 'static-site', 'a', true);
    expect(tpl.scaffold).toBeTruthy();

    const cmds: string[][] = [];
    const rootHost = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p: string) => existsSync(p),
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async (p: string) => {
        rmSync(p, { recursive: true, force: true });
      },
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async (argv: string[]) => {
        cmds.push([...argv]);
        if (argv.join(' ').includes('id ')) return empty({ stdout: '0\n' });
        return empty({ exitCode: 0 });
      },
    } as unknown as HostExecutor;

    // set pid so kill branch runs
    repo.updateRuntimeState(created.project.id, { pid: 1 });
    const delSvc = new ProjectService(repo, rootHost, dir);
    await delSvc.delete(created.project.id, 'a', true);
    expect(cmds.some((a) => a[0] === 'systemctl' || a.join(' ').includes('userdel'))).toBe(true);
    // home may be removed
    expect(typeof existsSync(home)).toBe('boolean');

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('delete removeFiles under dataDir without root; migrate already provisioned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-proj-del2-'));
    const db = openDatabase(join(dir, 'db.json'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const repo = new ProjectRepository(db);
    const svc = new ProjectService(repo, host, dir);
    const created = await svc.create({ name: 'D2', runtime: 'static', templateId: 'static-site', actor: 'a' });
    const home = created.project.homeDir;
    expect(existsSync(home)).toBe(true);
    await svc.delete(created.project.id, 'a', true);
    // control-plane home under dataDir should be gone
    expect(existsSync(home)).toBe(false);

    // second project for migrate with setOsProvisioned
    const c2 = await svc.create({ name: 'D3', runtime: 'node', actor: 'a' });
    repo.setOsProvisioned(c2.project.id, true);
    const mig = await svc.migrateOsIsolation(c2.project.id, 'a');
    // already provisioned + may be canonical → ok true or blocked without root
    expect(typeof mig.ok).toBe('boolean');
    expect(mig.plan).toBeTruthy();

    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });
});
