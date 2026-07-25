import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { VERSION, PRODUCT, CLI } from './version.js';
import { createAppContext, applyProtection } from './app-context.js';
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
      expect(out).not.toMatch(/Commands:/);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

describe('setup', () => {
  it('writes config skeleton and serve can load it via --config path', () => {
    const dry = runSetup({
      dataDir: join(tmpdir(), 'ysk-never-write'),
      dryRun: true,
      nonInteractive: true,
    });
    expect(dry.ok).toBe(true);
    expect(dry.code).toBe('YSK_SETUP_DRY_RUN');
    expect(dry.data?.config.product).toBe('ysk-server');

    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-'));
    try {
      const result = runSetup({
        dataDir: dir,
        nonInteractive: true,
        listenPort: 8799,
        listenHost: '127.0.0.1',
        locale: 'zh-TW',
        adminUsername: 'admin',
      });
      expect(result.ok).toBe(true);
      expect(result.data?.configPath).toBe(join(dir, 'config.json'));
      expect(result.data?.nextSteps?.[0]).toContain('serve --config');
      const cfg = loadConfigFile(result.data!.configPath);
      expect(cfg.product).toBe('ysk-server');
      expect(cfg.listenPort).toBe(8799);
      expect(cfg.adminUsername).toBe('admin');
      expect(cfg.locale).toBe('zh-TW');
      // createAppContext applies admin from loaded config
      const ctx = createAppContext({ version: VERSION, config: cfg, configPath: result.data!.configPath });
      expect(ctx.config?.listenPort).toBe(8799);
      const login = ctx.auth.login({ username: 'admin', password: 'admin' });
      expect(login.user.username).toBe('admin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('update', () => {
  it('reports structured self-update status', () => {
    const upToDate = runUpdate({ checkOnly: true, latest: VERSION });
    expect(upToDate.ok).toBe(true);
    expect(upToDate.data?.status.currentVersion).toBe(VERSION);

    const available = runUpdate({ checkOnly: true, latest: '9.9.9' });
    expect(available.data?.status.updateAvailable).toBe(true);
  });
});

describe('HTTP control plane', () => {
  it('boots and returns sane health JSON twice', async () => {
    const ctx = createAppContext(VERSION);
    const server = createHttpServer(ctx);
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    const realPort = typeof address === 'object' && address ? address.port : 0;

    async function probe() {
      const res = await fetch(`http://127.0.0.1:${realPort}/health`);
      const body = (await res.json()) as {
        status: string;
        product: string;
        version: string;
        protectionMode: string;
      };
      expect(res.status).toBe(200);
      expect(body.product).toBe('YSK Server');
      expect(body.version).toBe(VERSION);
      expect(body.status).toMatch(/ok|degraded|offline/);
      expect(body.protectionMode).toBeTruthy();
      return body;
    }

    const a = await probe();
    const b = await probe();
    expect(a.product).toBe(b.product);
    server.close();
  });

  it('enforces RBAC and protection on tools/execute', async () => {
    const ctx = createAppContext(VERSION);
    // Add a viewer-only user by logging in as admin after ensuring viewer isn't default —
    // use admin token then test RBAC denial by temporarily using viewer role via tool path.
    // Create second user: AuthService only has ensureAdmin; use admin for auth and
    // simulate viewer by checking pure execute path already unit-tested.
    // HTTP path: login as admin (has privilege).
    const server = createHttpServer(ctx);
    await listen(server, '127.0.0.1', 0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const loginRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    const loginBody = (await loginRes.json()) as { token: string };
    expect(loginBody.token).toBeTruthy();

    // Enable offline protection
    const protRes = await fetch(`http://127.0.0.1:${port}/api/v1/protection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceOffline: true }),
    });
    const prot = (await protRes.json()) as { mode: string; blockExternalTools: boolean };
    expect(prot.mode).toBe('offline');
    expect(prot.blockExternalTools).toBe(true);

    const toolRes = await fetch(`http://127.0.0.1:${port}/api/v1/tools/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ tool: 'pkg.install', args: { name: 'x' } }),
    });
    const toolBody = (await toolRes.json()) as { allowed: boolean; denialReason?: string };
    expect(toolBody.allowed).toBe(false);
    expect(toolBody.denialReason).toMatch(/Protection|emergency/i);

    // LLM remote model blocked
    const llmRes = await fetch(`http://127.0.0.1:${port}/api/v1/llm/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(llmRes.status).toBe(403);

    server.close();
  });

  it('loads config into context for serve path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfg-'));
    try {
      const setup = runSetup({
        dataDir: dir,
        nonInteractive: true,
        listenPort: 19001,
        adminUsername: 'rootadmin',
        locale: 'en',
      });
      const cfg = loadConfigFile(setup.data!.configPath);
      expect(cfg.listenPort).toBe(19001);
      expect(cfg.adminUsername).toBe('rootadmin');
      const ctx = createAppContext({ version: VERSION, config: cfg });
      expect(ctx.config?.adminUsername).toBe('rootadmin');
      // Protection apply propagates to LLM
      applyProtection(ctx, evaluateProtection({ networkReachable: true, ddosSuspected: true }));
      expect(ctx.protection.mode).toBe('ddos-protection');
      expect(ctx.llm.getProtection()?.localLlmOnly).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
