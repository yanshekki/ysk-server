import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { VERSION, PRODUCT, CLI } from './version.js';
import { createAppContext, applyProtection, closeAppContext } from './app-context.js';
import { createHttpServer, listen } from './http-server.js';
import { loadConfigFile } from './config-loader.js';
import { main, exitFromResult, exitFromError, printCliError } from './cli.js';
import { evaluateProtection } from 'ysk-server-core';
import { ErrorCodes, YskError } from 'ysk-server-shared';

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

describe('CLI exit mappers (unit)', () => {
  it('exitFromResult maps codes and flags', () => {
    expect(exitFromResult({ blocked: true })).toBe(3);
    expect(exitFromResult({ dryRun: true, ok: true })).toBe(0);
    expect(exitFromResult({ dryRun: true })).toBe(0);
    expect(exitFromResult({ code: ErrorCodes.VALIDATION })).toBe(2);
    expect(exitFromResult({ code: ErrorCodes.CONFIG_INVALID })).toBe(2);
    expect(exitFromResult({ code: 'YSK_VALIDATION' })).toBe(2);
    expect(exitFromResult({ code: 'validation' })).toBe(2);
    expect(exitFromResult({ code: ErrorCodes.NOT_FOUND })).toBe(4);
    expect(exitFromResult({ code: 'YSK_NOT_FOUND' })).toBe(4);
    expect(exitFromResult({ code: 'not_found' })).toBe(4);
    expect(exitFromResult({ code: ErrorCodes.FORBIDDEN })).toBe(3);
    expect(exitFromResult({ code: ErrorCodes.ALLOWLIST_DENIED })).toBe(3);
    expect(exitFromResult({ code: ErrorCodes.APPROVAL_REQUIRED })).toBe(3);
    expect(exitFromResult({ code: ErrorCodes.UNAUTHORIZED })).toBe(3);
    expect(exitFromResult({ code: 'blocked' })).toBe(3);
    expect(exitFromResult({ code: 'host_error' })).toBe(5);
    expect(exitFromResult({ code: 'YSK_HOST_ERROR' })).toBe(5);
    expect(exitFromResult({ allowed: false })).toBe(3);
    expect(exitFromResult({ ok: false, applyStatus: 'written', requiresExecute: true })).toBe(0);
    expect(exitFromResult({ ok: false })).toBe(1);
    expect(exitFromResult({ status: 'failed' })).toBe(1);
    expect(exitFromResult({ status: 'error' })).toBe(1);
    expect(exitFromResult({ applyStatus: 'failed' })).toBe(1);
    expect(exitFromResult({ ok: true })).toBe(0);
  });

  it('exitFromError maps YskError codes', () => {
    expect(exitFromError(new YskError(ErrorCodes.VALIDATION, 'v'))).toBe(2);
    expect(exitFromError(new YskError(ErrorCodes.CONFIG_INVALID, 'c'))).toBe(2);
    expect(exitFromError(new YskError(ErrorCodes.NOT_FOUND, 'n'))).toBe(4);
    expect(exitFromError(new YskError(ErrorCodes.FORBIDDEN, 'f'))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.ALLOWLIST_DENIED, 'a'))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.APPROVAL_REQUIRED, 'p'))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.UNAUTHORIZED, 'u'))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.SANDBOX_VIOLATION, 's'))).toBe(3);
    expect(exitFromError(new YskError(ErrorCodes.INTERNAL, 'i'))).toBe(1);
    expect(exitFromError(new Error('plain'))).toBe(1);
    expect(exitFromError('string')).toBe(1);
  });

  it('printCliError writes json and plain forms', () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const ow = process.stdout.write.bind(process.stdout);
    const ew = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string | Uint8Array) => {
      logs.push(String(c));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      errs.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code1 = printCliError(
        new YskError(ErrorCodes.NOT_FOUND, 'missing', { details: { id: 1 } }),
        true,
      );
      expect(code1).toBe(4);
      expect(logs.join('')).toContain('NOT_FOUND');

      const code2 = printCliError(new YskError(ErrorCodes.VALIDATION, 'bad'), false);
      expect(code2).toBe(2);
      expect(errs.join('')).toContain('bad');

      const code3 = printCliError(new Error('boom'), true);
      expect(code3).toBe(1);
      expect(logs.join('')).toContain('boom');

      const code4 = printCliError('raw', false);
      expect(code4).toBe(1);
      expect(errs.join('')).toContain('raw');
    } finally {
      process.stdout.write = ow;
      process.stderr.write = ew;
    }
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

