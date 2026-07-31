import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('cdn routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated nodes list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/nodes', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists cdn nodes when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/nodes');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[]; meta?: unknown };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists cdn sites when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/cdn/sites');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('upserts a cdn node when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'edge-test-1',
      region: 'test',
      baseUrl: 'https://edge-test.example.com',
      publicIpv4: ['203.0.113.50'],
    });
    expect(res.status).toBe(200);
    const body = res.body as { node?: { id?: string; name?: string } };
    expect(body.node?.name).toBe('edge-test-1');
    expect(body.node?.id).toBeTruthy();
  });

  it('health-loop all with empty sites is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/cdn/health-loop', {
      applyZone: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      results?: unknown[];
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated node create', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/cdn/nodes',
      { name: 'nope' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET dashboard; probe-all is honest ops', async () => {
    ts = await startTestServer();
    const dash = await apiJson(ts, 'GET', '/api/v1/cdn/dashboard');
    expect(dash.status).toBeLessThan(500);

    const probe = await apiJson(ts, 'POST', '/api/v1/cdn/nodes/probe-all', {});
    expect(probe.status).toBeLessThan(500);
    const body = probe.body as {
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

  it('upserts cdn site (panel record) and from-project', async () => {
    ts = await startTestServer();
    // sites require ≥1 edge node id (validation fail-closed)
    const edge = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'edge-for-site',
      region: 'test',
      baseUrl: 'https://edge-for-site.example.com',
      publicIpv4: ['203.0.113.51'],
    });
    expect(edge.status).toBe(200);
    const edgeId = (edge.body as { node?: { id?: string } }).node?.id;
    expect(edgeId).toBeTruthy();

    const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
      name: 'site-http-test',
      domains: ['cdn-test.example.com'],
      origin: { kind: 'url', url: 'https://origin.example.com' },
      edgeNodeIds: [edgeId!],
    });
    expect(site.status).toBe(200);
    const siteBody = site.body as { site?: { id?: string; name?: string } };
    expect(siteBody.site?.name).toBe('site-http-test');
    expect(siteBody.site?.id).toBeTruthy();

    const proj = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'cdn-src-proj',
      domain: 'cdn-src.local',
      runtime: 'static',
    });
    expect(proj.status).toBe(201);
    const projectId =
      (proj.body as { project?: { id?: string } }).project?.id ??
      (proj.body as { id?: string }).id;
    expect(projectId).toBeTruthy();

    const from = await apiJson(ts, 'POST', '/api/v1/cdn/from-project', {
      projectId,
      name: 'from-proj-site',
    });
    expect(from.status).toBeLessThan(500);
    const fromBody = from.body as { ok?: boolean; site?: { id?: string }; created?: boolean };
    if (from.status < 400) {
      expect(fromBody.site?.id || fromBody.ok).toBeTruthy();
    }

    const missing = await apiJson(ts, 'POST', '/api/v1/cdn/from-project', {});
    expect(missing.status).toBe(400);
    expect((missing.body as { ok?: boolean }).ok).toBe(false);
  });

  it('node detail GET after create', async () => {
    ts = await startTestServer();
    const created = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'edge-detail-1',
      baseUrl: 'https://edge-detail.example.com',
    });
    const id = (created.body as { node?: { id?: string } }).node?.id;
    expect(id).toBeTruthy();
    const detail = await apiJson(ts, 'GET', `/api/v1/cdn/nodes/${id}`);
    expect(detail.status).toBeLessThan(500);
  });

  it('upserts node with full optional fields + site domains string form', async () => {
    ts = await startTestServer();
    const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'edge-full-opts',
      baseUrl: 'https://edge-full.example.com',
      fleetAgentId: 'fleet-sess-1',
      sshHost: '127.0.0.1',
      sshPort: '22',
      sshUsername: 'root',
      sshIdentityId: 'id-1',
      remoteNginxConfDir: '/etc/nginx/conf.d',
      roles: ['edge'],
      region: 'lab',
      publicIpv4: '203.0.113.10, 203.0.113.11',
      publicIpv6: '2001:db8::1 2001:db8::2',
      healthUrl: 'https://edge-full.example.com/health',
      weight: '10',
    });
    expect(node.status).toBe(200);
    const nodeId = (node.body as { node?: { id?: string } }).node?.id;
    expect(nodeId).toBeTruthy();

    const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
      name: 'site-str-domains',
      domains: 'a.cdn-cov.test,b.cdn-cov.test',
      edgeNodeIds: nodeId,
      origin: { kind: 'url', url: 'http://127.0.0.1:8080', sni: 'origin.test' },
      mode: 'cdn',
      originShieldNodeId: nodeId,
      dns: { provider: 'manual' },
      cache: { ttl: 60 },
    });
    expect(site.status).toBeLessThan(500);

    const probeAll = await apiJson(ts, 'POST', '/api/v1/cdn/nodes/probe-all', {});
    expect(probeAll.status).toBeLessThan(500);

    const list = await apiJson(ts, 'GET', '/api/v1/cdn/nodes?q=edge-full');
    expect(list.status).toBe(200);
    const sites = await apiJson(ts, 'GET', '/api/v1/cdn/sites?q=site-str');
    expect(sites.status).toBe(200);
  });
});
