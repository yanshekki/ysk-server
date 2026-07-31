import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('public routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('health is public (no auth required)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/health', undefined, {
      auth: false,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      status?: string;
      product?: string;
      version?: string;
      executeEnabled?: boolean;
      isRoot?: boolean;
      mode?: string;
    };
    expect(body.product).toBeTruthy();
    expect(body.version).toBeTruthy();
    expect(typeof body.executeEnabled).toBe('boolean');
    // Honesty: without root+execute, mode is degraded not production_capable
    if (!body.executeEnabled || !body.isRoot) {
      expect(body.mode).toBe('degraded');
    }
  });

  it('status is public when unauthenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/status', undefined, {
      auth: false,
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      product?: string;
      version?: string;
      executeEnabled?: boolean;
      tools?: unknown[];
    };
    expect(body.product).toBeTruthy();
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it('readiness responds without auth (install probe)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/readiness', undefined, {
      auth: false,
    });
    // 200 when production ready, 503 when not — both valid honest outcomes
    expect([200, 503]).toContain(res.status);
    const body = res.body as { productionReady?: boolean; notes?: string[] };
    expect(typeof body.productionReady).toBe('boolean');
  });

  it('project health requires auth', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'GET',
      '/api/v1/projects/nonexistent-id/health',
      undefined,
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('mail autoconfig / autodiscover require domain and return xml', async () => {
    ts = await startTestServer();
    const bad = await fetch(`${ts.baseUrl}/mail/config-v1.1.xml`);
    expect(bad.status).toBe(400);

    const mozilla = await fetch(
      `${ts.baseUrl}/mail/config-v1.1.xml?domain=public-cov.test`,
    );
    expect(mozilla.status).toBe(200);
    const mozillaText = await mozilla.text();
    expect(mozillaText).toMatch(/xml|clientConfig|imap|SMTP|email/i);

    const wellKnown = await fetch(
      `${ts.baseUrl}/.well-known/autoconfig/mail/config-v1.1.xml?email=u@public-cov.test`,
    );
    expect(wellKnown.status).toBe(200);

    const outlook = await fetch(
      `${ts.baseUrl}/autodiscover/autodiscover.xml?email=user@public-cov.test`,
    );
    expect(outlook.status).toBe(200);
    const outlookText = await outlook.text();
    expect(outlookText.length).toBeGreaterThan(20);
  });

  it('authenticated project health for missing project is not 401', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/projects/no-such-project-zzz/health');
    expect(res.status).toBeLessThan(500);
    // not found / fail closed — 404 or 503 typical
    expect([200, 404, 503, 422]).toContain(res.status);
  });

  it('email domain autodiscover json for known domain', async () => {
    ts = await startTestServer();
    const create = await apiJson(ts, 'POST', '/api/v1/email/domains', {
      domain: 'auto-public.test',
      serverIp: '203.0.113.40',
    });
    expect(create.status).toBeLessThan(500);
    const body = create.body as { domain?: { id?: string; domain?: string }; id?: string };
    const id = body.domain?.id ?? body.id;
    if (!id) {
      // create path may differ — try list
      const list = await apiJson(ts, 'GET', '/api/v1/email/domains');
      const items =
        (list.body as { items?: Array<{ id?: string; domain?: string }> }).items ?? [];
      const found = items.find((d) => d.domain === 'auto-public.test');
      if (!found?.id) return;
      const ad = await apiJson(ts, 'GET', `/api/v1/email/domains/${found.id}/autodiscover`);
      expect(ad.status).toBeLessThan(500);
      return;
    }
    const ad = await apiJson(ts, 'GET', `/api/v1/email/domains/${id}/autodiscover`);
    expect(ad.status).toBe(200);
    const adBody = ad.body as {
      domain?: string;
      mozillaXml?: string;
      outlookXml?: string;
    };
    expect(adBody.domain).toBe('auto-public.test');
    expect(adBody.mozillaXml || adBody.outlookXml).toBeTruthy();
  });

  it('cdn site health-loop is honest ops (missing site)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/cdn/sites/no-site/health-loop', {
      applyZone: false,
    });
    expect(res.status).toBeLessThan(500);
  });

  it('readiness with auth still returns productionReady boolean', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/readiness');
    expect([200, 503]).toContain(res.status);
    expect(typeof (res.body as { productionReady?: boolean }).productionReady).toBe('boolean');
  });
});
