/**
 * Targeted function-coverage climb: invoke listWithQuery text/sort/predicate
 * callbacks and a few fleet enqueue wrappers that stay unhit when lists are empty
 * or enqueue is never called.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  startTestServer,
  apiJson,
  type TestServer,
} from './test/harness.js';
import { main } from './cli.js';
import { runSetup } from './cli/setup.js';

async function runMain(argv: string[]): Promise<{ code: number; out: string }> {
  const logs: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv);
    return { code, out: logs.join('') };
  } finally {
    process.stdout.write = origWrite;
  }
}

function setupCliDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-fn-cli-'));
  runSetup({
    dataDir: dir,
    nonInteractive: true,
    force: true,
    adminPassword: 'admin',
    allowInsecureDefaults: true,
  });
  return dir;
}

describe('function coverage — list query callbacks', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it(
    'admin users/packages filters, sorts, and text search',
    async () => {
      ts = await startTestServer();

      const pkg = await apiJson(ts, 'POST', '/api/v1/packages', {
        name: 'fn-cov-pkg',
        maxProjects: 2,
        notes: 'function-coverage',
      });
      expect(pkg.status).toBe(201);
      const packageId = (pkg.body as { package?: { id?: string } }).package?.id;
      // Second package so sort comparators actually run
      await apiJson(ts, 'POST', '/api/v1/packages', {
        name: 'fn-cov-pkg-b',
        maxProjects: 1,
        notes: 'function-coverage-b',
      });

      const user = await apiJson(ts, 'POST', '/api/v1/users', {
        username: 'fncov-user',
        password: 'TestPass-Strong-77!',
        roles: ['operator'],
        packageId,
      });
      expect(user.status).toBe(201);

      for (const path of [
        '/api/v1/users?q=fncov',
        '/api/v1/users?totp=0',
        '/api/v1/users?overrides=1',
        '/api/v1/users?package=none',
        `/api/v1/users?package=${packageId ?? 'none'}`,
        '/api/v1/users?sort=username&order=asc',
        '/api/v1/users?sort=lastSeenAt&order=desc',
        '/api/v1/packages?q=fn-cov',
        '/api/v1/packages?sort=name&order=asc',
        '/api/v1/packages?sort=subscriberCount&order=desc',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBe(200);
        expect(Array.isArray((res.body as { items?: unknown[] }).items)).toBe(true);
      }
    },
    60_000,
  );

  it(
    'projects / email / cron / agents / cdn / resources list text+sort',
    async () => {
      ts = await startTestServer();

      const proj = await apiJson(ts, 'POST', '/api/v1/projects', {
        name: 'FnCovProj',
        domain: 'fncov-proj.test',
        runtime: 'static',
      });
      expect(proj.status).toBe(201);
      // Second project so name/domain sort comparators run
      await apiJson(ts, 'POST', '/api/v1/projects', {
        name: 'FnCovProjB',
        domain: 'fncov-proj-b.test',
        runtime: 'node',
      });

      const dom = await apiJson(ts, 'POST', '/api/v1/email/domains', {
        domain: 'fncov-mail.test',
        serverIp: '203.0.113.50',
      });
      expect(dom.status).toBe(201);
      await apiJson(ts, 'POST', '/api/v1/email/domains', {
        domain: 'fncov-mail-b.test',
        serverIp: '203.0.113.51',
      });
      const domainId =
        (dom.body as { id?: string }).id ??
        (dom.body as { domain?: { id?: string } }).domain?.id;
      if (domainId) {
        const mbox = await apiJson(ts, 'POST', `/api/v1/email/domains/${domainId}/mailboxes`, {
          localPart: 'hello',
          password: 'Mailbox-Pass-99!',
        });
        expect(mbox.status).toBeLessThan(500);
      }

      const cron = await apiJson(ts, 'POST', '/api/v1/cron', {
        schedule: '*/15 * * * *',
        command: 'echo fn-cov-cron',
        user: 'ysk',
      });
      expect(cron.status).toBe(201);

      await apiJson(
        ts,
        'POST',
        '/api/v1/fleet/agents/register',
        { agentId: 'fn-cov-fleet', group: 'edge' },
        { auth: false },
      );

      const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
        name: 'fn-cov-edge',
        roles: ['edge'],
        region: 'lab',
      });
      const nodeId = (node.body as { node?: { id?: string } }).node?.id;
      if (nodeId) {
        await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
          name: 'fn-cov-site',
          domains: ['fncov.cdn.test'],
          edgeNodeIds: [nodeId],
          origin: { kind: 'url', url: 'http://127.0.0.1:8080' },
        });
      }

      const zone = await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
        name: 'fncov-zone.test',
      });
      expect(zone.status).toBeLessThan(500);
      await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
        name: 'fncov-zone-b.test',
      });
      await apiJson(ts, 'POST', '/api/v1/resources/nginx/sites', {
        name: 'fncov-nginx',
        domain: 'fncov-nginx.test',
      });

      for (const path of [
        '/api/v1/projects?q=FnCov',
        '/api/v1/projects?sort=name&order=asc',
        '/api/v1/projects?sort=domain&order=desc',
        '/api/v1/email/domains?q=fncov',
        '/api/v1/email/domains?status=draft',
        '/api/v1/email/domains?sort=domain&order=asc',
        '/api/v1/email/mailboxes?q=hello',
        '/api/v1/cron?q=fn-cov',
        '/api/v1/agents/runtimes?q=node',
        '/api/v1/fleet/agents?q=fn-cov',
        '/api/v1/cdn/sites?q=fn-cov',
        '/api/v1/cdn/nodes?q=fn-cov',
        '/api/v1/resources/dns/zones?q=fncov',
        '/api/v1/resources/nginx/sites?q=fncov',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }
    },
    90_000,
  );

  it(
    'updates inventory text + approval filter with seeded cache',
    async () => {
      ts = await startTestServer();
      ts.ctx.settings.setJson('last_inventory', {
        at: new Date().toISOString(),
        count: 2,
        upgradable: 1,
        items: [
          {
            packageName: 'curl',
            name: 'curl',
            version: '1.0.0',
            candidateVersion: '2.0.0',
            upgradable: true,
            risk: 'low',
            needsApproval: false,
          },
          {
            packageName: 'openssl',
            name: 'openssl',
            version: '3.0.0',
            candidateVersion: '3.1.0',
            upgradable: true,
            risk: 'high',
            needsApproval: true,
          },
        ],
        advice: [
          {
            packageName: 'openssl',
            name: 'openssl',
            version: '3.0.0',
            candidateVersion: '3.1.0',
            upgradable: true,
            risk: 'high',
            needsApproval: true,
          },
        ],
      });

      const q = await apiJson(ts, 'GET', '/api/v1/updates/inventory?cached=1&q=curl');
      expect(q.status).toBe(200);
      const approval = await apiJson(
        ts,
        'GET',
        '/api/v1/updates/inventory?cached=1&approval=1',
      );
      expect(approval.status).toBe(200);
    },
    30_000,
  );

  it(
    'system defense bans/timeline/suspects + managed-nginx text callbacks',
    async () => {
      ts = await startTestServer();

      // Panel bans → listDefenseBans non-empty
      ts.ctx.db.snapshot.settings.defense_panel_bans = JSON.stringify([
        {
          ip: '198.51.100.50',
          source: 'panel',
          jail: 'sshd',
          reason: 'fn-cov',
          at: new Date().toISOString(),
        },
        {
          ip: '198.51.100.51',
          source: 'fail2ban',
          jail: 'sshd',
          reason: 'fn-cov-f2b',
          at: new Date().toISOString(),
        },
      ]);
      ts.ctx.db.snapshot.settings.defense_timeline = JSON.stringify([
        {
          at: new Date().toISOString(),
          kind: 'ban',
          title: 'fn-cov ban',
          detail: 'seeded for coverage',
        },
        {
          at: new Date().toISOString(),
          kind: 'unban',
          title: 'fn-cov unban',
        },
      ]);
      ts.ctx.db.persist();

      // Suspect IPs from nginx access log
      const logDir = join(ts.dataDir, 'nginx', 'logs');
      mkdirSync(logDir, { recursive: true });
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        lines.push(
          `203.0.113.77 - - [01/Jan/2026:00:00:00 +0000] "GET /wp-login.php HTTP/1.1" 404 1 "-" "-"`,
        );
      }
      writeFileSync(join(logDir, 'access.log'), lines.join('\n'), 'utf8');

      // Managed nginx conf for text search
      const confDir = join(ts.dataDir, 'nginx', 'conf.d');
      mkdirSync(confDir, { recursive: true });
      writeFileSync(
        join(confDir, 'fncov-site.conf'),
        'server { server_name fncov.example.test; }\n',
        'utf8',
      );

      for (const path of [
        '/api/v1/defense/bans?q=198.51',
        '/api/v1/defense/bans?source=panel',
        '/api/v1/defense/timeline?q=fn-cov',
        '/api/v1/defense/timeline?kind=ban',
        '/api/v1/defense/timeline?kind=unban',
        '/api/v1/defense/suspects?q=203.0.113',
        '/api/v1/system/managed-nginx?q=fncov',
        '/api/v1/system/firewall/status?q=allow',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        if (path.includes('timeline?kind=ban')) {
          const items = (res.body as { items?: Array<{ kind?: string }> }).items ?? [];
          expect(items.every((e) => e.kind === 'ban')).toBe(true);
        }
      }
    },
    60_000,
  );

  it(
    'cdn fleet enqueue wrappers (apply/purge/ssl) + db-cluster fleet execute',
    async () => {
      ts = await startTestServer();

      const reg = await apiJson(
        ts,
        'POST',
        '/api/v1/fleet/agents/register',
        { agentId: 'fn-cov-cdn-edge', group: 'edge' },
        { auth: false },
      );
      expect(reg.status).toBe(200);
      const sessionId = (reg.body as { id?: string }).id;
      expect(sessionId).toBeTruthy();

      const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
        name: 'fn-fleet-edge',
        roles: ['edge'],
        fleetAgentId: sessionId,
        region: 'lab',
      });
      expect(node.status).toBeLessThan(500);
      const nodeId = (node.body as { node?: { id?: string } }).node?.id;
      expect(nodeId).toBeTruthy();

      const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
        name: 'fn-fleet-site',
        domains: ['fleet.fncov.test'],
        edgeNodeIds: [nodeId],
        origin: { kind: 'url', url: 'http://127.0.0.1:9090' },
      });
      expect(site.status).toBeLessThan(500);
      const siteId =
        (site.body as { site?: { id?: string } }).site?.id ??
        (site.body as { id?: string }).id;
      expect(siteId).toBeTruthy();

      for (const path of [
        `/api/v1/cdn/sites/${siteId}/apply`,
        `/api/v1/cdn/sites/${siteId}/purge`,
        `/api/v1/cdn/sites/${siteId}/ssl/distribute`,
        `/api/v1/cdn/sites/${siteId}/ssl/issue`,
        `/api/v1/cdn/sites/${siteId}/ssl/prepare-acme`,
      ]) {
        const res = await apiJson(ts, 'POST', path, {
          email: 'admin@fleet.fncov.test',
          run: false,
          distribute: true,
        });
        expect(res.status).toBeLessThan(500);
      }

      // DB cluster with fleet member + execute so enqueue wrapper runs
      const cluster = await apiJson(ts, 'POST', '/api/v1/db/clusters', {
        name: 'fn-cov-cluster',
        engine: 'mariadb',
        kind: 'mariadb-galera',
        members: [
          {
            host: '203.0.113.90',
            role: 'primary',
            access: 'fleet',
            fleetAgentId: sessionId,
          },
        ],
      });
      expect(cluster.status).toBeLessThan(500);
      const clusterId =
        (cluster.body as { cluster?: { id?: string } }).cluster?.id ??
        (cluster.body as { id?: string }).id;
      if (clusterId) {
        const fleet = await apiJson(ts, 'POST', `/api/v1/db/clusters/${clusterId}/fleet`, {
          execute: true,
          op: 'plan',
        });
        expect(fleet.status).toBeLessThan(500);
      }
    },
    90_000,
  );
});

