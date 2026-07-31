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
    expect(
      body.domain === 'mail-http-test.local' ||
        (body as { domain?: { domain?: string } }).domain,
    ).toBeTruthy();

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

  it('GET relay / queue / mailboxes / sieve / dnsbl last / deliverability overview', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/email/relay',
      '/api/v1/email/queue',
      '/api/v1/email/mailboxes',
      '/api/v1/email/sieve',
      '/api/v1/email/dnsbl/last',
      '/api/v1/email/deliverability/overview',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
      expect(res.status).toBeGreaterThanOrEqual(200);
    }
  });

  it('webmail apply plan-only (no systemInstall) is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/webmail/apply', {
      domain: 'webmail.test.local',
      download: false,
      systemInstall: false,
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
    expect(typeof body.ok).toBe('boolean');
    if (body.apply_status === 'applied') expect(body.ok).toBe(true);
    expect(body.ok === true && body.blocked === true).toBe(false);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('dovecot-passdb all without host install is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/dovecot-passdb/all', {});
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

  it('bootstrap email without installPackages is honest (not fake applied)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/bootstrap', {
      domain: 'bootstrap-test.local',
      serverIp: '203.0.113.20',
      installPackages: false,
      webmail: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.apply_status).not.toBe('applied');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('queue flush without EXECUTE is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/queue/flush', { all: true });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.ok === true && body.blocked === true).toBe(false);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('warmup plan POST is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/warmup', {
      domain: 'warmup.local',
      dailyLimit: 50,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; notes?: string[]; plan?: unknown };
    expect(typeof body.ok === 'boolean' || body.plan || body.notes).toBeTruthy();
  });

  it('dnsbl check is honest ops shape', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/dnsbl/check', {
      ip: '203.0.113.99',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; listedOn?: unknown; notes?: string[] };
    expect(typeof body.ok).toBe('boolean');
  });
});
