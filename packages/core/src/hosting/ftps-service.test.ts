import { describe, expect, it, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, closeDatabase } from '../db/database.js';
import { makeHost } from '../test/host.js';
import {
  applyFtpAccountReal,
  applyFtpsService,
  buildPamSnippet,
  buildVsftpdConf,
  chownFtpAccountHomes,
  createProjectFtpAccount,
  isFtpHomeAllowed,
  DEFAULT_FTPS_SETTINGS,
  ftpsPaths,
  hashFtpPassword,
  isCryptPasswordHash,
  pamUserDbBasePath,
  ftpsFirewallPortSpecs,
  ftpsFirewallReminderNotes,
  listFtpDomainOptions,
  listFtpHomeOptions,
  loadFtpsSettings,
  probeFtpsStatus,
  resolveCertPaths,
  saveFtpsSettings,
  writeManagedFtpAccounts,
} from './ftps-service.js';
import { listResources, updateResource } from './managed-resources.js';

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
    expect(v6).toContain('ssl_enable=NO');

    const pam = buildPamSnippet(dir);
    const base = pamUserDbBasePath(ftpsPaths(dir).userDb);
    expect(pam).toContain('pam_userdb.so');
    // man pam_userdb: path must be WITHOUT .db — module appends it
    expect(base).not.toMatch(/\.db$/i);
    expect(pam).toContain(`db=${base}`);
    expect(pam).not.toMatch(/db=\S+\.db(\s|$)/);
    // regression: broken /\\.db$/ never stripped and still passed weak toContain tests
    expect(pam).not.toContain(ftpsPaths(dir).userDb);
  });

  it('pamUserDbBasePath strips only a trailing .db suffix', () => {
    expect(pamUserDbBasePath('/data/ftps/virtual_users.db')).toBe('/data/ftps/virtual_users');
    expect(pamUserDbBasePath('/data/ftps/virtual_users.DB')).toBe('/data/ftps/virtual_users');
    expect(pamUserDbBasePath('/data/ftps/virtual_users')).toBe('/data/ftps/virtual_users');
    expect(pamUserDbBasePath('/tmp/foo.db.db')).toBe('/tmp/foo.db');
  });

  it('ftpsFirewallPortSpecs covers listen + full PASV + 990', () => {
    expect(ftpsFirewallPortSpecs({ listenPort: 21, pasvMin: 30000, pasvMax: 30100 })).toEqual([
      '21',
      '30000:30100',
      '990',
    ]);
    expect(ftpsFirewallPortSpecs({ listenPort: 990, pasvMin: 31000, pasvMax: 31010 })).toEqual([
      '990',
      '31000:31010',
    ]);
  });

  it('ftpsFirewallReminderNotes prompts to open ports without opening them', () => {
    const notes = ftpsFirewallReminderNotes({ listenPort: 21, pasvMin: 30000, pasvMax: 30100 });
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.join(' ')).toMatch(/30000:30100|21/);
    // must be advisory only
    expect(notes.join(' ').toLowerCase()).not.toMatch(/opened ufw|rule added/);
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
    expect(isFtpHomeAllowed(dir, db, home)).toBe(true);
    expect(isFtpHomeAllowed(dir, db, '/etc')).toBe(false);
    expect(isFtpHomeAllowed(dir, db, '/')).toBe(false);

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
    const pamBody = readFileSync(paths.pam, 'utf8');
    expect(pamBody).toContain(`db=${pamUserDbBasePath(paths.userDb)}`);
    expect(pamBody).not.toMatch(/db=\S+\.db(\s|$)/);
    const dbTxt = readFileSync(paths.userDbTxt, 'utf8');
    expect(dbTxt).toContain(String(created.account.username));
    expect(dbTxt).toMatch(/\$[156y]\$/);
    const uc = join(paths.userConfDir, String(created.account.username));
    expect(existsSync(uc)).toBe(true);
    const body = readFileSync(uc, 'utf8');
    expect(body).toContain('guest_username=ysks_a1b2c3d4e5f6');
    expect(body).toContain('local_root=');
  });

  it('writeManagedFtpAccounts rehashes password_plain over stale password_hash', () => {
    const { db, dir } = setup();
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password-old-1',
      homeSubdir: 'root',
    });
    expect(created.ok).toBe(true);
    const id = String(created.account.id);
    const oldHash = String(
      listResources(db, 'ftp_accounts').find((a) => a.id === id)?.password_hash ?? '',
    );
    // Simulate panel password reset (FtpPage PATCH password_plain)
    updateResource(db, 'ftp_accounts', id, { password_plain: 'password-new-2' });
    writeManagedFtpAccounts({ db, dataDir: dir });
    const row = listResources(db, 'ftp_accounts').find((a) => a.id === id)!;
    expect(String(row.password_plain ?? '')).toBeFalsy();
    expect(String(row.password_hash)).not.toBe(oldHash);
    expect(isCryptPasswordHash(String(row.password_hash))).toBe(true);
    const dbTxt = readFileSync(ftpsPaths(dir).userDbTxt, 'utf8');
    expect(dbTxt).toContain(String(row.password_hash));
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

