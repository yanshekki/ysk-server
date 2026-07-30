import { tl } from '@ysk/shared';
/**
 * Unified host overview for System → 主機 tab (read-mostly, fail-soft).
 */

import {
  cpus,
  freemem,
  loadavg,
  networkInterfaces,
  totalmem,
  uptime,
  hostname,
  platform,
  arch,
  release,
} from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostOverviewDto } from '@ysk/shared';
import type { HostExecutor } from './executor.js';

export type HostOverview = HostOverviewDto;
export type HostDiskRow = HostOverviewDto['disks'][number];

function parseTimedatectlShow(stdout: string): {
  timezone: string | null;
  ntpEnabled: boolean | null;
  ntpSynchronized: boolean | null;
} {
  const map = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    map.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const bool = (k: string): boolean | null => {
    const v = map.get(k);
    if (v === 'yes' || v === 'true' || v === '1') return true;
    if (v === 'no' || v === 'false' || v === '0') return false;
    return null;
  };
  return {
    timezone: map.get('Timezone') || null,
    ntpEnabled: bool('NTP') ?? bool('NetworkTimeProtocol'),
    ntpSynchronized: bool('NTPSynchronized'),
  };
}

function parseDf(stdout: string): HostDiskRow[] {
  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const rows: HostDiskRow[] = [];
  // df -hT: Filesystem Type Size Used Avail Use% Mounted on
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const mount = parts.slice(6).join(' ');
    // skip special/virtual common noise
    if (
      mount.startsWith('/snap') ||
      mount.startsWith('/run') ||
      mount.startsWith('/dev') ||
      mount.startsWith('/sys') ||
      mount.startsWith('/proc') ||
      mount === '/boot/efi' && parts[1] === 'vfat'
    ) {
      // keep /boot/efi optionally — skip tiny noise mounts
    }
    if (
      parts[1] === 'tmpfs' ||
      parts[1] === 'devtmpfs' ||
      parts[1] === 'squashfs' ||
      parts[1] === 'overlay'
    ) {
      continue;
    }
    const useRaw = parts[5]?.replace('%', '');
    const usePct = useRaw && /^\d+$/.test(useRaw) ? Number(useRaw) : null;
    rows.push({
      filesystem: parts[0],
      type: parts[1],
      size: parts[2],
      used: parts[3],
      avail: parts[4],
      usePct,
      mount,
    });
  }
  return rows.slice(0, 24);
}

function readResolvers(): string[] {
  try {
    if (!existsSync('/etc/resolv.conf')) return [];
    const text = readFileSync('/etc/resolv.conf', 'utf8');
    const out: string[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*nameserver\s+(\S+)/i);
      if (m) out.push(m[1]);
    }
    return out;
  } catch {
    return [];
  }
}

function readPendingShutdown(): HostOverview['power']['pending'] {
  // systemd: /run/systemd/shutdown/scheduled exists when pending
  try {
    const dir = '/run/systemd/shutdown';
    if (existsSync(join(dir, 'scheduled'))) {
      const raw = readFileSync(join(dir, 'scheduled'), 'utf8').trim();
      let actionHint: string | null = null;
      if (/USEC/i.test(raw) || raw) {
        // also check mode file
        const modePath = join(dir, 'mode');
        if (existsSync(modePath)) {
          actionHint = readFileSync(modePath, 'utf8').trim() || null;
        }
      }
      return { raw: raw.slice(0, 200), actionHint };
    }
    // older: /run/nologin or wall
  } catch {
    /* */
  }
  return null;
}

function collectInterfaces(): Array<{ name: string; addrs: string[] }> {
  const ni = networkInterfaces();
  const out: Array<{ name: string; addrs: string[] }> = [];
  for (const [name, list] of Object.entries(ni)) {
    if (!list?.length) continue;
    if (name === 'lo' || name.startsWith('docker') || name.startsWith('veth')) continue;
    const addrs = list
      .filter((a) => a.family === 'IPv4' || a.family === 'IPv6')
      .map((a) => a.address)
      .filter(Boolean);
    if (addrs.length) out.push({ name, addrs });
  }
  return out;
}

function ipsFromInterfaces(ifaces: Array<{ name: string; addrs: string[] }>): string[] {
  const ips: string[] = [];
  for (const iface of ifaces) {
    for (const a of iface.addrs) {
      if (!ips.includes(a)) ips.push(a);
    }
  }
  return ips;
}

