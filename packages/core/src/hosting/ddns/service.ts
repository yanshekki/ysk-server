/**
 * DDNS tick + CRUD. Honesty: provider writes need EXECUTE.
 * Detection (probe) never calls a provider.
 */
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import type { CfFetch } from '../cloudflare-dns.js';
import { applyDnsZone } from '../managed-resources.js';
import {
  type DdnsHistoryRow,
  type DdnsRecordDto,
  type DdnsSettingsDto,
  type DdnsStatusDto,
  isDdnsProviderId,
  isDdnsRecordType,
} from 'ysk-server-shared';
import { detectPublicIpv4, detectPublicIpv6, isPublicIpv4, isPublicIpv6 } from './detect-public-ip.js';
import {
  appendDdnsHistory,
  loadDdnsHistory,
  loadDdnsRecords,
  loadDdnsSecrets,
  loadDdnsSettings,
  loadDdnsStatus,
  newDdnsRecordId,
  saveDdnsConfig,
  saveDdnsSecrets,
  saveDdnsStatus,
  type DdnsSecrets,
} from './store.js';
import { applyDdnsProvider, resolveCfToken } from './providers.js';

const FQDN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isDdnsFqdn(raw: string): boolean {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!s || s.length > 253) return false;
  return FQDN_RE.test(s);
}

export type DdnsTickInput = {
  dataDir: string;
  host: HostExecutor;
  db?: JsonStore;
  execute: boolean;
  /** Republish even when lastPublished already matches. */
  force?: boolean;
  fetchImpl?: CfFetch;
  /** Inject WAN probe (tests). */
  detect?: {
    ipv4?: () => Promise<{ ip: string | null; error: string | null }>;
    ipv6?: () => Promise<{ ip: string | null; error: string | null }>;
  };
  applyLocalZone?: typeof applyDnsZone;
};

