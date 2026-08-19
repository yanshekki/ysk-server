import { isFtpUsername, tl } from 'ysk-server-shared';
/**
 * Real FTPS (vsftpd) control plane: settings, conf generation, virtual users, status, apply.
 * Panel-only execution — never asks the user to run CLI.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { panelBlockMessage, type ApplyResult, type BlockReason } from './system-apply.js';
import { createResource, listResources, updateResource } from './managed-resources.js';
import {
  HostSoftwareProbe,
  shellEnsureAptPackage,
  shellBinExists,
} from './software-probe/index.js';

/**
 * crypt(3)-compatible hash for pam_userdb (crypt=crypt).
 * Prefer openssl passwd -6; fallback MD5-crypt-like is not ideal — use $6$ when possible.
 */
export function hashFtpPassword(plain: string): string {
  const p = String(plain);
  try {
    const out = execFileSync('openssl', ['passwd', '-6', '-stdin'], {
      input: p + '\n',
      encoding: 'utf8',
      timeout: 5_000 });
    const line = out.trim().split('\n').filter(Boolean).pop();
    if (line && line.startsWith('$')) return line;
  } catch {
    /* fall through */
  }
  try {
    const out = execFileSync('openssl', ['passwd', '-1', '-stdin'], {
      input: p + '\n',
      encoding: 'utf8',
      timeout: 5_000 });
    const line = out.trim().split('\n').filter(Boolean).pop();
    if (line && line.startsWith('$')) return line;
  } catch {
    /* fall through */
  }
  // Last resort: not standard crypt — mark so apply notes warn
  const salt = randomBytes(8).toString('hex');
  return `{SHA256}${createHash('sha256').update(salt + p).digest('hex')}`;
}

export function isCryptPasswordHash(value: string): boolean {
  return (
    value.startsWith('$1$') ||
    value.startsWith('$5$') ||
    value.startsWith('$6$') ||
    value.startsWith('$y$') ||
    value.startsWith('$2') // bcrypt unlikely for pam_userdb but keep
  );
}

export const FTPS_SETTINGS_KEY = 'ftps_settings';

export interface FtpsSettings {
  listen: boolean;
  /**
   * IPv6 listen (vsftpd: listen_ipv6).
   * When true with dual-stack intent: listen=NO + listen_ipv6=YES
   * (IPv6 socket; may accept v4-mapped depending on bindv6only).
   * Default false keeps classic IPv4-only.
   */
  listenIpv6: boolean;
  listenPort: number;
  /**
   * New installs bind loopback. Missing stored field = public (do not
   * silently shrink an existing public listener).
   */
  bindAddress?: 'localhost' | 'public';
  sslEnable: boolean;
  forceSsl: boolean;
  /** Domain used to locate cert under dataDir/certs or LE path */
  sslDomain: string;
  certPath?: string;
  keyPath?: string;
  pasvMin: number;
  pasvMax: number;
  pasvAddress?: string;
  writeEnable: boolean;
  chrootLocalUser: boolean;
  allowWriteableChroot: boolean;
  banner: string;
  /** Guest system user for virtual accounts */
  guestUsername: string;
}

export const DEFAULT_FTPS_SETTINGS: FtpsSettings = {
  listen: true,
  listenIpv6: false,
  listenPort: 21,
  bindAddress: 'localhost',
  sslEnable: false,
  forceSsl: false,
  sslDomain: '',
  pasvMin: 30000,
  pasvMax: 30100,
  writeEnable: true,
  chrootLocalUser: true,
  allowWriteableChroot: true,
  banner: 'YSK FTPS',
  guestUsername: 'ftp' };

export type FtpsStep = {
  name: string;
  status: 'ok' | 'skipped' | 'failed' | 'blocked';
  detail?: string;
};

export interface FtpsStatus {
  installed: boolean;
  active: string;
  confManaged: string;
  confSystemExists: boolean;
  accountCount: number;
  settings: FtpsSettings;
  lastAppliedAt?: string;
  /** Values currently in /etc/vsftpd.conf (not panel draft) */
  liveListen?: boolean | null;
  liveListenIpv6?: boolean | null;
  listenConflict?: boolean;
}

export function parseVsftpdListenFlags(conf: string): {
  listen: boolean | null;
  listenIpv6: boolean | null;
  conflict: boolean;
} {
  const listen = /^\s*listen\s*=\s*(YES|NO)\b/im.exec(conf);
  const v6 = /^\s*listen_ipv6\s*=\s*(YES|NO)\b/im.exec(conf);
  const listenYes = listen ? listen[1].toUpperCase() === 'YES' : null;
  const v6Yes = v6 ? v6[1].toUpperCase() === 'YES' : null;
  return {
    listen: listenYes,
    listenIpv6: v6Yes,
    conflict: listenYes === true && v6Yes === true,
  };
}

/**
 * FTP jail must sit under dataDir/ftps/homes or a registered project home.
 * Rejects /etc, /root, and other host paths.
 */
export function isFtpHomeAllowed(
  dataDir: string,
  db: JsonStore,
  homePath: string,
): boolean {
  const raw = String(homePath || '').trim();
  if (!raw || raw.includes('\0')) return false;
  const abs = resolve(raw);
  if (abs === '/' || abs === '/etc' || abs === '/root' || abs === '/home') return false;
  const under = (root: string) => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep);
  };
  if (under(dataDir)) return true;
  const projects = (db.snapshot.projects ?? []) as Array<{
    homeDir?: string;
    home_dir?: string;
  }>;
  for (const p of projects) {
    const h = String(p.homeDir ?? p.home_dir ?? '').trim();
    if (h && under(h)) return true;
  }
  return false;
}

