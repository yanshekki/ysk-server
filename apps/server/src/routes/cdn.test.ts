import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('cdn routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated nodes list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/nodes', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists cdn nodes when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/nodes');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists cdn sites when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/sites');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('upserts a cdn node when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'edge-test-1',
      region: 'test',
      baseUrl: 'https://edge-test.example.com',
      publicIpv4: ['203.0.113.50'],
    });
    expect(res.status).toBe(200);
    const body = res.body as { node?: { id?: string; name?: string } };
    expect(body.node?.name).toBe('edge-test-1');
    expect(body.node?.id).toBeTruthy();
  });

  it('health-loop all with empty sites is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/cdn/health-loop', {
      applyZone: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      results?: unknown[];
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated node create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/cdn/nodes',
      { name: 'nope' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
