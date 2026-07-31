import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

/**
 * Broad GET + dry POST coverage for controller modules (metrics, logs, network,
 * files, resources, system) — no root / EXECUTE required.
 */
describe('controllers GET (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated controller GETs', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/metrics',
      '/api/v1/logs/overview',
      '/api/v1/network',
      '/api/v1/files?path=.',
      '/api/v1/resources/nginx/sites',
      '/api/v1/system/host',
      '/api/v1/system/software',
      '/api/v1/defense/status',
    ]) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBeGreaterThanOrEqual(401);
    }
  });

  it(
    'metrics GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/metrics',
        '/api/v1/metrics/projects',
        '/api/v1/metrics/processes?limit=10',
        '/api/v1/metrics/top',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    30_000,
  );

  it(
    'logs center GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/logs/overview',
        '/api/v1/logs/sources',
        '/api/v1/logs/journal/units',
        '/api/v1/logs/projects',
        '/api/v1/logs/settings',
        '/api/v1/logs/bookmarks',
        '/api/v1/logs/logrotate',
        '/api/v1/logs/journal/query?lines=20',
        '/api/v1/logs/query?lines=10',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }
    },
    30_000,
  );

  it(
    'network GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/network',
        '/api/v1/network/routes',
        '/api/v1/network/dns',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }
    },
    30_000,
  );

  it('files GETs (public root)', async () => {
    ts = await startTestServer();
    const list = await apiJson(ts, 'GET', '/api/v1/files?path=.&root=public');
    expect(list.status).toBe(200);
    const body = list.body as { items?: unknown[]; root?: string };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.root).toBe('public');

    for (const path of [
      '/api/v1/files/trash',
      '/api/v1/files/shares',
      '/api/v1/files/favorites',
      '/api/v1/files/webdav',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('resources list GETs for managed collections', async () => {
    ts = await startTestServer();
    const prefixes = [
      'nginx/sites',
      'ftp/accounts',
      'mysql/databases',
      'mysql/users',
      'postgres/databases',
      'postgres/users',
      'redis/instances',
      'dns/zones',
      'dns/records',
      'ssl/certs',
    ];
    for (const p of prefixes) {
      const res = await apiJson(ts, 'GET', `/api/v1/resources/${p}`);
      expect(res.status).toBe(200);
      expect(Array.isArray((res.body as { items?: unknown[] }).items)).toBe(true);
    }

    const missing = await apiJson(ts, 'GET', '/api/v1/resources/not-a-collection');
    expect(missing.status).toBe(404);
  });

  it(
    'system panel GETs (host, software, ssl, services, exports)',
    async () => {
      ts = await startTestServer();
      const paths = [
        '/api/v1/system/host',
        '/api/v1/system/host-identity',
        '/api/v1/system/software',
        '/api/v1/system/ssl/certificates',
        '/api/v1/system/systemd/status',
        '/api/v1/system/services/matrix',
        '/api/v1/system/managed-nginx',
        '/api/v1/system/db/dumps',
        '/api/v1/system/exports',
        '/api/v1/system/migrate/jobs',
        '/api/v1/system/ftps/settings',
        '/api/v1/system/ftps/status',
        '/api/v1/system/ftps/options',
        '/api/v1/system/db/mysql/status',
        '/api/v1/system/db/postgres/status',
        '/api/v1/system/db/redis/status',
        '/api/v1/system/db/mysql/settings',
        '/api/v1/system/db/postgres/settings',
        '/api/v1/system/db/redis/settings',
      ];
      for (const path of paths) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    60_000,
  );

  it(
    'defense + protection GETs',
    async () => {
      ts = await startTestServer();
      const paths = [
        '/api/v1/defense/status',
        '/api/v1/defense/bans',
        '/api/v1/defense/timeline',
        '/api/v1/defense/suspects',
        '/api/v1/defense/auto-ban',
        '/api/v1/defense/automation',
        '/api/v1/defense/intel',
        '/api/v1/defense/geoip/status',
        '/api/v1/defense/geoip/policy',
        '/api/v1/protection/status',
        '/api/v1/system/firewall/status',
        '/api/v1/system/fail2ban/status',
        '/api/v1/system/fail2ban/banned',
        '/api/v1/system/fail2ban/ignoreip',
      ];
      for (const path of paths) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    60_000,
  );
});

describe('controllers dry POST (HTTP honesty)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('files mkdir / create-text / write on public root', async () => {
    ts = await startTestServer();
    const mkdir = await apiJson(ts, 'POST', '/api/v1/files/mkdir?root=public', {
      path: 'honesty-dir',
    });
    expect(mkdir.status).toBeLessThan(500);
    expect(mkdir.status).toBeGreaterThanOrEqual(200);

    const create = await apiJson(ts, 'POST', '/api/v1/files/create-text?root=public', {
      path: 'honesty-dir/hello.txt',
      content: 'hello',
    });
    expect(create.status).toBeLessThan(500);

    const write = await apiJson(ts, 'PUT', '/api/v1/files/write?root=public', {
      path: 'honesty-dir/hello.txt',
      content: 'updated',
    });
    expect(write.status).toBeLessThan(500);

    const fav = await apiJson(ts, 'POST', '/api/v1/files/favorites/toggle', {
      path: 'honesty-dir/hello.txt',
      root: 'public',
    });
    expect(fav.status).toBeLessThan(500);
  });

  it('logs bookmarks + settings dry mutations', async () => {
    ts = await startTestServer();
    const bookmark = await apiJson(ts, 'POST', '/api/v1/logs/bookmarks', {
      name: 'test-bm',
      query: 'error',
    });
    expect(bookmark.status).toBeLessThan(500);

    const settings = await apiJson(ts, 'PUT', '/api/v1/logs/settings', {
      retentionDays: 7,
    });
    expect(settings.status).toBeLessThan(500);

    const exportRes = await apiJson(ts, 'POST', '/api/v1/logs/export', {
      lines: 5,
    });
    expect(exportRes.status).toBeLessThan(500);
  });

  it('network dns test is dry-safe', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/network/dns/test', {
      name: 'localhost',
    });
    expect(res.status).toBeLessThan(500);
  });

  it('metrics process signal/renice without execute is honest', async () => {
    ts = await startTestServer();
    const signal = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      pid: 1,
      signal: '0',
    });
    expect(signal.status).toBeLessThan(500);
    const sigBody = signal.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    if (typeof sigBody.ok === 'boolean') {
      expect(sigBody.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: sigBody.ok,
        blocked: sigBody.blocked,
        requiresExecute: sigBody.requiresExecute,
        apply_status: sigBody.apply_status,
        notes: sigBody.notes,
      });
    }

    const renice = await apiJson(ts, 'POST', '/api/v1/metrics/processes/renice', {
      pid: 1,
      nice: 0,
    });
    expect(renice.status).toBeLessThan(500);
  });

  it('system dry POSTs without EXECUTE are honest', async () => {
    ts = await startTestServer();
    const endpoints: Array<{ path: string; body?: unknown }> = [
      { path: '/api/v1/system/fail2ban/apply', body: { apply: false } },
      { path: '/api/v1/system/ftps/apply', body: { apply: false } },
      { path: '/api/v1/system/db/postgres/settings/apply', body: {} },
      { path: '/api/v1/system/db/redis/settings/apply', body: {} },
      { path: '/api/v1/system/email/apply', body: { apply: false } },
      { path: '/api/v1/system/ssl/apply', body: { apply: false } },
      { path: '/api/v1/system/php/apply', body: { apply: false } },
      { path: '/api/v1/system/software/install', body: { packages: [], install: false } },
      { path: '/api/v1/system/host/ntp-sync', body: {} },
      { path: '/api/v1/system/nginx/purge-cache', body: {} },
      { path: '/api/v1/protection/probe', body: {} },
    ];
    for (const ep of endpoints) {
      const res = await apiJson(ts, 'POST', ep.path, ep.body ?? {});
      expect(res.status).toBeLessThan(500);
      const body = res.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
        notes?: string[];
      };
      if (typeof body.ok === 'boolean') {
        expect(body.ok === true && body.blocked === true).toBe(false);
        if (body.apply_status === 'applied') {
          expect(body.ok).toBe(true);
        }
      }
    }
  }, 90_000);

  it('resources create draft is panel-only', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
      zone: 'resource-test.local',
      serverIp: '203.0.113.60',
    });
    expect(res.status).toBeLessThan(500);
    if (res.status < 400) {
      const body = res.body as {
        item?: { id?: string; apply_status?: string };
        apply_status?: string;
      };
      const st = body.item?.apply_status ?? body.apply_status;
      if (st) expect(st).not.toBe('applied');
    }
  });
});
