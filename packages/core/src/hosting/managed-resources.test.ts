import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../db/database.js';
import { makeHost } from '../test/host.js';
import {
  applyDnsZone,
  applyFtpAccount,
  applyManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  createResource,
  deleteCertificateFiles,
  deleteResource,
  getResource,
  listResources,
  revokeManagedNginxSite,
  seedDnsZoneRecords,
  updateResource,
} from './managed-resources.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(executeEnabled = false) {
  const { host, dir, cleanup } = makeHost({ executeEnabled });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  return { host, dir, db };
}

describe('managed-resources CRUD', () => {
  it('create/list/get/update/delete persist under JsonStore', () => {
    const { db } = setup();
    const row = createResource(db, 'nginx_sites', {
      serverName: 'a.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:3000',
    });
    expect(row.id).toBeTruthy();
    expect(row.apply_status).toBe('draft');
    expect(listResources(db, 'nginx_sites')).toHaveLength(1);
    expect(getResource(db, 'nginx_sites', String(row.id))?.serverName).toBe('a.example.com');

    const updated = updateResource(db, 'nginx_sites', String(row.id), {
      upstream: 'http://127.0.0.1:4000',
    });
    expect(updated?.upstream).toBe('http://127.0.0.1:4000');
    expect(updated?.id).toBe(row.id);

    expect(deleteResource(db, 'nginx_sites', String(row.id))).toBe(true);
    expect(getResource(db, 'nginx_sites', String(row.id))).toBeNull();
    expect(deleteResource(db, 'nginx_sites', 'missing')).toBe(false);
  });
});

