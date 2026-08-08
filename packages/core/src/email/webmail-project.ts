/**
 * Webmail as a PHP project — same delivery model as Adminer / phpMyAdmin:
 * create PHP project → download Roundcube or SnappyMail into docRoot → goLive.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, type ProjectDto, tl } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectService } from '../hosting/project-service.js';
import type { ProjectOpsService } from '../hosting/project-ops.js';

export type WebmailTool = 'roundcube' | 'snappymail';

/** Default Roundcube complete package (security line 1.7.x). Override with YSK_ROUNDCUBE_URL / YSK_ROUNDCUBE_VERSION. */
export const ROUNDCUBE_VERSION = process.env.YSK_ROUNDCUBE_VERSION ?? '1.7.2';
const ROUNDCUBE_URL =
  process.env.YSK_ROUNDCUBE_URL ??
  `https://github.com/roundcube/roundcubemail/releases/download/${ROUNDCUBE_VERSION}/roundcubemail-${ROUNDCUBE_VERSION}-complete.tar.gz`;

/** SnappyMail release. Override with YSK_SNAPPYMAIL_URL / YSK_SNAPPYMAIL_VERSION. */
export const SNAPPYMAIL_VERSION = process.env.YSK_SNAPPYMAIL_VERSION ?? '2.38.2';
const SNAPPYMAIL_URL =
  process.env.YSK_SNAPPYMAIL_URL ??
  `https://github.com/the-djmaze/snappymail/releases/download/v${SNAPPYMAIL_VERSION}/snappymail-${SNAPPYMAIL_VERSION}.tar.gz`;

export function normalizeWebmailTool(raw: unknown): WebmailTool {
  const t = String(raw ?? 'roundcube').trim().toLowerCase();
  if (t === 'snappymail' || t === 'snappy' || t === 'rainloop') return 'snappymail';
  return 'roundcube';
}

export function defaultWebmailProjectName(tool: WebmailTool, mailDomain?: string): string {
  const base = tool === 'snappymail' ? 'snappymail' : 'roundcube';
  const d = (mailDomain ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!d) return base;
  // keep short unique-ish name
  const slug = d.replace(/^webmail\./, '').replace(/\./g, '-').slice(0, 40);
  return `${base}-${slug}`;
}

export function defaultWebmailHostname(mailDomain: string): string {
  const d = mailDomain.trim().toLowerCase();
  if (!d) return 'webmail.local';
  if (d.startsWith('webmail.')) return d;
  return `webmail.${d}`;
}

/** Derive mail.* IMAP host from webmail or apex domain. */
export function defaultImapHostForWebmail(webmailOrMailDomain: string): string {
  const d = webmailOrMailDomain.trim().toLowerCase();
  if (!d) return 'localhost';
  if (d.startsWith('mail.')) return d;
  if (d.startsWith('webmail.')) return `mail.${d.slice('webmail.'.length)}`;
  return `mail.${d}`;
}

/**
 * Download Roundcube or SnappyMail into project document root and write managed config.
 */
