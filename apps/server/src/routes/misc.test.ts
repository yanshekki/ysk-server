import { describe, expect, it, afterEach } from 'vitest';
import { startTestServer, apiJson, type TestServer } from '../test/harness.js';

describe('misc routes (HTTP GET coverage)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  async function createProject(name = 'MiscProj'): Promise<string> {
    const res = await apiJson(ts, 'POST', '/api/v1/projects', {
      name,
      runtime: 'node',
      domain: `${name.toLowerCase()}.test`,
    });
    expect(res.status).toBe(201);
    const body = res.body as { project?: { id?: string } };
    expect(body.project?.id).toBeTruthy();
    return body.project!.id!;
  }

  it('rejects unauthenticated misc GETs', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/search?q=x',
      '/api/v1/system/ips',
      '/api/v1/audit',
      '/api/v1/dashboard/summary',
      '/api/v1/notifications',
      '/api/v1/system/apply-audit',
    ]) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBeGreaterThanOrEqual(401);
    }
  });

  it('search / system ips / audit / dashboard / notifications / apply-audit', async () => {
    ts = await startTestServer();

    const search = await apiJson(ts, 'GET', '/api/v1/search?q=admin');
    expect(search.status).toBe(200);
    expect(Array.isArray((search.body as { items?: unknown[] }).items)).toBe(true);

    const ips = await apiJson(ts, 'GET', '/api/v1/system/ips');
    expect(ips.status).toBe(200);
    expect(Array.isArray((ips.body as { items?: unknown[] }).items)).toBe(true);

    const audit = await apiJson(ts, 'GET', '/api/v1/audit?limit=20');
    expect(audit.status).toBe(200);
    expect(Array.isArray((audit.body as { items?: unknown[] }).items)).toBe(true);

    const dash = await apiJson(ts, 'GET', '/api/v1/dashboard/summary');
    expect(dash.status).toBe(200);
    const d = dash.body as {
      projects?: { total?: number; items?: unknown[] };
      agents?: { items?: unknown[] };
      email?: unknown;
      ops?: unknown;
    };
    expect(d.projects).toBeDefined();
    expect(typeof d.projects?.total).toBe('number');
    expect(Array.isArray(d.agents?.items)).toBe(true);
    expect(d.email).toBeDefined();
    expect(d.ops).toBeDefined();

    const notif = await apiJson(ts, 'GET', '/api/v1/notifications');
    expect(notif.status).toBe(200);

    const applyAudit = await apiJson(ts, 'GET', '/api/v1/system/apply-audit');
    expect(applyAudit.status).toBe(200);
  });

  it('project detail GET paths (status, logs, quota, usage, os-user, php-ini, deploy-history, web-stats)', async () => {
    ts = await startTestServer();
    const id = await createProject('MiscGetProj');

    const getOne = await apiJson(ts, 'GET', `/api/v1/projects/${id}`);
    expect(getOne.status).toBe(200);
    expect((getOne.body as { project?: { id?: string } }).project?.id ?? (getOne.body as { id?: string }).id).toBeTruthy();

    const status = await apiJson(ts, 'GET', `/api/v1/projects/${id}/status`);
    expect(status.status).toBeLessThan(500);

    const logs = await apiJson(ts, 'GET', `/api/v1/projects/${id}/logs`);
    expect(logs.status).toBe(200);
    const logsBody = logs.body as { files?: unknown[]; related?: unknown };
    expect(Array.isArray(logsBody.files)).toBe(true);

    const quota = await apiJson(ts, 'GET', `/api/v1/projects/${id}/quota`);
    expect(quota.status).toBe(200);

    const usage = await apiJson(ts, 'GET', `/api/v1/projects/${id}/usage`);
    expect(usage.status).toBe(200);

    const osUser = await apiJson(ts, 'GET', `/api/v1/projects/${id}/os-user`);
    expect(osUser.status).toBeLessThan(500);

    const phpIni = await apiJson(
      ts,
      'GET',
      `/api/v1/projects/${id}/php-ini?version=8.2`,
    );
    // Node projects still expose php-ini catalog for dual-stack / future PHP
    expect(phpIni.status).toBeLessThan(500);
    if (phpIni.status === 200) {
      const php = phpIni.body as { catalog?: unknown; version?: string };
      expect(php.catalog ?? php.version).toBeTruthy();
    }

    const hist = await apiJson(ts, 'GET', `/api/v1/projects/${id}/deploy-history`);
    expect(hist.status).toBe(200);

    const webStats = await apiJson(ts, 'GET', `/api/v1/projects/${id}/web-stats`);
    expect(webStats.status).toBeLessThan(500);
  });

  it('agent runtime GET and hosting runtime tuning GET', async () => {
    ts = await startTestServer();

    // Catalog kinds: openclaw | hermes | ionclaw
    const runtime = await apiJson(ts, 'GET', '/api/v1/agents/runtimes/openclaw');
    expect(runtime.status).toBe(200);
    expect((runtime.body as { runtime?: unknown }).runtime).toBeDefined();

    const badKind = await apiJson(ts, 'GET', '/api/v1/agents/runtimes/not-a-kind');
    expect(badKind.status).toBeLessThan(500);
    expect(badKind.status).toBeGreaterThanOrEqual(400);

    const tuning = await apiJson(ts, 'GET', '/api/v1/hosting/runtimes/node/tuning');
    expect(tuning.status).toBeLessThan(500);
  });

  it('cdn / db / email / ssh detail GETs return 404 or empty honestly for missing ids', async () => {
    ts = await startTestServer();

    const missing = [
      '/api/v1/cdn/nodes/no-such-node',
      '/api/v1/cdn/sites/no-such-site',
      '/api/v1/db/clusters/no-such-cluster',
      '/api/v1/ssh/identities/no-such-id',
      '/api/v1/email/domains/no-such/dns',
      '/api/v1/email/domains/no-such/mailboxes',
      '/api/v1/email/domains/no-such/aliases',
      '/api/v1/dns/zones/example.test/dnssec',
    ];
    for (const path of missing) {
      const res = await apiJson(ts, 'GET', path);
      // Honest: not 500; typically 404 / 422 / empty payload
      expect(res.status).toBeLessThan(500);
    }
  });
});
