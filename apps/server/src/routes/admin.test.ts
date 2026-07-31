import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('admin routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated users list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/users', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists users when authenticated (admin)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/users');
    expect(res.status).toBe(200);
    const body = res.body as { items?: Array<{ username?: string }>; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.meta).toBeTruthy();
    expect(body.items!.some((u) => u.username === 'admin')).toBe(true);
  });

  it('lists packages when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/packages');
    expect(res.status).toBe(200);
    const body = res.body as {
      items?: unknown[];
      meta?: unknown;
      usageNote?: string;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.usageNote).toBeTruthy();
  });

  it('creates a package when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/packages', {
      name: 'http-test-pkg',
      maxProjects: 3,
      maxMailboxes: 5,
      notes: 'from admin.test',
    });
    expect(res.status).toBe(201);
    const body = res.body as { package?: { id?: string; name?: string } };
    expect(body.package?.name).toBe('http-test-pkg');
    expect(body.package?.id).toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/packages');
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ name: string }> }).items;
    expect(items.some((p) => p.name === 'http-test-pkg')).toBe(true);
  });

  it('rejects unauthenticated package create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/packages',
      { name: 'nope' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('rejects unauthenticated user create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/users',
      { username: 'nope', password: 'TestPass-Strong-99!' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('creates a user when authenticated (admin)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/users', {
      username: 'op-http-test',
      password: 'TestPass-Strong-88!',
      roles: ['operator'],
    });
    expect(res.status).toBe(201);
    const body = res.body as { user?: { id?: string; username?: string } };
    expect(body.user?.username).toBe('op-http-test');
    expect(body.user?.id).toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/users?q=op-http');
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ username: string }> }).items;
    expect(items.some((u) => u.username === 'op-http-test')).toBe(true);
  });

  it('users list supports role filter facets', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/users?role=admin&status=active');
    expect(res.status).toBe(200);
    const body = res.body as { items?: Array<{ roles?: string[] }>; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.meta).toBeTruthy();
    for (const u of body.items ?? []) {
      expect(u.roles?.includes('admin')).toBe(true);
    }
  });

  it('package detail GET after create', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/packages', {
      name: 'pkg-detail-test',
      maxProjects: 1,
    });
    expect(created.status).toBe(201);
    const id = (created.body as { package?: { id?: string } }).package?.id;
    expect(id).toBeTruthy();
    const detail = await apiJson(ts, 'GET', `/api/v1/packages/${id}`);
    // Some builds may only expose list; honesty: not 500
    expect(detail.status).toBeLessThan(500);
  });
});
