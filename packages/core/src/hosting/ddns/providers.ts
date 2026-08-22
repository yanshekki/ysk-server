/**
 * DDNS provider adapters. Cloudflare upsert, RFC 2136 nsupdate, local managedBy=ddns.
 * Remote nsupdate is signed with -k keyFile only — never put a TSIG secret on argv.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { DdnsRecordDto } from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import {
  applyDnsZone,
  createResource,
  listResources,
  updateResource,
} from '../managed-resources.js';
import { upsertCloudflareAddressRecord, type CfFetch } from '../cloudflare-dns.js';
import type { DdnsSecrets } from './store.js';
import { ddnsDir } from './store.js';

export type DdnsProviderResult = {
  ok: boolean;
  skipped?: boolean;
  code?: string | null;
  error?: string | null;
  notes: string[];
  zoneId?: string;
};

export function zoneFromFqdn(fqdn: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim().toLowerCase().replace(/\.$/, '');
  const parts = fqdn.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length < 2) return fqdn.toLowerCase();
  return parts.slice(-2).join('.');
}

export function ddnsRelativeName(fqdn: string, zone: string): string {
  const f = fqdn.toLowerCase().replace(/\.$/, '');
  const z = zone.toLowerCase().replace(/\.$/, '');
  if (f === z) return '@';
  if (f.endsWith(`.${z}`)) return f.slice(0, -(z.length + 1));
  return f;
}

export function findLocalDnsConflict(input: {
  db: JsonStore;
  zoneId: string;
  relName: string;
  type: string;
}): { managedBy: string; id: string } | null {
  const rel = input.relName.toLowerCase();
  const typ = input.type.toUpperCase();
  for (const r of listResources(input.db, 'dns_records')) {
    if (String(r.zoneId) !== input.zoneId) continue;
    if (String(r.type ?? '').toUpperCase() !== typ) continue;
    if (String(r.name ?? '@').toLowerCase() !== rel) continue;
    const by = String(r.managedBy ?? 'user');
    if (by === 'ddns') continue;
    return { managedBy: by, id: String(r.id) };
  }
  return null;
}

export function resolveCfToken(secrets: DdnsSecrets): string {
  return (
    secrets.cloudflareToken?.trim() ||
    process.env.CF_API_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    ''
  );
}

export function isRfc2136Loopback(server: string): boolean {
  const s = server.trim().toLowerCase();
  return s === '127.0.0.1' || s === '::1' || s === 'localhost' || s === '::ffff:127.0.0.1';
}

/** Key file must exist and stay under dataDir (relative names resolve in ddns/). */
export function resolveRfc2136KeyFile(dataDir: string, keyFile?: string): string | null {
  if (!keyFile?.trim()) return null;
  const root = resolve(dataDir);
  const raw = keyFile.trim();
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(ddnsDir(dataDir), raw);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  if (!existsSync(candidate)) return null;
  return candidate;
}

