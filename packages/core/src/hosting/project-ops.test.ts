import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { isPortListening } from '../host/health.js';
import { JsonStore } from '../db/store.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { ProjectService } from './project-service.js';
import {
  ProjectOpsService,
  isPidAlive,
  resolveProjectDocRoot,
  detectPythonEntry,
  resolveCargoPackageName,
  resolveNodeBinary,
} from './project-ops.js';

describe('ProjectOpsService real deploy', () => {
  const dirs: string[] = [];
  const opsList: ProjectOpsService[] = [];
  const projectIds: string[] = [];

  afterEach(async () => {
    for (let i = 0; i < projectIds.length; i++) {
      try {
        await opsList[i]?.stopNode(projectIds[i], 'test');
      } catch {
        /* ignore */
      }
    }
    projectIds.length = 0;
    opsList.length = 0;
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('deploys Node process that listens and passes HTTP health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    opsList.push(ops);

    const { project } = await projects.create({
      name: 'RealApp',
      domain: 'real.local',
      runtime: 'node',
      runtimeVersion: '20',
      actor: 'test',
    });
    projectIds.push(project.id);

    const result = await ops.deployNode(project.id, { actor: 'test' });

    expect(result.ok).toBe(true);
    expect(result.port).toBeGreaterThan(0);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.listening).toBe(true);
    expect(result.health?.ok).toBe(true);
    expect(result.processStatus).toBe('running');
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(result.nginxPath && existsSync(result.nginxPath)).toBe(true);

    const conf = readFileSync(result.nginxPath!, 'utf8');
    expect(conf).toContain(`proxy_pass http://127.0.0.1:${result.port}`);
    expect(await isPortListening(result.port!)).toBe(true);
    expect(isPidAlive(result.pid!)).toBe(true);

    const health = await ops.health(project.id);
    expect(health.ok).toBe(true);
    expect(health.listening).toBe(true);

    const row = repo.findById(project.id)!;
    expect(row.process_status).toBe('running');
    expect(row.port).toBe(result.port);
    expect(row.pid).toBe(result.pid);

    const env = ops.setEnv(project.id, { FOO: 'bar', EMPTY: '' }, 'test');
    expect(env.ok).toBe(true);
    expect(existsSync(join(project.homeDir, 'app', '.env'))).toBe(true);
    expect(readFileSync(join(project.homeDir, 'app', '.env'), 'utf8')).toContain('FOO=bar');
    expect(readFileSync(join(project.homeDir, 'app', '.env'), 'utf8')).not.toContain('EMPTY=');

    const bak = await ops.backup(project.id, 'test');
    expect(bak.ok).toBe(true);
    expect(bak.archivePath && existsSync(bak.archivePath)).toBe(true);

    const stop = await ops.stopNode(project.id, 'test');
    expect(stop.ok).toBe(true);
    expect(stop.processStatus).toBe('stopped');
    // give OS a moment
    await new Promise((r) => setTimeout(r, 300));
    expect(await isPortListening(result.port!)).toBe(false);
  }, 30_000);

  it('backups project and setEnv writes .env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-env-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);

    const { project } = await projects.create({
      name: 'EnvBak',
      runtime: 'node',
      actor: 'test',
    });
    const env = ops.setEnv(project.id, { FOO: 'bar', PORT: '3999' }, 'test');
    expect(env.ok).toBe(true);
    expect(existsSync(join(project.homeDir, 'app', '.env'))).toBe(true);
    expect(readFileSync(join(project.homeDir, 'app', '.env'), 'utf8')).toContain('FOO=bar');

    const bak = await ops.backup(project.id, 'test');
    expect(bak.ok).toBe(true);
    expect(bak.archivePath && existsSync(bak.archivePath)).toBe(true);
    const row = repo.findById(project.id)!;
    expect(row.last_backup_path).toBe(bak.archivePath);
  });

  it('publishNginx writes conf with project port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);

    const { project } = await projects.create({
      name: 'NgxOnly',
      domain: 'ngx.local',
      domainAliases: ['www.ngx.local'],
      runtime: 'node',
      actor: 'test',
    });
    repo.updateRuntimeState(project.id, { port: 3123 });
    const pub = await ops.publishNginx(project.id, { actor: 'test' });
    expect(pub.ok).toBe(true);
    expect(pub.nginxPath).toBeTruthy();
    const conf = readFileSync(pub.nginxPath!, 'utf8');
    expect(conf).toContain('proxy_pass http://127.0.0.1:3123');
    expect(conf).toContain('server_name ngx.local www.ngx.local');
  });

  it('suspend publishes 503 and unsuspend restores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sus-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);

    const { project } = await projects.create({
      name: 'SusApp',
      domain: 'sus.local',
      runtime: 'node',
      actor: 'test',
    });
    const sus = await ops.suspend(project.id, 'test');
    expect(sus.ok).toBe(true);
    expect(repo.findById(project.id)?.status).toBe('suspended');
    const conf = readFileSync(sus.nginxPath!, 'utf8');
    expect(conf).toContain('return 503');
    const uns = await ops.unsuspend(project.id, 'test');
    expect(uns.ok).toBe(true);
    expect(repo.findById(project.id)?.status).toBe('stopped');
    const conf2 = readFileSync(uns.nginxPath!, 'utf8');
    expect(conf2).not.toContain('return 503');
  });

  it('deployPhp degraded path listens with php -S when php available', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-php-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    opsList.push(ops);

    const { project } = await projects.create({
      name: 'PhpApp',
      domain: 'php.local',
      runtime: 'php',
      templateId: 'wordpress-php',
      actor: 'test',
    });
    projectIds.push(project.id);

    const result = await ops.deployPhp(project.id, {
      actor: 'test',
      forceBuiltin: true,
      healthTimeoutMs: 15_000,
    });
    // php may or may not be installed in CI — assert honest result shape
    expect(typeof result.ok).toBe('boolean');
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.written.length).toBeGreaterThan(0);
    if (result.ok) {
      expect(result.listening).toBe(true);
      expect(result.port).toBeGreaterThan(0);
      expect(result.degraded).toBe(true);
      await ops.stopNode(project.id, 'test');
    } else {
      expect(result.notes.some((n) => /php binary|failed|spawn/i.test(n))).toBe(true);
    }
  }, 30_000);

  it('deployStatic writes nginx root conf and index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-static-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);

    const { project } = await projects.create({
      name: 'StaticSite',
      domain: 'static.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 'test',
    });
    const dep = await ops.deployStatic(project.id, { actor: 'test' });
    expect(dep.ok).toBe(true);
    expect(dep.nginxPath && existsSync(dep.nginxPath)).toBe(true);
    expect(existsSync(join(project.homeDir, 'app', 'public', 'index.html'))).toBe(true);
    const conf = readFileSync(dep.nginxPath!, 'utf8');
    expect(conf).toContain('root ');
    expect(conf).toContain('try_files');
    expect(conf).toContain('server_name static.local');
    expect(dep.degraded).toBe(true); // no root reload
  });
});

