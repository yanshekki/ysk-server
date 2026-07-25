import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { isPortListening } from '../host/health.js';
import { JsonStore } from '../db/store.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { ProjectService } from './project-service.js';
import { ProjectOpsService, isPidAlive } from './project-ops.js';

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
      runtime: 'node',
      actor: 'test',
    });
    repo.updateRuntimeState(project.id, { port: 3123 });
    const pub = await ops.publishNginx(project.id, { actor: 'test' });
    expect(pub.ok).toBe(true);
    expect(pub.nginxPath).toBeTruthy();
    const conf = readFileSync(pub.nginxPath!, 'utf8');
    expect(conf).toContain('proxy_pass http://127.0.0.1:3123');
    expect(conf).toContain('server_name ngx.local');
  });
});
