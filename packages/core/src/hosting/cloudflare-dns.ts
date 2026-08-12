/**
 * Cloudflare DNS API integration (Spec §4.8).
 * Apply planned A/MX/TXT records when CF_API_TOKEN (or explicit token) is set.
 * Never fakes success without a token or when API fails.
 */

import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import { planDnsZone, type DnsRecordPlan } from './extras.js';
import type { YskDatabase } from '../db/database.js';

export type CfDnsRecordInput = {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  /** Cloudflare proxied flag — MX/TXT should be false (DNS only) */
  proxied?: boolean;
};

export interface CloudflareApplyResult {
  ok: boolean;
  zoneId?: string;
  zoneName: string;
  planned: CfDnsRecordInput[];
  created: Array<{ id: string; type: string; name: string }>;
  skipped: string[];
  errors: string[];
  notes: string[];
  requiresToken: boolean;
  dryRun: boolean;
}

export type CfFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: CfFetch = async (url, init) => {
  const res = await fetch(url, init);
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<unknown> };
};

export function planToCloudflareRecords(
  plan: DnsRecordPlan,
  zone: string,
): CfDnsRecordInput[] {
  return plan.records.map((r) => {
    const name = r.name === '@' ? zone : r.name.includes(zone) ? r.name : `${r.name}.${zone}`;
    // MX value like "10 mail.example.com." — CF wants priority separate for MX
    if (r.type === 'MX') {
      const m = r.value.match(/^(\d+)\s+(.+?)\.?$/);
      return {
        type: 'MX',
        name,
        content: m ? m[2].replace(/\.$/, '') : r.value,
        ttl: r.ttl,
        proxied: false,
        // store priority in content as CF API uses priority field — handled in apply
        ...({ priority: m ? Number(m[1]) : 10 } as { priority?: number }) } as CfDnsRecordInput & { priority?: number };
    }
    return {
      type: r.type,
      name,
      content: r.value,
      ttl: r.ttl,
      // grey cloud default for hosting (Spec: MX/A often DNS-only)
      proxied: false };
  });
}

/**
 * Resolve zone id by name via Cloudflare API.
 */
export async function resolveCloudflareZoneId(
  zoneName: string,
  token: string,
  fetchImpl: CfFetch = defaultFetch,
): Promise<string | null> {
  const url = `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    success?: boolean;
    result?: Array<{ id: string; name: string }>;
  };
  const hit = body.result?.find((z) => z.name === zoneName);
  return hit?.id ?? null;
}

/**
 * Apply DNS records to Cloudflare.
 * dryRun / missing token → plan-only success (ok=true, requiresToken when no token).
 * Live apply without token → fail-closed (ok=false).
 */
export async function applyCloudflareDns(input: {
  zone: string;
  serverIp: string;
  serverIpv6?: string;
  mailHost?: string;
  token?: string;
  dryRun?: boolean;
  fetchImpl?: CfFetch;
  extraRecords?: CfDnsRecordInput[];
}): Promise<CloudflareApplyResult> {
  const zone = input.zone.trim().toLowerCase();
  if (!zone || !input.serverIp) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.dns.needZoneServerIp'), { httpStatus: 400 });
  }
  const plan = planDnsZone({
    zone,
    serverIp: input.serverIp,
    serverIpv6: input.serverIpv6,
    mailHost: input.mailHost });
  const planned = [
    ...planToCloudflareRecords(plan, zone),
    ...(input.extraRecords ?? []),
  ];
  const token =
    input.token?.trim() ||
    process.env.CF_API_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    '';
  const notes = [...plan.providerHints];
  const wantLive = input.dryRun !== true;

  if (!token) {
    notes.push(tl('notes.auto.n0980'));
    // Explicit dry-run (or default plan): success with requiresToken. Live without token: fail-closed.
    return {
      ok: !wantLive,
      zoneName: zone,
      planned,
      created: [],
      skipped: planned.map((r) => `${r.type} ${r.name}`),
      errors: wantLive ? ['missing Cloudflare API token'] : [],
      notes,
      requiresToken: true,
      dryRun: true };
  }
  if (input.dryRun) {
    notes.push(tl('notes.auto.n0275'));
    return {
      ok: true,
      zoneName: zone,
      planned,
      created: [],
      skipped: planned.map((r) => `${r.type} ${r.name} (dry-run)`),
      errors: [],
      notes,
      requiresToken: false,
      dryRun: true };
  }

  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const zoneId = await resolveCloudflareZoneId(zone, token, fetchImpl);
  if (!zoneId) {
    return {
      ok: false,
      zoneName: zone,
      planned,
      created: [],
      skipped: [],
      errors: [`Could not resolve Cloudflare zone id for ${zone}`],
      notes,
      requiresToken: false,
      dryRun: false };
  }

  const created: CloudflareApplyResult['created'] = [];
  const errors: string[] = [];
  const skipped: string[] = [];

  for (const rec of planned) {
    const priority = (rec as { priority?: number }).priority;
    const body: Record<string, unknown> = {
      type: rec.type,
      name: rec.name,
      content: rec.content,
      ttl: rec.ttl ?? 300,
      proxied: rec.proxied ?? false };
    if (rec.type === 'MX' && priority != null) body.priority = priority;

    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json' },
        body: JSON.stringify(body) },
    );
    const json = (await res.json()) as {
      success?: boolean;
      result?: { id?: string };
      errors?: Array<{ message?: string; code?: number }>;
    };
    if (json.success && json.result?.id) {
      created.push({ id: json.result.id, type: rec.type, name: rec.name });
    } else {
      const msg =
        json.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
        `HTTP ${res.status}`;
      // 81057 already exists — treat as skip ok
      if (msg.toLowerCase().includes('already exists') || json.errors?.some((e) => e.code === 81057)) {
        skipped.push(`${rec.type} ${rec.name}: already exists`);
      } else {
        errors.push(`${rec.type} ${rec.name}: ${msg}`);
      }
    }
  }

  const ok = errors.length === 0;
  notes.push(tl('notes.auto.t0140', { v0: (created.length), v1: (skipped.length), v2: (errors.length) }));
  return {
    ok,
    zoneId,
    zoneName: zone,
    planned,
    created,
    skipped,
    errors,
    notes,
    requiresToken: false,
    dryRun: false };
}

/**
 * Persist last apply result under dns_zones store.
 */
export function persistDnsZoneApply(
  db: YskDatabase,
  result: CloudflareApplyResult,
  actor: string,
): void {
  const now = new Date().toISOString();
  const row = {
    id: `cf-${result.zoneName}`,
    zone: result.zoneName,
    provider: 'cloudflare',
    zone_id: result.zoneId,
    last_apply: result,
    ok: result.ok,
    actor,
    updated_at: now,
    created_at: now };
  db.snapshot.dns_zones = db.snapshot.dns_zones.filter(
    (z) => String(z.zone) !== result.zoneName,
  );
  db.snapshot.dns_zones.unshift(row);
  if (db.snapshot.dns_zones.length > 50) {
    db.snapshot.dns_zones = db.snapshot.dns_zones.slice(0, 50);
  }
  db.persist();
}
