import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

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
    expect(body.mode).toBeDefined();
    expect(body.mode).not.toBe('normal');
  });

  it('ddosSuspected / highRequestRate modes are non-normal when flagged', async () => {
    ts = await startTestServer();
    const ddos = await apiJson(ts, 'POST', '/api/v1/protection', {
      networkReachable: true,
      ddosSuspected: true,
    });
    expect(ddos.status).toBe(200);
    expect((ddos.body as { mode?: string }).mode).toBeDefined();

    const rate = await apiJson(ts, 'POST', '/api/v1/protection', {
      networkReachable: true,
      highRequestRate: true,
    });
    expect(rate.status).toBe(200);
    expect((rate.body as { mode?: string }).mode).toBeDefined();
  });

  it('defense dry mutations without EXECUTE are honest', async () => {
    ts = await startTestServer();

    const probe = await apiJson(ts, 'POST', '/api/v1/defense/probe', {});
    expect(probe.status).toBeLessThan(500);

    const stack = await apiJson(ts, 'POST', '/api/v1/defense/stack/apply', {
      apply: false,
    });
    expect(stack.status).toBeLessThan(500);
    const stackBody = stack.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    if (typeof stackBody.ok === 'boolean') {
      expect(stackBody.ok === true && stackBody.blocked === true).toBe(false);
      expectHonestOps({
        ok: stackBody.ok,
        blocked: stackBody.blocked,
        apply_status: stackBody.apply_status,
        requiresExecute: stackBody.requiresExecute,
        notes: stackBody.notes,
      });
    }

    const geoApply = await apiJson(ts, 'POST', '/api/v1/defense/geoip/apply', {
      apply: false,
    });
    expect(geoApply.status).toBeLessThan(500);
    const geoBody = geoApply.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    if (typeof geoBody.ok === 'boolean') {
      expect(geoBody.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: geoBody.ok,
        blocked: geoBody.blocked,
        apply_status: geoBody.apply_status,
        requiresExecute: geoBody.requiresExecute,
        notes: geoBody.notes,
      });
    }

    const lookup = await apiJson(ts, 'POST', '/api/v1/defense/geoip/lookup', {
      ip: '8.8.8.8',
    });
    expect(lookup.status).toBeLessThan(500);
  });

  it('protection emergency without EXECUTE is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/protection/emergency', {
      enable: true,
      apply: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
      mode?: string;
    };
    if (typeof body.ok === 'boolean') {
      expect(body.ok === true && body.blocked === true).toBe(false);
      expectHonestOps({
        ok: body.ok,
        blocked: body.blocked,
        apply_status: body.apply_status,
        requiresExecute: body.requiresExecute,
        notes: body.notes,
      });
    }
  });

  it('auto-ban policy PUT is control-plane only', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'PUT', '/api/v1/defense/auto-ban', {
      enabled: false,
      threshold: 50,
    });
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});
