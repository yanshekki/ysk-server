import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('db routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated temp-users list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/db/temp-users', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists temp-users when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/db/temp-users');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists clusters overview when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/db/clusters/overview');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; items?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('adminer apply without applySystem is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/db/adminer/apply', {
      download: false,
      applySystem: false,
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
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated adminer apply', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/db/adminer/apply',
      { applySystem: false },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists clusters and remote-hosts', async () => {
    ts = await startTestServer();
    const clusters = await apiJson(ts, 'GET', '/api/v1/db/clusters');
    expect(clusters.status).toBe(200);
    expect(Array.isArray((clusters.body as { items?: unknown[] }).items)).toBe(true);

    const hosts = await apiJson(ts, 'GET', '/api/v1/db/remote-hosts');
    expect(hosts.status).toBe(200);
    expect(Array.isArray((hosts.body as { items?: unknown[] }).items)).toBe(true);
  });

  it('upserts remote host (panel record)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/db/remote-hosts', {
      engine: 'mysql',
      label: 'remote-test',
      host: 'db.example.com',
      port: 3306,
      username: 'ro',
    });
    expect(res.status).toBe(200);
    const body = res.body as { host?: { id?: string; host?: string } };
    expect(body.host?.host).toBe('db.example.com');
    expect(body.host?.id).toBeTruthy();
  });

  it('temp-user create without apply is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/db/temp-users', {
      engine: 'mysql',
      database: 'appdb',
      username: 'tmp_ro_test',
      ttlHours: 1,
      apply: false,
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

  it('temp-users expire is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/db/temp-users/expire', {
      dropSystem: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('creates db cluster (panel record)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/db/clusters', {
      name: 'galera-test',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [{ host: '10.0.0.1', role: 'primary' }],
    });
    expect(res.status).toBeLessThan(500);
    if (res.status < 400) {
      const body = res.body as { cluster?: { id?: string; name?: string }; id?: string };
      expect(body.cluster?.name ?? body.id ?? (body as { ok?: boolean }).ok).toBeTruthy();
    }
  });
});
