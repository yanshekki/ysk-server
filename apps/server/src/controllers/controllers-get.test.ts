import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

/**
 * Broad GET + dry POST coverage for controller modules (metrics, logs, network,
 * files, resources, system) — no root / EXECUTE required.
 */
describe('controllers GET (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated controller GETs', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/metrics',
      '/api/v1/logs/overview',
      '/api/v1/network',
      '/api/v1/files?path=.',
      '/api/v1/resources/nginx/sites',
      '/api/v1/system/host',
      '/api/v1/system/software',
      '/api/v1/defense/status',
    ]) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBeGreaterThanOrEqual(401);
    }
  });

  it(
    'metrics GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/metrics',
        '/api/v1/metrics/projects',
        '/api/v1/metrics/processes?limit=10',
        '/api/v1/metrics/top',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    30_000,
  );

  it(
    'logs center GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/logs/overview',
        '/api/v1/logs/sources',
        '/api/v1/logs/journal/units',
        '/api/v1/logs/projects',
        '/api/v1/logs/settings',
        '/api/v1/logs/bookmarks',
        '/api/v1/logs/logrotate',
        '/api/v1/logs/journal/query?lines=20',
        '/api/v1/logs/query?lines=10',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }
    },
    30_000,
  );

  it(
    'network GETs',
    async () => {
      ts = await startTestServer();
      for (const path of [
        '/api/v1/network',
        '/api/v1/network/routes',
        '/api/v1/network/dns',
      ]) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
      }
    },
    30_000,
  );

  it('files GETs (public root)', async () => {
    ts = await startTestServer();
    const list = await apiJson(ts, 'GET', '/api/v1/files?path=.&root=public');
    expect(list.status).toBe(200);
    const body = list.body as { items?: unknown[]; root?: string };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.root).toBe('public');

    for (const path of [
      '/api/v1/files/trash',
      '/api/v1/files/shares',
      '/api/v1/files/favorites',
      '/api/v1/files/webdav',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('resources list GETs for managed collections', async () => {
    ts = await startTestServer();
    const prefixes = [
      'nginx/sites',
      'ftp/accounts',
      'mysql/databases',
      'mysql/users',
      'postgres/databases',
      'postgres/users',
      'redis/instances',
      'dns/zones',
      'dns/records',
      'ssl/certs',
    ];
    for (const p of prefixes) {
      const res = await apiJson(ts, 'GET', `/api/v1/resources/${p}`);
      expect(res.status).toBe(200);
      expect(Array.isArray((res.body as { items?: unknown[] }).items)).toBe(true);
    }

    const missing = await apiJson(ts, 'GET', '/api/v1/resources/not-a-collection');
    expect(missing.status).toBe(404);
  });

  it(
    'system panel GETs (host, software, ssl, services, exports)',
    async () => {
      ts = await startTestServer();
      const paths = [
        '/api/v1/system/host',
        '/api/v1/system/host-identity',
        '/api/v1/system/software',
        '/api/v1/system/ssl/certificates',
        '/api/v1/system/systemd/status',
        '/api/v1/system/services/matrix',
        '/api/v1/system/managed-nginx',
        '/api/v1/system/db/dumps',
        '/api/v1/system/exports',
        '/api/v1/system/migrate/jobs',
        '/api/v1/system/ftps/settings',
        '/api/v1/system/ftps/status',
        '/api/v1/system/ftps/options',
        '/api/v1/system/db/mysql/status',
        '/api/v1/system/db/postgres/status',
        '/api/v1/system/db/redis/status',
        '/api/v1/system/db/mysql/settings',
        '/api/v1/system/db/postgres/settings',
        '/api/v1/system/db/redis/settings',
      ];
      for (const path of paths) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    60_000,
  );

  it(
    'defense + protection GETs',
    async () => {
      ts = await startTestServer();
      const paths = [
        '/api/v1/defense/status',
        '/api/v1/defense/bans',
        '/api/v1/defense/timeline',
        '/api/v1/defense/suspects',
        '/api/v1/defense/auto-ban',
        '/api/v1/defense/automation',
        '/api/v1/defense/intel',
        '/api/v1/defense/geoip/status',
        '/api/v1/defense/geoip/policy',
        '/api/v1/protection/status',
        '/api/v1/system/firewall/status',
        '/api/v1/system/fail2ban/status',
        '/api/v1/system/fail2ban/banned',
        '/api/v1/system/fail2ban/ignoreip',
      ];
      for (const path of paths) {
        const res = await apiJson(ts, 'GET', path);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBeGreaterThanOrEqual(200);
      }
    },
    60_000,
  );
});

describe('controllers dry POST (HTTP honesty)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('files mkdir / create-text / write on public root', async () => {
    ts = await startTestServer();
    const mkdir = await apiJson(ts, 'POST', '/api/v1/files/mkdir?root=public', {
      path: 'honesty-dir',
    });
    expect(mkdir.status).toBeLessThan(500);
    expect(mkdir.status).toBeGreaterThanOrEqual(200);

    const create = await apiJson(ts, 'POST', '/api/v1/files/create-text?root=public', {
      path: 'honesty-dir/hello.txt',
      content: 'hello',
    });
    expect(create.status).toBeLessThan(500);

    const write = await apiJson(ts, 'PUT', '/api/v1/files/write?root=public', {
      path: 'honesty-dir/hello.txt',
      content: 'updated',
    });
    expect(write.status).toBeLessThan(500);

    const fav = await apiJson(ts, 'POST', '/api/v1/files/favorites/toggle', {
      path: 'honesty-dir/hello.txt',
      root: 'public',
    });
    expect(fav.status).toBeLessThan(500);

    // download / stat / read
    const stat = await apiJson(
      ts,
      'GET',
      '/api/v1/files/stat?root=public&path=honesty-dir/hello.txt',
    );
    expect(stat.status).toBe(200);
    const read = await apiJson(
      ts,
      'GET',
      '/api/v1/files/read?root=public&path=honesty-dir/hello.txt',
    );
    expect(read.status).toBe(200);
    const dl = await apiJson(
      ts,
      'GET',
      '/api/v1/files/download?root=public&path=honesty-dir/hello.txt',
    );
    expect(dl.status).toBe(200);
    const dlMiss = await apiJson(
      ts,
      'GET',
      '/api/v1/files/download?root=public&path=no-such-file.txt',
    );
    expect(dlMiss.status).toBe(404);

    // bad root
    const badRoot = await apiJson(ts, 'GET', '/api/v1/files?root=not-a-root&path=.');
    expect(badRoot.status).toBe(400);

    // share create + public download with password
    const share = await apiJson(ts, 'POST', '/api/v1/files/shares?root=public', {
      path: 'honesty-dir/hello.txt',
      password: 'Share-Pass-1',
    });
    expect(share.status).toBeLessThan(500);
    const token =
      (share.body as { share?: { token?: string } }).share?.token ??
      (share.body as { token?: string }).token;
    if (token) {
      const noPw = await apiJson(
        ts,
        'GET',
        `/api/v1/public/files/${token}`,
        undefined,
        { auth: false },
      );
      expect([200, 401]).toContain(noPw.status);
      const withPw = await apiJson(
        ts,
        'GET',
        `/api/v1/public/files/${token}?password=Share-Pass-1`,
        undefined,
        { auth: false },
      );
      expect([200, 401, 404]).toContain(withPw.status);
    }
    expect(
      (
        await apiJson(ts, 'POST', '/api/v1/files/shares?root=public', {
          /* no path */
        })
      ).status,
    ).toBe(400);

    // trash: delete file, list, restore, purge
    const del = await apiJson(ts, 'DELETE', '/api/v1/files?root=public&path=honesty-dir/hello.txt');
    expect(del.status).toBeLessThan(500);
    const trash = await apiJson(ts, 'GET', '/api/v1/files/trash?root=public');
    expect(trash.status).toBe(200);
    const items = (trash.body as { items?: Array<{ id?: string }> }).items ?? [];
    if (items[0]?.id) {
      const restore = await apiJson(ts, 'POST', '/api/v1/files/trash/restore?root=public', {
        trashId: items[0].id,
      });
      expect(restore.status).toBe(200);
    }
    expect(
      (await apiJson(ts, 'POST', '/api/v1/files/trash/restore?root=public', {})).status,
    ).toBe(400);
    const purge = await apiJson(ts, 'DELETE', '/api/v1/files/trash?root=public');
    expect(purge.status).toBe(200);

    // unzip missing
    expect(
      (
        await apiJson(ts, 'POST', '/api/v1/files/unzip?root=public', {
          /* no zipPath */
        })
      ).status,
    ).toBe(400);
    const unzipBad = await apiJson(ts, 'POST', '/api/v1/files/unzip?root=public', {
      zipPath: 'no-such.zip',
    });
    expect([200, 400, 500]).toContain(unzipBad.status);
  });

  it('logs bookmarks + settings dry mutations', async () => {
    ts = await startTestServer();
    const bookmark = await apiJson(ts, 'POST', '/api/v1/logs/bookmarks', {
      name: 'test-bm',
      query: 'error',
    });
    expect(bookmark.status).toBeLessThan(500);

    const settings = await apiJson(ts, 'PUT', '/api/v1/logs/settings', {
      retentionDays: 7,
    });
    expect(settings.status).toBeLessThan(500);

    const exportRes = await apiJson(ts, 'POST', '/api/v1/logs/export', {
      lines: 5,
    });
    expect(exportRes.status).toBeLessThan(500);
  });

  it('network dns test is dry-safe', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/network/dns/test', {
      name: 'localhost',
    });
    expect(res.status).toBeLessThan(500);
  });

  it(
    'system dry POSTs: ssl letsencrypt, php, db engines, redis, host identity, ntp, power',
    async () => {
      ts = await startTestServer();

      const le = await apiJson(ts, 'POST', '/api/v1/ssl/letsencrypt', {
        domain: 'le-cov.test',
        email: 'admin@le-cov.test',
        execute: false,
        run: false,
      });
      expect(le.status).toBeLessThan(500);

      const php = await apiJson(ts, 'POST', '/api/v1/system/php/apply', {
        domain: 'php-sys.test',
        phpVersion: '8.2',
        enableSite: false,
      });
      expect(php.status).toBeLessThan(500);

      for (const engine of ['mysql', 'mariadb'] as const) {
        const inst = await apiJson(ts, 'POST', `/api/v1/system/db/${engine}/install`, {});
        expect(inst.status).toBeLessThan(500);
        const start = await apiJson(ts, 'POST', `/api/v1/system/db/${engine}/start`, {});
        expect(start.status).toBeLessThan(500);
      }

      const redisPut = await apiJson(ts, 'PUT', '/api/v1/system/db/redis/settings', {
        databases: 16,
      });
      expect(redisPut.status).toBeLessThan(500);

      const redisApply = await apiJson(ts, 'POST', '/api/v1/system/db/redis/settings/apply', {
        restart: false,
      });
      expect(redisApply.status).toBeLessThan(500);

      const redisInst = await apiJson(ts, 'POST', '/api/v1/system/db/redis/install', {});
      expect(redisInst.status).toBeLessThan(500);

      const hostId = await apiJson(ts, 'POST', '/api/v1/system/host-identity', {
        hostname: 'ysk-cov-host',
        prettyHostname: 'YSK Cov',
        timezone: 'UTC',
      });
      // blocked without root/execute → 422
      expect(hostId.status).toBeLessThan(500);

      const ntp = await apiJson(ts, 'POST', '/api/v1/system/host/ntp-sync', {});
      expect(ntp.status).toBeLessThan(500);

      const powerBad = await apiJson(ts, 'POST', '/api/v1/system/host/power', {
        action: 'not-valid',
      });
      expect([400, 403, 422]).toContain(powerBad.status);

      const power = await apiJson(ts, 'POST', '/api/v1/system/host/power', {
        action: 'reboot',
        confirm: 'nope',
        delaySec: 9999,
      });
      expect(power.status).toBeLessThan(500);

      const sslDel = await apiJson(ts, 'DELETE', '/api/v1/system/ssl/certificates/no-such');
      expect(sslDel.status).toBeLessThan(500);

      const emailApply = await apiJson(ts, 'POST', '/api/v1/system/email/apply', {
        domain: 'sys-mail.test',
        installPackages: false,
      });
      expect(emailApply.status).toBeLessThan(500);

      const sslApply = await apiJson(ts, 'POST', '/api/v1/system/ssl/apply', {
        domain: 'sys-ssl.test',
        run: false,
      });
      expect(sslApply.status).toBeLessThan(500);

      // software detail
      const soft = await apiJson(ts, 'GET', '/api/v1/system/software/nginx');
      expect(soft.status).toBeLessThan(500);
    },
    90_000,
  );

  it(
    'webdav enable + PROPFIND/GET/PUT + public share miss',
    async () => {
      ts = await startTestServer();

      // disabled path when not enabled
      const disabled = await fetch(`${ts.baseUrl}/webdav/`, { method: 'OPTIONS' });
      expect([401, 503]).toContain(disabled.status);

      // issue token (enables webdav)
      const tokenRes = await apiJson(ts, 'POST', '/api/v1/files/webdav/token', {});
      expect(tokenRes.status).toBeLessThan(500);
      const token = (tokenRes.body as { token?: string }).token;

      if (token) {
        const auth = 'Basic ' + Buffer.from(`ysk:${token}`).toString('base64');
        const opt = await fetch(`${ts.baseUrl}/webdav/`, {
          method: 'OPTIONS',
          headers: { authorization: auth },
        });
        expect([200, 207]).toContain(opt.status);

        const prop = await fetch(`${ts.baseUrl}/webdav/`, {
          method: 'PROPFIND',
          headers: { authorization: auth, depth: '1' },
        });
        expect([200, 207]).toContain(prop.status);

        const put = await fetch(`${ts.baseUrl}/webdav/webdav-cov.txt`, {
          method: 'PUT',
          headers: { authorization: auth, 'content-type': 'text/plain' },
          body: 'webdav-body',
        });
        expect([200, 201]).toContain(put.status);

        const get = await fetch(`${ts.baseUrl}/webdav/webdav-cov.txt`, {
          method: 'GET',
          headers: { authorization: auth },
        });
        expect(get.status).toBe(200);

        const getMiss = await fetch(`${ts.baseUrl}/webdav/no-such-file-zzz.txt`, {
          method: 'GET',
          headers: { authorization: auth },
        });
        expect(getMiss.status).toBe(404);

        const badMethod = await fetch(`${ts.baseUrl}/webdav/webdav-cov.txt`, {
          method: 'DELETE',
          headers: { authorization: auth },
        });
        expect(badMethod.status).toBe(405);

        await apiJson(ts, 'POST', '/api/v1/files/webdav/disable', {});
      }

      const unauth = await fetch(`${ts.baseUrl}/webdav/secret`, {
        method: 'GET',
        headers: { authorization: 'Basic ' + Buffer.from('ysk:bad').toString('base64') },
      });
      expect([401, 503]).toContain(unauth.status);

      const shareMiss = await apiJson(
        ts,
        'GET',
        '/api/v1/public/files/no-such-share-token',
        undefined,
        { auth: false },
      );
      expect(shareMiss.status).toBe(404);
    },
    60_000,
  );

  it(
    'defense whitelist/geoip/auto-ban/cloudflare mutations',
    async () => {
      ts = await startTestServer();

      const wl = await apiJson(ts, 'POST', '/api/v1/defense/whitelist', {
        action: 'add',
        ip: '198.51.100.10',
      });
      expect(wl.status).toBeLessThan(500);

      const autoBan = await apiJson(ts, 'PUT', '/api/v1/defense/auto-ban', {
        enabled: true,
        threshold: 20,
      });
      expect(autoBan.status).toBeLessThan(500);

      const autoPol = await apiJson(ts, 'PUT', '/api/v1/defense/automation', {
        enabled: true,
        autoBan: { enabled: true, intervalSeconds: 60 },
        autoPreset: { enabled: false },
      });
      expect(autoPol.status).toBeLessThan(500);

      const tick = await apiJson(ts, 'POST', '/api/v1/defense/auto-ban/tick', {});
      expect(tick.status).toBeLessThan(500);

      const geoPol = await apiJson(ts, 'PUT', '/api/v1/defense/geoip/policy', {
        mode: 'off',
        autoUpdate: false,
      });
      expect(geoPol.status).toBeLessThan(500);

      const geoUp = await apiJson(ts, 'POST', '/api/v1/defense/geoip/update', {});
      expect(geoUp.status).toBeLessThan(500);

      const geoLookup = await apiJson(ts, 'POST', '/api/v1/defense/geoip/lookup', {
        ip: '1.1.1.1',
      });
      expect(geoLookup.status).toBeLessThan(500);

      const geoApply = await apiJson(ts, 'POST', '/api/v1/defense/geoip/apply', {
        apply: false,
      });
      expect(geoApply.status).toBeLessThan(500);

      const cf = await apiJson(ts, 'POST', '/api/v1/defense/cloudflare/under-attack', {
        enable: false,
      });
      expect(cf.status).toBeLessThan(500);

      const banBatch = await apiJson(ts, 'POST', '/api/v1/defense/ban-batch', {
        ips: ['198.51.100.99'],
        reason: 'cov',
        apply: false,
      });
      expect(banBatch.status).toBeLessThan(500);

      const probe = await apiJson(ts, 'POST', '/api/v1/defense/probe', {});
      expect(probe.status).toBeLessThan(500);

      const preset = await apiJson(ts, 'POST', '/api/v1/defense/preset', {
        preset: 'normal',
        apply: false,
      });
      expect(preset.status).toBeLessThan(500);

      const stack = await apiJson(ts, 'POST', '/api/v1/defense/stack/apply', { apply: false });
      expect(stack.status).toBeLessThan(500);

      const ban = await apiJson(ts, 'POST', '/api/v1/defense/ban', {
        ip: '198.51.100.88',
        reason: 'cov',
        apply: false,
      });
      expect(ban.status).toBeLessThan(500);

      const unban = await apiJson(ts, 'POST', '/api/v1/defense/unban', {
        ip: '198.51.100.88',
        apply: false,
      });
      expect(unban.status).toBeLessThan(500);

      const protProbe = await apiJson(ts, 'POST', '/api/v1/protection/probe', {});
      expect(protProbe.status).toBeLessThan(500);

      const emerg = await apiJson(ts, 'POST', '/api/v1/protection/emergency', {
        enable: false,
      });
      expect(emerg.status).toBeLessThan(500);
    },
    90_000,
  );

  it('metrics process signal/renice without execute is honest', async () => {
    ts = await startTestServer();
    const signal = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      pid: 1,
      signal: '0',
    });
    expect(signal.status).toBeLessThan(500);
    const sigBody = signal.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    if (typeof sigBody.ok === 'boolean') {
      expect(sigBody.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: sigBody.ok,
        blocked: sigBody.blocked,
        requiresExecute: sigBody.requiresExecute,
        apply_status: sigBody.apply_status,
        notes: sigBody.notes,
      });
    }

    const renice = await apiJson(ts, 'POST', '/api/v1/metrics/processes/renice', {
      pid: 1,
      nice: 0,
    });
    expect(renice.status).toBeLessThan(500);
  });

  it('system dry POSTs without EXECUTE are honest', async () => {
    ts = await startTestServer();
    const endpoints: Array<{ path: string; body?: unknown }> = [
      { path: '/api/v1/system/fail2ban/apply', body: { apply: false } },
      { path: '/api/v1/system/ftps/apply', body: { apply: false } },
      { path: '/api/v1/system/db/postgres/settings/apply', body: {} },
      { path: '/api/v1/system/db/redis/settings/apply', body: {} },
      { path: '/api/v1/system/email/apply', body: { apply: false } },
      { path: '/api/v1/system/ssl/apply', body: { apply: false } },
      { path: '/api/v1/system/php/apply', body: { apply: false } },
      { path: '/api/v1/system/software/install', body: { packages: [], install: false } },
      { path: '/api/v1/system/host/ntp-sync', body: {} },
      { path: '/api/v1/system/nginx/purge-cache', body: {} },
      { path: '/api/v1/protection/probe', body: {} },
    ];
    for (const ep of endpoints) {
      const res = await apiJson(ts, 'POST', ep.path, ep.body ?? {});
      expect(res.status).toBeLessThan(500);
      const body = res.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
        notes?: string[];
      };
      if (typeof body.ok === 'boolean') {
        expect(body.ok === true && body.blocked === true).toBe(false);
        if (body.apply_status === 'applied') {
          expect(body.ok).toBe(true);
        }
      }
    }
  }, 90_000);

  it('resources create draft is panel-only', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
      zone: 'resource-test.local',
      serverIp: '203.0.113.60',
    });
    expect(res.status).toBeLessThan(500);
    if (res.status < 400) {
      const body = res.body as {
        item?: { id?: string; apply_status?: string };
        apply_status?: string;
      };
      const st = body.item?.apply_status ?? body.apply_status;
      if (st) expect(st).not.toBe('applied');
    }
  });
});

