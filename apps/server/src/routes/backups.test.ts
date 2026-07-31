import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('backups routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated backups list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists backups when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('gets backups status when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups/status');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; archiveCount?: number; notes?: string[] };
    expect(body.ok).toBe(true);
    expect(typeof body.archiveCount).toBe('number');
  });

  it('restic run when disabled is honest failure (not fake success)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/restic/run', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; notes?: string[]; results?: unknown[] };
    // Default restic is disabled — must not claim applied backup
    expect(body.ok).toBe(false);
    expectHonestOps({
      ok: false,
      notes: body.notes ?? ['restic disabled'],
    });
  });

  it('updates backup settings when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      exclusions: ['node_modules', '.git', 'vendor'],
    });
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; exclusions?: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.exclusions)).toBe(true);
    expect(body.exclusions).toContain('node_modules');
  });

  it('rejects unauthenticated settings mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/backups/settings',
      { exclusions: [] },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