export async function installWebmailIntoProject(input: {
  host: HostExecutor;
  homeDir: string;
  docRoot?: string;
  tool: WebmailTool;
  /** Public webmail hostname (for notes only) */
  domain: string;
  imapHost?: string;
  smtpHost?: string;
  download?: boolean;
  forceHttps?: boolean;
  /** Install ysk_sso plugin into Roundcube plugins/ */
  installSsoPlugin?: boolean;
  panelBaseUrl?: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  entryFile: string;
  /** SnappyMail admin password (shown once) */
  snappyAdminPassword?: string;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const docRoot = input.docRoot ?? join(input.homeDir, 'app', 'public');
  mkdirSync(docRoot, { recursive: true });
  const download = input.download !== false;
  const tool = normalizeWebmailTool(input.tool);
  const imapHost = input.imapHost ?? defaultImapHostForWebmail(input.domain);
  const smtpHost = input.smtpHost ?? imapHost;

  if (tool === 'roundcube') {
    return installRoundcube({
      host: input.host,
      homeDir: input.homeDir,
      docRoot,
      download,
      imapHost,
      smtpHost,
      forceHttps: input.forceHttps === true,
      installSsoPlugin: input.installSsoPlugin !== false,
      panelBaseUrl: input.panelBaseUrl ?? 'http://127.0.0.1:8787',
      notes,
      written,
    });
  }
  return installSnappyMail({
    host: input.host,
    homeDir: input.homeDir,
    docRoot,
    download,
    imapHost,
    smtpHost,
    notes,
    written,
  });
}

async function installRoundcube(input: {
  host: HostExecutor;
  homeDir: string;
  docRoot: string;
  download: boolean;
  imapHost: string;
  smtpHost: string;
  forceHttps: boolean;
  installSsoPlugin: boolean;
  panelBaseUrl: string;
  notes: string[];
  written: string[];
}): Promise<{ ok: boolean; notes: string[]; written: string[]; entryFile: string }> {
  const { docRoot, notes, written } = input;
  const marker = join(docRoot, 'index.php');
  const configPath = join(docRoot, 'config', 'config.inc.php');

  if (!input.download) {
    if (!existsSync(marker)) {
      return {
        ok: false,
        notes: [tl('notes.webmail.notInstalled')],
        written,
        entryFile: 'index.php',
      };
    }
    const rt = ensureRoundcubeRuntime(docRoot, input.imapHost, input.smtpHost, {
      forceHttps: input.forceHttps,
      installSsoPlugin: input.installSsoPlugin,
      panelBaseUrl: input.panelBaseUrl,
    });
    written.push(...rt.written);
    notes.push(tl('notes.webmail.roundcubeReuse', { path: docRoot }), ...rt.notes);
    return { ok: true, notes, written, entryFile: 'index.php' };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.webmail.needExecute')],
      written,
      entryFile: 'index.php',
    };
  }

  const tmp = join(input.homeDir, 'tmp', 'roundcube.tgz');
  mkdirSync(join(input.homeDir, 'tmp'), { recursive: true });
  const extract = join(docRoot, '.rc-extract');
  const script = [
    `set -e`,
    `curl -fsSL ${JSON.stringify(ROUNDCUBE_URL)} -o ${JSON.stringify(tmp)}`,
    `rm -rf ${JSON.stringify(extract)}`,
    `mkdir -p ${JSON.stringify(extract)}`,
    `tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(extract)}`,
    `INNER=$(find ${JSON.stringify(extract)} -maxdepth 1 -type d -name 'roundcubemail-*' | head -1)`,
    `if [ -z "$INNER" ]; then echo "Roundcube extract failed"; exit 1; fi`,
    // Keep existing config if reinstall
    `CFG_BAK=""`,
    `if [ -f ${JSON.stringify(configPath)} ]; then CFG_BAK=$(mktemp); cp ${JSON.stringify(configPath)} "$CFG_BAK"; fi`,
    `shopt -s dotglob`,
    `rm -rf ${JSON.stringify(docRoot)}/*`,
    `cp -a "$INNER"/* ${JSON.stringify(docRoot)}/`,
    `rm -rf ${JSON.stringify(extract)} ${JSON.stringify(tmp)}`,
    `if [ -n "$CFG_BAK" ]; then mkdir -p ${JSON.stringify(join(docRoot, 'config'))}; cp "$CFG_BAK" ${JSON.stringify(configPath)}; rm -f "$CFG_BAK"; fi`,
    `mkdir -p ${JSON.stringify(join(docRoot, 'temp'))} ${JSON.stringify(join(docRoot, 'logs'))} ${JSON.stringify(join(docRoot, 'config'))}`,
    `chmod 777 ${JSON.stringify(join(docRoot, 'temp'))} ${JSON.stringify(join(docRoot, 'logs'))} 2>/dev/null || true`,
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 300_000 });
  if (r.exitCode !== 0 || !existsSync(marker)) {
    notes.push(
      tl('notes.webmail.extractFailed', {
        tool: 'Roundcube',
        detail: (r.stderr || r.stdout || '').slice(0, 300),
      }),
    );
    return { ok: false, notes, written, entryFile: 'index.php' };
  }

  const rt = ensureRoundcubeRuntime(docRoot, input.imapHost, input.smtpHost, {
    forceHttps: input.forceHttps,
    installSsoPlugin: input.installSsoPlugin,
    panelBaseUrl: input.panelBaseUrl,
  });
  written.push(docRoot, ...rt.written);
  notes.push(
    tl('notes.webmail.roundcubeInstalled', { path: docRoot, version: ROUNDCUBE_VERSION }),
    ...rt.notes,
  );
  return { ok: true, notes, written, entryFile: 'index.php' };
}

