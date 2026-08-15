/**
 * Managed BIND-style zone files under dataDir.
 * Never fakes success: named-checkzone / reload only when EXECUTE + binary present.
 */

import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { ipFamily, isValidIp, normalizeIp } from '../net/ip.js';
import {
  normalizeDnsZoneTemplate,
  planDnsZone,
  type DnsRecordPlan,
  type DnsZoneTemplate,
} from './extras.js';

export interface ZoneFileResult {
  ok: boolean;
  zone: string;
  zonePath: string;
  serial: number;
  records: DnsRecordPlan['records'];
  notes: string[];
  written: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  validated?: boolean;
  /** true only when nameserver reload succeeded */
  reloaded?: boolean;
  /** written | applied | failed (honest) */
  applyStatus: 'written' | 'applied' | 'failed';
}

function assertZoneName(zone: string): string {
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  if (!z || z.length > 253 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(z) || z.includes('..')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0483'), {
      httpStatus: 400,
      details: { zone },
    });
  }
  return z;
}

function assertIpv4(ip: string): string {
  const n = normalizeIp(ip);
  if (!n || ipFamily(n) !== 4) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0429'), {
      httpStatus: 400,
      details: { ip },
    });
  }
  return n;
}

function assertIpv6Optional(ip: string | undefined): string | undefined {
  if (ip == null || !String(ip).trim()) return undefined;
  const n = normalizeIp(ip);
  if (!n || ipFamily(n) !== 6) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0430'), {
      httpStatus: 400,
      details: { ip },
    });
  }
  return n;
}

/**
 * Render RFC1035 master zone: SOA + NS + ns1 A[/AAAA], then data records.
 */
export function renderBindZoneFile(input: {
  zone: string;
  serverIp: string;
  /** Optional public IPv6 for AAAA (ns1 + apex template) */
  serverIpv6?: string;
  mailHost?: string;
  serial?: number;
  ttl?: number;
  nsName?: string;
  /** Optional secondary nameserver (FQDN, with or without trailing dot) */
  ns2Name?: string;
  /** SOA RNAME hostmaster mailbox (defaults hostmaster.<zone>.) */
  hostmaster?: string;
  /** SOA timing (seconds) */
  soaRefresh?: number;
  soaRetry?: number;
  soaExpire?: number;
  soaMinimum?: number;
  /** Data records (A/MX/TXT/…); if omitted, uses planDnsZone template */
  records?: DnsRecordPlan['records'];
  template?: DnsZoneTemplate | string;
}): { body: string; serial: number; records: DnsRecordPlan['records'] } {
  const zone = assertZoneName(input.zone);
  const serverIp = assertIpv4(input.serverIp);
  const serverIpv6 = assertIpv6Optional(input.serverIpv6);
  const serial =
    input.serial ??
    Number(
      `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}${String(new Date().getUTCDate()).padStart(2, '0')}${String(new Date().getUTCHours()).padStart(2, '0')}`,
    );
  const ttl = input.ttl ?? 300;
  const clamp = (n: number | undefined, def: number, min: number, max: number) => {
    if (n == null || !Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const refresh = clamp(input.soaRefresh, 7200, 300, 86400 * 7);
  const retry = clamp(input.soaRetry, 3600, 300, 86400);
  const expire = clamp(input.soaExpire, 1209600, 86400, 86400 * 365);
  const minimum = clamp(input.soaMinimum, ttl, 30, 86400 * 7);
  let ns = (input.nsName ?? `ns1.${zone}.`).trim();
  if (!ns.endsWith('.')) ns = `${ns}.`;
  let ns2 = (input.ns2Name ?? '').trim();
  if (ns2 && !ns2.endsWith('.')) ns2 = `${ns2}.`;
  let rname = (input.hostmaster ?? `hostmaster.${zone}.`).trim().replace(/@/g, '.');
  if (!rname.endsWith('.')) rname = `${rname}.`;
  const dataRecords =
    input.records ??
    planDnsZone({
      zone,
      serverIp,
      serverIpv6,
      mailHost: input.mailHost,
      template: input.template,
    }).records;

  const lines = [
    `; YSK Server managed zone — ${zone}`,
    `; written ≠ authoritative until nameserver reloads this file`,
    `$TTL ${ttl}`,
    `$ORIGIN ${zone}.`,
    `@\tIN\tSOA\t${ns}\t${rname}\t(`,
    `\t\t${serial}\t; serial`,
    `\t\t${refresh}\t\t; refresh`,
    `\t\t${retry}\t\t; retry`,
    `\t\t${expire}\t\t; expire`,
    `\t\t${minimum}\t\t; minimum`,
    `\t\t)`,
    `@\tIN\tNS\t${ns}`,
  ];
  if (ns2) {
    lines.push(`@\tIN\tNS\t${ns2}`);
  }
  lines.push(`ns1\tIN\tA\t${serverIp}`);
  if (serverIpv6) {
    lines.push(`ns1\tIN\tAAAA\t${serverIpv6}`);
  }

  for (const r of dataRecords) {
    const name = r.name === '@' ? '@' : r.name.replace(/\.$/, '');
    if (r.type === 'TXT') {
      lines.push(`${name}\tIN\tTXT\t"${String(r.value).replace(/"/g, '\\"')}"`);
    } else if (r.type === 'CNAME') {
      const v = r.value.endsWith('.') ? r.value : `${r.value}.`;
      lines.push(`${name}\tIN\tCNAME\t${v}`);
    } else if (r.type === 'A' || r.type === 'AAAA') {
      // Validate address family for safety
      if (r.type === 'A' && isValidIp(r.value) && ipFamily(r.value) !== 4) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0069'), {
          httpStatus: 400,
          details: { value: r.value },
        });
      }
      if (r.type === 'AAAA' && isValidIp(r.value) && ipFamily(r.value) !== 6) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0071'), {
          httpStatus: 400,
          details: { value: r.value },
        });
      }
      lines.push(`${name}\tIN\t${r.type}\t${r.value}`);
    } else if (r.type === 'MX') {
      lines.push(`${name}\tIN\tMX\t${r.value}`);
    } else if (r.type === 'NS') {
      const v = r.value.endsWith('.') ? r.value : `${r.value}.`;
      lines.push(`${name}\tIN\tNS\t${v}`);
    } else if (r.type === 'SRV' || r.type === 'CAA') {
      lines.push(`${name}\tIN\t${r.type}\t${r.value}`);
    }
  }
  // Optional apex/www AAAA when serverIpv6 set and template records lack AAAA
  if (serverIpv6 && !dataRecords.some((r) => r.type === 'AAAA')) {
    lines.push(`@\tIN\tAAAA\t${serverIpv6}`);
    lines.push(`www\tIN\tAAAA\t${serverIpv6}`);
  }
  lines.push('');

  return { body: lines.join('\n'), serial, records: dataRecords };
}

