/**
 * Probe whether this host can resolve its own hostname, and optionally
 * append a 127.0.1.1 line to /etc/hosts (Debian convention).
 *
 * Do not treat FQDN `hermes.ysk.hk` as the short name `hermes` — grep -w does.
 */
import { tl } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { panelBlockMessage, type BlockReason } from '../system-apply.js';

export function hostsLineFor(hostname: string, fqdn?: string): string {
  const short = hostname.trim() || 'localhost';
  const extra = fqdn && fqdn !== short ? ` ${fqdn.trim()}` : '';
  return `127.0.1.1 ${short}${extra}`;
}

/** Reject `hostname -f` error text and other non-name stdout. */
export function sanitizeHostnameToken(raw: string): string {
  const s = String(raw || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(s)) return '';
  return s;
}

/**
 * True only when `hostname` is an exact hosts alias.
 * `127.0.1.1 hermes.ysk.hk` does **not** match short name `hermes`.
 */
export function hostsHasShortAlias(hostsText: string, hostname: string): boolean {
  const want = hostname.trim().toLowerCase();
  if (!want) return false;
  for (const raw of String(hostsText || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    for (const alias of parts.slice(1)) {
      if (alias.toLowerCase() === want) return true;
    }
  }
  return false;
}

async function lookupHostname(host: HostExecutor, name: string): Promise<boolean> {
  if (!name) return false;
  for (const argv of [
    ['getent', 'ahosts', name],
    ['getent', 'hosts', name],
  ] as const) {
    try {
      const r = await host.runCommand([...argv], { timeoutMs: 8_000 });
      if (r.exitCode === 0 && r.stdout.trim()) return true;
    } catch {
      /* try next lookup */
    }
  }
  return false;
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
  const hostname = sanitizeHostnameToken(hn.stdout) || 'localhost';
  const fqdn = sanitizeHostnameToken(fq.stdout);
  const line = hostsLineFor(hostname, fqdn);
  const resolves = await lookupHostname(host, hostname);
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

async function flushHostsCache(host: HostExecutor): Promise<void> {
  try {
    await host.runCommand(
      [
        'bash',
        '-c',
        'nscd -i hosts >/dev/null 2>&1 || resolvectl flush-caches >/dev/null 2>&1 || true',
      ],
      { timeoutMs: 8_000 },
    );
  } catch {
    /* cache flush is best-effort */
  }
}

export async function applyHostnameToHosts(host: HostExecutor): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  blockMessage?: string;
  apply_status?: 'applied' | 'blocked' | 'failed' | 'partial';
  notes: string[];
  line: string;
  resolves: boolean;
  written?: string[];
}> {
  const probe = await probeHostnameResolves(host);
  if (probe.resolves) {
    return {
      ok: true,
      executed: false,
      apply_status: 'applied',
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
      apply_status: 'blocked',
      blockMessage,
      notes: [blockMessage, tl('notes.vnc.hostnameWouldAppend', { line: probe.line })],
      line: probe.line,
      resolves: false,
    };
  }

  let hostsText = '';
  try {
    hostsText = await host.readFile('/etc/hosts');
  } catch {
    hostsText = '';
  }
  const alreadyListed = hostsHasShortAlias(hostsText, probe.hostname);
  const notes: string[] = [];
  let wrote = false;

  if (!alreadyListed) {
    const script = `
set -e
LINE=${JSON.stringify(probe.line)}
printf '%s\\n' "$LINE" >> /etc/hosts
`.trim();
    const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 10_000 });
    if (r.exitCode !== 0) {
      return {
        ok: false,
        executed: true,
        apply_status: 'failed',
        notes: [
          tl('notes.vnc.hostnameAppendFailed', {
            detail: (r.stderr || r.stdout).slice(0, 160),
          }),
        ],
        line: probe.line,
        resolves: false,
      };
    }
    wrote = true;
    notes.push(tl('notes.vnc.hostnameAppended', { line: probe.line }));
  } else {
    notes.push(tl('notes.vnc.hostnameAliasPresent', { hostname: probe.hostname }));
  }

  await flushHostsCache(host);
  const after = await probeHostnameResolves(host);
  if (after.resolves) {
    notes.push(tl('notes.vnc.hostnameResolves', { hostname: probe.hostname }));
    return {
      ok: true,
      executed: wrote,
      apply_status: 'applied',
      notes,
      line: probe.line,
      resolves: true,
      written: wrote ? ['/etc/hosts'] : undefined,
    };
  }

  notes.push(tl('notes.vnc.hostnameStillUnresolvable', { hostname: probe.hostname }));
  return {
    ok: false,
    executed: wrote,
    apply_status: wrote ? 'partial' : 'failed',
    notes,
    line: probe.line,
    resolves: false,
    written: wrote ? ['/etc/hosts'] : undefined,
  };
}
