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

  it('returns empty DDNS status when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/dns/ddns');
    expect(res.status).toBe(200);
    const body = res.body as {
      records?: unknown[];
      settings?: { intervalSeconds?: number; enabled?: boolean };
      hasCloudflareToken?: boolean;
      hasRfc2136Key?: boolean;
      nextRunAt?: string | null;
    };
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.settings?.intervalSeconds).toBeGreaterThanOrEqual(60);
    expect(body.settings?.enabled).not.toBe(false);
    expect(body.hasCloudflareToken).toBe(false);
    expect(body.hasRfc2136Key).toBe(false);
    expect(body.nextRunAt === null || typeof body.nextRunAt === 'string').toBe(true);
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

  it('GET external-checklist when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/dns/external-checklist');
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  it('upserts cluster peer (panel record)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/dns/cluster/peers', {
      host: 'dns-peer.example.com',
      username: 'ysk',
      port: 22,
      label: 'test-peer',
    });
    expect(res.status).toBe(200);
    const body = res.body as { peer?: { id?: string; host?: string } };
    expect(body.peer?.host).toBe('dns-peer.example.com');
    expect(body.peer?.id).toBeTruthy();
  });

  it('cluster reload / probe without peers are honest ops', async () => {
    ts = await startTestServer();
    for (const path of ['/api/v1/dns/cluster/reload', '/api/v1/dns/cluster/probe']) {
      const res = await apiJson(ts, 'POST', path, {});
      expect(res.status).toBeLessThan(500);
      const body = res.body as {
        ok?: boolean;
        apply_status?: string;
        blocked?: boolean;
        notes?: string[];
      };
      expect(typeof body.ok).toBe('boolean');
      expect(body.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: body.ok ?? false,
        apply_status: body.apply_status,
        blocked: body.blocked,
        notes: body.notes,
      });
    }
  });

  it('dns lookup is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/dns/lookup', {
      name: 'localhost',
      type: 'A',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });
});
