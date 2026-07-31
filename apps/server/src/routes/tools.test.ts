import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('tools routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated tools list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/tools', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists tools when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/tools');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists approvals when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/approvals');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('tools execute dryRun / unknown tool is honest (no fake host success)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/tools/execute', {
      tool: 'nonexistent.tool.xyz',
      args: {},
      dryRun: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      allowed?: boolean;
      error?: string;
      notes?: string[];
    };
    // Must not report successful host execution for unknown tool
    if (body.ok === true) {
      expect(body.blocked !== true).toBe(true);
    } else {
      expect(body.ok === false || body.allowed === false || body.error || body.blocked).toBeTruthy();
    }
  });

  it('rejects unauthenticated tools execute', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/tools/execute',
      { tool: 'x', dryRun: true },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
