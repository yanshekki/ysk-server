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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ErrorCodes, YskError, type ProjectDto, tl } from '@yanshekki/shared';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectService } from '../hosting/project-service.js';
import type { ProjectOpsService } from '../hosting/project-ops.js';
import { chownProjectHome } from '../hosting/project-user-run.js';
import type { ProjectRow } from '../repositories/project-repo.js';

/** Best-effort ownership after webmail tree install (root extract → project user). */
async function ensureWebmailTreeOwnership(
  host: HostExecutor,
  project: ProjectDto,
  notes: string[],
): Promise<void> {
  const row = {
    id: project.id,
    home_dir: project.homeDir,
    linux_user: project.linuxUser,
    linux_group: project.linuxGroup || project.linuxUser,
    os_provisioned: project.osProvisioned === true,
  } as ProjectRow;
  await chownProjectHome(host, row, notes);
}

/**
 * Ensure Dovecot virtual passdb is installed so webmail IMAP login works with
 * panel mailbox passwords (not system PAM). Runs on every webmail create/reinstall.
 */
async function ensureMailAuthForWebmailLogin(
  host: HostExecutor,
  notes: string[],
  written: string[],
): Promise<void> {
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.email.dovecotPassdbWrittenNeedApply'));
    return;
  }
  try {
    const { applyDovecotPassdbToSystem } = await import('./dovecot-passdb.js');
    const { openDatabase } = await import('../db/database.js');
    const dataDir =
      process.env.YSK_DATA_DIR?.trim() ||
      (host.pathExists('/var/lib/ysk-server') ? '/var/lib/ysk-server' : '');
    if (!dataDir) {
      notes.push(tl('notes.email.dovecotNoPassdbSnippets'));
      return;
    }
    let db: import('../db/database.js').YskDatabase | undefined;
    try {
      db = openDatabase(join(dataDir, 'ysk.json'));
    } catch {
      db = undefined;
    }
    const ap = await applyDovecotPassdbToSystem({
      dataDir,
      host,
      db,
      rewritePassdbs: Boolean(db),
    });
    written.push(...ap.written);
    notes.push(...ap.notes.slice(0, 6));
  } catch (e) {
    notes.push(
      tl('notes.email.dovecotApplyFailed', {
        detail: e instanceof Error ? e.message : String(e),
      }),
    );
  }
}
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

/** Shared panel webmail project (one instance for all mail domains). */
export const GLOBAL_WEBMAIL_PROJECT_NAME = 'ysk-webmail';

export function defaultWebmailProjectName(tool: WebmailTool, mailDomain?: string): string {
  // Global shared install: stable name so retries reinstall instead of spawning many projects
  const d = (mailDomain ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!d) return GLOBAL_WEBMAIL_PROJECT_NAME;
  const base = tool === 'snappymail' ? 'snappymail' : 'roundcube';
  // keep short unique-ish name (legacy per-domain); prefer GLOBAL for panel UI
  const slug = d.replace(/^webmail\./, '').replace(/\./g, '-').slice(0, 40);
  return `${base}-${slug}`;
}

/**
 * Roundcube 1.6+ ships package-root index.php as a stub that tells operators to
 * point HTTP at public_html/. The real entry is public_html/index.php with
 * program/config as siblings of public_html (INSTALL_PATH = parent).
 */
export function resolveRoundcubePackageRoot(webOrPackageRoot: string): string {
  try {
    const parent = join(webOrPackageRoot, '..');
    if (
      existsSync(join(webOrPackageRoot, 'index.php')) &&
      existsSync(join(parent, 'program', 'include', 'iniset.php'))
    ) {
      return parent;
    }
  } catch {
    /* */
  }
  return webOrPackageRoot;
}

/** Prefer public_html web root when package root still has the stub index. */
export function resolveRoundcubeWebRoot(packageRoot: string): string {
  const ph = join(packageRoot, 'public_html');
  // Only use public_html when it is a real Roundcube tree — never php-hello
  if (isRoundcubeDocRoot(ph)) {
    return ph;
  }
  if (isRoundcubeDocRoot(packageRoot)) {
    return packageRoot;
  }
  // Prefer public_html when package root is the RC stub that points at it
  if (
    isWebmailPublicHtmlStub(packageRoot) &&
    existsSync(join(ph, 'index.php')) &&
    !/YSK PHP OK/i.test(readFileSync(join(ph, 'index.php'), 'utf8'))
  ) {
    return ph;
  }
  return packageRoot;
}

