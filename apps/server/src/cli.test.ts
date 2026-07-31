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

/** Capture stdout while running main(); restores on exit. */
async function runMain(
  argv: string[],
): Promise<{ code: number; out: string }> {
  const logs: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv);
    return { code, out: logs.join('') };
  } finally {
    process.stdout.write = origWrite;
  }
}

function setupTmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-cli-'));
  runSetup({
    dataDir: dir,
    nonInteractive: true,
    force: true,
    adminPassword: 'admin',
    allowInsecureDefaults: true,
  });
  return dir;
}

function parseJsonOut(out: string): unknown {
  const trimmed = out.trim();
  const start = trimmed.indexOf('{');
  const arr = trimmed.indexOf('[');
  const i =
    start >= 0 && (arr < 0 || start < arr) ? start : arr >= 0 ? arr : -1;
  if (i < 0) throw new Error(`no JSON in stdout: ${trimmed.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(i));
}

describe('CLI naming', () => {
  it('exports YSK Server product names', () => {
    expect(PRODUCT).toBe('YSK Server');
    expect(CLI).toBe('ysk-server');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CLI --version flag', () => {
  it('prints version for --version and -V without showing help', async () => {
    const r1 = await runMain(['node', 'ysk-server', '--version']);
    const r2 = await runMain(['node', 'ysk-server', '-V']);
    expect(r1.code).toBe(0);
    expect(r2.code).toBe(0);
    expect(r1.out).toContain(VERSION);
    expect(r1.out).toContain('YSK Server');
    expect(r1.out).not.toMatch(/Usage:/);
    expect(r2.out).toContain(VERSION);
  });

  it('prints structured version with --json', async () => {
    const r = await runMain(['node', 'ysk-server', 'version', '--json']);
    expect(r.code).toBe(0);
    const body = parseJsonOut(r.out) as {
      ok?: boolean;
      version?: string;
      product?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(VERSION);
    expect(body.product).toBe('YSK Server');
  });
});

describe('CLI help', () => {
  it('returns command list with --help --json', async () => {
    const r = await runMain(['node', 'ysk-server', '--help', '--json']);
    expect(r.code).toBe(0);
    const body = parseJsonOut(r.out) as {
      ok?: boolean;
      commands?: string[];
      cli?: string;
      exitCodes?: Record<string, string>;
    };
    expect(body.ok).toBe(true);
    expect(body.cli).toBe('ysk-server');
    expect(Array.isArray(body.commands)).toBe(true);
    expect(body.commands).toContain('setup');
    expect(body.commands).toContain('readiness');
    expect(body.commands).toContain('host');
    expect(body.exitCodes?.['0']).toBe('ok');
  });

  it('returns help for bare help command --json', async () => {
    const r = await runMain(['node', 'ysk-server', 'help', '--json']);
    expect(r.code).toBe(0);
    const body = parseJsonOut(r.out) as { ok?: boolean; commands?: string[] };
    expect(body.ok).toBe(true);
    expect(body.commands?.length).toBeGreaterThan(10);
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
        allowInsecureDefaults: true,
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

describe('CLI projects + templates', () => {
  it('lists templates and creates project with --template via main()', async () => {
    const dir = setupTmpDataDir();
    try {
      const codeTpl = await runMain(['node', 'ysk-server', 'templates', '--json']);
      expect(codeTpl.code).toBe(0);
      expect(codeTpl.out).toContain('node-starter');

      const code = await runMain([
        'node',
        'ysk-server',
        'projects',
        'create',
        '--data-dir',
        dir,
        '--name',
        'CliTpl',
        '--template',
        'node-starter',
        '--json',
      ]);
      expect(code.code).toBe(0);
      expect(code.out).toContain('CliTpl');
      expect(code.out).toContain('scaffold');

      const codeList = await runMain([
        'node',
        'ysk-server',
        'projects',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(codeList.code).toBe(0);
      expect(codeList.out).toContain('CliTpl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI main paths (read-only / dry, no root)', () => {
  it('health local snapshot with --data-dir --json', async () => {
    const dir = setupTmpDataDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'health',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as {
        ok?: boolean;
        product?: string;
        version?: string;
        mode?: string;
        dataDir?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.product).toBe('YSK Server');
      expect(body.version).toBe(VERSION);
      expect(body.dataDir).toBe(dir);
      expect(typeof body.mode).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readiness / doctor with --data-dir --json (exit 0 or 2)', async () => {
    const dir = setupTmpDataDir();
    try {
      for (const cmd of ['readiness', 'doctor'] as const) {
        const r = await runMain([
          'node',
          'ysk-server',
          cmd,
          '--data-dir',
          dir,
          '--json',
        ]);
        expect([0, 2]).toContain(r.code);
        const body = parseJsonOut(r.out) as {
          productionReady?: boolean;
          via?: string;
          store?: { kind?: string };
        };
        expect(typeof body.productionReady).toBe('boolean');
        expect(body.via).toBe(cmd);
        expect(body.store?.kind).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('host overview and metrics', async () => {
    const dir = setupTmpDataDir();
    try {
      const ov = await runMain([
        'node',
        'ysk-server',
        'host',
        'overview',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(ov.code).toBe(0);
      const body = parseJsonOut(ov.out) as { ok?: boolean; identity?: unknown };
      expect(body.ok).toBe(true);
      expect(body.identity).toBeDefined();

      const metrics = await runMain([
        'node',
        'ysk-server',
        'host',
        'metrics',
        '--data-dir',
        dir,
        '--json',
      ]);
      // exit 1 only if alerts present — still valid JSON
      expect([0, 1]).toContain(metrics.code);
      const m = parseJsonOut(metrics.out) as { ok?: boolean; caps?: unknown };
      expect(m.ok).toBe(true);
      expect(m.caps).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tools list (allowlist)', async () => {
    const r = await runMain(['node', 'ysk-server', 'tools', '--json']);
    expect(r.code).toBe(0);
    const body = parseJsonOut(r.out) as { ok?: boolean; data?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data?.length ?? 0) > 0).toBe(true);
  });

  it('nginx status / list dry paths', async () => {
    const dir = setupTmpDataDir();
    try {
      const status = await runMain([
        'node',
        'ysk-server',
        'nginx',
        'status',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(status.code).toBe(0);
      const s = parseJsonOut(status.out) as {
        ok?: boolean;
        managed?: unknown[];
        managedCount?: number;
        caps?: { executeEnabled?: boolean };
      };
      expect(s.ok).toBe(true);
      expect(Array.isArray(s.managed)).toBe(true);
      expect(typeof s.managedCount).toBe('number');
      expect(s.caps).toBeDefined();

      const list = await runMain([
        'node',
        'ysk-server',
        'nginx',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(list.code).toBe(0);
      const l = parseJsonOut(list.out) as { ok?: boolean; items?: unknown[] };
      expect(l.ok).toBe(true);
      expect(Array.isArray(l.items)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ssl list', async () => {
    const dir = setupTmpDataDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'ssl',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as {
        ok?: boolean;
        items?: unknown[];
        count?: number;
      };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.count).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('services matrix', async () => {
    const dir = setupTmpDataDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'services',
        'matrix',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as { ok?: boolean; items?: unknown[] };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defense status and bans list', async () => {
    const dir = setupTmpDataDir();
    try {
      const status = await runMain([
        'node',
        'ysk-server',
        'defense',
        'status',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(status.code).toBe(0);
      const s = parseJsonOut(status.out) as { ok?: boolean; defense?: unknown };
      expect(s.ok).toBe(true);
      expect(s.defense).toBeDefined();

      const bans = await runMain([
        'node',
        'ysk-server',
        'defense',
        'bans',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(bans.code).toBe(0);
      const b = parseJsonOut(bans.out) as { ok?: boolean; items?: unknown[] };
      expect(b.ok).toBe(true);
      expect(Array.isArray(b.items)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('users / packages / rbac / audit / security list', async () => {
    const dir = setupTmpDataDir();
    try {
      const users = await runMain([
        'node',
        'ysk-server',
        'users',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(users.code).toBe(0);
      const u = parseJsonOut(users.out) as {
        ok?: boolean;
        items?: Array<{ username?: string }>;
      };
      expect(u.ok).toBe(true);
      expect(u.items?.some((x) => x.username === 'admin')).toBe(true);

      const packages = await runMain([
        'node',
        'ysk-server',
        'packages',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(packages.code).toBe(0);
      expect((parseJsonOut(packages.out) as { ok?: boolean }).ok).toBe(true);

      const rbac = await runMain([
        'node',
        'ysk-server',
        'rbac',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(rbac.code).toBe(0);
      expect((parseJsonOut(rbac.out) as { ok?: boolean }).ok).toBe(true);

      const audit = await runMain([
        'node',
        'ysk-server',
        'audit',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(audit.code).toBe(0);
      expect(Array.isArray((parseJsonOut(audit.out) as { items?: unknown[] }).items)).toBe(
        true,
      );

      const security = await runMain([
        'node',
        'ysk-server',
        'security',
        'status',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(security.code).toBe(0);
      const sec = parseJsonOut(security.out) as {
        ok?: boolean;
        adminCount?: number;
      };
      expect(sec.ok).toBe(true);
      expect(typeof sec.adminCount).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logs sources and overview', async () => {
    const dir = setupTmpDataDir();
    try {
      const sources = await runMain([
        'node',
        'ysk-server',
        'logs',
        'sources',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(sources.code).toBe(0);
      const s = parseJsonOut(sources.out) as { ok?: boolean; items?: unknown[] };
      expect(s.ok).toBe(true);
      expect(Array.isArray(s.items)).toBe(true);

      const overview = await runMain([
        'node',
        'ysk-server',
        'logs',
        'overview',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(overview.code).toBe(0);
      const o = parseJsonOut(overview.out) as { ok?: boolean };
      expect(o.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backup list/status, cron list, store status, agents fleet list', async () => {
    const dir = setupTmpDataDir();
    try {
      const backupList = await runMain([
        'node',
        'ysk-server',
        'backup',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(backupList.code).toBe(0);
      expect((parseJsonOut(backupList.out) as { ok?: boolean }).ok).toBe(true);

      const backupStatus = await runMain([
        'node',
        'ysk-server',
        'backup',
        'status',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(backupStatus.code).toBe(0);
      expect((parseJsonOut(backupStatus.out) as { ok?: boolean }).ok).toBe(true);

      const cron = await runMain([
        'node',
        'ysk-server',
        'cron',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(cron.code).toBe(0);
      expect(Array.isArray((parseJsonOut(cron.out) as { items?: unknown[] }).items)).toBe(
        true,
      );

      const store = await runMain([
        'node',
        'ysk-server',
        'store',
        'status',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(store.code).toBe(0);
      const st = parseJsonOut(store.out) as { dataDir?: string; kind?: string };
      expect(st.dataDir).toBe(dir);

      const agents = await runMain([
        'node',
        'ysk-server',
        'agents',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(agents.code).toBe(0);
      expect(Array.isArray((parseJsonOut(agents.out) as { items?: unknown[] }).items)).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('email domains list and self-update-plan', async () => {
    const dir = setupTmpDataDir();
    try {
      const email = await runMain([
        'node',
        'ysk-server',
        'email',
        'domains',
        'list',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(email.code).toBe(0);
      // domains list prints items
      expect(email.out.length).toBeGreaterThan(0);

      const plan = await runMain([
        'node',
        'ysk-server',
        'self-update-plan',
        '--latest',
        VERSION,
        '--json',
      ]);
      expect(plan.code).toBe(0);
      expect(plan.out.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('update --check --json', async () => {
    const r = await runMain([
      'node',
      'ysk-server',
      'update',
      '--check',
      '--latest',
      VERSION,
      '--json',
    ]);
    expect(r.code).toBe(0);
    const body = parseJsonOut(r.out) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it('services start without --execute is dry-run', async () => {
    const dir = setupTmpDataDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'services',
        'restart',
        '--unit',
        'nginx',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as {
        ok?: boolean;
        dryRun?: boolean;
        unit?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.dryRun).toBe(true);
      expect(body.unit).toBe('nginx');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nginx sync without --execute is dry-run', async () => {
    const dir = setupTmpDataDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'nginx',
        'sync',
        '--data-dir',
        dir,
        '--json',
      ]);
      expect([0, 3]).toContain(r.code);
      const body = parseJsonOut(r.out) as { dryRun?: boolean };
      expect(body.dryRun).toBe(true);
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
    runSetup({
      dataDir: dir,
      nonInteractive: true,
      force: true,
      adminPassword: 'admin',
      allowInsecureDefaults: true,
    });
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
        adminPassword: 'admin',
        locale: 'en',
        force: true,
        allowInsecureDefaults: true,
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
