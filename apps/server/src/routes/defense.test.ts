import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('defense routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated protection set', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/protection',
      { networkReachable: true },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('sets protection state when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/protection', {
      networkReachable: true,
      ddosSuspected: false,
      forceOffline: false,
    });
    expect(res.status).toBe(200);
    const body = res.body as { mode?: string };
    expect(typeof body.mode === 'string' || body.mode === undefined || body).toBeTruthy();
    // Response is ctx.protection — should include mode
    expect((body as { mode?: string }).mode).toBeDefined();
  });

  it('forceOffline protection path updates mode honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/protection', {
      networkReachable: true,
      forceOffline: true,
    });
    expect(res.status).toBe(200);
    const body = res.body as { mode?: string; forceOffline?: boolean };
    // Offline / degraded — must not stay "normal" if forceOffline applied
    expect(body.mode).toBeDefined();
    expect(body.mode).not.toBe('normal');
  });
});
