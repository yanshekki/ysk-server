/**
 * Managed BIND-style zone files under dataDir (PowerDNS / BIND path toward Spec §DNS).
 * Never fakes success: optional named-checkzone / pdnsutil only when EXECUTE + binary present.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { planDnsZone, type DnsRecordPlan } from './extras.js';

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
}

function assertZoneName(zone: string): string {
  const z = zone.trim().toLowerCase().replace(/\.$/, '');
  if (!z || z.length > 253 || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(z) || z.includes('..')) {
    throw new YskError(ErrorCodes.VALIDATION, 'Invalid zone name', {
      httpStatus: 400,
      details: { zone },
    });
  }
  return z;
}

function assertIpv4(ip: string): void {
  const parts = ip.trim().split('.');
  if (
    parts.length !== 4 ||
    !parts.every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === p;
    })
  ) {
    throw new YskError(ErrorCodes.VALIDATION, 'serverIp must be IPv4', {
      httpStatus: 400,
      details: { ip },
    });
  }
}

/**
 * Render a minimal RFC1035 master zone file.
 */
export function renderBindZoneFile(input: {
  zone: string;
  serverIp: string;
  mailHost?: string;
  serial?: number;
  ttl?: number;
  nsName?: string;
  extraRecords?: DnsRecordPlan['records'];
}): { body: string; serial: number; records: DnsRecordPlan['records'] } {
  const zone = assertZoneName(input.zone);
  assertIpv4(input.serverIp);
  const serial =
    input.serial ??
    Number(
      `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}${String(new Date().getUTCDate()).padStart(2, '0')}01`,
    );
  const ttl = input.ttl ?? 300;
  const ns = input.nsName ?? `ns1.${zone}.`;
  const mail = (input.mailHost ?? `mail.${zone}`).replace(/\.$/, '') + '.';
  const plan = planDnsZone({ zone, serverIp: input.serverIp, mailHost: input.mailHost });
  const extras = input.extraRecords ?? [];
  const records = [...plan.records, ...extras];

  const lines = [
    `; YSK Server managed zone — ${zone}`,
    `; Do not claim live DNS until nameserver loads this file`,
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
    `ns1\tIN\tA\t${input.serverIp}`,
    `@\tIN\tA\t${input.serverIp}`,
    `mail\tIN\tA\t${input.serverIp}`,
    `@\tIN\tMX\t10 ${mail}`,
    `www\tIN\tA\t${input.serverIp}`,
    '',
  ];

  for (const r of extras) {
    const name = r.name === '@' ? '@' : r.name.replace(/\.$/, '');
    if (r.type === 'TXT') {
      lines.push(`${name}\tIN\tTXT\t"${r.value.replace(/"/g, '\\"')}"`);
    } else if (r.type === 'CNAME') {
      const v = r.value.endsWith('.') ? r.value : `${r.value}.`;
      lines.push(`${name}\tIN\tCNAME\t${v}`);
    } else if (r.type === 'A' || r.type === 'AAAA') {
      lines.push(`${name}\tIN\t${r.type}\t${r.value}`);
    } else if (r.type === 'MX') {
      lines.push(`${name}\tIN\tMX\t${r.value}`);
    }
  }
  lines.push('');

  return { body: lines.join('\n'), serial, records };
}

/**
 * Write zone file under dataDir/dns/zones/<zone>.zone
 * Optionally run named-checkzone when execute + binary present.
 */
export async function writeManagedDnsZone(input: {
  dataDir: string;
  zone: string;
  serverIp: string;
  mailHost?: string;
  host?: HostExecutor;
  /** Run named-checkzone / pdnsutil if available (needs EXECUTE) */
  validate?: boolean;
  extraRecords?: DnsRecordPlan['records'];
}): Promise<ZoneFileResult> {
  const zone = assertZoneName(input.zone);
  const rendered = renderBindZoneFile({
    zone,
    serverIp: input.serverIp,
    mailHost: input.mailHost,
    extraRecords: input.extraRecords,
  });

  const dir = join(input.dataDir, 'dns', 'zones');
  mkdirSync(dir, { recursive: true });
  const zonePath = join(dir, `${zone}.zone`);
  writeFileSync(zonePath, rendered.body, 'utf8');

  // companion JSON for UI / store
  const metaPath = join(dir, `${zone}.json`);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        zone,
        serverIp: input.serverIp,
        mailHost: input.mailHost ?? `mail.${zone}`,
        serial: rendered.serial,
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
    'Load via BIND (named) or convert for PowerDNS; Cloudflare path is separate API',
  ];
  const written = [zonePath, metaPath];
  const commandResults: ZoneFileResult['commandResults'] = [];
  let validated: boolean | undefined;
  const wantValidate = Boolean(input.validate);
  const canExecute = Boolean(input.host?.executeEnabled());

  if (wantValidate && !canExecute) {
    notes.push('Zone validation skipped: set YSK_EXECUTE=1');
  }

  if (wantValidate && canExecute && input.host) {
    const check = await input.host.runCommand(
      ['bash', '-c', 'command -v named-checkzone || true'],
      { timeoutMs: 5_000 },
    );
    if (check.stdout.trim()) {
      const r = await input.host.runCommand(
        ['named-checkzone', zone, zonePath],
        { timeoutMs: 15_000 },
      );
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
      notes.push('named-checkzone not on PATH — file written, syntax not verified');
      validated = false;
    }
  }

  // When validation ran and failed, ok=false; missing binary still ok (file written)
  const finalOk =
    wantValidate && canExecute && commandResults.length > 0
      ? Boolean(validated)
      : true;

  return {
    ok: finalOk,
    zone,
    zonePath,
    serial: rendered.serial,
    records: rendered.records,
    notes,
    written,
    commandResults,
    requiresExecute: wantValidate && !canExecute,
    validated,
  };
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
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
          serial?: number;
          serverIp?: string;
          updatedAt?: string;
        };
        serial = meta.serial;
        serverIp = meta.serverIp;
        updatedAt = meta.updatedAt;
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
    };
  });
}
