/**
 * Real FTPS (vsftpd) control plane: settings, conf generation, virtual users, status, apply.
 * Panel-only execution — never asks the user to run CLI.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { panelBlockMessage, type ApplyResult, type BlockReason } from './system-apply.js';
import { createResource, listResources, updateResource } from './managed-resources.js';

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
      timeout: 5_000,
    });
    const line = out.trim().split('\n').filter(Boolean).pop();
    if (line && line.startsWith('$')) return line;
  } catch {
    /* fall through */
  }
  try {
    const out = execFileSync('openssl', ['passwd', '-1', '-stdin'], {
      input: p + '\n',
      encoding: 'utf8',
      timeout: 5_000,
    });
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
  sslEnable: true,
  forceSsl: true,
  sslDomain: '',
  pasvMin: 30000,
  pasvMax: 30100,
  writeEnable: true,
  chrootLocalUser: true,
  allowWriteableChroot: true,
  banner: 'YSK FTPS',
  guestUsername: 'ftp',
};

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
      notes: ['密碼至少 8 字元'],
      written: [],
    };
  }
  const linuxUser = String(input.linuxUser || '').trim();
  if (!linuxUser) {
    return {
      ok: false,
      account: {},
      notes: ['專案缺少 linuxUser — 無法建立對齊隔離的 FTP 帳戶'],
      written: [],
    };
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
      notes: [`FTP 用戶已存在: ${username}`],
      written: [],
    };
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
      notes: ['無法產生 crypt 密碼雜湊（需要 openssl passwd）'],
      written: [],
    };
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
    apply_status: 'draft',
  });
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
      passwordHashed: true,
    },
    notes: [
      `已建立 FTP 帳戶 ${username}`,
      `Jail 路徑: ${homePath}`,
      `密碼已以 crypt 雜湊儲存（唔存明文）`,
      `上傳檔將以專案 Linux 用戶擁有：${linuxUser}（套用 vsftpd 後生效）`,
      '狀態 draft — 請到 FTP 服務頁「套用」才會寫入 vsftpd',
    ],
    written: [homePath],
  };
}

export function loadFtpsSettings(db: JsonStore): FtpsSettings {
  const raw = db.snapshot.settings?.[FTPS_SETTINGS_KEY];
  if (!raw) return { ...DEFAULT_FTPS_SETTINGS };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_FTPS_SETTINGS, ...(parsed as FtpsSettings) };
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
    mapPath: join(root, 'virtual_users.map'),
  };
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
      ok: existsSync(settings.certPath) && existsSync(settings.keyPath),
    };
  }
  const domain = settings.sslDomain;
  if (domain) {
    const managed = {
      cert: join(dataDir, 'certs', domain, 'fullchain.pem'),
      key: join(dataDir, 'certs', domain, 'privkey.pem'),
    };
    if (existsSync(managed.cert) && existsSync(managed.key)) {
      return { ...managed, ok: true };
    }
    const le = {
      cert: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      key: `/etc/letsencrypt/live/${domain}/privkey.pem`,
    };
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
  const { cert, key } = resolveCertPaths(input.dataDir, input.settings);
  const s = input.settings;
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
    s.sslEnable ? 'ssl_enable=YES' : 'ssl_enable=NO',
    s.forceSsl && s.sslEnable ? 'force_local_data_ssl=YES' : 'force_local_data_ssl=NO',
    s.forceSsl && s.sslEnable ? 'force_local_logins_ssl=YES' : 'force_local_logins_ssl=NO',
    'ssl_tlsv1=YES',
    'ssl_sslv2=NO',
    'ssl_sslv3=NO',
    'require_ssl_reuse=NO',
    'ssl_ciphers=HIGH',
  ];
  if (s.sslEnable && cert && key) {
    lines.push(`rsa_cert_file=${cert}`, `rsa_private_key_file=${key}`);
  } else if (s.sslEnable) {
    lines.push('# rsa_cert_file= (尚未選擇有效憑證)', '# rsa_private_key_file=');
  }
  return lines.join('\n') + '\n';
}

