/**
 * L2: country allowlist for service exposure (ipset best-effort).
 * Zone files: dataDir/geoip/country-zones/{cc}.zone (ipdeny-style one CIDR per line).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tl } from '@ysk-server/shared';
import type { HostExecutor } from '../../host/executor.js';
import { sanitizeSvcToken } from '@ysk-server/shared';

const MAX_COUNTRIES = 32;
const MAX_CIDRS_PER_COUNTRY = 4000;
const MAX_TOTAL_CIDRS = 12_000;

export function normalizeCountries(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const cc = String(item ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc) || seen.has(cc)) continue;
    seen.add(cc);
    out.push(cc);
    if (out.length >= MAX_COUNTRIES) break;
  }
  return out;
}

export function countryZonesDir(dataDir: string): string {
  return join(dataDir, 'geoip', 'country-zones');
}

export function countryZonePath(dataDir: string, cc: string): string {
  return join(countryZonesDir(dataDir), `${cc.toLowerCase()}.zone`);
}

/** Read CIDRs from a zone file (skip comments/empty). */
export function readCountryZoneCidrs(dataDir: string, cc: string): string[] {
  const path = countryZonePath(dataDir, cc);
  if (!existsSync(path)) return [];
  try {
    const body = readFileSync(path, 'utf8');
    const out: string[] = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      // basic IPv4/IPv6 CIDR or bare IP
      if (!/^[\da-fA-F:.\/]+$/.test(t)) continue;
      out.push(t);
      if (out.length >= MAX_CIDRS_PER_COUNTRY) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Best-effort download of a country zone (ipdeny aggregate).
 * Fail-soft: returns notes, never throws.
 */
export async function ensureCountryZoneFile(
  dataDir: string,
  cc: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; path?: string; notes: string[]; cidrCount: number }> {
  const notes: string[] = [];
  const code = cc.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) {
    return { ok: false, notes: [tl('notes.serviceExposure.badCountry', { cc })], cidrCount: 0 };
  }
  const dir = countryZonesDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const path = countryZonePath(dataDir, code);
  const existing = readCountryZoneCidrs(dataDir, code);
  if (existing.length > 0) {
    return { ok: true, path, notes: [], cidrCount: existing.length };
  }
  const url = `https://www.ipdeny.com/ipblocks/data/aggregated/${code}-aggregated.zone`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    const res = await fetchImpl(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) {
      notes.push(
        tl('notes.serviceExposure.zoneDownloadFail', {
          cc: code.toUpperCase(),
          detail: String(res.status),
        }),
      );
      return { ok: false, notes, cidrCount: 0 };
    }
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && /^[\da-fA-F:.\/]+$/.test(l))
      .slice(0, MAX_CIDRS_PER_COUNTRY);
    if (!lines.length) {
      notes.push(tl('notes.serviceExposure.zoneEmpty', { cc: code.toUpperCase() }));
      return { ok: false, notes, cidrCount: 0 };
    }
    writeFileSync(path, `# ysk country zone ${code}\n${lines.join('\n')}\n`, 'utf8');
    notes.push(
      tl('notes.serviceExposure.zoneDownloaded', {
        cc: code.toUpperCase(),
        n: lines.length,
      }),
    );
    return { ok: true, path, notes, cidrCount: lines.length };
  } catch (e) {
    notes.push(
      tl('notes.serviceExposure.zoneDownloadFail', {
        cc: code.toUpperCase(),
        detail: e instanceof Error ? e.message.slice(0, 120) : 'fetch failed',
      }),
    );
    return { ok: false, notes, cidrCount: 0 };
  }
}

export function ipsetNameForService(serviceId: string): string {
  const id = sanitizeSvcToken(serviceId).replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  return `yskgeo_${id || 'svc'}`;
}

/**
 * Rebuild ipset for service country allowlist and install INPUT accept for listed ports.
 * Best-effort: requires root + EXECUTE + ipset binary.
 */
