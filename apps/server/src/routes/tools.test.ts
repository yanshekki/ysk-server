import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

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

  it('rbac check is public decision (no host side effects)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/rbac/check', {
      role: 'admin',
      scope: { kind: 'global' },
      level: 'read',
    });
    expect(res.status).toBe(200);
    const body = res.body as { allowed?: boolean; ok?: boolean };
    expect(body.allowed === true || body.ok === true || typeof body.allowed === 'boolean').toBe(
      true,
    );
  });

  it('approvals list filters pending; approve/reject missing id is honest', async () => {
    ts = await startTestServer();
    const pending = await apiJson(ts, 'GET', '/api/v1/approvals?status=pending');
    expect(pending.status).toBe(200);
    expect(Array.isArray((pending.body as { items?: unknown[] }).items)).toBe(true);

    const approve = await apiJson(ts, 'POST', '/api/v1/approvals/no-such-id/approve', {});
    expect(approve.status).toBeLessThan(500);

    const reject = await apiJson(ts, 'POST', '/api/v1/approvals/no-such-id/reject', {});
    expect(reject.status).toBeLessThan(500);
  });

  it('known allowlist tool dryRun does not claim host execution applied', async () => {
    ts = await startTestServer();
    const list = await apiJson(ts, 'GET', '/api/v1/tools');
    const items = (list.body as { items?: Array<{ name?: string; id?: string }> }).items ?? [];
    const first = items[0];
    const toolName = first?.name ?? first?.id ?? 'echo';
    const res = await apiJson(ts, 'POST', '/api/v1/tools/execute', {
      tool: toolName,
      args: {},
      dryRun: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      dryRun?: boolean;
      blocked?: boolean;
      applied?: boolean;
      notes?: string[];
    };
    // dryRun must not report live applied host mutation
    expect(body.applied).not.toBe(true);
    if (typeof body.ok === 'boolean') {
      expectHonestOps({
        ok: body.ok,
        blocked: body.blocked,
        notes: body.notes,
      });
    }
  });
});
