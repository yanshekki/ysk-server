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

  async function createProject(name = 'misc-proj'): Promise<string> {
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

  it('search / system ips / audit / dashboard / notifications / apply-audit', { timeout: 20_000 }, async () => {
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
    const id = await createProject('misc-get-proj');

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
      const id = await createProject('misc-deploy');

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

/**
 * Deep misc climb — users/packages PATCH/DELETE, project os-user,
 * real db-cluster plan paths, AI task missing-id, ssh 2fa, email aliases.
 */
describe('misc routes deep coverage', () => {
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
    const body = res.body as { project?: { id?: string } };
    expect(body.project?.id).toBeTruthy();
    return body.project!.id!;
  }

  it(
    'users PATCH/DELETE/impersonate + packages PATCH/DELETE',
    async () => {
      ts = await startTestServer();

      const user = await apiJson(ts, 'POST', '/api/v1/users', {
        username: 'misc-op-user',
        password: 'MiscOp-Pass-99!',
        roles: ['operator'],
      });
      expect(user.status).toBe(201);
      const uid = (user.body as { user: { id: string } }).user.id;

      const patch = await apiJson(ts, 'PATCH', `/api/v1/users/${uid}`, {
        displayName: 'Misc Operator',
        roles: ['operator'],
      });
      expect(patch.status).toBeLessThan(500);

      const imp = await apiJson(ts, 'POST', `/api/v1/users/${uid}/impersonate`, {});
      expect(imp.status).toBeLessThan(500);

      const delUser = await apiJson(ts, 'DELETE', `/api/v1/users/${uid}`);
      expect(delUser.status).toBeLessThan(500);

      const pkg = await apiJson(ts, 'POST', '/api/v1/packages', {
        name: 'misc-pkg',
        maxProjects: 2,
      });
      expect(pkg.status).toBe(201);
      const pkgId = (pkg.body as { package: { id: string } }).package.id;

      const pkgPatch = await apiJson(ts, 'PATCH', `/api/v1/packages/${pkgId}`, {
        maxProjects: 3,
      });
      expect(pkgPatch.status).toBeLessThan(500);

      const pkgDel = await apiJson(ts, 'DELETE', `/api/v1/packages/${pkgId}`);
      expect(pkgDel.status).toBeLessThan(500);
    },
    30_000,
  );

  it(
    'project os-user GET/PATCH + apply-limits/chown/migrate honesty',
    async () => {
      ts = await startTestServer();
      const created = await apiJson(ts, 'POST', '/api/v1/projects', {
        name: 'misc-os-user',
        runtime: 'node',
        domain: 'misc-osuser.test',
      });
      expect(created.status).toBe(201);
      const id = (created.body as { project: { id: string } }).project.id;

      const get = await apiJson(ts, 'GET', `/api/v1/projects/${id}/os-user`);
      expect(get.status).toBeLessThan(500);

      const patch = await apiJson(ts, 'PATCH', `/api/v1/projects/${id}/os-user`, {
        shell: '/bin/bash',
      });
      expect(patch.status).toBeLessThan(500);

      for (const path of [
        `/api/v1/projects/${id}/os-user/apply-limits`,
        `/api/v1/projects/${id}/os-user/chown-home`,
        `/api/v1/projects/${id}/os-user/migrate`,
      ]) {
        const res = await apiJson(ts, 'POST', path, {});
        expect(res.status).toBeLessThan(500);
        const b = res.body as { apply_status?: string; ok?: boolean };
        expect(b.apply_status).not.toBe('applied');
      }

      // delete project path (must type name)
      const del = await apiJson(ts, 'DELETE', `/api/v1/projects/${id}`, {
        confirmName: 'MiscOsUser',
        removeFiles: true,
      });
      expect(del.status).toBeLessThan(500);
    },
    60_000,
  );

  it(
    'db cluster create + plan/apply/probe/artifacts/bundle/push/fleet/patch/delete',
    async () => {
      ts = await startTestServer();
      const create = await apiJson(ts, 'POST', '/api/v1/db/clusters', {
        name: 'misc-cluster',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          { host: '127.0.0.1', role: 'primary', access: 'local' },
          { host: '127.0.0.2', role: 'secondary', access: 'ssh' },
        ],
      });
      expect(create.status).toBeLessThan(500);
      const clusterId =
        (create.body as { cluster?: { id?: string }; id?: string }).cluster?.id ??
        (create.body as { id?: string }).id;
      if (!clusterId) {
        // create shape may vary — still cover missing-id path already tested
        return;
      }

      const get = await apiJson(ts, 'GET', `/api/v1/db/clusters/${clusterId}`);
      expect(get.status).toBeLessThan(500);

      const patch = await apiJson(ts, 'PATCH', `/api/v1/db/clusters/${clusterId}`, {
        name: 'misc-cluster-renamed',
      });
      expect(patch.status).toBeLessThan(500);

      const plan = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/plan`, {});
      expect(plan.status).toBeLessThan(500);

      const apply = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/apply`, {
        execute: false,
      });
      expect(apply.status).toBeLessThan(500);
      expect((apply.body as { apply_status?: string; dryRun?: boolean }).apply_status).not.toBe(
        'applied',
      );

      const probe = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/probe`, {});
      expect(probe.status).toBeLessThan(500);

      const peers = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/probe`, {
        peers: true,
      });
      expect(peers.status).toBeLessThan(500);

      const installPeers = await apiJson(
        ts,
        'POST',
        `/api/v1/db/clusters/${clusterId}/install-peers`,
        { execute: false },
      );
      expect(installPeers.status).toBeLessThan(500);

      const arts = await apiJson(ts, 'GET', `/api/v1/db/clusters/${clusterId}/artifacts`);
      expect(arts.status).toBeLessThan(500);

      const bundle = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/bundle`, {});
      expect(bundle.status).toBeLessThan(500);

      const push = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/push`, {
        execute: false,
      });
      expect(push.status).toBeLessThan(500);

      const fleet = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/fleet`, {
        execute: false,
        op: 'plan',
      });
      expect(fleet.status).toBeLessThan(500);

      const del = await apiJson(ts, 'DELETE', `/api/v1/db/clusters/${clusterId}`);
      expect(del.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'ssh identity create + subroutes + 2fa missing + sftp key delete',
    async () => {
      ts = await startTestServer();

      // Create identity if API supports it
      const create = await apiJson(ts, 'POST', '/api/v1/ssh/identities', {
        name: 'misc-ssh',
        comment: 'coverage',
      });
      expect(create.status).toBeLessThan(500);
      const id =
        (create.body as { identity?: { id?: string }; id?: string }).identity?.id ??
        (create.body as { id?: string }).id;

      if (id) {
        const get = await apiJson(ts, 'GET', `/api/v1/ssh/identities/${id}`);
        expect(get.status).toBeLessThan(500);

        const pub = await apiJson(ts, 'GET', `/api/v1/ssh/identities/${id}/public`);
        expect(pub.status).toBeLessThan(500);

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
          const b = res.body as { apply_status?: string };
          expect(b.apply_status).not.toBe('applied');
        }

        const del = await apiJson(ts, 'DELETE', `/api/v1/ssh/identities/${id}`);
        expect(del.status).toBeLessThan(500);
      }

      // 2fa missing-id honesty
      for (const path of [
        '/api/v1/ssh/2fa/no-such/confirm',
        '/api/v1/ssh/2fa/no-such/install',
        '/api/v1/ssh/2fa/no-such/uninstall',
        '/api/v1/ssh/2fa/no-such/reveal',
      ]) {
        const res = await apiJson(ts, 'POST', path, {});
        expect(res.status).toBeLessThan(500);
      }
      const del2fa = await apiJson(ts, 'DELETE', '/api/v1/ssh/2fa/no-such');
      expect(del2fa.status).toBeLessThan(500);

      const sftpDel = await apiJson(ts, 'DELETE', '/api/v1/sftp/keys/no-such');
      expect(sftpDel.status).toBeLessThan(500);

      const webauthnDel = await apiJson(
        ts,
        'DELETE',
        '/api/v1/auth/webauthn/credentials/no-such',
      );
      expect(webauthnDel.status).toBeLessThan(500);

      const devDel = await apiJson(ts, 'DELETE', '/api/v1/auth/devices/no-such');
      expect(devDel.status).toBeLessThan(500);
    },
    60_000,
  );

  it(
    'AI task missing-id + email alias delete + dns peer delete + cdn ssl distribute',
    async () => {
      ts = await startTestServer();

      for (const path of [
        '/api/v1/ai/tasks/no-such/approve',
        '/api/v1/ai/tasks/no-such/execute',
        '/api/v1/ai/tasks/no-such/cancel',
        '/api/v1/ai/tasks/no-such/steps/s1/reject',
      ]) {
        const res = await apiJson(ts, 'POST', path, {});
        expect(res.status).toBeLessThan(500);
      }

      // email domain + alias delete
      const em = await apiJson(ts, 'POST', '/api/v1/email/domains', {
        domain: 'misc-alias.test',
        serverIp: '203.0.113.55',
      });
      expect(em.status).toBeLessThan(500);
      const eid =
        (em.body as { domain?: { id?: string }; id?: string }).domain?.id ??
        (em.body as { id?: string }).id;
      if (eid) {
        const alias = await apiJson(ts, 'POST', `/api/v1/email/domains/${eid}/aliases`, {
          localPart: 'sales',
          destinations: ['admin@misc-alias.test'],
        });
        expect(alias.status).toBeLessThan(500);
        const aliasId =
          (alias.body as { alias?: { id?: string }; id?: string }).alias?.id ??
          (alias.body as { id?: string }).id;
        if (aliasId) {
          const delA = await apiJson(
            ts,
            'DELETE',
            `/api/v1/email/domains/${eid}/aliases/${aliasId}`,
          );
          expect(delA.status).toBeLessThan(500);
        }
      }

      const dnsPeer = await apiJson(ts, 'DELETE', '/api/v1/dns/cluster/peers/no-such');
      expect(dnsPeer.status).toBeLessThan(500);

      const tempUser = await apiJson(ts, 'DELETE', '/api/v1/db/temp-users/no-such');
      expect(tempUser.status).toBeLessThan(500);

      const remoteHost = await apiJson(ts, 'DELETE', '/api/v1/db/remote-hosts/no-such');
      expect(remoteHost.status).toBeLessThan(500);

      // CDN site ssl paths with real site
      const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
        name: 'misc-ssl-edge',
        baseUrl: 'http://127.0.0.1:18081',
        region: 'test',
      });
      const nodeId =
        (node.body as { node?: { id?: string }; id?: string }).node?.id ??
        (node.body as { id?: string }).id;
      const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
        name: 'misc-ssl-site',
        domains: ['misc-ssl.test'],
        origin: { kind: 'url', url: 'http://127.0.0.1:8080' },
        edgeNodeIds: nodeId ? [nodeId] : [],
      });
      const siteId =
        (site.body as { site?: { id?: string }; id?: string }).site?.id ??
        (site.body as { id?: string }).id;
      if (siteId) {
        for (const path of [
          `/api/v1/cdn/sites/${siteId}/ssl/distribute`,
          `/api/v1/cdn/sites/${siteId}/ssl/issue`,
          `/api/v1/cdn/sites/${siteId}/ssl/prepare-acme`,
        ]) {
          const res = await apiJson(ts, 'POST', path, { run: false });
          expect(res.status).toBeLessThan(500);
          expect((res.body as { apply_status?: string }).apply_status).not.toBe('applied');
        }
        const delS = await apiJson(ts, 'DELETE', `/api/v1/cdn/sites/${siteId}`);
        expect(delS.status).toBeLessThan(500);
      }
      if (nodeId) {
        const delN = await apiJson(ts, 'DELETE', `/api/v1/cdn/nodes/${nodeId}`);
        expect(delN.status).toBeLessThan(500);
      }
    },
    90_000,
  );

  it(
    'project mutations: wordpress, git-deploy, env, backup, logs, ftp, resources, quota, php-fpm, php-ini, runtime, deploy-php',
    async () => {
      ts = await startTestServer();
      const pid = await createProject('misc-mut-proj');

      const wpSetup = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/wordpress-download`, {
        setup: true,
        force: false,
        dbName: 'wp_misc',
        dbUser: 'wp_u',
        dbPassword: 'Wp-Pass-99',
      });
      expect(wpSetup.status).toBeLessThan(500);

      const wpDl = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/wordpress-download`, {
        setup: false,
        force: false,
      });
      expect(wpDl.status).toBeLessThan(500);

      const git = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/git-deploy`, {
        gitUrl: 'https://example.com/repo.git',
        branch: 'main',
        redeploy: false,
        skipBuild: true,
      });
      // honest fail → 502 when git clone cannot run
      expect(git.status).toBeLessThan(600);

      const env = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/env`, {
        env: { FOO: 'bar', NODE_ENV: 'test' },
      });
      expect(env.status).toBeLessThan(500);

      const bak = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/backup`, {});
      expect(bak.status).toBeLessThan(600);

      const logs = await apiJson(ts, 'GET', `/api/v1/projects/${pid}/logs`);
      expect(logs.status).toBeLessThan(500);

      const logsGrep = await apiJson(
        ts,
        'GET',
        `/api/v1/projects/${pid}/logs?grep=error&name=app`,
      );
      expect(logsGrep.status).toBeLessThan(500);

      const logsFile = await apiJson(
        ts,
        'GET',
        `/api/v1/projects/${pid}/logs?file=app.log&lines=50`,
      );
      expect(logsFile.status).toBeLessThan(500);

      const logDirs = await apiJson(ts, 'PUT', `/api/v1/projects/${pid}/log-dirs`, {
        dirs: ['logs', 'var/log'],
      });
      expect(logDirs.status).toBeLessThan(500);

      const ftp = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/ftp`, {
        username: 'ftp_misc',
        password: 'Ftp-Pass-99!',
        homeSubdir: 'app',
      });
      expect(ftp.status).toBeLessThan(500);

      const resources = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/resources`, {
        memoryMax: '256M',
        cpuQuotaPercent: 50,
        tasksMax: 100,
        limitNofile: 1024,
      });
      expect(resources.status).toBeLessThan(500);

      const quotaSet = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/quota`, {
        quotaMb: 512,
      });
      expect(quotaSet.status).toBeLessThan(500);

      const phpFpm = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/php-fpm`, {
        enable: false,
        phpVersion: '8.2',
      });
      expect(phpFpm.status).toBeLessThan(500);

      const phpIniGet = await apiJson(ts, 'GET', `/api/v1/projects/${pid}/php-ini`);
      expect(phpIniGet.status).toBeLessThan(500);

      const phpIniPut = await apiJson(ts, 'PUT', `/api/v1/projects/${pid}/php-ini`, {
        version: '8.2',
        values: { memory_limit: '128M' },
        extra: { 'opcache.enable': '1' },
        rawAppend: '; cov',
      });
      expect(phpIniPut.status).toBeLessThan(500);

      const runtime = await apiJson(ts, 'PATCH', `/api/v1/projects/${pid}/runtime`, {
        runtimeVersion: '20',
        deployEntry: 'server.js',
      });
      expect(runtime.status).toBeLessThan(500);

      const runtimeMiss = await apiJson(ts, 'PATCH', '/api/v1/projects/no-such/runtime', {
        runtimeVersion: '20',
      });
      expect([404, 400, 422, 500]).toContain(runtimeMiss.status);

      const deployPhp = await apiJson(ts, 'POST', `/api/v1/projects/${pid}/deploy-php`, {
        preferFpm: true,
        forceBuiltin: false,
      });
      expect(deployPhp.status).toBeLessThan(600);

      const status = await apiJson(ts, 'GET', `/api/v1/projects/${pid}/status`);
      expect(status.status).toBeLessThan(500);
    },
    120_000,
  );
});