/**
 * Create a jailed FTP account rooted at a project home (or home/app).
 * Virtual user maps to project linuxUser on apply (guest_username per user_conf).
 * Does not apply vsftpd until panel apply — status draft/written honestly.
 */
export function createProjectFtpAccount(
  db: JsonStore,
  input: {
    projectId: string;
    projectHome: string;
    linuxUser: string;
    linuxGroup?: string;
    username?: string;
    password: string;
    /** default: projectHome/app if exists, else projectHome */
    homeSubdir?: 'app' | 'root';
  },
): {
  ok: boolean;
  account: Record<string, unknown>;
  notes: string[];
  written: string[];
} {
  const password = String(input.password || '');
  if (password.length < 8) {
    return {
      ok: false,
      account: {},
      notes: [tl('notes.passwordMin8')],
      written: [] };
  }
  const linuxUser = String(input.linuxUser || '').trim();
  if (!linuxUser) {
    return {
      ok: false,
      account: {},
      notes: [tl('notes.auto.n0696')],
      written: [] };
  }
  const linuxGroup = (input.linuxGroup || linuxUser).trim();
  // Strip ysk_ / ysks_ prefixes for virtual login name
  const stripped = linuxUser.replace(/^ysks?_/, '');
  const baseUser =
    (input.username || `p_${stripped}`).toLowerCase().replace(/[^a-z0-9._-]/g, '') ||
    `p${input.projectId.replace(/-/g, '').slice(0, 8)}`;
  const username = baseUser.slice(0, 32);
  const existing = listResources(db, 'ftp_accounts').find(
    (a) => String(a.username).toLowerCase() === username,
  );
  if (existing) {
    return {
      ok: false,
      account: existing,
      notes: [tl('notes.auto.t0267', { v0: (username) })],
      written: [] };
  }
  const appDir = join(input.projectHome, 'app');
  const homePath =
    input.homeSubdir === 'root'
      ? input.projectHome
      : existsSync(appDir)
        ? appDir
        : input.projectHome;
  mkdirSync(homePath, { recursive: true });
  const password_hash = hashFtpPassword(password);
  if (!isCryptPasswordHash(password_hash)) {
    return {
      ok: false,
      account: {},
      notes: [tl('notes.auto.n1177')],
      written: [] };
  }
  const account = createResource(db, 'ftp_accounts', {
    username,
    password_hash,
    // never persist plaintext after create
    password_plain: undefined,
    homePath,
    projectId: input.projectId,
    linuxUser,
    linuxGroup,
    chroot: true,
    apply_status: 'draft' });
  return {
    ok: true,
    account: {
      id: account.id,
      username,
      homePath,
      projectId: input.projectId,
      linuxUser,
      linuxGroup,
      apply_status: 'draft',
      passwordHashed: true },
    notes: [
      tl('notes.auto.t0268', { v0: (username) }),
      tl('notes.auto.t0269', { v0: (homePath) }),
      tl('notes.auto.t0270'),
      tl('notes.auto.t0271', { v0: (linuxUser) }),
      tl('notes.auto.n1205'),
    ],
    written: [homePath] };
}

export function normalizeFtpBindAddress(
  raw: unknown,
  present: boolean,
): 'localhost' | 'public' {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'localhost' || s === '127.0.0.1' || s === '::1') return 'localhost';
  if (s === 'public' || s === '0.0.0.0' || s === '*' || s === '::') return 'public';
  return present ? 'localhost' : 'public';
}

export function ftpBindIsPublic(settings: Pick<FtpsSettings, 'bindAddress'>): boolean {
  return normalizeFtpBindAddress(settings.bindAddress, settings.bindAddress != null) === 'public';
}

/** Public plaintext start needs an explicit allow flag (UI types PLAINTEXT). */
export function assertFtpStartAllowed(input: {
  settings: Pick<FtpsSettings, 'bindAddress' | 'sslEnable'>;
  sslReady: boolean;
  allowPlaintextPublic?: boolean;
}): { ok: true } | { ok: false; blockMessage: string } {
  const ftpsOn = Boolean(input.settings.sslEnable && input.sslReady);
  if (ftpsOn || !ftpBindIsPublic(input.settings)) return { ok: true };
  if (input.allowPlaintextPublic) return { ok: true };
  return { ok: false, blockMessage: tl('notes.ftp.publicPlaintextBlocked') };
}

export function loadFtpsSettings(db: JsonStore): FtpsSettings {
  const raw = db.snapshot.settings?.[FTPS_SETTINGS_KEY];
  if (!raw) return { ...DEFAULT_FTPS_SETTINGS };
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as FtpsSettings;
    const present =
      parsed != null && typeof parsed === 'object' && 'bindAddress' in parsed;
    return {
      ...DEFAULT_FTPS_SETTINGS,
      ...parsed,
      bindAddress: normalizeFtpBindAddress(parsed.bindAddress, present),
    };
  } catch {
    return { ...DEFAULT_FTPS_SETTINGS };
  }
}

export function saveFtpsSettings(db: JsonStore, patch: Partial<FtpsSettings>): FtpsSettings {
  const next = { ...loadFtpsSettings(db), ...patch };
  // normalize numbers
  next.listenPort = clampPort(next.listenPort, 21);
  next.pasvMin = clampPort(next.pasvMin, 30000);
  next.pasvMax = clampPort(next.pasvMax, 30100);
  if (next.pasvMax < next.pasvMin) next.pasvMax = next.pasvMin + 100;
  next.sslDomain = String(next.sslDomain ?? '').trim().toLowerCase();
  next.guestUsername = String(next.guestUsername || 'ftp').replace(/[^a-z0-9_-]/gi, '') || 'ftp';
  next.banner = String(next.banner || 'YSK FTPS').slice(0, 120);
  next.bindAddress = normalizeFtpBindAddress(next.bindAddress, true);
  db.snapshot.settings[FTPS_SETTINGS_KEY] = JSON.stringify(next);
  db.persist();
  return next;
}