function nextRunIso(lastRunAt: string | null, intervalSeconds: number, enabled: boolean): string | null {
  if (!enabled) return null;
  if (!lastRunAt) return null;
  const t = Date.parse(lastRunAt) + intervalSeconds * 1000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function publicStatus(input: {
  dataDir: string;
  executeEnabled: boolean;
  nextRunAt?: string | null;
}): DdnsStatusDto {
  const settings = loadDdnsSettings(input.dataDir);
  const records = loadDdnsRecords(input.dataDir);
  const st = loadDdnsStatus(input.dataDir);
  const secrets = loadDdnsSecrets(input.dataDir);
  const fallbackNext = nextRunIso(st.lastRunAt, settings.intervalSeconds, settings.enabled);
  return {
    settings,
    records,
    detected: st.detected,
    requiresExecute: st.requiresExecute,
    executeEnabled: input.executeEnabled,
    lastRunAt: st.lastRunAt,
    lastWanIpv4: st.lastWanIpv4 ?? null,
    nextRunAt: settings.enabled ? (input.nextRunAt ?? fallbackNext) : null,
    hasCloudflareToken: Boolean(resolveCfToken(secrets)),
    hasRfc2136Key: Boolean(secrets.rfc2136?.keyFile?.trim()),
    rfc2136Server: secrets.rfc2136?.server,
    rfc2136KeyFile: secrets.rfc2136?.keyFile,
    history: loadDdnsHistory(input.dataDir),
    notes: [],
  };
}

export async function getDdnsStatus(input: {
  dataDir: string;
  executeEnabled: boolean;
  nextRunAt?: string | null;
  probe?: boolean;
  detect?: DdnsTickInput['detect'];
}): Promise<DdnsStatusDto> {
  if (input.probe) {
    await probeDdnsWan({
      dataDir: input.dataDir,
      detect: input.detect,
    });
  }
  return publicStatus(input);
}

export async function probeDdnsWan(input: {
  dataDir: string;
  detect?: DdnsTickInput['detect'];
}): Promise<void> {
  const detect4 = input.detect?.ipv4 ?? detectPublicIpv4;
  const detect6 = input.detect?.ipv6 ?? detectPublicIpv6;
  const [v4, v6] = await Promise.all([detect4(), detect6()]);
  const now = new Date().toISOString();
  const prev = loadDdnsStatus(input.dataDir);
  const settings = loadDdnsSettings(input.dataDir);
  saveDdnsStatus(input.dataDir, {
    ...prev,
    detected: {
      ipv4: v4.ip,
      ipv6: v6.ip,
      at: now,
      error: !v4.ip && !v6.ip ? v4.error || v6.error || 'probeFailed' : null,
    },
    lastWanIpv4: settings.updateIdentity && v4.ip ? v4.ip : prev.lastWanIpv4,
  });
}

export function upsertDdnsRecord(
  dataDir: string,
  patch: Partial<DdnsRecordDto> & Pick<DdnsRecordDto, 'fqdn' | 'type' | 'provider'>,
): { ok: boolean; record?: DdnsRecordDto; notes: string[] } {
  if (!isDdnsFqdn(patch.fqdn)) return { ok: false, notes: ['invalidFqdn'] };
  if (!isDdnsRecordType(patch.type)) return { ok: false, notes: ['invalidType'] };
  if (!isDdnsProviderId(patch.provider)) return { ok: false, notes: ['invalidProvider'] };
  const settings = loadDdnsSettings(dataDir);
  const records = loadDdnsRecords(dataDir);
  const fqdn = patch.fqdn.toLowerCase().replace(/\.$/, '');
  let rec = records.find((r) => r.id === patch.id);
  if (!rec) rec = records.find((r) => r.fqdn === fqdn && r.type === patch.type);
  const next: DdnsRecordDto = {
    id: rec?.id ?? patch.id ?? newDdnsRecordId(),
    fqdn,
    type: patch.type,
    provider: patch.provider,
    zone: patch.zone?.trim() || rec?.zone,
    ttl: patch.ttl ?? rec?.ttl ?? 300,
    proxied: patch.proxied ?? rec?.proxied ?? false,
    enabled: patch.enabled ?? rec?.enabled ?? true,
    lastPublished: rec?.lastPublished,
    lastChangeAt: rec?.lastChangeAt,
    lastError: rec?.lastError ?? null,
    lastProviderCode: rec?.lastProviderCode ?? null,
  };
  const rest = records.filter((r) => r.id !== next.id);
  if (!settings.primaryFqdn) settings.primaryFqdn = next.fqdn;
  saveDdnsConfig(dataDir, settings, [...rest, next]);
  return { ok: true, record: next, notes: [] };
}

export function deleteDdnsRecord(
  dataDir: string,
  id: string,
  confirm: string,
): { ok: boolean; notes: string[] } {
  const records = loadDdnsRecords(dataDir);
  const rec = records.find((r) => r.id === id);
  if (!rec) return { ok: false, notes: ['notFound'] };
  if (String(confirm ?? '').trim().toLowerCase() !== rec.fqdn) {
    return { ok: false, notes: ['confirmMismatch'] };
  }
  const settings = loadDdnsSettings(dataDir);
  saveDdnsConfig(
    dataDir,
    settings,
    records.filter((r) => r.id !== id),
  );
  return { ok: true, notes: [] };
}

export function patchDdnsSettings(
  dataDir: string,
  patch: Partial<DdnsSettingsDto>,
): DdnsSettingsDto {
  const cur = loadDdnsSettings(dataDir);
  const primary =
    patch.primaryFqdn !== undefined
      ? String(patch.primaryFqdn).trim().toLowerCase().replace(/\.$/, '') || undefined
      : cur.primaryFqdn;
  const next: DdnsSettingsDto = {
    intervalSeconds: patch.intervalSeconds ?? cur.intervalSeconds,
    updateIdentity: patch.updateIdentity ?? cur.updateIdentity,
    primaryFqdn: primary,
    enabled: patch.enabled ?? cur.enabled,
  };
  saveDdnsConfig(dataDir, next, loadDdnsRecords(dataDir));
  return loadDdnsSettings(dataDir);
}

export function mergeDdnsSecrets(dataDir: string, patch: DdnsSecrets): void {
  const prev = loadDdnsSecrets(dataDir);
  const next: DdnsSecrets = { ...prev };
  if (patch.cloudflareToken !== undefined) {
    const t = patch.cloudflareToken.trim();
    if (t) next.cloudflareToken = t;
  }
  if (patch.rfc2136) {
    const server = (patch.rfc2136.server ?? prev.rfc2136?.server ?? '127.0.0.1').trim() || '127.0.0.1';
    const keyFile =
      patch.rfc2136.keyFile !== undefined
        ? patch.rfc2136.keyFile.trim() || undefined
        : prev.rfc2136?.keyFile;
    next.rfc2136 = { server, keyFile };
  }
  saveDdnsSecrets(dataDir, next);
}

function recordError(type: 'A' | 'AAAA', v4: { error: string | null }, v6: { error: string | null }): string {
  if (type === 'A') {
    if (v4.error === 'notPublicIpv4' || v4.error === 'probeFailed' || v4.error === 'noPublicIpv4') {
      return v4.error;
    }
    return v4.error || 'noPublicIpv4';
  }
  if (v6.error === 'notPublicIpv6' || v6.error === 'probeFailed' || v6.error === 'noPublicIpv6') {
    return v6.error;
  }
  return v6.error || 'noPublicIpv6';
}

export async function runDdnsTick(input: DdnsTickInput): Promise<DdnsStatusDto> {
  const settings = loadDdnsSettings(input.dataDir);
  const records = loadDdnsRecords(input.dataDir);
  const enabled = records.filter((r) => r.enabled);
  const want4 = enabled.some((r) => r.type === 'A');
  const want6 = enabled.some((r) => r.type === 'AAAA');
  const detect4 = input.detect?.ipv4 ?? detectPublicIpv4;
  const detect6 = input.detect?.ipv6 ?? detectPublicIpv6;
  const [v4, v6] = await Promise.all([
    want4 ? detect4() : Promise.resolve({ ip: null as string | null, error: null as string | null }),
    want6 ? detect6() : Promise.resolve({ ip: null as string | null, error: null as string | null }),
  ]);

  const now = new Date().toISOString();
  const detectError = !v4.ip && !v6.ip ? v4.error || v6.error : null;
  const requiresExecute = !input.execute && enabled.length > 0;
  const prevStatus = loadDdnsStatus(input.dataDir);
  saveDdnsStatus(input.dataDir, {
    detected: {
      ipv4: v4.ip,
      ipv6: v6.ip,
      at: now,
      error: detectError,
    },
    lastRunAt: now,
    requiresExecute,
    lastWanIpv4: settings.updateIdentity && v4.ip ? v4.ip : prevStatus.lastWanIpv4,
  });

  const secrets = loadDdnsSecrets(input.dataDir);
  const nextRecords: DdnsRecordDto[] = [];
  const pendingLocal = new Map<string, Array<{ index: number; rec: DdnsRecordDto; content: string }>>();
  const applyZone = input.applyLocalZone ?? applyDnsZone;

  const finishApply = (rec: DdnsRecordDto, content: string, applied: { ok: boolean; skipped?: boolean; code?: string | null; error?: string | null; notes: string[] }) => {
    const hist: DdnsHistoryRow = {
      at: now,
      fqdn: rec.fqdn,
      type: rec.type,
      from: rec.lastPublished,
      to: content,
      provider: rec.provider,
      ok: applied.ok && input.execute && !applied.skipped,
      note: !applied.ok ? applied.error ?? 'updateFailed' : !input.execute ? 'requiresExecute' : applied.notes[0],
    };
    appendDdnsHistory(input.dataDir, hist);
    const published = applied.ok && input.execute ? content : rec.lastPublished;
    nextRecords.push({
      ...rec,
      lastPublished: published,
      lastChangeAt: applied.ok && input.execute && !applied.skipped ? now : rec.lastChangeAt,
      lastError: applied.ok ? (input.execute ? null : 'requiresExecute') : applied.error ?? 'updateFailed',
      lastProviderCode: applied.code ?? null,
    });
  };

  for (const rec of records) {
    if (!rec.enabled) {
      nextRecords.push(rec);
      continue;
    }
    const content = rec.type === 'A' ? v4.ip : v6.ip;
    if (!content) {
      const err = recordError(rec.type, v4, v6);
      nextRecords.push({ ...rec, lastError: err });
      appendDdnsHistory(input.dataDir, {
        at: now,
        fqdn: rec.fqdn,
        type: rec.type,
        provider: rec.provider,
        ok: false,
        note: err,
      });
      continue;
    }
    if (rec.type === 'A' && !isPublicIpv4(content)) {
      nextRecords.push({ ...rec, lastError: 'notPublicIpv4' });
      continue;
    }
    if (rec.type === 'AAAA' && !isPublicIpv6(content)) {
      nextRecords.push({ ...rec, lastError: 'notPublicIpv6' });
      continue;
    }
    if (rec.lastPublished === content && rec.lastError == null && !input.force) {
      nextRecords.push(rec);
      continue;
    }
    if (rec.provider === 'local') {
      const staged = await applyDdnsProvider({
        record: rec,
        content,
        secrets,
        dataDir: input.dataDir,
        host: input.host,
        db: input.db,
        execute: input.execute,
        fetchImpl: input.fetchImpl,
        deferLocalApply: true,
      });
      if (!staged.ok || !staged.zoneId || !input.execute) {
        finishApply(rec, content, staged);
        continue;
      }
      const idx = nextRecords.length;
      nextRecords.push(rec);
      const list = pendingLocal.get(staged.zoneId) ?? [];
      list.push({ index: idx, rec, content });
      pendingLocal.set(staged.zoneId, list);
      continue;
    }
    const applied = await applyDdnsProvider({
      record: rec,
      content,
      secrets,
      dataDir: input.dataDir,
      host: input.host,
      db: input.db,
      execute: input.execute,
      fetchImpl: input.fetchImpl,
    });
    finishApply(rec, content, applied);
  }

  for (const [zoneId, items] of pendingLocal) {
    const applied = input.db
      ? await applyZone(input.db, input.dataDir, zoneId, {
          host: input.host,
          validate: false,
          tryReload: true,
        })
      : { ok: false, notes: ['localNeedsDb'], apply_status: undefined as string | undefined };
    const result = {
      ok: applied.ok,
      skipped: false,
      code: String(applied.apply_status ?? ''),
      error: applied.ok ? null : 'updateFailed',
      notes: applied.notes,
    };
    for (const item of items) {
      const hist: DdnsHistoryRow = {
        at: now,
        fqdn: item.rec.fqdn,
        type: item.rec.type,
        from: item.rec.lastPublished,
        to: item.content,
        provider: item.rec.provider,
        ok: result.ok,
        note: result.ok ? result.notes[0] : result.error ?? 'updateFailed',
      };
      appendDdnsHistory(input.dataDir, hist);
      nextRecords[item.index] = {
        ...item.rec,
        lastPublished: result.ok ? item.content : item.rec.lastPublished,
        lastChangeAt: result.ok ? now : item.rec.lastChangeAt,
        lastError: result.ok ? null : result.error,
        lastProviderCode: result.code,
      };
    }
  }

  saveDdnsConfig(input.dataDir, settings, nextRecords);
  return publicStatus({ dataDir: input.dataDir, executeEnabled: input.host.executeEnabled() });
}
