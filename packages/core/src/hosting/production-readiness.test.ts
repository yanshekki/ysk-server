import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  assessProductionReadiness,
  readinessCategoryLabel,
  READINESS_CATEGORY_ORDER,
} from './production-readiness.js';
import { JsonStore } from '../db/store.js';

function empty(over: Partial<RunResult> = {}): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...over };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  bins?: string[];
  services?: Record<string, string>;
}): HostExecutor {
  const bins = new Set(opts?.bins ?? ['nginx', 'node', 'git', 'php', 'python3', 'go', 'rustc', 'cargo', 'fail2ban-client', 'ufw', 'sshd', 'certbot', 'pm2', 'pdns_server', 'pdns_control']);
  return {
    executeEnabled: () => opts?.execute === true,
    isRoot: () => opts?.root === true,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async (name) =>
      empty({
        stdout: opts?.services?.[name] ?? 'inactive',
        argv: ['systemctl', 'is-active', name],
      }),
    runCommand: async (argv) => {
      const j = argv.join(' ');
      if (j.includes('command -v')) {
        const bin = j.replace(/.*command -v\s+/, '').replace(/\s+.*$/, '').trim();
        if (bins.has(bin) || bins.has(bin.split(' ')[0]!)) {
          return empty({ stdout: `/usr/bin/${bin}\n`, argv });
        }
        return empty({ stdout: '', argv });
      }
      if (j.includes('pm2') || j.includes('pdns')) {
        return empty({ stdout: 'ok', argv });
      }
      return empty({ argv });
    },
  };
}