function clampPort(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 65535) return fallback;
  return v;
}

export function ftpsPaths(dataDir: string) {
  const root = join(dataDir, 'ftps');
  return {
    root,
    conf: join(root, 'vsftpd.conf'),
    pam: join(root, 'pam.d', 'ysk-vsftpd'),
    userDbTxt: join(root, 'virtual_users.txt'),
    userDb: join(root, 'virtual_users.db'),
    userConfDir: join(root, 'user_conf'),
    homes: join(root, 'homes'),
    mapPath: join(root, 'virtual_users.map') };
}

/** Resolve cert/key paths from settings + dataDir certs */
export function resolveCertPaths(
  dataDir: string,
  settings: FtpsSettings,
): { cert: string; key: string; ok: boolean } {
  if (settings.certPath && settings.keyPath) {
    return {
      cert: settings.certPath,
      key: settings.keyPath,
      ok: existsSync(settings.certPath) && existsSync(settings.keyPath) };
  }
  const domain = settings.sslDomain;
  if (domain) {
    const managed = {
      cert: join(dataDir, 'certs', domain, 'fullchain.pem'),
      key: join(dataDir, 'certs', domain, 'privkey.pem') };
    if (existsSync(managed.cert) && existsSync(managed.key)) {
      return { ...managed, ok: true };
    }
    const le = {
      cert: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      key: `/etc/letsencrypt/live/${domain}/privkey.pem` };
    if (existsSync(le.cert) && existsSync(le.key)) {
      return { ...le, ok: true };
    }
    return { ...managed, ok: false };
  }
  return { cert: '', key: '', ok: false };
}

export function buildVsftpdConf(input: {
  dataDir: string;
  settings: FtpsSettings;
}): string {
  const paths = ftpsPaths(input.dataDir);
  const resolved = resolveCertPaths(input.dataDir, input.settings);
  const { cert, key } = resolved;
  const s = input.settings;
  const sslOn = Boolean(s.sslEnable && resolved.ok && cert && key);
  // vsftpd: listen and listen_ipv6 are mutually exclusive on many builds.
  // dual: listen=NO + listen_ipv6=YES (IPv6 socket; v4-mapped if bindv6only=0)
  // ipv6-only: same as dual with listen flag false
  // ipv4-only: listen=YES + listen_ipv6=NO
  const wantV6 = Boolean(s.listenIpv6);
  const wantV4 = s.listen !== false && !wantV6 ? true : s.listen && !wantV6;
  const listenV4 = wantV6 ? false : wantV4;
  const listenV6 = wantV6;
  const lines = [
    '# Generated by YSK Server — do not edit by hand; use admin panel',
    `# stack: ${listenV6 ? (s.listen ? 'ipv6-primary (dual via mapped)' : 'ipv6') : 'ipv4'}`,
    listenV4 ? 'listen=YES' : 'listen=NO',
    listenV6 ? 'listen_ipv6=YES' : 'listen_ipv6=NO',
    `listen_port=${s.listenPort}`,
    ...(normalizeFtpBindAddress(s.bindAddress, s.bindAddress != null) === 'localhost'
      ? listenV6
        ? ['listen_address6=::1']
        : ['listen_address=127.0.0.1']
      : []),
    'anonymous_enable=NO',
    'local_enable=YES',
    s.writeEnable ? 'write_enable=YES' : 'write_enable=NO',
    'local_umask=022',
    'dirmessage_enable=YES',
    'use_localtime=YES',
    'xferlog_enable=YES',
    'connect_from_port_20=YES',
    s.chrootLocalUser ? 'chroot_local_user=YES' : 'chroot_local_user=NO',
    s.allowWriteableChroot ? 'allow_writeable_chroot=YES' : 'allow_writeable_chroot=NO',
    'pam_service_name=ysk-vsftpd',
    'userlist_enable=NO',
    'tcp_wrappers=YES',
    'guest_enable=YES',
    `guest_username=${s.guestUsername}`,
    'virtual_use_local_privs=YES',
    'user_sub_token=$USER',
    `local_root=${paths.homes}/$USER`,
    `user_config_dir=${paths.userConfDir}`,
    `pasv_min_port=${s.pasvMin}`,
    `pasv_max_port=${s.pasvMax}`,
    s.pasvAddress ? `pasv_address=${s.pasvAddress}` : '# pasv_address=',
    `ftpd_banner=${s.banner.replace(/[\r\n]/g, ' ')}`,
    sslOn ? 'ssl_enable=YES' : 'ssl_enable=NO',
    s.forceSsl && sslOn ? 'force_local_data_ssl=YES' : 'force_local_data_ssl=NO',
    s.forceSsl && sslOn ? 'force_local_logins_ssl=YES' : 'force_local_logins_ssl=NO',
    'ssl_tlsv1=YES',
    'ssl_sslv2=NO',
    'ssl_sslv3=NO',
    'require_ssl_reuse=NO',
    'ssl_ciphers=HIGH',
  ];
  if (sslOn && cert && key) {
    lines.push(`rsa_cert_file=${cert}`, `rsa_private_key_file=${key}`);
  } else if (s.sslEnable && !resolved.ok) {
    lines.push('# ssl_enable skipped — no certificate for sslDomain');
  }
  return lines.join('\n') + '\n';
}