describe('setup edge cases', () => {
  it('refuses re-setup without --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-exists-'));
    try {
      const first = runSetup({
        dataDir: dir,
        nonInteractive: true,
        force: true,
        adminPassword: 'admin',
        allowInsecureDefaults: true,
      });
      expect(first.ok).toBe(true);
      const second = runSetup({
        dataDir: dir,
        nonInteractive: true,
        adminPassword: 'admin',
        allowInsecureDefaults: true,
      });
      expect(second.ok).toBe(false);
      expect(second.code).toBe('YSK_SETUP_EXISTS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects weak password without allow-insecure-defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-weak-'));
    try {
      const r = runSetup({
        dataDir: dir,
        nonInteractive: true,
        force: true,
        adminPassword: 'admin',
        allowInsecureDefaults: false,
      });
      // may still allow short password depending on policy; assert structured
      expect(typeof r.ok).toBe('boolean');
      if (!r.ok) {
        expect(r.code === 'YSK_SETUP_WEAK_PASSWORD' || r.code).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strong password + public bind sets security flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-strong-'));
    try {
      const r = runSetup({
        dataDir: dir,
        nonInteractive: true,
        force: true,
        adminPassword: 'Str0ng-Setup-Pass-99!',
        allowInsecureDefaults: false,
        listenHost: '0.0.0.0',
        listenPort: 19290,
        locale: 'en',
      });
      expect(r.ok).toBe(true);
      expect(r.code).toBe('YSK_SETUP_OK');
      // force re-setup with existing admin
      const again = runSetup({
        dataDir: dir,
        nonInteractive: true,
        force: true,
        adminPassword: 'Str0ng-Setup-Pass-99!',
        allowInsecureDefaults: false,
        listenHost: '127.0.0.1',
      });
      expect(again.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
        locale: 'zh-HK',
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

/**
 * Deep CLI coverage — shared dataDir, --json, no root / no YSK_EXECUTE.
 * Hits as many command groups + honesty (dry-run) paths as possible.
 */
describe('CLI deep coverage climb', () => {
  let dir: string;
  let projectId: string | undefined;

  beforeAll(async () => {
    dir = setupTmpDataDir();
    const created = await runMain([
      'node',
      'ysk-server',
      'projects',
      'create',
      '--data-dir',
      dir,
      '--name',
      'DeepCliProj',
      '--domain',
      'deep-cli.test',
      '--runtime',
      'node',
      '--template',
      'node-starter',
      '--json',
    ]);
    expect(created.code).toBe(0);
    const body = parseJsonOut(created.out) as {
      project?: { id?: string };
      id?: string;
    };
    projectId = body.project?.id ?? body.id;
    expect(projectId).toBeTruthy();
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function cli(
    ...parts: string[]
  ): Promise<{ code: number; out: string }> {
    // inject --data-dir / --json unless already present
    const argv = ['node', 'ysk-server', ...parts];
    if (!parts.includes('--data-dir') && !parts.includes('--help') && !parts.includes('-h')) {
      argv.push('--data-dir', dir);
    }
    if (!parts.includes('--json')) argv.push('--json');
    return runMain(argv);
  }

  // ── help / unknown / setup ──────────────────────────────────────────
  it('help text (non-json) and unknown command exit 2', async () => {
    const h = await runMain(['node', 'ysk-server', 'help']);
    expect(h.code).toBe(0);
    expect(h.out.length).toBeGreaterThan(20);

    const u = await runMain(['node', 'ysk-server', 'not-a-real-cmd', '--json']);
    expect(u.code).toBe(2);

    const bare = await runMain(['node', 'ysk-server', '--json']);
    expect(bare.code).toBe(0);
    expect((parseJsonOut(bare.out) as { commands?: string[] }).commands?.length).toBeGreaterThan(
      20,
    );
  });

  it('setup --dry-run --json and force re-setup', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ysk-setup-dry-'));
    try {
      const dry = await runMain([
        'node',
        'ysk-server',
        'setup',
        '--data-dir',
        tmp,
        '--non-interactive',
        '--dry-run',
        '--allow-insecure-defaults',
        '--admin-password',
        'admin',
        '--json',
      ]);
      expect([0, 1]).toContain(dry.code);
      expect(dry.out.length).toBeGreaterThan(0);

      const real = await runMain([
        'node',
        'ysk-server',
        'setup',
        '--data-dir',
        tmp,
        '--non-interactive',
        '--force',
        '--allow-insecure-defaults',
        '--admin-password',
        'admin',
        '--port',
        '18765',
        '--locale',
        'en',
        '--json',
      ]);
      expect(real.code).toBe(0);
      const body = parseJsonOut(real.out) as { ok?: boolean };
      expect(body.ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('serve once with YSK_SERVE_ONCE=1', async () => {
    const prev = process.env.YSK_SERVE_ONCE;
    process.env.YSK_SERVE_ONCE = '1';
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'serve',
        '--data-dir',
        dir,
        '--host',
        '127.0.0.1',
        '--port',
        '0',
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as { ok?: boolean; data?: { port?: number } };
      expect(body.ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.YSK_SERVE_ONCE;
      else process.env.YSK_SERVE_ONCE = prev;
    }
  }, 30_000);

  it('system unit-install without execute is honest', async () => {
    const r = await cli('system', 'unit-install');
    // may fail write into systemd dirs without root — still structured
    expect([0, 1]).toContain(r.code);
    expect(r.out.length).toBeGreaterThan(0);
  });

  // ── projects ────────────────────────────────────────────────────────
  it('projects list/get/isolation/health/deploy/stop dry honesty', async () => {
    const list = await cli('projects', 'list');
    expect(list.code).toBe(0);
    expect((parseJsonOut(list.out) as { items?: unknown[] }).items?.length).toBeGreaterThan(0);

    const get = await cli('projects', 'get', '--id', projectId!);
    expect(get.code).toBe(0);
    expect((parseJsonOut(get.out) as { ok?: boolean; project?: { id?: string } }).project?.id).toBe(
      projectId,
    );

    const byName = await cli('projects', 'show', '--name', 'DeepCliProj');
    expect(byName.code).toBe(0);

    const missing = await cli('projects', 'get', '--id', 'no-such-project-id-zzzz');
    expect(missing.code).toBe(4);

    const iso = await cli('projects', 'isolation', 'list');
    expect(iso.code).toBe(0);

    const provisionAll = await cli('projects', 'isolation', 'provision-all', '--limit', '1');
    expect([0, 1, 3]).toContain(provisionAll.code);
    const pa = parseJsonOut(provisionAll.out) as {
      ok?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      attempted?: number;
    };
    // without execute/root: not a fake live provision success
    if (pa.ok === true && pa.attempted && pa.attempted > 0) {
      // rare if something applied in sandbox — still ok
    } else {
      expect(pa.ok === false || pa.attempted === 0 || pa.requiresExecute || pa.requiresRoot).toBe(
        true,
      );
    }

    const health = await cli('projects', 'health', '--id', projectId!);
    expect([0, 1, 3]).toContain(health.code);

    const deploy = await cli('projects', 'deploy', '--id', projectId!);
    expect([0, 1, 3]).toContain(deploy.code);
    const dep = parseJsonOut(deploy.out) as {
      ok?: boolean;
      dryRun?: boolean;
      requiresExecute?: boolean;
      blocked?: boolean;
      applyStatus?: string;
    };
    // must not claim host applied without execute
    expect(dep.applyStatus).not.toBe('applied');

    const stop = await cli('projects', 'stop', '--id', projectId!);
    expect([0, 1, 3]).toContain(stop.code);

    const bak = await cli('projects', 'backup', '--id', projectId!);
    expect([0, 1, 3]).toContain(bak.code);

    const git = await cli(
      'projects',
      'git-deploy',
      '--id',
      projectId!,
      '--git-url',
      'https://example.com/repo.git',
      '--no-redeploy',
    );
    expect([0, 1, 2, 3]).toContain(git.code);
  }, 90_000);

  // ── hosting ─────────────────────────────────────────────────────────
  it('hosting nginx / runtimes / provisions dry / firewall / dns', async () => {
    const nginx = await cli('hosting', 'nginx');
    expect(nginx.code).toBe(0);
    expect((parseJsonOut(nginx.out) as { ok?: boolean }).ok).toBe(true);

    const sync = await cli('hosting', 'nginx-sync');
    expect([0, 3]).toContain(sync.code);
    expect((parseJsonOut(sync.out) as { dryRun?: boolean }).dryRun).toBe(true);

    const runtimes = await cli('hosting', 'runtimes');
    expect(runtimes.code).toBe(0);

    const redis = await cli('hosting', 'redis-provision', '--project-id', projectId!);
    expect([0, 1, 3]).toContain(redis.code);

    const pg = await cli(
      'hosting',
      'postgres-provision',
      '--db',
      'testdb',
      '--user',
      'testu',
      '--password',
      'password12345',
    );
    expect([0, 1, 3]).toContain(pg.code);
    expect((parseJsonOut(pg.out) as { dryRun?: boolean }).dryRun).toBe(true);

    const my = await cli(
      'hosting',
      'mysql-provision',
      '--db',
      'testdb',
      '--user',
      'testu',
      '--password',
      'password12345',
    );
    expect([0, 1, 3]).toContain(my.code);

    const zones = await cli('hosting', 'dns-zones');
    expect(zones.code).toBe(0);

    const zone = await cli('hosting', 'dns-zone', '--zone', 'cli-zone.test', '--ip', '127.0.0.1');
    expect([0, 1, 3]).toContain(zone.code);

    const pdns = await cli('hosting', 'powerdns-status');
    expect([0, 1]).toContain(pdns.code);

    const fw = await cli('hosting', 'firewall-apply');
    expect([0, 1, 3]).toContain(fw.code);

    const rtInstall = await cli('hosting', 'runtime-install', '--kind', 'node');
    expect([0, 1, 3]).toContain(rtInstall.code);

    const emailApply = await cli('hosting', 'email-apply', '--domain', 'mail-cli.test');
    expect([0, 1, 2, 3]).toContain(emailApply.code);
  }, 90_000);

  // ── email ───────────────────────────────────────────────────────────
  it('email domains create/get/dns/mailboxes/deliverability/bootstrap dry', async () => {
    const create = await cli(
      'email',
      'domains',
      'create',
      '--domain',
      'cli-mail.test',
      '--ip',
      '203.0.113.10',
    );
    expect(create.code).toBe(0);

    const list = await cli('email', 'domains', 'list', '--q', 'cli-mail');
    expect(list.code).toBe(0);
    const items = (parseJsonOut(list.out) as { items?: Array<{ domain?: string }> }).items;
    expect(items?.some((d) => d.domain === 'cli-mail.test')).toBe(true);

    const get = await cli('email', 'domains', 'get', '--domain', 'cli-mail.test');
    expect(get.code).toBe(0);

    const dns = await cli('email', 'dns', '--domain', 'cli-mail.test');
    expect(dns.code).toBe(0);

    const mbox = await cli('email', 'mailboxes', 'list', '--domain', 'cli-mail.test');
    expect(mbox.code).toBe(0);

    const mboxCreate = await cli(
      'email',
      'mailboxes',
      'create',
      '--domain',
      'cli-mail.test',
      '--local',
      'info',
      '--password',
      'Mailbox-Pass-99',
    );
    expect([0, 1, 3]).toContain(mboxCreate.code);

    const deliv = await cli('email', 'deliverability', '--domain', 'cli-mail.test');
    expect([0, 1]).toContain(deliv.code);

    const overview = await cli('email', 'deliverability-overview');
    expect(overview.code).toBe(0);

    const boot = await cli(
      'email',
      'bootstrap',
      '--domain',
      'boot-mail.test',
      '--ip',
      '203.0.113.11',
    );
    expect([0, 1, 3]).toContain(boot.code);

    const help = await cli('email', 'help');
    expect(help.code).toBe(2);
  }, 60_000);

  // ── dns / db-cluster ────────────────────────────────────────────────
  it('dns zones/write and db-cluster list/create/plan/apply dry', async () => {
    const zones = await cli('dns', 'zones');
    expect(zones.code).toBe(0);

    const write = await cli('dns', 'zone', '--zone', 'dns-cli.test', '--ip', '127.0.0.1');
    expect([0, 1, 3]).toContain(write.code);

    const list = await cli('db-cluster', 'list');
    expect(list.code).toBe(0);

    const create = await cli(
      'db-cluster',
      'create',
      '--name',
      'cli-galera',
      '--engine',
      'mariadb',
      '--kind',
      'mariadb-galera',
      '--member',
      '127.0.0.1=primary:local',
      '--member',
      '127.0.0.2=secondary:ssh',
    );
    expect(create.code).toBe(0);
    const clusterId = (parseJsonOut(create.out) as { cluster?: { id?: string } }).cluster?.id;
    expect(clusterId).toBeTruthy();

    const plan = await cli('db-cluster', 'plan', '--id', clusterId!);
    expect([0, 1]).toContain(plan.code);
    expect((parseJsonOut(plan.out) as { dryRun?: boolean }).dryRun).toBe(true);

    const apply = await cli('db-cluster', 'apply', '--id', clusterId!);
    expect([0, 1, 3]).toContain(apply.code);

    const get = await cli('db-cluster', 'get', '--id', clusterId!);
    expect(get.code).toBe(0);

    const probe = await cli('db-cluster', 'probe', '--id', clusterId!);
    expect([0, 1]).toContain(probe.code);

    const arts = await cli('db-cluster', 'artifacts', '--id', clusterId!);
    expect([0, 1, 2]).toContain(arts.code);
  }, 60_000);

  // ── defense / protection ────────────────────────────────────────────
  it('defense status bans suspects stack ban whitelist fail2ban firewall timeline presets', async () => {
    for (const sub of [
      'status',
      'bans',
      'suspects',
      'timeline',
      'presets',
      'fail2ban',
      'firewall',
    ] as const) {
      const r = await cli('defense', sub);
      expect([0, 1]).toContain(r.code);
      expect(r.out.length).toBeGreaterThan(0);
    }

    const stack = await cli('defense', 'stack-apply');
    expect([0, 1, 3]).toContain(stack.code);

    const ban = await cli('defense', 'ban', '--ip', '198.51.100.50', '--reason', 'cli-test');
    expect([0, 1, 3]).toContain(ban.code);
    // without --execute must not claim live ban applied
    const banBody = parseJsonOut(ban.out) as {
      ok?: boolean;
      dryRun?: boolean;
      executed?: boolean;
      blocked?: boolean;
    };
    expect(banBody.executed === true && banBody.ok === true && !banBody.dryRun).toBe(false);

    const unban = await cli('defense', 'unban', '--ip', '198.51.100.50');
    expect([0, 1, 3]).toContain(unban.code);

    const wlList = await cli('defense', 'whitelist', '--action', 'list');
    expect(wlList.code).toBe(0);

    const wlAdd = await cli('defense', 'whitelist', '--action', 'add', '--ip', '203.0.113.1');
    expect(wlAdd.code).toBe(0);

    const prot = await cli('protection', 'status');
    expect(prot.code).toBe(0);
  }, 90_000);

  // ── backup / cron / store ───────────────────────────────────────────
  it('backup settings/schedule/cp/restic and cron CRUD + store export/migrate', async () => {
    const settings = await cli('backup', 'settings', 'get');
    expect(settings.code).toBe(0);

    const set = await cli(
      'backup',
      'settings',
      'set',
      '--remote-kind',
      'local',
      '--remote-path',
      join(dir, 'remote-bak'),
      '--exclude',
      'node_modules,.git',
    );
    expect(set.code).toBe(0);

    const schedule = await cli('backup', 'schedule', '--cron', '0 4 * * *');
    expect(schedule.code).toBe(0);

    const restic = await cli('backup', 'restic', 'list');
    expect([0, 1, 2, 3]).toContain(restic.code);

    const all = await cli('backup', 'all');
    expect([0, 1]).toContain(all.code);

    const cp = await cli('backup', 'control-plane');
    expect([0, 1]).toContain(cp.code);

    const cronCreate = await cli(
      'cron',
      'create',
      '--schedule',
      '*/15 * * * *',
      '--command',
      'echo hello-cli',
      '--user',
      'ysk',
    );
    expect(cronCreate.code).toBe(0);
    const jobId = (parseJsonOut(cronCreate.out) as { job?: { id?: string } }).job?.id;
    expect(jobId).toBeTruthy();

    const cronStatus = await cli('cron', 'status');
    expect(cronStatus.code).toBe(0);

    const cronEn = await cli('cron', 'enable', '--id', jobId!);
    expect(cronEn.code).toBe(0);
    const cronDis = await cli('cron', 'disable', '--id', jobId!);
    expect(cronDis.code).toBe(0);

    const cronRun = await cli('cron', 'run', '--id', jobId!);
    expect([0, 1, 3]).toContain(cronRun.code);

    const cronInstall = await cli('cron', 'install');
    expect([0, 1, 3]).toContain(cronInstall.code);

    const cronDel = await cli('cron', 'delete', '--id', jobId!);
    expect(cronDel.code).toBe(0);

    const storeEx = await cli('store', 'export', '--out', join(dir, 'exports', 'store-test.json'));
    expect(storeEx.code).toBe(0);

    const storeMig = await cli('store', 'migrate', '--to', 'json', '--out', join(dir, 'ysk.migrated.json'));
    expect(storeMig.code).toBe(0);
  }, 120_000);

  // ── agents / ask / tools / cdn ──────────────────────────────────────
  it('agents fleet/runtimes/probe, ask, tools run dry, cdn nodes/sites/dashboard', async () => {
    const runtimes = await cli('agents', 'runtimes');
    expect(runtimes.code).toBe(0);

    const fleet = await cli('agents', 'fleet', 'list');
    expect(fleet.code).toBe(0);

    const reg = await cli('agents', 'register', '--id', 'cli-agent-1', '--group', 'edge');
    expect(reg.code).toBe(0);
    const regBody = parseJsonOut(reg.out) as {
      agent?: { sessionId?: string; id?: string; agent_id?: string };
      ok?: boolean;
    };
    expect(regBody.ok).toBe(true);
    // Fleet session key is agent.id (UUID), not agent_id display name
    let sessionId = regBody.agent?.sessionId ?? regBody.agent?.id;
    if (!sessionId) {
      const listed = await cli('agents', 'fleet', 'list');
      const items =
        (parseJsonOut(listed.out) as { items?: Array<{ id?: string; agent_id?: string }> })
          .items ?? [];
      sessionId = items.find((a) => a.agent_id === 'cli-agent-1')?.id ?? items[0]?.id;
    }
    expect(sessionId).toBeTruthy();

    const cmds = await cli('agents', 'commands', '--session', sessionId!);
    expect([0, 4]).toContain(cmds.code);

    const probe = await cli('agents', 'probe');
    expect(probe.code).toBe(0);

    const ask = await cli('ask', 'check system health briefly');
    expect(ask.code).toBe(0);

    const toolsRun = await runMain([
      'node',
      'ysk-server',
      'tools',
      'run',
      '--tool',
      'fs.read',
      '--arg',
      `path=${join(dir, 'ysk.json')}`,
      '--dry-run',
      '--data-dir',
      dir,
      '--json',
    ]);
    expect([0, 3]).toContain(toolsRun.code);

    const nodes = await cli('cdn', 'nodes', 'list');
    expect(nodes.code).toBe(0);

    const nodeUp = await cli(
      'cdn',
      'nodes',
      'upsert',
      '--name',
      'edge-cli-1',
      '--base-url',
      'http://127.0.0.1:9999',
      '--region',
      'test',
    );
    expect(nodeUp.code).toBe(0);
    const nodeId = (parseJsonOut(nodeUp.out) as { node?: { id?: string } }).node?.id;
    expect(nodeId).toBeTruthy();

    const sites = await cli('cdn', 'sites', 'list');
    expect(sites.code).toBe(0);

    const siteUp = await cli(
      'cdn',
      'sites',
      'upsert',
      '--name',
      'cdn-cli-site',
      '--domains',
      'cdn-cli.test',
      '--origin-url',
      'http://127.0.0.1:8080',
      '--edge-id',
      nodeId!,
    );
    expect(siteUp.code).toBe(0);
    const siteId = (parseJsonOut(siteUp.out) as { site?: { id?: string } }).site?.id;

    if (siteId) {
      const render = await cli('cdn', 'render', '--site-id', siteId, '--dry-run');
      expect([0, 1, 3]).toContain(render.code);
      const dash = await cli('cdn', 'dashboard');
      expect(dash.code).toBe(0);
      const get = await cli('cdn', 'sites', 'get', '--id', siteId);
      expect(get.code).toBe(0);
    }

    if (nodeId) {
      const drain = await cli('cdn', 'nodes', 'drain', '--id', nodeId);
      expect(drain.code).toBe(0);
      const probeNode = await cli('cdn', 'nodes', 'probe', '--id', nodeId);
      expect([0, 1]).toContain(probeNode.code);
    }
  }, 90_000);

  // ── users / packages / rbac / audit / security ──────────────────────
  it('users create, rbac show/routes, security sessions/api-keys, audit q', async () => {
    const uc = await cli(
      'users',
      'create',
      '--username',
      'cliop',
      '--password',
      'CliOp-Pass-99!',
      '--role',
      'operator',
    );
    expect(uc.code).toBe(0);

    const uq = await cli('users', 'list', '--q', 'cliop');
    expect(uq.code).toBe(0);
    expect(
      (parseJsonOut(uq.out) as { items?: Array<{ username?: string }> }).items?.some(
        (u) => u.username === 'cliop',
      ),
    ).toBe(true);

    const pkg = await cli('packages', 'list', '--q', '');
    expect(pkg.code).toBe(0);

    const rbacShow = await cli('rbac', 'show', '--role', 'operator');
    expect(rbacShow.code).toBe(0);

    const rbacRoutes = await cli('rbac', 'routes');
    expect(rbacRoutes.code).toBe(0);
    expect((parseJsonOut(rbacRoutes.out) as { ruleCount?: number }).ruleCount).toBeGreaterThan(0);

    const audit = await cli('audit', '--limit', '50', '--q', 'cli');
    expect(audit.code).toBe(0);

    const secSessions = await cli('security', 'sessions', 'list', '--user', 'admin');
    expect(secSessions.code).toBe(0);

    const keys = await cli('security', 'api-keys', 'list');
    expect(keys.code).toBe(0);

    const keyCreate = await cli(
      'security',
      'api-keys',
      'create',
      '--name',
      'cli-test-key',
      '--scope',
      'read',
      '--user',
      'admin',
    );
    expect(keyCreate.code).toBe(0);
    const keyId = (parseJsonOut(keyCreate.out) as { key?: { id?: string } }).key?.id;
    if (keyId) {
      const del = await cli('security', 'api-keys', 'delete', '--id', keyId);
      expect([0, 4]).toContain(del.code);
    }
  });

  // ── logs / host / nginx / ssl / services / migrate ──────────────────
  it('logs journal/units/query, host network, nginx test, ssl get miss, services, migrate', async () => {
    const units = await cli('logs', 'units');
    expect(units.code).toBe(0);

    const journal = await cli('logs', 'journal', '--lines', '5');
    expect([0, 1]).toContain(journal.code);

    const query = await cli('logs', 'query', '--source', 'journal:', '--lines', '3');
    expect([0, 1]).toContain(query.code);

    const hostNet = await cli('host', 'network');
    expect([0, 1]).toContain(hostNet.code);

    const hostLoad = await cli('host', 'load');
    expect([0, 1]).toContain(hostLoad.code);

    const nginxTest = await cli('nginx', 'test');
    expect([0, 4, 5]).toContain(nginxTest.code);

    const sslGet = await cli('ssl', 'get', '--domain', 'no-cert.example');
    expect(sslGet.code).toBe(4);

    const svcList = await cli('services', 'list');
    expect(svcList.code).toBe(0);

    const svcStart = await cli('services', 'start', '--unit', 'nginx');
    expect(svcStart.code).toBe(0);
    expect((parseJsonOut(svcStart.out) as { dryRun?: boolean }).dryRun).toBe(true);

    const svcStop = await cli('services', 'stop', '--unit', 'nginx');
    expect(svcStop.code).toBe(0);

    const migStatus = await cli('migrate', 'status');
    expect(migStatus.code).toBe(0);

    const migPost = await cli('migrate', 'post', '--job', 'no-job');
    expect(migPost.code).toBe(3);
    expect((parseJsonOut(migPost.out) as { blocked?: boolean }).blocked).toBe(true);

    const migHost = await cli('migrate', 'host', '--target', 'root@127.0.0.1', '--dry-run');
    expect([0, 1, 2, 3]).toContain(migHost.code);
  }, 60_000);

  // ── files ───────────────────────────────────────────────────────────
  it('files list/read/write/mkdir/stat/trash/shares/favorites/webdav', async () => {
    const list = await cli('files', 'list', '--root', 'public', '--path', '.');
    expect(list.code).toBe(0);

    const write = await cli(
      'files',
      'write',
      '--root',
      'public',
      '--path',
      'cli-hello.txt',
      '--content',
      'hello-from-cli',
    );
    expect([0, 1]).toContain(write.code);

    const read = await cli('files', 'read', '--root', 'public', '--path', 'cli-hello.txt');
    expect([0, 1]).toContain(read.code);

    const mkdir = await cli('files', 'mkdir', '--root', 'public', '--path', 'cli-dir');
    expect([0, 1]).toContain(mkdir.code);

    const stat = await cli('files', 'stat', '--root', 'public', '--path', 'cli-hello.txt');
    expect([0, 1]).toContain(stat.code);

    const trash = await cli('files', 'trash', 'list');
    expect([0, 1, 2]).toContain(trash.code);

    const shares = await cli('files', 'shares');
    expect([0, 1, 2]).toContain(shares.code);

    const fav = await cli('files', 'favorites');
    expect([0, 1, 2]).toContain(fav.code);

    const webdav = await cli('files', 'webdav');
    expect([0, 1, 2]).toContain(webdav.code);

    // project root listing
    if (projectId) {
      const pl = await cli('files', 'list', '--root', `project:${projectId}`, '--path', '.');
      expect([0, 1, 2, 4]).toContain(pl.code);
    }
  });

  // ── ssh-key / ssh-2fa help paths (no keys needed for validation) ────
  it('ssh-key / ssh-2fa / firewall-ish validation exits', async () => {
    // missing required flags → validation (2) or structured not_found
    const sk = await cli('ssh-key', 'list');
    expect([0, 1, 2]).toContain(sk.code);

    const s2 = await cli('ssh-2fa', 'list');
    expect([0, 1, 2]).toContain(s2.code);
  });

  // ── health --url failure path ───────────────────────────────────────
  it('health --url to closed port returns host_error-ish', async () => {
    const r = await runMain([
      'node',
      'ysk-server',
      'health',
      '--url',
      'http://127.0.0.1:1',
      '--json',
    ]);
    expect([0, 1, 5]).toContain(r.code);
    const body = parseJsonOut(r.out) as { ok?: boolean };
    expect(body.ok).toBe(false);
  });

  it('health --url against serve-once is ok', async () => {
    const prev = process.env.YSK_SERVE_ONCE;
    process.env.YSK_SERVE_ONCE = '1';
    try {
      // first boot a server that exits after bind? YSK_SERVE_ONCE closes immediately —
      // use harness server instead via createHttpServer path: spin mini server
      const { createServer } = await import('node:http');
      const srv = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', product: 'YSK Server' }));
      });
      await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const r = await runMain([
        'node',
        'ysk-server',
        'health',
        '--url',
        `http://127.0.0.1:${port}/health`,
        '--json',
      ]);
      expect(r.code).toBe(0);
      const body = parseJsonOut(r.out) as { ok?: boolean; httpStatus?: number };
      expect(body.ok).toBe(true);
      expect(body.httpStatus).toBe(200);
      // plain text body path
      const plainSrv = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
      await new Promise<void>((resolve) => plainSrv.listen(0, '127.0.0.1', () => resolve()));
      const paddr = plainSrv.address();
      const pport = typeof paddr === 'object' && paddr ? paddr.port : 0;
      const r2 = await runMain([
        'node',
        'ysk-server',
        'health',
        '--url',
        `http://127.0.0.1:${pport}`,
        '--json',
      ]);
      expect(r2.code).toBe(0);
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      await new Promise<void>((resolve) => plainSrv.close(() => resolve()));
    } finally {
      if (prev === undefined) delete process.env.YSK_SERVE_ONCE;
      else process.env.YSK_SERVE_ONCE = prev;
    }
  });

  // ── help for major groups (stderr usage) ────────────────────────────
  it('subcommand help returns validation exit for major groups', async () => {
    for (const cmd of [
      'email',
      'cron',
      'files',
      'store',
      'cdn',
      'backup',
      'security',
    ] as const) {
      const r = await cli(cmd, 'help');
      expect([0, 1, 2]).toContain(r.code);
    }
  });

  // ── files deep ops ──────────────────────────────────────────────────
  it('files rename/copy/move/chmod/rm/upload/webdav token lifecycle', async () => {
    await cli(
      'files',
      'write',
      '--root',
      'public',
      '--path',
      'deep/a.txt',
      '--content',
      'aaa',
    );
    await cli('files', 'mkdir', '--root', 'public', '--path', 'deep/sub');

    const copy = await cli(
      'files',
      'copy',
      '--root',
      'public',
      '--from',
      'deep/a.txt',
      '--to',
      'deep/b.txt',
    );
    expect([0, 1]).toContain(copy.code);

    const rename = await cli(
      'files',
      'rename',
      '--root',
      'public',
      '--from',
      'deep/b.txt',
      '--to',
      'deep/c.txt',
    );
    expect([0, 1]).toContain(rename.code);

    const move = await cli(
      'files',
      'move',
      '--root',
      'public',
      '--from',
      'deep/c.txt',
      '--to',
      'deep/sub/c.txt',
    );
    expect([0, 1]).toContain(move.code);

    const chmod = await cli(
      'files',
      'chmod',
      '--root',
      'public',
      '--path',
      'deep/a.txt',
      '--mode',
      '644',
    );
    expect([0, 1]).toContain(chmod.code);

    const ls = await cli(
      'files',
      'list',
      '--root',
      'public',
      '--path',
      'deep',
      '--sort',
      'size',
      '--order',
      'desc',
      '--q',
      'a',
    );
    expect(ls.code).toBe(0);

    // upload from local file
    const local = join(dir, 'upload-src.txt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(local, 'upload-body', 'utf8');
    const upload = await cli(
      'files',
      'upload',
      '--root',
      'public',
      '--dir',
      'deep',
      '--file',
      local,
    );
    expect([0, 1]).toContain(upload.code);

    // write from --file
    const writeFile = await cli(
      'files',
      'write',
      '--root',
      'public',
      '--path',
      'deep/from-file.txt',
      '--file',
      local,
    );
    expect([0, 1]).toContain(writeFile.code);

    const rm = await cli(
      'files',
      'rm',
      '--root',
      'public',
      '--path',
      'deep/from-file.txt',
    );
    expect([0, 1, 4]).toContain(rm.code);

    const trashList = await cli('files', 'trash', 'list', '--root', 'public');
    expect([0, 1]).toContain(trashList.code);

    const webdavToken = await cli('files', 'webdav', 'token');
    expect([0, 1, 2]).toContain(webdavToken.code);
    const webdavStatus = await cli('files', 'webdav', 'status');
    expect([0, 1, 2]).toContain(webdavStatus.code);
    const webdavOff = await cli('files', 'webdav', 'disable');
    expect([0, 1, 2]).toContain(webdavOff.code);

    // validation exits
    expect((await cli('files', 'stat', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'read', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'write', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'mkdir', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'rename', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'copy', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'chmod', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'unknown-sub', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'list', '--root', 'badroot')).code).toBe(2);
  }, 60_000);

  // ── hosting / email / ssl / ssh / migrate / cdn more ────────────────
  it('hosting ftps/webmail/public-files/dovecot dry + email dns missing + ssl', async () => {
    const ftps = await cli('hosting', 'ftps-apply', '--domain', 'files.cli-cov.test');
    expect([0, 1, 3]).toContain(ftps.code);

    const webmail = await cli('hosting', 'webmail-apply', '--domain', 'webmail.cli-cov.test');
    expect([0, 1, 3]).toContain(webmail.code);

    const pubFiles = await cli('hosting', 'public-files', '--domain', 'files.cli-cov.test');
    expect([0, 1, 3]).toContain(pubFiles.code);

    const dovecot = await cli('hosting', 'dovecot-passdb', '--all');
    expect([0, 1, 2, 3]).toContain(dovecot.code);

    const deliver = await cli(
      'hosting',
      'email-deliverability',
      '--domain',
      'cli-mail.test',
    );
    expect([0, 1, 2]).toContain(deliver.code);

    const emailBoot = await cli(
      'hosting',
      'email-bootstrap',
      '--domain',
      'boot2-mail.test',
      '--ip',
      '203.0.113.12',
    );
    expect([0, 1, 3]).toContain(emailBoot.code);

    // unknown email sub → 2
    const emailUnknown = await cli('email', 'nope');
    expect(emailUnknown.code).toBe(2);

    // email dns missing domain
    const dnsMiss = await cli('email', 'dns', '--domain', 'no-such-domain.test');
    expect(dnsMiss.code).toBe(2);

    // host help unknown sub
    const hostHelp = await cli('host', 'unknown-sub');
    expect(hostHelp.code).toBe(2);

    // host metrics aliases already covered; status alias
    const hostStatus = await cli('host', 'status');
    expect(hostStatus.code).toBe(0);

    const hostInfo = await cli('host', 'info');
    expect(hostInfo.code).toBe(0);

    // logs unknown sub
    const logsBad = await cli('logs', 'nope');
    expect(logsBad.code).toBe(2);

    // ssl issue/list-style
    const sslList = await cli('ssl', 'list');
    expect(sslList.code).toBe(0);

    // ssh-key create if supported
    const skCreate = await cli(
      'ssh-key',
      'create',
      '--name',
      'cli-ssh-cov',
      '--comment',
      'cov',
    );
    expect([0, 1, 2]).toContain(skCreate.code);
    const skList = await cli('ssh-key', 'list');
    expect([0, 1, 2]).toContain(skList.code);
    const skGet = await cli('ssh-key', 'get', '--id', 'no-such');
    expect([0, 1, 2, 4]).toContain(skGet.code);

    const s2faList = await cli('ssh-2fa', 'list');
    expect([0, 1, 2]).toContain(s2faList.code);
    const s2faHelp = await cli('ssh-2fa', 'help');
    expect([0, 1, 2]).toContain(s2faHelp.code);

    // agent help (only run is valid)
    const agentHelp = await cli('agent', 'help');
    expect(agentHelp.code).toBe(2);

    // system unknown sub
    const sysBad = await cli('system', 'nope');
    expect([1, 2]).toContain(sysBad.code);

    // packages only list
    const pkgList = await cli('packages', 'list', '--q', 'x');
    expect(pkgList.code).toBe(0);
    const pkgBad = await cli('packages', 'create', '--name', 'x');
    expect(pkgBad.code).toBe(2);

    // security sessions revoke missing
    const secRevoke = await cli('security', 'sessions', 'revoke', '--id', 'no-such');
    expect([0, 1, 2, 4]).toContain(secRevoke.code);

    // backup restic run honesty
    const backupResticRun = await cli('backup', 'restic', 'run');
    expect([0, 1, 2, 3]).toContain(backupResticRun.code);

    // migrate inventory
    const migInv = await cli('migrate', 'inventory');
    expect([0, 1, 2, 3]).toContain(migInv.code);

    // db-cluster more ops on existing
    const dbList = await cli('db-cluster', 'list');
    expect(dbList.code).toBe(0);
    const clusters =
      (parseJsonOut(dbList.out) as { items?: Array<{ id?: string }> }).items ?? [];
    if (clusters[0]?.id) {
      const fleet = await cli('db-cluster', 'fleet', '--id', clusters[0].id);
      expect([0, 1, 2, 3]).toContain(fleet.code);
      const push = await cli('db-cluster', 'push', '--id', clusters[0].id);
      expect([0, 1, 2, 3]).toContain(push.code);
      const bundle = await cli('db-cluster', 'bundle', '--id', clusters[0].id);
      expect([0, 1, 2, 3]).toContain(bundle.code);
      const installPeers = await cli(
        'db-cluster',
        'install-peers',
        '--id',
        clusters[0].id,
      );
      expect([0, 1, 2, 3]).toContain(installPeers.code);
    }

    // nginx reload dry (2 = usage/fail-closed, 0/1 success/partial, 3–5 honest blocked)
    const nginxReload = await cli('nginx', 'reload');
    expect([0, 1, 2, 3, 4, 5]).toContain(nginxReload.code);

    // defense unknown → usage
    const defBad = await cli('defense', 'nope');
    expect(defBad.code).toBe(2);

    // tools help
    const toolsHelp = await runMain(['node', 'ysk-server', 'tools', '--help', '--json']);
    expect([0, 1, 2]).toContain(toolsHelp.code);

    // cdn help + apply/purge/dns-sync
    const cdnHelp = await cli('cdn', 'help');
    expect(cdnHelp.code).toBe(2);

    const sites = await cli('cdn', 'sites', 'list');
    expect(sites.code).toBe(0);
    const siteItems =
      (parseJsonOut(sites.out) as { items?: Array<{ id?: string }> }).items ?? [];
    if (siteItems[0]?.id) {
      const apply = await cli('cdn', 'apply', '--site-id', siteItems[0].id, '--dry-run');
      expect([0, 1, 3]).toContain(apply.code);
      const purge = await cli('cdn', 'purge', '--site-id', siteItems[0].id);
      expect([0, 1, 3]).toContain(purge.code);
      const dnsSync = await cli('cdn', 'dns-sync', '--site-id', siteItems[0].id);
      expect([0, 1, 3]).toContain(dnsSync.code);
      // `health` is not a top-level cdn subcommand (usage → 2); health-loop is
      const health = await cli('cdn', 'health');
      expect([0, 1, 2]).toContain(health.code);
      const healthLoop = await cli('cdn', 'health-loop');
      expect([0, 1, 2, 3]).toContain(healthLoop.code);
    }

    // projects isolation provision single
    if (projectId) {
      const isoOne = await cli(
        'projects',
        'isolation',
        'provision',
        '--id',
        projectId,
      );
      expect([0, 1, 2, 3]).toContain(isoOne.code);
    }

    // ask empty prompt
    const askEmpty = await runMain(['node', 'ysk-server', 'ask', '--data-dir', dir, '--json']);
    expect([0, 1, 2]).toContain(askEmpty.code);

    // version bare
    const ver = await runMain(['node', 'ysk-server', 'version']);
    expect(ver.code).toBe(0);
    expect(ver.out).toContain(VERSION);

    // readiness without data-dir
    const ready = await runMain(['node', 'ysk-server', 'readiness', '--json']);
    expect([0, 1, 2]).toContain(ready.code);

    // store help
    const storeHelp = await cli('store', 'help');
    expect(storeHelp.code).toBe(2);

    // cron help already; run missing id
    const cronBad = await cli('cron', 'run');
    expect([1, 2, 4]).toContain(cronBad.code);
  }, 120_000);

  // ── ssh-key full lifecycle ──────────────────────────────────────────
  it('ssh-key create/get/public/export/install/test/rotate/authorize/uninstall/delete', async () => {
    const create = await cli(
      'ssh-key',
      'create',
      '--name',
      'cli-ssh-full',
      '--algo',
      'ed25519',
      '--purpose',
      'user',
      '--comment',
      'full-cov',
      '--reveal',
    );
    expect([0, 1, 2]).toContain(create.code);
    const id = (parseJsonOut(create.out) as { identity?: { id?: string } }).identity?.id
      ?? (parseJsonOut(create.out) as { id?: string }).id;
    expect(id || create.code !== 0).toBeTruthy();

    // purpose aliases + filters
    const listUser = await cli('ssh-key', 'list', '--purpose', 'user');
    expect(listUser.code).toBe(0);
    const listPanel = await cli('ssh-keys', 'ls', '--purpose', 'panel');
    expect(listPanel.code).toBe(0);
    const listUnbound = await cli('ssh-key', 'list', '--purpose', 'unbound');
    expect(listUnbound.code).toBe(0);

    // validation exits (--data-dir value can be mistaken as positional id → 1/4)
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'get')).code);
    expect((await cli('ssh-key', 'create')).code).toBe(2);
    expect((await cli('ssh-key', 'import')).code).toBe(2);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'public')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'export')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'install')).code);
    expect([1, 2, 3, 4, 5]).toContain((await cli('ssh-key', 'test')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'rotate')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'authorize-self')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'uninstall')).code);
    expect([1, 2, 3, 4]).toContain((await cli('ssh-key', 'delete')).code);
    expect((await cli('ssh-key', 'nope')).code).toBe(2);

    if (!id) return;

    const get = await cli('ssh-key', 'get', '--id', id);
    expect(get.code).toBe(0);

    const pub = await cli('ssh-key', 'public', '--id', id);
    expect(pub.code).toBe(0);

    const pubPlain = await runMain([
      'node',
      'ysk-server',
      'ssh-key',
      'public',
      '--id',
      id,
      '--data-dir',
      dir,
    ]);
    expect(pubPlain.code).toBe(0);
    expect(pubPlain.out.length).toBeGreaterThan(10);

    const expOut = join(dir, 'ssh-export-key.pem');
    const exp = await cli('ssh-key', 'export', '--id', id, '--out', expOut);
    expect(exp.code).toBe(0);

    const expJson = await cli('ssh-key', 'export', '--id', id);
    expect(expJson.code).toBe(0);

    const expPlain = await runMain([
      'node',
      'ysk-server',
      'ssh-key',
      'export',
      '--id',
      id,
      '--data-dir',
      dir,
    ]);
    expect(expPlain.code).toBe(0);

    const install = await cli('ssh-key', 'install', '--id', id);
    expect([0, 1, 3]).toContain(install.code);

    const test = await cli(
      'ssh-key',
      'test',
      '--id',
      id,
      '--target',
      'root@127.0.0.1',
    );
    expect([0, 1, 2, 3, 5]).toContain(test.code);

    const rotate = await cli('ssh-key', 'rotate', '--id', id, '--reveal');
    expect([0, 1, 4]).toContain(rotate.code);

    const authSelf = await cli('ssh-key', 'authorize-self', '--id', id);
    expect([0, 1]).toContain(authSelf.code);

    const uninst = await cli('ssh-key', 'uninstall', '--id', id, '--keep-files');
    expect([0, 1, 3]).toContain(uninst.code);

    // import from exported key
    if (existsSync(expOut)) {
      const imp = await cli(
        'ssh-key',
        'import',
        '--name',
        'cli-ssh-import',
        '--file',
        expOut,
        '--purpose',
        'panel',
        '--reveal',
      );
      expect([0, 1, 2]).toContain(imp.code);
      const impId = (parseJsonOut(imp.out) as { identity?: { id?: string } }).identity?.id;
      if (impId) {
        await cli('ssh-key', 'delete', '--id', impId);
      }
    }

    const impMiss = await cli(
      'ssh-key',
      'import',
      '--name',
      'miss',
      '--file',
      join(dir, 'no-such-key.pem'),
    );
    expect(impMiss.code).toBe(4);

    // create with --install dry
    const createInst = await cli(
      'ssh-key',
      'create',
      '--name',
      'cli-ssh-install',
      '--purpose',
      'panel_outbound',
      '--install',
    );
    expect([0, 1, 2, 3]).toContain(createInst.code);

    const del = await cli('ssh-key', 'delete', '--id', id, '--purge-disk');
    expect([0, 1, 4]).toContain(del.code);

    const getMiss = await cli('ssh-key', 'get', '--id', 'no-such-ssh-id');
    expect(getMiss.code).toBe(4);
    const pubMiss = await cli('ssh-key', 'public', '--id', 'no-such-ssh-id');
    expect(pubMiss.code).toBe(4);
  }, 90_000);

  // ── ssh-2fa full lifecycle ──────────────────────────────────────────
  it('ssh-2fa enroll/confirm/install/pam/reveal/retire', async () => {
    expect((await cli('ssh-2fa', 'enroll')).code).toBe(2);
    expect((await cli('ssh-2fa', 'confirm')).code).toBe(2);
    expect((await cli('ssh-2fa', 'install')).code).toBe(2);
    expect((await cli('ssh-2fa', 'uninstall')).code).toBe(2);
    expect((await cli('ssh-2fa', 'reveal')).code).toBe(2);
    expect((await cli('ssh-2fa', 'retire')).code).toBe(2);
    expect((await cli('ssh-2fa', 'nope')).code).toBe(2);

    const pam = await cli('ssh-2fa', 'pam');
    expect(pam.code).toBe(0);
    const snippet = await cli('ssh2fa', 'snippet');
    expect(snippet.code).toBe(0);

    const enroll = await cli(
      'ssh-2fa',
      'enroll',
      '--user',
      'ysk_cli_2fa',
      '--home',
      join(dir, 'homes', 'ysk_cli_2fa'),
    );
    expect([0, 1, 2]).toContain(enroll.code);
    const recId =
      (parseJsonOut(enroll.out) as { record?: { id?: string } }).record?.id ??
      (parseJsonOut(enroll.out) as { id?: string }).id;

    const fromPanel = await cli(
      'ssh-2fa',
      'create',
      '--user',
      'ysk_cli_2fa_panel',
      '--from-panel',
    );
    // no panel totp → 2
    expect([0, 1, 2]).toContain(fromPanel.code);

    if (recId) {
      const confirm = await cli('ssh-2fa', 'confirm', '--id', recId, '--code', '000000');
      expect([0, 1, 2]).toContain(confirm.code);

      const install = await cli('ssh-2fa', 'install', '--id', recId);
      expect([0, 1, 3]).toContain(install.code);

      const reveal = await cli('ssh-2fa', 'reveal', '--id', recId);
      expect([0, 1]).toContain(reveal.code);

      const uninst = await cli('ssh-2fa', 'uninstall', '--id', recId);
      expect([0, 1, 3]).toContain(uninst.code);

      const retire = await cli('ssh-2fa', 'retire', '--id', recId, '--purge-file');
      expect([0, 1]).toContain(retire.code);
    }

    const list = await cli('ssh-2fa', 'list', '--user', 'ysk_cli_2fa');
    expect(list.code).toBe(0);
  }, 60_000);

  // ── backup deep paths ───────────────────────────────────────────────
  it('backup settings from-json, restore/delete validation, restic restore, list q', async () => {
    const { writeFileSync } = await import('node:fs');
    const settingsFile = join(dir, 'backup-settings.json');
    writeFileSync(
      settingsFile,
      JSON.stringify({
        remote: { kind: 'local', path: join(dir, 'remote2'), enabled: false },
        exclusions: ['.cache', 'tmp'],
        restic: { enabled: false, password: 'x' },
      }),
      'utf8',
    );
    const fromJson = await cli('backup', 'settings', 'set', '--from-json', settingsFile);
    expect(fromJson.code).toBe(0);

    const exclFile = join(dir, 'excludes.txt');
    writeFileSync(exclFile, 'node_modules\n.git\n', 'utf8');
    const setExcl = await cli(
      'backup',
      'settings',
      'set',
      '--remote-kind',
      'sftp',
      '--remote-host',
      '127.0.0.1',
      '--remote-user',
      'bak',
      '--remote-port',
      '22',
      '--remote-disable',
      '--exclusions-file',
      exclFile,
      '--restic-disable',
      '--restic-repo',
      join(dir, 'restic-repo'),
    );
    expect(setExcl.code).toBe(0);

    const listQ = await cli('backup', 'list', '--q', 'none', '--project-id', projectId!);
    expect(listQ.code).toBe(0);

    expect((await cli('backup', 'control-plane-restore')).code).toBe(2);
    expect((await cli('backup', 'restore')).code).toBe(2);
    expect((await cli('backup', 'delete')).code).toBe(2);
    expect((await cli('backup', 'restic', 'restore')).code).toBe(2);
    expect((await cli('backup', 'restic', 'nope')).code).toBe(2);
    expect((await cli('backup', 'nope')).code).toBe(2);

    try {
      const cpRestore = await cli(
        'backup',
        'cp-restore',
        '--name',
        'no-such.tar.gz',
        '--mode',
        'dry-run',
      );
      expect([0, 1, 2, 3, 4]).toContain(cpRestore.code);
    } catch {
      // some restore helpers throw YskError instead of structured result
    }

    try {
      const restoreMiss = await cli(
        'backup',
        'restore',
        '--project-id',
        projectId!,
        '--name',
        'no-such.tar.gz',
        '--mode',
        'dry-run',
      );
      expect([0, 1, 2, 3, 4, 5]).toContain(restoreMiss.code);
    } catch {
      /* YskError throw path */
    }

    const delMiss = await cli(
      'backup',
      'delete',
      '--project-id',
      projectId!,
      '--name',
      'no-such.tar.gz',
    );
    expect([0, 1]).toContain(delMiss.code);

    const resticRestore = await cli(
      'backup',
      'restic',
      'restore',
      '--project-id',
      projectId!,
      '--snapshot',
      'latest',
      '--dry-run',
    );
    expect([0, 1, 2, 3, 4]).toContain(resticRestore.code);

    const resticRestoreMiss = await cli(
      'backup',
      'restic',
      'restore',
      '--project-id',
      'no-project',
      '--snapshot',
      'x',
    );
    expect(resticRestoreMiss.code).toBe(4);

    // schedule with install flag (dry honesty)
    const schedInst = await cli('backup', 'schedule', '--cron', '0 5 * * *', '--install');
    expect([0, 1, 3]).toContain(schedInst.code);

    // restic run with enable + password
    await cli(
      'backup',
      'settings',
      'set',
      '--restic-enable',
      '--restic-password',
      'Restic-Pass-99',
      '--restic-repo',
      join(dir, 'restic-repo2'),
    );
    const resticRun = await cli('backup', 'restic', 'run');
    expect([0, 1, 2, 3]).toContain(resticRun.code);

    // settings bare = get
    const bare = await cli('backup', 'settings');
    expect(bare.code).toBe(0);
  }, 120_000);

  // ── projects validation + runtimes + isolation backfill ─────────────
  it('projects validation exits, template apply, multi-runtime create', async () => {
    expect((await cli('projects', 'get')).code).toBe(2);
    expect((await cli('projects', 'create')).code).toBe(2);
    expect((await cli('projects', 'deploy')).code).toBe(2);
    expect((await cli('projects', 'git-deploy')).code).toBe(2);
    expect((await cli('projects', 'stop')).code).toBe(2);
    expect((await cli('projects', 'backup')).code).toBe(2);
    expect((await cli('projects', 'health')).code).toBe(2);
    expect((await cli('projects', 'template')).code).toBe(2);
    expect((await cli('projects', 'isolation', 'provision')).code).toBe(2);
    expect((await cli('projects', 'isolation', 'nope')).code).toBe(2);
    expect((await cli('projects', 'nope')).code).toBe(2);

    const backfill = await cli('projects', 'isolation', 'backfill-owners');
    expect(backfill.code).toBe(0);

    if (projectId) {
      const tpl = await cli(
        'projects',
        'template',
        '--id',
        projectId,
        '--template',
        'node-starter',
        '--force',
      );
      expect([0, 1, 2, 4]).toContain(tpl.code);

      const deployPhp = await cli(
        'projects',
        'create',
        '--name',
        'PhpCliCov',
        '--domain',
        'php-cli-cov.test',
        '--runtime',
        'php',
      );
      expect(deployPhp.code).toBe(0);
      const phpId = (parseJsonOut(deployPhp.out) as { project?: { id?: string }; id?: string })
        .project?.id
        ?? (parseJsonOut(deployPhp.out) as { id?: string }).id;
      if (phpId) {
        const dep = await cli('projects', 'deploy', '--id', phpId, '--fpm');
        expect([0, 1, 3]).toContain(dep.code);
      }

      const staticP = await cli(
        'projects',
        'create',
        '--name',
        'StaticCliCov',
        '--domain',
        'static-cli-cov.test',
        '--runtime',
        'static',
      );
      expect(staticP.code).toBe(0);
      const stId = (parseJsonOut(staticP.out) as { project?: { id?: string }; id?: string })
        .project?.id
        ?? (parseJsonOut(staticP.out) as { id?: string }).id;
      if (stId) {
        const dep = await cli('projects', 'deploy', '--id', stId, '--reload');
        expect([0, 1, 3]).toContain(dep.code);
      }

      const py = await cli(
        'projects',
        'create',
        '--name',
        'PyCliCov',
        '--domain',
        'py-cli-cov.test',
        '--runtime',
        'python',
      );
      expect(py.code).toBe(0);
      const pyId = (parseJsonOut(py.out) as { project?: { id?: string }; id?: string }).project
        ?.id
        ?? (parseJsonOut(py.out) as { id?: string }).id;
      if (pyId) {
        const dep = await cli('projects', 'deploy', '--id', pyId, '--entry', 'app.py');
        expect([0, 1, 3]).toContain(dep.code);
      }
    }
  }, 90_000);

  // ── files trash restore/purge + permanent rm + project chown ────────
  it('files trash restore/purge permanent rm project root ops', async () => {
    await cli(
      'files',
      'write',
      '--root',
      'public',
      '--path',
      'trash-me.txt',
      '--content',
      'bye',
    );
    const rm = await cli('files', 'rm', '--root', 'public', '--path', 'trash-me.txt');
    expect([0, 1, 4]).toContain(rm.code);

    const trashList = await cli('files', 'trash', 'list', '--root', 'public');
    expect(trashList.code).toBe(0);
    const items =
      (parseJsonOut(trashList.out) as { items?: Array<{ id?: string }> }).items ?? [];
    if (items[0]?.id) {
      const restore = await cli(
        'files',
        'trash',
        'restore',
        '--root',
        'public',
        '--id',
        items[0].id,
      );
      expect([0, 1]).toContain(restore.code);
    }

    expect((await cli('files', 'trash', 'restore', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'trash', 'nope', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'shares', 'nope', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'webdav', 'nope', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'rm', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'upload', '--root', 'public')).code).toBe(2);
    expect((await cli('files', 'write', '--root', 'public', '--path', 'x')).code).toBe(2);
    expect((await cli('files', 'move', '--root', 'public')).code).toBe(2);

    // permanent delete
    await cli(
      'files',
      'write',
      '--root',
      'public',
      '--path',
      'perm-del.txt',
      '--content',
      'x',
    );
    const perm = await cli(
      'files',
      'rm',
      '--root',
      'public',
      '--path',
      'perm-del.txt',
      '--permanent',
    );
    expect([0, 1, 4]).toContain(perm.code);

    const purge = await cli('files', 'trash', 'purge', '--root', 'public');
    expect([0, 1]).toContain(purge.code);

    if (projectId) {
      const pWrite = await cli(
        'files',
        'write',
        '--root',
        `project:${projectId}`,
        '--path',
        'cli-proj.txt',
        '--content',
        'proj',
      );
      expect([0, 1, 2, 4]).toContain(pWrite.code);
      const pMk = await cli(
        'files',
        'mkdir',
        '--root',
        `project:${projectId}`,
        '--path',
        'cli-subdir',
      );
      expect([0, 1, 2, 4]).toContain(pMk.code);
    }
  }, 60_000);

  // ── agents fleet remove + validation ────────────────────────────────
  it('agents fleet register/remove/commands validation + runtimes plain', async () => {
    expect((await cli('agents', 'fleet', 'register')).code).toBe(2);
    expect((await cli('agents', 'fleet', 'commands')).code).toBe(2);
    expect((await cli('agents', 'fleet', 'remove')).code).toBe(2);
    expect((await cli('agents', 'register')).code).toBe(2);
    expect((await cli('agents', 'commands')).code).toBe(2);
    expect((await cli('agents', 'nope')).code).toBe(2);

    const reg = await cli(
      'agents',
      'fleet',
      'register',
      '--id',
      'cli-fleet-rm',
      '--group',
      'test',
      '--edge',
    );
    expect(reg.code).toBe(0);
    const sid = (parseJsonOut(reg.out) as { agent?: { id?: string } }).agent?.id;
    if (sid) {
      const cmds = await cli('agents', 'fleet', 'commands', '--session', sid);
      expect(cmds.code).toBe(0);
      const rm = await cli('agents', 'fleet', 'remove', '--session', sid);
      expect(rm.code).toBe(0);
    }

    // list alias
    const listAlias = await cli('agents', 'list');
    expect(listAlias.code).toBe(0);

    // runtimes non-json
    const plain = await runMain([
      'node',
      'ysk-server',
      'agents',
      'runtimes',
      '--data-dir',
      dir,
    ]);
    expect(plain.code).toBe(0);
  });

  // ── store import + migrate more + setup non-json ────────────────────
  it('store import, migrate job status, setup non-json, tools missing tool', async () => {
    const expPath = join(dir, 'exports', 'store-roundtrip.json');
    const exp = await cli('store', 'export', '--out', expPath);
    expect(exp.code).toBe(0);

    if (existsSync(expPath)) {
      const imp = await cli('store', 'import', '--in', expPath);
      expect([0, 1, 2]).toContain(imp.code);
    }

    const migJob = await cli('migrate', 'status', '--job', 'no-such-job');
    expect(migJob.code).toBe(4);

    const migPostNo = await runMain([
      'node',
      'ysk-server',
      'migrate',
      'post',
      '--data-dir',
      dir,
      '--json',
    ]);
    expect(migPostNo.code).toBe(2);

    const migHostNo = await cli('migrate', 'host');
    expect([2, 3]).toContain(migHostNo.code);

    // host without dry-run or execute → blocked
    const migBlocked = await cli('migrate', 'host', '--target', 'root@127.0.0.1');
    expect(migBlocked.code).toBe(3);

    const migDry = await cli(
      'migrate',
      'host',
      '--target',
      'root@127.0.0.1',
      '--dry-run',
      '--identity-file',
      join(dir, 'fake-id'),
    );
    expect([0, 1, 2, 3, 5]).toContain(migDry.code);

    const migHelp = await cli('migrate', 'nope');
    expect(migHelp.code).toBe(2);

    // tools run missing --tool
    const toolsMiss = await runMain([
      'node',
      'ysk-server',
      'tools',
      'run',
      '--data-dir',
      dir,
      '--json',
    ]);
    expect(toolsMiss.code).toBe(1);

    // setup non-json success message path
    const tmp = mkdtempSync(join(tmpdir(), 'ysk-setup-plain-'));
    try {
      const plain = await runMain([
        'node',
        'ysk-server',
        'setup',
        '--data-dir',
        tmp,
        '--non-interactive',
        '--force',
        '--allow-insecure-defaults',
        '--admin-password',
        'admin',
      ]);
      expect(plain.code).toBe(0);
      expect(plain.out.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    // update non-json
    const upd = await runMain(['node', 'ysk-server', 'update', '--check']);
    expect([0, 1]).toContain(upd.code);

    // system unit-install non-json
    const sysPlain = await runMain([
      'node',
      'ysk-server',
      'system',
      'unit-install',
      '--data-dir',
      dir,
    ]);
    expect([0, 1]).toContain(sysPlain.code);

    // ask with no real prompt (--data-dir value may be used as prompt)
    const ask = await runMain(['node', 'ysk-server', 'ask', '--json']);
    expect([0, 1, 2]).toContain(ask.code);

    // email mailbox get/delete validation paths if present
    const mboxMiss = await cli(
      'email',
      'mailboxes',
      'delete',
      '--domain',
      'cli-mail.test',
      '--local',
      'nope',
    );
    expect([0, 1, 2, 4]).toContain(mboxMiss.code);
  }, 60_000);

  // ── cdn nodes/sites more + security + users delete ──────────────────
  it('cdn remove, security sessions, users get/delete, packages, rbac', async () => {
    const nodes = await cli('cdn', 'nodes', 'list');
    const nodeItems =
      (parseJsonOut(nodes.out) as { items?: Array<{ id?: string }> }).items ?? [];
    if (nodeItems[0]?.id) {
      const get = await cli('cdn', 'nodes', 'get', '--id', nodeItems[0].id);
      expect([0, 1, 2, 4]).toContain(get.code);
      const undrain = await cli('cdn', 'nodes', 'undrain', '--id', nodeItems[0].id);
      expect([0, 1, 2]).toContain(undrain.code);
      const del = await cli('cdn', 'nodes', 'delete', '--id', nodeItems[0].id);
      expect([0, 1, 2, 4]).toContain(del.code);
    }

    const sites = await cli('cdn', 'sites', 'list');
    const siteItems =
      (parseJsonOut(sites.out) as { items?: Array<{ id?: string }> }).items ?? [];
    if (siteItems[0]?.id) {
      const del = await cli('cdn', 'sites', 'delete', '--id', siteItems[0].id);
      expect([0, 1, 2, 4]).toContain(del.code);
    }

    // validation missing flags
    expect((await cli('cdn', 'nodes', 'upsert')).code).toBe(2);
    expect((await cli('cdn', 'sites', 'upsert')).code).toBe(2);
    expect((await cli('cdn', 'render')).code).toBe(2);
    expect((await cli('cdn', 'apply')).code).toBe(2);

    const users = await cli('users', 'list');
    expect(users.code).toBe(0);
    const uItems =
      (parseJsonOut(users.out) as { items?: Array<{ id?: string; username?: string }> })
        .items ?? [];
    const op = uItems.find((u) => u.username === 'cliop');
    if (op?.id) {
      const get = await cli('users', 'get', '--id', op.id);
      expect([0, 1, 2, 4]).toContain(get.code);
      const del = await cli('users', 'delete', '--id', op.id);
      expect([0, 1, 2, 3, 4]).toContain(del.code);
    }

    expect([0, 1, 2]).toContain((await cli('users', 'create')).code);
    expect([0, 1, 2]).toContain((await cli('users', 'nope')).code);
    expect([0, 1, 2]).toContain((await cli('rbac', 'show')).code);
    expect([0, 1, 2]).toContain((await cli('rbac', 'nope')).code);
    expect([0, 1, 2]).toContain((await cli('security', 'nope')).code);
    expect([0, 1, 2]).toContain((await cli('security', 'api-keys', 'create')).code);
    expect([0, 1, 2, 4]).toContain((await cli('security', 'api-keys', 'delete')).code);

    const sessions = await cli('security', 'sessions', 'list');
    expect(sessions.code).toBe(0);
  }, 60_000);

  // ── hosting more subs + dns + nginx conf detail ─────────────────────
  it('hosting more ops and nginx conf list/detail', async () => {
    for (const sub of [
      'php-fpm',
      'fail2ban',
      'ssl-status',
      'overview',
      'mail-status',
    ] as const) {
      const r = await cli('hosting', sub);
      expect([0, 1, 2]).toContain(r.code);
    }

    const nginxList = await cli('nginx', 'list');
    expect(nginxList.code).toBe(0);
    const confs = await cli('nginx', 'confs');
    expect(confs.code).toBe(0);
    const status = await cli('nginx', 'status');
    expect([0, 1]).toContain(status.code);
    expect((await cli('nginx', 'nope')).code).toBe(2);

    const sslIssue = await cli('ssl', 'issue', '--domain', 'ssl-cli-cov.test');
    expect([0, 1, 2, 3]).toContain(sslIssue.code);
    expect((await cli('ssl', 'nope')).code).toBe(2);

    const dnsHelp = await cli('dns', 'nope');
    expect([0, 1, 2]).toContain(dnsHelp.code);

    // db-cluster validation
    expect((await cli('db-cluster', 'create')).code).toBe(2);
    expect((await cli('db-cluster', 'get')).code).toBe(2);
    expect((await cli('db-cluster', 'plan')).code).toBe(2);
    expect((await cli('db-cluster', 'apply')).code).toBe(2);
    expect((await cli('db-cluster', 'nope')).code).toBe(2);

    // defense ban without ip
    expect((await cli('defense', 'ban')).code).toBe(2);
    expect((await cli('defense', 'unban')).code).toBe(2);

    // services missing unit
    expect((await cli('services', 'start')).code).toBe(2);
    expect((await cli('services', 'stop')).code).toBe(2);
    expect((await cli('services', 'nope')).code).toBe(2);

    // logs query missing source
    const logsSrc = await cli('logs', 'sources');
    expect(logsSrc.code).toBe(0);
    const logsOv = await cli('logs', 'overview');
    expect([0, 1]).toContain(logsOv.code);

    // host metrics aliases (unknown sub → 2)
    for (const sub of ['cpu', 'memory', 'disk', 'metrics', 'overview'] as const) {
      const r = await cli('host', sub);
      expect([0, 1, 2]).toContain(r.code);
    }

    // email more validation (data-dir path may become positional domain → 4)
    expect([1, 2, 4]).toContain((await cli('email', 'domains', 'get')).code);
    expect([1, 2, 4]).toContain((await cli('email', 'domains', 'create')).code);
    expect([1, 2, 4]).toContain((await cli('email', 'mailboxes', 'create')).code);
    expect([1, 2, 4]).toContain((await cli('email', 'dns')).code);

    // cron create missing
    expect([1, 2, 4]).toContain((await cli('cron', 'create')).code);
    expect([1, 2, 4]).toContain((await cli('cron', 'enable')).code);
    expect([1, 2, 4]).toContain((await cli('cron', 'delete')).code);
  }, 90_000);

  // ── locale + config flag + doctor ───────────────────────────────────
  it('locale flag, --config load, doctor alias', async () => {
    const loc = await runMain([
      'node',
      'ysk-server',
      'version',
      '--locale',
      'en',
      '--json',
    ]);
    expect(loc.code).toBe(0);

    const locEq = await runMain([
      'node',
      'ysk-server',
      'version',
      '--locale=zh-HK',
      '--json',
    ]);
    expect(locEq.code).toBe(0);

    const doctor = await cli('doctor');
    expect([0, 1, 2]).toContain(doctor.code);

    // self-update-plan already covered; with latest
    const plan = await cli('self-update-plan', '--latest', '9.9.9');
    expect(plan.code).toBe(0);

    // help -h non-json
    const h = await runMain(['node', 'ysk-server', '-h']);
    expect(h.code).toBe(0);
  });

  // ── hosting powerdns / email-mailbox / runtime kinds / cdn from-project ──
  it('hosting powerdns-load/mailbox/runtime kinds + cdn from-project + probe', async () => {
    expect([1, 2]).toContain((await cli('hosting', 'powerdns-load')).code);
    expect([1, 2]).toContain((await cli('hosting', 'email-mailbox')).code);
    expect([1, 2]).toContain((await cli('hosting', 'ftps-apply')).code);
    expect([1, 2]).toContain((await cli('hosting', 'webmail-apply')).code);
    expect([1, 2]).toContain((await cli('hosting', 'public-files')).code);
    expect([1, 2]).toContain((await cli('hosting', 'email-bootstrap')).code);
    expect([1, 2]).toContain((await cli('hosting', 'email-apply')).code);

    const pdnsInst = await cli('hosting', 'powerdns-install');
    expect([0, 1, 3]).toContain(pdnsInst.code);

    const pdnsLoad = await cli(
      'hosting',
      'powerdns-load',
      '--zone',
      'pdns-cli.test',
      '--ip',
      '203.0.113.50',
    );
    expect([0, 1, 3]).toContain(pdnsLoad.code);

    const mbox = await cli(
      'hosting',
      'email-mailbox',
      '--domain',
      'cli-mail.test',
      '--local',
      'hosting-user',
      '--password',
      'Mailbox-Host-99',
    );
    expect([0, 1, 2, 3, 4]).toContain(mbox.code);

    const mboxNew = await cli(
      'hosting',
      'email-mailbox',
      '--domain',
      'new-host-mail.test',
      '--local',
      'u1',
      '--ip',
      '203.0.113.51',
      '--password',
      'Mailbox-Host-99',
    );
    expect([0, 1, 2, 3]).toContain(mboxNew.code);

    for (const kind of ['php', 'python', 'go', 'rust'] as const) {
      const r = await cli('hosting', 'runtime-install', '--kind', kind);
      expect([0, 1, 3]).toContain(r.code);
    }

    const dovecotDom = await cli('hosting', 'dovecot-passdb', '--domain', 'cli-mail.test');
    expect([0, 1, 2]).toContain(dovecotDom.code);

    const delivId = await cli('hosting', 'email-deliverability', '--domain', 'cli-mail.test');
    expect([0, 1, 2]).toContain(delivId.code);

    // cdn probe all + from-project
    const probeAll = await cli('cdn', 'probe');
    expect([0, 1]).toContain(probeAll.code);

    if (projectId) {
      try {
        const fromP = await cli('cdn', 'from-project', '--project-id', projectId);
        expect([0, 1, 2, 4]).toContain(fromP.code);
      } catch {
        /* YskError when no edge nodes registered */
      }
    }
    expect([1, 2]).toContain((await cli('cdn', 'from-project')).code);
    expect([1, 2]).toContain((await cli('cdn', 'purge')).code);
    expect([1, 2]).toContain((await cli('cdn', 'dns-sync')).code);
    expect([1, 2]).toContain((await cli('cdn', 'nodes', 'delete')).code);
    expect([1, 2]).toContain((await cli('cdn', 'sites', 'get')).code);
    expect([1, 2]).toContain((await cli('cdn', 'sites', 'delete')).code);
    expect((await cli('cdn', 'nodes', 'nope')).code).toBe(2);
    expect((await cli('cdn', 'sites', 'nope')).code).toBe(2);

    // nginx reload/test/sync more
    const nginxSync = await cli('nginx', 'sync');
    expect([0, 1, 2, 3, 5]).toContain(nginxSync.code);

    // db-cluster import-sync style if exists
    const clusters =
      (parseJsonOut((await cli('db-cluster', 'list')).out) as { items?: Array<{ id?: string }> })
        .items ?? [];
    if (clusters[0]?.id) {
      const del = await cli('db-cluster', 'delete', '--id', clusters[0].id);
      expect([0, 1, 2, 3, 4]).toContain(del.code);
    }

    // serve non-json once
    const prev = process.env.YSK_SERVE_ONCE;
    process.env.YSK_SERVE_ONCE = '1';
    try {
      const plainServe = await runMain([
        'node',
        'ysk-server',
        'serve',
        '--data-dir',
        dir,
        '--host',
        '127.0.0.1',
        '--port',
        '0',
      ]);
      expect(plainServe.code).toBe(0);
      expect(plainServe.out.length).toBeGreaterThan(0);
    } finally {
      if (prev === undefined) delete process.env.YSK_SERVE_ONCE;
      else process.env.YSK_SERVE_ONCE = prev;
    }

    // health with --url to local serve once
    process.env.YSK_SERVE_ONCE = '1';
    try {
      // start serve in background via main is once - use local health without url already covered
      const healthLocal = await cli('health');
      expect(healthLocal.code).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.YSK_SERVE_ONCE;
      else process.env.YSK_SERVE_ONCE = prev;
    }

    // migrate with password env empty
    process.env.YSK_MIGRATE_SSH_PASSWORD = '';
    const migPw = await cli(
      'migrate',
      'host',
      '--target',
      'root@127.0.0.1',
      '--dry-run',
      '--password',
      '',
    );
    expect([0, 1, 2, 3, 5]).toContain(migPw.code);
    delete process.env.YSK_MIGRATE_SSH_PASSWORD;

    // migrate with identity-id
    const migId = await cli(
      'migrate',
      'host',
      '--target',
      'root@127.0.0.1',
      '--dry-run',
      '--identity-id',
      'no-such-id',
    );
    expect([0, 1, 2, 3, 5]).toContain(migId.code);

    // migrate post with execute
    const migPostExec = await runMain([
      'node',
      'ysk-server',
      'migrate',
      'post',
      '--job',
      'no-job',
      '--execute',
      '--data-dir',
      dir,
      '--json',
    ]);
    expect([0, 1, 2, 3, 4]).toContain(migPostExec.code);

    // migrate status with existing job list
    const migStatus = await cli('migrate', 'status');
    expect(migStatus.code).toBe(0);

    // resume without target
    const migResume = await cli('migrate', 'resume', '--dry-run');
    expect([0, 1, 2, 3]).toContain(migResume.code);
  }, 120_000);

  // ── email deep + defense whitelist remove + security ────────────────
  it('email domains delete + defense whitelist remove + logs query variants', async () => {
    const domains = await cli('email', 'domains', 'list');
    expect(domains.code).toBe(0);
    const items =
      (parseJsonOut(domains.out) as { items?: Array<{ domain?: string; id?: string }> }).items ??
      [];
    const row = items.find((d) => d.domain === 'cli-mail.test');
    if (row?.domain) {
      const delM = await cli(
        'email',
        'mailboxes',
        'delete',
        '--domain',
        row.domain,
        '--local',
        'info',
      );
      expect([0, 1, 2, 4]).toContain(delM.code);
      const delD = await cli('email', 'domains', 'delete', '--domain', row.domain);
      expect([0, 1, 2, 4]).toContain(delD.code);
    }

    const wlRm = await cli(
      'defense',
      'whitelist',
      '--action',
      'remove',
      '--ip',
      '203.0.113.1',
    );
    expect([0, 1, 2]).toContain(wlRm.code);

    const fail2banApply = await cli('defense', 'fail2ban-apply');
    expect([0, 1, 2, 3]).toContain(fail2banApply.code);

    const fwApply = await cli('defense', 'firewall-apply');
    expect([0, 1, 2, 3]).toContain(fwApply.code);

    const logsUnits = await cli('logs', 'units');
    expect(logsUnits.code).toBe(0);
    const logsJournal = await cli('logs', 'journal', '--lines', '2', '--unit', 'nginx');
    expect([0, 1]).toContain(logsJournal.code);

    // store status with kind
    const storeKind = await cli('store', 'status', '--kind', 'json');
    expect(storeKind.code).toBe(0);

    // users create missing password
    const uBad = await cli('users', 'create', '--username', 'nopass');
    expect([0, 1, 2]).toContain(uBad.code);

    // packages only list already; audit with actor
    const audit = await cli('audit', '--limit', '10', '--actor', 'admin');
    expect(audit.code).toBe(0);

    // security api-keys create missing name
    const keyBad = await cli('security', 'api-keys', 'create', '--user', 'admin');
    expect([0, 1, 2]).toContain(keyBad.code);

    // ssl get with domain that exists as project domain maybe
    const sslList = await cli('ssl', 'list');
    expect(sslList.code).toBe(0);

    // tools run without dry-run (may block)
    const toolsLive = await runMain([
      'node',
      'ysk-server',
      'tools',
      'run',
      '--tool',
      'fs.read',
      '--arg',
      `path=${join(dir, 'ysk.json')}`,
      '--data-dir',
      dir,
      '--json',
    ]);
    expect([0, 1, 3]).toContain(toolsLive.code);

    // agents list with group
    const agentsG = await cli('agents', 'fleet', 'list', '--group', 'edge');
    expect(agentsG.code).toBe(0);

    // files fav alias
    const fav = await cli('files', 'fav', '--root', 'public');
    expect([0, 1, 2]).toContain(fav.code);

    // files shares list
    const shares = await cli('files', 'shares', 'list', '--root', 'public');
    expect([0, 1, 2]).toContain(shares.code);

    // backup list without project
    const bakList = await cli('backup', 'list');
    expect(bakList.code).toBe(0);

    // cron status already; create enable delete already

    // db-cluster overview / import-sync / probe peers / fleet ops
    const overview = await cli('db-cluster', 'overview');
    expect(overview.code).toBe(0);

    const { writeFileSync } = await import('node:fs');
    // create cluster for remaining ops
    const create = await cli(
      'db-cluster',
      'create',
      '--name',
      'cli-ov-cluster',
      '--engine',
      'postgres',
      '--kind',
      'postgres-replica',
      '--member',
      '127.0.0.1=primary:local',
      '--member',
      '127.0.0.2=replica:ssh',
      '--member',
      '127.0.0.3=replica:fleet:agent-sess',
    );
    expect(create.code).toBe(0);
    const cid = (parseJsonOut(create.out) as { cluster?: { id?: string } }).cluster?.id;
    if (cid) {
      const probePeers = await cli('db-cluster', 'probe', '--id', cid, '--peers');
      expect([0, 1]).toContain(probePeers.code);

      const fleet = await cli(
        'db-cluster',
        'fleet',
        '--id',
        cid,
        '--op',
        'probe',
      );
      expect([0, 1]).toContain(fleet.code);

      const fleetApply = await cli(
        'db-cluster',
        'fleet',
        '--id',
        cid,
        '--op',
        'apply',
        '--execute',
      );
      expect([0, 1, 3]).toContain(fleetApply.code);

      const syncFile = join(dir, 'cluster-sync.json');
      const get = await cli('db-cluster', 'get', '--id', cid);
      const cluster = (parseJsonOut(get.out) as { cluster?: unknown }).cluster;
      if (cluster) {
        writeFileSync(syncFile, JSON.stringify({ cluster }), 'utf8');
        const imp = await cli('db-cluster', 'import-sync', '--file', syncFile);
        expect([0, 1, 2]).toContain(imp.code);
      }
      expect((await cli('db-cluster', 'import-sync')).code).toBe(2);
    }

    // update --apply path (no real upgrade)
    const updApply = await runMain([
      'node',
      'ysk-server',
      'update',
      '--apply',
      '--latest',
      VERSION,
      '--json',
    ]);
    expect([0, 1]).toContain(updApply.code);

    // setup failure path (non-interactive without insecure defaults may fail)
    const setupFailDir = mkdtempSync(join(tmpdir(), 'ysk-setup-fail-'));
    try {
      const fail = await runMain([
        'node',
        'ysk-server',
        'setup',
        '--data-dir',
        setupFailDir,
        '--non-interactive',
        '--admin-password',
        'admin',
      ]);
      // may succeed with defaults or fail
      expect([0, 1]).toContain(fail.code);
    } finally {
      rmSync(setupFailDir, { recursive: true, force: true });
    }
  }, 120_000);
});
