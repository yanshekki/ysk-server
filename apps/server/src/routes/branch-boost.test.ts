/**
 * Dense branch-coverage HTTP harness — query params, validation failures,
 * default-value fallbacks, empty vs non-empty lists, honesty paths.
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

function stubHostInventory(ts: TestServer) {
  const host = ts.ctx.host;
  const orig = host.runCommand.bind(host);
  host.runCommand = async (argv, opts) => {
    const j = argv.join(' ');
    if (
      j.includes('apt list') ||
      j.includes('apt-get') ||
      j.includes('apt-cache') ||
      j.includes('dpkg-query')
    ) {
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    }
    return orig(argv, opts);
  };
}


describe('branch boost — admin / email / hosting filters & defaults', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('admin users list facets: totp, overrides, package, suspended, sort', async () => {
    ts = await startTestServer();

    // create package + user with package for package facet / subscriberCount
    const pkg = await apiJson(ts, 'POST', '/api/v1/packages', {
      name: 'branch-pkg',
      maxProjects: 2,
      maxMailboxes: 2,
      maxDatabases: 1,
      diskMb: 100,
      bandwidthMb: 100,
      allowSsh: false,
      allowFtp: false,
    });
    expect(pkg.status).toBe(201);
    const packageId = (pkg.body as { package?: { id?: string } }).package?.id;

    const user = await apiJson(ts, 'POST', '/api/v1/users', {
      username: 'branch-op',
      password: 'Branch-Pass-88!',
      roles: ['operator'],
      packageId,
      locale: 'en',
    });
    expect(user.status).toBe(201);

    // empty username/password defaults path (validation fail)
    const emptyUser = await apiJson(ts, 'POST', '/api/v1/users', {});
    expect(emptyUser.status).toBeLessThan(500);
    expect((emptyUser.body as { ok?: boolean }).ok).not.toBe(true);

    const emptyPkg = await apiJson(ts, 'POST', '/api/v1/packages', {});
    expect(emptyPkg.status).toBeLessThan(500);

    for (const q of [
      '/api/v1/users?totp=0',
      '/api/v1/users?totp=1',
      '/api/v1/users?status=suspended',
      '/api/v1/users?status=active',
      '/api/v1/users?overrides=1',
      '/api/v1/users?overrides=0',
      '/api/v1/users?package=none',
      `/api/v1/users?package=${packageId ?? 'none'}`,
      '/api/v1/users?role=operator&sort=username',
      '/api/v1/users?sort=lastSeenAt&order=desc',
      '/api/v1/users?q=branch',
      '/api/v1/packages?sort=name',
      '/api/v1/packages?sort=subscriberCount&order=desc',
      '/api/v1/packages?q=branch',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBe(200);
      expect(Array.isArray((res.body as { items?: unknown[] }).items)).toBe(true);
    }
  });

  it('email list filters + empty-body defaults + queue flush by id', async () => {
    ts = await startTestServer();

    // create two domains so sort/filter paths have data
    for (const d of ['z-branch-mail.local', 'a-branch-mail.local']) {
      const created = await apiJson(ts, 'POST', '/api/v1/email/domains', {
        domain: d,
        serverIp: '203.0.113.70',
        serverIpv6: '2001:db8::70',
        mailHostname: `mail.${d}`,
      });
      expect(created.status).toBe(201);
    }

    // empty domain create hits ?? '' defaults
    const emptyDom = await apiJson(ts, 'POST', '/api/v1/email/domains', {});
    expect(emptyDom.status).toBeLessThan(500);

    for (const q of [
      '/api/v1/email/domains?status=draft',
      '/api/v1/email/domains?status=applied',
      '/api/v1/email/domains?status=written',
      '/api/v1/email/domains?status=failed',
      '/api/v1/email/domains?sort=domain&order=asc',
      '/api/v1/email/domains?q=branch',
      '/api/v1/email/mailboxes?q=nobody',
      '/api/v1/email/sieve',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBeLessThan(500);
    }

    // relay with empty body (defaults host '', port 587, security starttls)
    const relay = await apiJson(ts, 'POST', '/api/v1/email/relay', {});
    expect(relay.status).toBeLessThan(500);
    expectHonestOps({
      ok: (relay.body as { ok?: boolean }).ok ?? false,
      blocked: (relay.body as { blocked?: boolean }).blocked,
      apply_status: (relay.body as { apply_status?: string }).apply_status,
      notes: (relay.body as { notes?: string[] }).notes,
    });

    // relay with full optional fields
    const relayFull = await apiJson(ts, 'POST', '/api/v1/email/relay', {
      host: 'smtp.branch.test',
      port: 465,
      username: 'u',
      password: 'p',
      security: 'tls',
      domain: 'branch.test',
      applySystem: false,
    });
    expect(relayFull.status).toBeLessThan(500);

    // webmail apply empty body → default domain
    const webmail = await apiJson(ts, 'POST', '/api/v1/email/webmail/apply', {});
    expect(webmail.status).toBeLessThan(500);

    // bootstrap empty defaults
    const boot = await apiJson(ts, 'POST', '/api/v1/email/bootstrap', {
      installPackages: false,
      webmail: false,
    });
    expect(boot.status).toBeLessThan(500);

    // sso empty
    const sso = await apiJson(ts, 'POST', '/api/v1/email/webmail/sso', {});
    expect(sso.status).toBeLessThan(500);
    expect([200, 400]).toContain(sso.status);

    // sieve write empty + delete empty query
    const sieve = await apiJson(ts, 'POST', '/api/v1/email/sieve', {});
    expect(sieve.status).toBeLessThan(500);
    const sieveDel = await apiJson(ts, 'DELETE', '/api/v1/email/sieve');
    expect(sieveDel.status).toBeLessThan(500);

    // dnsbl multi empty ips
    const multi = await apiJson(ts, 'POST', '/api/v1/email/dnsbl/multi', {});
    expect(multi.status).toBeLessThan(500);

    // warmup empty defaults
    const warmup = await apiJson(ts, 'POST', '/api/v1/email/warmup', {});
    expect(warmup.status).toBe(200);

    // queue flush by id only
    const flush = await apiJson(ts, 'POST', '/api/v1/email/queue/flush', {
      id: 'no-such-queue-id',
    });
    expect(flush.status).toBeLessThan(500);

    // sso consume empty token
    const consume = await apiJson(
      ts,
      'POST',
      '/api/v1/email/webmail/sso/consume',
      {},
      { auth: false },
    );
    expect(consume.status).toBeGreaterThanOrEqual(401);

    // deliverability overview with domains present
    const overview = await apiJson(ts, 'GET', '/api/v1/email/deliverability/overview');
    expect(overview.status).toBeLessThan(500);
  }, 90_000);

  it('hosting empty-body defaults + rust runtime + dns ipv6 + cloudflare live', async () => {
    ts = await startTestServer();

    // empty install → kind node, version 20
    const emptyInstall = await apiJson(ts, 'POST', '/api/v1/hosting/runtimes/install', {});
    expect(emptyInstall.status).toBeLessThan(500);
    expect(typeof (emptyInstall.body as { ok?: boolean }).ok).toBe('boolean');

    // rust default version
    const rust = await apiJson(ts, 'POST', '/api/v1/hosting/runtimes/install', {
      kind: 'rust',
      install: false,
    });
    expect(rust.status).toBeLessThan(500);

    // php.ini GET without version (default 8.2)
    const phpGet = await apiJson(ts, 'GET', '/api/v1/hosting/php/ini');
    expect(phpGet.status).toBe(200);

    // php.ini save empty body defaults
    const phpSave = await apiJson(ts, 'PUT', '/api/v1/hosting/php/ini', {});
    expect(phpSave.status).toBe(200);

    // php apply empty
    const phpApply = await apiJson(ts, 'POST', '/api/v1/hosting/php/ini/apply', {});
    expect(phpApply.status).toBeLessThan(500);

    // nginx sync empty (dryRun undefined)
    const nginx = await apiJson(ts, 'POST', '/api/v1/hosting/nginx/sync', {});
    expect(nginx.status).toBeLessThan(500);

    // db probe empty defaults
    const probe = await apiJson(ts, 'POST', '/api/v1/hosting/db/probe', {});
    expect(probe.status).toBe(200);

    // mysql-plan empty defaults
    const mysqlPlan = await apiJson(ts, 'POST', '/api/v1/hosting/db/mysql-plan', {});
    expect(mysqlPlan.status).toBe(200);

    // dns plan empty + ipv6
    const dnsEmpty = await apiJson(ts, 'POST', '/api/v1/hosting/dns/plan', {});
    expect(dnsEmpty.status).toBe(200);
    const dnsV6 = await apiJson(ts, 'POST', '/api/v1/hosting/dns/plan', {
      zone: 'v6-branch.local',
      serverIp: '203.0.113.90',
      serverIpv6: '2001:db8::90',
    });
    expect(dnsV6.status).toBe(200);

    // zone-file empty defaults
    const zf = await apiJson(ts, 'POST', '/api/v1/hosting/dns/zone-file', {});
    expect(zf.status).toBeLessThan(500);

    // powerdns install empty + load empty
    const pdnsI = await apiJson(ts, 'POST', '/api/v1/hosting/dns/powerdns/install', {});
    expect(pdnsI.status).toBeLessThan(500);
    const pdnsL = await apiJson(ts, 'POST', '/api/v1/hosting/dns/powerdns/load', {});
    expect(pdnsL.status).toBeLessThan(500);

    // cloudflare without dryRun
    const cf = await apiJson(ts, 'POST', '/api/v1/hosting/dns/cloudflare/apply', {
      zone: 'cf-branch.local',
      serverIp: '203.0.113.91',
    });
    expect(cf.status).toBeLessThan(500);

    // firewall empty
    const fw = await apiJson(ts, 'POST', '/api/v1/hosting/firewall/plan', {});
    expect(fw.status).toBe(200);

    // files apply empty
    const files = await apiJson(ts, 'POST', '/api/v1/hosting/files/apply', {});
    expect(files.status).toBeLessThan(500);

    // provision empties
    for (const path of [
      '/api/v1/hosting/db/redis-provision',
      '/api/v1/hosting/db/postgres-provision',
      '/api/v1/hosting/db/mysql-provision',
    ]) {
      const res = await apiJson(ts, 'POST', path, {});
      expect(res.status).toBeLessThan(500);
      const r = res.body as { apply_status?: string; ok?: boolean };
      if (typeof r.ok === 'boolean') {
        expect(r.apply_status).not.toBe('applied');
      }
    }
  }, 90_000);
});

describe('branch boost — auth / backups / ssh / cdn', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('auth login x-forwarded-for + empty fields + locale default + devices', async () => {
    ts = await startTestServer();

    // empty login body
    const emptyLogin = await apiJson(
      ts,
      'POST',
      '/api/v1/auth/login',
      {},
      { auth: false },
    );
    expect(emptyLogin.status).toBeGreaterThanOrEqual(400);

    // x-forwarded-for multi hop
    const xff = await fetch(`${ts.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.1, 198.51.100.2',
        'user-agent': 'branch-boost-agent',
      },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(xff.status).toBeGreaterThanOrEqual(400);

    // locale without locale field → zh-HK default
    const locale = await apiJson(ts, 'PATCH', '/api/v1/auth/locale', {});
    expect(locale.status).toBe(200);

    // step-up empty code
    const step = await apiJson(ts, 'POST', '/api/v1/auth/totp/step-up', {});
    expect(step.status).toBeLessThan(500);

    // api-key create default name/scope without step-up
    const key = await apiJson(ts, 'POST', '/api/v1/auth/api-keys', {});
    expect(key.status).toBeLessThan(500);

    // delete missing device + session
    const delDev = await apiJson(ts, 'DELETE', '/api/v1/auth/devices/no-such-device');
    expect(delDev.status).toBeLessThan(500);
    const delSess = await apiJson(ts, 'DELETE', '/api/v1/auth/sessions/no-such');
    expect(delSess.status).toBeLessThan(500);

    // totp confirm/disable empty
    const confirm = await apiJson(ts, 'POST', '/api/v1/auth/totp/confirm', {});
    expect(confirm.status).toBeLessThan(500);
    const disable = await apiJson(ts, 'POST', '/api/v1/auth/totp/disable', {});
    expect(disable.status).toBeLessThan(500);
  });

  it('backups list filters + restic password missing + settings remote/restic', async () => {
    ts = await startTestServer();

    const list = await apiJson(
      ts,
      'GET',
      '/api/v1/backups?q=zzz-no-match&projectId=no-proj',
    );
    expect(list.status).toBe(200);

    // enable restic without password → 422
    await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      restic: { enabled: true, repository: '/tmp/ysk-restic-no-pass' },
    });
    const noPass = await apiJson(ts, 'POST', '/api/v1/backups/restic/run', {});
    expect(noPass.status).toBe(422);
    expect((noPass.body as { ok?: boolean }).ok).toBe(false);

    // settings with remote + restic full
    const set = await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      remote: { enabled: false, kind: 'local', path: '/tmp/ysk-bak-branch' },
      exclusions: [],
      restic: {
        enabled: true,
        password: 'Branch-Restic-Password-99',
        repository: '/tmp/ysk-restic-branch',
      },
    });
    expect(set.status).toBe(200);

    // empty projects restic run → empty true
    const emptyRun = await apiJson(ts, 'POST', '/api/v1/backups/restic/run', {});
    expect(emptyRun.status).toBeLessThan(500);

    // restore with project missing already covered; restic restore missing project
    const resticRestore = await apiJson(ts, 'POST', '/api/v1/backups/restic/restore', {
      projectId: 'no-such-project',
      snapshotId: 'snap',
      dryRun: true,
    });
    expect(resticRestore.status).toBe(404);

    // snapshots with projectId
    const snaps = await apiJson(
      ts,
      'GET',
      '/api/v1/backups/restic/snapshots?projectId=no-such',
    );
    expect(snaps.status).toBeLessThan(500);

    // status after settings
    const status = await apiJson(ts, 'GET', '/api/v1/backups/status');
    expect(status.status).toBe(200);
    expect((status.body as { ok?: boolean }).ok).toBe(true);
  });

  it('ssh purpose filters + sftp projectId miss + identity install false + pam recovery', async () => {
    ts = await startTestServer();

    for (const purpose of ['user_outbound', 'panel_outbound', 'unbound', 'invalid']) {
      const res = await apiJson(
        ts,
        'GET',
        `/api/v1/ssh/identities?purpose=${purpose}&linuxUser=ysk_x&projectId=nope`,
      );
      expect(res.status).toBe(200);
    }

    // sftp key with invalid projectId
    const sftp = await apiJson(ts, 'POST', '/api/v1/sftp/keys', {
      projectId: 'no-such-project',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBranchBoostKey00000000000000000000 branch@test',
      comment: 'branch',
    });
    expect(sftp.status).toBeLessThan(500);

    // empty sftp key
    const sftpEmpty = await apiJson(ts, 'POST', '/api/v1/sftp/keys', {});
    expect(sftpEmpty.status).toBeLessThan(500);

    // identity create empty name
    const idEmpty = await apiJson(ts, 'POST', '/api/v1/ssh/identities', {});
    expect(idEmpty.status).toBeLessThan(500);

    // identity create with install=true (fail-closed without EXECUTE)
    const idInstall = await apiJson(ts, 'POST', '/api/v1/ssh/identities', {
      name: 'branch-id-install',
      algorithm: 'ed25519',
      purpose: 'panel_outbound',
      install: true,
      revealPrivate: true,
      comment: 'cov',
      binding: { linuxUser: 'ysk_branch', homeDir: '/tmp/ysk-branch-ssh' },
    });
    expect(idInstall.status).toBeLessThan(500);

    // import empty
    const imp = await apiJson(ts, 'POST', '/api/v1/ssh/identities/import', {});
    expect(imp.status).toBeLessThan(500);

    // 2fa list filters + pam recovery query
    const fa = await apiJson(ts, 'GET', '/api/v1/ssh/2fa?linuxUser=root&projectId=x');
    expect(fa.status).toBeLessThan(500);
    const pam = await apiJson(
      ts,
      'GET',
      '/api/v1/ssh/2fa/pam-snippet?recovery=root,admin',
    );
    expect(pam.status).toBeLessThan(500);

    // sshd apply empty body
    const sshd = await apiJson(ts, 'POST', '/api/v1/sftp/sshd-snippet/apply', {});
    expect(sshd.status).toBeLessThan(500);
  });

  it('cdn node/site string fields + list q + originShield null', async () => {
    ts = await startTestServer();

    const node = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {
      name: 'branch-edge',
      baseUrl: 'https://branch-edge.test',
      sshPort: 2222,
      weight: 5,
      publicIpv4: ['203.0.113.120'],
      publicIpv6: ['2001:db8::120'],
      roles: ['edge', 'shield'],
    });
    expect(node.status).toBe(200);
    const nodeId = (node.body as { node?: { id?: string } }).node?.id;

    const site = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
      name: 'branch-site',
      domains: ['branch-cdn.test'],
      edgeNodeIds: [nodeId!],
      origin: { kind: 'project', projectId: 'no-proj' },
      originShieldNodeId: null,
      ssl: { mode: 'off' },
    });
    expect(site.status).toBeLessThan(500);

    // empty name site
    const emptySite = await apiJson(ts, 'POST', '/api/v1/cdn/sites', {
      edgeNodeIds: [nodeId!],
    });
    expect(emptySite.status).toBeLessThan(500);

    // empty node
    const emptyNode = await apiJson(ts, 'POST', '/api/v1/cdn/nodes', {});
    expect(emptyNode.status).toBeLessThan(500);

    const listN = await apiJson(ts, 'GET', '/api/v1/cdn/nodes?q=branch');
    expect(listN.status).toBe(200);
    const listS = await apiJson(ts, 'GET', '/api/v1/cdn/sites?q=branch');
    expect(listS.status).toBe(200);
  });
});

describe('branch boost — controllers logs/network/metrics + misc routes', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('logs query params + vacuum + bookmarks + journal unit', async () => {
    ts = await startTestServer();

    for (const path of [
      '/api/v1/logs/journal/query?unit=nginx&lines=10&since=1h&priority=3&grep=error',
      '/api/v1/logs/query?source=journal:&lines=5&since=1h&priority=err&grep=ysk',
      '/api/v1/logs/query?source=',
      '/api/v1/logs/journal/query',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
    }

    const vac = await apiJson(ts, 'POST', '/api/v1/logs/journal/vacuum', {});
    expect(vac.status).toBeLessThan(500);
    const vacSize = await apiJson(ts, 'POST', '/api/v1/logs/journal/vacuum', {
      mode: 'size',
      value: '100M',
    });
    expect(vacSize.status).toBeLessThan(500);

    const bm = await apiJson(ts, 'POST', '/api/v1/logs/bookmarks', {
      source: 'journal:',
      note: 'branch',
    });
    expect(bm.status).toBeLessThan(500);
    const bmEmpty = await apiJson(ts, 'POST', '/api/v1/logs/bookmarks', {});
    expect(bmEmpty.status).toBeLessThan(500);

    const bmId =
      (bm.body as { bookmark?: { id?: string }; id?: string }).bookmark?.id ??
      (bm.body as { id?: string }).id;
    if (bmId) {
      const del = await apiJson(ts, 'DELETE', `/api/v1/logs/bookmarks/${bmId}`);
      expect(del.status).toBeLessThan(500);
    }
    const delMiss = await apiJson(ts, 'DELETE', '/api/v1/logs/bookmarks/no-such');
    expect(delMiss.status).toBeLessThan(500);

    // settings put empty
    const settings = await apiJson(ts, 'PUT', '/api/v1/logs/settings', {});
    expect(settings.status).toBeLessThan(500);

    // logrotate
    const lr = await apiJson(ts, 'POST', '/api/v1/logs/logrotate/apply', {});
    expect(lr.status).toBeLessThan(500);
  });

  it('network invalid JSON + link action/mtu + dns string form + routes defaults', async () => {
    ts = await startTestServer();

    const headers = {
      authorization: `Bearer ${ts.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };

    for (const path of [
      '/api/v1/network/interfaces/lo/addr',
      '/api/v1/network/interfaces/lo/link',
      '/api/v1/network/routes',
      '/api/v1/network/dns',
    ]) {
      const method = path.endsWith('/dns') ? 'PUT' : 'POST';
      const bad = await fetch(`${ts.baseUrl}${path}`, {
        method,
        headers,
        body: '{not-json',
      });
      expect(bad.status).toBe(400);
    }

    // empty body → {}
    const emptyAddr = await apiJson(ts, 'POST', '/api/v1/network/interfaces/lo/addr', {});
    expect(emptyAddr.status).toBeLessThan(500);

    // link invalid action + mtu
    const link = await apiJson(ts, 'POST', '/api/v1/network/interfaces/lo/link', {
      action: 'flip',
      mtu: '1500',
      confirmName: 'lo',
    });
    expect(link.status).toBeLessThan(500);

    const linkUp = await apiJson(ts, 'POST', '/api/v1/network/interfaces/lo/link', {
      action: 'up',
      mtu: '',
    });
    expect(linkUp.status).toBeLessThan(500);

    // routes empty defaults dst=default
    const route = await apiJson(ts, 'POST', '/api/v1/network/routes', {});
    expect(route.status).toBeLessThan(500);
    const routeFull = await apiJson(ts, 'POST', '/api/v1/network/routes', {
      dst: '10.0.0.0/8',
      gateway: '127.0.0.1',
      dev: 'lo',
      confirmDefault: false,
      persistent: false,
    });
    expect(routeFull.status).toBeLessThan(500);
    const delRoute = await apiJson(ts, 'DELETE', '/api/v1/network/routes', {
      dst: '10.0.0.0/8',
      dev: 'lo',
    });
    expect(delRoute.status).toBeLessThan(500);

    // dns string nameservers + search + dhcp
    const dnsStr = await apiJson(ts, 'PUT', '/api/v1/network/dns', {
      nameservers: '1.1.1.1, 8.8.8.8',
      search: 'example.com lab.local',
      mode: 'static',
      connection: 'Wired connection 1',
      device: 'eth0',
    });
    expect(dnsStr.status).toBeLessThan(500);

    const dnsDhcp = await apiJson(ts, 'PUT', '/api/v1/network/dns', {
      nameservers: [],
      mode: 'dhcp',
    });
    expect(dnsDhcp.status).toBeLessThan(500);

    // network raw snapshot
    const raw = await apiJson(ts, 'GET', '/api/v1/network?raw=1');
    expect(raw.status).toBeLessThan(500);

    // dns test
    const dnsTest = await apiJson(ts, 'POST', '/api/v1/network/dns/test', {
      name: 'example.com',
    });
    expect(dnsTest.status).toBeLessThan(500);
    const dnsTestEmpty = await apiJson(ts, 'POST', '/api/v1/network/dns/test', {});
    expect(dnsTestEmpty.status).toBeLessThan(500);
  }, 60_000);

  it('metrics sort/limit variants + invalid signal/JSON + renice + process detail', async () => {
    ts = await startTestServer();

    for (const q of [
      '/api/v1/metrics/processes?sort=mem&limit=5&top=1&header=0',
      '/api/v1/metrics/processes?sort=time&limit=3',
      '/api/v1/metrics/processes?sort=pid',
      '/api/v1/metrics/processes?sort=bogus',
      '/api/v1/metrics/projects?limit=2',
      '/api/v1/metrics/projects?limit=not-a-number',
      '/api/v1/metrics/processes/1',
      '/api/v1/metrics/top',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBeLessThan(500);
    }

    // invalid signal
    const badSig = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      pid: 1,
      signal: 'NOPE',
    });
    expect(badSig.status).toBe(400);

    // KILL without confirm
    const kill = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      pid: 1,
      signal: 'KILL',
    });
    expect(kill.status).toBe(400);

    // KILL with confirm (honest without execute)
    const killOk = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      pid: 999999,
      signal: 'KILL',
      confirmKill: true,
      forceSelf: true,
      forceControlPlane: true,
    });
    expect(killOk.status).toBeLessThan(500);

    // TERM empty pid
    const term = await apiJson(ts, 'POST', '/api/v1/metrics/processes/signal', {
      signal: 'TERM',
    });
    expect(term.status).toBeLessThan(500);

    // invalid JSON signal/renice
    for (const path of [
      '/api/v1/metrics/processes/signal',
      '/api/v1/metrics/processes/renice',
    ]) {
      const bad = await fetch(`${ts.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ts.token}`,
          'content-type': 'application/json',
        },
        body: '{bad',
      });
      expect(bad.status).toBe(400);
    }

    const renice = await apiJson(ts, 'POST', '/api/v1/metrics/processes/renice', {});
    expect(renice.status).toBeLessThan(500);

    // short-lived metrics stream with sort=mem
    const ac = new AbortController();
    const stream = await fetch(
      `${ts.baseUrl}/api/v1/metrics/stream?interval=1&limit=3&sort=mem&top=1`,
      {
        headers: { authorization: `Bearer ${ts.token}` },
        signal: ac.signal,
      },
    );
    expect(stream.status).toBe(200);
    // read a bit then abort
    const reader = stream.body?.getReader();
    if (reader) {
      await reader.read();
      ac.abort();
      try {
        reader.releaseLock();
      } catch {
        /* */
      }
    }
  }, 60_000);

  it('dns/db/projects/agents/ssl/ai/cron/updates validation & list branches', async () => {
    ts = await startTestServer();
    stubHostInventory(ts);

    // DNS records validate empty
    const dnsVal = await apiJson(ts, 'POST', '/api/v1/dns/validate', {});
    expect(dnsVal.status).toBeLessThan(500);

    // external checklist scopes + missing domain
    const noDom = await apiJson(ts, 'GET', '/api/v1/dns/external-checklist');
    expect(noDom.status).toBe(400);
    for (const scope of ['web', 'mail', 'full', 'other']) {
      const res = await apiJson(
        ts,
        'GET',
        `/api/v1/dns/external-checklist?domain=branch-dns.local&scope=${scope}`,
      );
      expect(res.status).toBe(200);
    }

    // cluster peer empty defaults + push/reload/probe with peerId
    const peer = await apiJson(ts, 'POST', '/api/v1/dns/cluster/peers', {});
    expect(peer.status).toBeLessThan(500);
    const peerOk = await apiJson(ts, 'POST', '/api/v1/dns/cluster/peers', {
      host: '203.0.113.200',
      username: 'root',
      port: 22,
      path: '/etc/bind',
      label: 'peer-branch',
    });
    expect(peerOk.status).toBe(200);
    const peerId = (peerOk.body as { peer?: { id?: string } }).peer?.id;
    for (const path of [
      '/api/v1/dns/cluster/push',
      '/api/v1/dns/cluster/reload',
      '/api/v1/dns/cluster/probe',
    ]) {
      const res = await apiJson(ts, 'POST', path, {
        peerId,
        reload: false,
        probeAfter: false,
      });
      expect(res.status).toBeLessThan(500);
    }
    const lookup = await apiJson(ts, 'POST', '/api/v1/dns/lookup', {});
    expect(lookup.status).toBeLessThan(500);
    const lookupA = await apiJson(ts, 'POST', '/api/v1/dns/lookup', {
      name: 'example.com',
      type: 'AAAA',
    });
    expect(lookupA.status).toBeLessThan(500);

    // db empty defaults
    const adminer = await apiJson(ts, 'POST', '/api/v1/db/adminer/apply', {});
    expect(adminer.status).toBeLessThan(500);
    const expire = await apiJson(ts, 'POST', '/api/v1/db/temp-users/expire', {
      dropSystem: false,
    });
    expect(expire.status).toBeLessThan(500);
    const tempUser = await apiJson(ts, 'POST', '/api/v1/db/temp-users', {
      apply: false,
    });
    expect(tempUser.status).toBeLessThan(500);
    const remote = await apiJson(ts, 'POST', '/api/v1/db/remote-hosts', {});
    expect(remote.status).toBeLessThan(500);
    const remote2 = await apiJson(ts, 'POST', '/api/v1/db/remote-hosts', {
      engine: 'postgres',
      host: '127.0.0.1',
      port: 5432,
    });
    expect(remote2.status).toBe(200);
    for (const eng of ['mysql', 'postgres', 'redis', 'bogus']) {
      const res = await apiJson(ts, 'GET', `/api/v1/db/clusters?engine=${eng}`);
      expect(res.status).toBe(200);
    }
    const cluster = await apiJson(ts, 'POST', '/api/v1/db/clusters', {});
    expect(cluster.status).toBeLessThan(500);
    const clusterOk = await apiJson(ts, 'POST', '/api/v1/db/clusters', {
      name: 'branch-cluster',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [{ host: '127.0.0.1', role: 'primary' }],
    });
    expect(clusterOk.status).toBeLessThan(500);

    // projects empty create
    const projEmpty = await apiJson(ts, 'POST', '/api/v1/projects', {});
    expect(projEmpty.status).toBeLessThan(500);

    // projects list sort
    const pA = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'BranchProjA',
      domain: 'branch-a.test',
      runtime: 'static',
    });
    const pB = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'BranchProjB',
      domain: 'branch-b.test',
      runtime: 'node',
      serverIpv6: '2001:db8::b',
    });
    for (const q of [
      '/api/v1/projects?sort=domain',
      '/api/v1/projects?q=branch',
      '/api/v1/projects?runtime=node',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBe(200);
    }
    const projectId =
      (pA.body as { project?: { id?: string } }).project?.id ??
      (pA.body as { id?: string }).id;
    if (projectId) {
      const health = await apiJson(ts, 'GET', `/api/v1/projects/${projectId}/health`);
      // honest: 200 healthy or 503 degraded — never 5xx crash
      expect([200, 503]).toContain(health.status);
      // sftp key bound to real project
      const sftp = await apiJson(ts, 'POST', '/api/v1/sftp/keys', {
        projectId,
        publicKey:
          'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBranchBoostKey11111111111111111111 branch@proj',
      });
      expect(sftp.status).toBeLessThan(500);
    }
    void pB;

    // agents register empty + with id
    const agentReg = await apiJson(
      ts,
      'POST',
      '/api/v1/agents/register',
      {},
      { auth: false },
    );
    expect(agentReg.status).toBeLessThan(500);
    await apiJson(
      ts,
      'POST',
      '/api/v1/agents/register',
      { agentId: 'branch-agent-1' },
      { auth: false },
    );
    const runtimes = await apiJson(ts, 'GET', '/api/v1/agents/runtimes?q=node');
    expect(runtimes.status).toBeLessThan(500);

    // fleet register + list filters + commands + ack
    const fleet = await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/agents/register',
      {
        agentId: 'fleet-branch-1',
        group: 'edge',
        meta: { host: 'edge-1' },
      },
      { auth: false },
    );
    expect(fleet.status).toBeLessThan(500);
    const fleetId =
      (fleet.body as { id?: string; agentId?: string }).id ??
      (fleet.body as { agentId?: string }).agentId ??
      'fleet-branch-1';
    for (const q of [
      '/api/v1/fleet/agents?status=online',
      '/api/v1/fleet/agents?status=unknown',
      '/api/v1/fleet/agents?group=edge&q=fleet',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBe(200);
    }
    await apiJson(
      ts,
      'POST',
      `/api/v1/fleet/agents/${fleetId}/heartbeat`,
      {},
      { auth: false },
    );
    const cmd = await apiJson(ts, 'POST', `/api/v1/fleet/agents/${fleetId}/commands`, {});
    expect(cmd.status).toBeLessThan(500);
    const cmdId = (cmd.body as { id?: string }).id;
    await apiJson(ts, 'GET', `/api/v1/fleet/agents/${fleetId}/commands`);
    await apiJson(ts, 'GET', `/api/v1/fleet/agents/${fleetId}/commands?history=1`);
    if (cmdId) {
      await apiJson(
        ts,
        'POST',
        `/api/v1/fleet/commands/${cmdId}/ack`,
        { result: { ok: true }, error: false },
        { auth: false },
      );
    }
    await apiJson(
      ts,
      'POST',
      '/api/v1/fleet/commands/no-such/ack',
      {},
      { auth: false },
    );
    await apiJson(ts, 'DELETE', `/api/v1/fleet/agents/${fleetId}`);

    // ssl import empty
    const ssl = await apiJson(ts, 'POST', '/api/v1/ssl/certificates', {});
    expect(ssl.status).toBeLessThan(500);
    const sslList = await apiJson(ts, 'GET', '/api/v1/ssl/certificates?q=x');
    expect(sslList.status).toBeLessThan(500);

    // ai chat empty
    const chat = await apiJson(ts, 'POST', '/api/v1/ai/chat', {});
    expect(chat.status).toBeLessThan(500);
    const task = await apiJson(ts, 'POST', '/api/v1/ai/tasks', {});
    expect(task.status).toBeLessThan(500);
    const play = await apiJson(ts, 'POST', '/api/v1/ai/playbooks/run', {});
    expect(play.status).toBeLessThan(500);
    const rca = await apiJson(ts, 'POST', '/api/v1/ai/rca', {});
    expect(rca.status).toBeLessThan(500);

    // cron list
    const cron = await apiJson(ts, 'GET', '/api/v1/cron');
    expect(cron.status).toBeLessThan(500);

    // updates inventory filters + advice empty body
    for (const q of [
      '/api/v1/updates/inventory?risk=high',
      '/api/v1/updates/inventory?upgradable=1',
      '/api/v1/updates/inventory?approval=1',
      '/api/v1/updates/inventory?q=nginx',
    ]) {
      const res = await apiJson(ts, 'GET', q);
      expect(res.status).toBeLessThan(500);
    }

    const refresh = await apiJson(ts, 'POST', '/api/v1/updates/inventory/refresh', {});
    expect(refresh.status).toBeLessThan(500);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.osv.dev')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vulns: [] }),
          text: async () => '{}',
        } as Response;
      }
      return origFetch(input as never, init);
    }) as typeof fetch;
    let refreshOsv: Awaited<ReturnType<typeof apiJson>>;
    try {
      refreshOsv = await apiJson(ts, 'POST', '/api/v1/updates/inventory/refresh', {
        osv: true,
        limit: 3,
      });
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(refreshOsv.status).toBeLessThan(500);
    const invCached = await apiJson(ts, 'GET', '/api/v1/updates/inventory?cached=1&risk=low');
    expect(invCached.status).toBeLessThan(500);
    const applyEmpty = await apiJson(ts, 'POST', '/api/v1/updates/apply', {});
    expect(applyEmpty.status).toBe(422);
    const applyFull = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'nginx',
      currentVersion: '1.0.0',
      candidateVersion: '1.1.0',
      cves: ['CVE-2024-0001 HIGH'],
      requiresApproval: true,
      summary: 'branch test',
      risk: 'high',
      confirmHighRisk: false,
    });
    expect(applyFull.status).toBeLessThan(500);
    const self = await apiJson(ts, 'GET', '/api/v1/updates/self');
    expect(self.status).toBeLessThan(500);

    // public health + mail autoconfig paths
    for (const path of ['/api/v1/health', '/health', '/api/v1/status']) {
      const res = await apiJson(ts, 'GET', path, undefined, { auth: false });
      expect(res.status).toBeLessThan(500);
    }
    const ready = await apiJson(ts, 'GET', '/api/v1/readiness', undefined, { auth: false });
    // honest: 200 production-ready or 503 not-ready
    expect([200, 503]).toContain(ready.status);
    // autoconfig domain + emailaddress variants
    const auto1 = await fetch(
      `${ts.baseUrl}/mail/config-v1.1.xml?domain=branch-mail.local`,
    );
    expect(auto1.status).toBeLessThan(500);
    const auto2 = await fetch(
      `${ts.baseUrl}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=u@branch-mail.local`,
    );
    expect(auto2.status).toBeLessThan(500);
    const auto3 = await fetch(
      `${ts.baseUrl}/autodiscover/autodiscover.xml?email=u@branch-mail.local`,
    );
    expect(auto3.status).toBeLessThan(500);
    const autoBad = await fetch(`${ts.baseUrl}/mail/config-v1.1.xml`);
    expect(autoBad.status).toBe(400);

    // email domain then autodiscover
    const em = await apiJson(ts, 'POST', '/api/v1/email/domains', {
      domain: 'branch-mail.local',
      serverIp: '203.0.113.77',
      mailHostname: 'mail.branch-mail.local',
    });
    const emId =
      (em.body as { id?: string }).id ??
      (em.body as { domain?: { id?: string } }).domain?.id;
    if (emId) {
      const ad = await apiJson(ts, 'GET', `/api/v1/email/domains/${emId}/autodiscover`);
      expect(ad.status).toBeLessThan(500);
      const deliv = await apiJson(
        ts,
        'GET',
        `/api/v1/email/domains/${emId}/deliverability`,
      );
      expect(deliv.status).toBeLessThan(500);
    }

    // cdn site health-loop empty
    const hl = await apiJson(ts, 'POST', '/api/v1/cdn/sites/no-such/health-loop', {});
    expect(hl.status).toBeLessThan(500);
  }, 180_000);
});
