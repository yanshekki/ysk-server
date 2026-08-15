/**
 * DNS service health on the panel host — unit, :53 listen, zone files, local dig.
 * Honest: written ≠ reloaded ≠ answering.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from 'ysk-server-shared';
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
  /** Zones reported by pdns_control list-zones (when available) */
  pdnsZoneCount?: number;
  pdnsZones?: string[];
  latestZoneWriteAt?: string;
  latestZone?: string;
  /** dig @local when zone provided or latest zone */
  answeringLocal?: boolean;
  digAnswers?: string[];
  digNotes?: string[];
  /** Sample A dig (www / ns1 / apex) when local SOA ok or as extra check */
  answeringLocalA?: boolean;
  digAName?: string;
  digAAnswers?: string[];
  /** Public NS for zone via dig @8.8.8.8 NS (honest: public may still be Cloudflare) */
  publicNs?: string[];
  publicNsNotes?: string[];
  /** true if public NS hostnames look like this host (ns1.<zone>) — weak heuristic */
  publicNsPointsHere?: boolean;
  /** Panel honesty chips */
  states: {
    service: DnsHealthTone;
    listen: DnsHealthTone;
    written: DnsHealthTone;
    /** PowerDNS list-zones vs disk zone files */
    loaded: DnsHealthTone;
    answering: DnsHealthTone;
    publicNs: DnsHealthTone;
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
): Promise<{ any: boolean; public: boolean; loopbackOnly: boolean; sample: string }> {
  const cmd =
    proto === 'udp'
      ? `ss -ulnH 2>/dev/null | grep -E ':${port}\\s' || true`
      : `ss -tlnH 2>/dev/null | grep -E ':${port}\\s' || true`;
  try {
    const r = await host.runCommand(['bash', '-c', cmd], { timeoutMs: 6_000 });
    const out = (r.stdout || '').trim();
    if (!out || !out.includes(`:${port}`)) {
      return { any: false, public: false, loopbackOnly: false, sample: '' };
    }
    const lines = out.split('\n').filter((l) => l.includes(`:${port}`));
    const loopback = lines.every((l) =>
      /127\.0\.0\.|::1|\[::1\]/.test(l),
    );
    return {
      any: true,
      public: !loopback,
      loopbackOnly: loopback,
      sample: lines[0]?.slice(0, 120) ?? '',
    };
  } catch {
    return { any: false, public: false, loopbackOnly: false, sample: '' };
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

    // Empty +short: check status (REFUSED = zone not loaded into PowerDNS)
    const statusArgv = digPath
      ? [digPath, at, '+time=2', '+tries=1', '+noall', '+comments', type, name]
      : [
          'bash',
          '-c',
          `if ${shellBinExists('dig')}; then dig ${at} +time=2 +tries=1 +noall +comments ${JSON.stringify(type)} ${JSON.stringify(name)} 2>&1; else true; fi`,
        ];
    const st = await input.host.runCommand(statusArgv, { timeoutMs: 8_000 });
    const stOut = `${st.stdout || ''}\n${st.stderr || ''}`;
    if (/status:\s*REFUSED/i.test(stOut)) {
      lastNotes = [
        `dig ${at} status: REFUSED — PowerDNS is up but zone not loaded (named.conf / rediscover). Apply zone or powerdns/load.`,
      ];
      // Keep trying other servers in case only one path refuses
      continue;
    }
    if (/status:\s*NXDOMAIN/i.test(stOut)) {
      lastNotes = [`dig ${at} status: NXDOMAIN`];
      continue;
    }
    lastNotes = answers.length
      ? [`empty dig answer from ${at}`]
      : lastNotes.length
        ? lastNotes
        : [`empty dig answer from ${at}`];
  }
  return {
    ok: false,
    answers: [],
    notes: lastNotes.length ? lastNotes : ['dig failed all local servers'],
    method: 'dig',
  };
}

/**
 * Build FQDNs to probe for local A answers — generic, not business hostnames.
 * Prefer apex + www + optional relative A names from managed zone meta/records.
 */
export function buildLocalAProbeNames(
  zone: string,
  relativeANames?: string[],
  max = 4,
): string[] {
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  if (!z) return [];
  const out: string[] = [];
  const push = (fqdn: string) => {
    const n = fqdn.trim().toLowerCase().replace(/\.$/, '');
    if (n && !out.includes(n)) out.push(n);
  };
  push(z);
  push(`www.${z}`);
  for (const rel of relativeANames ?? []) {
    const r = String(rel ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!r || r === '@') {
      push(z);
      continue;
    }
    // relative label → zone; already-absolute under zone kept as-is
    if (r === z || r.endsWith(`.${z}`)) push(r);
    else if (!r.includes('.')) push(`${r}.${z}`);
    else push(r); // other FQDN left absolute (operator data)
    if (out.length >= max) break;
  }
  push(`ns1.${z}`);
  return out.slice(0, max);
}