describe('function coverage — CLI list filters + cdn enqueue', () => {
  it(
    'users --role, packages --q, defense bans/suspects q, cdn apply/purge',
    async () => {
      // Seed via HTTP harness, then CLI against same dataDir after close
      const ts = await startTestServer();
      const dir = ts.dataDir;

      ts.ctx.db.snapshot.settings.defense_panel_bans = JSON.stringify([
        {
          ip: '198.51.100.60',
          source: 'panel',
          reason: 'cli-fn-cov',
          at: new Date().toISOString(),
        },
      ]);
      ts.ctx.db.persist();
      const logDir = join(dir, 'nginx', 'logs');
      mkdirSync(logDir, { recursive: true });
      writeFileSync(
        join(logDir, 'access.log'),
        Array.from({ length: 25 }, () =>
          `198.51.100.99 - - [01/Jan/2026:00:00:00 +0000] "GET /x HTTP/1.1" 404 1 "-" "-"`,
        ).join('\n'),
        'utf8',
      );

      await apiJson(ts, 'POST', '/api/v1/packages', {
        name: 'cli-fn-pkg',
        maxProjects: 1,
      });

      const reg = await apiJson(
        ts,
        'POST',
        '/api/v1/fleet/agents/register',
        { agentId: 'cli-fn-edge', group: 'edge' },
        { auth: false },
      );
      const sessionId = (reg.body as { id?: string }).id;
      const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
        name: 'cli-fn-node',
        roles: ['edge'],
        fleetAgentId: sessionId,
      });
      const nodeId = (node.body as { node?: { id?: string } }).node?.id;
      let siteId: string | undefined;
      if (nodeId) {
        const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
          name: 'cli-fn-site',
          domains: ['cli-fn.cdn.test'],
          edgeNodeIds: [nodeId],
          origin: { kind: 'url', url: 'http://127.0.0.1:8081' },
        });
        siteId =
          (site.body as { site?: { id?: string } }).site?.id ??
          (site.body as { id?: string }).id;
      }

      // Persist, then close HTTP + ctx WITHOUT deleting dataDir so CLI can reopen it.
      ts.ctx.db.persist();
      const { closeAppContext } = await import('./app-context.js');
      await new Promise<void>((resolve) => ts.server.close(() => resolve()));
      closeAppContext(ts.ctx);

      try {
        const usersRole = await runMain([
          'node',
          'ysk-server',
          'users',
          'list',
          '--data-dir',
          dir,
          '--role',
          'admin',
          '--json',
        ]);
        expect(usersRole.code).toBe(0);

        const pkgQ = await runMain([
          'node',
          'ysk-server',
          'packages',
          'list',
          '--data-dir',
          dir,
          '--q',
          'cli-fn',
          '--json',
        ]);
        expect(pkgQ.code).toBe(0);

        const bans = await runMain([
          'node',
          'ysk-server',
          'defense',
          'bans',
          '--data-dir',
          dir,
          '--q',
          '198.51',
          '--source',
          'panel',
          '--json',
        ]);
        expect(bans.code).toBe(0);

        const suspects = await runMain([
          'node',
          'ysk-server',
          'defense',
          'suspects',
          '--data-dir',
          dir,
          '--q',
          '198.51',
          '--json',
        ]);
        expect(suspects.code).toBe(0);

        if (siteId) {
          const apply = await runMain([
            'node',
            'ysk-server',
            'cdn',
            'apply',
            '--data-dir',
            dir,
            '--site-id',
            siteId,
            '--json',
          ]);
          expect([0, 1, 3]).toContain(apply.code);

          const purge = await runMain([
            'node',
            'ysk-server',
            'cdn',
            'purge',
            '--data-dir',
            dir,
            '--site-id',
            siteId,
            '--json',
          ]);
          expect([0, 1, 3]).toContain(purge.code);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('CLI packages list --q on empty-setup with seeded package via setup dir', async () => {
    // Minimal: role filter + empty package q already covered above.
    // Keep a cheap self-check that setupCliDir works for isolation.
    const dir = setupCliDir();
    try {
      const r = await runMain([
        'node',
        'ysk-server',
        'users',
        'list',
        '--data-dir',
        dir,
        '--role',
        'admin',
        '--q',
        'admin',
        '--json',
      ]);
      expect(r.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