/**
 * Write zone file under dataDir/dns/zones/<zone>.zone
 * Optionally validate (named-checkzone) and reload nameserver.
 */
export async function writeManagedDnsZone(input: {
  dataDir: string;
  zone: string;
  serverIp: string;
  serverIpv6?: string;
  mailHost?: string;
  host?: HostExecutor;
  /** Run named-checkzone if available (needs EXECUTE) */
  validate?: boolean;
  /** Attempt named/bind9/pdns reload when EXECUTE */
  tryReload?: boolean;
  records?: DnsRecordPlan['records'];
  template?: DnsZoneTemplate | string;
  nsName?: string;
  ns2Name?: string;
  hostmaster?: string;
  ttl?: number;
  soaRefresh?: number;
  soaRetry?: number;
  soaExpire?: number;
  soaMinimum?: number;
}): Promise<ZoneFileResult> {
  const zone = assertZoneName(input.zone);
  const template = normalizeDnsZoneTemplate(input.template);
  const rendered = renderBindZoneFile({
    zone,
    serverIp: input.serverIp,
    serverIpv6: input.serverIpv6,
    mailHost: input.mailHost,
    records: input.records,
    template,
    nsName: input.nsName,
    ns2Name: input.ns2Name,
    hostmaster: input.hostmaster,
    ttl: input.ttl,
    soaRefresh: input.soaRefresh,
    soaRetry: input.soaRetry,
    soaExpire: input.soaExpire,
    soaMinimum: input.soaMinimum,
  });

  const dir = join(input.dataDir, 'dns', 'zones');
  mkdirSync(dir, { recursive: true });
  const zonePath = join(dir, `${zone}.zone`);
  writeFileSync(zonePath, rendered.body, 'utf8');

  const metaPath = join(dir, `${zone}.json`);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        zone,
        serverIp: input.serverIp,
        ...(input.serverIpv6 ? { serverIpv6: input.serverIpv6 } : {}),
        mailHost: input.mailHost ?? `mail.${zone}`,
        serial: rendered.serial,
        template,
        nsName: input.nsName ?? `ns1.${zone}.`,
        ttl: input.ttl ?? 300,
        records: rendered.records,
        zonePath,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const notes = [
    `Zone file: ${zonePath}`,
    `Serial: ${rendered.serial}`,
    `Template data RRs: ${rendered.records.length}`,
  ];
  const written = [zonePath, metaPath];
  const commandResults: ZoneFileResult['commandResults'] = [];
  let validated: boolean | undefined;
  let reloaded = false;
  const wantValidate = Boolean(input.validate);
  const wantReload = Boolean(input.tryReload);
  const canExecute = Boolean(input.host?.executeEnabled());

  if ((wantValidate || wantReload) && !canExecute) {
    notes.push(tl('notes.auto.n0988'));
  }

  if (wantValidate && canExecute && input.host) {
    const { binPresent } = await import('./software-probe/index.js');
    if (await binPresent(input.host, 'named-checkzone')) {
      const r = await input.host.runCommand(['named-checkzone', zone, zonePath], {
        timeoutMs: 15_000,
      });
      commandResults.push({
        argv: ['named-checkzone', zone, zonePath],
        exitCode: r.exitCode,
        stderr: r.stderr,
      });
      validated = r.exitCode === 0;
      notes.push(
        validated
          ? 'named-checkzone: OK'
          : `named-checkzone failed: ${r.stderr || r.stdout}`,
      );
    } else {
      notes.push(tl('notes.auto.n0337'));
      validated = undefined;
    }
  }

  // Reload only if validation did not fail
  if (wantReload && canExecute && input.host && validated !== false) {
    // Prefer classic named/bind9; pure pdns reload alone does not load zones
    reloaded = await tryReloadClassicNameserver(input.host, notes, commandResults, {
      includePdns: true,
    });
  } else if (wantReload && canExecute && validated === false) {
    notes.push(tl('notes.auto.n1257'));
  }

  let applyStatus: ZoneFileResult['applyStatus'] = 'written';
  let ok = true;
  if (validated === false) {
    applyStatus = 'failed';
    ok = false;
  } else if (reloaded) {
    applyStatus = 'applied';
    notes.push(tl('notes.auto.n1236'));
  } else {
    applyStatus = 'written';
    notes.push(tl('notes.auto.n1237'));
  }

  return {
    ok,
    zone,
    zonePath,
    serial: rendered.serial,
    records: rendered.records,
    notes,
    written,
    commandResults,
    requiresExecute: (wantValidate || wantReload) && !canExecute,
    validated,
    reloaded,
    applyStatus,
  };
}