export async function applyCountryIpsetAllow(input: {
  host: HostExecutor;
  dataDir: string;
  serviceId: string;
  countries: string[];
  /** e.g. [{ port: '80', proto: 'tcp' }, ...] */
  ports: Array<{ port: string; proto: 'tcp' | 'udp' }>;
  /** download missing zones */
  fetchZones?: boolean;
}): Promise<{ ok: boolean; notes: string[]; blocked?: boolean; setName?: string }> {
  const notes: string[] = [];
  const countries = normalizeCountries(input.countries);
  if (!countries.length) {
    return { ok: true, notes: [] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: [tl('notes.serviceExposure.geoNeedExecute')],
    };
  }
  if (!input.host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      notes: [tl('notes.serviceExposure.geoNeedRoot')],
    };
  }

  // Collect CIDRs
  let allCidrs: string[] = [];
  for (const cc of countries) {
    if (input.fetchZones !== false) {
      const dl = await ensureCountryZoneFile(input.dataDir, cc);
      notes.push(...dl.notes.slice(0, 2));
    }
    const cidrs = readCountryZoneCidrs(input.dataDir, cc);
    if (!cidrs.length) {
      notes.push(tl('notes.serviceExposure.zoneMissing', { cc }));
      continue;
    }
    allCidrs = allCidrs.concat(cidrs);
    if (allCidrs.length >= MAX_TOTAL_CIDRS) {
      allCidrs = allCidrs.slice(0, MAX_TOTAL_CIDRS);
      notes.push(tl('notes.serviceExposure.zoneCidrCap', { n: MAX_TOTAL_CIDRS }));
      break;
    }
  }
  if (!allCidrs.length) {
    notes.push(tl('notes.serviceExposure.geoNoCidrs'));
    return { ok: false, notes };
  }

  const setName = ipsetNameForService(input.serviceId);
  // Check ipset
  const has = await input.host.runCommand(['bash', '-c', 'command -v ipset'], {
    timeoutMs: 5_000,
  });
  if (has.exitCode !== 0) {
    notes.push(tl('notes.serviceExposure.ipsetMissing'));
    notes.push(tl('notes.serviceExposure.geoBestEffort'));
    return { ok: false, notes, setName };
  }

  // Write members file under dataDir for bulk restore
  const membersPath = join(
    countryZonesDir(input.dataDir),
    `_set_${sanitizeSvcToken(input.serviceId)}.txt`,
  );
  mkdirSync(countryZonesDir(input.dataDir), { recursive: true });
  writeFileSync(membersPath, allCidrs.join('\n') + '\n', 'utf8');

  const script = [
    'set -e',
    `ipset destroy ${setName} 2>/dev/null || true`,
    `ipset create ${setName} hash:net family inet maxelem ${Math.max(allCidrs.length + 64, 65536)}`,
    // also try inet6 set name
    `while read -r c; do [ -n "$c" ] && ipset add ${setName} "$c" 2>/dev/null || true; done < ${JSON.stringify(membersPath)}`,
    // Remove previous ysk-geo comment rules for this set (best-effort by comment match in iptables - not UFW)
    // Insert accept for each port from set
    ...input.ports.flatMap((p) => {
      const port = String(p.port).includes(':')
        ? String(p.port).replace(':', ':')
        : String(p.port);
      // multiport ranges: use multiport if needed; single/range with :
      if (port.includes(':')) {
        const [a, b] = port.split(':');
        return [
          `iptables -C INPUT -p ${p.proto} -m multiport --dports ${a}:${b} -m set --match-set ${setName} src -j ACCEPT -m comment --comment 'ysk-geo:${setName}' 2>/dev/null || iptables -I INPUT 1 -p ${p.proto} -m multiport --dports ${a}:${b} -m set --match-set ${setName} src -j ACCEPT -m comment --comment 'ysk-geo:${setName}'`,
        ];
      }
      return [
        `iptables -C INPUT -p ${p.proto} --dport ${port} -m set --match-set ${setName} src -j ACCEPT -m comment --comment 'ysk-geo:${setName}' 2>/dev/null || iptables -I INPUT 1 -p ${p.proto} --dport ${port} -m set --match-set ${setName} src -j ACCEPT -m comment --comment 'ysk-geo:${setName}'`,
      ];
    }),
    'true',
  ].join('\n');

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 120_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.serviceExposure.ipsetApplyFail', {
        detail: (r.stderr || r.stdout || '').slice(0, 240),
      }),
    );
    return { ok: false, notes, setName };
  }
  notes.push(
    tl('notes.serviceExposure.ipsetApplied', {
      set: setName,
      countries: countries.join(','),
      n: allCidrs.length,
    }),
  );
  notes.push(tl('notes.serviceExposure.geoBestEffort'));
  return { ok: true, notes, setName };
}

/** Destroy ipset + try remove iptables comments for service. */
export async function clearCountryIpset(input: {
  host: HostExecutor;
  serviceId: string;
}): Promise<{ notes: string[] }> {
  const notes: string[] = [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return { notes };
  }
  const setName = ipsetNameForService(input.serviceId);
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      [
        // delete rules with our comment (loop)
        `while iptables -L INPUT --line-numbers 2>/dev/null | grep -q "ysk-geo:${setName}"; do`,
        `  n=$(iptables -L INPUT --line-numbers 2>/dev/null | grep "ysk-geo:${setName}" | head -1 | awk '{print $1}');`,
        `  [ -n "$n" ] && iptables -D INPUT "$n" || break;`,
        `done`,
        `ipset destroy ${setName} 2>/dev/null || true`,
      ].join('\n'),
    ],
    { timeoutMs: 30_000 },
  );
  if (r.exitCode === 0) {
    notes.push(tl('notes.serviceExposure.ipsetCleared', { set: setName }));
  }
  return { notes };
}