export function buildPamSnippet(dataDir: string): string {
  const db = ftpsPaths(dataDir).userDb;
  return [
    '# Generated by YSK Server',
    `auth required pam_userdb.so db=${db.replace(/\\.db$/, '')} crypt=crypt`,
    `account required pam_userdb.so db=${db.replace(/\\.db$/, '')}`,
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
      notes.push(`略過無效用戶名`);
      continue;
    }
    const home = String(a.homePath || join(paths.homes, username));
    mkdirSync(home, { recursive: true });
    // Prefer password_hash (crypt); migrate legacy password_plain once
    let passwordHash = String(a.password_hash ?? '').trim();
    const plainLegacy = String(a.password_plain ?? a.password ?? '').trim();
    if (!passwordHash && plainLegacy) {
      passwordHash = hashFtpPassword(plainLegacy);
      if (isCryptPasswordHash(passwordHash) && a.id) {
        try {
          updateResource(input.db, 'ftp_accounts', String(a.id), {
            password_hash: passwordHash,
            password_plain: '',
          });
          notes.push(`帳戶 ${username}：已遷移明文密碼 → crypt 雜湊`);
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
        `帳戶 ${username} 雜湊格式非 crypt（openssl 不可用）— 登入可能失敗`,
      );
      dbLines.push(username, passwordHash);
    } else {
      notes.push(`帳戶 ${username} 無密碼雜湊，無法登入直至重設`);
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
          `帳戶 ${username} 綁專案但無 linuxUser — 暫用全域 guest「${linuxUser}」（請重建 FTP 帳戶）`,
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

  notes.push(`已寫入 ${list.length} 個帳戶設定`);
  return { written, accounts: list, notes };
}

export async function probeFtpsStatus(input: {
  db: JsonStore;
  dataDir: string;
  host: HostExecutor;
}): Promise<FtpsStatus> {
  const settings = loadFtpsSettings(input.db);
  const paths = ftpsPaths(input.dataDir);
  const which = await input.host.runCommand(['bash', '-c', 'command -v vsftpd || true'], {
    timeoutMs: 5_000,
  });
  const installed = which.stdout.trim().length > 0;
  let active = 'unknown';
  if (input.host.pathExists('/bin/systemctl') || input.host.pathExists('/usr/bin/systemctl')) {
    const r = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
      timeoutMs: 5_000,
    });
    active = (r.stdout || r.stderr || `exit_${r.exitCode}`).trim().split('\n')[0] ?? 'unknown';
  } else {
    active = installed ? 'unknown' : 'not_installed';
  }
  const meta = input.db.snapshot.settings?.['ftps_last_applied_at'];
  return {
    installed,
    active,
    confManaged: paths.conf,
    confSystemExists: existsSync('/etc/vsftpd.conf'),
    accountCount: listResources(input.db, 'ftp_accounts').length,
    settings,
    lastAppliedAt: typeof meta === 'string' ? meta : undefined,
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

  // 1. conf
  const conf = buildVsftpdConf({ dataDir: input.dataDir, settings });
  writeFileSync(paths.conf, conf, 'utf8');
  written.push(paths.conf);
  steps.push({ name: '寫入 vsftpd 設定', status: 'ok', detail: paths.conf });

  // 2. accounts
  const acc = writeManagedFtpAccounts({ db: input.db, dataDir: input.dataDir });
  written.push(...acc.written);
  notes.push(...acc.notes);
  steps.push({ name: '同步帳戶', status: 'ok', detail: `${acc.accounts.length} 個帳戶` });

  const wantSystem = input.applySystem !== false;
  const can =
    wantSystem && input.host.executeEnabled() && input.host.isRoot();
  let blockReason: BlockReason | undefined;
  let blockMessage: string | undefined;

  if (wantSystem && !can) {
    blockReason = !input.host.executeEnabled() ? 'no_execute' : 'no_root';
    blockMessage = panelBlockMessage(blockReason);
    notes.push(blockMessage);
    steps.push({ name: '套用到系統', status: 'blocked', detail: blockMessage });
    // mark accounts pending
    for (const a of listResources(input.db, 'ftp_accounts')) {
      updateResource(input.db, 'ftp_accounts', String(a.id), {
        apply_status: 'pending_execute',
        homePath:
          a.homePath ||
          join(paths.homes, String(a.username)),
      });
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
      status: await probeFtpsStatus(input),
    };
  }

  if (can) {
    // ensure guest user exists
    const gu = settings.guestUsername;
    const idr = await input.host.runCommand(
      ['bash', '-c', `id -u ${gu} >/dev/null 2>&1 || useradd -r -d ${paths.homes} -s /usr/sbin/nologin ${gu}`],
      { timeoutMs: 30_000 },
    );
    commandResults.push({
      argv: ['useradd', gu],
      exitCode: idr.exitCode,
      stderr: idr.stderr,
    });
    steps.push({
      name: '確保 guest 用戶',
      status: idr.exitCode === 0 ? 'ok' : 'failed',
      detail: idr.exitCode === 0 ? gu : idr.stderr || '失敗',
    });

    // install packages
    const inst = await input.host.runCommand(
      [
        'bash',
        '-c',
        'export DEBIAN_FRONTEND=noninteractive; command -v vsftpd >/dev/null || apt-get update && apt-get install -y vsftpd db-util libpam-modules',
      ],
      { timeoutMs: 300_000 },
    );
    commandResults.push({
      argv: ['apt-get', 'install', 'vsftpd'],
      exitCode: inst.exitCode,
      stderr: inst.stderr,
    });
    steps.push({
      name: '安裝 vsftpd',
      status: inst.exitCode === 0 ? 'ok' : 'failed',
      detail: inst.exitCode === 0 ? '就緒' : inst.stderr || '安裝失敗',
    });

    // build userdb if db_load available
    const dbLoad = await input.host.runCommand(
      [
        'bash',
        '-c',
        `command -v db_load >/dev/null && db_load -T -t hash -f ${JSON.stringify(paths.userDbTxt)} ${JSON.stringify(paths.userDb)} || true`,
      ],
      { timeoutMs: 30_000 },
    );
    commandResults.push({
      argv: ['db_load'],
      exitCode: dbLoad.exitCode,
      stderr: dbLoad.stderr,
    });
    if (existsSync(paths.userDb)) {
      try {
        chmodSync(paths.userDb, 0o600);
      } catch {
        /* ignore */
      }
      steps.push({ name: '建立帳戶資料庫', status: 'ok' });
    } else {
      steps.push({
        name: '建立帳戶資料庫',
        status: 'failed',
        detail: '無法建立 virtual user 資料庫（缺 db_load）',
      });
      notes.push('無法建立帳戶資料庫，登入可能失敗');
    }

    // copy conf + pam
    const cpConf = await input.host.runCommand(['cp', paths.conf, '/etc/vsftpd.conf'], {
      timeoutMs: 10_000,
    });
    commandResults.push({
      argv: ['cp', 'vsftpd.conf'],
      exitCode: cpConf.exitCode,
      stderr: cpConf.stderr,
    });
    steps.push({
      name: '安裝系統設定',
      status: cpConf.exitCode === 0 ? 'ok' : 'failed',
      detail: cpConf.exitCode === 0 ? '/etc/vsftpd.conf' : cpConf.stderr,
    });

    mkdirSync('/etc/pam.d', { recursive: true });
    const cpPam = await input.host.runCommand(['cp', paths.pam, '/etc/pam.d/ysk-vsftpd'], {
      timeoutMs: 10_000,
    });
    commandResults.push({
      argv: ['cp', 'pam'],
      exitCode: cpPam.exitCode,
      stderr: cpPam.stderr,
    });
    steps.push({
      name: '安裝 PAM',
      status: cpPam.exitCode === 0 ? 'ok' : 'failed',
    });

    // Ownership: project-bound jails → project linuxUser; FTPS-only homes → guest
    const chownNotes = await chownFtpAccountHomes(input.host, input.db, settings.guestUsername);
    notes.push(...chownNotes);
    steps.push({
      name: '對齊 jail 擁有權',
      status: 'ok',
      detail: chownNotes.slice(0, 3).join('；') || '完成',
    });

    const en = await input.host.runCommand(['systemctl', 'enable', '--now', 'vsftpd'], {
      timeoutMs: 60_000,
    });
    commandResults.push({
      argv: ['systemctl', 'enable', '--now', 'vsftpd'],
      exitCode: en.exitCode,
      stderr: en.stderr,
    });
    const rel = await input.host.runCommand(['systemctl', 'restart', 'vsftpd'], {
      timeoutMs: 30_000,
    });
    commandResults.push({
      argv: ['systemctl', 'restart', 'vsftpd'],
      exitCode: rel.exitCode,
      stderr: rel.stderr,
    });
    const act = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
      timeoutMs: 5_000,
    });
    const active = (act.stdout || '').trim();
    const svcOk = active === 'active';
    steps.push({
      name: '啟動 vsftpd',
      status: svcOk ? 'ok' : 'failed',
      detail: active || en.stderr || rel.stderr,
    });

    const ok = svcOk && cpConf.exitCode === 0;
    if (ok) {
      notes.push('vsftpd 已啟動');
      input.db.snapshot.settings['ftps_last_applied_at'] = new Date().toISOString();
      input.db.persist();
      for (const a of listResources(input.db, 'ftp_accounts')) {
        updateResource(input.db, 'ftp_accounts', String(a.id), {
          apply_status: 'applied',
          homePath: a.homePath || join(paths.homes, String(a.username)),
        });
      }
    } else {
      notes.push('vsftpd 未能成功啟動');
      for (const a of listResources(input.db, 'ftp_accounts')) {
        updateResource(input.db, 'ftp_accounts', String(a.id), {
          apply_status: 'failed',
        });
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
      status: await probeFtpsStatus(input),
    };
  }

  // applySystem false: config only
  notes.push('已儲存管理設定（未套用到系統服務）');
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
    status: await probeFtpsStatus(input),
  };
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
  if (!acc) return { ok: false, notes: ['找不到帳戶'] };

  const paths = ftpsPaths(input.dataDir);
  const home = String(acc.homePath || join(paths.homes, String(acc.username)));
  mkdirSync(home, { recursive: true });
  updateResource(input.db, 'ftp_accounts', input.id, { homePath: home });

  // Always rewrite managed files for all accounts
  const managed = writeManagedFtpAccounts({ db: input.db, dataDir: input.dataDir });
  const notes = [...managed.notes];
  const steps: FtpsStep[] = [
    { name: '寫入帳戶檔', status: 'ok', detail: home },
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
      homePath: home,
    });
    const blockMessage = panelBlockMessage(
      !input.host.executeEnabled() ? 'no_execute' : 'no_root',
    );
    notes.push(blockMessage);
    notes.push('帳戶已登記於管理面；需系統權限才能讓 FTP 服務生效');
    steps.push({ name: '套用到 vsftpd', status: 'blocked', detail: blockMessage });
    return {
      ok: false,
      notes,
      blocked: true,
      blockMessage,
      executed: false,
      steps,
    };
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
      `command -v db_load >/dev/null && db_load -T -t hash -f ${JSON.stringify(paths.userDbTxt)} ${JSON.stringify(paths.userDb)} || true`,
    ],
    { timeoutMs: 30_000 },
  );
  await input.host.runCommand(['cp', paths.conf, '/etc/vsftpd.conf'], { timeoutMs: 10_000 });
  await input.host.runCommand(['cp', paths.pam, '/etc/pam.d/ysk-vsftpd'], { timeoutMs: 10_000 });
  const rel = await input.host.runCommand(['systemctl', 'reload', 'vsftpd'], {
    timeoutMs: 30_000,
  });
  if (rel.exitCode !== 0) {
    await input.host.runCommand(['systemctl', 'restart', 'vsftpd'], { timeoutMs: 30_000 });
  }
  const act = await input.host.runCommand(['systemctl', 'is-active', 'vsftpd'], {
    timeoutMs: 5_000,
  });
  const active = (act.stdout || '').trim();
  if (active === 'active') {
    updateResource(input.db, 'ftp_accounts', input.id, {
      apply_status: 'applied',
      homePath: home,
    });
    notes.push(`帳戶 ${acc.username} 已套用，vsftpd 運行中`);
    steps.push({ name: '重載 vsftpd', status: 'ok', detail: active });
    return { ok: true, notes, executed: true, steps };
  }

  // try full install path
  const full = await applyFtpsService({
    db: input.db,
    dataDir: input.dataDir,
    host: input.host,
    applySystem: true,
  });
  return {
    ok: full.ok,
    notes: full.notes,
    blocked: full.blocked,
    blockMessage: full.blockMessage,
    executed: full.executed,
    steps: full.steps as FtpsStep[],
  };
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
      notes.push(`略過 chown ${home}：系統用戶「${user}」不存在（請先建立專案系統用戶）`);
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
      notes.push(`chown 失敗 ${home}：${(r.stderr || r.stdout).slice(0, 120)}`);
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
  const user = input.username?.trim() || 'user';
  const opts: Array<{ value: string; label: string }> = [
    {
      value: join(paths.homes, user),
      label: `FTP 專用家目錄（${user}）`,
    },
  ];
  const projects = (input.db.snapshot.projects ?? []) as unknown as Array<Record<string, unknown>>;
  for (const p of projects) {
    const name = String(p.name ?? p.id ?? 'project');
    const home = String(p.homeDir ?? p.home_dir ?? '');
    if (home) {
      opts.push({ value: home, label: `專案 ${name} 根目錄` });
      const pub = join(home, 'app', 'public');
      opts.push({ value: pub, label: `專案 ${name} public` });
    }
  }
  return opts;
}

/** Domain options for panel select */
export function listFtpDomainOptions(db: JsonStore): Array<{ value: string; label: string }> {
  const set = new Map<string, string>();
  for (const d of db.snapshot.email_domains ?? []) {
    const domain = String((d as Record<string, unknown>).domain ?? '').toLowerCase();
    if (domain) set.set(domain, `郵件 ${domain}`);
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
    if (domain) set.set(domain, `專案 ${domain}`);
  }
  return [...set.entries()].map(([value, label]) => ({ value, label }));
}