/**
 * Reload classic BIND (rndc/named/bind9). Optionally try pdns unit reload.
 *
 * Warning: `systemctl reload pdns` alone does NOT register zones for bindbackend.
 * Callers that need PowerDNS authority must use syncPowerDnsBindZones first and
 * must not treat pure pdns reload as "applied".
 */
export async function tryReloadClassicNameserver(
  host: HostExecutor,
  notes: string[],
  commandResults: ZoneFileResult['commandResults'],
  opts?: { /** default false — skip pdns so callers do not false-green */ includePdns?: boolean },
): Promise<boolean> {
  const attempts: string[][] = [
    ['rndc', 'reload'],
    ['systemctl', 'reload', 'named'],
    ['systemctl', 'reload', 'bind9'],
  ];
  if (opts?.includePdns) {
    attempts.push(['systemctl', 'reload', 'pdns']);
  }
  for (const argv of attempts) {
    if (argv[0] !== 'systemctl') {
      const { binPresent } = await import('./software-probe/index.js');
      if (!(await binPresent(host, argv[0]!))) continue;
    }
    if (argv[0] === 'systemctl') {
      const unit = argv[2];
      const active = await host.runCommand(['systemctl', 'is-active', unit], { timeoutMs: 5_000 });
      if ((active.stdout || '').trim() !== 'active') continue;
    }
    const r = await host.runCommand(argv, { timeoutMs: 15_000 });
    commandResults.push({ argv, exitCode: r.exitCode, stderr: r.stderr });
    if (r.exitCode === 0) {
      notes.push(`nameserver reload OK: ${argv.join(' ')}`);
      return true;
    }
    notes.push(tl('notes.auto.t0170', { v0: (argv.join(' ')), v1: ((r.stderr || r.stdout).trim()) }));
  }
  notes.push(tl('notes.auto.n0857'));
  return false;
}

/**
 * Remove managed zone file + meta under dataDir (does not touch PowerDNS by itself).
 */
