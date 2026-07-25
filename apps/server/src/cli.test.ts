import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { VERSION, PRODUCT, CLI } from './version.js';
import { createAppContext, applyProtection, closeAppContext } from './app-context.js';
import { createHttpServer, listen } from './http-server.js';
import { loadConfigFile } from './config-loader.js';
import { main } from './cli.js';
import { evaluateProtection } from '@ysk/core';

describe('CLI naming', () => {
  it('exports YSK Server product names', () => {
    expect(PRODUCT).toBe('YSK Server');
    expect(CLI).toBe('ysk-server');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CLI --version flag', () => {
  it('prints version for --version and -V without showing help', async () => {
    const logs: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code1 = await main(['node', 'ysk-server', '--version']);
      const code2 = await main(['node', 'ysk-server', '-V']);
      expect(code1).toBe(0);
      expect(code2).toBe(0);
      const out = logs.join('');
      expect(out).toContain(VERSION);
      expect(out).toContain('YSK Server');
      expect(out).not.toMatch(/Usage:/);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

describe('setup + persistence', () => {
  it('initializes sqlite and login survives context reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-'));
    try {
      const result = runSetup({
        dataDir: dir,
        nonInteractive: true,
        listenPort: 8799,
        locale: 'zh-TW',
        adminUsername: 'admin',
        adminPassword: 'admin',
        force: true,
      });
      expect(result.ok).toBe(true);
      expect(existsSync(join(dir, 'ysk.json'))).toBe(true);
      expect(existsSync(join(dir, 'systemd', 'ysk-server.service'))).toBe(true);
      const cfg = loadConfigFile(result.data!.configPath);

      const ctx1 = createAppContext({
        version: VERSION,
        config: cfg,
        configPath: result.data!.configPath,
        dataDir: dir,
        adminPassword: 'admin',
      });
      const login = ctx1.auth.login({ username: 'admin', password: 'admin' });
      expect(login.token).toBeTruthy();
      closeAppContext(ctx1);

      const ctx2 = createAppContext({
        version: VERSION,
        config: cfg,
        dataDir: dir,
      });
      expect(ctx2.auth.authenticate(login.token).username).toBe('admin');

      // project create real disk
      const proj = await ctx2.projects.create({
        name: 'WebApp',
        domain: 'app.test',
        runtime: 'node',
        actor: 'admin',
      });
      expect(existsSync(proj.project.homeDir)).toBe(true);
      closeAppContext(ctx2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('update', () => {
  it('reports structured self-update status', async () => {
    const upToDate = await runUpdate({ checkOnly: true, latest: VERSION });
    expect(upToDate.ok).toBe(true);
    const ver =
      (upToDate.data as { plan?: { status: { currentVersion: string } } })?.plan?.status
        ?.currentVersion ?? VERSION;
    expect(ver).toBe(VERSION);
  });
});

describe('HTTP control plane', () => {
  it('boots health + login + project + tool fs.read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-http-'));
    runSetup({ dataDir: dir, nonInteractive: true, force: true, adminPassword: 'admin' });
    const ctx = createAppContext({ version: VERSION, dataDir: dir, adminPassword: 'admin' });
    const server = createHttpServer(ctx);
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    expect(health).toMatchObject({ product: 'YSK Server', status: 'ok' });

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    const loginBody = (await loginRes.json()) as { token: string };
    expect(loginBody.token).toBeTruthy();

    const projRes = await fetch(`http://127.0.0.1:${port}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ name: 'ApiProj', runtime: 'node', domain: 'api.local' }),
    });
    expect(projRes.status).toBe(201);
    const projBody = (await projRes.json()) as { project: { homeDir: string } };
    expect(existsSync(projBody.project.homeDir)).toBe(true);

    // write a file then read via tool
    const { writeFileSync } = await import('node:fs');
    const { join: j } = await import('node:path');
    const f = j(projBody.project.homeDir, 'readme.txt');
    writeFileSync(f, 'from-api-test', 'utf8');
    const toolRes = await fetch(`http://127.0.0.1:${port}/api/v1/tools/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ tool: 'fs.read', args: { path: f } }),
    });
    const toolBody = (await toolRes.json()) as { allowed: boolean; result: { content: string } };
    expect(toolBody.allowed).toBe(true);
    expect(toolBody.result.content).toBe('from-api-test');

    // offline blocks pkg.install
    await fetch(`http://127.0.0.1:${port}/api/v1/protection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ forceOffline: true }),
    });
    const blocked = (await (
      await fetch(`http://127.0.0.1:${port}/api/v1/tools/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginBody.token}`,
        },
        body: JSON.stringify({ tool: 'pkg.install', args: { name: 'x' } }),
      })
    ).json()) as { allowed: boolean };
    expect(blocked.allowed).toBe(false);

    const audit = (await (
      await fetch(`http://127.0.0.1:${port}/api/v1/audit`, {
        headers: { Authorization: `Bearer ${loginBody.token}` },
      })
    ).json()) as { items: unknown[] };
    expect(audit.items.length).toBeGreaterThan(0);

    server.close();
    closeAppContext(ctx);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads config into context', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfg-'));
    try {
      const setup = runSetup({
        dataDir: dir,
        nonInteractive: true,
        listenPort: 19001,
        adminUsername: 'admin',
        locale: 'en',
        force: true,
      });
      const cfg = loadConfigFile(setup.data!.configPath);
      const ctx = createAppContext({ version: VERSION, config: cfg, dataDir: dir });
      expect(ctx.config?.listenPort).toBe(19001);
      applyProtection(ctx, evaluateProtection({ networkReachable: true, ddosSuspected: true }));
      expect(ctx.protection.mode).toBe('ddos-protection');
      closeAppContext(ctx);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