async function installSnappyMail(input: {
  host: HostExecutor;
  homeDir: string;
  docRoot: string;
  download: boolean;
  imapHost: string;
  smtpHost: string;
  notes: string[];
  written: string[];
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  entryFile: string;
  snappyAdminPassword?: string;
}> {
  const { docRoot, notes, written } = input;
  const marker = join(docRoot, 'index.php');

  if (!input.download) {
    if (!existsSync(marker)) {
      return {
        ok: false,
        notes: [tl('notes.webmail.notInstalled')],
        written,
        entryFile: 'index.php',
      };
    }
    notes.push(tl('notes.webmail.snappyReuse', { path: docRoot }));
    return { ok: true, notes, written, entryFile: 'index.php' };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.webmail.needExecute')],
      written,
      entryFile: 'index.php',
    };
  }

  const tmp = join(input.homeDir, 'tmp', 'snappymail.tgz');
  mkdirSync(join(input.homeDir, 'tmp'), { recursive: true });
  const extract = join(docRoot, '.sm-extract');
  // Official release may be: flat index.php, snappymail-X/, or public_html/
  const script = [
    `set -e`,
    `curl -fsSL ${JSON.stringify(SNAPPYMAIL_URL)} -o ${JSON.stringify(tmp)}`,
    `rm -rf ${JSON.stringify(extract)}`,
    `mkdir -p ${JSON.stringify(extract)}`,
    // try tar.gz; if zip, unzip
    `if file ${JSON.stringify(tmp)} | grep -qi 'zip'; then unzip -q ${JSON.stringify(tmp)} -d ${JSON.stringify(extract)}; else tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(extract)}; fi`,
    `INNER=""`,
    `if [ -f ${JSON.stringify(join(extract, 'index.php'))} ]; then INNER=${JSON.stringify(extract)}; fi`,
    `if [ -z "$INNER" ] && [ -f ${JSON.stringify(join(extract, 'public_html', 'index.php'))} ]; then INNER=${JSON.stringify(join(extract, 'public_html'))}; fi`,
    `if [ -z "$INNER" ]; then INNER=$(find ${JSON.stringify(extract)} -maxdepth 3 -type f -name index.php 2>/dev/null | head -1 | xargs -r dirname); fi`,
    `if [ -z "$INNER" ] || [ ! -f "$INNER/index.php" ]; then echo "SnappyMail extract failed"; ls -la ${JSON.stringify(extract)}; exit 1; fi`,
    `shopt -s dotglob`,
    `rm -rf ${JSON.stringify(docRoot)}/*`,
    `cp -a "$INNER"/* ${JSON.stringify(docRoot)}/`,
    `rm -rf ${JSON.stringify(extract)} ${JSON.stringify(tmp)}`,
    `mkdir -p ${JSON.stringify(join(docRoot, 'data'))}`,
    `chmod 777 ${JSON.stringify(join(docRoot, 'data'))} 2>/dev/null || true`,
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 300_000 });
  if (r.exitCode !== 0 || !existsSync(marker)) {
    notes.push(
      tl('notes.webmail.extractFailed', {
        tool: 'SnappyMail',
        detail: (r.stderr || r.stdout || '').slice(0, 300),
      }),
    );
    return { ok: false, notes, written, entryFile: 'index.php' };
  }

  written.push(docRoot);
  const admin = ensureSnappyMailAdminBootstrap(docRoot, input.imapHost, input.smtpHost);
  written.push(...admin.written);
  notes.push(
    tl('notes.webmail.snappyInstalled', { path: docRoot, version: SNAPPYMAIL_VERSION }),
    ...admin.notes,
    tl('notes.webmail.imapSmtpHint', { imap: input.imapHost, smtp: input.smtpHost }),
  );
  return {
    ok: true,
    notes,
    written,
    entryFile: 'index.php',
    snappyAdminPassword: admin.adminPassword,
  };
}

