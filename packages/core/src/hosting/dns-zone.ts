/**
 * Managed BIND-style zone files under dataDir.
 * Never fakes success: named-checkzone / reload only when EXECUTE + binary present.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
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
  const ns = input.nsName ?? `ns1.${zone}.`;
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
    `@\tIN\tSOA\t${ns}\thostmaster.${zone}.\t(`,
    `\t\t${serial}\t; serial`,
    `\t\t7200\t\t; refresh`,
    `\t\t3600\t\t; retry`,
    `\t\t1209600\t\t; expire`,
    `\t\t${ttl}\t\t; minimum`,
    `\t\t)`,
    `@\tIN\tNS\t${ns}`,
    `ns1\tIN\tA\t${serverIp}`,
  ];
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
  ttl?: number;
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
    ttl: input.ttl,
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
    reloaded = await tryReloadNameserver(input.host, notes, commandResults);
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

async function tryReloadNameserver(
  host: HostExecutor,
  notes: string[],
  commandResults: ZoneFileResult['commandResults'],
): Promise<boolean> {
  // Prefer rndc, then systemctl units common on Debian/Ubuntu
  const attempts: string[][] = [
    ['rndc', 'reload'],
    ['systemctl', 'reload', 'named'],
    ['systemctl', 'reload', 'bind9'],
    ['systemctl', 'reload', 'pdns'],
  ];
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