export async function applyDdnsProvider(input: {
  record: DdnsRecordDto;
  content: string;
  secrets: DdnsSecrets;
  dataDir: string;
  host: HostExecutor;
  db?: JsonStore;
  execute: boolean;
  fetchImpl?: CfFetch;
  /** Stage local rows only; caller applies each zone once. */
  deferLocalApply?: boolean;
}): Promise<DdnsProviderResult> {
  const rec = input.record;
  const zone = zoneFromFqdn(rec.fqdn, rec.zone);
  if (rec.provider === 'cloudflare') {
    const token = resolveCfToken(input.secrets);
    if (!token) {
      return { ok: false, error: 'missingToken', notes: ['requiresToken'] };
    }
    if (!input.execute) {
      return { ok: true, skipped: true, notes: ['dry-run Cloudflare upsert'], code: 'dry-run' };
    }
    const r = await upsertCloudflareAddressRecord({
      zone,
      fqdn: rec.fqdn,
      type: rec.type,
      content: input.content,
      ttl: rec.ttl,
      proxied: rec.proxied === true,
      token,
      fetchImpl: input.fetchImpl,
    });
    return {
      ok: r.ok,
      skipped: r.action === 'skipped',
      code: r.code ?? r.action,
      error: r.ok ? null : 'updateFailed',
      notes: r.ok ? [`cloudflare ${r.action}`] : [r.error ?? 'updateFailed'],
    };
  }

  if (rec.provider === 'rfc2136') {
    const cfg = input.secrets.rfc2136;
    const server = (cfg?.server ?? '127.0.0.1').trim() || '127.0.0.1';
    const loopback = isRfc2136Loopback(server);
    const keyPath = resolveRfc2136KeyFile(input.dataDir, cfg?.keyFile);
    if (!loopback && !cfg?.keyFile) {
      return { ok: false, error: 'rfc2136NeedKey', notes: [] };
    }
    if (!loopback && !keyPath) {
      return { ok: false, error: 'rfc2136KeyMissing', notes: [] };
    }
    if (!input.execute) {
      return { ok: true, skipped: true, notes: ['dry-run nsupdate'], code: 'dry-run' };
    }
    const dir = ddnsDir(input.dataDir);
    mkdirSync(dir, { recursive: true });
    const scriptPath = resolve(dir, 'nsupdate.in');
    const fqdn = rec.fqdn.replace(/\.$/, '');
    const script = [
      `server ${server}`,
      `zone ${zone}.`,
      `update delete ${fqdn}. ${rec.type}`,
      `update add ${fqdn}. ${rec.ttl} ${rec.type} ${input.content}`,
      'send',
      '',
    ].join('\n');
    writeFileSync(scriptPath, script, 'utf8');
    const argv = ['nsupdate'];
    if (keyPath) argv.push('-k', keyPath);
    argv.push(scriptPath);
    const run = await input.host.runCommand(argv, { timeoutMs: 20_000 });
    const ok = run.exitCode === 0;
    return {
      ok,
      code: String(run.exitCode),
      error: ok ? null : 'nsupdateFailed',
      notes: ok ? ['rfc2136 nsupdate'] : [run.stderr.trim() || 'nsupdateFailed'],
    };
  }

  if (rec.provider === 'local') {
    const db = input.db;
    if (!db) return { ok: false, error: 'localNeedsDb', notes: [] };
    const zones = listResources(db, 'dns_zones');
    const zrow = zones.find((z) => String(z.zone ?? '').toLowerCase() === zone);
    if (!zrow) {
      return { ok: false, error: 'localNoZone', notes: [] };
    }
    const zoneId = String(zrow.id);
    const rel = ddnsRelativeName(rec.fqdn, zone);
    const clash = findLocalDnsConflict({ db, zoneId, relName: rel, type: rec.type });
    if (clash) {
      return {
        ok: false,
        error: 'managedByClash',
        notes: [`refuse managedBy=${clash.managedBy}`],
      };
    }
    if (!input.execute) {
      return { ok: true, skipped: true, notes: ['dry-run local'], code: 'dry-run', zoneId };
    }
    const existing = listResources(db, 'dns_records').find(
      (r) =>
        String(r.zoneId) === zoneId &&
        String(r.managedBy ?? '') === 'ddns' &&
        String(r.type ?? '').toUpperCase() === rec.type &&
        String(r.name ?? '@').toLowerCase() === rel.toLowerCase(),
    );
    if (existing) {
      updateResource(db, 'dns_records', String(existing.id), {
        value: input.content,
        ttl: rec.ttl,
        managedBy: 'ddns',
      });
    } else {
      createResource(db, 'dns_records', {
        zoneId,
        type: rec.type,
        name: rel,
        value: input.content,
        ttl: rec.ttl,
        managedBy: 'ddns',
        apply_status: 'draft',
      });
    }
    if (input.deferLocalApply) {
      return { ok: true, skipped: false, notes: ['staged'], zoneId };
    }
    const applied = await applyDnsZone(db, input.dataDir, zoneId, {
      host: input.host,
      validate: false,
      tryReload: true,
    });
    return {
      ok: applied.ok,
      skipped: false,
      code: String(applied.apply_status ?? ''),
      error: applied.ok ? null : 'updateFailed',
      notes: applied.notes,
      zoneId,
    };
  }

  return { ok: false, error: 'unknownProvider', notes: [] };
}