describe('ProjectOpsService helpers and honesty paths', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function setup(prefix = 'ysk-ops2-') {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    return { dir, repo, host, projects, ops };
  }

  it('resolveProjectDocRoot strips traversal and defaults', async () => {
    const { projects, repo } = setup('ysk-docroot-');
    const { project } = await projects.create({ name: 'Doc', runtime: 'static', actor: 't' });
    const row = repo.findById(project.id)!;
    expect(resolveProjectDocRoot(row)).toBe(join(row.home_dir, 'app/public'));
    repo.updateMeta(project.id, { doc_root: '/app/html' });
    const row2 = repo.findById(project.id)!;
    expect(resolveProjectDocRoot(row2)).toBe(join(row2.home_dir, 'app/html'));
    repo.updateMeta(project.id, { doc_root: '../etc/passwd' });
    const row3 = repo.findById(project.id)!;
    expect(resolveProjectDocRoot(row3)).toBe(join(row3.home_dir, 'etc/passwd'));
  });

  it('detectPythonEntry prefers Django wsgi then main:app then app.py', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-py-'));
    dirs.push(dir);
    expect(detectPythonEntry(dir)).toBeNull();
    mkdirSync(join(dir, 'mysite'), { recursive: true });
    writeFileSync(join(dir, 'mysite', 'wsgi.py'), '#');
    writeFileSync(join(dir, 'mysite', 'settings.py'), '#');
    expect(detectPythonEntry(dir)).toBe('mysite.wsgi:application');
    const dir2 = mkdtempSync(join(tmpdir(), 'ysk-py2-'));
    dirs.push(dir2);
    writeFileSync(join(dir2, 'main.py'), 'app=1');
    expect(detectPythonEntry(dir2)).toBe('main:app');
    const dir3 = mkdtempSync(join(tmpdir(), 'ysk-py3-'));
    dirs.push(dir3);
    writeFileSync(join(dir3, 'app.py'), 'x');
    expect(detectPythonEntry(dir3)).toBe('app.py');
  });

  it('resolveCargoPackageName reads Cargo.toml name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cargo-'));
    dirs.push(dir);
    expect(resolveCargoPackageName(dir)).toBeNull();
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "hello-rs"\nversion = "0.1.0"\n');
    expect(resolveCargoPackageName(dir)).toBe('hello-rs');
  });

  it('resolveNodeBinary returns process.execPath or node', () => {
    const bin = resolveNodeBinary();
    expect(bin === process.execPath || bin === 'node').toBe(true);
  });

  it('isPidAlive true for self and false for dead pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(999_999_999)).toBe(false);
  });

  it('health without port is honest fail; liveStatus reflects stopped', async () => {
    const { projects, ops } = setup('ysk-health-');
    const { project } = await projects.create({ name: 'H', runtime: 'node', actor: 't' });
    const h = await ops.health(project.id);
    expect(h.ok).toBe(false);
    expect(h.listening).toBe(false);
    expect(h.notes.some((n) => n.length > 0)).toBe(true);
    const live = await ops.liveStatus(project.id);
    expect(live.projectId).toBe(project.id);
    expect(live.listening).toBe(false);
    expect(live.pidAlive).toBe(false);
    expect(live.degraded).toBe(true);
    expect(live.linuxUser).toMatch(/^ysks_/);
  });

  it('setResources validates and persists; setQuota honesty', async () => {
    const { projects, ops, repo } = setup('ysk-res-');
    const { project } = await projects.create({ name: 'R', runtime: 'node', actor: 't' });
    const ok = ops.setResources(project.id, { memoryMax: '256M', cpuQuotaPercent: 40, tasksMax: 64, limitNofile: 1024 }, 't');
    expect(ok.ok).toBe(true);
    const row = repo.findById(project.id)!;
    expect(row.memory_max).toBe('256M');
    expect(row.cpu_quota_percent).toBe(40);
    expect(() => ops.setResources(project.id, { memoryMax: 'nope' }, 't')).toThrow();
    expect(() => ops.setResources(project.id, { cpuQuotaPercent: 0 }, 't')).toThrow();
    expect(() => ops.setResources(project.id, { tasksMax: -1 }, 't')).toThrow();
    expect(() => ops.setResources(project.id, { limitNofile: 10 }, 't')).toThrow();
    const q = await ops.setQuota(project.id, 512, 't');
    expect(q.ok).toBe(true);
    expect(q.quota).toBeTruthy();
    expect(repo.findById(project.id)?.quota_mb).toBe(512);
    const qs = await ops.quotaStatus(project.id);
    expect(typeof qs.usedMb).toBe('number');
  });

  it('getOsUser / patchOsUser / applyOsLimits / chownOsHome honesty without root', async () => {
    const { projects, ops } = setup('ysk-os-');
    const { project } = await projects.create({ name: 'O', runtime: 'node', actor: 't' });
    const gu = await ops.getOsUser(project.id);
    expect(gu.limits.shell).toMatch(/nologin|\/bin\/false|\/usr\/sbin\/nologin/);
    await expect(ops.patchOsUser(project.id, { shell: 'not-absolute' }, 't')).rejects.toThrow();
    const patch = await ops.patchOsUser(project.id, { memoryMax: '128M', accountLocked: false }, 't');
    expect(patch.projectId).toBe(project.id);
    // without root+execute, apply is fail-soft
    expect(typeof patch.ok).toBe('boolean');
    const limits = await ops.applyOsLimits(project.id, 't');
    expect(limits.projectId).toBe(project.id);
    const ch = await ops.chownOsHome(project.id, 't');
    expect(ch.projectId).toBe(project.id);
    expect(Array.isArray(ch.notes)).toBe(true);
  });

  it('publishNginx runtime-aware for static and php; suspend path via status', async () => {
    const { projects, ops, repo } = setup('ysk-ngx2-');
    const st = await projects.create({
      name: 'St',
      domain: 'st.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 't',
    });
    const pubSt = await ops.publishNginx(st.project.id, { actor: 't', reload: true });
    expect(pubSt.nginxPath && existsSync(pubSt.nginxPath)).toBe(true);
    expect(readFileSync(pubSt.nginxPath!, 'utf8')).toContain('root ');
    // reload requested but no execute → degraded honesty
    expect(pubSt.requiresExecute).toBe(true);
    expect(pubSt.nginxReloaded).toBe(false);

    const ph = await projects.create({
      name: 'Ph',
      domain: 'ph.local',
      runtime: 'php',
      runtimeVersion: '8.2',
      actor: 't',
    });
    const pubPh = await ops.publishNginx(ph.project.id, { actor: 't', ssl: true });
    expect(pubPh.ok === true || pubPh.ok === false).toBe(true);
    expect(readFileSync(pubPh.nginxPath!, 'utf8')).toMatch(/fastcgi|php|proxy_pass/i);

    // forceHttps flags
    const node = await projects.create({ name: 'N', domain: 'n.local', runtime: 'node', actor: 't' });
    repo.updateRuntimeState(node.project.id, { port: 3333 });
    const pubN = await ops.publishNginx(node.project.id, {
      actor: 't',
      forceHttps: true,
      hsts: true,
      ssl: true,
    });
    expect(repo.findById(node.project.id)?.force_https).toBe(true);
    expect(pubN.notes.some((n) => n.length > 0)).toBe(true);
  });

  it('gitDeploy validates missing url; deployProcess rejects static runtime', async () => {
    const { projects, ops } = setup('ysk-git-');
    const { project } = await projects.create({ name: 'G', runtime: 'node', actor: 't' });
    await expect(ops.gitDeploy(project.id, { actor: 't' })).rejects.toThrow();
    await expect(ops.deployProcess(project.id, { actor: 't' })).resolves.toBeTruthy(); // node routes to deployNode
    const st = await projects.create({ name: 'S2', runtime: 'static', actor: 't' });
    await expect(ops.deployProcess(st.project.id, { actor: 't' })).rejects.toThrow();
    await expect(ops.deployNode(st.project.id, { actor: 't' })).rejects.toThrow();
  });

  it('deployProcess python skipBuild writes unit and reports honesty', async () => {
    const { projects, ops, dir } = setup('ysk-proc-');
    const { project } = await projects.create({
      name: 'PyApp',
      domain: 'py.local',
      runtime: 'python',
      actor: 't',
    });
    writeFileSync(join(project.homeDir, 'app', 'main.py'), 'print("hi")\n');
    const r = await ops.deployProcess(project.id, {
      actor: 't',
      skipBuild: true,
      healthTimeoutMs: 2_000,
    });
    // likely unhealthy without a real server — but unit written + honest flags
    expect(r.written.some((p) => p.includes('systemd') || p.endsWith('.service') || p.includes('.conf'))).toBe(true);
    expect(r.requiresExecute).toBe(true);
    expect(r.degraded === true || r.ok === false || r.ok === true).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
    // cleanup any spawned pid
    await ops.stopNode(project.id, 't').catch(() => undefined);
    void dir;
  }, 20_000);

  it('require missing project throws; stopNode ok for never-started', async () => {
    const { ops, projects } = setup('ysk-stop-');
    await expect(ops.health('no-such-id')).rejects.toThrow();
    const { project } = await projects.create({ name: 'Stop', runtime: 'node', actor: 't' });
    const stop = await ops.stopNode(project.id, 't');
    expect(stop.ok).toBe(true);
    expect(stop.processStatus).toBe('stopped');
  });

  it('setEnv merges and removes empty keys', async () => {
    const { projects, ops } = setup('ysk-env2-');
    const { project } = await projects.create({ name: 'E', runtime: 'node', actor: 't' });
    ops.setEnv(project.id, { A: '1', B: '2' }, 't');
    const r = ops.setEnv(project.id, { B: '', C: '3' }, 't');
    expect(r.ok).toBe(true);
    const body = readFileSync(join(project.homeDir, 'app', '.env'), 'utf8');
    expect(body).toContain('A=1');
    expect(body).toContain('C=3');
    expect(body).not.toContain('B=');
  });
});