/** Whether public NS hostnames look like in-zone nameservers (ns1.zone / *.zone). */
export function publicNsLooksInZone(zone: string, nsList: string[]): boolean {
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  if (!z) return false;
  return nsList.some((raw) => {
    const n = raw.trim().toLowerCase().replace(/\.$/, '');
    return n === `ns1.${z}` || n === `ns2.${z}` || n.endsWith(`.${z}`);
  });
}

export async function probeDnsServiceHealth(input: {
  dataDir: string;
  host: HostExecutor;
  /** Optional zone name for local dig (defaults to latest managed zone) */
  digName?: string;
  /** Override public NS dig resolver (default 8.8.8.8 or YSK_DNS_PUBLIC_RESOLVER) */
  publicResolver?: string;
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
        notes.push(tl('notes.ops.pdnsBindConflict'));
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

  const udp53 = await portOpen(input.host, 'udp', 53);
  const tcp53 = await portOpen(input.host, 'tcp', 53);
  const listenUdp53 = udp53.public;
  const listenTcp53 = tcp53.public;
  if (udp53.loopbackOnly || tcp53.loopbackOnly) {
    notes.push(
      'Port 53 is only on loopback (systemd-resolved 127.0.0.53) — not a product authoritative nameserver',
    );
  }
  if (!udp53.any && !tcp53.any) notes.push('Port 53 not listening (UDP/TCP)');
  else if (!listenUdp53 && !udp53.loopbackOnly) notes.push('UDP/53 not listening on a public address');
  else if (!listenTcp53 && !tcp53.loopbackOnly) notes.push('TCP/53 not listening on a public address');

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

  // PowerDNS loaded zone count (honest: disk files ≠ list-zones)
  let pdnsZoneCount: number | undefined;
  let pdnsZones: string[] | undefined;
  if (unit === 'pdns' && unitActive) {
    try {
      const lz = await input.host.runCommand(
        [
          'bash',
          '-c',
          'if command -v pdns_control >/dev/null 2>&1; then pdns_control list-zones 2>/dev/null; else echo YSK_NO_PDNS_CTL; fi',
        ],
        { timeoutMs: 6_000 },
      );
      const raw = (lz.stdout || '').trim();
      if (!raw.includes('YSK_NO_PDNS_CTL')) {
        const { parsePdnsListZonesOutput } = await import('./powerdns-apply.js');
        // parse without markers: inject markers
        pdnsZones = parsePdnsListZonesOutput(
          `YSK_PDNS_LIST_ZONES_BEGIN\n${raw}\nYSK_PDNS_LIST_ZONES_END`,
        );
        pdnsZoneCount = pdnsZones.length;
        if (zoneFiles > 0 && pdnsZoneCount === 0) {
          notes.push(tl('notes.dns.zeroDomainsHint'));
        } else if (pdnsZoneCount != null) {
          notes.push(`PowerDNS list-zones: ${pdnsZoneCount}`);
        }
      }
    } catch {
      /* optional */
    }
  }

  const digTarget = (input.digName || latestZone || '').trim();
  let answeringLocal: boolean | undefined;
  let digAnswers: string[] | undefined;
  let digNotes: string[] | undefined;
  let answeringLocalA: boolean | undefined;
  let digAName: string | undefined;
  let digAAnswers: string[] | undefined;
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

    // Local A probe: apex/www + relative names from managed zone meta (no hard-coded business hosts)
    let relA: string[] | undefined;
    try {
      const metaPath = join(input.dataDir, 'dns', 'zones', `${digTarget}.json`);
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          records?: Array<{ type?: string; name?: string }>;
        };
        relA = (meta.records ?? [])
          .filter((r) => String(r.type ?? '').toUpperCase() === 'A')
          .map((r) => String(r.name ?? '@'))
          .slice(0, 5);
      }
    } catch {
      /* optional */
    }
    const aCandidates = buildLocalAProbeNames(digTarget, relA);
    for (const aName of aCandidates) {
      const aDig = await digLocalAuthoritative({
        host: input.host,
        name: aName,
        type: 'A',
      });
      if (aDig.ok && aDig.answers.length > 0) {
        answeringLocalA = true;
        digAName = aName;
        digAAnswers = aDig.answers;
        notes.push(`local A ${aName} → ${aDig.answers[0]}`);
        break;
      }
      if (answeringLocalA == null) {
        answeringLocalA = false;
        digAName = aName;
        digAAnswers = [];
      }
    }
    if (answeringLocalA === false) {
      notes.push(tl('notes.dns.localAFailed', { zone: digTarget }));
    }
  } else if (digTarget && !listenUdp53 && !unitActive) {
    answeringLocal = false;
    digNotes = ['skip dig: service not listening'];
  }

  // Public NS via configurable resolver — do not pretend local zone is worldwide
  let publicNs: string[] | undefined;
  let publicNsNotes: string[] | undefined;
  let publicNsPointsHere: boolean | undefined;
  if (digTarget) {
    const pub = await digPublicNs({
      host: input.host,
      zone: digTarget,
      publicResolver: input.publicResolver,
    });
    publicNs = pub.ns;
    publicNsNotes = pub.notes;
    publicNsPointsHere = pub.pointsHere;
    notes.push(...pub.notes.slice(0, 2));
  }

  const loadedTone: DnsHealthTone =
    pdnsZoneCount == null
      ? zoneFiles > 0
        ? 'neutral'
        : 'warn'
      : pdnsZoneCount === 0 && zoneFiles > 0
        ? 'danger'
        : pdnsZoneCount > 0
          ? 'ok'
          : 'warn';

  const publicNsTone: DnsHealthTone =
    publicNs == null
      ? 'neutral'
      : publicNs.length === 0
        ? 'warn'
        : publicNsPointsHere === true
          ? 'ok'
          : 'warn';

  const states: DnsHealthDto['states'] = {
    service: unitActive ? 'ok' : 'danger',
    listen: listenUdp53 || listenTcp53 ? (listenUdp53 && listenTcp53 ? 'ok' : 'warn') : 'danger',
    written: zoneFiles > 0 ? 'ok' : 'warn',
    loaded: loadedTone,
    answering:
      answeringLocal === true || answeringLocalA === true
        ? 'ok'
        : answeringLocal === false
          ? 'danger'
          : 'neutral',
    publicNs: publicNsTone,
  };

  // ok = local authority useful (not public NS). Public CF is a separate warn chip.
  const listenOk = listenUdp53 || listenTcp53;
  const zonesHealthy =
    zoneFiles === 0 ||
    answeringLocal === true ||
    answeringLocalA === true ||
    (pdnsZoneCount != null && pdnsZoneCount > 0 && answeringLocal !== false);
  const ok = unitActive && listenOk && zonesHealthy;

  return {
    ok,
    unit,
    unitActive,
    listenUdp53,
    listenTcp53,
    zoneFiles,
    pdnsZoneCount,
    pdnsZones,
    latestZoneWriteAt,
    latestZone,
    answeringLocal,
    digAnswers,
    digNotes,
    answeringLocalA,
    digAName,
    digAAnswers,
    publicNs,
    publicNsNotes,
    publicNsPointsHere,
    states,
    notes,
  };
}