/**
 * pam_userdb requires the Berkeley DB path **without** the `.db` suffix
 * (the module / libdb append `.db` themselves). Passing `…/virtual_users.db`
 * makes it open `…/virtual_users.db.db` → every login fails with 530.
 *
 * Note: do not use `/\\.db$/` in a JS regex literal — that matches a
 * backslash + any char + "db", not a literal ".db" extension.
 */
export function pamUserDbBasePath(userDbPath: string): string {
  return String(userDbPath).replace(/\.db$/i, '');
}

/**
 * Ports the operator must open (host firewall + cloud security group).
 * Apply never mutates UFW — only reminds. LIST timeout after login = PASV blocked.
 */
export function ftpsFirewallPortSpecs(settings: Pick<FtpsSettings, 'listenPort' | 'pasvMin' | 'pasvMax'>): string[] {
  const listen = clampPort(settings.listenPort, 21);
  const min = clampPort(settings.pasvMin, 30000);
  const max = clampPort(settings.pasvMax, 30100);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const specs = [String(listen)];
  if (lo === hi) specs.push(String(lo));
  else specs.push(`${lo}:${hi}`);
  // Implicit FTPS (990) often used alongside explicit 21
  if (listen !== 990) specs.push('990');
  return [...new Set(specs)];
}

/** Reminder notes only — does not open ports. */
export function ftpsFirewallReminderNotes(
  settings: Pick<FtpsSettings, 'listenPort' | 'pasvMin' | 'pasvMax'>,
): string[] {
  const ports = ftpsFirewallPortSpecs(settings).join(', ');
  return [
    tl('notes.ftp.openPortsReminder', { ports }),
    tl('notes.ftp.openPortsPasvHint'),
  ];
}

export function buildPamSnippet(dataDir: string): string {
  const db = pamUserDbBasePath(ftpsPaths(dataDir).userDb);
  return [
    '# Generated by YSK Server',
    `auth required pam_userdb.so db=${db} crypt=crypt`,
    `account required pam_userdb.so db=${db}`,
    '',
  ].join('\n');
}

/**
 * Write managed account files under dataDir (always allowed).
 * Returns paths written; does not touch system unless host provided with execute.
 */
export function writeManagedFtpAccounts(input: {
  db: JsonStore;
  dataDir: string;
}): {
  written: string[];
  accounts: Array<{ username: string; home: string }>;
  notes: string[];
} {
  const paths = ftpsPaths(input.dataDir);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.userConfDir, { recursive: true });
  mkdirSync(paths.homes, { recursive: true });
  mkdirSync(join(paths.root, 'pam.d'), { recursive: true });

  const accounts = listResources(input.db, 'ftp_accounts');
  const mapLines: string[] = [];
  const dbLines: string[] = [];
  const list: Array<{ username: string; home: string }> = [];
  const notes: string[] = [];
  const written: string[] = [];

  const settings = loadFtpsSettings(input.db);
  const projects = (input.db.snapshot.projects ?? []) as unknown as Array<Record<string, unknown>>;

  for (const a of accounts) {
    const username = String(a.username ?? '').trim();
    if (!username || !/^[a-zA-Z0-9._-]+$/.test(username)) {
      notes.push(tl('notes.auto.t0272'));
      continue;
    }
    const home = String(a.homePath || join(paths.homes, username));
    if (!isFtpHomeAllowed(input.dataDir, input.db, home)) {
      notes.push(tl('notes.auto.t0272'));
      continue;
    }
    mkdirSync(home, { recursive: true });
    // crypt hash for pam_userdb. Fresh password_plain wins (create / reset);
    // otherwise reuse stored password_hash. Never leave plaintext after write.
    let passwordHash = String(a.password_hash ?? '').trim();
    const plain = String(a.password_plain ?? a.password ?? '').trim();
    if (plain) {
      passwordHash = hashFtpPassword(plain);
      if (isCryptPasswordHash(passwordHash) && a.id) {
        try {
          updateResource(input.db, 'ftp_accounts', String(a.id), {
            password_hash: passwordHash,
            password_plain: '',
            password: '',
          });
          notes.push(tl('notes.auto.t0273', { v0: (username) }));
        } catch {
          /* best-effort */
        }
      }
    }
    mapLines.push(`${username}:*:***:${home}`);
    // pam_userdb crypt=crypt expects username\\nhash\\n pairs for db_load
    if (passwordHash && isCryptPasswordHash(passwordHash)) {
      dbLines.push(username, passwordHash);
    } else if (passwordHash.startsWith('{SHA256}')) {
      notes.push(
        tl('notes.auto.t0274', { v0: (username) }),
      );
      dbLines.push(username, passwordHash);
    } else {
      notes.push(tl('notes.auto.t0275', { v0: (username) }));
    }

    // Resolve project Linux user for ownership of uploaded files
    let linuxUser = String(a.linuxUser ?? a.linux_user ?? '').trim();
    const projectId = String(a.projectId ?? a.project_id ?? '').trim();
    if (!linuxUser && projectId) {
      const proj = projects.find((p) => String(p.id) === projectId);
      if (proj) {
        linuxUser = String(proj.linux_user ?? proj.linuxUser ?? '').trim();
      }
    }
    if (!linuxUser) {
      linuxUser = settings.guestUsername;
      if (projectId) {
        notes.push(
          tl('notes.auto.t0276', { v0: (username), v1: (linuxUser) }),
        );
      }
    }

    const uc = join(paths.userConfDir, username);
    // Per-user guest_username overrides global guest — files owned by project user
    const confLines = [
      `local_root=${home}`,
      `guest_username=${linuxUser}`,
      'write_enable=YES',
      'local_umask=022',
      '',
    ];
    writeFileSync(uc, confLines.join('\n'), 'utf8');
    written.push(uc);
    list.push({ username, home });
    // Persist resolved linuxUser for apply chown
    if (a.linuxUser !== linuxUser && projectId) {
      try {
        updateResource(input.db, 'ftp_accounts', String(a.id), { linuxUser });
      } catch {
        /* best-effort */
      }
    }
  }

  writeFileSync(paths.mapPath, mapLines.join('\n') + (mapLines.length ? '\n' : ''), 'utf8');
  written.push(paths.mapPath);
  writeFileSync(paths.userDbTxt, dbLines.join('\n') + (dbLines.length ? '\n' : ''), 'utf8');
  written.push(paths.userDbTxt);
  writeFileSync(paths.pam, buildPamSnippet(input.dataDir), 'utf8');
  written.push(paths.pam);

  notes.push(tl('notes.auto.t0277', { v0: (list.length) }));
  return { written, accounts: list, notes };
}

