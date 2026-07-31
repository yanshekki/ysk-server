import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('dns routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated cluster peers list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/dns/cluster/peers', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists dns cluster peers when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/dns/cluster/peers');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('validates DNS records when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/dns/validate', {
      records: [
        { type: 'A', name: '@', value: '203.0.113.1', ttl: 300 },
        { type: 'MX', name: '@', value: '10 mail.example.com', ttl: 300 },
      ],
    });
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; issues?: unknown[] };
    expect(typeof body.ok).toBe('boolean');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('cluster push without peers is honest ops (not fake applied)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/dns/cluster/push', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      apply_status?: string;
      blocked?: boolean;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    // Empty peer set must not claim host apply success
    if (body.apply_status === 'applied') {
      expect(body.ok).toBe(true);
    }
    expectHonestOps({
      ok: body.ok ?? false,
      apply_status: body.apply_status,
      blocked: body.blocked,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated validate', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/dns/validate',
      { records: [] },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
