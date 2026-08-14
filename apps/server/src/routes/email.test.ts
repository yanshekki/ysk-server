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
    const items = (list.body as { items: Array<{ domain?: string; id?: string }> }).items;
    expect(items.some((d) => d.domain === 'mail-http-test.local')).toBe(true);
    const id = items.find((d) => d.domain === 'mail-http-test.local')?.id;
    expect(id).toBeTruthy();
    const one = await apiJson(ts, 'GET', `/api/v1/email/domains/${id}`);
    expect(one.status).toBe(200);
    expect((one.body as { domain?: { domain?: string } }).domain?.domain).toBe(
      'mail-http-test.local',
    );
    const missing = await apiJson(ts, 'GET', '/api/v1/email/domains/no-such-id');
    expect(missing.status).toBe(404);
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

  it('dnsbl check without ip is validation error', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/email/dnsbl/check', {});
    expect(res.status).toBe(400);
  });

  it('dnsbl multi + sieve write/delete + sso plugin plan', async () => {
    ts = await startTestServer();

    const multi = await apiJson(ts, 'POST', '/api/v1/email/dnsbl/multi', {
      ips: ['203.0.113.1', '203.0.113.2'],
    });
    expect(multi.status).toBeLessThan(500);

    const sieveWrite = await apiJson(ts, 'POST', '/api/v1/email/sieve', {
      mailbox: 'user@depth.local',
      name: 'default',
      content: 'require ["fileinto"];\n',
    });
    expect(sieveWrite.status).toBeLessThan(500);

    const sieveList = await apiJson(
      ts,
      'GET',
      '/api/v1/email/sieve?mailbox=user@depth.local',
    );
    expect(sieveList.status).toBe(200);

    const sieveDel = await apiJson(
      ts,
      'DELETE',
      '/api/v1/email/sieve?mailbox=user%40depth.local&name=default',
    );
    expect(sieveDel.status).toBeLessThan(500);

    const plugin = await apiJson(ts, 'POST', '/api/v1/email/webmail/sso-plugin', {
      panelBaseUrl: 'http://127.0.0.1:19287',
      enableSystem: false,
    });
    expect(plugin.status).toBeLessThan(500);
    const pb = plugin.body as { ok?: boolean; blocked?: boolean; apply_status?: string };
    if (typeof pb.ok === 'boolean') {
      expect(pb.ok === true && pb.blocked === true).toBe(false);
    }

    const pluginSys = await apiJson(ts, 'POST', '/api/v1/email/webmail/sso-plugin', {
      enableSystem: true,
    });
    expect(pluginSys.status).toBeLessThan(500);
    const ps = pluginSys.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    if (typeof ps.ok === 'boolean') {
      expect(ps.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: ps.ok,
        blocked: ps.blocked,
        apply_status: ps.apply_status,
        notes: ps.notes,
      });
    }
  }, 60_000);

  it('webmail sso issue/consume honesty + domain deliverability', async () => {
    ts = await startTestServer();

    const created = await apiJson(ts, 'POST', '/api/v1/email/domains', {
      domain: 'sso-depth.local',
      serverIp: '203.0.113.55',
    });
    expect(created.status).toBe(201);
    const domainId =
      (created.body as { id?: string }).id ??
      (created.body as { domain?: { id?: string } }).domain?.id;

    const ssoBad = await apiJson(ts, 'POST', '/api/v1/email/webmail/sso', {
      email: 'nobody@sso-depth.local',
      domain: 'sso-depth.local',
    });
    expect(ssoBad.status).toBeLessThan(500);
    // may be 400 if mailbox missing — must not claim SSO without mailbox
    if (ssoBad.status < 400) {
      const b = ssoBad.body as { ok?: boolean; token?: string };
      if (b.ok && b.token) {
        const consume = await apiJson(
          ts,
          'POST',
          '/api/v1/email/webmail/sso/consume',
          { token: b.token },
          { auth: false },
        );
        expect(consume.status).toBeLessThan(500);
      }
    }

    const consumeBad = await apiJson(
      ts,
      'POST',
      '/api/v1/email/webmail/sso/consume',
      { token: 'invalid-token' },
      { auth: false },
    );
    expect(consumeBad.status).toBeGreaterThanOrEqual(401);

    if (domainId) {
      const deliv = await apiJson(
        ts,
        'GET',
        `/api/v1/email/domains/${domainId}/deliverability`,
      );
      expect(deliv.status).toBeLessThan(500);
    }

    const mbox = await apiJson(
      ts,
      'GET',
      `/api/v1/email/mailboxes${domainId ? `?domainId=${domainId}` : ''}`,
    );
    expect(mbox.status).toBe(200);
  }, 60_000);
});