export async function probeFtpsStatus(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
}): Promise<FtpsStatus> {
  const settings = loadFtpsSettings(input.db);
  const paths = ftpsPaths(input.dataDir);
  const probe = new HostSoftwareProbe(input.host);
  const vs = await probe.presence('vsftpd');
  const installed = vs.installed;
  let active = vs.units?.[0]?.active ?? 'unknown';
  if (active === 'unknown' && installed) {
    if (input.host.pathExists('/bin/systemctl') || input.host.pathExists('/usr/bin/systemctl')) {
      const r = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
        timeoutMs: 5_000 });
      active = (r.stdout || r.stderr || `exit_${r.exitCode}`).trim().split('\n')[0] ?? 'unknown';
    }
  } else if (!installed) {
    active = 'not_installed';
  }
  const meta = input.db.snapshot.settings?.['ftps_last_applied_at'];
  let liveListen: boolean | null = null;
  let liveListenIpv6: boolean | null = null;
  let listenConflict = false;
  try {
    const { readFileSync } = await import('node:fs');
    if (existsSync('/etc/vsftpd.conf')) {
      const flags = parseVsftpdListenFlags(readFileSync('/etc/vsftpd.conf', 'utf8'));
      liveListen = flags.listen;
      liveListenIpv6 = flags.listenIpv6;
      listenConflict = flags.conflict;
    }
  } catch {
    /* optional */
  }
  return {
    installed,
    active,
    confManaged: paths.conf,
    confSystemExists: existsSync('/etc/vsftpd.conf'),
    accountCount: listResources(input.db, 'ftp_accounts').length,
    settings,
    lastAppliedAt: typeof meta === 'string' ? meta : undefined,
    liveListen,
    liveListenIpv6,
    listenConflict,
  };
}

/**
 * Full FTPS apply: write conf + accounts, optionally install/start vsftpd.
 */
export async function applyFtpsService(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  /** Install packages + copy to system + enable (default true for panel) */
  applySystem?: boolean;
  settingsPatch?: Partial<FtpsSettings>;
  /** One-shot: allow public bind without FTPS (operator typed PLAINTEXT). */
  allowPlaintextPublic?: boolean;
}): Promise<
  ApplyResult & {
    requiresExecute: boolean;
    requiresRoot: boolean;
    settings: FtpsSettings;
    status?: FtpsStatus;
    executed: boolean;
  }