/** True when path is a usable Roundcube HTTP docroot (not php-hello, not package stub). */
export function isRoundcubeDocRoot(docRoot: string): boolean {
  try {
    if (!existsSync(join(docRoot, 'index.php'))) return false;
    const idx = readFileSync(join(docRoot, 'index.php'), 'utf8');
    // Hard reject scaffolds / stubs before any parent-program heuristic
    if (/YSK PHP OK/i.test(idx)) return false;
    if (isWebmailPublicHtmlStub(docRoot)) return false;
    if (/point to the\s*[\/"']?public_html/i.test(idx)) return false;
    // Classic layout: program next to index.php
    if (existsSync(join(docRoot, 'program', 'include', 'iniset.php'))) return true;
    if (existsSync(join(docRoot, 'program', 'lib'))) return true;
    // 1.6+ public_html layout: program lives one level up — index must still be Roundcube
    if (
      existsSync(join(docRoot, '..', 'program', 'include', 'iniset.php')) ||
      existsSync(join(docRoot, '..', 'program', 'lib'))
    ) {
      // Real public_html index references INSTALL_PATH / Roundcube bootstrap
      if (
        /INSTALL_PATH|ROUNDCUBE|roundcube|iniset\.php|rcmail/i.test(idx) &&
        !/YSK PHP OK/i.test(idx)
      ) {
        return true;
      }
      return false;
    }
    if (/ROUNDCUBE|roundcube/i.test(idx)) return true;
  } catch {
    /* */
  }
  return false;
}

/**
 * True when SnappyMail markers present.
 * Rejects the package-root stub that only says "point HTTP to /public_html"
 * (that stub is NOT a working webmail — docRoot must be the public_html tree).
 */
export function isSnappyMailDocRoot(docRoot: string): boolean {
  try {
    if (!existsSync(join(docRoot, 'index.php'))) return false;
    const idx = readFileSync(join(docRoot, 'index.php'), 'utf8');
    if (/YSK PHP OK/i.test(idx)) return false;
    // RainLoop / SnappyMail outer wrapper — wrong document root
    if (
      /configure your HTTP server to point to the\s*[\/"']?public_html/i.test(idx) ||
      (/public_html/i.test(idx) && /fallback to\s*[\/"']?public_html/i.test(idx))
    ) {
      return false;
    }
    if (existsSync(join(docRoot, 'snappymail')) || existsSync(join(docRoot, '_include.php'))) {
      return true;
    }
    if (/snappymail|rainloop/i.test(idx)) return true;
  } catch {
    /* */
  }
  return false;
}

/** True when docRoot is the unusable package-root stub (not public_html). */
export function isWebmailPublicHtmlStub(docRoot: string): boolean {
  try {
    const idx = join(docRoot, 'index.php');
    if (!existsSync(idx)) return false;
    const body = readFileSync(idx, 'utf8');
    return /configure your HTTP server to point to the\s*[\/"']?public_html/i.test(body);
  } catch {
    return false;
  }
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
  // webmail.example.com / webmail2.example.com → mail.example.com
  const stripped = stripWebmailHostnamePrefix(d);
  if (stripped) return `mail.${stripped}`;
  return `mail.${d}`;
}

/** webmail.example.com / webmail2.foo.bar → example.com / foo.bar */
export function stripWebmailHostnamePrefix(host: string): string | undefined {
  const d = host.trim().toLowerCase();
  const m = d.match(/^webmail\d*\.(.+)$/i);
  return m?.[1] || undefined;
}

/** Resolve apex mail domain + IMAP/SMTP for a webmail install. */
export function resolveWebmailMailEndpoints(input: {
  webmailDomain: string;
  mailDomain?: string;
  imapHost?: string;
  smtpHost?: string;
}): { mailDomain?: string; imapHost: string; smtpHost: string } {
  const web = (input.webmailDomain || '').trim().toLowerCase();
  const mailDomain =
    (input.mailDomain || '').trim().toLowerCase() ||
    stripWebmailHostnamePrefix(web) ||
    undefined;
  const imapHost =
    (input.imapHost || '').trim().toLowerCase() ||
    defaultImapHostForWebmail(mailDomain || web || 'localhost');
  const smtpHost = (input.smtpHost || '').trim().toLowerCase() || imapHost;
  return { mailDomain, imapHost, smtpHost };
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
  /** Apex mailbox domain for SnappyMail domain JSON (user@domain login). */
  mailDomain?: string;
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
  /**
   * Absolute HTTP document root after install (may be …/public_html for Roundcube 1.6+).
   * Callers should persist relative path on the project row before goLive.
   */
  webDocRoot?: string;
  /** Relative to homeDir, e.g. app/public/public_html */
  webDocRootRel?: string;
}> {
  const notes: string[] = [];
  const written: string[] = [];
  // Package root (Roundcube tree). HTTP may use public_html underneath.
  const packageRoot = input.docRoot ?? join(input.homeDir, 'app', 'public');
  mkdirSync(packageRoot, { recursive: true });
  const download = input.download !== false;
  const tool = normalizeWebmailTool(input.tool);
  const endpoints = resolveWebmailMailEndpoints({
    webmailDomain: input.domain,
    mailDomain: input.mailDomain,
    imapHost: input.imapHost,
    smtpHost: input.smtpHost,
  });
  const imapHost = endpoints.imapHost;
  const smtpHost = endpoints.smtpHost;
  const mailDomain = endpoints.mailDomain;

  if (tool === 'roundcube') {
    return installRoundcube({
      host: input.host,
      homeDir: input.homeDir,
      packageRoot,
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
    docRoot: packageRoot,
    download,
    imapHost,
    smtpHost,
    mailDomain,
    notes,
    written,
  });
}

async function installRoundcube(input: {
  host: HostExecutor;
  homeDir: string;
  /** Absolute path where the full Roundcube package tree lives (app/public). */
  packageRoot: string;
  download: boolean;
  imapHost: string;
  smtpHost: string;
  forceHttps: boolean;
  installSsoPlugin: boolean;
  panelBaseUrl: string;
  notes: string[];
  written: string[];
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  entryFile: string;
  webDocRoot?: string;
  webDocRootRel?: string;
}> {
  const { packageRoot, notes, written, homeDir } = input;
  const configPath = join(packageRoot, 'config', 'config.inc.php');

  const finishOk = (webRoot: string) => {
    const rel = webRoot.startsWith(homeDir + '/')
      ? webRoot.slice(homeDir.length + 1)
      : webRoot.startsWith(homeDir)
        ? webRoot.slice(homeDir.length).replace(/^\//, '')
        : 'app/public/public_html';
    notes.push(
      webRoot !== packageRoot
        ? tl('notes.webmail.roundcubePublicHtmlDocRoot', { path: rel })
        : tl('notes.webmail.roundcubeReuse', { path: webRoot }),
    );
    return {
      ok: true as const,
      notes,
      written,
      entryFile: 'index.php',
      webDocRoot: webRoot,
      webDocRootRel: rel.replace(/\\/g, '/'),
    };
  };

  if (!input.download) {
    const webRoot = resolveRoundcubeWebRoot(packageRoot);
    if (!isRoundcubeDocRoot(webRoot)) {
      return {
        ok: false,
        notes: [tl('notes.webmail.notInstalled')],
        written,
        entryFile: 'index.php',
      };
    }
    const rt = ensureRoundcubeRuntime(webRoot, input.imapHost, input.smtpHost, {
      forceHttps: input.forceHttps,
      installSsoPlugin: input.installSsoPlugin,
      panelBaseUrl: input.panelBaseUrl,
    });
    written.push(...rt.written);
    notes.push(...rt.notes);
    return finishOk(webRoot);
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.webmail.needExecute')],
      written,
      entryFile: 'index.php',
    };
  }

  // Extract OUTSIDE packageRoot. Never use packageRoot/.rc-extract: with
  // wipe of packageRoot/* the extract tree must live under home/tmp.
  const tmpDir = join(input.homeDir, 'tmp');
  const tmp = join(tmpDir, 'roundcube.tgz');
  const extract = join(tmpDir, 'rc-extract');
  mkdirSync(tmpDir, { recursive: true });
  const script = [
    `set -euo pipefail`,
    `curl -fsSL ${JSON.stringify(ROUNDCUBE_URL)} -o ${JSON.stringify(tmp)}`,
    `rm -rf ${JSON.stringify(extract)}`,
    `mkdir -p ${JSON.stringify(extract)} ${JSON.stringify(packageRoot)}`,
    `tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(extract)}`,
    `INNER=$(find ${JSON.stringify(extract)} -maxdepth 1 -type d -name 'roundcubemail-*' | head -1)`,
    `if [ -z "$INNER" ] || [ ! -d "$INNER" ]; then echo "Roundcube extract failed"; ls -la ${JSON.stringify(extract)}; exit 1; fi`,
    `if [ ! -f "$INNER/index.php" ] && [ ! -f "$INNER/public_html/index.php" ]; then echo "Roundcube tree missing index.php"; ls -la "$INNER"; exit 1; fi`,
    // Keep existing config if reinstall
    `CFG_BAK=""`,
    `if [ -f ${JSON.stringify(configPath)} ]; then CFG_BAK=$(mktemp); cp ${JSON.stringify(configPath)} "$CFG_BAK"; fi`,
    // Wipe only contents of packageRoot (extract lives under home/tmp, not here)
    `find ${JSON.stringify(packageRoot)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
    `cp -a "$INNER"/. ${JSON.stringify(packageRoot)}/`,
    `rm -rf ${JSON.stringify(extract)} ${JSON.stringify(tmp)}`,
    `if [ -n "\${CFG_BAK:-}" ]; then mkdir -p ${JSON.stringify(join(packageRoot, 'config'))}; cp "$CFG_BAK" ${JSON.stringify(configPath)}; rm -f "$CFG_BAK"; fi`,
    `mkdir -p ${JSON.stringify(join(packageRoot, 'temp'))} ${JSON.stringify(join(packageRoot, 'logs'))} ${JSON.stringify(join(packageRoot, 'config'))}`,
    `chmod 777 ${JSON.stringify(join(packageRoot, 'temp'))} ${JSON.stringify(join(packageRoot, 'logs'))} 2>/dev/null || true`,
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 300_000 });
  const webRoot = resolveRoundcubeWebRoot(packageRoot);
  if (r.exitCode !== 0 || !isRoundcubeDocRoot(webRoot)) {
    notes.push(
      tl('notes.webmail.extractFailed', {
        tool: 'Roundcube',
        detail: (r.stderr || r.stdout || '').slice(0, 300),
      }),
    );
    if (existsSync(join(packageRoot, 'index.php')) && isWebmailPublicHtmlStub(packageRoot)) {
      notes.push(tl('notes.webmail.publicHtmlStub'));
    }
    if (existsSync(join(packageRoot, 'index.php')) && !isRoundcubeDocRoot(webRoot)) {
      notes.push(tl('notes.webmail.notRoundcubeTree'));
    }
    return { ok: false, notes, written, entryFile: 'index.php' };
  }

  const rt = ensureRoundcubeRuntime(webRoot, input.imapHost, input.smtpHost, {
    forceHttps: input.forceHttps,
    installSsoPlugin: input.installSsoPlugin,
    panelBaseUrl: input.panelBaseUrl,
  });
  written.push(packageRoot, webRoot, ...rt.written);
  notes.push(
    tl('notes.webmail.roundcubeInstalled', { path: webRoot, version: ROUNDCUBE_VERSION }),
    ...rt.notes,
  );
  // overwrite finishOk first note path — installed msg already pushed
  const rel = webRoot.startsWith(homeDir + '/')
    ? webRoot.slice(homeDir.length + 1)
    : webRoot.startsWith(homeDir)
      ? webRoot.slice(homeDir.length).replace(/^\//, '')
      : 'app/public/public_html';
  if (webRoot !== packageRoot) {
    notes.push(tl('notes.webmail.roundcubePublicHtmlDocRoot', { path: rel.replace(/\\/g, '/') }));
  }
  return {
    ok: true,
    notes,
    written,
    entryFile: 'index.php',
    webDocRoot: webRoot,
    webDocRootRel: rel.replace(/\\/g, '/'),
  };
}

async function installSnappyMail(input: {
  host: HostExecutor;
  homeDir: string;
  docRoot: string;
  download: boolean;
  imapHost: string;
  smtpHost: string;
  mailDomain?: string;
  notes: string[];
  written: string[];
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  entryFile: string;
  snappyAdminPassword?: string;
  webDocRoot?: string;
  webDocRootRel?: string;
}> {
  const { docRoot, notes, written, homeDir } = input;
  const marker = join(docRoot, 'index.php');

  const finishSnappy = (adminPassword?: string) => {
    // Never serve a nested public_html leftover (php-hello / Roundcube) for SnappyMail
    try {
      const ph = join(docRoot, 'public_html');
      if (existsSync(ph)) {
        const phIdx = join(ph, 'index.php');
        const body = existsSync(phIdx) ? readFileSync(phIdx, 'utf8') : '';
        const looksLikeHello = /YSK PHP OK/i.test(body);
        const looksLikeRc =
          existsSync(join(ph, '..', 'program')) ||
          existsSync(join(docRoot, 'program'));
        // Snappy app root is docRoot; nested public_html is only OK if it IS the snappy app
        if (looksLikeHello || (!isSnappyMailDocRoot(ph) && looksLikeRc === false)) {
          if (looksLikeHello || !isSnappyMailDocRoot(ph)) {
            rmSync(ph, { recursive: true, force: true });
            notes.push(tl('notes.webmail.removedBogusPublicHtml'));
          }
        }
      }
    } catch {
      /* best-effort */
    }
    const rel = docRoot.startsWith(homeDir + '/')
      ? docRoot.slice(homeDir.length + 1)
      : docRoot.startsWith(homeDir)
        ? docRoot.slice(homeDir.length).replace(/^\//, '')
        : 'app/public';
    notes.push(tl('notes.webmail.snappyDocRoot', { path: rel.replace(/\\/g, '/') }));
    return {
      ok: true as const,
      notes,
      written,
      entryFile: 'index.php',
      snappyAdminPassword: adminPassword,
      // SnappyMail MUST be served from package root (app/public), never public_html
      webDocRoot: docRoot,
      webDocRootRel: rel.replace(/\\/g, '/'),
    };
  };

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
    // Always refresh domain JSON / shortLogin=false even on reuse (login fix must stick)
    if (isSnappyMailDocRoot(docRoot) && !isWebmailPublicHtmlStub(docRoot)) {
      const admin = ensureSnappyMailAdminBootstrap(docRoot, input.imapHost, input.smtpHost, undefined, {
        mailDomain: input.mailDomain,
      });
      written.push(...admin.written);
      notes.push(...admin.notes.filter((n) => !/Password:|admin password/i.test(n)).slice(0, 4));
      return finishSnappy(admin.adminPassword);
    }
    return finishSnappy();
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.webmail.needExecute')],
      written,
      entryFile: 'index.php',
    };
  }

  // Extract outside docRoot (same class of bug as Roundcube: wipe must not delete INNER)
  const tmpDir = join(input.homeDir, 'tmp');
  const tmp = join(tmpDir, 'snappymail.tgz');
  const extract = join(tmpDir, 'sm-extract');
  mkdirSync(tmpDir, { recursive: true });
  // Official release may be: flat index.php, snappymail-X/, or public_html/.
  // Prefer public_html when present — root index.php is often only a stub that says
  // "point HTTP server to /public_html" (what operators saw on webmail.demo.ysk.hk).
  const script = [
    `set -euo pipefail`,
    `curl -fsSL ${JSON.stringify(SNAPPYMAIL_URL)} -o ${JSON.stringify(tmp)}`,
    `rm -rf ${JSON.stringify(extract)}`,
    `mkdir -p ${JSON.stringify(extract)} ${JSON.stringify(docRoot)}`,
    // try tar.gz; if Zip archive (not "gzip" — that substring matched 'zip' and broke extract)
    `if file ${JSON.stringify(tmp)} | grep -qiE 'Zip archive|zip archive data'; then unzip -q ${JSON.stringify(tmp)} -d ${JSON.stringify(extract)}; else tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(extract)}; fi`,
    `INNER=""`,
    // 1) nested public_html (preferred)
    `if [ -f ${JSON.stringify(join(extract, 'public_html', 'index.php'))} ]; then INNER=${JSON.stringify(join(extract, 'public_html'))}; fi`,
    // 2) public_html one level down (snappymail-X.Y/public_html)
    `if [ -z "$INNER" ]; then INNER=$(find ${JSON.stringify(extract)} -maxdepth 3 -type d -name public_html 2>/dev/null | while read -r d; do [ -f "$d/index.php" ] && echo "$d" && break; done | head -1); fi`,
    // 3) flat extract with real app (snappymail/ or _include.php next to index)
    `if [ -z "$INNER" ] && [ -f ${JSON.stringify(join(extract, 'index.php'))} ]; then`,
    `  if [ -d ${JSON.stringify(join(extract, 'snappymail'))} ] || [ -f ${JSON.stringify(join(extract, '_include.php'))} ]; then INNER=${JSON.stringify(extract)}; fi`,
    `fi`,
    // 4) snappymail-* top folder
    `if [ -z "$INNER" ]; then`,
    `  TOP=$(find ${JSON.stringify(extract)} -maxdepth 1 -type d -name 'snappymail-*' | head -1)`,
    `  if [ -n "$TOP" ] && [ -f "$TOP/public_html/index.php" ]; then INNER="$TOP/public_html";`,
    `  elif [ -n "$TOP" ] && [ -f "$TOP/index.php" ]; then INNER="$TOP"; fi`,
    `fi`,
    // 5) last resort: any index.php that is NOT the public_html stub
    `if [ -z "$INNER" ]; then`,
    `  while IFS= read -r f; do`,
    `    d=$(dirname "$f")`,
    `    if grep -qi 'configure your HTTP server to point to' "$f" 2>/dev/null; then continue; fi`,
    `    INNER="$d"; break`,
    `  done < <(find ${JSON.stringify(extract)} -maxdepth 4 -type f -name index.php 2>/dev/null)`,
    `fi`,
    `if [ -z "$INNER" ] || [ ! -f "$INNER/index.php" ]; then echo "SnappyMail extract failed"; ls -laR ${JSON.stringify(extract)} | head -80; exit 1; fi`,
    `if grep -qi 'configure your HTTP server to point to' "$INNER/index.php" 2>/dev/null; then echo "SnappyMail INNER is public_html stub, not app tree"; exit 1; fi`,
    `find ${JSON.stringify(docRoot)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
    `cp -a "$INNER"/. ${JSON.stringify(docRoot)}/`,
    `rm -rf ${JSON.stringify(extract)} ${JSON.stringify(tmp)}`,
    `mkdir -p ${JSON.stringify(join(docRoot, 'data'))}`,
    `chmod 777 ${JSON.stringify(join(docRoot, 'data'))} 2>/dev/null || true`,
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 300_000 });
  if (
    r.exitCode !== 0 ||
    !existsSync(marker) ||
    !isSnappyMailDocRoot(docRoot) ||
    isWebmailPublicHtmlStub(docRoot)
  ) {
    notes.push(
      tl('notes.webmail.extractFailed', {
        tool: 'SnappyMail',
        detail: (r.stderr || r.stdout || '').slice(0, 300),
      }),
    );
    if (isWebmailPublicHtmlStub(docRoot)) {
      notes.push(tl('notes.webmail.publicHtmlStub'));
    }
    return { ok: false, notes, written, entryFile: 'index.php' };
  }

  written.push(docRoot);
  const admin = ensureSnappyMailAdminBootstrap(docRoot, input.imapHost, input.smtpHost, undefined, {
    mailDomain: input.mailDomain,
  });
  written.push(...admin.written);
  notes.push(
    tl('notes.webmail.snappyInstalled', { path: docRoot, version: SNAPPYMAIL_VERSION }),
    ...admin.notes,
    tl('notes.webmail.imapSmtpHint', { imap: input.imapHost, smtp: input.smtpHost }),
  );
  return finishSnappy(admin.adminPassword);
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
  opts?: { mailDomain?: string },
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

  // SnappyMail domain JSON — MUST use shortLogin:false so login is full email
  // (Dovecot passwd-file keys are user@domain). Prefer apex mail domain file name.
  const mailDomain = (opts?.mailDomain || '').trim().toLowerCase();
  const domainPayload = {
    IMAP: {
      host: imapHost,
      port: 993,
      type: 1,
      timeout: 300,
      shortLogin: false,
      lowerLogin: true,
      sasl: ['PLAIN', 'LOGIN'],
      ssl: {
        verify_peer: false,
        verify_peer_name: false,
        allow_self_signed: true,
        SNI_enabled: true,
        disable_compression: true,
        security_level: 1,
      },
      disabled_capabilities: ['METADATA', 'OBJECTID', 'PREVIEW', 'STATUS=SIZE'],
      use_expunge_all_on_delete: false,
      fast_simple_search: true,
      force_select: false,
      message_all_headers: false,
      message_list_limit: 10000,
      search_filter: '',
    },
    SMTP: {
      host: smtpHost,
      port: 587,
      type: 2,
      timeout: 60,
      shortLogin: false,
      lowerLogin: true,
      sasl: ['PLAIN', 'LOGIN'],
      ssl: {
        verify_peer: false,
        verify_peer_name: false,
        allow_self_signed: true,
        SNI_enabled: true,
        disable_compression: true,
        security_level: 1,
      },
      useAuth: true,
      setSender: false,
      usePhpMail: false,
    },
    Sieve: {
      host: imapHost,
      port: 4190,
      type: 0,
      timeout: 10,
      shortLogin: false,
      lowerLogin: true,
      sasl: ['PLAIN', 'LOGIN'],
      enabled: false,
    },
    whiteList: '',
  };
  const domainNames = new Set<string>();
  if (mailDomain) domainNames.add(mailDomain);
  domainNames.add(imapHost.replace(/[^a-z0-9.-]/gi, '_') || 'mail');
  domainNames.add('default');
  // Prefer loopback for same-host PHP → Dovecot (avoids external TLS/SNI issues)
  const localPayload = {
    ...domainPayload,
    IMAP: { ...domainPayload.IMAP, host: '127.0.0.1' },
    SMTP: { ...domainPayload.SMTP, host: '127.0.0.1' },
    Sieve: { ...domainPayload.Sieve, host: '127.0.0.1' },
  };
  for (const name of domainNames) {
    const useLocal = name === 'default' || name === mailDomain;
    const body = useLocal ? localPayload : domainPayload;
    const path = join(domDir, `${name}.json`);
    writeFileSync(path, JSON.stringify(body, null, 4) + '\n', 'utf8');
    written.push(path);
  }

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
      'Mailbox login: full email (user@domain), not short local-part',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(once);

  notes.push(tl('notes.webmail.snappyAdminOnce', { user: 'admin' }));
  notes.push(tl('notes.webmail.snappyAdminPassword', { password: pass }));
  notes.push(tl('notes.webmail.snappyFullEmailLogin'));
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
  // Config/plugins/temp live on package root; docRoot may be public_html/
  const packageRoot = resolveRoundcubePackageRoot(docRoot);
  const configDir = join(packageRoot, 'config');
  const tempDir = join(packageRoot, 'temp');
  const logsDir = join(packageRoot, 'logs');
  const dbDir = join(packageRoot, 'db');
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
      packageRoot,
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

  // Ensure SQLite schema exists (official sqlite.initial.sql uses unprefixed tables)
  try {
    const dbPath = join(dbDir, 'roundcube.db');
    const schema = join(packageRoot, 'SQL', 'sqlite.initial.sql');
    if (existsSync(schema)) {
      let needInit = !existsSync(dbPath);
      if (!needInit) {
        try {
          const tables = execFileSync('sqlite3', [dbPath, '.tables'], {
            encoding: 'utf8',
            timeout: 5000,
          });
          needInit = !/\bsession\b/.test(tables);
        } catch {
          needInit = true;
        }
      }
      if (needInit) {
        execFileSync('sqlite3', [dbPath], {
          input: readFileSync(schema),
          timeout: 15_000,
        });
        try {
          chmodSync(dbPath, 0o666);
        } catch {
          /* */
        }
        written.push(dbPath);
        notes.push(tl('notes.webmail.sqliteSchemaReady'));
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(tl('notes.webmail.sqliteSchemaFailed', { detail: msg.slice(0, 160) }));
  }

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
$config['db_prefix'] = '';
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
// Behind Nginx TLS: force_https would redirect-loop (PHP sees HTTP on php -S / FPM).
// Nginx enforces HTTPS; use_https marks the session cookie Secure.
$config['force_https'] = false;
$config['use_https'] = ${forceHttps ? 'true' : 'false'};
$config['proxy_whitelist'] = ['127.0.0.1', '::1'];
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
 * Shared instance for all mail domains — one project / one hostname.
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
   * instead of failing (upgrade path). Default true for global shared webmail.
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
  const name = input.name.trim() || GLOBAL_WEBMAIL_PROJECT_NAME;
  const domain = input.domain.trim().toLowerCase();
  const tool = normalizeWebmailTool(input.tool);
  const wantDownload = input.download !== false;
  // Shared webmail: existing project → reinstall by default (no orphan hellos)
  const reinstall = input.reinstall !== false;

  if (!name) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needProjectName'), { httpStatus: 400 });
  }
  if (!domain) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.webmail.domainRequired'), {
      httpStatus: 400,
    });
  }

  // Honest gate: never create a half project when download needs EXECUTE
  if (wantDownload && !input.host.executeEnabled()) {
    const msg = tl('notes.webmail.needExecute');
    return {
      ok: false,
      tool,
      notes: [msg, tl('notes.webmail.needExecuteBeforeCreate')],
      written,
      blocked: true,
      requiresExecute: true,
      blockMessage: msg,
      apply_status: 'blocked',
    };
  }

  const byName = input.projects.list().find(
    (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
  );
  const byDomain = input.projects.list().find(
    (p) => (p.domain ?? '').trim().toLowerCase() === domain,
  );
  const existing = byName ?? byDomain;

  if (existing && reinstall) {
    notes.push(tl('notes.webmail.reinstalling', { id: existing.id, name: existing.name }));
    return reinstallWebmailProject({
      projects: input.projects,
      projectOps: input.projectOps,
      host: input.host,
      actor: input.actor,
      projectId: existing.id,
      tool,
      download: wantDownload,
      imapHost: input.imapHost,
      smtpHost: input.smtpHost,
      mailDomain: input.mailDomain,
      forceHttps: input.forceHttps,
      installSsoPlugin: input.installSsoPlugin,
      panelBaseUrl: input.panelBaseUrl,
      goLive: true,
    });
  }

  if (existing && !reinstall) {
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

  let created: Awaited<ReturnType<ProjectService['create']>>;
  try {
    created = await input.projects.create({
      name,
      domain,
      runtime: 'php',
      // Empty-ish scaffold; install replaces docRoot immediately after
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
  // Do not surface php-hello scaffold noise when we immediately replace with Roundcube/Snappy

  const row = input.projects.get(created.project.id);
  // Always install into package root — never inherit a wrong public_html doc_root from scaffold
  const packageRoot = join(row.homeDir, 'app', 'public');

  try {
    // Wipe hello template so we never leave only YSK PHP OK after a failed mid-install
    mkdirSync(packageRoot, { recursive: true });
    for (const ent of ['index.php', 'index.html', 'public_html']) {
      const p = join(packageRoot, ent);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }

  const inst = await installWebmailIntoProject({
    host: input.host,
    homeDir: row.homeDir,
    docRoot: packageRoot,
    tool,
    domain,
    imapHost: input.imapHost,
    smtpHost: input.smtpHost,
    mailDomain: input.mailDomain,
    download: wantDownload,
    forceHttps: input.forceHttps === true,
    installSsoPlugin: input.installSsoPlugin !== false,
    panelBaseUrl: input.panelBaseUrl,
  });
  notes.push(...inst.notes);
  written.push(...inst.written);
  if (!inst.ok) {
    const needEx = notes.some((n) => /YSK_EXECUTE|execute|EXECUTE/i.test(n));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes: [...notes, tl('notes.webmail.installIncompleteHint')],
      written,
      urlHint: `http://${domain}/`,
      apply_status: needEx ? 'blocked' : 'failed',
      requiresExecute: needEx,
      blocked: needEx,
      blockMessage: notes.find((n) => /YSK_EXECUTE|execute|EXECUTE/i.test(n)),
      snappyAdminPassword: inst.snappyAdminPassword,
    };
  }

  // Install may extract as root — fix ownership before goLive / php -S
  await ensureWebmailTreeOwnership(input.host, input.projects.get(row.id), notes);
  // Panel mailbox passwords need live Dovecot passwd-file (not PAM-only)
  await ensureMailAuthForWebmailLogin(input.host, notes, written);

  // Roundcube 1.6+: persist public_html as project doc_root before goLive
  // SnappyMail: always persist app/public (never leftover public_html/php-hello)
  const docRootRel =
    inst.webDocRootRel ||
    (tool === 'snappymail' ? 'app/public' : undefined) ||
    (tool === 'roundcube' ? undefined : 'app/public');
  if (docRootRel) {
    try {
      input.projects.updateNetwork(
        row.id,
        { docRoot: docRootRel, forceHttps: input.forceHttps === true },
        input.actor,
      );
      notes.push(tl('notes.webmail.docRootUpdated', { path: docRootRel }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(tl('notes.webmail.docRootUpdateFailed', { detail: msg }));
    }
  } else if (input.forceHttps === true) {
    try {
      input.projects.updateNetwork(row.id, { forceHttps: true }, input.actor);
    } catch {
      /* best-effort */
    }
  }

  const liveDocRoot =
    inst.webDocRoot ??
    join(
      row.homeDir,
      (input.projects.get(row.id).docRoot || 'app/public').replace(/^\//, ''),
    );

  // Never goLive on php-hello leftover
  try {
    const idx = join(liveDocRoot, 'index.php');
    if (existsSync(idx) && /YSK PHP OK/i.test(readFileSync(idx, 'utf8'))) {
      notes.push(tl('notes.webmail.phpHelloStillPresent'));
      return {
        ok: false,
        project: row,
        projectId: row.id,
        tool,
        notes,
        written,
        urlHint: `http://${domain}/`,
        apply_status: 'failed',
      };
    }
  } catch {
    /* continue */
  }

  // Verify real app tree before deploy (never goLive on package-root stub)
  if (isWebmailPublicHtmlStub(liveDocRoot)) {
    notes.push(tl('notes.webmail.publicHtmlStub'));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
    };
  }
  if (tool === 'roundcube' && !isRoundcubeDocRoot(liveDocRoot)) {
    notes.push(tl('notes.webmail.notRoundcubeTree'));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
    };
  }
  if (tool === 'snappymail' && !isSnappyMailDocRoot(liveDocRoot)) {
    notes.push(tl('notes.webmail.notSnappyTree'));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
    };
  }

  const live = await input.projectOps.goLive(row.id, { actor: input.actor });
  const liveNotes = (live.notes ?? []).slice(0, 16);
  if (!live.ok) {
    // Surface deploy failure first so OpsResultPanel summary is not only install success lines
    notes.unshift(
      tl('notes.webmail.goLiveFailed'),
      ...liveNotes.filter((n) => /fail|error|unhealthy|incomplete|失敗|錯誤/i.test(n)).slice(0, 6),
    );
    notes.push(...liveNotes.filter((n) => !notes.includes(n)).slice(0, 10));
  } else {
    notes.push(...liveNotes);
  }
  notes.push(tl('notes.webmail.openHint'));
  notes.push(tl('notes.webmail.sslHint', { domain }));
  if (input.forceHttps === true) {
    notes.push(tl('notes.webmail.forceHttpsNeedsSsl'));
  }
  const fresh = input.projects.get(row.id);
  const blocked = Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute);
  // Install tree is the critical path; degraded php -S + nginx still counts as applied when deploy ok
  const ok = Boolean(live.ok) && inst.ok && !blocked;
  return {
    ok,
    project: fresh,
    projectId: fresh.id,
    tool,
    urlHint: input.forceHttps ? `https://${domain}/` : `http://${domain}/`,
    notes,
    written,
    blocked,
    requiresExecute: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
    requiresRoot: Boolean(live.deploy?.requiresRoot || live.publish?.requiresRoot),
    blockMessage: blocked
      ? (live.notes ?? []).find((n) => /YSK_EXECUTE|execute|root/i.test(n))
      : !ok
        ? notes.find((n) => /goLive|deploy|unhealthy|失敗/i.test(n))
        : undefined,
    apply_status: ok ? 'applied' : blocked ? 'blocked' : live.ok === false ? 'failed' : 'written',
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
  mailDomain?: string;
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
  // Always install into package root (app/public), not public_html web root
  const configuredAbs = join(row.homeDir, (row.docRoot || 'app/public').replace(/^\//, ''));
  // SnappyMail: never use nested public_html as package root
  const packageRootAbs =
    tool === 'snappymail'
      ? join(row.homeDir, 'app', 'public')
      : resolveRoundcubePackageRoot(configuredAbs);
  const wantDownload = input.download !== false;
  if (wantDownload && !input.host.executeEnabled()) {
    const msg = tl('notes.webmail.needExecute');
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes: [msg],
      written,
      blocked: true,
      requiresExecute: true,
      blockMessage: msg,
      apply_status: 'blocked',
      urlHint: `https://${domain}/`,
    };
  }
  notes.push(
    tl('notes.webmail.reinstallStart', {
      id: row.id,
      version: tool === 'snappymail' ? SNAPPYMAIL_VERSION : ROUNDCUBE_VERSION,
    }),
  );

  const mailDomain = (input.mailDomain || '').trim().toLowerCase() || undefined;
  const endpoints = resolveWebmailMailEndpoints({
    webmailDomain: domain,
    mailDomain: input.mailDomain,
    imapHost: input.imapHost,
    smtpHost: input.smtpHost,
  });

  const inst = await installWebmailIntoProject({
    host: input.host,
    homeDir: row.homeDir,
    docRoot: packageRootAbs,
    tool,
    domain,
    imapHost: endpoints.imapHost,
    smtpHost: endpoints.smtpHost,
    mailDomain: endpoints.mailDomain ?? mailDomain,
    download: wantDownload,
    forceHttps: input.forceHttps === true,
    installSsoPlugin: input.installSsoPlugin !== false,
    panelBaseUrl: input.panelBaseUrl,
  });
  notes.push(...inst.notes);
  written.push(...inst.written);
  if (!inst.ok) {
    const needEx = notes.some((n) => /YSK_EXECUTE|execute|EXECUTE/i.test(n));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes: [...notes, tl('notes.webmail.installIncompleteHint')],
      written,
      urlHint: `https://${domain}/`,
      apply_status: needEx ? 'blocked' : 'failed',
      blocked: needEx,
      blockMessage: notes.find((n) => /YSK_EXECUTE|execute|EXECUTE/i.test(n)),
      snappyAdminPassword: inst.snappyAdminPassword,
      requiresExecute: needEx,
    };
  }

  // Install may extract as root — fix ownership before goLive / php -S
  await ensureWebmailTreeOwnership(input.host, input.projects.get(row.id), notes);
  await ensureMailAuthForWebmailLogin(input.host, notes, written);

  const docRootRel =
    inst.webDocRootRel ||
    (tool === 'snappymail' ? 'app/public' : undefined) ||
    'app/public';
  if (docRootRel) {
    try {
      input.projects.updateNetwork(
        row.id,
        { docRoot: docRootRel, forceHttps: input.forceHttps === true },
        input.actor,
      );
      notes.push(tl('notes.webmail.docRootUpdated', { path: docRootRel }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(tl('notes.webmail.docRootUpdateFailed', { detail: msg }));
    }
  } else if (input.forceHttps === true) {
    try {
      input.projects.updateNetwork(row.id, { forceHttps: true }, input.actor);
    } catch {
      /* best-effort */
    }
  }

  const liveDocRoot =
    inst.webDocRoot ??
    join(
      row.homeDir,
      (input.projects.get(row.id).docRoot || 'app/public').replace(/^\//, ''),
    );

  try {
    const idx = join(liveDocRoot, 'index.php');
    if (existsSync(idx) && /YSK PHP OK/i.test(readFileSync(idx, 'utf8'))) {
      notes.push(tl('notes.webmail.phpHelloStillPresent'));
      return {
        ok: false,
        project: row,
        projectId: row.id,
        tool,
        notes,
        written,
        urlHint: `https://${domain}/`,
        apply_status: 'failed',
      };
    }
  } catch {
    /* continue */
  }

  if (tool === 'roundcube' && !isRoundcubeDocRoot(liveDocRoot)) {
    notes.push(tl('notes.webmail.notRoundcubeTree'));
    return {
      ok: false,
      project: row,
      projectId: row.id,
      tool,
      notes,
      written,
      urlHint: `https://${domain}/`,
      apply_status: 'failed',
    };
  }

  if (input.goLive !== false) {
    const live = await input.projectOps.goLive(row.id, { actor: input.actor });
    const liveNotes = (live.notes ?? []).slice(0, 12);
    if (!live.ok) {
      notes.unshift(
        tl('notes.webmail.goLiveFailed'),
        ...liveNotes.filter((n) => /fail|error|unhealthy|incomplete|失敗|錯誤/i.test(n)).slice(0, 6),
      );
      notes.push(...liveNotes.filter((n) => !notes.includes(n)).slice(0, 10));
    } else {
      notes.push(...liveNotes);
    }
    notes.push(tl('notes.webmail.openHint'));
    notes.push(tl('notes.webmail.sslHint', { domain }));
    if (input.forceHttps === true) {
      notes.push(tl('notes.webmail.forceHttpsNeedsSsl'));
    }
    const fresh = input.projects.get(row.id);
    const blocked = Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute);
    const ok = Boolean(live.ok) && inst.ok && !blocked;
    return {
      ok,
      project: fresh,
      projectId: fresh.id,
      tool,
      urlHint: input.forceHttps ? `https://${domain}/` : `http://${domain}/`,
      notes,
      written,
      blocked,
      requiresExecute: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
      requiresRoot: Boolean(live.deploy?.requiresRoot || live.publish?.requiresRoot),
      blockMessage: blocked
        ? (live.notes ?? []).find((n) => /YSK_EXECUTE|execute|root/i.test(n))
        : !ok
          ? notes.find((n) => /goLive|deploy|unhealthy|失敗/i.test(n))
          : undefined,
      apply_status: ok ? 'applied' : blocked ? 'blocked' : live.ok === false ? 'failed' : 'written',
      snappyAdminPassword: inst.snappyAdminPassword,
    };
  }

  return {
    ok: true,
    project: row,
    projectId: row.id,
    tool,
    urlHint: `https://${domain}/`,
    notes,
    written,
    apply_status: 'written',
    snappyAdminPassword: inst.snappyAdminPassword,
  };
}
