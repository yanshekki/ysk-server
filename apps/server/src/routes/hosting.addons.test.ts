/**
 * Coverage for unified addons + latest endpoints.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('hosting runtimes addons/latest', () => {
  let ts: TestServer;

  beforeAll(async () => {
    ts = await startTestServer();
  }, 60_000);

  afterAll(async () => {
    await ts.close();
  });

  it('GET addons for node returns plugins mode', async () => {
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes/addons?kind=node');
    expect(res.status).toBe(200);
    const body = res.body as { mode?: string; items?: unknown[]; defaults?: string[] };
    expect(body.mode).toBe('plugins');
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.defaults)).toBe(true);
  });

  it('GET addons for php returns extensions mode', async () => {
    const res = await apiJson(
      ts,
      'GET',
      '/api/v1/hosting/runtimes/addons?kind=php&version=8.2',
    );
    expect(res.status).toBe(200);
    const body = res.body as { mode?: string; defaults?: string[]; items?: unknown[] };
    expect(body.mode).toBe('extensions');
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.defaults)).toBe(true);
  });

  it('GET latest for node returns panelLatest', async () => {
    const res = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes/latest?kind=node');
    expect(res.status).toBe(200);
    const body = res.body as { panelLatest?: string; kind?: string };
    expect(body.kind).toBe('node');
    expect(body.panelLatest).toBeTruthy();
  });
});