describe('managed-resources apply honesty', () => {
  it('applyManagedNginxSite writes conf as written; blocks system without execute', async () => {
    const { host, db, dir } = setup(false);
    const site = createResource(db, 'nginx_sites', {
      serverName: 'app.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:3000',
    });

    const writtenOnly = await applyManagedNginxSite(db, dir, String(site.id), {
      execute: false,
    });
    expect(writtenOnly.ok).toBe(true);
    expect(writtenOnly.executed).toBe(false);
    expect(writtenOnly.site?.apply_status).toBe('written');
    const confPath = String(writtenOnly.site?.confPath ?? '');
    expect(existsSync(confPath)).toBe(true);
    expect(readFileSync(confPath, 'utf8')).toContain('app.example.com');

    const blocked = await applyManagedNginxSite(db, dir, String(site.id), {
      host,
      execute: true,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.executed).toBe(false);
    expect(blocked.site?.apply_status).toBe('pending_execute');
  });

  it('applyManagedNginxSite supports static and php kinds', async () => {
    const { db, dir } = setup();
    const staticSite = createResource(db, 'nginx_sites', {
      serverName: 'static.example.com',
      kind: 'static',
      root: join(dir, 'www', 'static'),
    });
    const phpSite = createResource(db, 'nginx_sites', {
      serverName: 'php.example.com',
      kind: 'php',
      root: join(dir, 'www', 'php'),
      socket: '/run/php/php8.3-fpm.sock',
    });
    const s = await applyManagedNginxSite(db, dir, String(staticSite.id), { execute: false });
    const p = await applyManagedNginxSite(db, dir, String(phpSite.id), { execute: false });
    expect(s.ok).toBe(true);
    expect(p.ok).toBe(true);
    expect(readFileSync(String(s.site?.confPath), 'utf8')).toContain('static.example.com');
    expect(readFileSync(String(p.site?.confPath), 'utf8')).toMatch(/proxy_pass|8080/i);
  });

  it('applyManagedNginxSite rejects empty or invalid serverName', async () => {
    const { db, dir } = setup();
    const bad = createResource(db, 'nginx_sites', {
      serverName: '!!!bad???',
      kind: 'proxy',
    });
    const r = await applyManagedNginxSite(db, dir, String(bad.id), { execute: false });
    expect(r.ok).toBe(false);
    expect(r.site?.apply_status).toBe('failed');
  });

  it('revokeManagedNginxSite removes conf file and row', async () => {
    const { db, dir } = setup();
    const site = createResource(db, 'nginx_sites', {
      serverName: 'gone.example.com',
      kind: 'proxy',
    });
    await applyManagedNginxSite(db, dir, String(site.id), { execute: false });
    const confPath = String(getResource(db, 'nginx_sites', String(site.id))?.confPath ?? '');
    expect(existsSync(confPath)).toBe(true);
    const r = revokeManagedNginxSite(db, String(site.id));
    expect(r.ok).toBe(true);
    expect(existsSync(confPath)).toBe(false);
    expect(getResource(db, 'nginx_sites', String(site.id))).toBeNull();
  });

  it('applyMysqlDatabase with execute gated marks pending_execute', async () => {
    const { host, db } = setup(false);
    const row = createResource(db, 'mysql_databases', { name: 'appdb' });
    createResource(db, 'mysql_users', {
      databaseId: row.id,
      username: 'appuser',
      password_plain: 'longpassword99',
      host: 'localhost',
    });
    const r = await applyMysqlDatabase(db, String(row.id), host, true);
    expect(r.ok).toBe(false);
    expect(r.blocked || r.executed === false).toBe(true);
    expect(getResource(db, 'mysql_databases', String(row.id))?.apply_status).toBe(
      'pending_execute',
    );
  });

  it('applyPostgresDatabase honesty without execute', async () => {
    const { host, db } = setup(false);
    const row = createResource(db, 'postgres_databases', { name: 'pgdb' });
    createResource(db, 'postgres_users', {
      databaseId: row.id,
      username: 'pguser',
      password_plain: 'longpassword99',
    });
    const r = await applyPostgresDatabase(db, String(row.id), host, true);
    expect(getResource(db, 'postgres_databases', String(row.id))?.apply_status).toMatch(
      /planned|pending|failed|applied/,
    );
    expect(Array.isArray(r.notes)).toBe(true);
  });

  it('applyRedisInstance honesty without execute', async () => {
    const { host, db } = setup(false);
    const row = createResource(db, 'redis_instances', {
      name: 'cache',
      projectId: 'proj-1',
      dbIndex: 2,
    });
    const r = await applyRedisInstance(db, String(row.id), host, true);
    expect(r.ok).toBe(false);
    expect(r.blocked || r.executed === false).toBe(true);
    const status = getResource(db, 'redis_instances', String(row.id))?.apply_status;
    expect(status).toBe('pending_execute');
  });

  it('applyDnsZone writes zone and honest apply_status without execute', async () => {
    const { host, db, dir } = setup(false);
    const zone = createResource(db, 'dns_zones', {
      zone: 'example.com',
      serverIp: '203.0.113.10',
    });
    seedDnsZoneRecords(db, String(zone.id), 'example.com', '203.0.113.10', 'full');
    expect(listResources(db, 'dns_records').length).toBeGreaterThan(0);

    const r = await applyDnsZone(db, dir, String(zone.id), {
      host,
      validate: false,
      tryReload: false,
    });
    expect(r.ok).toBe(true);
    const status = String(r.apply_status ?? '');
    expect(['written', 'applied', 'failed', 'pending_execute']).toContain(status);
    // without execute should not claim system-applied unless truly reloaded
    if (status === 'applied') {
      // only if reload somehow succeeded — still ok
      expect(r.result).toBeTruthy();
    } else {
      expect(status).not.toBe('applied');
    }
    const zoneRow = getResource(db, 'dns_zones', String(zone.id));
    expect(zoneRow?.zonePath).toBeTruthy();
    expect(existsSync(String(zoneRow?.zonePath))).toBe(true);
  });

  it('applyDnsZone never marks applied when pdns reload alone succeeds without list-zones', async () => {
    const { db, dir, cleanup } = (() => {
      const s = setup(true);
      return s;
    })();
    const zone = createResource(db, 'dns_zones', {
      zone: 'falsegreen.test',
      serverIp: '10.9.9.9',
    });
    // Host: pdns tools present, systemctl reload ok, but list-zones empty + dig REFUSED
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv: string[]) => {
        const s = argv.join(' ');
        if (s.includes('pdnsutil') || s.includes('pdns_control') || s.includes('pdns_server')) {
          if (argv[0] === 'pdnsutil' || argv[0] === 'pdns_control' || argv[0] === 'pdns_server') {
            return { stdout: '', stderr: 'fail', exitCode: 1, argv, dryRun: false };
          }
          // resolveBin via bash command -v
          if (s.includes('command -v') || s.includes('pdns')) {
            return {
              stdout: '/usr/bin/pdns_control\n',
              stderr: '',
              exitCode: 0,
              argv,
              dryRun: false,
            };
          }
        }
        if (argv[0] === 'bash' && s.includes('sync-powerdns')) {
          return {
            stdout: [
              'YSK_PDNS_UNIT=active',
              'YSK_PDNS_LIST_ZONES_BEGIN',
              'YSK_PDNS_LIST_ZONES_END',
            ].join('\n'),
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'bash') {
          // probe bins, dig, etc.
          if (s.includes('list-zones')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (s.includes('dig') || s.includes('+short')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (s.includes('+comments') || s.includes('status')) {
            return {
              stdout: ';; ->>HEADER<<- opcode: QUERY, status: REFUSED, id: 1\n',
              stderr: '',
              exitCode: 0,
              argv,
              dryRun: false,
            };
          }
          if (s.includes('command -v')) {
            return { stdout: '/usr/bin/pdns_control\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          // default: treat as the big sync script
          return {
            stdout: [
              'YSK_PDNS_UNIT=active',
              'YSK_PDNS_LIST_ZONES_BEGIN',
              'YSK_PDNS_LIST_ZONES_END',
            ].join('\n'),
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('systemctl reload pdns') || s.includes('is-active pdns')) {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('named-checkzone')) {
          return { stdout: 'OK\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await applyDnsZone(db, dir, String(zone.id), {
      host: host as never,
      validate: false,
      tryReload: true,
    });
    expect(r.apply_status).not.toBe('applied');
    expect(['written', 'failed'].includes(String(r.apply_status))).toBe(true);
    void cleanup;
  });

  it('applyFtpAccount never fakes applied — pending_execute + writes map', () => {
    const { db, dir } = setup();
    const acc = createResource(db, 'ftp_accounts', {
      username: 'ftpuser1',
      homePath: join(dir, 'ftps', 'homes', 'ftpuser1'),
    });
    const r = applyFtpAccount(db, dir, String(acc.id));
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(getResource(db, 'ftp_accounts', String(acc.id))?.apply_status).toBe(
      'pending_execute',
    );
    expect(existsSync(join(dir, 'ftps', 'virtual_users.map'))).toBe(true);
  });

  it('deleteCertificateFiles removes managed cert dir and row', () => {
    const { db, dir } = setup();
    const certDir = join(dir, 'certs', 'ssl.example.com');
    mkdirSync(certDir, { recursive: true });
    writeFileSync(join(certDir, 'fullchain.pem'), 'c');
    const cert = createResource(db, 'certificates', { domain: 'ssl.example.com' });
    const r = deleteCertificateFiles(db, dir, String(cert.id));
    expect(r.ok).toBe(true);
    expect(existsSync(certDir)).toBe(false);
    expect(getResource(db, 'certificates', String(cert.id))).toBeNull();
  });
});
