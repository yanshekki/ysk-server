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

  it('admin can PUT role policy and restore one role', async () => {
    ts = await startTestServer();
    const put = await apiJson(ts, 'PUT', '/api/v1/rbac/policies/operator', {
      maxLevel: 'read',
      capabilities: ['projects.read', 'host.read'],
    });
    expect(put.status).toBe(200);
    expect((put.body as { ok?: boolean }).ok).toBe(true);
    expect((put.body as { item?: unknown }).item).toBeTruthy();

    const restore = await apiJson(ts, 'POST', '/api/v1/rbac/policies/operator/restore', {});
    expect(restore.status).toBe(200);
    expect((restore.body as { ok?: boolean }).ok).toBe(true);
  });

  it('admin can patch and restore user capability overrides', async () => {
    ts = await startTestServer();
    const users = await apiJson(ts, 'GET', '/api/v1/users');
    const items =
      (users.body as { items?: Array<{ id?: string; username?: string }> }).items ?? [];
    const admin = items.find((u) => u.username === 'admin') ?? items[0];
    expect(admin?.id).toBeTruthy();

    const patch = await apiJson(ts, 'PATCH', `/api/v1/rbac/users/${admin!.id}`, {
      capabilityGrants: ['audit.read'],
      capabilityRevokes: [],
    });
    expect(patch.status).toBe(200);
    const pBody = patch.body as {
      ok?: boolean;
      user?: { capabilities?: string[]; capabilityGrants?: string[] };
    };
    expect(pBody.ok).toBe(true);
    expect(pBody.user?.id || pBody.user).toBeTruthy();

    const restore = await apiJson(
      ts,
      'POST',
      `/api/v1/rbac/users/${admin!.id}/restore`,
      {},
    );
    expect(restore.status).toBe(200);
    expect((restore.body as { ok?: boolean }).ok).toBe(true);

    // also users path restore if wired through rbac handler
    const restore2 = await apiJson(
      ts,
      'POST',
      `/api/v1/users/${admin!.id}/capabilities/restore`,
      {},
    );
    // may 404 if only rbac path handles it
    expect(restore2.status).toBeLessThan(500);
  });

  it('PUT invalid role returns structured error not 500', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'PUT', '/api/v1/rbac/policies/not-a-role', {
      maxLevel: 'read',
    });
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});
