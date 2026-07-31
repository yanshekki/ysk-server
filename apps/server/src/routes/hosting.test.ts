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
});
