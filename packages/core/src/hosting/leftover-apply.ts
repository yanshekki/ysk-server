/**
 * Explicit leftover repair (--execute). Overlay never does this.
 */
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { probeHostLeftovers, staleNpmGlobalCliPaths, type LeftoverFinding } from './leftover-probe.js';

export type LeftoverApplyResult = {
  ok: boolean;
  executed: boolean;
  dryRun: boolean;
  blocked?: boolean;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  findings: LeftoverFinding[];
  notes: string[];
};

export async function applyHostLeftovers(input: {
  host: HostExecutor;
  currentVersion?: string;
  execute?: boolean;
}): Promise<LeftoverApplyResult> {
  const want = input.execute === true;
  const probe = await probeHostLeftovers({
    host: input.host,
    currentVersion: input.currentVersion,
  });
  const notes = [...probe.notes];
  if (!want) {
    notes.push(tl('notes.leftover.overlayDoesNotHeal'));
    return {
      ok: probe.ok,
      executed: false,
      dryRun: true,
      findings: probe.findings,
      notes,
      requiresExecute: true,
      requiresRoot: true,
    };
  }
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push(tl('notes.leftover.overlayDoesNotHeal'));
    return {
      ok: false,
      executed: false,
      dryRun: false,
      blocked: true,
      requiresExecute: !input.host.executeEnabled(),
      requiresRoot: !input.host.isRoot(),
      findings: probe.findings,
      notes,
    };
  }

  for (const p of staleNpmGlobalCliPaths()) {
    if (!input.host.pathExists(p)) continue;
    const rm = await input.host.runCommand(['rm', '-f', p], { timeoutMs: 10_000 });
    notes.push(
      rm.exitCode === 0
        ? tl('notes.leftover.staleCliRemoved', { path: p })
        : tl('notes.leftover.staleCliRemoveFailed', { path: p, detail: (rm.stderr || rm.stdout).slice(0, 160) }),
    );
  }

  if (input.host.pathExists('/etc/vsftpd.conf')) {
    try {
      const body = await input.host.readFile('/etc/vsftpd.conf');
      const cert = body.match(/rsa_cert_file=(.+)/)?.[1]?.trim();
      const sslOn = /^\s*ssl_enable=YES/m.test(body);
      if (sslOn && cert && !input.host.pathExists(cert)) {
        const next = body.replace(/^\s*ssl_enable=YES/m, 'ssl_enable=NO');
        await input.host.writeFile('/etc/vsftpd.conf', next);
        await input.host.runCommand(['systemctl', 'restart', 'vsftpd'], { timeoutMs: 20_000 });
        notes.push(tl('notes.leftover.vsftpdSslOff'));
      }
    } catch (e) {
      notes.push(String(e instanceof Error ? e.message : e).slice(0, 160));
    }
  }

  const doveTls = '/etc/dovecot/conf.d/99-ysk-mail-tls.conf';
  if (input.host.pathExists(doveTls)) {
    try {
      const body = await input.host.readFile(doveTls);
      const cert = body.match(/ssl_cert\s*=\s*<(\S+)/)?.[1];
      if (cert && !input.host.pathExists(cert)) {
        const next = `${body.replace(/^\s*ssl\s*=\s*\S+/m, 'ssl = no')}\n# YSK leftover: missing ${cert}\n`;
        await input.host.writeFile(doveTls, next);
        await input.host.runCommand(['systemctl', 'restart', 'dovecot'], { timeoutMs: 20_000 });
        notes.push(tl('notes.leftover.dovecotSslOff', { path: cert }));
      }
    } catch (e) {
      notes.push(String(e instanceof Error ? e.message : e).slice(0, 160));
    }
  }

  const after = await probeHostLeftovers({
    host: input.host,
    currentVersion: input.currentVersion,
  });
  return {
    ok: after.ok,
    executed: true,
    dryRun: false,
    findings: after.findings,
    notes: [...notes, ...after.notes.filter((n) => !notes.includes(n))],
  };
}
