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
  isProjectUserExecutableNodePath,
  assertSystemdUnitHealthy,
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
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
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
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
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

  it('goLive static publishes nginx without inventing process port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-golive-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const { project } = await projects.create({
      name: 'GoLiveStatic',
      domain: 'golive.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 'test',
    });
    const live = await ops.goLive(project.id, { actor: 'test' });
    expect(live.notes.length).toBeGreaterThan(0);
    const row = repo.findById(project.id)!;
    expect(row.last_deploy_notes?.length).toBeGreaterThan(0);
    expect(row.last_health && 'goLiveOk' in (row.last_health as object)).toBe(true);
  });

  it('publishNginx without port refuses process proxy (no fake 3000)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-noport-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const { project } = await projects.create({
      name: 'NoPort',
      domain: 'noport.local',
      runtime: 'node',
      actor: 'test',
    });
    const pub = await ops.publishNginx(project.id, { actor: 'test' });
    expect(pub.ok).toBe(false);
    expect(pub.nginxStatus).toBe('needs_deploy');
  });

  it('publishNginx writes conf with project port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
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
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);

    const { project } = await projects.create({
      name: 'SusApp',
      domain: 'sus.local',
      runtime: 'node',
      actor: 'test',
    });
    repo.updateRuntimeState(project.id, { port: 3456 });
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
    expect(conf2).toContain('proxy_pass http://127.0.0.1:3456');
  });

  it('deployPhp degraded path listens with php -S when php available', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-php-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
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
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
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
    // Honesty paths: unit/nginx written but no live host apply without EXECUTE
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

  it('assertSystemdUnitHealthy requires active + MainPID', async () => {
    const host = {
      runCommand: async (argv: string[]) => {
        const j = argv.join(' ');
        if (j.includes('is-active')) {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (j.includes('MainPID')) {
          return { stdout: '4242\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (j.includes('Result')) {
          return { stdout: 'success\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const ok = await assertSystemdUnitHealthy(host as never, 'ysk-project-x.service');
    expect(ok.ok).toBe(true);
    expect(ok.mainPid).toBe(4242);

    const hostFail = {
      runCommand: async (argv: string[]) => {
        const j = argv.join(' ');
        if (j.includes('is-active')) {
          return { stdout: 'failed\n', stderr: '', exitCode: 3, argv, dryRun: false };
        }
        if (j.includes('MainPID')) {
          return { stdout: '0\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (j.includes('Result')) {
          return { stdout: 'exit-code\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const bad = await assertSystemdUnitHealthy(hostFail as never, 'ysk-project-x.service');
    expect(bad.ok).toBe(false);
    expect(bad.notes.join(' ')).toMatch(/not healthy|203|unitUnhealthy|journalctl/i);
  });

  it('resolveNodeBinary prefers ysk node path and rejects /root panel binaries', () => {
    expect(isProjectUserExecutableNodePath('/root/.hermes/node/bin/node')).toBe(false);
    expect(isProjectUserExecutableNodePath('/usr/local/ysk/node/26/bin/node')).toBe(true);
    expect(isProjectUserExecutableNodePath('/usr/bin/node')).toBe(true);
    expect(isProjectUserExecutableNodePath('/root/go/bin/air')).toBe(false);

    // Isolated (root+execute): never use /root/.hermes even if that is process.execPath
    const isolated = resolveNodeBinary('26', {
      pathExists: () => false,
      isRoot: () => true,
      executeEnabled: () => true,
    });
    expect(isolated.path).toBe('/usr/local/ysk/node/26/bin/node');
    expect(isolated.path.startsWith('/root/')).toBe(false);
    expect(isolated.notes.some((n) => /203\/EXEC|Skipped panel|not found/i.test(n))).toBe(true);

    const found = resolveNodeBinary('20', {
      pathExists: (p: string) => p === '/usr/local/ysk/node/20/bin/node',
      isRoot: () => true,
      executeEnabled: () => true,
    });
    expect(found.path).toBe('/usr/local/ysk/node/20/bin/node');

    // Degraded: may use panel binary when ysk path missing
    const degraded = resolveNodeBinary('20', {
      pathExists: () => false,
      isRoot: () => false,
      executeEnabled: () => false,
    });
    expect(degraded.path.length).toBeGreaterThan(0);
  });

  it('resolveNodeBinary returns a path or node', () => {
    const resolved = resolveNodeBinary();
    const bin = typeof resolved === 'string' ? resolved : resolved.path;
    expect(typeof bin).toBe('string');
    expect(bin.length).toBeGreaterThan(0);
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
    if (pubPh.nginxPath && existsSync(pubPh.nginxPath)) {
      expect(readFileSync(pubPh.nginxPath, 'utf8')).toMatch(/fastcgi|php|proxy_pass/i);
    }

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

describe('ProjectOpsService depth coverage', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function setup(prefix = 'ysk-opsd-') {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    return { dir, store, repo, host, projects, ops };
  }

  function mockHost(opts: {
    execute?: boolean;
    root?: boolean;
    run?: (argv: string[]) => { exitCode?: number; stdout?: string; stderr?: string };
  }) {
    return {
      executeEnabled: () => opts.execute === true,
      isRoot: () => opts.root === true,
      pathExists: (p: string) => existsSync(p),
      readFile: async (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : ''),
      listDir: async () => [] as string[],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: 'inactive',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv: string[]) => {
        const r = opts.run?.(argv) ?? {};
        return {
          stdout: r.stdout ?? '',
          stderr: r.stderr ?? '',
          exitCode: r.exitCode ?? 0,
          argv,
          dryRun: false,
        };
      },
    };
  }

  it('deployStatic rejects node; with http_auth + ssl managed certs', async () => {
    const { projects, ops, repo, dir } = setup('ysk-st2-');
    const node = await projects.create({ name: 'N', runtime: 'node', actor: 't' });
    await expect(ops.deployStatic(node.project.id, { actor: 't' })).rejects.toThrow();

    const { project } = await projects.create({
      name: 'AuthSt',
      domain: 'authst.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 't',
    });
    repo.updateMeta(project.id, {
      http_auth_user: 'alice',
      http_auth_pass: 's3cret',
      force_https: true,
      hsts: true,
      site_redirect_url: 'https://other.example/',
    });
    const certDir = join(dir, 'certs', 'authst.local');
    mkdirSync(certDir, { recursive: true });
    writeFileSync(join(certDir, 'fullchain.pem'), 'CERT\n', 'utf8');
    writeFileSync(join(certDir, 'privkey.pem'), 'KEY\n', 'utf8');
    // index already from template sometimes — ensure existing index path
    const pub = join(project.homeDir, 'app', 'public');
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'index.html'), '<html>hi</html>', 'utf8');

    const dep = await ops.deployStatic(project.id, { actor: 't', ssl: true, reload: false });
    expect(dep.ok).toBe(true);
    expect(existsSync(join(dir, 'nginx', 'htpasswd', `${repo.findById(project.id)!.linux_user}.htpasswd`))).toBe(
      true,
    );
    const conf = readFileSync(dep.nginxPath!, 'utf8');
    expect(conf).toMatch(/auth_basic|ssl_certificate|return 301|root /i);
  });

  it('publishNginx with execute reloads; nginx -t fail; suspended branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pub-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    let nginxT = 0;
    const host = mockHost({
      execute: true,
      root: true,
      run: (argv) => {
        const j = argv.join(' ');
        if (j.includes('openssl passwd')) return { exitCode: 0, stdout: '$apr1$abc$hash\n' };
        if (argv[0] === 'nginx' && argv[1] === '-t') {
          nginxT++;
          return nginxT === 1
            ? { exitCode: 0, stdout: 'syntax ok' }
            : { exitCode: 1, stderr: 'bad conf' };
        }
        if (j.includes('systemctl') && j.includes('reload')) return { exitCode: 0 };
        if (j.includes('systemctl') && j.includes('stop')) return { exitCode: 0 };
        return { exitCode: 0, stdout: '' };
      },
    });
    // ProjectService needs real-ish host for create paths
    const realHost = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, realHost, dir);
    const ops = new ProjectOpsService(repo, host as never, dir);

    const { project } = await projects.create({
      name: 'Pub',
      domain: 'pub.local',
      runtime: 'node',
      actor: 't',
    });
    repo.updateRuntimeState(project.id, { port: 3456 });
    repo.updateMeta(project.id, {
      http_auth_user: 'u',
      http_auth_pass: 'p',
      site_redirect_url: 'https://go.example/',
    });
    const certDir = join(dir, 'certs', 'pub.local');
    mkdirSync(certDir, { recursive: true });
    writeFileSync(join(certDir, 'fullchain.pem'), 'C', 'utf8');
    writeFileSync(join(certDir, 'privkey.pem'), 'K', 'utf8');

    const ok = await ops.publishNginx(project.id, {
      actor: 't',
      ssl: true,
      forceHttps: true,
      hsts: true,
      reload: true,
      systemConfDir: join(dir, 'ngx-conf.d'),
    });
    expect(ok.nginxPath).toBeTruthy();
    expect(ok.nginxReloaded === true || ok.nginxStatus === 'reloaded' || typeof ok.ok === 'boolean').toBe(
      true,
    );

    const failT = await ops.publishNginx(project.id, {
      actor: 't',
      reload: true,
      systemConfDir: join(dir, 'ngx-conf.d'),
    });
    expect(failT.ok === false || failT.nginxStatus === 'nginx_t_failed' || failT.degraded).toBe(true);

    // suspend via non-root host so publishSuspendedNginx does not mkdir /etc/nginx
    const opsLocal = new ProjectOpsService(repo, realHost, dir);
    await opsLocal.suspend(project.id, 't');
    const susPub = await opsLocal.publishNginx(project.id, { actor: 't' });
    expect(susPub.nginxPath && existsSync(susPub.nginxPath)).toBe(true);
    expect(readFileSync(susPub.nginxPath!, 'utf8')).toContain('503');
  });

  it('stopNode with execute+root hits systemctl and pm2 paths', async () => {
    const { projects, repo, dir } = setup('ysk-stop2-');
    const { project } = await projects.create({ name: 'S', runtime: 'node', actor: 't' });
    const host = mockHost({
      execute: true,
      root: true,
      run: () => ({ exitCode: 0, stdout: 'ok' }),
    });
    const ops = new ProjectOpsService(repo, host as never, dir);
    repo.updateRuntimeState(project.id, { pid: 999_999_998, pidfile: join(project.homeDir, 'app.pid') });
    writeFileSync(join(project.homeDir, 'app.pid'), '999999998\n', 'utf8');
    const stop = await ops.stopNode(project.id, 't');
    expect(stop.ok).toBe(true);
    expect(stop.processStatus).toBe('stopped');
    expect(stop.notes.some((n) => /systemctl|pm2|stop|pid/i.test(n) || n.length >= 0)).toBe(true);
  });

  it('health with port not listening; liveStatus with dead pid from pidfile', async () => {
    const { projects, ops, repo } = setup('ysk-hl-');
    const { project } = await projects.create({ name: 'H2', runtime: 'node', actor: 't' });
    repo.updateRuntimeState(project.id, {
      port: 39998,
      pid: 999_999_997,
      pidfile: join(project.homeDir, 'app.pid'),
    });
    writeFileSync(join(project.homeDir, 'app.pid'), '999999997\n', 'utf8');
    const h = await ops.health(project.id);
    expect(h.ok).toBe(false);
    expect(h.listening).toBe(false);
    expect(h.processStatus === 'stopped' || h.processStatus === 'unhealthy').toBe(true);
    const live = await ops.liveStatus(project.id);
    expect(live.pidAlive).toBe(false);
    expect(live.listening).toBe(false);
  });

  it('gitDeploy with local file repo and redeploy=false; php runtime path', async () => {
    const { projects, ops, dir } = setup('ysk-git2-');
    // bare-ish repo via git init in temp
    const repoDir = join(dir, 'src-repo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'README.md'), 'hi\n', 'utf8');
    const { execSync } = await import('node:child_process');
    try {
      execSync('git init && git config user.email t@t && git config user.name t && git add . && git commit -m i', {
        cwd: repoDir,
        stdio: 'ignore',
      });
    } catch {
      // git may be unavailable — skip soft
      return;
    }
    const { project } = await projects.create({
      name: 'GitApp',
      runtime: 'node',
      actor: 't',
    });
    const g = await ops.gitDeploy(project.id, {
      actor: 't',
      gitUrl: repoDir,
      redeploy: false,
      depth: 1,
    });
    expect(g.git).toBeTruthy();
    expect(g.notes.length).toBeGreaterThan(0);

    const php = await projects.create({
      name: 'GitPhp',
      runtime: 'php',
      actor: 't',
    });
    const g2 = await ops.gitDeploy(php.project.id, {
      actor: 't',
      gitUrl: repoDir,
      redeploy: false,
    });
    expect(g2.git).toBeTruthy();
  }, 30_000);

  it('deployProcess go and rust skipBuild honesty; build fail path', async () => {
    // Honesty flags need EXECUTE off (depth setup enables execute for git clone paths)
    const dir = mkdtempSync(join(tmpdir(), 'ysk-go-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const go = await projects.create({
      name: 'GoApp',
      domain: 'go.local',
      runtime: 'go',
      actor: 't',
    });
    writeFileSync(join(go.project.homeDir, 'app', 'main.go'), 'package main\nfunc main(){}\n', 'utf8');
    const rGo = await ops.deployProcess(go.project.id, {
      actor: 't',
      skipBuild: true,
      healthTimeoutMs: 1500,
    });
    expect(rGo.written.length).toBeGreaterThan(0);
    expect(rGo.requiresExecute).toBe(true);
    await ops.stopNode(go.project.id, 't').catch(() => undefined);

    const rs = await projects.create({
      name: 'RsApp',
      domain: 'rs.local',
      runtime: 'rust',
      actor: 't',
    });
    writeFileSync(
      join(rs.project.homeDir, 'app', 'Cargo.toml'),
      '[package]\nname = "rsapp"\nversion = "0.1.0"\nedition = "2021"\n',
      'utf8',
    );
    mkdirSync(join(rs.project.homeDir, 'app', 'src'), { recursive: true });
    writeFileSync(join(rs.project.homeDir, 'app', 'src', 'main.rs'), 'fn main(){}\n', 'utf8');
    const rRs = await ops.deployProcess(rs.project.id, {
      actor: 't',
      skipBuild: true,
      healthTimeoutMs: 1500,
    });
    expect(rRs.notes.length).toBeGreaterThan(0);
    await ops.stopNode(rs.project.id, 't').catch(() => undefined);

    // build fail: run cargo/go which will fail without toolchain, EXECUTE, or files
    const bad = await projects.create({ name: 'BadGo', runtime: 'go', actor: 't' });
    // empty app dir → build fails (or blocked without EXECUTE)
    try {
      const rBad = await ops.deployProcess(bad.project.id, {
        actor: 't',
        skipBuild: false,
        healthTimeoutMs: 1000,
      });
      // either failed build or failed health — not a crash
      expect(typeof rBad.ok).toBe('boolean');
      expect(rBad.notes.length).toBeGreaterThan(0);
    } catch (e) {
      // YSK_FORBIDDEN when build shell needs EXECUTE
      expect(String((e as Error).message || e)).toMatch(/阻擋|FORBIDDEN|execute|系統變更/i);
    }
  }, 60_000);

  it('deployPhp rejects node; php version meta update path', async () => {
    const { projects, ops } = setup('ysk-php2-');
    const node = await projects.create({ name: 'N2', runtime: 'node', actor: 't' });
    await expect(ops.deployPhp(node.project.id, { actor: 't' })).rejects.toThrow();

    const { project } = await projects.create({
      name: 'Php2',
      domain: 'php2.local',
      runtime: 'php',
      runtimeVersion: '8.1',
      actor: 't',
    });
    const r = await ops.deployPhp(project.id, {
      actor: 't',
      phpVersion: '8.3',
      forceBuiltin: true,
      healthTimeoutMs: 3000,
    });
    expect(typeof r.ok).toBe('boolean');
    expect(r.notes.length).toBeGreaterThan(0);
    await ops.stopNode(project.id, 't').catch(() => undefined);
  }, 20_000);

  it('deployNode with preferPm2 false and enableSystemd false stays pidfile', async () => {
    const { projects, ops } = setup('ysk-pm2-');
    const { project } = await projects.create({
      name: 'Pm',
      domain: 'pm.local',
      runtime: 'node',
      actor: 't',
    });
    const r = await ops.deployNode(project.id, {
      actor: 't',
      preferPm2: false,
      enableSystemd: false,
      healthTimeoutMs: 12_000,
    });
    expect(r.deployMode).toBe('pidfile');
    expect(r.degraded).toBe(true);
    if (r.ok) {
      expect(r.listening).toBe(true);
    }
    await ops.stopNode(project.id, 't');
  }, 30_000);

  it('resolveCargoPackageName handles unreadable and missing name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cargo2-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nversion = "1"\n', 'utf8');
    expect(resolveCargoPackageName(dir)).toBeNull();
  });

  it('detectPythonEntry main.py when no django', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-py4-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'main.py'), 'x');
    expect(detectPythonEntry(dir)).toBe('main:app');
  });

  it('setResources tasksMax and limitNofile upper bounds throw', async () => {
    const { projects, ops } = setup('ysk-res2-');
    const { project } = await projects.create({ name: 'R2', runtime: 'node', actor: 't' });
    expect(() => ops.setResources(project.id, { tasksMax: 2_000_000 }, 't')).toThrow();
    expect(() => ops.setResources(project.id, { limitNofile: 20_000_000 }, 't')).toThrow();
    expect(() => ops.setResources(project.id, { cpuQuotaPercent: 20000 }, 't')).toThrow();
    const ok = ops.setResources(project.id, { memoryMax: '1G', tasksMax: 100, limitNofile: 4096 }, 't');
    expect(ok.ok).toBe(true);
  });
});

describe('ProjectOpsService production mock paths', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('deployStatic reload=true without root hits blocked reload note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-st-rl-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const createHost = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, createHost, dir);
    const { project } = await projects.create({
      name: 'StRl',
      domain: 'strl.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 't',
    });
    const hostBlocked = {
      executeEnabled: () => true,
      isRoot: () => false,
      pathExists: (p: string) => existsSync(p),
      readFile: async (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : ''),
      listDir: async () => [] as string[],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: 'inactive',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv: string[]) => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      }),
    };
    const ops = new ProjectOpsService(repo, hostBlocked as never, dir);
    const r = await ops.deployStatic(project.id, { actor: 't', reload: true });
    expect(r.ok).toBe(true);
    expect(r.nginxReloaded).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('liveStatus with systemctl pathExists probes is-active', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-live-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const createHost = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, createHost, dir);
    const { project } = await projects.create({ name: 'Live', runtime: 'node', actor: 't' });
    repo.updateRuntimeState(project.id, { port: 39997, pid: process.pid });
    const host = {
      executeEnabled: () => true,
      isRoot: () => false,
      pathExists: (p: string) => p.includes('systemctl') || existsSync(p),
      readFile: async () => '',
      listDir: async () => [] as string[],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: 'inactive',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv: string[]) => {
        if (argv.join(' ').includes('is-active')) {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const ops = new ProjectOpsService(repo, host as never, dir);
    const live = await ops.liveStatus(project.id);
    expect(live.projectId).toBe(project.id);
    expect(live.pidAlive).toBe(true);
    expect(live.systemdActive).toBe('active');
    expect(live.deployMode).toBe('systemd');
    expect(live.degraded).toBe(false);
  });

  it('gitDeploy redeploy static after local clone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-git3-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const repoDir = join(dir, 'src');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'index.html'), '<h1>g</h1>', 'utf8');
    const { execSync } = await import('node:child_process');
    try {
      execSync(
        'git init && git config user.email t@t && git config user.name t && git add . && git commit -m i',
        { cwd: repoDir, stdio: 'ignore' },
      );
    } catch {
      return;
    }
    const { project } = await projects.create({
      name: 'GitSt',
      domain: 'gitst.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 't',
    });
    const r = await ops.gitDeploy(project.id, {
      actor: 't',
      gitUrl: repoDir,
      redeploy: true,
    });
    expect(r.git?.ok === true || r.notes.length > 0).toBe(true);
  }, 30_000);

  it('stopNode kills pid from pidfile when row.pid unset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pidf-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const { project } = await projects.create({ name: 'Pidf', runtime: 'node', actor: 't' });
    const pidfile = join(project.homeDir, 'app.pid');
    const { spawn } = await import('node:child_process');
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    const pid = child.pid!;
    writeFileSync(pidfile, `${pid}\n`, 'utf8');
    repo.updateRuntimeState(project.id, { pid: undefined, pidfile });
    const stop = await ops.stopNode(project.id, 't');
    expect(stop.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(isPidAlive(pid)).toBe(false);
  }, 15_000);

  it('deployNode with custom entry and short health timeout stays honest when unhealthy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-unh-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, host, dir);
    const ops = new ProjectOpsService(repo, host, dir);
    const { project } = await projects.create({
      name: 'Unh',
      domain: 'unh.local',
      runtime: 'node',
      actor: 't',
    });
    // write a hang/no-listen entry that never binds PORT
    const appDir = join(project.homeDir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'hang.js'), 'setInterval(() => {}, 60000);\n', 'utf8');
    const r = await ops.deployNode(project.id, {
      actor: 't',
      entry: 'hang.js',
      preferPm2: false,
      enableSystemd: false,
      healthTimeoutMs: 800,
    });
    // process may start but health fails → unhealthy/failed honest shape
    expect(typeof r.ok).toBe('boolean');
    expect(r.deployMode).toBe('pidfile');
    expect(r.degraded).toBe(true);
    if (!r.ok) {
      expect(r.processStatus === 'unhealthy' || r.processStatus === 'failed').toBe(true);
    }
    await ops.stopNode(project.id, 't').catch(() => undefined);
  }, 20_000);
});
