import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('updates routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated scheduler list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists scheduler jobs when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler');
    expect(res.status).toBe(200);
    const body = res.body as { jobs?: unknown[] };
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it('returns cached inventory when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/updates/inventory?cached=1');
    expect(res.status).toBe(200);
    const body = res.body as {
      cached?: boolean;
      inventory?: unknown[];
    };
    expect(body.cached).toBe(true);
    expect(Array.isArray(body.inventory)).toBe(true);
  });

  it('apply update without candidate is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'demo-pkg',
      currentVersion: '1.0.0',
      // no candidateVersion → blocked
    });
    expect(res.status).toBe(422);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      applied?: boolean;
      notes?: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.applied).not.toBe(true);
    expectHonestOps({
      ok: false,
      blocked: true,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated apply', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/updates/apply',
      { packageName: 'x', candidateVersion: '2' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET updates/self is honest about channel check', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/updates/self');
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      currentVersion?: string;
      ok?: boolean;
      notes?: string[];
      checked?: boolean;
      updateAvailable?: boolean;
    };
    expect(body.currentVersion).toBeTruthy();
    // Must not invent a silent success without notes/ok field
    expect(typeof body.ok === 'boolean' || Array.isArray(body.notes)).toBe(true);
  });

  it('apply with candidate but no EXECUTE is honest (not applied)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'curl',
      currentVersion: '1.0.0',
      candidateVersion: '1.0.1',
      risk: 'low',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      applied?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(body.applied).not.toBe(true);
    expect(body.apply_status).not.toBe('applied');
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('same current/candidate is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'demo-pkg',
      currentVersion: '2.0.0',
      candidateVersion: '2.0.0',
    });
    expect(res.status).toBe(422);
    const body = res.body as { ok?: boolean; blocked?: boolean; applied?: boolean };
    expect(body.ok).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.applied).not.toBe(true);
  });
});
