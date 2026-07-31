import { describe, expect, it, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../db/database.js';
import { makeHost } from '../test/host.js';
import {
  applyFtpAccountReal,
  applyFtpsService,
  buildPamSnippet,
  buildVsftpdConf,
  createProjectFtpAccount,
  DEFAULT_FTPS_SETTINGS,
  ftpsPaths,
  hashFtpPassword,
  isCryptPasswordHash,
  listFtpDomainOptions,
  listFtpHomeOptions,
  loadFtpsSettings,
  probeFtpsStatus,
  resolveCertPaths,
  saveFtpsSettings,
  writeManagedFtpAccounts,
} from './ftps-service.js';
import { listResources } from './managed-resources.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup() {
  const { host, dir, cleanup } = makeHost({ executeEnabled: false });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  return { host, dir, db };
}

describe('ftps-service pure helpers', () => {
  it('hashes passwords as crypt-compatible and detects hash families', () => {
    const h = hashFtpPassword('password12345');
    expect(isCryptPasswordHash(h)).toBe(true);
    expect(isCryptPasswordHash('$6$rounds=5000$saltsalt$hash')).toBe(true);
    expect(isCryptPasswordHash('{SHA256}deadbeef')).toBe(false);
    expect(isCryptPasswordHash('plaintext')).toBe(false);
  });

  it('loads defaults and saves settings with port clamp + banner limit', () => {
    const { db } = setup();
    expect(loadFtpsSettings(db)).toMatchObject({
      listenPort: DEFAULT_FTPS_SETTINGS.listenPort,
      guestUsername: 'ftp',
    });
    const saved = saveFtpsSettings(db, {
      listenPort: 99999,
      pasvMin: 40000,
      pasvMax: 39000,
      sslDomain: '  Files.Example.COM ',
      guestUsername: 'ftp;rm -rf',
      banner: 'x'.repeat(200),
    });
    expect(saved.listenPort).toBe(21);
    expect(saved.pasvMin).toBe(40000);
    expect(saved.pasvMax).toBe(40100);
    expect(saved.sslDomain).toBe('files.example.com');
    expect(saved.guestUsername).toBe('ftprm-rf');
    expect(saved.banner.length).toBe(120);
    expect(loadFtpsSettings(db).sslDomain).toBe('files.example.com');
  });

  it('builds vsftpd conf and pam with managed paths', () => {
    const { dir } = setup();
    const conf = buildVsftpdConf({
      dataDir: dir,
      settings: {
        ...DEFAULT_FTPS_SETTINGS,
        listen: true,
        listenIpv6: false,
        listenPort: 2121,
        pasvMin: 31000,
        pasvMax: 31100,
        banner: 'YSK\nFTPS',
        sslEnable: false,
      },
    });
    expect(conf).toContain('listen=YES');
    expect(conf).toContain('listen_ipv6=NO');
    expect(conf).toContain('listen_port=2121');
    expect(conf).toContain('pasv_min_port=31000');
    expect(conf).toContain('ftpd_banner=YSK FTPS');
    expect(conf).toContain('ssl_enable=NO');
    expect(conf).toContain(join(dir, 'ftps', 'homes'));

    const v6 = buildVsftpdConf({
      dataDir: dir,
      settings: { ...DEFAULT_FTPS_SETTINGS, listenIpv6: true, sslEnable: true },
    });
    expect(v6).toContain('listen=NO');
    expect(v6).toContain('listen_ipv6=YES');
    expect(v6).toContain('ssl_enable=YES');

    const pam = buildPamSnippet(dir);
    expect(pam).toContain('pam_userdb.so');
    expect(pam).toContain(ftpsPaths(dir).userDb.replace(/\.db$/, ''));
  });

  it('resolveCertPaths prefers explicit paths then managed certs', () => {
    const { dir } = setup();
    const certDir = join(dir, 'certs', 'ftp.example.com');
    mkdirSync(certDir, { recursive: true });
    const cert = join(certDir, 'fullchain.pem');
    const key = join(certDir, 'privkey.pem');
    writeFileSync(cert, 'c');
    writeFileSync(key, 'k');

    const missing = resolveCertPaths(dir, {
      ...DEFAULT_FTPS_SETTINGS,
      sslDomain: 'missing.example.com',
    });
    expect(missing.ok).toBe(false);

    const managed = resolveCertPaths(dir, {
      ...DEFAULT_FTPS_SETTINGS,
      sslDomain: 'ftp.example.com',
    });
    expect(managed.ok).toBe(true);
    expect(managed.cert).toBe(cert);

    const explicit = resolveCertPaths(dir, {
      ...DEFAULT_FTPS_SETTINGS,
      certPath: cert,
      keyPath: key,
    });
    expect(explicit.ok).toBe(true);
  });

  it('lists home and domain options from store', () => {
    const { db, dir } = setup();
    db.snapshot.projects = [
      {
        id: 'p1',
        name: 'Demo',
        homeDir: join(dir, 'homes', 'demo'),
        domain: 'demo.example.com',
      },
    ] as never;
    db.snapshot.email_domains = [{ domain: 'mail.example.com' }] as never;
    db.persist();
    const homes = listFtpHomeOptions({ db, dataDir: dir, username: 'alice' });
    expect(homes.some((h) => h.value.includes('alice'))).toBe(true);
    expect(homes.some((h) => h.value.includes('homes'))).toBe(true);
    const domains = listFtpDomainOptions(db);
    expect(domains.map((d) => d.value)).toEqual(
      expect.arrayContaining(['mail.example.com', 'demo.example.com']),
    );
  });
});

