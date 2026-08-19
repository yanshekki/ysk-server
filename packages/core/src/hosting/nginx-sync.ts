/**
 * Write / sync nginx configs managed under dataDir to optional system path.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { injectDefenseLimitsIntoConf } from './defense/nginx-limits.js';

export interface NginxSyncResult {
  sourceDir: string;
  targetDir: string | null;
  files: string[];
  copied: string[];
  tested: boolean;
  testOutput?: string;
  notes: string[];
  /** false when nginx -t failed after system copy was requested */
  ok: boolean;
  blocked?: boolean;
  requiresExecute?: boolean;
}

/**
 * Ensure managed nginx conf dir exists; optionally copy to system sites and nginx -t.
 */
/** Managed `ysks_xxx.conf` or system `ysk-ysks_xxx.conf`. */
export function isProjectNginxConfName(name: string): boolean {
  return /^(ysk-)?ysks_[a-z0-9]+\.conf$/i.test(name);
}

export function linuxUserFromNginxConfName(name: string): string {
  return name.replace(/^ysk-/i, '').replace(/\.conf$/i, '');
}

/** Remove project vhosts whose linux user is no longer in the store. */
export function pruneOrphanProjectNginxConfs(opts: {
  managedDir: string;
  systemDir?: string | null;
  keepLinuxUsers: string[];
}): string[] {
  const keep = new Set(opts.keepLinuxUsers.map((u) => u.trim().toLowerCase()).filter(Boolean));
  const removed: string[] = [];
  const sweep = (dir: string | null | undefined) => {
    if (!dir || !existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!isProjectNginxConfName(f)) continue;
      const user = linuxUserFromNginxConfName(f).toLowerCase();
      if (keep.has(user)) continue;
      const path = join(dir, f);
      try {
        unlinkSync(path);
        removed.push(path);
      } catch {
        /* leave in place */
      }
    }
  };
  sweep(opts.managedDir);
  sweep(opts.systemDir ?? undefined);
  return removed;
}

export const YSK_DEFAULT_NGINX_BASENAME = '000-default.conf';

export type YskDefaultSslMode = 'reject' | 'selfsigned';

/** Catch-all so unknown Host / SNI does not fall into another site's vhost. */
export function renderYskDefaultNginxConf(opts?: {
  sslMode?: YskDefaultSslMode;
  sslCertificate?: string;
  sslCertificateKey?: string;
}): string {
  const sslMode = opts?.sslMode ?? 'reject';
  const http = `server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  return 444;
}`;
  if (sslMode === 'selfsigned' && opts?.sslCertificate && opts.sslCertificateKey) {
    return `# YSK catch-all — unknown Host / SNI must not serve another site
${http}
server {
  listen 443 ssl default_server;
  listen [::]:443 ssl default_server;
  server_name _;
  ssl_certificate ${opts.sslCertificate};
  ssl_certificate_key ${opts.sslCertificateKey};
  return 444;
}
`;
  }
  return `# YSK catch-all — unknown Host / SNI must not serve another site
${http}
server {
  listen 443 ssl default_server;
  listen [::]:443 ssl default_server;
  server_name _;
  ssl_reject_handshake on;
}
`;
}

export function ensureYskDefaultNginxConf(
  managedDir: string,
  opts?: {
    sslMode?: YskDefaultSslMode;
    sslCertificate?: string;
    sslCertificateKey?: string;
  },
): string {
  mkdirSync(managedDir, { recursive: true });
  const path = join(managedDir, YSK_DEFAULT_NGINX_BASENAME);
  writeFileSync(path, renderYskDefaultNginxConf(opts), 'utf8');
  return path;
}

/** Remove default_server from listen lines (keep our catch-all file). */
export function stripListenDefaultServer(body: string): string {
  return body.replace(
    /^(\s*listen\s+[^;]*?)\s+default_server(\s+[^;]*)?;/gm,
    (_, pre: string, rest?: string) => `${pre}${rest ?? ''};`,
  );
}

