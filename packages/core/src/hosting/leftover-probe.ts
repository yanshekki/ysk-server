/**
 * Read-only leftover scan after a product overlay.
 * Does not mutate nginx, Apache, vsftpd, or Dovecot.
 */
import { homedir } from 'node:os';
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';

export type LeftoverFinding = {
  id: string;
  ok: boolean;
  title: string;
  detail: string;
  cta?: string;
  /** Panel deep-link when the finding maps to a feature page */
  href?: string;
};

/** Overlay leftover kinds — UI splits the readiness blob on these. */
export type LeftoverKind = 'apache' | 'vsftpd' | 'cli' | 'nginx' | 'dovecot' | 'other';

/** Managed nginx list roles — leftover/unused stay in sync until the operator acts. */
export type ManagedNginxRole = 'managed' | 'leftover' | 'unused';

export function leftoverHrefForKind(kind: LeftoverKind): string | undefined {
  if (kind === 'apache') return '/apache';
  if (kind === 'vsftpd') return '/ftp?tab=service';
  if (kind === 'nginx') return '/nginx';
  if (kind === 'dovecot') return '/email';
  // stale CLI / rm -f: leftover apply after overlay (no dedicated leftover page)
  if (kind === 'cli') return '/updates';
  return undefined;
}

export function leftoverHrefForId(id: string): string | undefined {
  if (id === 'apache-default') return leftoverHrefForKind('apache');
  if (id === 'vsftpd-failed') return leftoverHrefForKind('vsftpd');
  if (id === 'stale-cli') return leftoverHrefForKind('cli');
  if (id === 'nginx-catchall') return leftoverHrefForKind('nginx');
  if (id === 'dovecot-ssl') return leftoverHrefForKind('dovecot');
  return undefined;
}

export function leftoverKindFromNote(note: string): LeftoverKind {
  const s = String(note || '');
  if (/ysk-000-default|catch-all|nginx-sync/i.test(s)) return 'nginx';
  if (/Apache leftover|Apache 遺留|Apache 預設|Apache 000-default|sites-enabled\/000-default/i.test(s)) {
    return 'apache';
  }
  if (/vsftpd/i.test(s)) return 'vsftpd';
  if (/rm -f|leftover CLI|stale leftover|舊 CLI|舊版 CLI|PATH may prefer|PATH 可能/i.test(s)) {
    return 'cli';
  }
  if (/Dovecot|ssl_cert/i.test(s)) return 'dovecot';
  return 'other';
}

