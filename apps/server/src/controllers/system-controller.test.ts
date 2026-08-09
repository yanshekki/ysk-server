import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('health / system / protection (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('public health endpoints do not require auth', async () => {
    ts = await startTestServer();
    for (const path of ['/health', '/api/v1/health']) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBe(200);
      const body = res.body as {
        status?: string;
        version?: string;
        executeEnabled?: boolean;
        mode?: string;
      };
      expect(body.status === 'ok' || body.status === 'degraded').toBe(true);
      expect(body.version).toBeTruthy();
      expect(typeof body.executeEnabled).toBe('boolean');
    }
  });

  it('public status is reachable', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/status', undefined, { auth: false });
    expect(res.status).toBe(200);
    const body = res.body as { product?: string; executeEnabled?: boolean };
    expect(body.product).toBeTruthy();
    // executeEnabled is authenticated-only (anti-recon)
    expect(body.executeEnabled).toBeUndefined();
  });

  it('rejects unauthenticated protection status', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/protection/status', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('returns protection status when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/protection/status');
    expect(res.status).toBe(200);
    const body = res.body as { protection?: unknown; scheduler?: unknown };
    expect(body.protection).toBeDefined();
    expect(body.scheduler).toBeDefined();
  });

  it('firewall apply without EXECUTE is honest (blocked, not fake applied)', async () => {
    ts = await startTestServer();
    const unauth = await apiJson(
      ts,
      'POST',
      '/api/v1/system/firewall/apply',
      { apply: true },
      { auth: false },
    );
    expect(unauth.status).toBeGreaterThanOrEqual(401);

    const res = await apiJson(ts, 'POST', '/api/v1/system/firewall/apply', {
      apply: true,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      requiresRoot?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(body.ok === true && body.blocked === true).toBe(false);
    expect(body.apply_status).not.toBe('applied');
    if (body.ok === false || body.blocked === true) {
      expect(
        body.blocked === true ||
          body.requiresExecute === true ||
          body.requiresRoot === true ||
          body.apply_status === 'blocked',
      ).toBe(true);
    }
    expectHonestOps(body);
  });

  it('fail2ban apply without EXECUTE is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/system/fail2ban/apply', {
      apply: true,
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

  it('firewall allow-port / enable without EXECUTE are honest', async () => {
    ts = await startTestServer();
    for (const [path, body] of [
      ['/api/v1/system/firewall/allow-port', { port: 8080, proto: 'tcp' }],
      ['/api/v1/system/firewall/enable', {}],
      ['/api/v1/system/firewall/deny', { ip: '203.0.113.200' }],
    ] as const) {
      const res = await apiJson(ts, 'POST', path, body);
      expect(res.status).toBeLessThan(500);
      const r = res.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
      };
      if (typeof r.ok === 'boolean') {
        expect(r.apply_status).not.toBe('applied');
        expect(r.ok === true && r.blocked === true).toBe(false);
      }
    }
  });

  it('host-identity POST dry update is control-plane', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/system/host-identity', {
      displayName: 'test-host-identity',
    });
    expect(res.status).toBeLessThan(500);
  });
});

/**
 * Deep system-controller climb — hit defense / db / firewall / migrate /
 * software / redis / ftps / services honesty paths without EXECUTE/root.
 */