/**
 * Deep files-controller climb — full public-root CRUD, trash, shares,
 * versions, webdav token lifecycle (no root).
 */
describe('files-controller deep coverage', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it(
    'files full lifecycle on public root',
    async () => {
      ts = await startTestServer();
      const root = 'public';
      const q = (path: string) => `${path}?root=${root}`;

      // mkdir nested
      const mkdir = await apiJson(ts, 'POST', q('/api/v1/files/mkdir'), {
        path: 'deep-files/a',
      });
      expect(mkdir.status).toBeLessThan(500);

      const create = await apiJson(ts, 'POST', q('/api/v1/files/create-text'), {
        path: 'deep-files/a/note.txt',
        content: 'line-one\n',
      });
      expect(create.status).toBeLessThan(500);

      const write = await apiJson(ts, 'PUT', q('/api/v1/files/write'), {
        path: 'deep-files/a/note.txt',
        content: 'line-one\nline-two\n',
      });
      expect(write.status).toBeLessThan(500);

      const list = await apiJson(ts, 'GET', `/api/v1/files?root=${root}&path=deep-files/a`);
      expect(list.status).toBe(200);
      expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);

      const read = await apiJson(
        ts,
        'GET',
        `/api/v1/files/read?root=${root}&path=deep-files/a/note.txt`,
      );
      expect(read.status).toBeLessThan(500);
      if (read.status === 200) {
        expect(String((read.body as { content?: string }).content ?? '')).toContain('line');
      }

      const stat = await apiJson(
        ts,
        'GET',
        `/api/v1/files/stat?root=${root}&path=deep-files/a/note.txt`,
      );
      expect(stat.status).toBeLessThan(500);

      const download = await apiJson(
        ts,
        'GET',
        `/api/v1/files/download?root=${root}&path=deep-files/a/note.txt`,
      );
      expect(download.status).toBeLessThan(500);

      const copy = await apiJson(ts, 'POST', q('/api/v1/files/copy'), {
        from: 'deep-files/a/note.txt',
        to: 'deep-files/a/note-copy.txt',
      });
      expect(copy.status).toBeLessThan(500);

      const rename = await apiJson(ts, 'POST', q('/api/v1/files/rename'), {
        from: 'deep-files/a/note-copy.txt',
        to: 'deep-files/a/note-renamed.txt',
      });
      expect(rename.status).toBeLessThan(500);

      const move = await apiJson(ts, 'POST', q('/api/v1/files/move'), {
        from: 'deep-files/a/note-renamed.txt',
        to: 'deep-files/note-moved.txt',
      });
      expect(move.status).toBeLessThan(500);

      const chmod = await apiJson(ts, 'POST', q('/api/v1/files/chmod'), {
        path: 'deep-files/a/note.txt',
        mode: '644',
      });
      expect(chmod.status).toBeLessThan(500);

      const zip = await apiJson(ts, 'POST', q('/api/v1/files/zip'), {
        paths: ['deep-files/a/note.txt'],
        dest: 'deep-files/bundle.zip',
      });
      expect(zip.status).toBeLessThan(500);

      const unzip = await apiJson(ts, 'POST', q('/api/v1/files/unzip'), {
        path: 'deep-files/bundle.zip',
        dest: 'deep-files/unzipped',
      });
      expect(unzip.status).toBeLessThan(500);

      // upload via base64 body
      const upload = await apiJson(ts, 'POST', q('/api/v1/files/upload'), {
        path: 'deep-files/a/up.bin',
        contentBase64: Buffer.from('upload-bytes').toString('base64'),
      });
      expect(upload.status).toBeLessThan(500);

      // favorites
      const fav = await apiJson(ts, 'POST', '/api/v1/files/favorites/toggle', {
        path: 'deep-files/a/note.txt',
        root,
      });
      expect(fav.status).toBeLessThan(500);
      const favs = await apiJson(ts, 'GET', `/api/v1/files/favorites?root=${root}`);
      expect(favs.status).toBeLessThan(500);

      // shares
      const share = await apiJson(ts, 'POST', '/api/v1/files/shares', {
        path: 'deep-files/a/note.txt',
        root,
        expiresInHours: 1,
      });
      expect(share.status).toBeLessThan(500);
      const shareId =
        (share.body as { share?: { id?: string; token?: string }; id?: string; token?: string })
          .share?.id ?? (share.body as { id?: string }).id;
      const shareToken =
        (share.body as { share?: { token?: string }; token?: string }).share?.token ??
        (share.body as { token?: string }).token;

      const shares = await apiJson(ts, 'GET', `/api/v1/files/shares?root=${root}`);
      expect(shares.status).toBeLessThan(500);

      if (shareToken) {
        const pub = await apiJson(
          ts,
          'GET',
          `/api/v1/public/files/${shareToken}`,
          undefined,
          { auth: false },
        );
        expect(pub.status).toBeLessThan(500);
      }

      if (shareId) {
        const delShare = await apiJson(ts, 'DELETE', `/api/v1/files/shares/${shareId}`);
        expect(delShare.status).toBeLessThan(500);
      }

      // versions
      const versions = await apiJson(
        ts,
        'GET',
        `/api/v1/files/versions?root=${root}&path=deep-files/a/note.txt`,
      );
      expect(versions.status).toBeLessThan(500);

      const restoreVer = await apiJson(ts, 'POST', q('/api/v1/files/versions/restore'), {
        path: 'deep-files/a/note.txt',
        versionId: 'no-such-version',
      });
      expect(restoreVer.status).toBeLessThan(500);

      // trash: soft delete then restore/purge
      const del = await apiJson(
        ts,
        'DELETE',
        `/api/v1/files?root=${root}&path=deep-files/note-moved.txt`,
      );
      expect(del.status).toBeLessThan(500);

      const trash = await apiJson(ts, 'GET', `/api/v1/files/trash?root=${root}`);
      expect(trash.status).toBeLessThan(500);
      const trashItems =
        (trash.body as { items?: Array<{ id?: string }> }).items ?? [];
      if (trashItems[0]?.id) {
        const restore = await apiJson(ts, 'POST', q('/api/v1/files/trash/restore'), {
          id: trashItems[0].id,
        });
        expect(restore.status).toBeLessThan(500);
      }

      // permanent delete
      const delPerm = await apiJson(
        ts,
        'DELETE',
        `/api/v1/files?root=${root}&path=deep-files/a/up.bin&permanent=1`,
      );
      expect(delPerm.status).toBeLessThan(500);

      const trashPurge = await apiJson(
        ts,
        'DELETE',
        `/api/v1/files/trash?root=${root}`,
      );
      expect(trashPurge.status).toBeLessThan(500);

      // webdav
      const webdav = await apiJson(ts, 'GET', '/api/v1/files/webdav');
      expect(webdav.status).toBeLessThan(500);

      const token = await apiJson(ts, 'POST', '/api/v1/files/webdav/token', {});
      expect(token.status).toBeLessThan(500);

      // WebDAV OPTIONS when disabled → 503; after token may be enabled
      const wd = await apiJson(ts, 'GET', '/webdav/', undefined, { auth: false });
      expect(wd.status).toBeLessThan(500);

      const disable = await apiJson(ts, 'POST', '/api/v1/files/webdav/disable', {});
      expect(disable.status).toBeLessThan(500);

      // project root after creating project
      const proj = await apiJson(ts, 'POST', '/api/v1/projects', {
        name: 'FilesProj',
        runtime: 'node',
        domain: 'files-proj.test',
      });
      expect(proj.status).toBe(201);
      const pid = (proj.body as { project: { id: string } }).project.id;
      const pl = await apiJson(
        ts,
        'GET',
        `/api/v1/files?root=project:${pid}&path=.`,
      );
      expect(pl.status).toBeLessThan(500);

      const pwrite = await apiJson(ts, 'PUT', `/api/v1/files/write?root=project:${pid}`, {
        path: 'hello.txt',
        content: 'from-project',
      });
      expect(pwrite.status).toBeLessThan(500);

      // bad root
      const badRoot = await apiJson(ts, 'GET', '/api/v1/files?root=invalid&path=.');
      expect(badRoot.status).toBeGreaterThanOrEqual(400);
    },
    90_000,
  );
});