/**
 * dig public NS for zone — honest delegation view (any domain).
 * Resolver: input.publicResolver → env YSK_DNS_PUBLIC_RESOLVER → 8.8.8.8
 * pointsHere: only in-zone nameserver names (ns1.zone / *.zone), never product branding.
 */
export async function digPublicNs(input: {
  host: HostExecutor;
  zone: string;
  publicResolver?: string;
}): Promise<{ ns: string[]; notes: string[]; pointsHere?: boolean; resolver: string }> {
  const zone = input.zone.trim().toLowerCase().replace(/\.$/, '');
  const resolver =
    (input.publicResolver || process.env.YSK_DNS_PUBLIC_RESOLVER || '8.8.8.8').trim() ||
    '8.8.8.8';
  if (!zone) return { ns: [], notes: ['empty zone for public NS dig'], resolver };
  const { resolveBin, shellBinExists } = await import('./software-probe/index.js');
  const digPath = await resolveBin(input.host, 'dig');
  const at = `@${resolver}`;
  const argv = digPath
    ? [digPath, at, '+time=2', '+tries=1', '+short', 'NS', zone]
    : [
        'bash',
        '-c',
        `if ${shellBinExists('dig')}; then dig ${at} +time=2 +tries=1 +short NS ${JSON.stringify(zone)} 2>&1; else echo YSK_NO_DIG; fi`,
      ];
  try {
    const r = await input.host.runCommand(argv, { timeoutMs: 8_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (out.includes('YSK_NO_DIG')) {
      return { ns: [], notes: ['dig not installed — skip public NS check'], resolver };
    }
    if (/connection refused|timed out|no servers could be reached/i.test(out)) {
      return { ns: [], notes: [`public dig ${at} failed (network)`], resolver };
    }
    const ns = (r.stdout || '')
      .split('\n')
      .map((l) => l.trim().replace(/\.$/, '').toLowerCase())
      .filter((l) => l && !l.startsWith(';') && /^[a-z0-9._-]+$/.test(l));
    if (ns.length === 0) {
      return { ns: [], notes: [`no public NS for ${zone} via ${resolver}`], resolver };
    }
    const pointsHere = publicNsLooksInZone(zone, ns);
    // Third-party CDN/DNS brands (generic patterns only — no customer-specific NS names)
    const thirdParty = ns.some((n) =>
      /cloudflare|awsdns|azure-dns|domaincontrol|googledomains|ultradns|dnsimple|route53/i.test(n),
    );
    const notes = [
      `public NS (${zone}) via ${resolver}: ${ns.join(', ')}`,
      pointsHere
        ? tl('notes.dns.publicNsHere')
        : thirdParty
          ? tl('notes.dns.publicNsCloudflare')
          : tl('notes.dns.publicNsOther'),
    ];
    return { ns, notes, pointsHere, resolver };
  } catch (e) {
    return {
      ns: [],
      notes: [`public NS dig error: ${e instanceof Error ? e.message : String(e)}`],
      resolver,
    };
  }
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
