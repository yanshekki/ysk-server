/**
 * DDNS settings, secrets (0600), status, and bounded history on disk.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DDNS_HISTORY_MAX,
  DDNS_INTERVAL_DEFAULT,
  DDNS_INTERVAL_MAX,
  DDNS_INTERVAL_MIN,
  type DdnsHistoryRow,
  type DdnsRecordDto,
  type DdnsSettingsDto,
  isDdnsProviderId,
  isDdnsRecordType,
} from 'ysk-server-shared';

export type DdnsSecrets = {
  cloudflareToken?: string;
  rfc2136?: {
    server: string;
    keyName?: string;
    secret?: string;
    algorithm?: string;
    /** Operator-supplied nsupdate -k path under dataDir */
    keyFile?: string;
  };
};

export type DdnsStatusFile = {
  detected: { ipv4: string | null; ipv6: string | null; at: string | null; error: string | null };
  lastRunAt: string | null;
  requiresExecute: boolean;
  lastWanIpv4?: string | null;
};

export function ddnsDir(dataDir: string): string {
  return join(dataDir.replace(/\/+$/, ''), 'ddns');
}

function ensureDir(dataDir: string): string {
  const dir = ddnsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function clampInterval(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DDNS_INTERVAL_DEFAULT;
  return Math.max(DDNS_INTERVAL_MIN, Math.min(DDNS_INTERVAL_MAX, Math.floor(n)));
}

export function defaultDdnsSettings(): DdnsSettingsDto {
  return { intervalSeconds: DDNS_INTERVAL_DEFAULT, updateIdentity: true, enabled: true };
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function loadDdnsSettings(dataDir: string): DdnsSettingsDto {
  const raw = readJson<Partial<DdnsSettingsDto>>(join(ddnsDir(dataDir), 'settings.json'), {});
  return {
    intervalSeconds: clampInterval(Number(raw.intervalSeconds ?? DDNS_INTERVAL_DEFAULT)),
    updateIdentity: raw.updateIdentity !== false,
    primaryFqdn: String(raw.primaryFqdn ?? '').trim() || undefined,
    enabled: raw.enabled !== false,
  };
}

export function loadDdnsRecords(dataDir: string): DdnsRecordDto[] {
  const raw = readJson<{ records?: unknown }>(join(ddnsDir(dataDir), 'settings.json'), {});
  const rows = Array.isArray(raw.records) ? raw.records : [];
  const out: DdnsRecordDto[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const type = String(o.type ?? '');
    const provider = String(o.provider ?? '');
    const fqdn = String(o.fqdn ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '');
    if (!fqdn || !isDdnsRecordType(type) || !isDdnsProviderId(provider)) continue;
    const ttl = Number(o.ttl);
    out.push({
      id: String(o.id ?? randomUUID()),
      fqdn,
      type,
      provider,
      zone: String(o.zone ?? '').trim() || undefined,
      ttl: Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 300,
      proxied: o.proxied === true,
      enabled: o.enabled !== false,
      lastPublished: String(o.lastPublished ?? '').trim() || undefined,
      lastChangeAt: String(o.lastChangeAt ?? '').trim() || undefined,
      lastError: o.lastError == null ? null : String(o.lastError),
      lastProviderCode: o.lastProviderCode == null ? null : String(o.lastProviderCode),
    });
  }
  return out;
}

export function saveDdnsConfig(
  dataDir: string,
  settings: DdnsSettingsDto,
  records: DdnsRecordDto[],
): void {
  const dir = ensureDir(dataDir);
  const body = {
    ...settings,
    intervalSeconds: clampInterval(settings.intervalSeconds),
    records,
  };
  writeFileSync(join(dir, 'settings.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

export function loadDdnsSecrets(dataDir: string): DdnsSecrets {
  return readJson<DdnsSecrets>(join(ddnsDir(dataDir), 'secrets.json'), {});
}

export function saveDdnsSecrets(dataDir: string, secrets: DdnsSecrets): void {
  const dir = ensureDir(dataDir);
  const path = join(dir, 'secrets.json');
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    /* still usable as root */
  }
}

export function loadDdnsStatus(dataDir: string): DdnsStatusFile {
  return readJson<DdnsStatusFile>(join(ddnsDir(dataDir), 'status.json'), {
    detected: { ipv4: null, ipv6: null, at: null, error: null },
    lastRunAt: null,
    requiresExecute: false,
  });
}

export function saveDdnsStatus(dataDir: string, status: DdnsStatusFile): void {
  const dir = ensureDir(dataDir);
  writeFileSync(join(dir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export function appendDdnsHistory(dataDir: string, row: DdnsHistoryRow): void {
  const dir = ensureDir(dataDir);
  const path = join(dir, 'history.jsonl');
  appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8');
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (lines.length > DDNS_HISTORY_MAX) {
      writeFileSync(path, `${lines.slice(-DDNS_HISTORY_MAX).join('\n')}\n`, 'utf8');
    }
  } catch {
    /* keep append */
  }
}

export function loadDdnsHistory(dataDir: string, limit = 40): DdnsHistoryRow[] {
  try {
    const path = join(ddnsDir(dataDir), 'history.jsonl');
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const out: DdnsHistoryRow[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as DdnsHistoryRow);
      } catch {
        /* skip */
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

export function newDdnsRecordId(): string {
  return randomUUID();
}