export async function collectHostOverview(host: HostExecutor): Promise<HostOverview> {
  const executeEnabled = host.executeEnabled();
  const isRoot = host.isRoot();
  const memTotal = totalmem();
  const memFree = freemem();

  let hostnameVal: string | null = hostname() || null;
  let prettyHostname: string | null = null;
  let timezone: string | null = null;
  let ntpEnabled: boolean | null = null;
  let ntpSynchronized: boolean | null = null;
  let kernel: string | null = release() || null;
  let defaultTarget: string | null = null;
  let disks: HostDiskRow[] = [];
  let timeSource: string | null = null;

  // hostname / pretty
  try {
    const hn = await host.runCommand(['hostname'], { timeoutMs: 3_000 });
    if (hn.exitCode === 0 && hn.stdout.trim()) hostnameVal = hn.stdout.trim();
  } catch {
    /* */
  }
  try {
    const ph = await host.runCommand(
      ['hostnamectl', 'show', '-p', 'PrettyHostname', '--value'],
      { timeoutMs: 5_000 },
    );
    if (ph.exitCode === 0 && ph.stdout.trim()) prettyHostname = ph.stdout.trim();
  } catch {
    /* */
  }

  // timedatectl
  try {
    const td = await host.runCommand(
      ['timedatectl', 'show', '-p', 'Timezone', '-p', 'NTP', '-p', 'NTPSynchronized', '-p', 'TimeUSec'],
      { timeoutMs: 5_000 },
    );
    if (td.exitCode === 0) {
      const p = parseTimedatectlShow(td.stdout);
      timezone = p.timezone;
      ntpEnabled = p.ntpEnabled;
      ntpSynchronized = p.ntpSynchronized;
    }
  } catch {
    /* */
  }
  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      /* */
    }
  }

  // kernel uname
  try {
    const u = await host.runCommand(['uname', '-r'], { timeoutMs: 3_000 });
    if (u.exitCode === 0 && u.stdout.trim()) kernel = u.stdout.trim();
  } catch {
    /* */
  }

  // default target
  try {
    const t = await host.runCommand(['systemctl', 'get-default'], { timeoutMs: 5_000 });
    if (t.exitCode === 0 && t.stdout.trim()) defaultTarget = t.stdout.trim();
  } catch {
    /* */
  }

  // disks
  try {
    const df = await host.runCommand(['df', '-hT', '-x', 'tmpfs', '-x', 'devtmpfs'], {
      timeoutMs: 8_000,
    });
    if (df.exitCode === 0) disks = parseDf(df.stdout);
  } catch {
    /* */
  }

  // NTP status text (optional)
  try {
    const st = await host.runCommand(['timedatectl', 'status'], { timeoutMs: 5_000 });
    if (st.exitCode === 0) {
      const m = st.stdout.match(/System clock synchronized:\s*(\w+)/i);
      if (m && ntpSynchronized == null) {
        ntpSynchronized = /^yes$/i.test(m[1]);
      }
      const n = st.stdout.match(/NTP service:\s*(.+)/i);
      if (n) timeSource = n[1].trim();
    }
  } catch {
    /* */
  }

  const ifaces = collectInterfaces();
  let ips = ipsFromInterfaces(ifaces);
  if (!ips.length) {
    try {
      const ipR = await host.runCommand(
        ['bash', '-c', "hostname -I 2>/dev/null || true"],
        { timeoutMs: 5_000 },
      );
      if (ipR.exitCode === 0) {
        ips = ipR.stdout
          .trim()
          .split(/\s+/)
          .filter(Boolean);
      }
    } catch {
      /* */
    }
  }

  const now = new Date();
  let local = now.toISOString();
  try {
    local = now.toLocaleString('zh-TW', { timeZone: timezone || undefined });
  } catch {
    local = now.toString();
  }

  return {
    identity: {
      hostname: hostnameVal,
      prettyHostname,
      timezone,
    },
    os: {
      platform: platform(),
      arch: arch(),
      release: release(),
      kernel,
    },
    runtime: {
      uptimeSec: uptime(),
      loadavg: loadavg(),
      cpus: cpus().length,
      memory: {
        total: memTotal,
        free: memFree,
        usedRatio: memTotal > 0 ? 1 - memFree / memTotal : 0,
      },
      node: process.version,
      pid: process.pid,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
    },
    time: {
      utc: now.toISOString(),
      local,
      ntpEnabled,
      ntpSynchronized,
      timeSource,
    },
    network: {
      ips,
      interfaces: ifaces,
      resolvers: readResolvers(),
    },
    disks,
    power: {
      pending: readPendingShutdown(),
    },
    boot: {
      defaultTarget,
    },
    caps: {
      executeEnabled,
      isRoot,
      canPower: executeEnabled && isRoot,
      canIdentity: executeEnabled && isRoot,
    },
    collectedAt: now.toISOString(),
  };
}

export async function enableHostNtp(host: HostExecutor): Promise<{
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  notes: string[];
}> {
  const notes: string[] = [];
  if (!host.executeEnabled() || !host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n1151'),
      notes: [tl('ops.blocked.needExecuteRoot')],
    };
  }
  const r = await host.runCommand(['timedatectl', 'set-ntp', 'true'], { timeoutMs: 15_000 });
  if (r.exitCode === 0) {
    notes.push(tl('notes.auto.n0746'));
    return { ok: true, notes };
  }
  notes.push(tl('notes.tpl.ntpEnableFailed', { detail: (r.stderr || r.stdout || '').trim() || `exit ${r.exitCode}` }));
  return { ok: false, notes };
}

/** Pure helpers exported for unit tests */
export const _hostOverviewTest = {
  parseTimedatectlShow,
  parseDf,
  readResolvers,
  readPendingShutdown,
};