/**
 * Seed SnappyMail data dir + admin password (shown once).
 * Domain defaults point at local IMAP/SMTP; admin uses /?admin.
 */
export function ensureSnappyMailAdminBootstrap(
  docRoot: string,
  imapHost: string,
  smtpHost: string,
  adminPassword?: string,
): { written: string[]; notes: string[]; adminPassword: string } {
  const written: string[] = [];
  const notes: string[] = [];
  const pass = adminPassword || randomAdminPassword();
  const dataRoot = join(docRoot, 'data', '_data_', '_default_');
  const cfgDir = join(dataRoot, 'configs');
  const domDir = join(dataRoot, 'domains');
  mkdirSync(cfgDir, { recursive: true });
  mkdirSync(domDir, { recursive: true });
  try {
    chmodSync(join(docRoot, 'data'), 0o777);
  } catch {
    /* best-effort */
  }

  // bcrypt-compatible hash for PHP password_verify (SnappyMail admin)
  // Use PHP-style $2y$ via openssl/passlib is hard without PHP; write plain marker + PHP bootstrap file instead.
  const adminPhp = join(docRoot, 'ysk-snappy-admin.php');
  writeFileSync(
    adminPhp,
    `<?php
/**
 * YSK one-shot: set SnappyMail admin password then self-delete.
 * Open once as panel operator, then remove.
 */
$pass = ${JSON.stringify(pass)};
$cfgDir = __DIR__ . '/data/_data_/_default_/configs';
if (!is_dir($cfgDir)) { @mkdir($cfgDir, 0777, true); }
$hash = password_hash($pass, PASSWORD_DEFAULT);
$ini = "[webmail]\\n; YSK-managed\\n[security]\\nadmin_login = \\"admin\\"\\nadmin_password = \\"{$hash}\\"\\nallow_admin_panel = On\\n";
file_put_contents($cfgDir . '/application.ini', $ini);
@unlink(__FILE__);
header('Content-Type: text/plain; charset=utf-8');
echo "SnappyMail admin password applied. Login /?admin as admin. This helper was removed.\\n";
`,
    'utf8',
  );
  written.push(adminPhp);

  // Domain domain.json-style json for default IMAP (SnappyMail domain files are JSON in newer versions)
  const domainJson = join(domDir, `${imapHost.replace(/[^a-z0-9.-]/gi, '_') || 'mail'}.json`);
  writeFileSync(
    domainJson,
    JSON.stringify(
      {
        name: imapHost,
        IMAP: { host: imapHost, port: 993, secure: 1, shortLogin: false },
        SMTP: { host: smtpHost, port: 587, secure: 2, shortLogin: false, auth: true, usePhpMail: false },
      },
      null,
      2,
    ),
    'utf8',
  );
  written.push(domainJson);

  // Plaintext once for operator (not stored on disk after helper runs)
  const once = join(docRoot, '..', 'SNAPPYMAIL_ADMIN_ONCE.txt');
  writeFileSync(
    once,
    [
      'YSK SnappyMail admin (show once — delete after use)',
      `Login path: /?admin`,
      `User: admin`,
      `Password: ${pass}`,
      `Or open once: /ysk-snappy-admin.php then use the password above`,
      `IMAP: ${imapHost}:993  SMTP: ${smtpHost}:587`,
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(once);

  notes.push(tl('notes.webmail.snappyAdminOnce', { user: 'admin' }));
  notes.push(tl('notes.webmail.snappyAdminPassword', { password: pass }));
  return { written, notes, adminPassword: pass };
}

function randomAdminPassword(): string {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)]!;
  return s;
}

