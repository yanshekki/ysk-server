import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('rbac routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated catalog', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/rbac/catalog', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('returns catalog when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/rbac/catalog');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; items?: unknown[]; roles?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items!.length).toBeGreaterThan(0);
    expect(Array.isArray(body.roles)).toBe(true);
  });

  it('lists policies and defaults for admin', async () => {
    ts = await startTestServer();
    const policies = await apiJson(ts, 'GET', '/api/v1/rbac/policies');
    expect(policies.status).toBe(200);
    expect((policies.body as { ok?: boolean }).ok).toBe(true);
    expect(Array.isArray((policies.body as { items?: unknown[] }).items)).toBe(true);

    const defaults = await apiJson(ts, 'GET', '/api/v1/rbac/defaults');
    expect(defaults.status).toBe(200);
    expect((defaults.body as { ok?: boolean }).ok).toBe(true);
  });

  it('rejects unauthenticated policies read', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/rbac/policies', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('rejects unauthenticated policy mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'PUT',
      '/api/v1/rbac/policies/viewer',
      { maxLevel: 'read' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('admin can restore-all policies', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/rbac/policies/restore-all', {});
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; items?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });
});