describe('assessProductionReadiness', () => {
  it('reports degraded without EXECUTE/root and lists items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ready-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await assessProductionReadiness({ dataDir: dir, host, product: 'YSK' });
    expect(r.mode).toBe('degraded');
    expect(r.productionReady).toBe(false);
    expect(r.items.length).toBeGreaterThan(10);
    expect(r.score.total).toBe(r.items.length);
    expect(
      r.summary.some((s) => /YSK_EXECUTE|Mode|模式|系統變更|degraded|降級|生產/i.test(s)),
    ).toBe(true);
    expect(r.items.some((i) => i.id === 'control-plane')).toBe(true);
    expect(Array.isArray(r.blockers)).toBe(true);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.items.some((i) => i.fixHref === '/system')).toBe(true);
    expect(r.items.some((i) => i.id === 'ops-memory' || i.id === 'ops-disk')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('readinessCategoryLabel maps known and unknown', () => {
    for (const c of READINESS_CATEGORY_ORDER) {
      expect(readinessCategoryLabel(c).length).toBeGreaterThan(0);
    }
    expect(readinessCategoryLabel('unknown-cat')).toBe('unknown-cat');
  });

  it('with ysk.json admin 2fa, password, listen, datadir perms, email, web', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ready2-'));
    try {
      const store = new JsonStore(join(dir, 'ysk.json'));
      store.snapshot.users = [
        {
          id: 'u1',
          username: 'admin',
          password_hash: 'x',
          roles: ['admin'],
          totp_enabled: true,
          must_change_password: false,
          created_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.settings = {
        'security.require_admin_totp': 'true',
        'security.bootstrap_insecure': '0',
        'security.listen_public': '1',
        last_backup_run: JSON.stringify({ at: new Date().toISOString() }),
      };
      store.snapshot.projects = [];
      store.persist();

      mkdirSync(join(dir, 'email'), { recursive: true });
      mkdirSync(join(dir, 'web'), { recursive: true });
      writeFileSync(join(dir, 'web', 'index.html'), '<html></html>', 'utf8');
      try {
        chmodSync(dir, 0o755);
      } catch {
        /* */
      }

      const host = mockHost({
        execute: true,
        root: true,
        services: { nginx: 'active', fail2ban: 'inactive' },
      });
      const r = await assessProductionReadiness({
        dataDir: dir,
        host,
        product: 'YSK Server',
        version: '1.0',
        projects: [
          {
            id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            name: 'Demo',
            linuxUser: 'ysks_a1b2c3d4',
            homeDir: join(dir, 'homes', 'demo'),
            osProvisioned: false,
          },
        ],
        db: {
          snapshot: {
            users: store.snapshot.users,
            projects: [],
            settings: store.snapshot.settings,
            agent_sessions: [
              { status: 'connected' },
              { status: 'registered' },
            ],
          },
        },
        storeKind: 'json',
      });

      expect(r.mode).toBe('production_capable');
      expect(r.items.some((i) => i.id === 'admin-2fa')).toBe(true);
      expect(r.items.some((i) => i.id === 'admin-password')).toBe(true);
      expect(r.items.some((i) => i.id === 'listen-bind')).toBe(true);
      expect(r.items.some((i) => i.id === 'datadir-perms')).toBe(true);
      expect(r.items.some((i) => i.id === 'email-managed')).toBe(true);
      expect(r.items.some((i) => i.id === 'web-ui')).toBe(true);
      expect(r.items.some((i) => i.id === 'state-store')).toBe(true);
      expect(r.items.some((i) => i.id === 'backup-freshness')).toBe(true);
      expect(r.items.some((i) => i.id === 'fleet-sessions')).toBe(true);
      expect(r.items.some((i) => i.category === 'isolation')).toBe(true);
      expect(r.categories).toContain('ops');
      expect(r.summary.length).toBeGreaterThan(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('db G4 backup stale and no sessions; weak admin password', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ready3-'));
    try {
      const store = new JsonStore(join(dir, 'ysk.json'));
      store.snapshot.users = [
        {
          id: 'u1',
          username: 'admin',
          password_hash: 'x',
          roles: ['admin'],
          totp_enabled: false,
          must_change_password: true,
          created_at: new Date().toISOString(),
        },
      ] as never;
      store.snapshot.settings = {
        'security.require_admin_totp': '1',
        'security.bootstrap_insecure': '1',
        'security.listen_public': '0',
        last_backup_run: JSON.stringify({
          at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        }),
      };
      store.persist();

      const host = mockHost({ execute: false, root: false, bins: ['node'] });
      const r = await assessProductionReadiness({
        dataDir: dir,
        host,
        db: {
          snapshot: {
            users: store.snapshot.users,
            projects: [{ id: 'p' }],
            settings: store.snapshot.settings,
            agent_sessions: [],
          },
        },
        storeKind: 'sqlite',
      });
      const bak = r.items.find((i) => i.id === 'backup-freshness');
      expect(bak?.level === 'missing' || bak?.level === 'degraded').toBe(true);
      const fleet = r.items.find((i) => i.id === 'fleet-sessions');
      expect(fleet?.level).toBe('degraded');
      const pwd = r.items.find((i) => i.id === 'admin-password');
      expect(pwd?.level).toBe('missing');
      expect(r.mode).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serviceStatus throw → unknown svc items; missing dataDir control-plane', async () => {
    const host: HostExecutor = {
      ...mockHost({ execute: true, root: true }),
      serviceStatus: async () => {
        throw new Error('no systemctl');
      },
    };
    const r = await assessProductionReadiness({
      dataDir: join(tmpdir(), 'ysk-ready-missing-dir-xyz'),
      host,
    });
    expect(r.items.some((i) => i.id === 'control-plane' && i.level === 'missing')).toBe(true);
    expect(r.items.some((i) => i.id === 'svc-nginx' && i.level === 'unknown')).toBe(true);
  });
});

describe('datadir-perms fixAction', () => {
  it('offers harden-datadir when mode is 755', async () => {
    const dir = join(tmpdir(), `ysk-rdy-dd-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, 0o755);
      const host = mockHost({ execute: true, root: true });
      const r = await assessProductionReadiness({ dataDir: dir, host, product: 'YSK' });
      const item = r.items.find((i) => i.id === 'datadir-perms');
      expect(item).toBeTruthy();
      expect(item?.level).toBe('degraded');
      expect(item?.fixAction).toBe('harden-datadir');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
