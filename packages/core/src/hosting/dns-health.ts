/**
 * DNS service health on the panel host — unit, :53 listen, zone files, local dig.
 * Honest: written ≠ reloaded ≠ answering.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { listManagedDnsZones } from './dns-zone.js';

export type DnsHealthTone = 'ok' | 'warn' | 'danger' | 'neutral';

export type DnsHealthDto = {
  ok: boolean;
  /** Best active unit: named | bind9 | pdns | none */
  unit: string;
  unitActive: boolean;
  listenUdp53: boolean;
  listenTcp53: boolean;
  /** Managed zone files under dataDir */
  zoneFiles: number;
  latestZoneWriteAt?: string;
  latestZone?: string;
  /** dig @127.0.0.1 when zone provided or latest zone */
  answeringLocal?: boolean;
  digAnswers?: string[];
  digNotes?: string[];
  /** Panel honesty chips */
  states: {
    service: DnsHealthTone;
    listen: DnsHealthTone;
    written: DnsHealthTone;
    answering: DnsHealthTone;
  };
  notes: string[];
};

async function isUnitActive(host: HostExecutor, unit: string): Promise<boolean> {
  try {
    const r = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
    return (r.stdout || '').trim() === 'active';
  } catch {
    return false;
  }
}

async function portOpen(
  host: HostExecutor,
  proto: 'udp' | 'tcp',
  port: number,
): Promise<boolean> {
  // ss preferred; fall back to /proc
  const cmd =
    proto === 'udp'
      ? `ss -uln 2>/dev/null | grep -E ':${port}\\s' || cat /proc/net/udp /proc/net/udp6 2>/dev/null | head -1`
      : `ss -tln 2>/dev/null | grep -E ':${port}\\s' || cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | head -1`;
  try {
    const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 6_000 });
    const out = (r.stdout || '').trim();
    if (!out) return false;
    // ss line with :53
    if (out.includes(`:${port}`)) return true;
    // /proc hex port 0035 = 53
    if (out.includes('0035')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * dig against local authoritative NS.
 * Tries 127.0.0.1 then public IPv4 (when pdns binds only public after heal).
 */
export async function digLocalAuthoritative(input: {
  host: HostExecutor;
  name: string;
  type?: string;
  server?: string;
}): Promise<{ ok: boolean; answers: string[]; notes: string[]; method: string }> {
  const name = input.name.trim().replace(/\.$/, '');
  const type = (input.type ?? 'SOA').toUpperCase();
  if (!name) {
    return { ok: false, answers: [], notes: ['empty name'], method: 'none' };
  }
  const { resolveBin, shellBinExists } = await import('./software-probe/index.js');
  const digPath = await resolveBin(input.host, 'dig');

  const servers: string[] = [];
  if (input.server?.trim()) servers.push(input.server.trim());
  servers.push('127.0.0.1');
  try {
    const ipr = await input.host.runCommand(
      [
        'bash',
        '-c',
        `ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}'`,
      ],
      { timeoutMs: 4_000 },
    );
    const pub = (ipr.stdout || '').trim();
    if (pub && pub !== '127.0.0.1' && !servers.includes(pub)) servers.push(pub);
  } catch {
    /* */
  }

  let lastNotes: string[] = [];
  for (const server of servers) {
    const at = `@${server}`;
    const argv = digPath
      ? [digPath, at, '+time=2', '+tries=1', '+short', type, name]
      : [
          'bash',
          '-c',
          `if ${shellBinExists('dig')}; then dig ${at} +time=2 +tries=1 +short ${JSON.stringify(type)} ${JSON.stringify(name)} 2>&1; else echo YSK_NO_DIG; fi`,
        ];
    const r = await input.host.runCommand(argv, { timeoutMs: 10_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (out.includes('YSK_NO_DIG')) {
      return { ok: false, answers: [], notes: ['dig not installed'], method: 'none' };
    }
    if (/connection refused|timed out|no servers could be reached/i.test(out)) {
      lastNotes = [
        out.split('\n').find((l) => l.trim())?.slice(0, 200) || `dig ${at} failed`,
      ];
      continue;
    }
    const answers = (r.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith(';') && !l.startsWith(';;'));
    if (answers.length > 0 && r.exitCode === 0) {
      return {
        ok: true,
        answers,
        notes: [`dig ${at} ${type} ${name}`],
        method: 'dig',
      };
    }
    lastNotes = answers.length ? [`empty dig answer from ${at}`] : lastNotes;
  }
  return {
    ok: false,
    answers: [],
    notes: lastNotes.length ? lastNotes : ['dig failed all local servers'],
    method: 'dig',
  };
}

export async function probeDnsServiceHealth(input: {
  dataDir: string;
  host: HostExecutor;
  /** Optional zone name for local dig (defaults to latest managed zone) */
  digName?: string;
}): Promise<DnsHealthDto> {
  const notes: string[] = [];
  const units = ['named', 'bind9', 'pdns'] as const;
  let unit = 'none';
  let unitActive = false;
  for (const u of units) {
    if (await isUnitActive(input.host, u)) {
      unit = u;
      unitActive = true;
      break;
    }
  }
  if (!unitActive) {
    notes.push('No active named/bind9/pdns unit');
    // Diagnose pdns crash-loop vs systemd-resolved :53 conflict
    try {
      const jr = await input.host.runCommand(
        [
          'bash',
          '-c',
          "journalctl -u pdns -n 30 --no-pager 2>/dev/null | grep -iE 'Address already in use|Unable to bind|Fatal error' | tail -5",
        ],
        { timeoutMs: 8_000 },
      );
      const j = (jr.stdout || '').trim();
      if (/Address already in use|Unable to bind/i.test(j)) {
        notes.push(
          'PowerDNS cannot bind 0.0.0.0:53 (EADDRINUSE) — usually conflicts with systemd-resolved on 127.0.0.53:53. Fix: bind public IP only (panel: 修復 PowerDNS) or set local-address=<public-ip>.',
        );
        if (j) notes.push(j.slice(0, 280));
      }
      const failed = await input.host.runCommand(
        ['bash', '-c', 'systemctl is-failed pdns 2>/dev/null; systemctl show pdns -p NRestarts --value 2>/dev/null'],
        { timeoutMs: 5_000 },
      );
      const fr = (failed.stdout || '').trim();
      if (fr.includes('failed') || /^[1-9]/.test(fr.split('\n').pop() || '')) {
        notes.push(`pdns unit state/restarts: ${fr.replace(/\n/g, ' | ').slice(0, 120)}`);
      }
    } catch {
      /* optional */
    }
  }

  const listenUdp53 = await portOpen(input.host, 'udp', 53);
  const listenTcp53 = await portOpen(input.host, 'tcp', 53);
  if (!listenUdp53 && !listenTcp53) notes.push('Port 53 not listening (UDP/TCP)');
  else if (!listenUdp53) notes.push('UDP/53 not listening');
  else if (!listenTcp53) notes.push('TCP/53 not listening');

  const zones = listManagedDnsZones(input.dataDir);
  const zoneFiles = zones.length;
  let latestZoneWriteAt: string | undefined;
  let latestZone: string | undefined;
  for (const z of zones) {
    const at = z.updatedAt;
    if (at && (!latestZoneWriteAt || at > latestZoneWriteAt)) {
      latestZoneWriteAt = at;
      latestZone = z.zone;
    }
  }
  // fallback mtime
  if (!latestZoneWriteAt && zones[0]) {
    try {
      const st = statSync(zones[0].zonePath);
      latestZoneWriteAt = st.mtime.toISOString();
      latestZone = zones[0].zone;
    } catch {
      /* */
    }
  }
  if (zoneFiles === 0) notes.push('No managed zone files under dataDir/dns/zones');

  const digTarget = (input.digName || latestZone || '').trim();
  let answeringLocal: boolean | undefined;
  let digAnswers: string[] | undefined;
  let digNotes: string[] | undefined;
  if (digTarget && (listenUdp53 || unitActive)) {
    const dig = await digLocalAuthoritative({
      host: input.host,
      name: digTarget,
      type: 'SOA',
    });
    answeringLocal = dig.ok;
    digAnswers = dig.answers;
    digNotes = dig.notes;
    if (!dig.ok) notes.push(...(dig.notes ?? []).slice(0, 2));
  } else if (digTarget && !listenUdp53 && !unitActive) {
    answeringLocal = false;
    digNotes = ['skip dig: service not listening'];
  }

  const states: DnsHealthDto['states'] = {
    service: unitActive ? 'ok' : 'danger',
    listen: listenUdp53 || listenTcp53 ? (listenUdp53 && listenTcp53 ? 'ok' : 'warn') : 'danger',
    written: zoneFiles > 0 ? 'ok' : 'warn',
    answering:
      answeringLocal === true ? 'ok' : answeringLocal === false ? 'danger' : 'neutral',
  };

  const ok = unitActive && (listenUdp53 || listenTcp53);

  return {
    ok,
    unit,
    unitActive,
    listenUdp53,
    listenTcp53,
    zoneFiles,
    latestZoneWriteAt,
    latestZone,
    answeringLocal,
    digAnswers,
    digNotes,
    states,
    notes,
  };
}

/** Read latest apply meta if present (optional future). */
export function readLatestZoneMeta(dataDir: string): {
  zone?: string;
  updatedAt?: string;
  serial?: number;
} | null {
  const dir = join(dataDir, 'dns', 'zones');
  if (!existsSync(dir)) return null;
  const metas = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let best: { zone?: string; updatedAt?: string; serial?: number } | null = null;
  for (const f of metas) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        zone?: string;
        updatedAt?: string;
        serial?: number;
      };
      if (!best || (j.updatedAt && (!best.updatedAt || j.updatedAt > best.updatedAt))) {
        best = j;
      }
    } catch {
      /* */
    }
  }
  return best;
}
