import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('projects routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/projects', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists projects when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/projects');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.meta).toBeTruthy();
  });

  it('lists templates and isolation report when authenticated', async () => {
    ts = await startTestServer();
    const templates = await apiJson(ts, 'GET', '/api/v1/templates');
    expect(templates.status).toBe(200);
    expect(Array.isArray((templates.body as { items?: unknown[] }).items)).toBe(true);

    const isolation = await apiJson(ts, 'GET', '/api/v1/projects/isolation');
    expect(isolation.status).toBe(200);
  });

  it('creates a project (panel record) when authenticated', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'test-proj-http',
      domain: 'test-proj.local',
      runtime: 'static',
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      project?: { id?: string; name?: string };
      osProvision?: { attempted?: boolean; ok?: boolean };
    };
    expect(body.project?.name).toBe('test-proj-http');
    expect(body.project?.id).toBeTruthy();

    const list = await apiJson(ts, 'GET', '/api/v1/projects');
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ name: string }> }).items;
    expect(items.some((p) => p.name === 'test-proj-http')).toBe(true);
  });

  it('rejects unauthenticated create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/projects',
      { name: 'nope', runtime: 'static' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('provision-all without EXECUTE is honest (not fake success)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/projects/isolation/provision-all', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      attempted?: number;
    };
    expect(body.ok).toBe(false);
    expect(body.attempted).toBe(0);
    expect(body.requiresExecute === true || body.requiresRoot === true).toBe(true);
    expectHonestOps({
      ok: false,
      requiresExecute: body.requiresExecute,
      notes: ['provision-all blocked without execute/root'],
    });
  });

  it('deploy without EXECUTE is honest (requiresExecute, not fake applied)', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'deploy-honesty',
      domain: 'deploy-honesty.local',
      runtime: 'static',
    });
    expect(created.status).toBe(201);
    const id = (created.body as { project?: { id?: string } }).project?.id;
    expect(id).toBeTruthy();

    const deploy = await apiJson(ts, 'POST', `/api/v1/projects/${id}/deploy`, {
      reload: false,
    });
    expect(deploy.status).toBeLessThan(500);
    const body = deploy.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    // Without EXECUTE, must not claim live host applied
    expect(body.apply_status).not.toBe('applied');
    expect(body.ok === true && body.blocked === true).toBe(false);
    if (body.requiresExecute != null) {
      expect(body.requiresExecute).toBe(true);
    }
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      requiresExecute: body.requiresExecute,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('os-provision without EXECUTE is honest ops', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'os-prov-test',
      domain: 'os-prov.local',
      runtime: 'node',
    });
    const id = (created.body as { project?: { id?: string } }).project?.id!;
    const res = await apiJson(ts, 'POST', `/api/v1/projects/${id}/os-provision`, {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.apply_status).not.toBe('applied');
    expect(
      body.blocked === true ||
        body.requiresExecute === true ||
        body.requiresRoot === true ||
        body.ok === false,
    ).toBe(true);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      requiresExecute: body.requiresExecute,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('wizard create plan is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/wizard/create', {
      projectName: 'wizard-http',
      domain: 'wizard-http.local',
      runtime: 'static',
      createDns: false,
      createMail: false,
      createDb: false,
    });
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

  it('backfill-owners is control-plane only', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/projects/isolation/backfill-owners', {});
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      expect((res.body as { ok?: boolean }).ok).toBe(true);
    }
  });

  it('project list supports runtime filter', async () => {
    ts = await startTestServer();
    await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'filter-static',
      domain: 'filter-static.local',
      runtime: 'static',
    });
    const res = await apiJson(ts, 'GET', '/api/v1/projects?runtime=static');
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ runtime?: string }> }).items;
    expect(Array.isArray(items)).toBe(true);
    for (const p of items) {
      expect(p.runtime).toBe('static');
    }
  });

  it('lists isolation report and templates', async () => {
    ts = await startTestServer();
    const iso = await apiJson(ts, 'GET', '/api/v1/projects/isolation');
    expect(iso.status).toBe(200);

    const tpl = await apiJson(ts, 'GET', '/api/v1/templates');
    expect(tpl.status).toBe(200);
    expect(Array.isArray((tpl.body as { items?: unknown[] }).items)).toBe(true);
  });

  it('creates project with dns zone + mail domain extras', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'ExtrasProj',
      domain: 'extras-proj.test',
      runtime: 'node',
      createDnsZone: true,
      createMailDomain: true,
      serverIp: '203.0.113.77',
      serverIpv6: '2001:db8::77',
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      project?: { id?: string };
      extras?: { dnsZoneId?: string; emailDomainId?: string; notes?: string[] };
    };
    expect(body.project?.id).toBeTruthy();
    expect(body.extras?.dnsZoneId).toBeTruthy();
    expect(body.extras?.emailDomainId).toBeTruthy();
    expect(Array.isArray(body.extras?.notes)).toBe(true);
  });
});
