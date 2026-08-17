/**
 * Probe whether this host can resolve its own hostname, and optionally
 * append a 127.0.1.1 line to /etc/hosts (Debian convention).
 */
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { panelBlockMessage, type BlockReason } from '../system-apply.js';

export function hostsLineFor(hostname: string, fqdn?: string): string {
  const short = hostname.trim() || 'localhost';
  const extra = fqdn && fqdn !== short ? ` ${fqdn.trim()}` : '';
  return `127.0.1.1 ${short}${extra}`;
}

export async function probeHostnameResolves(host: HostExecutor): Promise<{
  hostname: string;
  fqdn: string;
  resolves: boolean;
  line: string;
  notes: string[];
}> {
  const hn = await host.runCommand(['hostname', '-s'], { timeoutMs: 8_000 });
  const fq = await host.runCommand(['hostname', '-f'], { timeoutMs: 8_000 });
  const hostname = (hn.stdout || '').trim() || 'localhost';
  const fqdn = (fq.stdout || '').trim();
  const line = hostsLineFor(hostname, fqdn);
  const check = await host.runCommand(['getent', 'hosts', hostname], { timeoutMs: 8_000 });
  const resolves = check.exitCode === 0 && Boolean(check.stdout.trim());
  return {
    hostname,
    fqdn,
    resolves,
    line,
    notes: resolves
      ? [tl('notes.vnc.hostnameResolves', { hostname })]
      : [tl('notes.vnc.hostnameUnresolvable', { hostname })],
  };
}

export async function applyHostnameToHosts(host: HostExecutor): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
  line: string;
  resolves: boolean;
}> {
  const probe = await probeHostnameResolves(host);
  if (probe.resolves) {
    return {
      ok: true,
      executed: false,
      notes: [tl('notes.vnc.hostnameAlreadyResolves', { hostname: probe.hostname })],
      line: probe.line,
      resolves: true,
    };
  }
  const can = host.executeEnabled() && host.isRoot();
  if (!can) {
    const reason: BlockReason = !host.executeEnabled() ? 'no_execute' : 'no_root';
    const blockMessage = panelBlockMessage(reason);
    return {
      ok: false,
      executed: false,
      blocked: true,
      blockMessage,
      notes: [blockMessage, tl('notes.vnc.hostnameWouldAppend', { line: probe.line })],
      line: probe.line,
      resolves: false,
    };
  }
  const script = `
set -e
LINE=${JSON.stringify(probe.line)}
HOST=${JSON.stringify(probe.hostname)}
if grep -Fqw "$HOST" /etc/hosts; then
  exit 0
fi
printf '%s\\n' "$LINE" >> /etc/hosts
`.trim();
  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
  const after = await probeHostnameResolves(host);
  const ok = r.exitCode === 0 && after.resolves;
  return {
    ok,
    executed: true,
    notes: [
      ...(r.exitCode === 0
        ? [tl('notes.vnc.hostnameAppended', { line: probe.line })]
        : [tl('notes.vnc.hostnameAppendFailed', { detail: (r.stderr || r.stdout).slice(0, 160) })]),
      ...after.notes,
    ],
    line: probe.line,
    resolves: after.resolves,
  };
}
