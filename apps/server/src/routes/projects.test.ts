import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('projects routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/projects', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists projects when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/projects');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.meta).toBeTruthy();
  });

  it('lists templates and isolation report when authenticated', async () => {
    ts = await startTestServer();
    const templates = await apiJson(ts, 'GET', '/api/v1/templates');
    expect(templates.status).toBe(200);
    expect(Array.isArray((templates.body as { items?: unknown[] }).items)).toBe(true);

    const isolation = await apiJson(ts, 'GET', '/api/v1/projects/isolation');
    expect(isolation.status).toBe(200);
  });

  it('creates a project (panel record) when authenticated', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'test-proj-http',
      domain: 'test-proj.local',
      runtime: 'static',
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      project?: { id?: string; name?: string };
      osProvision?: { attempted?: boolean; ok?: boolean };
    };
    expect(body.project?.name).toBe('test-proj-http');
    expect(body.project?.id).toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/projects');
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ name: string }> }).items;
    expect(items.some((p) => p.name === 'test-proj-http')).toBe(true);
  });

  it('rejects unauthenticated create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/projects',
      { name: 'nope', runtime: 'static' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('provision-all without EXECUTE is honest (not fake success)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/projects/isolation/provision-all', {});
    // 422 when nothing attempted + not ok; still must not claim applied host success
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      attempted?: number;
    };
    expect(body.ok).toBe(false);
    expect(body.attempted).toBe(0);
    expect(body.requiresExecute === true || body.requiresRoot === true).toBe(true);
    expectHonestOps({
      ok: false,
      requiresExecute: body.requiresExecute,
      notes: ['provision-all blocked without execute/root'],
    });
  });
});
