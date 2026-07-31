import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('public routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('health is public (no auth required)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/health', undefined, {
      auth: false,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      status?: string;
      product?: string;
      version?: string;
      executeEnabled?: boolean;
      isRoot?: boolean;
      mode?: string;
    };
    expect(body.product).toBeTruthy();
    expect(body.version).toBeTruthy();
    expect(typeof body.executeEnabled).toBe('boolean');
    // Honesty: without root+execute, mode is degraded not production_capable
    if (!body.executeEnabled || !body.isRoot) {
      expect(body.mode).toBe('degraded');
    }
  });

  it('status is public when unauthenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/status', undefined, {
      auth: false,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      product?: string;
      version?: string;
      executeEnabled?: boolean;
      tools?: unknown[];
    };
    expect(body.product).toBeTruthy();
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it('readiness responds without auth (install probe)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/readiness', undefined, {
      auth: false,
    });
    // 200 when production ready, 503 when not — both valid honest outcomes
    expect([200, 503]).toContain(res.status);
    const body = res.body as { productionReady?: boolean; notes?: string[] };
    expect(typeof body.productionReady).toBe('boolean');
  });

  it('project health requires auth', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'GET',
      '/api/v1/projects/nonexistent-id/health',
      undefined,
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
