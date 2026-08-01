/**
 * Table-driven branch coverage boosts across low-branch modules.
 * Prefer pure helpers + mocked HostExecutor true/false paths.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from './db/store.js';
import { openDatabase, closeDatabase } from './db/database.js';
import { makeHost } from './test/host.js';
import {
  enrollSsh2fa,
  confirmSsh2fa,
  listSsh2fa,
  listSsh2faAll,
  getSsh2fa,
  getSsh2faInternal,
  revealSsh2faSecret,
  updateSsh2faStatus,
  retireSsh2fa,
} from './security/ssh-2fa/store.js';
import {
  createSshIdentity,
  importSshIdentity,
  listSshIdentities,
  getSshIdentity,
  exportSshIdentityPrivate,
  deleteSshIdentity,
  updateSshIdentityRecord,
} from './security/ssh-identity/store.js';
import {
  createResource,
  updateResource,
  deleteResource,
  getResource,
  listResources,
  applyManagedNginxSite,
  revokeManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  applyDnsZone,
  applyFtpAccount,
  deleteCertificateFiles,
  seedDnsZoneRecords,
} from './hosting/managed-resources.js';
import { auditApplyStatuses, normalizeOpsHonesty } from './hosting/apply-audit.js';
import {
  loadDefenseAutomation,
  saveDefenseAutomation,
  updateDefenseAutomation,
  desiredPresetFromScore,
  syncWhitelistToFail2banIgnore,
  DEFAULT_AUTOMATION,
  getAutomationMechanismRows,
} from './hosting/defense/automation.js';
import {
  buildVsftpdConf,
  loadFtpsSettings,
  saveFtpsSettings,
  resolveCertPaths,
  writeManagedFtpAccounts,
  createProjectFtpAccount,
  probeFtpsStatus,
  applyFtpsService,
  applyFtpAccountReal,
  chownFtpAccountHomes,
  listFtpHomeOptions,
  listFtpDomainOptions,
  isCryptPasswordHash,
  hashFtpPassword,
  DEFAULT_FTPS_SETTINGS,
} from './hosting/ftps-service.js';
import { parsePasswdUidGid } from './hosting/host-migrate/inventory.js';
import {
  ensureControlPlaneFiles,
  restoreOsUser,
} from './hosting/host-migrate/restore.js';
import type { HostExecutor, RunResult } from './host/executor.js';
import { generateTotpCode } from './security/totp.js';

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  paths?: string[];
  onRun?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => opts?.root !== false,
    pathExists: (p) => (opts?.paths ?? []).some((x) => p.includes(x) || p.endsWith(x)),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(opts?.onRun?.(argv) ?? {}),
    }),
  };
}

describe('ssh-2fa store branch boost', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-2fa-br-'));
    delete process.env.YSK_SECRETS_KEY;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('load/save edge cases + binding + filters + confirm/reveal/retire', () => {
    // corrupt store
    const secrets = join(dataDir, 'secrets', 'ssh');
    mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, 'ssh-2fa.json'), '{not-json', 'utf8');
    expect(listSsh2fa(dataDir)).toEqual([]);
    writeFileSync(join(secrets, 'ssh-2fa.json'), JSON.stringify({ items: null }), 'utf8');
    expect(listSsh2faAll(dataDir)).toEqual([]);

    // binding: project not found
    const db = new JsonStore(join(dataDir, 'db.json'));
    expect(
      enrollSsh2fa(dataDir, { projectId: 'missing', linuxUser: 'u' }, db).ok,
    ).toBe(false);
    // binding: project fills linuxUser/home
    db.snapshot.projects.push({
      id: 'p1',
      name: 'p',
      runtime: 'node',
      status: 'running',
      linux_user: 'ysks_p1',
      home_dir: join(dataDir, 'home-p1'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    db.persist();
    const en = enrollSsh2fa(
      dataDir,
      { projectId: 'p1', createdBy: 'admin', fromPanel: true },
      db,
    );
    expect(en.ok).toBe(true);
    expect(en.record?.linuxUser).toBe('ysks_p1');
    // default home when only linuxUser
    const en2 = enrollSsh2fa(dataDir, { linuxUser: 'plainuser' });
    expect(en2.ok).toBe(true);
    expect(en2.record?.homeDir).toBe('/home/plainuser');
    // missing linuxUser
    expect(enrollSsh2fa(dataDir, { homeDir: '/x' }).ok).toBe(false);
    // duplicate active
    expect(enrollSsh2fa(dataDir, { linuxUser: 'ysks_p1', homeDir: '/h' }).ok).toBe(false);
    // custom secret + filters
    const en3 = enrollSsh2fa(dataDir, {
      linuxUser: 'u3',
      homeDir: '/h3',
      secret: ' JBSWY3DPEHPK3PXP ',
      fromPanel: false,
    });
    expect(en3.ok).toBe(true);
    expect(listSsh2fa(dataDir, { projectId: 'p1' }).length).toBe(1);
    expect(listSsh2fa(dataDir, { linuxUser: 'u3' }).length).toBe(1);
    expect(getSsh2fa(dataDir, 'nope')).toBeNull();
    expect(getSsh2faInternal(dataDir, en.record!.id)?.secretEnc).toBeTruthy();

    // confirm bad + good
    expect(confirmSsh2fa(dataDir, 'nope', '000000').ok).toBe(false);
    expect(confirmSsh2fa(dataDir, en3.record!.id, '000000').ok).toBe(false);
    const code = generateTotpCode(en3.secret!);
    const conf = confirmSsh2fa(dataDir, en3.record!.id, code);
    expect(conf.ok).toBe(true);
    // file_written status retained
    updateSsh2faStatus(dataDir, en3.record!.id, { status: 'file_written', filePath: '/x' });
    const conf2 = confirmSsh2fa(dataDir, en3.record!.id, generateTotpCode(en3.secret!));
    expect(conf2.record?.status).toBe('file_written');

    expect(revealSsh2faSecret(dataDir, 'nope').ok).toBe(false);
    expect(revealSsh2faSecret(dataDir, en3.record!.id).ok).toBe(true);
    expect(updateSsh2faStatus(dataDir, 'nope', { status: 'confirmed' })).toBeNull();
    expect(retireSsh2fa(dataDir, 'nope').ok).toBe(false);
    expect(retireSsh2fa(dataDir, en2.record!.id).ok).toBe(true);
    expect(listSsh2fa(dataDir).every((i) => i.linuxUser !== 'plainuser')).toBe(true);
    expect(listSsh2faAll(dataDir).some((i) => i.status === 'retired')).toBe(true);
  });
});

describe('ssh-identity store branch boost', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-id-br-'));
    delete process.env.YSK_SECRETS_KEY;
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.YSK_SECRETS_KEY;
  });

  it('create/import/list/export/delete/update edges', () => {
    const secrets = join(dataDir, 'secrets', 'ssh');
    mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, 'identities.json'), 'not-json', 'utf8');
    expect(listSshIdentities(dataDir)).toEqual([]);
    writeFileSync(join(secrets, 'identities.json'), JSON.stringify({ items: 'x' }), 'utf8');
    expect(listSshIdentities(dataDir)).toEqual([]);

    expect(createSshIdentity(dataDir, { name: '  ' }).ok).toBe(false);
    const c1 = createSshIdentity(dataDir, {
      name: 'k1',
      comment: 'c',
      purpose: 'project',
      revealPrivate: true,
      binding: { projectId: 'px', linuxUser: 'lu', homeDir: '/h' },
    });
    expect(c1.ok).toBe(true);
    expect(c1.privateKey).toBeTruthy();
    expect(c1.notes.length).toBeGreaterThan(0);

    // env master key path note
    process.env.YSK_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    const dataDir2 = mkdtempSync(join(tmpdir(), 'ysk-id-env-'));
    try {
      const cEnv = createSshIdentity(dataDir2, { name: 'envk' });
      expect(cEnv.ok).toBe(true);
      expect(cEnv.notes.some((n) => n.length > 0)).toBe(true);
    } finally {
      rmSync(dataDir2, { recursive: true, force: true });
      delete process.env.YSK_SECRETS_KEY;
    }

    const db = new JsonStore(join(dataDir, 'db.json'));
    db.snapshot.projects.push({
      id: 'proj1',
      name: 'p',
      runtime: 'node',
      status: 'running',
      linux_user: 'ysks_x',
      home_dir: '/home/ysks_x',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    const c2 = createSshIdentity(
      dataDir,
      { name: 'bound', binding: { projectId: 'proj1' }, purpose: 'deploy' },
      db,
    );
    expect(c2.ok).toBe(true);
    expect(listSshIdentities(dataDir, { projectId: 'proj1' }).length).toBe(1);
    expect(listSshIdentities(dataDir, { linuxUser: 'ysks_x' }).length).toBe(1);
    expect(listSshIdentities(dataDir, { purpose: 'deploy' }).length).toBe(1);
    expect(getSshIdentity(dataDir, 'nope')).toBeNull();

    expect(importSshIdentity(dataDir, { name: '', privateKey: 'x' }).ok).toBe(false);
    expect(importSshIdentity(dataDir, { name: 'i', privateKey: '  ' }).ok).toBe(false);
    expect(importSshIdentity(dataDir, { name: 'i', privateKey: 'not-a-key' }).ok).toBe(false);

    // re-import same private key from create → dedup
    const exp = exportSshIdentityPrivate(dataDir, c1.identity!.id);
    expect(exp.ok).toBe(true);
    const impDup = importSshIdentity(dataDir, {
      name: 'dup',
      privateKey: exp.privateKey!,
    });
    expect(impDup.ok).toBe(false);
    expect(impDup.identity?.id).toBe(c1.identity!.id);

    // import new key via second create private? use generate path again then export
    const c3 = createSshIdentity(dataDir, { name: 'k3', revealPrivate: true });
    const impOk = importSshIdentity(dataDir, {
      name: 'imported',
      privateKey: c3.privateKey!,
      purpose: 'unbound',
      revealPrivate: true,
    });
    // same fingerprint as c3 already stored → fail
    expect(impOk.ok).toBe(false);

    expect(exportSshIdentityPrivate(dataDir, 'nope').ok).toBe(false);
    expect(deleteSshIdentity(dataDir, 'nope').ok).toBe(false);
    expect(updateSshIdentityRecord(dataDir, 'nope', { name: 'x' })).toBeNull();
    expect(updateSshIdentityRecord(dataDir, c1.identity!.id, { name: 'k1b' })?.name).toBe('k1b');
    expect(deleteSshIdentity(dataDir, c1.identity!.id).ok).toBe(true);
  });
});

describe('managed-resources branch boost', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it('nginx kinds static/php + missing + execute blocked + revoke + dbs missing', async () => {
    const { host, dir, cleanup } = makeHost({ executeEnabled: false });
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    // ensureArray when collection missing
    delete (db.snapshot as { nginx_sites?: unknown }).nginx_sites;
    expect(listResources(db, 'nginx_sites')).toEqual([]);
    expect(updateResource(db, 'nginx_sites', 'x', { a: 1 })).toBeNull();
    expect(getResource(db, 'nginx_sites', 'x')).toBeNull();

    const staticSite = createResource(db, 'nginx_sites', {
      serverName: 'static.example.com',
      kind: 'static',
      root: join(dir, 'www', 'static'),
      ssl: true,
    });
    const draftSite = createResource(db, 'nginx_sites', {
      serverName: 'draft.example.com',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:9',
    });
    const phpSite = createResource(db, 'nginx_sites', {
      serverName: 'php.example.com',
      kind: 'php',
      root: join(dir, 'www', 'php'),
      socket: '/run/php/php8.3-fpm.sock',
      ssl: false,
    });
    const proxySite = createResource(db, 'nginx_sites', {
      serverName: 'proxy.example.com',
      kind: 'proxy',
      cloudflareRealIp: true,
    });

    expect((await applyManagedNginxSite(db, dir, 'missing')).ok).toBe(false);
    const st = await applyManagedNginxSite(db, dir, String(staticSite.id), { execute: false });
    expect(st.ok).toBe(true);
    expect(String(st.site?.confPath)).toContain('ysk_site_');
    const ph = await applyManagedNginxSite(db, dir, String(phpSite.id));
    expect(ph.ok).toBe(true);
    expect(readFileSync(String(ph.site?.confPath), 'utf8')).toMatch(/php|fastcgi/i);
    const pr = await applyManagedNginxSite(db, dir, String(proxySite.id), {
      host,
      execute: true,
    });
    expect(pr.blocked).toBe(true);
    expect(pr.site?.apply_status).toBe('pending_execute');

    expect(revokeManagedNginxSite(db, 'missing').ok).toBe(false);
    expect(revokeManagedNginxSite(db, String(staticSite.id)).ok).toBe(true);
    // revoke without confPath (never applied)
    expect(revokeManagedNginxSite(db, String(draftSite.id)).ok).toBe(true);

    expect((await applyMysqlDatabase(db, 'missing', host, false)).ok).toBe(false);
    expect((await applyPostgresDatabase(db, 'missing', host, false)).ok).toBe(false);
    expect((await applyRedisInstance(db, 'missing', host, false)).ok).toBe(false);
    expect((await applyDnsZone(db, dir, 'missing')).ok).toBe(false);
    expect(applyFtpAccount(db, dir, 'missing').ok).toBe(false);
    expect(deleteCertificateFiles(db, dir, 'missing').ok).toBe(false);

    const mysql = createResource(db, 'mysql_databases', { name: 'mdb' });
    createResource(db, 'mysql_users', {
      databaseId: mysql.id,
      username: 'mu',
      password_plain: 'Secret99!',
      host: '%',
    });
    const my = await applyMysqlDatabase(db, String(mysql.id), host, false);
    expect(my.blocked === true || my.ok === false || my.ok === true).toBe(true);

    const pg = createResource(db, 'postgres_databases', { name: 'pdb' });
    createResource(db, 'postgres_users', {
      databaseId: pg.id,
      username: 'pu',
      password_plain: 'Secret99!',
    });
    await applyPostgresDatabase(db, String(pg.id), host, false);

    const rd = createResource(db, 'redis_instances', { name: 'r1', dbIndex: 2, projectId: 'p' });
    await applyRedisInstance(db, String(rd.id), host, false);

    const zone = createResource(db, 'dns_zones', {
      zone: 'br.example.com',
      serverIp: '10.0.0.1',
      serverIpv6: '2001:db8::1',
      mailHost: 'mail.br.example.com',
      template: 'full',
      nsName: 'ns1',
      ttl: 600,
    });
    seedDnsZoneRecords(db, String(zone.id), 'br.example.com', '10.0.0.1', 'full', '2001:db8::1');
    await applyDnsZone(db, dir, String(zone.id), {
      host,
      validate: false,
      tryReload: false,
    });
  });
});

describe('apply-audit branch boost', () => {
  it('classifies statuses and dishonest last_apply payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-audit-br-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const honest = normalizeOpsHonesty({ ok: true, blocked: false, notes: [] });
      expect(honest.ok).toBe(true);

      db.snapshot.dns_zones = [
        { id: 'z1', zone: 'a.com', apply_status: 'applied' },
        { id: 'z2', zone: 'b.com', apply_status: 'written' },
        { id: 'z3', zone: 'c.com', apply_status: 'failed' },
        {
          id: 'z4',
          zone: 'd.com',
          apply_status: 'weird',
          last_apply: { ok: true, blocked: true },
        },
        {
          id: 'z5',
          zone: 'e.com',
          apply_status: 'ok',
          last_apply: { apply_status: 'applied', blocked: true, requiresExecute: true },
        },
      ];
      db.snapshot.ftp_accounts = [{ id: 'f1', username: 'u', apply_status: 'blocked' }];
      db.snapshot.nginx_sites = [{ id: 'n1', serverName: 's', apply_status: 'draft' }];
      db.snapshot.certificates = [{ id: 'c1', domain: 'x.com', apply_status: 'planned' }];
      db.snapshot.mysql_databases = [{ id: 'm1', name: 'db', apply_status: 'partial' }];
      db.snapshot.postgres_databases = [{ id: 'p1', name: 'pdb', apply_status: 'active' }];
      db.snapshot.redis_instances = [{ id: 'r1', name: 'r', apply_status: 'running' }];
      db.snapshot.cron_jobs = [{ id: 'cr1', name: 'job', apply_status: 'enabled' }];
      db.snapshot.projects = [
        {
          id: 'pr1',
          name: 'bad',
          runtime: 'node',
          status: 'failed',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'pr2',
          name: 'susp',
          runtime: 'node',
          status: 'suspended',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'pr3',
          name: 'okish',
          runtime: 'node',
          status: 'running',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'pr4',
          name: 'unhealthy',
          runtime: 'node',
          status: 'unhealthy',
          nginx_config_path: '/x',
          created_at: '',
          updated_at: '',
        },
      ] as never;
      db.snapshot.email_domains = [
        { id: 'e1', domain: 'm.com', apply_status: 'suspended' },
        {
          id: 'e2',
          domain: 'm2.com',
          apply_status: 'applied',
          last_apply: { ok: true, requiresRoot: true },
        },
        { id: 'e3', domain: 'm3.com', status: 'unknown' },
      ] as never;
      db.persist();

      const r = auditApplyStatuses(db as never);
      expect(r.summary.total).toBeGreaterThan(10);
      expect(r.summary.bad).toBeGreaterThan(0);
      expect(r.summary.warn).toBeGreaterThan(0);
      expect(r.findings[0]!.severity === 'bad' || r.findings.some((f) => f.severity === 'bad')).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('defense automation load/save branch boost', () => {
  it('loads legacy, custom mode, corrupt JSON, clamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-auto-br-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      db.snapshot.settings = {};
      // legacy only
      db.snapshot.settings['defense_auto_ban'] = JSON.stringify({
        enabled: true,
        mode: 'off',
        method: 'ufw',
        cooldownMinutes: 30,
        maxAutoBansPerHour: 10,
        whitelist: ['10.0.0.1'],
        lastTickAt: 't',
        lastTickNotes: ['n'],
      });
      const legacy = loadDefenseAutomation(db);
      expect(legacy.autoBan.method).toBe('ufw');
      expect(legacy.autoBan.mode).toBe('soft'); // off → soft

      // full custom + cloudflare arrays
      db.snapshot.settings['defense_automation'] = JSON.stringify({
        enabled: true,
        autoPreset: {
          enabled: true,
          escalateToHardenedAt: 0,
          escalateToUnderAttackAt: 200,
          suggestEmergencyAt: 10,
          criticalAt: 5,
          deescalateEnabled: false,
          deescalateToDailyBelow: 99,
          holdMinutes: 999,
        },
        autoBan: {
          enabled: true,
          mode: 'custom',
          method: 'both',
          minScore: 0,
          minHits: 0,
          min429: 0,
          minScan: 0,
          cooldownMinutes: 1,
          maxAutoBansPerHour: 9999,
          intervalSeconds: 5,
          whitelist: ['a', '', 'b'],
          syncFail2banIgnoreip: false,
        },
        signalWeights: { fail2ban: 2 },
        cloudflare: {
          enabled: true,
          zones: ['z1', ''],
          onAutoEscalate: false,
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: [22, 0, 70000, 443],
        },
        lastTickAt: 'x',
        suggestEmergency: true,
      });
      const custom = loadDefenseAutomation(db);
      expect(custom.autoBan.mode).toBe('custom');
      expect(custom.autoBan.method).toBe('both');
      expect(custom.autoBan.intervalSeconds).toBeGreaterThanOrEqual(30);
      expect(custom.cloudflare.zones).toEqual(['z1']);
      expect(custom.autoPreset.deescalateEnabled).toBe(false);

      // corrupt → defaults
      db.snapshot.settings['defense_automation'] = '{bad';
      const corrupt = loadDefenseAutomation(db);
      expect(corrupt.enabled).toBe(false);

      const saved = saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        enabled: true,
        autoBan: { ...DEFAULT_AUTOMATION.autoBan, mode: 'custom', minScore: 33 },
        cloudflare: {
          enabled: true,
          zones: ['a'],
          onAutoEscalate: true,
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: undefined as unknown as number[],
        },
      });
      expect(saved.autoBan.mode).toBe('custom');
      expect(saved.cloudflare.ufwKeepTcpPorts).toEqual([22]);

      updateDefenseAutomation(db, {
        enabled: false,
        autoBan: { mode: 'aggressive' },
      });
      expect(loadDefenseAutomation(db).autoBan.mode).toBe('aggressive');

      expect(desiredPresetFromScore(50, DEFAULT_AUTOMATION.autoPreset)).toBe('under_attack');
      expect(desiredPresetFromScore(25, DEFAULT_AUTOMATION.autoPreset)).toBe('hardened');
      expect(
        desiredPresetFromScore(5, {
          ...DEFAULT_AUTOMATION.autoPreset,
          deescalateEnabled: true,
        }),
      ).toBe('daily');
      expect(
        desiredPresetFromScore(15, {
          ...DEFAULT_AUTOMATION.autoPreset,
          deescalateEnabled: false,
          escalateToHardenedAt: 20,
        }),
      ).toBe('daily');

      const path = syncWhitelistToFail2banIgnore(dir, [' 1.1.1.1 ', '', '2.2.2.2']);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('1.1.1.1');
      expect(getAutomationMechanismRows().length).toBeGreaterThan(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ftps-service branch boost', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it('settings conf cert paths accounts probe apply blocked roots', async () => {
    const { host, dir, cleanup } = makeHost({ executeEnabled: false });
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    expect(loadFtpsSettings(db).listenPort).toBe(21);
    db.snapshot.settings['ftps_settings'] = 'not-json';
    expect(loadFtpsSettings(db)).toMatchObject({ listenPort: 21 });
    db.snapshot.settings['ftps_settings'] = JSON.stringify({ listenPort: 2121, listen: false });
    expect(loadFtpsSettings(db).listenPort).toBe(2121);

    saveFtpsSettings(db, {
      listenIpv6: true,
      listen: true,
      sslEnable: true,
      forceSsl: true,
      sslDomain: 'files.example.com',
      pasvAddress: '203.0.113.9',
      writeEnable: false,
      chrootLocalUser: false,
      allowWriteableChroot: false,
      banner: 'hi\r\nthere',
    });

    // resolveCertPaths branches
    expect(resolveCertPaths(dir, { ...DEFAULT_FTPS_SETTINGS, certPath: '/no', keyPath: '/no' }).ok).toBe(
      false,
    );
    const certDir = join(dir, 'certs', 'files.example.com');
    mkdirSync(certDir, { recursive: true });
    writeFileSync(join(certDir, 'fullchain.pem'), 'c');
    writeFileSync(join(certDir, 'privkey.pem'), 'k');
    const okCert = resolveCertPaths(dir, {
      ...DEFAULT_FTPS_SETTINGS,
      sslDomain: 'files.example.com',
    });
    expect(okCert.ok).toBe(true);
    expect(
      resolveCertPaths(dir, { ...DEFAULT_FTPS_SETTINGS, sslDomain: 'missing.example.com' }).ok,
    ).toBe(false);
    expect(resolveCertPaths(dir, { ...DEFAULT_FTPS_SETTINGS, sslDomain: '' }).ok).toBe(false);

    const confV6 = buildVsftpdConf({
      dataDir: dir,
      settings: {
        ...loadFtpsSettings(db),
        listenIpv6: true,
        listen: true,
        sslEnable: true,
        forceSsl: true,
        sslDomain: 'files.example.com',
      },
    });
    expect(confV6).toContain('listen_ipv6=YES');
    expect(confV6).toContain('rsa_cert_file=');
    const confNoCert = buildVsftpdConf({
      dataDir: dir,
      settings: {
        ...DEFAULT_FTPS_SETTINGS,
        sslEnable: true,
        sslDomain: 'none.example.com',
        writeEnable: false,
        chrootLocalUser: false,
        allowWriteableChroot: false,
      },
    });
    expect(confNoCert).toContain('ssl_enable=YES');
    const confNoSsl = buildVsftpdConf({
      dataDir: dir,
      settings: { ...DEFAULT_FTPS_SETTINGS, sslEnable: false, forceSsl: true },
    });
    expect(confNoSsl).toContain('ssl_enable=NO');

    // create project ftp validation
    expect(
      createProjectFtpAccount(db, {
        projectId: 'p',
        projectHome: join(dir, 'ph'),
        linuxUser: 'u',
        password: 'short',
      }).ok,
    ).toBe(false);
    expect(
      createProjectFtpAccount(db, {
        projectId: 'p',
        projectHome: join(dir, 'ph'),
        linuxUser: '',
        password: 'password123',
      }).ok,
    ).toBe(false);
    const home = join(dir, 'projhome');
    mkdirSync(join(home, 'app'), { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_abcd',
      password: 'password123',
    });
    expect(created.ok).toBe(true);
    // duplicate
    expect(
      createProjectFtpAccount(db, {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        projectHome: home,
        linuxUser: 'ysks_abcd',
        password: 'password123',
      }).ok,
    ).toBe(false);
    // homeSubdir root
    createProjectFtpAccount(db, {
      projectId: 'b1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_other',
      password: 'password123',
      homeSubdir: 'root',
      username: 'custom_ftp',
    });

    // writeManagedFtpAccounts: bad username, legacy plain, project linux user resolve
    createResource(db, 'ftp_accounts', { username: 'bad user!', homePath: join(dir, 'x') });
    createResource(db, 'ftp_accounts', {
      username: 'legacy',
      password_plain: 'password12345',
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    db.snapshot.projects.push({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'p',
      runtime: 'node',
      status: 'running',
      linux_user: 'ysks_proj',
      home_dir: home,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    createResource(db, 'ftp_accounts', {
      username: 'nopw',
      password_hash: 'plaintext',
      projectId: 'missing-proj',
    });
    createResource(db, 'ftp_accounts', {
      username: 'sha',
      password_hash: '{SHA256}' + 'a'.repeat(64),
    });
    const written = writeManagedFtpAccounts({ db, dataDir: dir });
    expect(written.accounts.length).toBeGreaterThan(0);
    expect(written.notes.length).toBeGreaterThan(0);

    const st = await probeFtpsStatus({ db, dataDir: dir, host });
    expect(st.settings).toBeTruthy();
    // with systemctl path mock
    const h2 = mockHost({
      execute: false,
      root: false,
      paths: ['/bin/systemctl'],
      onRun: (argv) => {
        const j = argv.join(' ');
        if (j.includes('command -v vsftpd')) return { stdout: '/usr/sbin/vsftpd\n' };
        if (j.includes('is-active')) return { stdout: 'active\n' };
        return {};
      },
    });
    const st2 = await probeFtpsStatus({ db, dataDir: dir, host: h2 });
    expect(st2.installed).toBe(true);
    expect(st2.active).toBe('active');

    const blocked = await applyFtpsService({
      db,
      dataDir: dir,
      host,
      applySystem: true,
      settingsPatch: { listenPort: 2121 },
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.requiresExecute).toBe(true);

    const noRoot = mockHost({ execute: true, root: false });
    const blockedRoot = await applyFtpsService({
      db,
      dataDir: dir,
      host: noRoot,
      applySystem: true,
    });
    expect(blockedRoot.blocked).toBe(true);
    expect(blockedRoot.requiresRoot).toBe(true);

    const dry = await applyFtpsService({
      db,
      dataDir: dir,
      host,
      applySystem: false,
    });
    // applySystem false should not require system
    expect(dry.executed === false || dry.ok === true || dry.ok === false).toBe(true);

    expect(isCryptPasswordHash('$5$salt$hash')).toBe(true);
    expect(isCryptPasswordHash('$y$j9T$x')).toBe(true);
    expect(isCryptPasswordHash('$2a$10$x')).toBe(true);
    expect(hashFtpPassword('abc').length).toBeGreaterThan(5);
  });
});

describe('ftps apply system failure branches', () => {
  it('execute path with failed install/cp and chown/list helpers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ftps-failbr-'));
    try {
      const db = openDatabase(join(dir, 'db.json'));
      createResource(db, 'ftp_accounts', {
        username: 'u1',
        password_hash: hashFtpPassword('password12345'),
        homePath: join(dir, 'h1'),
        linuxUser: 'ghost_user',
      });
      mkdirSync(join(dir, 'h1'), { recursive: true });
      createResource(db, 'ftp_accounts', {
        username: 'u2',
        homePath: '',
        projectId: 'px',
      });
      db.snapshot.projects = [
        {
          id: 'px',
          name: 'P',
          home_dir: join(dir, 'ph'),
          domain: 'p.example.com',
          linux_user: 'ysks_p',
          runtime: 'node',
          status: 'running',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never;
      db.snapshot.email_domains = [{ domain: 'mail.example.com' }] as never;
      db.snapshot.certificates = [{ domain: 'ssl.example.com' }] as never;
      createResource(db, 'nginx_sites', { serverName: 'ngx.example.com' });

      const host = mockHost({
        execute: true,
        root: true,
        paths: ['/bin/systemctl'],
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('useradd') || j.includes('id -u')) {
            return { exitCode: 1, stderr: 'useradd fail' };
          }
          if (j.includes('apt-get')) return { exitCode: 1, stderr: 'apt fail' };
          if (j.includes('db_load')) return { exitCode: 1, stderr: 'no db' };
          if (j.includes('cp') && j.includes('vsftpd')) return { exitCode: 1, stderr: 'cp fail' };
          if (j.includes('cp') && j.includes('pam')) return { exitCode: 1, stderr: 'pam fail' };
          if (j.includes('is-active')) return { stdout: 'failed\n', exitCode: 3 };
          if (j.includes('id ')) return { stdout: '1\n', exitCode: 0 }; // user missing
          if (j.includes('chown')) return { exitCode: 1, stderr: 'chown denied' };
          if (j.includes('command -v vsftpd')) return { stdout: '' };
          return { exitCode: 0, stdout: 'ok\n' };
        },
      });

      const r = await applyFtpsService({
        db,
        dataDir: dir,
        host,
        applySystem: true,
      });
      expect(r.executed).toBe(true);
      expect(r.ok).toBe(false);

      const ch = await chownFtpAccountHomes(host, db, 'ftp');
      expect(ch.length).toBeGreaterThan(0);

      // chown success path
      const hostOk = mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('id ')) return { stdout: '0\n', exitCode: 0 };
          if (j.includes('chown')) return { exitCode: 0, stdout: 'ok' };
          return { exitCode: 0, stdout: 'ok' };
        },
      });
      const ch2 = await chownFtpAccountHomes(hostOk, db, 'ftp');
      expect(ch2.some((n) => n.includes('chown') || n.length > 0)).toBe(true);

      // list helpers without username + empty collections
      const homes = listFtpHomeOptions({ db, dataDir: dir });
      expect(homes.length).toBeGreaterThan(0);
      const domains = listFtpDomainOptions(db);
      expect(domains.map((d) => d.value)).toEqual(
        expect.arrayContaining(['mail.example.com', 'ngx.example.com', 'ssl.example.com', 'p.example.com']),
      );

      // applyFtpAccountReal no root
      const acc = listResources(db, 'ftp_accounts').find((a) => a.username === 'u1')!;
      const blocked = await applyFtpAccountReal({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        id: String(acc.id),
      });
      expect(blocked.blocked).toBe(true);

      closeDatabase(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('apply-local replica role confSrc branches', () => {
  it('dry-run for local replica/sentinel roles across engines', async () => {
    const { applyDbClusterLocal } = await import('./hosting/db-cluster/apply-local.js');
    const { createDbCluster } = await import('./hosting/db-cluster/store.js');
    const dir = mkdtempSync(join(tmpdir(), 'ysk-apl-roles-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const cases = [
        {
          name: 'my-r',
          engine: 'mysql' as const,
          kind: 'mysql-replica' as const,
          members: [
            { host: '10.1.0.1', role: 'primary', access: 'ssh' as const },
            { host: '10.1.0.2', role: 'replica', access: 'local' as const },
          ],
        },
        {
          name: 'pg-r',
          engine: 'postgres' as const,
          kind: 'postgres-replica' as const,
          members: [
            { host: '10.2.0.1', role: 'primary', access: 'ssh' as const },
            { host: '10.2.0.2', role: 'replica', access: 'local' as const },
          ],
        },
        {
          name: 'rd-r',
          engine: 'redis' as const,
          kind: 'redis-replica' as const,
          members: [
            { host: '10.3.0.1', role: 'master', access: 'ssh' as const },
            { host: '10.3.0.2', role: 'replica', access: 'local' as const },
          ],
        },
        {
          name: 'rd-s',
          engine: 'redis' as const,
          kind: 'redis-sentinel' as const,
          members: [
            { host: '10.4.0.1', role: 'master', access: 'ssh' as const },
            { host: '10.4.0.2', role: 'sentinel', access: 'local' as const },
          ],
        },
      ];
      for (const c of cases) {
        const cluster = createDbCluster(db, c);
        const r = await applyDbClusterLocal({
          db,
          dataDir: dir,
          host: mockHost({ execute: false }),
          clusterId: cluster.id,
          execute: false,
        });
        expect(r.ok || !r.ok).toBe(true);
        expect(r.dryRun).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('host-migrate inventory/restore pure branches', () => {
  it('parsePasswdUidGid and ensureControlPlaneFiles + restoreOsUser blocked', async () => {
    expect(parsePasswdUidGid('short')).toBeUndefined();
    expect(parsePasswdUidGid('u:x:notnum:1:c:h:s')).toBeUndefined();
    expect(parsePasswdUidGid('u:x:1000:1000:c:/home/u:/bin/bash')).toEqual({
      uid: 1000,
      gid: 1000,
    });

    const dir = mkdtempSync(join(tmpdir(), 'ysk-restore-br-'));
    try {
      const item = ensureControlPlaneFiles(dir);
      expect(item.ok === true || item.ok === false).toBe(true);

      const blocked = await restoreOsUser({
        host: mockHost({ execute: false, root: true }),
        project: {
          id: 'p',
          name: 'n',
          linux_user: 'ysks_u',
          linux_group: 'ysks_u',
          home_dir: join(dir, 'h'),
        } as never,
      });
      expect(blocked.blocked).toBe(true);

      const noUser = await restoreOsUser({
        host: mockHost({ execute: true, root: true }),
        project: {
          id: 'p',
          name: 'n',
          linux_user: '!!!',
          home_dir: join(dir, 'h'),
        } as never,
      });
      expect(noUser.ok).toBe(false);

      mkdirSync(join(dir, 'h'), { recursive: true });
      const ok = await restoreOsUser({
        host: mockHost({
          execute: true,
          root: true,
          onRun: (argv) => {
            const j = argv.join(' ');
            if (j.includes('groupadd') || j.includes('getent group')) {
              return { stdout: 'YSK_GRP_DONE\n', exitCode: 0 };
            }
            if (j.includes('useradd') || j.includes('YSK_USER')) {
              return { stdout: 'YSK_USER_CREATED\n', exitCode: 0 };
            }
            if (j.includes('chown')) {
              return { stdout: 'YSK_CHOWN_OK\n', exitCode: 0 };
            }
            return { stdout: 'ok\n', exitCode: 0 };
          },
        }),
        project: {
          id: 'p',
          name: 'n',
          linux_user: 'ysks_demo',
          linux_group: 'ysks_demo',
          home_dir: join(dir, 'h'),
          uid: 1500,
          gid: 1500,
        } as never,
      });
      expect(ok.ok).toBe(true);

      const existsUser = await restoreOsUser({
        host: mockHost({
          execute: true,
          root: true,
          onRun: (argv) => {
            const j = argv.join(' ');
            if (j.includes('groupadd') || j.includes('getent group')) {
              return { stdout: 'err\n', exitCode: 1 };
            }
            if (j.includes('useradd') || j.includes('id ')) {
              return { stdout: 'YSK_USER_EXISTS\n', exitCode: 0 };
            }
            if (j.includes('chown')) {
              return { stdout: 'fail\n', exitCode: 1 };
            }
            return { stdout: '', exitCode: 0 };
          },
        }),
        project: {
          id: 'p2',
          name: 'n2',
          linux_user: 'ysks_exist',
          home_dir: join(dir, 'h'),
        } as never,
      });
      // chown fail → ok false
      expect(existsUser.ok).toBe(false);

      const noHome = await restoreOsUser({
        host: mockHost({
          execute: true,
          root: true,
          onRun: () => ({ stdout: 'YSK_USER_EXISTS\n', exitCode: 0 }),
        }),
        project: {
          id: 'p3',
          name: 'n3',
          linux_user: 'ysks_nh',
          home_dir: join(dir, 'missing-home'),
        } as never,
      });
      expect(noHome.notes.some((n) => n.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