> {
  const settings = input.settingsPatch
    ? saveFtpsSettings(input.db, input.settingsPatch)
    : loadFtpsSettings(input.db);

  const paths = ftpsPaths(input.dataDir);
  mkdirSync(paths.root, { recursive: true });
  const steps: FtpsStep[] = [];
  const written: string[] = [];
  const notes: string[] = [];
  const commandResults: ApplyResult['commandResults'] = [];

  const certs = resolveCertPaths(input.dataDir, settings);
  if (settings.sslEnable && !certs.ok) {
    notes.push(
      'TLS is on but no certificate was found (set sslDomain to an issued cert, or leave TLS off). Writing ssl_enable=NO so vsftpd can start.',
    );
  }

  // 1. conf
  const conf = buildVsftpdConf({ dataDir: input.dataDir, settings });
  writeFileSync(paths.conf, conf, 'utf8');
  written.push(paths.conf);
  steps.push({ name: tl('notes.ftp.writeVsftpd'), status: 'ok', detail: paths.conf });

  // 2. accounts
  const acc = writeManagedFtpAccounts({ db: input.db, dataDir: input.dataDir });
  written.push(...acc.written);
  notes.push(...acc.notes);
  steps.push({ name: tl('notes.auto.n0617'), status: 'ok', detail: tl('notes.auto.t0278', { v0: (acc.accounts.length) }) });

  const wantSystem = input.applySystem !== false;
  const can =
    wantSystem && input.host.executeEnabled() && input.host.isRoot();
  let blockReason: BlockReason | undefined;
  let blockMessage: string | undefined;

  if (wantSystem && !can) {
    blockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    blockMessage = panelBlockMessage(blockReason);
    notes.push(blockMessage);
    steps.push({ name: tl('notes.auto.n0644'), status: 'blocked', detail: blockMessage });
    // mark accounts pending
    for (const a of listResources(input.db, 'ftp_accounts')) {
      updateResource(input.db, 'ftp_accounts', String(a.id), {
        apply_status: 'pending_execute',
        homePath:
          a.homePath ||
          join(paths.homes, String(a.username)) });
    }
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockReason,
      blockMessage,
      written,
      commands: [],
      commandResults,
      notes,
      steps,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      settings,
      status: await probeFtpsStatus(input) };
  }

  if (can) {
    const startGate = assertFtpStartAllowed({
      settings,
      sslReady: Boolean(settings.sslEnable && certs.ok),
      allowPlaintextPublic: input.allowPlaintextPublic === true,
    });
    if (!startGate.ok) {
      notes.push(startGate.blockMessage);
      steps.push({
        name: tl('notes.ftp.startVsftpd'),
        status: 'blocked',
        detail: startGate.blockMessage,
      });
      return {
        ok: false,
        executed: false,
        blocked: true,
        blockReason: 'validation',
        blockMessage: startGate.blockMessage,
        written,
        commands: [],
        commandResults,
        notes,
        steps,
        requiresExecute: false,
        requiresRoot: false,
        settings,
        status: await probeFtpsStatus(input),
      };
    }

    // ensure guest user exists
    const gu = settings.guestUsername;
    const idr = await input.host.runCommand(
      ['bash', '-c', `id -u ${gu} >/dev/null 2>&1 || useradd -r -d ${paths.homes} -s /usr/sbin/nologin ${gu}`],
      { timeoutMs: 30_000 },
    );
    commandResults.push({
      argv: ['useradd', gu],
      exitCode: idr.exitCode,
      stderr: idr.stderr });
    steps.push({
      name: tl('notes.auto.n1287'),
      status: idr.exitCode === 0 ? 'ok' : 'failed',
      detail: idr.exitCode === 0 ? gu : idr.stderr || tl('notes.failed') });

    // install packages
    const inst = await input.host.runCommand(
      [
        'bash',
        '-c',
        shellEnsureAptPackage('vsftpd', 'vsftpd db-util libpam-modules'),
      ],
      { timeoutMs: 300_000 },
    );
    commandResults.push({
      argv: ['apt-get', 'install', 'vsftpd'],
      exitCode: inst.exitCode,
      stderr: inst.stderr });
    steps.push({
      name: tl('notes.auto.n0653'),
      status: inst.exitCode === 0 ? 'ok' : 'failed',
      detail: inst.exitCode === 0 ? tl('notes.auto.n0721') : inst.stderr || tl('notes.auto.n0654') });

    // build userdb if db_load available (required for virtual-user auth)
    const dbLoad = await input.host.runCommand(
      [
        'bash',
        '-c',
        `if ${shellBinExists('db_load')}; then db_load -T -t hash -f ${JSON.stringify(paths.userDbTxt)} ${JSON.stringify(paths.userDb)}; else echo 'db_load missing' >&2; exit 127; fi`,
      ],
      { timeoutMs: 30_000 },
    );
    commandResults.push({
      argv: ['db_load'],
      exitCode: dbLoad.exitCode,
      stderr: dbLoad.stderr });
    const userDbOk = dbLoad.exitCode === 0 && existsSync(paths.userDb);
    if (userDbOk) {
      try {
        chmodSync(paths.userDb, 0o600);
      } catch {
        /* ignore */
      }
      steps.push({ name: tl('notes.auto.n0009'), status: 'ok' });
    } else {
      steps.push({
        name: tl('notes.auto.n0009'),
        status: 'failed',
        detail: dbLoad.stderr || tl('notes.auto.n1167') });
      notes.push(tl('notes.auto.n1168'));
    }

    // copy conf + pam
    const cpConf = await input.host.runCommand(['cp', paths.conf, '/etc/vsftpd.conf'], {
      timeoutMs: 10_000 });
    commandResults.push({
      argv: ['cp', 'vsftpd.conf'],
      exitCode: cpConf.exitCode,
      stderr: cpConf.stderr });
    steps.push({
      name: tl('notes.auto.n0658'),
      status: cpConf.exitCode === 0 ? 'ok' : 'failed',
      detail: cpConf.exitCode === 0 ? '/etc/vsftpd.conf' : cpConf.stderr });

    mkdirSync('/etc/pam.d', { recursive: true });
    const cpPam = await input.host.runCommand(['cp', paths.pam, '/etc/pam.d/ysk-vsftpd'], {
      timeoutMs: 10_000 });
    commandResults.push({
      argv: ['cp', 'pam'],
      exitCode: cpPam.exitCode,
      stderr: cpPam.stderr });
    steps.push({
      name: tl('notes.auto.n0652'),
      status: cpPam.exitCode === 0 ? 'ok' : 'failed' });

    // Ownership: project-bound jails → project linuxUser; FTPS-only homes → guest
    const chownNotes = await chownFtpAccountHomes(input.host, input.db, settings.guestUsername);
    notes.push(...chownNotes);
    steps.push({
      name: tl('notes.auto.n0700'),
      status: 'ok',
      detail: chownNotes.slice(0, 3).join('；') || tl('notes.auto.n0010') });

    const en = await input.host.runCommand(['systemctl', 'enable', '--now', 'vsftpd'], {
      timeoutMs: 60_000 });
    commandResults.push({
      argv: ['systemctl', 'enable', '--now', 'vsftpd'],
      exitCode: en.exitCode,
      stderr: en.stderr });
    const rel = await input.host.runCommand(['systemctl', 'restart', 'vsftpd'], {
      timeoutMs: 30_000 });
    commandResults.push({
      argv: ['systemctl', 'restart', 'vsftpd'],
      exitCode: rel.exitCode,
      stderr: rel.stderr });
    const act = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
      timeoutMs: 5_000 });
    const active = (act.stdout || '').trim();
    const svcOk = active === 'active';
    steps.push({
      name: tl('notes.ftp.startVsftpd'),
      status: svcOk ? 'ok' : 'failed',
      detail: active || en.stderr || rel.stderr });

    // Auto-sync firewall ports (ysk-svc:vsftpd:*) — replace manual open-port CTA
    try {
      const { syncServiceExposure, ftpsPortBindings } = await import('./service-exposure/index.js');
      const exp = await syncServiceExposure({
        host: input.host,
        dataDir: input.dataDir,
        serviceId: 'vsftpd',
        ports: ftpsPortBindings(settings),
        reason: 'port-change',
        requireDecision: false,
      });
      notes.push(...exp.notes.slice(0, 6));
      steps.push({
        name: tl('notes.ftp.openPortsStep'),
        status: exp.blocked ? 'blocked' : exp.ok ? 'ok' : 'failed',
        detail: ftpsFirewallPortSpecs(settings).join(', '),
      });
    } catch {
      notes.push(...ftpsFirewallReminderNotes(settings));
      steps.push({
        name: tl('notes.ftp.openPortsStep'),
        status: 'ok',
        detail: ftpsFirewallPortSpecs(settings).join(', '),
      });
    }

    // Auth works only when conf + PAM + userdb are all in place; vsftpd up alone is not enough.
    const pamOk = cpPam.exitCode === 0;
    const ok = svcOk && cpConf.exitCode === 0 && pamOk && userDbOk;
    if (ok) {
      notes.push(tl('notes.ftp.vsftpdStarted'));
      input.db.snapshot.settings['ftps_last_applied_at'] = new Date().toISOString();
      input.db.persist();
      for (const a of listResources(input.db, 'ftp_accounts')) {
        updateResource(input.db, 'ftp_accounts', String(a.id), {
          apply_status: 'applied',
          homePath: a.homePath || join(paths.homes, String(a.username)) });
      }
    } else {
      notes.push(tl('notes.auto.n0465'));
      if (!userDbOk) notes.push(tl('notes.auto.n1168'));
      if (!pamOk) notes.push(tl('notes.auto.n0652'));
      for (const a of listResources(input.db, 'ftp_accounts')) {
        updateResource(input.db, 'ftp_accounts', String(a.id), {
          apply_status: 'failed' });
      }
    }

    return {
      ok,
      executed: true,
      blocked: false,
      written,
      commands: [],
      commandResults,
      notes,
      steps,
      requiresExecute: false,
      requiresRoot: false,
      settings,
      status: await probeFtpsStatus(input) };
  }

  // applySystem false: config only
  notes.push(tl('notes.auto.n0734'));
  return {
    ok: true,
    executed: false,
    written,
    commands: [],
    commandResults,
    notes,
    steps,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    settings,
    status: await probeFtpsStatus(input) };
}