export function isYskManagedSystemConfName(name: string): boolean {
  return /^ysk-.+\.conf$/i.test(name);
}

/** System copies whose managed source is gone (all ysk-*.conf, not only ysks_*). */
export function pruneStaleYskSystemNginxConfs(
  systemDir: string,
  managedBasenames: string[],
): string[] {
  if (!existsSync(systemDir)) return [];
  const keep = new Set(
    managedBasenames.map((f) => (f.startsWith('ysk-') ? f : `ysk-${f}`)),
  );
  const removed: string[] = [];
  for (const f of readdirSync(systemDir)) {
    if (!isYskManagedSystemConfName(f)) continue;
    if (keep.has(f)) continue;
    const path = join(systemDir, f);
    try {
      unlinkSync(path);
      removed.push(path);
    } catch {
      /* leave */
    }
  }
  return removed;
}

export function publicFilesConfBasename(serverName: string): string {
  return `public-files-${serverName.trim().toLowerCase().replace(/\./g, '-')}.conf`;
}

export function pruneStalePublicFilesNginxConfs(
  managedDir: string,
  keepBasename?: string | null,
): string[] {
  if (!existsSync(managedDir) || !keepBasename) return [];
  const removed: string[] = [];
  for (const f of readdirSync(managedDir)) {
    if (!f.startsWith('public-files-') || !f.endsWith('.conf')) continue;
    if (f === keepBasename) continue;
    const path = join(managedDir, f);
    try {
      unlinkSync(path);
      removed.push(path);
    } catch {
      /* leave */
    }
  }
  return removed;
}

const YSK_DEFAULT_SYSTEM_NAME = `ysk-${YSK_DEFAULT_NGINX_BASENAME}`;

function stripForeignDefaultServer(dir: string, notes: string[]): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.conf')) continue;
    if (f === YSK_DEFAULT_NGINX_BASENAME || f === YSK_DEFAULT_SYSTEM_NAME) continue;
    const path = join(dir, f);
    try {
      const prev = readFileSync(path, 'utf8');
      if (!/\bdefault_server\b/.test(prev)) continue;
      const next = stripListenDefaultServer(prev);
      if (next !== prev) {
        writeFileSync(path, next, 'utf8');
        notes.push(`stripped default_server from ${path}`);
      }
    } catch {
      /* leave */
    }
  }
}

async function disableDistroNginxDefault(
  host: HostExecutor,
  notes: string[],
): Promise<void> {
  const targets = [
    '/etc/nginx/sites-enabled/default',
    '/etc/nginx/sites-enabled/default-ssl',
  ];
  for (const p of targets) {
    if (!host.pathExists(p)) continue;
    try {
      unlinkSync(p);
      notes.push(`disabled distro nginx site ${p}`);
    } catch {
      const r = await host.runCommand(['rm', '-f', p], { timeoutMs: 5_000 });
      if (r.exitCode === 0) notes.push(`disabled distro nginx site ${p}`);
    }
  }
}

async function ensureDefaultSelfSigned(
  host: HostExecutor,
  dataDir: string,
): Promise<{ cert: string; key: string } | null> {
  const dir = join(dataDir, 'nginx', 'default-tls');
  const cert = join(dir, 'fullchain.pem');
  const key = join(dir, 'privkey.pem');
  if (existsSync(cert) && existsSync(key)) return { cert, key };
  mkdirSync(dir, { recursive: true });
  const r = await host.runCommand(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '3650',
      '-nodes',
      '-subj',
      '/CN=_',
    ],
    { timeoutMs: 20_000 },
  );
  if (r.exitCode !== 0 || !existsSync(cert) || !existsSync(key)) return null;
  return { cert, key };
}

export function keepPublicFilesBasenameFromMeta(dataDir: string): string | undefined {
  const metaPath = join(dataDir, 'files', 'public-files-meta.json');
  if (!existsSync(metaPath)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { serverName?: string };
    const sn = String(meta.serverName ?? '').trim();
    return sn ? publicFilesConfBasename(sn) : undefined;
  } catch {
    return undefined;
  }
}