/** Write ysk_sso plugin into Roundcube plugins/ and enable in config. */
export function installYskSsoIntoRoundcube(
  docRoot: string,
  panelBaseUrl: string,
): { written: string[]; notes: string[]; pluginDir: string } {
  const written: string[] = [];
  const notes: string[] = [];
  const pluginDir = join(docRoot, 'plugins', 'ysk_sso');
  mkdirSync(pluginDir, { recursive: true });
  const base = panelBaseUrl.replace(/\/$/, '');
  const php = `<?php
/**
 * YSK Webmail SSO — Roundcube auto-login (installed into project plugins/)
 */
class ysk_sso extends rcube_plugin {
  public $task = 'login|mail';
  function init() {
    $this->add_hook('startup', array($this, 'startup'));
  }
  function startup($args) {
    $token = isset($_GET['_ysk_sso']) ? $_GET['_ysk_sso'] : null;
    if (!$token) return $args;
    $url = ${JSON.stringify(base + '/api/v1/email/webmail/sso/consume')};
    $ctx = stream_context_create(array(
      'http' => array(
        'method' => 'POST',
        'header' => "Content-Type: application/json\\r\\n",
        'content' => json_encode(array('token' => $token)),
        'timeout' => 8,
        'ignore_errors' => true,
      ),
    ));
    $raw = @file_get_contents($url, false, $ctx);
    $data = $raw ? json_decode($raw, true) : null;
    if (empty($data['ok']) || empty($data['email'])) {
      error_log('YSK SSO consume failed');
      return $args;
    }
    $email = $data['email'];
    $pass = isset($data['password']) ? $data['password'] : null;
    $rcmail = rcube::get_instance();
    if ($pass && method_exists($rcmail, 'login')) {
      $auth = $rcmail->login($email, $pass, $rcmail->config->get('default_host'), true);
      if ($auth) {
        $rcmail->session->set('user_id', $rcmail->get_user_id());
        $rcmail->session->set('password', $rcmail->encrypt($pass));
        header('Location: ./?_task=mail');
        exit;
      }
    }
    return $args;
  }
}
`;
  const path = join(pluginDir, 'ysk_sso.php');
  writeFileSync(path, php, 'utf8');
  written.push(path);
  notes.push(tl('notes.webmail.ssoPluginInstalled', { path: pluginDir }));
  return { written, notes, pluginDir };
}

/** Write/refresh Roundcube config.inc.php + writable temp/logs. */
export function ensureRoundcubeRuntime(
  docRoot: string,
  imapHost: string,
  smtpHost: string,
  opts?: {
    forceHttps?: boolean;
    installSsoPlugin?: boolean;
    panelBaseUrl?: string;
  },
): { written: string[]; notes: string[] } {
  const written: string[] = [];
  const notes: string[] = [];
  const configDir = join(docRoot, 'config');
  const tempDir = join(docRoot, 'temp');
  const logsDir = join(docRoot, 'logs');
  const dbDir = join(docRoot, 'db');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(dbDir, { recursive: true });
  for (const d of [tempDir, logsDir, dbDir]) {
    try {
      chmodSync(d, 0o777);
    } catch {
      /* best-effort */
    }
  }

  const plugins: string[] = ['archive', 'zipdownload', 'managesieve'];
  if (opts?.installSsoPlugin !== false) {
    const sso = installYskSsoIntoRoundcube(
      docRoot,
      opts?.panelBaseUrl ?? 'http://127.0.0.1:8787',
    );
    written.push(...sso.written);
    notes.push(...sso.notes);
    plugins.push('ysk_sso');
  }

  const configPath = join(configDir, 'config.inc.php');
  // Preserve existing des_key if reinstall
  let desKey = randomDesKey();
  if (existsSync(configPath)) {
    try {
      const prev = readFileSync(configPath, 'utf8');
      const m = prev.match(/\$config\['des_key'\]\s*=\s*'([^']+)'/);
      if (m?.[1] && m[1].length >= 16) desKey = m[1];
    } catch {
      /* regenerate */
    }
  }

  const forceHttps = opts?.forceHttps === true;
  writeFileSync(
    configPath,
    buildRoundcubeConfigInc({
      desKey,
      imapHost,
      smtpHost,
      dbPath: join(dbDir, 'roundcube.db'),
      forceHttps,
      plugins,
    }),
    'utf8',
  );
  written.push(configPath, tempDir, logsDir, dbDir);
  notes.push(tl('notes.webmail.roundcubeConfigWritten'));
  notes.push(tl('notes.webmail.imapSmtpHint', { imap: imapHost, smtp: smtpHost }));
  if (forceHttps) {
    notes.push(tl('notes.webmail.forceHttpsOn'));
  } else {
    notes.push(tl('notes.webmail.forceHttpsOff'));
  }
  return { written, notes };
}