/**
 * Apply one FTP account: rewrite all managed users + try system reload if possible.
 */
export async function applyFtpAccountReal(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
  id: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  blockMessage?: string;
  executed?: boolean;
  steps?: FtpsStep[];
}> {
  const acc = listResources(input.db, 'ftp_accounts').find((a) => a.id === input.id);
  if (!acc) return { ok: false, notes: [tl('notes.auto.n0011')] };

  const paths = ftpsPaths(input.dataDir);
  const home = String(acc.homePath || join(paths.homes, String(acc.username)));
  if (!isFtpHomeAllowed(input.dataDir, input.db, home)) {
    return { ok: false, notes: [tl('notes.auto.n0878')] };
  }
  mkdirSync(home, { recursive: true });
  updateResource(input.db, 'ftp_accounts', input.id, { homePath: home });

  // Always rewrite managed files for all accounts
  const managed = writeManagedFtpAccounts({ db: input.db, dataDir: input.dataDir });
  const notes = [...managed.notes];
  const steps: FtpsStep[] = [
    { name: tl('notes.auto.n0677'), status: 'ok', detail: home },
  ];
  if (input.host.executeEnabled() && input.host.isRoot()) {
    const settings = loadFtpsSettings(input.db);
    const ch = await chownFtpAccountHomes(input.host, input.db, settings.guestUsername);
    notes.push(...ch);
  }

  // If system already applied before, try reload
  const can = input.host.executeEnabled() && input.host.isRoot();
  if (!can) {
    updateResource(input.db, 'ftp_accounts', input.id, {
      apply_status: 'pending_execute',
      homePath: home });
    const blockMessage = panelBlockMessage(
      !input.host.executeEnabled() ? 'no_execute' : 'no_root',
    );
    notes.push(blockMessage);
    notes.push(tl('notes.auto.n0814'));
    steps.push({ name: tl('notes.auto.n0643'), status: 'blocked', detail: blockMessage });
    return {
      ok: false,
      notes,
      blocked: true,
      blockMessage,
      executed: false,
      steps };
  }

  // Full light apply: rebuild db + reload (conf already expected)
  const settings = loadFtpsSettings(input.db);
  writeFileSync(
    paths.conf,
    buildVsftpdConf({ dataDir: input.dataDir, settings }),
    'utf8',
  );
  writeFileSync(paths.pam, buildPamSnippet(input.dataDir), 'utf8');

  await input.host.runCommand(
    [
      'bash',
      '-c',
      `if ${shellBinExists('db_load')}; then db_load -T -t hash -f ${JSON.stringify(paths.userDbTxt)} ${JSON.stringify(paths.userDb)}; fi`,
    ],
    { timeoutMs: 30_000 },
  );
  await input.host.runCommand(['cp', paths.conf, '/etc/vsftpd.conf'], { timeoutMs: 10_000 });
  await input.host.runCommand(['cp', paths.pam, '/etc/pam.d/ysk-vsftpd'], { timeoutMs: 10_000 });
  const rel = await input.host.runCommand(['systemctl', 'reload', 'vsftpd'], {
    timeoutMs: 30_000 });
  if (rel.exitCode !== 0) {
    await input.host.runCommand(['systemctl', 'restart', 'vsftpd'], { timeoutMs: 30_000 });
  }
  const act = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
    timeoutMs: 5_000 });
  const active = (act.stdout || '').trim();
  if (active === 'active') {
    updateResource(input.db, 'ftp_accounts', input.id, {
      apply_status: 'applied',
      homePath: home });
    notes.push(tl('notes.auto.t0279', { v0: String(acc.username) }));
    steps.push({ name: tl('notes.auto.n1514'), status: 'ok', detail: active });
    return { ok: true, notes, executed: true, steps };
  }

  // try full install path
  const full = await applyFtpsService({
    db: input.db,
    dataDir: input.dataDir,
    host: input.host,
    applySystem: true });
  return {
    ok: full.ok,
    notes: full.notes,
    blocked: full.blocked,
    blockMessage: full.blockMessage,
    executed: full.executed,
    steps: full.steps as FtpsStep[] };
}