/** Split the readiness leftover blob (notes joined with " · "). */
export function splitLeftoverNotes(blob: string): string[] {
  return String(blob || '')
    .split(/\s·\s|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Export-tab nginx files: leftover public-files-* and unused 000-default.
 * Do not drop them from sync — operator must act.
 */
export function classifyManagedNginxName(
  name: string,
  keepPublicFiles?: string | null,
): ManagedNginxRole {
  const base = String(name || '').replace(/^ysk-/i, '');
  if (/^000-default\.conf$/i.test(base)) return 'unused';
  if (/^public-files-/i.test(base)) {
    const keep = String(keepPublicFiles || '').replace(/^ysk-/i, '');
    if (keep && base === keep) return 'managed';
    return 'leftover';
  }
  return 'managed';
}

export function staleNpmGlobalCliPaths(): string[] {
  const home = homedir();
  return [...new Set(['/root/.npm-global/bin/ysk-server', `${home}/.npm-global/bin/ysk-server`])];
}

export function collectStaleCliNotes(input: {
  host: HostExecutor;
  currentVersion?: string;
}): string[] {
  const notes: string[] = [];
  const current = (input.currentVersion || '').trim();
  for (const p of staleNpmGlobalCliPaths()) {
    if (!input.host.pathExists(p)) continue;
    notes.push(tl('notes.leftover.staleCli', { path: p, version: current || '?' }));
  }
  return notes;
}

export async function probeHostLeftovers(input: {
  host: HostExecutor;
  currentVersion?: string;
}): Promise<{ ok: boolean; findings: LeftoverFinding[]; notes: string[] }> {
  const findings: LeftoverFinding[] = [];
  const host = input.host;

  for (const p of staleNpmGlobalCliPaths()) {
    if (!host.pathExists(p)) continue;
    findings.push({
      id: 'stale-cli',
      ok: false,
      title: tl('notes.leftover.staleCliTitle'),
      detail: tl('notes.leftover.staleCli', { path: p, version: input.currentVersion || '?' }),
      cta: `rm -f ${p}`,
      href: leftoverHrefForId('stale-cli'),
    });
  }

  const apacheDefault = '/etc/apache2/sites-enabled/000-default.conf';
  if (host.pathExists(apacheDefault)) {
    findings.push({
      id: 'apache-default',
      ok: false,
      title: tl('notes.leftover.apacheDefaultTitle'),
      detail: tl('notes.leftover.apacheDefault'),
      cta: 'ysk-server hosting apache apply --execute',
      href: leftoverHrefForId('apache-default'),
    });
  }

  const yskCatchAll = '/etc/nginx/conf.d/ysk-000-default.conf';
  if (host.pathExists('/etc/nginx/conf.d') && !host.pathExists(yskCatchAll)) {
    findings.push({
      id: 'nginx-catchall',
      ok: false,
      title: tl('notes.leftover.nginxCatchAllTitle'),
      detail: tl('notes.leftover.nginxCatchAll'),
      cta: 'ysk-server projects nginx-sync --execute',
      href: leftoverHrefForId('nginx-catchall'),
    });
  }

  if (host.pathExists('/usr/sbin/vsftpd') || host.pathExists('/etc/vsftpd.conf')) {
    try {
      const st = await host.serviceStatus('vsftpd');
      const blob = `${st.stdout} ${st.stderr}`.toLowerCase();
      if (/\bfailed\b|inactive \(dead\)|exit-code|invalidargument/.test(blob)) {
        findings.push({
          id: 'vsftpd-failed',
          ok: false,
          title: tl('notes.leftover.vsftpdTitle'),
          detail: tl('notes.leftover.vsftpd'),
          cta: 'ysk-server ftp apply --execute',
          href: leftoverHrefForId('vsftpd-failed'),
        });
      }
    } catch {
      /* probe optional */
    }
  }

  const doveTls = '/etc/dovecot/conf.d/99-ysk-mail-tls.conf';
  if (host.pathExists(doveTls)) {
    try {
      const body = await host.readFile(doveTls);
      const cert = body.match(/ssl_cert\s*=\s*<(\S+)/)?.[1];
      if (cert && !host.pathExists(cert)) {
        findings.push({
          id: 'dovecot-ssl',
          ok: false,
          title: tl('notes.leftover.dovecotTitle'),
          detail: tl('notes.leftover.dovecot', { path: cert }),
          cta: 'ysk-server email apply --execute  (or issue mail LE, then apply TLS)',
          href: leftoverHrefForId('dovecot-ssl'),
        });
      }
    } catch {
      /* probe optional */
    }
  }

  const notes = findings.filter((f) => !f.ok).map((f) => f.detail);
  return { ok: findings.every((f) => f.ok), findings, notes };
}

/** Execute CTA notes — only mention vsftpd/Dovecot when those findings exist. */
export function leftoverExecuteHints(findings: LeftoverFinding[]): string[] {
  const ids = new Set(findings.filter((f) => !f.ok).map((f) => f.id));
  if (ids.size === 0) return [];
  const out: string[] = [];
  if (ids.has('stale-cli')) out.push(tl('notes.leftover.executeStaleCli'));
  if (ids.has('vsftpd-failed') || ids.has('dovecot-ssl')) {
    out.push(tl('notes.leftover.executeMissingTls'));
  }
  if (out.length === 0) out.push(tl('notes.leftover.executeGeneric'));
  return out;
}
