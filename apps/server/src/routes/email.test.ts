import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('email routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated domains list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/email/domains', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists domains when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/email/domains');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.meta).toBeTruthy();
  });

  it('creates an email domain (panel record) when authenticated', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/email/domains', {
      domain: 'mail-http-test.local',
      serverIp: '203.0.113.10',
    });
    expect(created.status).toBe(201);
    const body = created.body as { domain?: string; id?: string };
    expect(body.domain === 'mail-http-test.local' || (body as { domain?: { domain?: string } }).domain)
      .toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/email/domains');
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ domain?: string }> }).items;
    expect(items.some((d) => d.domain === 'mail-http-test.local')).toBe(true);
  });

  it('relay apply without system apply is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/relay', {
      host: 'smtp.example.com',
      port: 587,
      applySystem: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; blocked?: boolean; apply_status?: string };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps(body);
  });

  it('rejects unauthenticated domain create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/email/domains',
      { domain: 'nope.local', serverIp: '1.1.1.1' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