/**
 * chown each FTP jail to its project linuxUser (or guest for unbound accounts).
 */
export async function chownFtpAccountHomes(
  host: HostExecutor,
  db: JsonStore,
  fallbackGuest: string,
): Promise<string[]> {
  const notes: string[] = [];
  const projects = (db.snapshot.projects ?? []) as unknown as Array<Record<string, unknown>>;
  for (const a of listResources(db, 'ftp_accounts')) {
    const home = String(a.homePath ?? '').trim();
    if (!home || !existsSync(home)) continue;
    let user = String(a.linuxUser ?? a.linux_user ?? '').trim();
    const projectId = String(a.projectId ?? a.project_id ?? '').trim();
    if (!user && projectId) {
      const proj = projects.find((p) => String(p.id) === projectId);
      user = String(proj?.linux_user ?? proj?.linuxUser ?? '').trim();
    }
    if (!user) user = fallbackGuest;
    // Verify system user exists
    const idCheck = await host.runCommand(
      ['bash', '-c', `id ${JSON.stringify(user)} >/dev/null 2>&1; echo $?`],
      { timeoutMs: 5_000 },
    );
    if (!idCheck.stdout.trim().endsWith('0') && idCheck.stdout.trim() !== '0') {
      notes.push(tl('notes.auto.t0280', { v0: (home), v1: (user) }));
      continue;
    }
    const r = await host.runCommand(
      [
        'bash',
        '-c',
        `chown -R ${JSON.stringify(user)}:${JSON.stringify(user)} ${JSON.stringify(home)} 2>&1; chmod u+rwX,g+rX,o-rwx ${JSON.stringify(home)} 2>/dev/null || true`,
      ],
      { timeoutMs: 60_000 },
    );
    if (r.exitCode === 0) {
      notes.push(`chown ${user} → ${home}`);
    } else {
      notes.push(tl('notes.auto.t0281', { v0: (home), v1: ((r.stderr || r.stdout).slice(0, 120)) }));
    }
  }
  return notes;
}

/** Home path options for panel select */
export function listFtpHomeOptions(input: {
  db: JsonStore;
  dataDir: string;
  username?: string;
}): Array<{ value: string; label: string }> {
  const paths = ftpsPaths(input.dataDir);
  const rawUser = String(input.username ?? '').trim();
  const user = isFtpUsername(rawUser) ? rawUser : 'user';
  const opts: Array<{ value: string; label: string }> = [
    {
      value: join(paths.homes, user),
      label: tl('notes.auto.t0282', { v0: (user) }) },
  ];
  const projects = (input.db.snapshot.projects ?? []) as unknown as Array<Record<string, unknown>>;
  for (const p of projects) {
    const name = String(p.name ?? p.id ?? 'project');
    const home = String(p.homeDir ?? p.home_dir ?? '');
    if (home) {
      opts.push({ value: home, label: tl('notes.auto.t0283', { v0: (name) }) });
      const pub = join(home, 'app', 'public');
      opts.push({ value: pub, label: tl('notes.auto.t0284', { v0: (name) }) });
    }
  }
  return opts;
}

/** Domain options for panel select */
export function listFtpDomainOptions(db: JsonStore): Array<{ value: string; label: string }> {
  const set = new Map<string, string>();
  for (const d of db.snapshot.email_domains ?? []) {
    const domain = String((d as Record<string, unknown>).domain ?? '').toLowerCase();
    if (domain) set.set(domain, tl('notes.auto.t0285', { v0: (domain) }));
  }
  for (const s of listResources(db, 'nginx_sites')) {
    const sn = String(s.serverName ?? '').toLowerCase();
    if (sn) set.set(sn, `Nginx ${sn}`);
  }
  for (const c of db.snapshot.certificates ?? []) {
    const domain = String((c as Record<string, unknown>).domain ?? '').toLowerCase();
    if (domain) set.set(domain, `SSL ${domain}`);
  }
  for (const p of (db.snapshot.projects ?? []) as unknown as Array<Record<string, unknown>>) {
    const domain = String(p.domain ?? '').toLowerCase();
    if (domain) set.set(domain, tl('notes.tpl.project', { name: domain }));
  }
  return [...set.entries()].map(([value, label]) => ({ value, label }));
}

