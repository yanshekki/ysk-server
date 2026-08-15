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
};

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
        });
      }
    } catch {
      /* probe optional */
    }
  }

  const notes = findings.filter((f) => !f.ok).map((f) => f.detail);
  return { ok: findings.every((f) => f.ok), findings, notes };
}