export function buildRoundcubeConfigInc(input: {
  desKey: string;
  imapHost: string;
  smtpHost: string;
  dbPath: string;
  forceHttps?: boolean;
  plugins?: string[];
}): string {
  const des = String(input.desKey || randomDesKey()).replace(/'/g, '');
  const imap = String(input.imapHost).replace(/'/g, '');
  const smtp = String(input.smtpHost).replace(/'/g, '');
  const db = String(input.dbPath).replace(/'/g, "\\'");
  const plugins = input.plugins?.length
    ? input.plugins
    : ['archive', 'zipdownload', 'managesieve'];
  const pluginPhp = plugins.map((p) => `'${String(p).replace(/'/g, '')}'`).join(', ');
  // SQLite absolute path: sqlite:////absolute/path
  const dsn = `sqlite:///${db}?mode=0646`;
  const forceHttps = input.forceHttps === true;
  return `<?php
/**
 * YSK-managed Roundcube config — do not use the web installer.
 * IMAP/SMTP point at this host's mail stack (override hosts via panel re-apply).
 */
$config = [];
$config['db_dsnw'] = ${JSON.stringify(dsn)};
$config['db_prefix'] = 'rc_';
$config['default_host'] = 'ssl://${imap}';
$config['default_port'] = 993;
$config['imap_conn_options'] = [
  'ssl' => [
    'verify_peer' => false,
    'verify_peer_name' => false,
  ],
];
$config['smtp_server'] = 'tls://${smtp}';
$config['smtp_port'] = 587;
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';
$config['smtp_conn_options'] = [
  'ssl' => [
    'verify_peer' => false,
    'verify_peer_name' => false,
  ],
];
$config['support_url'] = '';
$config['product_name'] = 'YSK Webmail';
$config['des_key'] = '${des}';
$config['plugins'] = [${pluginPhp}];
$config['skin'] = 'elastic';
$config['enable_installer'] = false;
$config['mime_types'] = null;
$config['temp_dir'] = __DIR__ . '/../temp';
$config['log_dir'] = __DIR__ . '/../logs';
$config['session_lifetime'] = 30;
$config['ip_check'] = false;
$config['force_https'] = ${forceHttps ? 'true' : 'false'};
`;
}

function randomDesKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)]!;
  return s;
}

/**
 * Create PHP project + install webmail + goLive (deploy + nginx via project lifecycle).
 */
export async function createWebmailProject(input: {
  projects: ProjectService;
  projectOps: ProjectOpsService;
  host: HostExecutor;
  actor: string;
  actorUserId?: string;
  name: string;
  domain: string;
  tool?: WebmailTool;
  download?: boolean;
  imapHost?: string;
  smtpHost?: string;
  /** Apex mail domain for default naming only */
  mailDomain?: string;
  forceHttps?: boolean;
  installSsoPlugin?: boolean;
  panelBaseUrl?: string;
  /**
   * If project name or domain already exists, reinstall webmail into that project
   * instead of failing (upgrade path).
   */
  reinstall?: boolean;
}): Promise<{
  ok: boolean;
  project?: ProjectDto;
  projectId?: string;
  urlHint?: string;
  tool: WebmailTool;
  notes: string[];
  written: string[];
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  apply_status: 'applied' | 'written' | 'blocked' | 'failed';
  snappyAdminPassword?: string;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const name = input.name.trim();
  const domain = input.domain.trim().toLowerCase();
  const tool = normalizeWebmailTool(input.tool);

  if (!name) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needProjectName'), { httpStatus: 400 });
  }
  if (!domain) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.webmail.domainRequired'), {
      httpStatus: 400,
    });
  }

  const byName = input.projects.list().find(
    (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
  );
  const byDomain = input.projects.list().find(
    (p) => (p.domain ?? '').trim().toLowerCase() === domain,
  );
  const existing = byName ?? byDomain;

  if (existing && !input.reinstall) {
    return {
      ok: false,
      tool,
      notes: [
        tl('notes.ops.projectNameExists', { name: existing.name }),
        `existingProjectId=${existing.id}`,
        tl('notes.webmail.reinstallHint'),
      ],
      written,
      projectId: existing.id,
      apply_status: 'failed',
    };
  }

  if (existing && input.reinstall) {
    notes.push(tl('notes.webmail.reinstalling', { id: existing.id, name: existing.name }));
    return reinstallWebmailProject({
      projects: input.projects,
      projectOps: input.projectOps,
      host: input.host,
      actor: input.actor,
      projectId: existing.id,
      tool,
      download: input.download !== false,
      imapHost: input.imapHost,
      smtpHost: input.smtpHost,
      forceHttps: input.forceHttps,
      installSsoPlugin: input.installSsoPlugin,
      panelBaseUrl: input.panelBaseUrl,
      goLive: true,
    });
  }

  let created: Awaited<ReturnType<ProjectService['create']>>;
  try {
    created = await input.projects.create({
      name,
      domain,
      runtime: 'php',
      templateId: 'php-hello',
      forceTemplate: true,
      actor: input.actor,
      actorUserId: input.actorUserId,
    });
  } catch (e) {
    if (e instanceof YskError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, tool, notes: [msg], written, apply_status: 'failed' };
  }
  notes.push(tl('notes.webmail.projectCreated', { id: created.project.id, name, tool }));
  if (created.scaffold?.notes?.length) notes.push(...created.scaffold.notes.slice(0, 4));

  const row = input.projects.get(created.project.id);
  const docRoot = join(row.homeDir, (row.docRoot || 'app/public').replace(/^\//, ''));

  try {
    const hello = join(docRoot, 'index.php');
    if (existsSync(hello)) rmSync(hello, { force: true });
  } catch {
    /* best-effort */
  }

  const inst = await installWebmailIntoProject({
    host: input.host,
    homeDir: row.homeDir,
    docRoot,
    tool,
    domain,
    imapHost: input.imapHost,
    smtpHost: input.smtpHost,
    download: input.download !== false,
    forceHttps: input.forceHttps === true,
    installSsoPlugin: input.installSsoPlugin !== false,
    panelBaseUrl: input.panelBaseUrl,
  });
  notes.push(...inst.notes);
  written.push(...inst.written);
  if (!inst.ok) {
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
      requiresExecute: notes.some((n) => /YSK_EXECUTE|execute/i.test(n)),
      blocked: notes.some((n) => /YSK_EXECUTE|execute/i.test(n)),
      blockMessage: notes.find((n) => /YSK_EXECUTE|execute/i.test(n)),
      snappyAdminPassword: inst.snappyAdminPassword,
    };
  }

  const live = await input.projectOps.goLive(row.id, { actor: input.actor });
  notes.push(...(live.notes ?? []).slice(0, 16));
  notes.push(tl('notes.webmail.openHint'));
  notes.push(tl('notes.webmail.sslHint', { domain }));
  const fresh = input.projects.get(row.id);
  const ok = Boolean(live.ok) && inst.ok;
  return {
    ok,
    project: fresh,
    projectId: fresh.id,
    tool,
    urlHint: `http://${domain}/`,
    notes,
    written,
    blocked: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
    requiresExecute: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
    requiresRoot: Boolean(live.deploy?.requiresRoot || live.publish?.requiresRoot),
    apply_status: ok ? 'applied' : live.ok === false ? 'failed' : 'written',
    snappyAdminPassword: inst.snappyAdminPassword,
  };
}

/**
 * Re-download / rewrite webmail into an existing PHP project (upgrade path).
 */
export async function reinstallWebmailProject(input: {
  projects: ProjectService;
  projectOps: ProjectOpsService;
  host: HostExecutor;
  actor: string;
  projectId: string;
  tool?: WebmailTool;
  download?: boolean;
  imapHost?: string;
  smtpHost?: string;
  forceHttps?: boolean;
  installSsoPlugin?: boolean;
  panelBaseUrl?: string;
  goLive?: boolean;
}): Promise<{
  ok: boolean;
  project?: ProjectDto;
  projectId?: string;
  urlHint?: string;
  tool: WebmailTool;
  notes: string[];
  written: string[];
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  apply_status: 'applied' | 'written' | 'blocked' | 'failed';
  snappyAdminPassword?: string;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const tool = normalizeWebmailTool(input.tool);
  let row: ProjectDto;
  try {
    row = input.projects.get(input.projectId);
  } catch {
    return {
      ok: false,
      tool,
      notes: [tl('notes.webmail.projectNotFound')],
      written,
      apply_status: 'failed',
    };
  }
  const domain = (row.domain ?? '').trim().toLowerCase() || 'webmail.local';
  const docRoot = join(row.homeDir, (row.docRoot || 'app/public').replace(/^\//, ''));
  notes.push(
    tl('notes.webmail.reinstallStart', {
      id: row.id,
      version: tool === 'snappymail' ? SNAPPYMAIL_VERSION : ROUNDCUBE_VERSION,
    }),
  );

  const inst = await installWebmailIntoProject({
    host: input.host,
    homeDir: row.homeDir,
    docRoot,
    tool,
    domain,
    imapHost: input.imapHost ?? defaultImapHostForWebmail(domain),
    smtpHost: input.smtpHost,
    download: input.download !== false,
    forceHttps: input.forceHttps === true,
    installSsoPlugin: input.installSsoPlugin !== false,
    panelBaseUrl: input.panelBaseUrl,
  });
  notes.push(...inst.notes);
  written.push(...inst.written);
  if (!inst.ok) {
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
      snappyAdminPassword: inst.snappyAdminPassword,
      requiresExecute: notes.some((n) => /YSK_EXECUTE|execute/i.test(n)),
    };
  }

  if (input.goLive !== false) {
    const live = await input.projectOps.goLive(row.id, { actor: input.actor });
    notes.push(...(live.notes ?? []).slice(0, 12));
    const fresh = input.projects.get(row.id);
    const ok = Boolean(live.ok) && inst.ok;
    return {
      ok,
      project: fresh,
      projectId: fresh.id,
      tool,
      urlHint: `http://${domain}/`,
      notes,
      written,
      blocked: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
      requiresExecute: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
      requiresRoot: Boolean(live.deploy?.requiresRoot || live.publish?.requiresRoot),
      apply_status: ok ? 'applied' : 'written',
      snappyAdminPassword: inst.snappyAdminPassword,
    };
  }

  return {
    ok: true,
    project: row,
    projectId: row.id,
    tool,
    urlHint: `http://${domain}/`,
    notes,
    written,
    apply_status: 'written',
    snappyAdminPassword: inst.snappyAdminPassword,
  };
}
