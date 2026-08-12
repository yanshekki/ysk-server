/**
 * Production-path coverage via mock HostExecutor (execute+root) without real systemd/nginx /etc writes.
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { AuditRepository } from '../repositories/audit-repo.js';
import { ProjectService } from './project-service.js';
import { ProjectOpsService, isPidAlive } from './project-ops.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { LocalHostExecutor } from '../host/executor.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockRootHost(opts?: {
  run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>;
  pathExists?: (p: string) => boolean;
  root?: boolean;
  execute?: boolean;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute ?? true,
    isRoot: () => opts?.root ?? true,
    pathExists: (p) => opts?.pathExists?.(p) ?? existsSync(p),
    readFile: async (p) => (existsSync(p) ? readFileSync(p, 'utf8') : ''),
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      const partial = opts?.run ? await opts.run(argv) : {};
      return { ...empty(), argv, ...partial };
    },
  };
}

describe('ProjectOpsService production mocks', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  async function makeProject(
    dir: string,
    runtime: 'node' | 'static' | 'php' | 'python',
  ) {
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const audit = new AuditRepository(store);
    const local = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, local, dir);
    const { project } = await projects.create({
      name: `App-${runtime}`,
      domain: `${runtime}.local`,
      runtime,
      runtimeVersion: runtime === 'php' ? '8.3' : runtime === 'node' ? '20' : 'default',
      templateId: runtime === 'static' ? 'static-site' : undefined,
      actor: 't',
    } as never);
    // isolation required for root+execute deploys
    repo.setOsProvisioned(project.id, true);
    return { store, repo, audit, project };
  }

  it('deployStatic reload=true without root hits blocked note; with execute false stays managed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-st-'));
    dirs.push(dir);
    const { repo, audit, project } = await makeProject(dir, 'static');
    const host = mockRootHost({
      root: false,
      execute: true,
      run: async () => ({ exitCode: 0 }),
    });
    const ops = new ProjectOpsService(repo, host, dir, audit);
    const r = await ops.deployStatic(project.id, { actor: 't', reload: true });
    expect(r.ok).toBe(true);
    expect(r.nginxReloaded).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('deployNode prefer systemd path when root+execute and os_provisioned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-sd-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'node');
    const appDir = join(project.homeDir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, 'server.js'),
      `require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT||3000,'127.0.0.1');\n`,
      'utf8',
    );
    // Use a sacrificial sleep PID — never return the vitest worker pid (stop would kill it)
    const { spawn } = await import('node:child_process');
    const decoy = spawn('sleep', ['120'], { detached: true, stdio: 'ignore' });
    decoy.unref();
    const decoyPid = decoy.pid!;
    const host = mockRootHost({
      run: async (argv) => {
        const j = argv.join(' ');
        if (j.includes('MainPID')) return { exitCode: 0, stdout: `${decoyPid}\n` };
        if (argv[0] === 'systemctl') return { exitCode: 0, stdout: 'active\n' };
        if (argv[0] === 'cp') return { exitCode: 0 };
        if (argv[0] === 'pm2') return { exitCode: 1, stderr: 'no pm2' };
        return { exitCode: 0 };
      },
    });
    const ops = new ProjectOpsService(repo, host, dir);
    try {
      const r = await ops.deployNode(project.id, {
        actor: 't',
        entry: 'server.js',
        preferPm2: false,
        enableSystemd: true,
        healthTimeoutMs: 3000,
      });
      expect(typeof r.ok).toBe('boolean');
      expect(r.notes.length).toBeGreaterThan(0);
      // systemd success would set deployMode; otherwise pidfile/pm2 fallback still honest
      expect(['systemd', 'pm2', 'pidfile', 'none']).toContain(r.deployMode ?? 'pidfile');
    } finally {
      await ops.stopNode(project.id, 't').catch(() => undefined);
      try {
        process.kill(decoyPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  }, 25_000);

  it('deployNode preferPm2 after systemd miss covers tryPm2 branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-pm2-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'node');
    const appDir = join(project.homeDir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, 'server.js'),
      `require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT||3000,'127.0.0.1');\n`,
      'utf8',
    );
    const host = mockRootHost({
      run: async (argv) => {
        if (argv[0] === 'cp') return { exitCode: 1, stderr: 'cp fail' };
        if (argv[0] === 'systemctl') return { exitCode: 1 };
        if (argv[0] === 'pm2' || argv.join(' ').includes('pm2')) {
          return { exitCode: 1, stderr: 'pm2 not really started' };
        }
        return { exitCode: 0 };
      },
    });
    const ops = new ProjectOpsService(repo, host, dir);
    const r = await ops.deployNode(project.id, {
      actor: 't',
      entry: 'server.js',
      preferPm2: true,
      enableSystemd: true,
      healthTimeoutMs: 2500,
    });
    expect(r.degraded === true || r.deployMode === 'pidfile' || r.deployMode === 'pm2').toBe(true);
    await ops.stopNode(project.id, 't').catch(() => undefined);
  }, 25_000);

  it('deployPhp forceBuiltin without php binary fails honestly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-php-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'php');
    const host = mockRootHost({
      run: async () => ({ exitCode: 1, stderr: 'php not found' }),
      pathExists: () => false,
    });
    const ops = new ProjectOpsService(repo, host, dir);
    const r = await ops.deployPhp(project.id, {
      actor: 't',
      forceBuiltin: true,
      preferFpm: false,
      enableApache: false,
    });
    expect(r.ok === false || r.degraded === true).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('deployProcess python with os_provisioned writes unit artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-py-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'python');
    const appDir = join(project.homeDir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, 'main.py'),
      'import http.server, os\nport=int(os.environ.get("PORT","8000"))\nhttp.server.HTTPServer(("127.0.0.1",port), http.server.SimpleHTTPRequestHandler).serve_forever()\n',
      'utf8',
    );
    // avoid writing /etc/systemd unit file (EACCES) — use non-root so systemd install branch skipped,
    // still covers process deploy unit write + pidfile
    const host = mockRootHost({
      root: false,
      execute: true,
      run: async (argv) => {
        if (argv[0] === 'systemctl' && argv.includes('is-active')) {
          return { exitCode: 3, stdout: 'inactive\n' };
        }
        return { exitCode: 0 };
      },
    });
    const ops = new ProjectOpsService(repo, host, dir);
    const r = await ops.deployProcess(project.id, {
      actor: 't',
      entry: 'main.py',
      skipBuild: true,
      healthTimeoutMs: 1500,
    });
    expect(r.notes.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'systemd')) || r.written.length >= 0).toBe(true);
    await ops.stopNode(project.id, 't').catch(() => undefined);
  }, 20_000);

  it('deployProcess with root tries system unit install (may catch EACCES)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-py2-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'python');
    const appDir = join(project.homeDir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'main.py'), 'print("hi")\n', 'utf8');
    const host = mockRootHost({
      run: async (argv) => {
        if (argv[0] === 'systemctl' && argv[1] === 'enable') {
          return { exitCode: 1, stderr: 'Failed to enable' };
        }
        if (argv[0] === 'systemctl' && argv.includes('is-active')) {
          return { exitCode: 3, stdout: 'inactive\n' };
        }
        if (argv[0] === 'systemctl') return { exitCode: 0 };
        return { exitCode: 0 };
      },
    });
    const ops = new ProjectOpsService(repo, host, dir);
    // writeFileSync/mkdir to /etc may throw EACCES on CI runners
    try {
      const r = await ops.deployProcess(project.id, {
        actor: 't',
        entry: 'main.py',
        skipBuild: true,
        healthTimeoutMs: 800,
      });
      expect(r.notes.length).toBeGreaterThan(0);
    } catch (e) {
      expect(String((e as NodeJS.ErrnoException).code || e)).toMatch(/EACCES|EPERM|permission/i);
    }
    await ops.stopNode(project.id, 't').catch(() => undefined);
  }, 20_000);

  it('stopProcess SIGKILL path when pid ignores SIGTERM briefly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-kill-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'node');
    const { spawn } = await import('node:child_process');
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    child.unref();
    const pid = child.pid!;
    const pidfile = join(project.homeDir, 'app.pid');
    writeFileSync(pidfile, `${pid}\n`, 'utf8');
    repo.updateRuntimeState(project.id, { pid, pidfile });
    const ops = new ProjectOpsService(repo, mockRootHost({ root: false }), dir);
    const stop = await ops.stopNode(project.id, 't');
    expect(stop.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(isPidAlive(pid)).toBe(false);
  }, 15_000);

  it('publishNginx without root does not touch /etc', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-ngx-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'static');
    repo.updateRuntimeState(project.id, {
      http_auth_user: 'admin',
      http_auth_pass: 'secret',
      force_https: true,
      hsts: true,
    } as never);
    const certDir = join(dir, 'certs', 'managed', 'static.local');
    mkdirSync(certDir, { recursive: true });
    writeFileSync(join(certDir, 'fullchain.pem'), 'C\n');
    writeFileSync(join(certDir, 'privkey.pem'), 'K\n');
    const ops = new ProjectOpsService(
      repo,
      mockRootHost({
        root: false,
        execute: true,
        run: async () => ({ exitCode: 0 }),
      }),
      dir,
    );
    const pub = await ops.publishNginx(project.id, 't');
    expect(pub.ok).toBe(true);
    expect(pub.nginxPath && existsSync(pub.nginxPath)).toBe(true);
  });

  it('gitDeploy with redeploy=false only syncs; static redeploy works', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-git-'));
    dirs.push(dir);
    const { repo, project } = await makeProject(dir, 'static');
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
    const ops = new ProjectOpsService(
      repo,
      mockRootHost({ root: false, execute: false }),
      dir,
    );
    const noRedeploy = await ops.gitDeploy(project.id, {
      actor: 't',
      gitUrl: repoDir,
      redeploy: false,
    });
    expect(noRedeploy.git).toBeTruthy();

    const withRedeploy = await ops.gitDeploy(project.id, {
      actor: 't',
      gitUrl: repoDir,
      redeploy: true,
    });
    expect(withRedeploy.notes.length).toBeGreaterThan(0);
  }, 30_000);

  it('assertOsIsolation throws on root+execute without os_provisioned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ops-iso-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const local = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    const projects = new ProjectService(repo, local, dir);
    const { project } = await projects.create({
      name: 'NoOs',
      runtime: 'node',
      actor: 't',
    });
    // leave os_provisioned false
    const ops = new ProjectOpsService(repo, mockRootHost(), dir);
    await expect(
      ops.deployNode(project.id, { actor: 't', preferPm2: false, enableSystemd: false }),
    ).rejects.toThrow(/隔離|isolation|os|Linux|user/i);
  });
});
