/**
 * Cover PHP-FPM production branch by mocking applyPhpFpmPool + applyPhpHosting.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { ProjectRepository } from '../repositories/project-repo.js';
import { LocalHostExecutor } from '../host/executor.js';
import { ProjectService } from './project-service.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

vi.mock('./php-fpm.js', () => ({
  applyPhpFpmPool: vi.fn(async () => ({
    ok: true,
    enabled: true,
    written: ['/tmp/ysk-fpm-pool.conf'],
    notes: ['mocked fpm enabled'],
  })),
}));

vi.mock('./system-apply.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./system-apply.js')>();
  return {
    ...actual,
    applyPhpHosting: vi.fn(async () => ({
      ok: true,
      written: ['/tmp/ysk-php-hosting'],
      notes: ['mocked php hosting'],
      executed: true,
      siteEnabled: true,
      apacheUpstream: 'http://127.0.0.1:8080',
      vhostPath: '/tmp/ysk-apache-vhost.conf',
      commands: [],
      commandResults: [],
    })),
  };
});

vi.mock('./nginx-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nginx-sync.js')>();
  return {
    ...actual,
    syncNginxConfigs: vi.fn(async () => ({
      sourceDir: '/tmp',
      targetDir: '/etc/nginx/conf.d',
      files: [],
      copied: ['/etc/nginx/conf.d/ysk-x.conf'],
      tested: true,
      notes: ['mocked sync'],
      ok: true,
    })),
  };
});

import { ProjectOpsService } from './project-ops.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

describe('ProjectOpsService FPM production mock', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('deployPhp with preferFpm + root takes Nginx→Apache→FPM path when enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fpm-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const local = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, local, dir);
    const { project } = await projects.create({
      name: 'PhpFpm',
      domain: 'phpfpm.local',
      runtime: 'php',
      runtimeVersion: '8.3',
      actor: 't',
    });
    repo.setOsProvisioned(project.id, true);
    mkdirSync(join(project.homeDir, 'app', 'public'), { recursive: true });
    writeFileSync(join(project.homeDir, 'app', 'public', 'index.php'), '<?php echo 1;\n');

    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async (argv) => {
        if (argv[0] === 'systemctl' && argv[1] === 'reload') {
          return empty({ exitCode: 0 });
        }
        return empty();
      },
    };

    const ops = new ProjectOpsService(repo, host, dir);
    const r = await ops.deployPhp(project.id, {
      actor: 't',
      preferFpm: true,
      forceBuiltin: false,
    });
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(false);
    expect(
      r.notes.some((n) => /Apache|proxy_pass|php_apache|Nginx → Apache/i.test(n)),
    ).toBe(true);
    expect(r.nginxPath && existsSync(r.nginxPath)).toBe(true);
    if (r.nginxPath) {
      const body = (await import('node:fs')).readFileSync(r.nginxPath, 'utf8');
      expect(body).toContain('proxy_pass http://127.0.0.1:8080');
      expect(body).not.toContain('fastcgi_pass');
    }
  });

  it('deployStatic with root+execute uses mocked nginx sync reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-st-fpm-'));
    dirs.push(dir);
    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const local = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const projects = new ProjectService(repo, local, dir);
    const { project } = await projects.create({
      name: 'St',
      domain: 'st.local',
      runtime: 'static',
      templateId: 'static-site',
      actor: 't',
    });
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) => p.includes('nginx') || existsSync(p),
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async () => empty({ exitCode: 0 }),
    };
    const ops = new ProjectOpsService(repo, host, dir);
    const r = await ops.deployStatic(project.id, { actor: 't', reload: true });
    expect(r.ok).toBe(true);
    expect(r.nginxReloaded).toBe(true);
  });
});
