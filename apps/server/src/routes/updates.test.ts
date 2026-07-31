import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('updates routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated scheduler list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists scheduler jobs when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler');
    expect(res.status).toBe(200);
    const body = res.body as { jobs?: unknown[] };
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it('returns cached inventory when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/updates/inventory?cached=1');
    expect(res.status).toBe(200);
    const body = res.body as {
      cached?: boolean;
      inventory?: unknown[];
    };
    expect(body.cached).toBe(true);
    expect(Array.isArray(body.inventory)).toBe(true);
  });

  it('apply update without candidate is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'demo-pkg',
      currentVersion: '1.0.0',
      // no candidateVersion → blocked
    });
    expect(res.status).toBe(422);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      applied?: boolean;
      notes?: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.applied).not.toBe(true);
    expectHonestOps({
      ok: false,
      blocked: true,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated apply', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/updates/apply',
      { packageName: 'x', candidateVersion: '2' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