export async function syncNginxConfigs(opts: {
  dataDir: string;
  /** e.g. /etc/nginx/conf.d — only used when executeEnabled + writable */
  systemConfDir?: string;
  host: HostExecutor;
  dryRun?: boolean;
  /** When set, drop ysks_* vhosts whose linux user is not live */
  keepLinuxUsers?: string[];
  /** Keep this public-files-*.conf; drop other public-files leftovers */
  keepPublicFilesConf?: string;
}): Promise<NginxSyncResult> {
  const sourceDir = join(opts.dataDir, 'nginx', 'conf.d');
  mkdirSync(sourceDir, { recursive: true });
  const pruneNotes: string[] = [];
  if (!opts.dryRun) {
    const keepPf =
      opts.keepPublicFilesConf ?? keepPublicFilesBasenameFromMeta(opts.dataDir);
    for (const p of pruneStalePublicFilesNginxConfs(sourceDir, keepPf)) {
      pruneNotes.push(tl('notes.nginx.removedOrphan', { path: p }));
    }
  }
  ensureYskDefaultNginxConf(sourceDir);
  if (opts.keepLinuxUsers && !opts.dryRun) {
    const removed = pruneOrphanProjectNginxConfs({
      managedDir: sourceDir,
      systemDir: opts.systemConfDir,
      keepLinuxUsers: opts.keepLinuxUsers,
    });
    for (const p of removed) {
      pruneNotes.push(tl('notes.nginx.removedOrphan', { path: p }));
    }
  }
  // always write a managed main include snippet for documentation
  const managedMain = join(opts.dataDir, 'nginx', 'ysk-managed.conf');
  writeFileSync(
    managedMain,
    `# Generated by YSK Server — include from main nginx.conf:\n# include ${sourceDir}/*.conf;\n`,
    'utf8',
  );

  const files = existsSync(sourceDir)
    ? readdirSync(sourceDir).filter((f) => f.endsWith('.conf'))
    : [];
  const includes = existsSync(sourceDir)
    ? readdirSync(sourceDir).filter((f) => f.endsWith('.inc'))
    : [];
  const notes: string[] = [
    tl('notes.nginx.managedDir', { path: sourceDir }),
    tl('notes.nginx.includeHint', { path: sourceDir }),
    ...pruneNotes,
  ];
  const copied: string[] = [];
  const targetDir = opts.systemConfDir ?? null;

  if (opts.dryRun) {
    return {
      sourceDir,
      targetDir,
      files,
      copied: [],
      tested: false,
      notes: [...notes, tl('notes.auto.n1014')],
      ok: true };
  }

  let blocked = false;
  if (targetDir && opts.host.executeEnabled()) {
    mkdirSync(targetDir, { recursive: true });
    for (const f of files) {
      const src = join(sourceDir, f);
      const dest = join(targetDir, `ysk-${f}`);
      let srcBody = '';
      try {
        srcBody = readFileSync(src, 'utf8');
      } catch {
        srcBody = '';
      }
      if (existsSync(dest) && srcBody) {
        try {
          const destBody = readFileSync(dest, 'utf8');
          const destHasSsl = /ssl_certificate\s+\S+/.test(destBody) || /listen\s+[^;]*443/.test(destBody);
          const srcHas443 = /listen\s+[^;]*443/.test(srcBody);
          if (destHasSsl && !srcHas443) {
            notes.push(tl('notes.nginx.keptLiveSsl', { path: dest }));
            continue;
          }
        } catch {
          /* copy anyway */
        }
      }
      copyFileSync(src, dest);
      copied.push(dest);
    }
    // Defense / shared includes (server-context snippets)
    for (const f of includes) {
      const src = join(sourceDir, f);
      // Keep stable name for ysk-defense-limits.inc so vhosts can include it
      const dest = join(targetDir, f.startsWith('ysk-') ? f : `ysk-${f}`);
      copyFileSync(src, dest);
      copied.push(dest);
    }
    try {
      for (const p of pruneStaleYskSystemNginxConfs(targetDir, files)) {
        notes.push(tl('notes.nginx.removedOrphan', { path: p }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notes.push(tl('notes.nginx.orphanCleanupFailed', { detail: msg.slice(0, 120) }));
    }
    await disableDistroNginxDefault(opts.host, notes);
    stripForeignDefaultServer(targetDir, notes);
    if (existsSync('/etc/nginx/sites-enabled')) {
      stripForeignDefaultServer('/etc/nginx/sites-enabled', notes);
    }
    notes.push(tl('notes.auto.t0427', { v0: (copied.length) }));
  } else if (targetDir) {
    notes.push(tl('notes.auto.n1148'));
    blocked = true;
  }

  let tested = false;
  let testOutput: string | undefined;
  if (opts.host.executeEnabled() && opts.host.pathExists('/usr/sbin/nginx')) {
    const r = await opts.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
    tested = r.exitCode === 0;
    testOutput = `${r.stdout}\n${r.stderr}`.trim();
    if (
      !tested &&
      /ssl_reject_handshake|unknown directive/i.test(testOutput) &&
      targetDir &&
      opts.host.executeEnabled()
    ) {
      const tls = await ensureDefaultSelfSigned(opts.host, opts.dataDir);
      if (tls) {
        ensureYskDefaultNginxConf(sourceDir, {
          sslMode: 'selfsigned',
          sslCertificate: tls.cert,
          sslCertificateKey: tls.key,
        });
        try {
          copyFileSync(
            join(sourceDir, YSK_DEFAULT_NGINX_BASENAME),
            join(targetDir, YSK_DEFAULT_SYSTEM_NAME),
          );
        } catch {
          /* */
        }
        const r2 = await opts.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
        tested = r2.exitCode === 0;
        testOutput = `${r2.stdout}\n${r2.stderr}`.trim();
        notes.push('catch-all 443 fell back to a local self-signed cert (ssl_reject_handshake unavailable)');
      }
    }
    notes.push(
      tested ? tl('notes.nginx.configOk') : tl('notes.tpl.nginxConfigFailed', { detail: testOutput || tl('notes.tpl.unknownError') }),
    );
  } else {
    notes.push(tl('notes.auto.n0791'));
  }

  // ok: managed write always succeeds; system path blocked or nginx -t fail → not ok
  const ok = blocked
    ? false
    : copied.length > 0
      ? tested || !opts.host.pathExists('/usr/sbin/nginx')
      : true;

  return {
    sourceDir,
    targetDir,
    files,
    copied,
    tested,
    testOutput,
    notes,
    ok,
    blocked: blocked || undefined,
    requiresExecute: blocked || undefined };
}

/**
 * Write a single server block into managed conf.d.
 * If Defense Center limits are active, inject YSK_DEFENSE include marker.
 */
export function writeManagedNginxConf(dataDir: string, filename: string, content: string): string {
  if (!filename.endsWith('.conf')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1017'), { httpStatus: 400 });
  }
  const dir = join(dataDir, 'nginx', 'conf.d');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  let body = content;
  const limitsInc = join(dir, 'ysk-defense-limits.inc');
  if (existsSync(limitsInc) && /server\s*\{/.test(body) && !body.includes('BEGIN YSK_DEFENSE')) {
    body = injectDefenseLimitsIntoConf(body);
  }
  writeFileSync(path, body, 'utf8');
  return path;
}

export function listManagedNginxConfs(dataDir: string): Array<{ name: string; path: string; bytes: number }> {
  const dir = join(dataDir, 'nginx', 'conf.d');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.conf'))
    .map((name) => {
      const path = join(dir, name);
      return { name, path, bytes: Buffer.byteLength(readFileSync(path)) };
    });
}
