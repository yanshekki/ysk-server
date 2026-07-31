import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('health / system / protection (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('public health endpoints do not require auth', async () => {
    ts = await startTestServer();
    for (const path of ['/health', '/api/v1/health']) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBe(200);
      const body = res.body as {
        status?: string;
        version?: string;
        executeEnabled?: boolean;
        mode?: string;
      };
      expect(body.status === 'ok' || body.status === 'degraded').toBe(true);
      expect(body.version).toBeTruthy();
      expect(typeof body.executeEnabled).toBe('boolean');
    }
  });

  it('public status is reachable', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/status', undefined, { auth: false });
    expect(res.status).toBe(200);
    const body = res.body as { product?: string; executeEnabled?: boolean };
    expect(body.product).toBeTruthy();
    expect(typeof body.executeEnabled).toBe('boolean');
  });

  it('rejects unauthenticated protection status', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/protection/status', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('returns protection status when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/protection/status');
    expect(res.status).toBe(200);
    const body = res.body as { protection?: unknown; scheduler?: unknown };
    expect(body.protection).toBeDefined();
    expect(body.scheduler).toBeDefined();
  });

  it('firewall apply without EXECUTE is honest (blocked, not fake applied)', async () => {
    ts = await startTestServer();
    const unauth = await apiJson(
      ts,
      'POST',
      '/api/v1/system/firewall/apply',
      { apply: true },
      { auth: false },
    );
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const res = await apiJson(ts, 'POST', '/api/v1/system/firewall/apply', {
      apply: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    // Without YSK_EXECUTE + root, must not report live apply success
    expect(body.ok === true && body.blocked === true).toBe(false);
    expect(body.apply_status).not.toBe('applied');
    if (body.ok === false || body.blocked === true) {
      expect(
        body.blocked === true ||
          body.requiresExecute === true ||
          body.requiresRoot === true ||
          body.apply_status === 'blocked',
      ).toBe(true);
    }
    expectHonestOps(body);
  });
});
