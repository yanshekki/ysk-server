import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('hosting routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated runtimes list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists hosting runtimes when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes');
    expect(res.status).toBe(200);
    const body = res.body as { supported?: unknown; probe?: unknown };
    expect(body.supported).toBeDefined();
    expect(body.probe).toBeDefined();
  });

  it('nginx status GET when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/nginx');
    expect(res.status).toBe(200);
  });

  it('runtime install plan-only (no install flag) is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/hosting/runtimes/install', {
      kind: 'node',
      version: '20',
      install: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      kind?: string;
      notes?: string[];
      blocked?: boolean;
    };
    expect(typeof body.ok).toBe('boolean');
    // plan path must not claim host install success without install:true
    if (body.ok === true && Array.isArray(body.notes)) {
      expect(body.notes.join(' ').toLowerCase()).not.toMatch(/installed on host/);
    }
    expectHonestOps({
      ok: body.ok ?? false,
      notes: body.notes,
      blocked: body.blocked,
    });
  });

  it('rejects unauthenticated runtime install', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/hosting/runtimes/install',
      { kind: 'node', install: false },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
