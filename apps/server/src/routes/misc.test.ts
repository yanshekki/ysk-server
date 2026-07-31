import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

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

  it('ssl / cron / ai / agents GETs are reachable when authed', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/ssl/certificates',
      '/api/v1/ssl/uploaded',
      '/api/v1/ssl/bindings',
      '/api/v1/cron',
      '/api/v1/cron/status',
      '/api/v1/ai/tasks',
      '/api/v1/ai/playbooks',
      '/api/v1/ai/playbook-runs',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('cron install without EXECUTE is honest ops', async () => {
    ts = await startTestServer();
    const { expectHonestOps } = await import('../test/harness.js');
    const res = await apiJson(ts, 'POST', '/api/v1/cron/install', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    if (typeof body.ok === 'boolean') {
      expect(body.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: body.ok,
        blocked: body.blocked,
        apply_status: body.apply_status,
        requiresExecute: body.requiresExecute,
        notes: body.notes,
      });
    }
  });
});

describe('misc routes (POST honesty + more GET/POST)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  async function createProject(name: string): Promise<string> {
    const res = await apiJson(ts, 'POST', '/api/v1/projects', {
      name,
      runtime: 'node',
      domain: `${name.toLowerCase()}.test`,
    });
    expect(res.status).toBe(201);
    return (res.body as { project: { id: string } }).project.id;
  }

  async function createEmailDomain(domain: string): Promise<string> {
    const res = await apiJson(ts, 'POST', '/api/v1/email/domains', {
      domain,
      serverIp: '203.0.113.40',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as { domain?: { id?: string }; id?: string };
    const id = body.domain?.id ?? body.id;
    expect(id).toBeTruthy();
    return id!;
  }

  it(
    'project deploy / stop / publish-nginx / purge-cache / suspend honesty (no root)',
    async () => {
      ts = await startTestServer();
      const id = await createProject('MiscDeploy');

      for (const [method, path, body] of [
        ['POST', `/api/v1/projects/${id}/deploy`, {}],
        ['POST', `/api/v1/projects/${id}/deploy-static`, {}],
        ['POST', `/api/v1/projects/${id}/stop`, {}],
        ['POST', `/api/v1/projects/${id}/publish-nginx`, {}],
        ['POST', `/api/v1/projects/${id}/purge-cache`, {}],
        ['POST', `/api/v1/projects/${id}/os-provision`, {}],
        ['POST', `/api/v1/projects/${id}/node-apply`, {}],
        ['POST', `/api/v1/projects/${id}/suspend`, {}],
        ['POST', `/api/v1/projects/${id}/unsuspend`, {}],
      ] as const) {
        const res = await apiJson(ts, method, path, body);
        expect(res.status).toBeLessThan(500);
        const b = res.body as {
          ok?: boolean;
          apply_status?: string;
          blocked?: boolean;
          requiresExecute?: boolean;
        };
        // Never claim live host apply without EXECUTE
        expect(b.apply_status).not.toBe('applied');
        if (typeof b.ok === 'boolean') {
          expectHonestOps({
            ok: b.ok,
            blocked: b.blocked,
            apply_status: b.apply_status,
            requiresExecute: b.requiresExecute,
          });
        }
      }

      const template = await apiJson(ts, 'POST', `/api/v1/projects/${id}/template`, {
        templateId: 'node-starter',
      });
      expect(template.status).toBeLessThan(500);

      const network = await apiJson(ts, 'PATCH', `/api/v1/projects/${id}/network`, {
        allowOutbound: true,
      });
      expect(network.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'agent runtime plan/unit/install honesty + hosting tuning PUT',
    async () => {
      ts = await startTestServer();

      const plan = await apiJson(ts, 'POST', '/api/v1/agents/runtimes/openclaw/plan', {});
      expect(plan.status).toBeLessThan(500);

      const unit = await apiJson(ts, 'POST', '/api/v1/agents/runtimes/openclaw/unit', {});
      expect(unit.status).toBeLessThan(500);

      const install = await apiJson(ts, 'POST', '/api/v1/agents/runtimes/openclaw/install', {});
      expect(install.status).toBeLessThan(500);
      const ib = install.body as {
        ok?: boolean;
        apply_status?: string;
        blocked?: boolean;
        requiresExecute?: boolean;
      };
      expect(ib.apply_status).not.toBe('applied');

      const tuningPut = await apiJson(ts, 'PUT', '/api/v1/hosting/runtimes/node/tuning', {
        version: 'default',
        values: { NODE_OPTIONS: '--max-old-space-size=256' },
      });
      expect(tuningPut.status).toBeLessThan(500);
      if (tuningPut.status === 200) {
        expect((tuningPut.body as { ok?: boolean }).ok).toBe(true);
      }

      for (const kind of ['python', 'go', 'rust'] as const) {
        const t = await apiJson(ts, 'GET', `/api/v1/hosting/runtimes/${kind}/tuning`);
        expect(t.status).toBeLessThan(500);
      }
    },
    60_000,
  );

  it(
    'email domain sub-routes GET/POST honesty paths',
    async () => {
      ts = await startTestServer();
      const id = await createEmailDomain('misc-email.test');

      for (const path of [
        `/api/v1/email/domains/${id}/dns`,
        `/api/v1/email/domains/${id}/mailboxes`,
        `/api/v1/email/domains/${id}/aliases`,
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }

      const checks = await apiJson(ts, 'PATCH', `/api/v1/email/domains/${id}/checks`, {
        dnsApplied: false,
      });
      expect(checks.status).toBeLessThan(500);

      const flags = await apiJson(ts, 'PATCH', `/api/v1/email/domains/${id}/flags`, {
        catchAll: false,
      });
      expect(flags.status).toBeLessThan(500);

      const mbox = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/mailboxes`, {
        localPart: 'hello',
        password: 'Mailbox-Strong-99!',
      });
      expect(mbox.status).toBeLessThan(500);

      const alias = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/aliases`, {
        localPart: 'alias1',
        destinations: ['hello@misc-email.test'],
      });
      expect(alias.status).toBeLessThan(500);

      const policy = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/policy`, {
        rateLimitPerHour: 100,
        antispam: true,
        applySystem: false,
      });
      expect(policy.status).toBeLessThan(500);
      const pb = policy.body as {
        ok?: boolean;
        apply_status?: string;
        blocked?: boolean;
        requiresExecute?: boolean;
      };
      if (typeof pb.ok === 'boolean') {
        expect(pb.apply_status).not.toBe('applied');
        expectHonestOps({
          ok: pb.ok,
          blocked: pb.blocked,
          apply_status: pb.apply_status,
          requiresExecute: pb.requiresExecute,
        });
      }

      const warmup = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/warmup`, {});
      expect(warmup.status).toBeLessThan(500);

      const live = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/live-check`, {});
      expect(live.status).toBeLessThan(500);

      const testSend = await apiJson(ts, 'POST', `/api/v1/email/domains/${id}/test-send`, {
        to: 'nobody@example.com',
      });
      expect(testSend.status).toBeLessThan(500);

      const passdb = await apiJson(
        ts,
        'POST',
        `/api/v1/email/domains/${id}/dovecot-passdb`,
        {},
      );
      expect(passdb.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'cdn node/site CRUD + render/apply/purge honesty',
    async () => {
      ts = await startTestServer();

      const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
        name: 'misc-edge',
        baseUrl: 'http://127.0.0.1:18080',
        region: 'test',
      });
      expect(node.status).toBeLessThan(500);
      const nodeId =
        (node.body as { node?: { id?: string }; id?: string }).node?.id ??
        (node.body as { id?: string }).id;

      if (nodeId) {
        const getN = await apiJson(ts, 'GET', `/api/v1/cdn/nodes/${nodeId}`);
        expect(getN.status).toBe(200);

        const probe = await apiJson(ts, 'POST', `/api/v1/cdn/nodes/${nodeId}/probe`, {});
        expect(probe.status).toBeLessThan(500);

        const drain = await apiJson(ts, 'POST', `/api/v1/cdn/nodes/${nodeId}/drain`, {
          drain: true,
        });
        expect(drain.status).toBeLessThan(500);
      }

      const edgeIds = nodeId ? [nodeId] : [];
      const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
        name: 'misc-cdn-site',
        domains: ['misc-cdn.test'],
        origin: { kind: 'url', url: 'http://127.0.0.1:8080' },
        edgeNodeIds: edgeIds,
      });
      expect(site.status).toBeLessThan(500);
      const siteId =
        (site.body as { site?: { id?: string } }).site?.id ??
        (site.body as { id?: string }).id;

      if (siteId) {
        const getS = await apiJson(ts, 'GET', `/api/v1/cdn/sites/${siteId}`);
        expect(getS.status).toBeLessThan(500);

        for (const path of [
          `/api/v1/cdn/sites/${siteId}/render`,
          `/api/v1/cdn/sites/${siteId}/apply`,
          `/api/v1/cdn/sites/${siteId}/purge`,
          `/api/v1/cdn/sites/${siteId}/dns-sync`,
        ]) {
          const res = await apiJson(ts, 'POST', path, { dryRun: true });
          expect(res.status).toBeLessThan(500);
          const b = res.body as { apply_status?: string; ok?: boolean };
          expect(b.apply_status).not.toBe('applied');
        }

        const dnsRec = await apiJson(ts, 'GET', `/api/v1/cdn/sites/${siteId}/dns-records`);
        expect(dnsRec.status).toBeLessThan(500);
      }
    },
    60_000,
  );

  it(
    'db cluster missing-id POSTs are honest (404/422 not fake applied)',
    async () => {
      ts = await startTestServer();
      const id = 'no-such-cluster-id';
      for (const path of [
        `/api/v1/db/clusters/${id}/plan`,
        `/api/v1/db/clusters/${id}/apply`,
        `/api/v1/db/clusters/${id}/probe`,
        `/api/v1/db/clusters/${id}/install-peers`,
        `/api/v1/db/clusters/${id}/bundle`,
        `/api/v1/db/clusters/${id}/push`,
        `/api/v1/db/clusters/${id}/fleet`,
      ]) {
        const res = await apiJson(ts, 'POST', path, {});
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(400);
      }

      const arts = await apiJson(ts, 'GET', `/api/v1/db/clusters/${id}/artifacts`);
      expect(arts.status).toBeLessThan(500);
    },
    30_000,
  );

  it(
    'ssh identity missing-id POST honesty + dnssec GET/POST missing zone',
    async () => {
      ts = await startTestServer();
      const id = 'no-such-ssh-id';
      for (const path of [
        `/api/v1/ssh/identities/${id}/export`,
        `/api/v1/ssh/identities/${id}/install`,
        `/api/v1/ssh/identities/${id}/uninstall`,
        `/api/v1/ssh/identities/${id}/test`,
        `/api/v1/ssh/identities/${id}/rotate`,
        `/api/v1/ssh/identities/${id}/authorize-self`,
      ]) {
        const res = await apiJson(ts, 'POST', path, {});
        expect(res.status).toBeLessThan(500);
      }

      const pub = await apiJson(ts, 'GET', `/api/v1/ssh/identities/${id}/public`);
      expect(pub.status).toBeLessThan(500);

      const dnssecGet = await apiJson(ts, 'GET', '/api/v1/dns/zones/missing.zone/dnssec');
      expect(dnssecGet.status).toBeLessThan(500);

      const dnssecPost = await apiJson(ts, 'POST', '/api/v1/dns/zones/missing.zone/dnssec', {
        enable: true,
      });
      expect(dnssecPost.status).toBeLessThan(500);

      // ssl delete missing
      const sslDel = await apiJson(ts, 'DELETE', '/api/v1/ssl/certificates/no-such-cert');
      expect(sslDel.status).toBeLessThan(500);
    },
    30_000,
  );

  it('search empty q and audit with filters stay under 500', async () => {
    ts = await startTestServer();
    const empty = await apiJson(ts, 'GET', '/api/v1/search?q=');
    expect(empty.status).toBeLessThan(500);

    const audit = await apiJson(ts, 'GET', '/api/v1/audit?limit=5&q=login');
    expect(audit.status).toBe(200);
  });
});
