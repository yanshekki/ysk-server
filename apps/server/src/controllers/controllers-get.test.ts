import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  type TestServer,
} from '../test/harness.js';

/**
 * Broad GET coverage for controller modules (metrics, logs, network, files,
 * resources, system) — no root / EXECUTE required.
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