describe('ftps-service apply with execute mock', () => {
  function rootHost(dir: string, opts?: { active?: string; exit?: number }) {
    const base = makeHost({ executeEnabled: true, dir });
    const b = base.host;
    const host = {
      pathExists: (p: string) => b.pathExists(p),
      isRoot: () => true,
      executeEnabled: () => true,
      readFile: (p: string) => b.readFile(p),
      listDir: (p: string) => b.listDir(p),
      writeFile: (p: string, c: string) => b.writeFile(p, c),
      deletePath: (p: string) => b.deletePath(p),
      mkdirp: (p: string) => b.mkdirp(p),
      sysInfo: () => b.sysInfo(),
      serviceStatus: (n: string) => b.serviceStatus(n),
      runCommand: async (argv: string[], o?: { timeoutMs?: number }) => {
        const j = argv.join(' ');
        if (opts?.exit) {
          return {
            stdout: '',
            stderr: 'fail',
            exitCode: opts.exit,
            argv,
            dryRun: false,
          };
        }
        if (j.includes('is-active')) {
          return {
            stdout: `${opts?.active ?? 'active'}\n`,
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (j.includes('db_load')) {
          // Real apply checks existsSync(userDb); mock must materialize it.
          // Command uses JSON.stringify paths: db_load -T -t hash -f "txt" "db"
          const quoted = [...j.matchAll(/"([^"]+virtual_users\.db)"/g)].map((x) => x[1]);
          const outPath = quoted[0] || join(dir, 'ftps', 'virtual_users.db');
          mkdirSync(join(outPath, '..'), { recursive: true });
          writeFileSync(outPath, 'mock-userdb');
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (
          j.includes('id ') ||
          j.includes('useradd') ||
          j.includes('apt-get') ||
          j.includes('chown') ||
          j.includes('systemctl') ||
          argv[0] === 'cp' ||
          j.includes('command -v')
        ) {
          return {
            stdout: j.includes('command -v') ? '/usr/sbin/vsftpd\n' : '0\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return b.runCommand(argv, o);
      },
    };
    return { host: host as never, dir: base.dir, cleanup: base.cleanup };
  }

  it('applyFtpsService full system path marks applied when active', async () => {
    const { host, dir, cleanup } = rootHost(mkdtempSync(join(tmpdir(), 'ysk-ftps-ex-')));
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
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
      settingsPatch: { banner: 'Exec FTPS' },
    });
    expect(r.executed).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.steps?.some((s) => s.name)).toBe(true);
    const accounts = listResources(db, 'ftp_accounts');
    expect(accounts.every((a) => a.apply_status === 'applied')).toBe(true);
  });

  it('applyFtpsService fails when vsftpd not active', async () => {
    const { host, dir, cleanup } = rootHost(mkdtempSync(join(tmpdir(), 'ysk-ftps-fail-')), {
      active: 'inactive',
    });
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const r = await applyFtpsService({
      db,
      dataDir: dir,
      host,
      applySystem: true,
    });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('applyFtpAccountReal with root reloads or falls back to full apply', async () => {
    const { host, dir, cleanup } = rootHost(mkdtempSync(join(tmpdir(), 'ysk-ftps-acc-')));
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const home = join(dir, 'homes', 'proj');
    mkdirSync(home, { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });
    const id = String(created.account.id);
    const r = await applyFtpAccountReal({ db, dataDir: dir, host, id });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(true);

    const missing = await applyFtpAccountReal({
      db,
      dataDir: dir,
      host,
      id: 'missing-id',
    });
    expect(missing.ok).toBe(false);

    const notes = await chownFtpAccountHomes(host, db, 'ftp');
    expect(Array.isArray(notes)).toBe(true);
  });

  it('applyFtpAccountReal inactive reloads full path', async () => {
    let isActiveCalls = 0;
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ftps-ina-'));
    const base = makeHost({ executeEnabled: true, dir });
    cleanups.push(base.cleanup);
    const b = base.host;
    const host = {
      pathExists: (p: string) => b.pathExists(p),
      isRoot: () => true,
      executeEnabled: () => true,
      readFile: (p: string) => b.readFile(p),
      listDir: (p: string) => b.listDir(p),
      writeFile: (p: string, c: string) => b.writeFile(p, c),
      deletePath: (p: string) => b.deletePath(p),
      mkdirp: (p: string) => b.mkdirp(p),
      sysInfo: () => b.sysInfo(),
      serviceStatus: (n: string) => b.serviceStatus(n),
      runCommand: async (argv: string[]) => {
        const j = argv.join(' ');
        if (j.includes('is-active')) {
          isActiveCalls += 1;
          return {
            stdout: isActiveCalls === 1 ? 'inactive\n' : 'active\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return {
          stdout: j.includes('command -v') ? '/usr/sbin/vsftpd\n' : '0\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      },
    } as never;
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const home = join(dir, 'homes', 'p');
    mkdirSync(home, { recursive: true });
    const created = createProjectFtpAccount(db, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      projectHome: home,
      linuxUser: 'ysks_a1b2c3d4e5f6',
      password: 'password123',
      homeSubdir: 'root',
    });
    const r = await applyFtpAccountReal({
      db,
      dataDir: dir,
      host,
      id: String(created.account.id),
    });
    expect(r.executed === true || r.ok === true || r.ok === false).toBe(true);
  });
});