describe('system-controller deep coverage', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it(
    'defense POST/PUT honesty batch (probe/preset/ban/stack/auto-ban/geoip/automation)',
    async () => {
      ts = await startTestServer();

      const probe = await apiJson(ts, 'POST', '/api/v1/defense/probe', {});
      expect(probe.status).toBeLessThan(500);
      expect(probe.status).toBeGreaterThanOrEqual(200);

      for (const preset of ['daily', 'hardened', 'under_attack'] as const) {
        const res = await apiJson(ts, 'POST', '/api/v1/defense/preset', {
          preset,
          apply: false,
        });
        expect(res.status).toBeLessThan(500);
        const b = res.body as { ok?: boolean; apply_status?: string; blocked?: boolean };
        expect(b.apply_status).not.toBe('applied');
        if (typeof b.ok === 'boolean') {
          expectHonestOps({
            ok: b.ok,
            blocked: b.blocked,
            apply_status: b.apply_status,
          });
        }
      }

      const stack = await apiJson(ts, 'POST', '/api/v1/defense/stack/apply', {
        apply: false,
      });
      expect(stack.status).toBeLessThan(500);
      expect((stack.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const ban = await apiJson(ts, 'POST', '/api/v1/defense/ban', {
        ip: '198.51.100.77',
        reason: 'coverage-test',
        apply: false,
      });
      expect(ban.status).toBeLessThan(500);
      expect((ban.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const unban = await apiJson(ts, 'POST', '/api/v1/defense/unban', {
        ip: '198.51.100.77',
        apply: false,
      });
      expect(unban.status).toBeLessThan(500);

      const banBatch = await apiJson(ts, 'POST', '/api/v1/defense/ban-batch', {
        ips: ['198.51.100.10', '198.51.100.11'],
        reason: 'batch',
        apply: false,
      });
      expect(banBatch.status).toBeLessThan(500);

      const autoGet = await apiJson(ts, 'GET', '/api/v1/defense/auto-ban');
      expect(autoGet.status).toBe(200);

      const autoPut = await apiJson(ts, 'PUT', '/api/v1/defense/auto-ban', {
        enabled: false,
        threshold: 50,
      });
      expect(autoPut.status).toBeLessThan(500);

      const wl = await apiJson(ts, 'POST', '/api/v1/defense/whitelist', {
        action: 'add',
        ip: '203.0.113.50',
      });
      expect(wl.status).toBeLessThan(500);

      const wlList = await apiJson(ts, 'POST', '/api/v1/defense/whitelist', {
        action: 'list',
      });
      expect(wlList.status).toBeLessThan(500);

      const tick = await apiJson(ts, 'POST', '/api/v1/defense/auto-ban/tick', {});
      expect(tick.status).toBeLessThan(500);

      const autoCfg = await apiJson(ts, 'GET', '/api/v1/defense/automation');
      expect(autoCfg.status).toBe(200);

      const autoPut2 = await apiJson(ts, 'PUT', '/api/v1/defense/automation', {
        enabled: false,
      });
      expect(autoPut2.status).toBeLessThan(500);

      const intel = await apiJson(ts, 'GET', '/api/v1/defense/intel');
      expect(intel.status).toBeLessThan(500);

      const cf = await apiJson(ts, 'POST', '/api/v1/defense/cloudflare/under-attack', {
        enable: false,
      });
      expect(cf.status).toBeLessThan(500);

      const geoStatus = await apiJson(ts, 'GET', '/api/v1/defense/geoip/status');
      expect(geoStatus.status).toBeLessThan(500);

      const geoPolicy = await apiJson(ts, 'GET', '/api/v1/defense/geoip/policy');
      expect(geoPolicy.status).toBeLessThan(500);

      const geoPut = await apiJson(ts, 'PUT', '/api/v1/defense/geoip/policy', {
        mode: 'off',
        countries: [],
      });
      expect(geoPut.status).toBeLessThan(500);

      const geoLookup = await apiJson(ts, 'POST', '/api/v1/defense/geoip/lookup', {
        ip: '1.1.1.1',
      });
      expect(geoLookup.status).toBeLessThan(500);

      const geoUpdate = await apiJson(ts, 'POST', '/api/v1/defense/geoip/update', {});
      expect(geoUpdate.status).toBeLessThan(500);
      expect((geoUpdate.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const geoApply = await apiJson(ts, 'POST', '/api/v1/defense/geoip/apply', {
        apply: false,
      });
      expect(geoApply.status).toBeLessThan(500);

      const emergency = await apiJson(ts, 'POST', '/api/v1/protection/emergency', {
        enable: false,
      });
      expect(emergency.status).toBeLessThan(500);
    },
    120_000,
  );

  it(
    'firewall + fail2ban extended honesty POSTs',
    async () => {
      ts = await startTestServer();

      for (const [path, body] of [
        ['/api/v1/system/firewall/apply', { apply: false }],
        ['/api/v1/system/firewall/enable', {}],
        ['/api/v1/system/firewall/deny', { ip: '203.0.113.99' }],
        ['/api/v1/system/firewall/delete-deny', { ip: '203.0.113.99' }],
        ['/api/v1/system/firewall/delete-rule', { rule: 'allow 8080/tcp' }],
        ['/api/v1/system/firewall/allow-port', { port: 8443, proto: 'tcp' }],
        ['/api/v1/system/fail2ban/apply', { apply: false }],
        ['/api/v1/system/fail2ban/service', { action: 'status' }],
        ['/api/v1/system/fail2ban/ban', { ip: '198.51.100.88', jail: 'sshd' }],
        ['/api/v1/system/fail2ban/unban', { ip: '198.51.100.88', jail: 'sshd' }],
        ['/api/v1/system/fail2ban/ignoreip', { action: 'add', ip: '127.0.0.1' }],
      ] as const) {
        const res = await apiJson(ts, 'POST', path, body);
        expect(res.status).toBeLessThan(500);
        const b = res.body as { ok?: boolean; apply_status?: string; blocked?: boolean };
        if (typeof b.ok === 'boolean') {
          expect(b.apply_status).not.toBe('applied');
        }
      }

      const banned = await apiJson(ts, 'GET', '/api/v1/system/fail2ban/banned');
      expect(banned.status).toBeLessThan(500);
      const ignore = await apiJson(ts, 'GET', '/api/v1/system/fail2ban/ignoreip');
      expect(ignore.status).toBeLessThan(500);
      const fw = await apiJson(ts, 'GET', '/api/v1/system/firewall/status');
      expect(fw.status).toBeLessThan(500);
    },
    60_000,
  );

  it(
    'db engine status/settings/lifecycle/console honesty',
    async () => {
      ts = await startTestServer();

      for (const eng of ['mysql', 'mariadb', 'postgres', 'redis'] as const) {
        const status = await apiJson(ts, 'GET', `/api/v1/system/db/${eng}/status`);
        expect(status.status).toBeLessThan(500);

        const settings = await apiJson(ts, 'GET', `/api/v1/system/db/${eng}/settings`);
        expect(settings.status).toBeLessThan(500);

        const put = await apiJson(ts, 'PUT', `/api/v1/system/db/${eng}/settings`, {
          values: {},
        });
        expect(put.status).toBeLessThan(500);

        const apply = await apiJson(ts, 'POST', `/api/v1/system/db/${eng}/settings/apply`, {});
        expect(apply.status).toBeLessThan(500);
        expect((apply.body as { apply_status?: string }).apply_status).not.toBe('applied');

        const consoleGet = await apiJson(ts, 'GET', `/api/v1/system/db/${eng}/console`);
        expect(consoleGet.status).toBeLessThan(500);

        const consoleApply = await apiJson(
          ts,
          'POST',
          `/api/v1/system/db/${eng}/console/apply`,
          { sql: 'SELECT 1', dryRun: true },
        );
        expect(consoleApply.status).toBeLessThan(500);

        const lifecycle = await apiJson(ts, 'POST', `/api/v1/system/db/${eng}/lifecycle`, {
          action: 'status',
        });
        expect(lifecycle.status).toBeLessThan(500);

        const install = await apiJson(ts, 'POST', `/api/v1/system/db/${eng}/install`, {
          apply: false,
        });
        expect(install.status).toBeLessThan(500);
        expect((install.body as { apply_status?: string }).apply_status).not.toBe('applied');
      }

      for (const eng of ['mysql', 'mariadb'] as const) {
        const start = await apiJson(ts, 'POST', `/api/v1/system/db/${eng}/start`, {});
        expect(start.status).toBeLessThan(500);
      }
      const redisStart = await apiJson(ts, 'POST', '/api/v1/system/db/redis/start', {});
      expect(redisStart.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'redis keys browser + ftps + software + host power/ntp honesty',
    async () => {
      ts = await startTestServer();

      const keys = await apiJson(ts, 'GET', '/api/v1/system/redis/keys?pattern=*&limit=10');
      expect(keys.status).toBeLessThan(500);

      const keyGet = await apiJson(ts, 'GET', '/api/v1/system/redis/key?key=ysk:coverage');
      expect(keyGet.status).toBeLessThan(500);

      const keyPost = await apiJson(ts, 'POST', '/api/v1/system/redis/key', {
        key: 'ysk:coverage',
        value: 'test',
        ttl: 60,
      });
      expect(keyPost.status).toBeLessThan(500);

      const keyDel = await apiJson(ts, 'DELETE', '/api/v1/system/redis/key?key=ysk:coverage');
      expect(keyDel.status).toBeLessThan(500);

      const ftpsPut = await apiJson(ts, 'PUT', '/api/v1/system/ftps/settings', {
        enabled: false,
        port: 21,
      });
      expect(ftpsPut.status).toBeLessThan(500);

      const ftpsApply = await apiJson(ts, 'POST', '/api/v1/system/ftps/apply', {
        apply: false,
      });
      expect(ftpsApply.status).toBeLessThan(500);
      expect((ftpsApply.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const software = await apiJson(ts, 'GET', '/api/v1/system/software');
      expect(software.status).toBeLessThan(500);
      const items = (software.body as { items?: Array<{ id?: string }> }).items ?? [];
      if (items[0]?.id) {
        const one = await apiJson(ts, 'GET', `/api/v1/system/software/${items[0].id}`);
        expect(one.status).toBeLessThan(500);
        const inst = await apiJson(
          ts,
          'POST',
          `/api/v1/system/software/${items[0].id}/install`,
          { apply: false },
        );
        expect(inst.status).toBeLessThan(500);
        expect((inst.body as { apply_status?: string }).apply_status).not.toBe('applied');
      }

      const upgrades = await apiJson(ts, 'GET', '/api/v1/system/software/upgrades');
      expect(upgrades.status).toBeLessThan(500);
      expect(Array.isArray((upgrades.body as { items?: unknown[] }).items)).toBe(true);
      expect(
        typeof (upgrades.body as { upgradableCount?: number }).upgradableCount,
      ).toBe('number');

      const softInstall = await apiJson(ts, 'POST', '/api/v1/system/software/install', {
        packages: ['curl'],
        install: false,
      });
      expect(softInstall.status).toBeLessThan(500);

      const ntp = await apiJson(ts, 'POST', '/api/v1/system/host/ntp-sync', {});
      expect(ntp.status).toBeLessThan(500);

      const power = await apiJson(ts, 'POST', '/api/v1/system/host/power', {
        action: 'reboot',
        confirm: 'no',
      });
      expect(power.status).toBeLessThan(500);
      expect((power.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const hostId = await apiJson(ts, 'POST', '/api/v1/system/host-identity', {
        displayName: 'coverage-host',
        tags: ['test'],
      });
      expect(hostId.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'nginx site/purge, db dump/import, systemd, services, rebuild, migrate, export',
    async () => {
      ts = await startTestServer();

      const purge = await apiJson(ts, 'POST', '/api/v1/system/nginx/purge-cache', {});
      expect(purge.status).toBeLessThan(500);

      const site = await apiJson(ts, 'POST', '/api/v1/system/nginx/site', {
        name: 'coverage-site',
        domain: 'coverage-nginx.test',
        root: '/var/www/coverage',
        dryRun: true,
      });
      expect(site.status).toBeLessThan(500);

      const dump = await apiJson(ts, 'POST', '/api/v1/system/db/dump', {
        engine: 'mysql',
        database: 'test',
        dryRun: true,
      });
      expect(dump.status).toBeLessThan(500);

      const dumps = await apiJson(ts, 'GET', '/api/v1/system/db/dumps');
      expect(dumps.status).toBeLessThan(500);

      const imp = await apiJson(ts, 'POST', '/api/v1/system/db/import', {
        engine: 'mysql',
        database: 'test',
        file: 'no-such.sql',
        dryRun: true,
      });
      expect(imp.status).toBeLessThan(500);

      const unit = await apiJson(ts, 'POST', '/api/v1/system/systemd/install', {
        unit: 'ysk-server',
        apply: false,
      });
      expect(unit.status).toBeLessThan(500);

      const lifecycle = await apiJson(ts, 'POST', '/api/v1/system/services/lifecycle', {
        unit: 'nginx',
        action: 'status',
      });
      expect(lifecycle.status).toBeLessThan(500);

      const rebuild = await apiJson(ts, 'POST', '/api/v1/system/rebuild', {
        dryRun: true,
        syncNginx: false,
        writeExport: false,
      });
      expect(rebuild.status).toBeLessThan(500);
      const rb = rebuild.body as { ok?: boolean; apply_status?: string; dryRun?: boolean };
      expect(rb.apply_status).not.toBe('applied');

      const inv = await apiJson(ts, 'POST', '/api/v1/system/migrate/inventory', {});
      expect(inv.status).toBeLessThan(500);

      const jobs = await apiJson(ts, 'GET', '/api/v1/system/migrate/jobs');
      expect(jobs.status).toBe(200);

      const jobMiss = await apiJson(ts, 'GET', '/api/v1/system/migrate/jobs/no-such-job');
      expect(jobMiss.status).toBe(404);

      const migDry = await apiJson(ts, 'POST', '/api/v1/system/migrate/jobs', {
        target: 'root@127.0.0.1',
        dryRun: true,
        maintenanceAccepted: true,
      });
      expect(migDry.status).toBeLessThan(500);

      const migNoTarget = await apiJson(ts, 'POST', '/api/v1/system/migrate/jobs', {});
      expect(migNoTarget.status).toBeGreaterThanOrEqual(400);

      const migBlocked = await apiJson(ts, 'POST', '/api/v1/system/migrate/jobs', {
        target: 'root@127.0.0.1',
      });
      expect(migBlocked.status).toBeLessThan(500);
      // without execute or dryRun → blocked/403
      expect([200, 403, 400]).toContain(migBlocked.status);

      const post = await apiJson(ts, 'POST', '/api/v1/system/migrate/post', {
        jobId: 'no-such',
      });
      expect(post.status).toBeLessThan(500);
      expect((post.body as { requiresExecute?: boolean; blocked?: boolean }).blocked ?? true).toBe(
        true,
      );

      const postMissing = await apiJson(ts, 'POST', '/api/v1/system/migrate/post', {});
      expect(postMissing.status).toBe(400);

      const exp = await apiJson(ts, 'GET', '/api/v1/system/export');
      expect(exp.status).toBeLessThan(500);

      const exports = await apiJson(ts, 'GET', '/api/v1/system/exports');
      expect(exports.status).toBeLessThan(500);

      const expMiss = await apiJson(ts, 'GET', '/api/v1/system/exports/no-such-export.json');
      expect(expMiss.status).toBeLessThan(500);

      const nginxList = await apiJson(ts, 'GET', '/api/v1/system/managed-nginx');
      expect(nginxList.status).toBe(200);

      const nginxOne = await apiJson(ts, 'GET', '/api/v1/system/managed-nginx/no-such.conf');
      expect(nginxOne.status).toBeLessThan(500);

      const sslDel = await apiJson(ts, 'DELETE', '/api/v1/system/ssl/certificates/no-such');
      expect(sslDel.status).toBeLessThan(500);

      const le = await apiJson(ts, 'POST', '/api/v1/ssl/letsencrypt', {
        domain: 'coverage-le.test',
        email: 'admin@coverage-le.test',
        run: false,
      });
      expect(le.status).toBeLessThan(500);
      expect((le.body as { apply_status?: string }).apply_status).not.toBe('applied');

      const emailApply = await apiJson(ts, 'POST', '/api/v1/system/email/apply', {
        apply: false,
        domain: 'coverage-mail.test',
      });
      expect(emailApply.status).toBeLessThan(500);

      const sslApply = await apiJson(ts, 'POST', '/api/v1/system/ssl/apply', {
        apply: false,
      });
      expect(sslApply.status).toBeLessThan(500);

      const phpApply = await apiJson(ts, 'POST', '/api/v1/system/php/apply', {
        apply: false,
      });
      expect(phpApply.status).toBeLessThan(500);

      const selfUpdate = await apiJson(ts, 'POST', '/api/v1/updates/self/apply', {
        apply: false,
      });
      expect(selfUpdate.status).toBeLessThan(500);
    },
    120_000,
  );
});