export function removeManagedDnsZoneFiles(
  dataDir: string,
  zone: string,
): { ok: boolean; removed: string[]; notes: string[] } {
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  const removed: string[] = [];
  const notes: string[] = [];
  if (!z) return { ok: false, removed, notes: ['empty zone'] };
  const dir = join(dataDir, 'dns', 'zones');
  for (const f of [`${z}.zone`, `${z}.json`]) {
    const p = join(dir, f);
    if (existsSync(p)) {
      try {
        unlinkSync(p);
        removed.push(p);
      } catch (e) {
        notes.push(`failed to remove ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (removed.length === 0) notes.push(`no managed files for ${z}`);
  else notes.push(`removed ${removed.length} file(s) for ${z}`);
  return { ok: notes.every((n) => !n.startsWith('failed')), removed, notes };
}

/**
 * List managed zone files under dataDir/dns/zones.
 */
export function listManagedDnsZones(dataDir: string): Array<{
  zone: string;
  zonePath: string;
  metaPath?: string;
  serial?: number;
  serverIp?: string;
  updatedAt?: string;
  template?: string;
}> {
  const dir = join(dataDir, 'dns', 'zones');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.zone'));
  return files.map((f) => {
    const zone = f.replace(/\.zone$/, '');
    const zonePath = join(dir, f);
    const metaPath = join(dir, `${zone}.json`);
    let serial: number | undefined;
    let serverIp: string | undefined;
    let updatedAt: string | undefined;
    let template: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          serial?: number;
          serverIp?: string;
          updatedAt?: string;
          template?: string;
        };
        serial = meta.serial;
        serverIp = meta.serverIp;
        updatedAt = meta.updatedAt;
        template = meta.template;
      } catch {
        /* ignore */
      }
    }
    return {
      zone,
      zonePath,
      metaPath: existsSync(metaPath) ? metaPath : undefined,
      serial,
      serverIp,
      updatedAt,
      template,
    };
  });
}

export function deleteManagedDnsZone(
  dataDir: string,
  zoneRaw: string,
): { ok: boolean; zone: string; notes: string[]; removed: string[] } {
  const zone = assertZoneName(zoneRaw);
  const dir = join(dataDir, 'dns', 'zones');
  const zonePath = join(dir, `${zone}.zone`);
  const metaPath = join(dir, `${zone}.json`);
  const notes: string[] = [];
  const removed: string[] = [];
  if (!existsSync(zonePath) && !existsSync(metaPath)) {
    return { ok: false, zone, notes: [tl('notes.auto.n0483')], removed };
  }
  for (const p of [zonePath, metaPath]) {
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      removed.push(p);
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }
  notes.push(
    removed.length
      ? `removed managed zone files for ${zone} (live nameserver unchanged until reload)`
      : `no files removed for ${zone}`,
  );
  return { ok: removed.length > 0, zone, notes, removed };
}

const DNS_RECORD_TYPES = new Set(['A', 'AAAA', 'TXT', 'CNAME', 'MX', 'NS', 'SRV', 'CAA']);

export function appendManagedDnsRecord(input: {
  dataDir: string;
  zone: string;
  name: string;
  type: string;
  data: string;
  ttl?: number;
}): { ok: boolean; notes: string[]; zonePath?: string } {
  const zone = assertZoneName(input.zone);
  const type = String(input.type ?? '').trim().toUpperCase();
  const data = String(input.data ?? '').trim();
  const nameRaw = String(input.name ?? '').trim() || '@';
  if (!DNS_RECORD_TYPES.has(type) || !data) {
    return { ok: false, notes: ['need --type A|AAAA|TXT|CNAME|MX|NS and --data'] };
  }
  const dir = join(input.dataDir, 'dns', 'zones');
  const zonePath = join(dir, `${zone}.zone`);
  if (!existsSync(zonePath)) {
    return { ok: false, notes: [`zone file missing: ${zonePath}`] };
  }
  const owner =
    nameRaw === '@' || nameRaw === zone || nameRaw === `${zone}.`
      ? '@'
      : nameRaw.endsWith(`.${zone}`)
        ? nameRaw.slice(0, -(zone.length + 1))
        : nameRaw.replace(/\.$/, '');
  const ttl = Number.isFinite(input.ttl) && (input.ttl ?? 0) > 0 ? String(input.ttl) : '';
  const value =
    type === 'TXT' && !data.startsWith('"') ? `"${data.replace(/"/g, '\\"')}"` : data;
  const line = ttl
    ? `${owner}\t${ttl}\tIN\t${type}\t${value}`
    : `${owner}\tIN\t${type}\t${value}`;
  const prev = readFileSync(zonePath, 'utf8');
  const next = prev.endsWith('\n') ? `${prev}${line}\n` : `${prev}\n${line}\n`;
  writeFileSync(zonePath, next, 'utf8');
  return {
    ok: true,
    zonePath,
    notes: [`appended ${type} ${owner} (zone file only; pass dns zone --reload to load)`],
  };
}