describe('ftps-service managed write + honesty apply', () => {
  it('rejects short password and duplicate usernames', () => {
    const { db, dir } = setup();
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    const short = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'short',
    });
    expect(short.ok).toBe(false);

    const ok = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });
    expect(ok.ok).toBe(true);
    expect(ok.account.apply_status).toBe('draft');

    const dup = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password456',
      homeSubdir: 'root',
    });
    expect(dup.ok).toBe(false);
  });

  it('writeManagedFtpAccounts writes conf + map + pam under dataDir', () => {
    const { db, dir } = setup();
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });
    expect(created.ok).toBe(true);

    const managed = writeManagedFtpAccounts({ db, dataDir: dir });
    expect(managed.accounts.length).toBe(1);
    const paths = ftpsPaths(dir);
    expect(existsSync(paths.mapPath)).toBe(true);
    expect(existsSync(paths.userDbTxt)).toBe(true);
    expect(existsSync(paths.pam)).toBe(true);
    const uc = join(paths.userConfDir, String(created.account.username));
    expect(existsSync(uc)).toBe(true);
    const body = readFileSync(uc, 'utf8');
    expect(body).toContain('guest_username=ysks_a1b2c3d4e5f6');
    expect(body).toContain('local_root=');
  });

  it('applyFtpsService with execute disabled writes config and blocks system', async () => {
    const { host, db, dir } = setup();
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });

    const r = await applyFtpsService({
      db,
      dataDir: dir,
      host,
      applySystem: true,
      settingsPatch: { listenPort: 21, banner: 'Test FTPS' },
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(r.written.some((p) => p.endsWith('vsftpd.conf'))).toBe(true);
    expect(existsSync(ftpsPaths(dir).conf)).toBe(true);
    expect(readFileSync(ftpsPaths(dir).conf, 'utf8')).toContain('ftpd_banner=Test FTPS');
    const accounts = listResources(db, 'ftp_accounts');
    expect(accounts.every((a) => a.apply_status === 'pending_execute')).toBe(true);
    expect(r.steps?.some((s) => s.status === 'blocked')).toBe(true);
  });

  it('applyFtpsService applySystem=false is config-only ok without execute', async () => {
    const { host, db, dir } = setup();
    const r = await applyFtpsService({
      db,
      dataDir: dir,
      host,
      applySystem: false,
    });
    expect(r.ok).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(existsSync(ftpsPaths(dir).conf)).toBe(true);
  });

  it('applyFtpAccountReal blocks without execute and marks pending_execute', async () => {
    const { host, db, dir } = setup();
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });
    expect(created.ok).toBe(true);
    const id = String(created.account.id);

    const r = await applyFtpAccountReal({ db, dataDir: dir, host, id });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.steps?.some((s) => s.status === 'blocked')).toBe(true);
    const row = listResources(db, 'ftp_accounts').find((a) => a.id === id);
    expect(row?.apply_status).toBe('pending_execute');
  });

  it('probeFtpsStatus returns settings and account count', async () => {
    const { host, db, dir } = setup();
    const st = await probeFtpsStatus({ db, dataDir: dir, host });
    expect(st.settings.listenPort).toBe(21);
    expect(st.accountCount).toBe(0);
    expect(st.confManaged).toBe(ftpsPaths(dir).conf);
    expect(typeof st.installed).toBe('boolean');
  });
});