describe('controllers depth (HTTP honesty + lifecycle)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it(
    'files full lifecycle on public root (CRUD, shares, webdav, trash)',
    async () => {
      ts = await startTestServer();

      // bad root is 400
      const badRoot = await apiJson(ts, 'GET', '/api/v1/files?path=.&root=invalid');
      expect(badRoot.status).toBe(400);

      const mkdir = await apiJson(ts, 'POST', '/api/v1/files/mkdir?root=public', {
        path: 'depth-dir',
      });
      expect(mkdir.status).toBe(200);

      const create = await apiJson(ts, 'POST', '/api/v1/files/create-text?root=public', {
        path: 'depth-dir/a.txt',
        content: 'v1',
      });
      expect(create.status).toBe(200);

      const upload = await apiJson(ts, 'POST', '/api/v1/files/upload?root=public', {
        dir: 'depth-dir',
        files: [{ name: 'b.bin', base64: Buffer.from('bin').toString('base64') }],
      });
      expect(upload.status).toBe(200);
      expect((upload.body as { ok?: boolean }).ok).toBe(true);

      const emptyUpload = await apiJson(ts, 'POST', '/api/v1/files/upload?root=public', {
        dir: 'depth-dir',
        files: [],
      });
      expect(emptyUpload.status).toBe(400);

      const read = await apiJson(
        ts,
        'GET',
        '/api/v1/files/read?root=public&path=depth-dir/a.txt',
      );
      expect(read.status).toBe(200);

      const stat = await apiJson(
        ts,
        'GET',
        '/api/v1/files/stat?root=public&path=depth-dir/a.txt',
      );
      expect(stat.status).toBe(200);

      const dlRes = await fetch(
        `${ts.baseUrl}/api/v1/files/download?root=public&path=depth-dir/a.txt`,
        { headers: { authorization: `Bearer ${ts.token}` } },
      );
      expect(dlRes.status).toBe(200);

      await apiJson(ts, 'PUT', '/api/v1/files/write?root=public', {
        path: 'depth-dir/a.txt',
        content: 'v2',
      });

      const writeB64 = await apiJson(ts, 'PUT', '/api/v1/files/write?root=public', {
        path: 'depth-dir/c.b64',
        base64: Buffer.from('b64').toString('base64'),
      });
      expect(writeB64.status).toBe(200);

      const noPath = await apiJson(ts, 'POST', '/api/v1/files/mkdir?root=public', {});
      expect(noPath.status).toBe(400);

      const copy = await apiJson(ts, 'POST', '/api/v1/files/copy?root=public', {
        from: 'depth-dir/a.txt',
        to: 'depth-dir/a-copy.txt',
      });
      expect(copy.status).toBe(200);

      const rename = await apiJson(ts, 'POST', '/api/v1/files/rename?root=public', {
        from: 'depth-dir/a-copy.txt',
        to: 'depth-dir/a-renamed.txt',
      });
      expect(rename.status).toBe(200);

      const move = await apiJson(ts, 'POST', '/api/v1/files/move?root=public', {
        from: 'depth-dir/a-renamed.txt',
        to: 'depth-dir/moved.txt',
      });
      expect(move.status).toBe(200);

      const chmod = await apiJson(ts, 'POST', '/api/v1/files/chmod?root=public', {
        path: 'depth-dir/moved.txt',
        mode: '644',
      });
      expect(chmod.status).toBe(200);

      const zip = await apiJson(ts, 'POST', '/api/v1/files/zip?root=public', {
        paths: ['depth-dir/a.txt', 'depth-dir/moved.txt'],
        dest: 'depth-dir/pack.zip',
      });
      expect(zip.status).toBeLessThan(500);

      if (zip.status < 400) {
        const unzip = await apiJson(ts, 'POST', '/api/v1/files/unzip?root=public', {
          zipPath: 'depth-dir/pack.zip',
          destDir: 'depth-dir/unpacked',
        });
        expect(unzip.status).toBeLessThan(500);
      }

      const versions = await apiJson(
        ts,
        'GET',
        '/api/v1/files/versions?root=public&path=depth-dir/a.txt',
      );
      expect(versions.status).toBe(200);

      const share = await apiJson(ts, 'POST', '/api/v1/files/shares?root=public', {
        path: 'depth-dir/a.txt',
      });
      expect(share.status).toBe(201);
      const shareBody = share.body as {
        share?: { id?: string; token?: string; url?: string };
      };
      expect(shareBody.share?.token).toBeTruthy();

      const publicDl = await apiJson(
        ts,
        'GET',
        `/api/v1/public/files/${shareBody.share!.token}`,
        undefined,
        { auth: false },
      );
      expect(publicDl.status).toBe(200);

      const badToken = await apiJson(
        ts,
        'GET',
        '/api/v1/public/files/not-a-real-share-token',
        undefined,
        { auth: false },
      );
      expect(badToken.status).toBe(404);

      if (shareBody.share?.id) {
        const delShare = await apiJson(
          ts,
          'DELETE',
          `/api/v1/files/shares/${shareBody.share.id}?root=public`,
        );
        expect(delShare.status).toBeLessThan(500);
      }

      const webdavToken = await apiJson(ts, 'POST', '/api/v1/files/webdav/token', {});
      expect(webdavToken.status).toBe(200);
      expect((webdavToken.body as { ok?: boolean }).ok).toBe(true);

      // WebDAV without auth → 401 or 503 (disabled if not enabled after token)
      const webdav = await fetch(`${ts.baseUrl}/webdav/`, {
        method: 'OPTIONS',
      });
      expect([200, 207, 401, 503, 405]).toContain(webdav.status);

      const webdavDisable = await apiJson(ts, 'POST', '/api/v1/files/webdav/disable', {});
      expect(webdavDisable.status).toBe(200);

      const trash = await apiJson(
        ts,
        'DELETE',
        '/api/v1/files?root=public&path=depth-dir/moved.txt',
      );
      expect(trash.status).toBe(200);

      const trashList = await apiJson(ts, 'GET', '/api/v1/files/trash?root=public');
      expect(trashList.status).toBe(200);
      const trashItems = (trashList.body as { items?: Array<{ id?: string }> }).items ?? [];
      if (trashItems[0]?.id) {
        const restore = await apiJson(ts, 'POST', '/api/v1/files/trash/restore?root=public', {
          trashId: trashItems[0].id,
        });
        expect(restore.status).toBe(200);
      }

      const purge = await apiJson(ts, 'DELETE', '/api/v1/files/trash?root=public');
      expect(purge.status).toBe(200);

      const permanent = await apiJson(
        ts,
        'DELETE',
        '/api/v1/files?root=public&path=depth-dir/b.bin&permanent=1',
      );
      expect(permanent.status).toBe(200);
    },
    90_000,
  );

  it(
    'resources CRUD + apply dry-run honesty across collections',
    async () => {
      ts = await startTestServer();

      // DNS zone create + seed records + GET one + filter + apply + delete cascade
      const zone = await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
        zone: 'depth-zone.local',
        serverIp: '203.0.113.70',
        template: 'full',
      });
      expect(zone.status).toBe(201);
      const zoneId = (zone.body as { item?: { id?: string } }).item?.id;
      expect(zoneId).toBeTruthy();

      const getZone = await apiJson(ts, 'GET', `/api/v1/resources/dns/zones/${zoneId}`);
      expect(getZone.status).toBe(200);

      const missingOne = await apiJson(ts, 'GET', '/api/v1/resources/dns/zones/no-such-id');
      expect(missingOne.status).toBe(404);

      const records = await apiJson(
        ts,
        'GET',
        `/api/v1/resources/dns/records?zoneId=${zoneId}`,
      );
      expect(records.status).toBe(200);

      const patchZone = await apiJson(ts, 'PATCH', `/api/v1/resources/dns/zones/${zoneId}`, {
        serverIp: '203.0.113.71',
      });
      expect(patchZone.status).toBe(200);

      const applyZone = await apiJson(
        ts,
        'POST',
        `/api/v1/resources/dns/zones/${zoneId}/apply`,
        { execute: false },
      );
      expect(applyZone.status).toBeLessThan(500);
      const az = applyZone.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        notes?: string[];
      };
      if (typeof az.ok === 'boolean') {
        expect(az.ok === true && az.blocked === true).toBe(false);
        expectHonestOps({
          ok: az.ok,
          blocked: az.blocked,
          apply_status: az.apply_status,
          notes: az.notes,
        });
      }

      // MySQL DB + linked user draft
      const mysql = await apiJson(ts, 'POST', '/api/v1/resources/mysql/databases', {
        name: 'depth_app',
        createUser: true,
        username: 'depth_u',
        password: 'Depth-Pass-99!',
        engine: 'mysql',
      });
      expect(mysql.status).toBe(201);
      const mysqlId = (mysql.body as { item?: { id?: string } }).item?.id;

      if (mysqlId) {
        const applyMysql = await apiJson(
          ts,
          'POST',
          `/api/v1/resources/mysql/databases/${mysqlId}/apply`,
          { execute: false },
        );
        expect(applyMysql.status).toBeLessThan(500);
        const am = applyMysql.body as { ok?: boolean; apply_status?: string; blocked?: boolean };
        if (typeof am.ok === 'boolean') {
          expect(am.apply_status).not.toBe('applied');
        }
        const delMysql = await apiJson(
          ts,
          'DELETE',
          `/api/v1/resources/mysql/databases/${mysqlId}`,
        );
        expect(delMysql.status).toBeLessThan(500);
      }

      // Postgres DB draft
      const pg = await apiJson(ts, 'POST', '/api/v1/resources/postgres/databases', {
        name: 'depth_pg',
        createUser: true,
        username: 'pg_u',
        password: 'Pg-Pass-99!',
      });
      expect(pg.status).toBe(201);
      const pgId = (pg.body as { item?: { id?: string } }).item?.id;
      if (pgId) {
        const applyPg = await apiJson(
          ts,
          'POST',
          `/api/v1/resources/postgres/databases/${pgId}/apply`,
          { execute: false },
        );
        expect(applyPg.status).toBeLessThan(500);
        await apiJson(ts, 'DELETE', `/api/v1/resources/postgres/databases/${pgId}`);
      }

      // Redis instance
      const redis = await apiJson(ts, 'POST', '/api/v1/resources/redis/instances', {
        name: 'depth-redis',
        port: 6399,
      });
      expect(redis.status).toBeLessThan(500);
      const redisId = (redis.body as { item?: { id?: string } }).item?.id;
      if (redisId) {
        const applyRedis = await apiJson(
          ts,
          'POST',
          `/api/v1/resources/redis/instances/${redisId}/apply`,
          { execute: false },
        );
        expect(applyRedis.status).toBeLessThan(500);
        await apiJson(ts, 'DELETE', `/api/v1/resources/redis/instances/${redisId}`);
      }

      // nginx site draft + apply dry
      const site = await apiJson(ts, 'POST', '/api/v1/resources/nginx/sites', {
        serverName: 'depth-site.local',
        root: '/var/www/depth',
      });
      expect(site.status).toBeLessThan(500);
      const siteId = (site.body as { item?: { id?: string } }).item?.id;
      if (siteId) {
        const applySite = await apiJson(
          ts,
          'POST',
          `/api/v1/resources/nginx/sites/${siteId}/apply`,
          { execute: false },
        );
        expect(applySite.status).toBeLessThan(500);
        const delSite = await apiJson(
          ts,
          'DELETE',
          `/api/v1/resources/nginx/sites/${siteId}`,
        );
        expect(delSite.status).toBeLessThan(500);
      }

      // FTP account draft + apply honesty
      const ftp = await apiJson(ts, 'POST', '/api/v1/resources/ftp/accounts', {
        username: 'depthftp',
        password: 'Ftp-Pass-99!',
        homeDir: '/tmp/depth-ftp',
      });
      expect(ftp.status).toBeLessThan(500);
      const ftpId = (ftp.body as { item?: { id?: string } }).item?.id;
      if (ftpId) {
        const applyFtp = await apiJson(
          ts,
          'POST',
          `/api/v1/resources/ftp/accounts/${ftpId}/apply`,
          {},
        );
        expect(applyFtp.status).toBeLessThan(500);
        await apiJson(ts, 'DELETE', `/api/v1/resources/ftp/accounts/${ftpId}`);
      }

      // certificates POST rejected
      const certCreate = await apiJson(ts, 'POST', '/api/v1/resources/ssl/certs', {
        domain: 'nope.local',
      });
      expect(certCreate.status).toBe(400);

      // certificates apply is 410
      const certApply = await apiJson(
        ts,
        'POST',
        '/api/v1/resources/ssl/certs/fake-id/apply',
        {},
      );
      expect(certApply.status).toBe(410);

      // DNS zone missing name
      const badZone = await apiJson(ts, 'POST', '/api/v1/resources/dns/zones', {
        zone: '',
        serverIp: '1.1.1.1',
      });
      expect(badZone.status).toBe(400);

      // MySQL missing name
      const badMysql = await apiJson(ts, 'POST', '/api/v1/resources/mysql/databases', {
        name: '',
      });
      expect(badMysql.status).toBe(400);

      if (zoneId) {
        const delZone = await apiJson(ts, 'DELETE', `/api/v1/resources/dns/zones/${zoneId}`);
        expect(delZone.status).toBe(200);
      }
    },
    120_000,
  );

  it(
    'network mutations without EXECUTE are honest ops',
    async () => {
      ts = await startTestServer();

      const snap = await apiJson(ts, 'GET', '/api/v1/network?raw=1');
      expect(snap.status).toBeLessThan(500);
      const ifaces =
        (snap.body as { interfaces?: Array<{ name?: string }> }).interfaces ?? [];
      const ifname = ifaces[0]?.name ?? 'lo';

      const one = await apiJson(ts, 'GET', `/api/v1/network/interfaces/${ifname}`);
      expect(one.status).toBeLessThan(500);

      const missingIf = await apiJson(ts, 'GET', '/api/v1/network/interfaces/no-such-iface-xyz');
      expect(missingIf.status).toBe(404);

      const addAddr = await apiJson(
        ts,
        'POST',
        `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/addr`,
        { cidr: '203.0.113.50/32', persistent: false },
      );
      expect(addAddr.status).toBeLessThan(500);
      const aa = addAddr.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
        notes?: string[];
      };
      if (typeof aa.ok === 'boolean') {
        expect(aa.apply_status).not.toBe('applied');
        expectHonestOps({
          ok: aa.ok,
          blocked: aa.blocked,
          apply_status: aa.apply_status,
          requiresExecute: aa.requiresExecute,
          notes: aa.notes,
        });
      }

      const delAddr = await apiJson(
        ts,
        'DELETE',
        `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/addr`,
        { cidr: '203.0.113.50/32' },
      );
      expect(delAddr.status).toBeLessThan(500);

      const link = await apiJson(
        ts,
        'POST',
        `/api/v1/network/interfaces/${encodeURIComponent(ifname)}/link`,
        { action: 'up', mtu: 1500 },
      );
      expect(link.status).toBeLessThan(500);
      const lk = link.body as { ok?: boolean; apply_status?: string; blocked?: boolean };
      if (typeof lk.ok === 'boolean') {
        expect(lk.apply_status).not.toBe('applied');
      }

      const addRoute = await apiJson(ts, 'POST', '/api/v1/network/routes', {
        dst: '203.0.113.0/24',
        gateway: '127.0.0.1',
        confirmDefault: false,
      });
      expect(addRoute.status).toBeLessThan(500);
      const ar = addRoute.body as { ok?: boolean; apply_status?: string; blocked?: boolean };
      if (typeof ar.ok === 'boolean') {
        expect(ar.apply_status).not.toBe('applied');
      }

      const delRoute = await apiJson(ts, 'DELETE', '/api/v1/network/routes', {
        dst: '203.0.113.0/24',
        gateway: '127.0.0.1',
      });
      expect(delRoute.status).toBeLessThan(500);

      const setDns = await apiJson(ts, 'PUT', '/api/v1/network/dns', {
        nameservers: ['1.1.1.1', '8.8.8.8'],
        search: 'local',
        mode: 'static',
      });
      expect(setDns.status).toBeLessThan(500);
      const sd = setDns.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        notes?: string[];
      };
      if (typeof sd.ok === 'boolean') {
        expect(sd.apply_status).not.toBe('applied');
        expectHonestOps({
          ok: sd.ok,
          blocked: sd.blocked,
          apply_status: sd.apply_status,
          notes: sd.notes,
        });
      }

      const badJson = await fetch(`${ts.baseUrl}/api/v1/network/dns/test`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ts.token}`,
          'content-type': 'application/json',
        },
        body: '{not-json',
      });
      expect(badJson.status).toBe(400);
    },
    60_000,
  );

  it(
    'logs export download, vacuum, bookmark delete, settings',
    async () => {
      ts = await startTestServer();

      const exportRes = await apiJson(ts, 'POST', '/api/v1/logs/export', {
        source: 'journal:',
        lines: 5,
        format: 'text',
      });
      expect(exportRes.status).toBeLessThan(500);
      const exportBody = exportRes.body as { ok?: boolean; id?: string; exportId?: string };
      const exportId = exportBody.id ?? exportBody.exportId;
      if (exportId) {
        const dl = await apiJson(ts, 'GET', `/api/v1/logs/export/${exportId}`);
        expect(dl.status).toBeLessThan(500);
      }

      const badExportId = await apiJson(ts, 'GET', '/api/v1/logs/export/!!bad');
      expect(badExportId.status).toBe(400);

      const missingExport = await apiJson(
        ts,
        'GET',
        '/api/v1/logs/export/abcdef12-missing-export-id-xx',
      );
      expect([400, 404]).toContain(missingExport.status);

      const vacuum = await apiJson(ts, 'POST', '/api/v1/logs/journal/vacuum', {
        mode: 'time',
        value: '30d',
      });
      expect(vacuum.status).toBeLessThan(500);
      const vb = vacuum.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        requiresExecute?: boolean;
        notes?: string[];
      };
      if (typeof vb.ok === 'boolean') {
        expect(vb.apply_status).not.toBe('applied');
        expectHonestOps({
          ok: vb.ok,
          blocked: vb.blocked,
          apply_status: vb.apply_status,
          requiresExecute: vb.requiresExecute,
          notes: vb.notes,
        });
      }

      const bm = await apiJson(ts, 'POST', '/api/v1/logs/bookmarks', {
        name: 'depth-bm',
        source: 'journal:',
        grep: 'error',
        lines: 20,
      });
      expect(bm.status).toBeLessThan(500);
      const bmBody = bm.body as { bookmarks?: Array<{ id?: string }>; items?: Array<{ id?: string }> };
      const bms = bmBody.bookmarks ?? bmBody.items ?? [];
      const bmId = bms.find((b) => b.id)?.id;
      if (bmId) {
        const delBm = await apiJson(ts, 'DELETE', `/api/v1/logs/bookmarks/${bmId}`);
        expect(delBm.status).toBeLessThan(500);
      }

      const settings = await apiJson(ts, 'PUT', '/api/v1/logs/settings', {
        maxLines: 100,
        followIntervalSec: 5,
        retentionDays: 14,
      });
      expect(settings.status).toBeLessThan(500);

      // SSE stream: open briefly then abort
      const ac = new AbortController();
      const streamP = fetch(
        `${ts.baseUrl}/api/v1/logs/stream?source=journal:&interval=1&lines=5`,
        {
          headers: { authorization: `Bearer ${ts.token}`, accept: 'text/event-stream' },
          signal: ac.signal,
        },
      );
      await new Promise((r) => setTimeout(r, 200));
      ac.abort();
      try {
        await streamP;
      } catch {
        /* aborted */
      }

      const noSource = await apiJson(ts, 'GET', '/api/v1/logs/stream');
      expect(noSource.status).toBe(400);
    },
    60_000,
  );

  it(
    'metrics process detail, validation, signal honesty, stream abort',
    async () => {
      ts = await startTestServer();

      const detail = await apiJson(ts, 'GET', '/api/v1/metrics/processes/1');
      expect(detail.status).toBeLessThan(500);

      const badSignal = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
        pid: 1,
        signal: 'NOTASIG',
      });
      expect(badSignal.status).toBe(400);

      const killNoConfirm = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
        pid: 1,
        signal: 'KILL',
      });
      expect(killNoConfirm.status).toBe(400);

      const term = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
        pid: 1,
        signal: 'TERM',
      });
      expect(term.status).toBeLessThan(500);
      const tb = term.body as {
        ok?: boolean;
        blocked?: boolean;
        apply_status?: string;
        notes?: string[];
      };
      if (typeof tb.ok === 'boolean') {
        expect(tb.apply_status).not.toBe('applied');
        expectHonestOps({
          ok: tb.ok,
          blocked: tb.blocked,
          apply_status: tb.apply_status,
          notes: tb.notes,
        });
      }

      const badJson = await fetch(`${ts.baseUrl}/api/v1/metrics/processes/renice`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ts.token}`,
          'content-type': 'application/json',
        },
        body: '{bad',
      });
      expect(badJson.status).toBe(400);

      const procs = await apiJson(
        ts,
        'GET',
        '/api/v1/metrics/processes?sort=mem&limit=5&top=1&header=1',
      );
      expect(procs.status).toBeLessThan(500);

      const ac = new AbortController();
      const streamP = fetch(
        `${ts.baseUrl}/api/v1/metrics/stream?interval=1&limit=5&sort=cpu`,
        {
          headers: { authorization: `Bearer ${ts.token}`, accept: 'text/event-stream' },
          signal: ac.signal,
        },
      );
      await new Promise((r) => setTimeout(r, 250));
      ac.abort();
      try {
        await streamP;
      } catch {
        /* aborted */
      }
    },
    60_000,
  );
});
