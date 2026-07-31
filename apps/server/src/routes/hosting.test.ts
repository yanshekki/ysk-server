import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('hosting routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated runtimes list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists hosting runtimes when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes');
    expect(res.status).toBe(200);
    const body = res.body as { supported?: unknown; probe?: unknown };
    expect(body.supported).toBeDefined();
    expect(body.probe).toBeDefined();
  });

  it('nginx status GET when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/nginx');
    expect(res.status).toBe(200);
  });

  it('runtime install plan-only (no install flag) is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/hosting/runtimes/install', {
      kind: 'node',
      version: '20',
      install: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      kind?: string;
      notes?: string[];
      blocked?: boolean;
    };
    expect(typeof body.ok).toBe('boolean');
    if (body.ok === true && Array.isArray(body.notes)) {
      expect(body.notes.join(' ').toLowerCase()).not.toMatch(/installed on host/);
    }
    expectHonestOps({
      ok: body.ok ?? false,
      notes: body.notes,
      blocked: body.blocked,
    });
  });

  it('rejects unauthenticated runtime install', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/hosting/runtimes/install',
      { kind: 'node', install: false },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET php.ini + runtimes tools', async () => {
    ts = await startTestServer();
    const php = await apiJson(ts, 'GET', '/api/v1/hosting/php/ini?version=8.2');
    expect(php.status).toBe(200);

    const tools = await apiJson(ts, 'GET', '/api/v1/runtimes/tools');
    expect(tools.status).toBeLessThan(500);
  });

  it('php.ini save is control-plane write only', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'PUT', '/api/v1/hosting/php/ini', {
      version: '8.2',
      values: { memory_limit: '256M' },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      ok?: boolean;
      written?: string[];
      notes?: string[];
      managedIniPath?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.managedIniPath || (body.written && body.written.length)).toBeTruthy();
  });

  it('php.ini apply without EXECUTE is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/hosting/php/ini/apply', {
      version: '8.2',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.apply_status).not.toBe('applied');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('nginx sync dryRun is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/hosting/nginx/sync', {
      dryRun: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      requiresExecute?: boolean;
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.ok === true && body.blocked === true).toBe(false);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('db probe + mysql-plan + dns plan are plan-only', async () => {
    ts = await startTestServer();
    const probe = await apiJson(ts, 'POST', '/api/v1/hosting/db/probe', {
      host: '127.0.0.1',
      port: 3306,
    });
    expect(probe.status).toBe(200);

    const plan = await apiJson(ts, 'POST', '/api/v1/hosting/db/mysql-plan', {
      dbName: 'appdb',
      username: 'appuser',
      password: 'secret-plan-only',
    });
    expect(plan.status).toBe(200);

    const dns = await apiJson(ts, 'POST', '/api/v1/hosting/dns/plan', {
      zone: 'example.test',
      serverIp: '203.0.113.1',
    });
    expect(dns.status).toBe(200);
  });

  it('dns zone-file write without system apply is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/hosting/dns/zone-file', {
      zone: 'zone-http-test.local',
      serverIp: '203.0.113.40',
      validate: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      written?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    if (body.apply_status === 'applied') expect(body.ok).toBe(true);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('dns zone-files list + zones + powerdns plan-only + cloudflare dry-run', async () => {
    ts = await startTestServer();

    const files = await apiJson(ts, 'GET', '/api/v1/hosting/dns/zone-files');
    expect(files.status).toBe(200);
    expect(Array.isArray((files.body as { items?: unknown[] }).items)).toBe(true);

    const zones = await apiJson(ts, 'GET', '/api/v1/hosting/dns/zones');
    expect(zones.status).toBe(200);

    const pdnsStatus = await apiJson(ts, 'GET', '/api/v1/hosting/dns/powerdns/status');
    expect(pdnsStatus.status).toBeLessThan(500);

    const pdnsInstall = await apiJson(ts, 'POST', '/api/v1/hosting/dns/powerdns/install', {
      install: false,
    });
    expect(pdnsInstall.status).toBeLessThan(500);
    const pi = pdnsInstall.body as { ok?: boolean; notes?: string[] };
    expect(typeof pi.ok).toBe('boolean');
    if (pi.ok === true && Array.isArray(pi.notes)) {
      expect(pi.notes.join(' ').toLowerCase()).not.toMatch(/installed on host/);
    }

    const pdnsLoad = await apiJson(ts, 'POST', '/api/v1/hosting/dns/powerdns/load', {
      zone: 'pdns-depth.local',
      serverIp: '203.0.113.80',
      load: false,
    });
    expect(pdnsLoad.status).toBeLessThan(500);
    const pl = pdnsLoad.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    if (typeof pl.ok === 'boolean') {
      expectHonestOps({
        ok: pl.ok,
        blocked: pl.blocked,
        apply_status: pl.apply_status,
        notes: pl.notes,
      });
    }

    const cf = await apiJson(ts, 'POST', '/api/v1/hosting/dns/cloudflare/apply', {
      zone: 'cf-depth.local',
      serverIp: '203.0.113.81',
      dryRun: true,
    });
    expect(cf.status).toBeLessThan(500);
    const cfb = cf.body as { ok?: boolean; dryRun?: boolean; blocked?: boolean };
    if (typeof cfb.ok === 'boolean') {
      expect(cfb.ok === true && cfb.blocked === true).toBe(false);
    }
  }, 60_000);

  it('firewall plan, public files plan/apply, db provision dry-run honesty', async () => {
    ts = await startTestServer();

    const fw = await apiJson(ts, 'POST', '/api/v1/hosting/firewall/plan', {
      allowSmtp: true,
    });
    expect(fw.status).toBe(200);

    const filesPlan = await apiJson(ts, 'GET', '/api/v1/hosting/files/plan');
    expect(filesPlan.status).toBe(200);

    const filesApply = await apiJson(ts, 'POST', '/api/v1/hosting/files/apply', {
      serverName: 'files-depth.local',
      reload: false,
    });
    expect(filesApply.status).toBeLessThan(500);
    const fa = filesApply.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    if (typeof fa.ok === 'boolean') {
      expectHonestOps({
        ok: fa.ok,
        blocked: fa.blocked,
        apply_status: fa.apply_status,
        notes: fa.notes,
      });
    }

    for (const [path, body] of [
      [
        '/api/v1/hosting/db/redis-provision',
        { projectId: 'shared', dbIndex: 3, execute: false },
      ],
      [
        '/api/v1/hosting/db/postgres-provision',
        {
          dbName: 'depth_pg',
          username: 'depth_pg_u',
          password: 'Pg-Depth-99!',
          execute: false,
        },
      ],
      [
        '/api/v1/hosting/db/mysql-provision',
        {
          dbName: 'depth_my',
          username: 'depth_my_u',
          password: 'My-Depth-99!',
          execute: false,
        },
      ],
    ] as const) {
      const res = await apiJson(ts, 'POST', path, body);
      expect(res.status).toBeLessThan(500);
      const r = res.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
        notes?: string[];
      };
      if (typeof r.ok === 'boolean') {
        // dry-run / no execute must not claim host-applied
        expect(r.apply_status).not.toBe('applied');
        expect(r.ok === true && r.blocked === true).toBe(false);
      }
    }
  }, 60_000);

  it('runtime install kinds plan-only (php/python/go)', async () => {
    ts = await startTestServer();
    for (const kind of ['php', 'python', 'go'] as const) {
      const res = await apiJson(ts, 'POST', '/api/v1/hosting/runtimes/install', {
        kind,
        install: false,
      });
      expect(res.status).toBeLessThan(500);
      const body = res.body as { ok?: boolean; kind?: string };
      expect(typeof body.ok).toBe('boolean');
    }
  });
});
