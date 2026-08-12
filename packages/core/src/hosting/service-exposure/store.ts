/**
 * Persist desired service network exposure under dataDir.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultExposureMode,
  defaultPortsForService,
  isValidServiceId,
  normalizeExposureMode,
  normalizePortBinding,
  type ExposureMode,
  type ServiceExposureDesired,
  type ServiceExposureStore,
  type ServicePortBinding,
} from '@ysk-server/shared';
import { normalizeIpOrCidr } from '../../net/ip.js';

function storePath(dataDir: string): string {
  return join(dataDir, 'network', 'service-exposure.json');
}

export function emptyExposureStore(): ServiceExposureStore {
  return { version: 1, services: {} };
}

export function loadExposureStore(dataDir: string): ServiceExposureStore {
  const path = storePath(dataDir);
  if (!existsSync(path)) return emptyExposureStore();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceExposureStore>;
    return normalizeExposureStore(raw);
  } catch {
    return emptyExposureStore();
  }
}

export function saveExposureStore(dataDir: string, store: ServiceExposureStore): string {
  const path = storePath(dataDir);
  mkdirSync(join(dataDir, 'network'), { recursive: true });
  const clean = normalizeExposureStore(store);
  writeFileSync(path, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return path;
}

export function normalizeAllowFrom(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const n = normalizeIpOrCidr(String(item ?? '').trim());
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 64) break;
  }
  return out;
}

export function normalizeExposureDesired(
  raw: Partial<ServiceExposureDesired> & { serviceId: string },
): ServiceExposureDesired {
  const serviceId = String(raw.serviceId ?? '').trim();
  const mode = normalizeExposureMode(raw.mode);
  const portsRaw = Array.isArray(raw.ports) ? raw.ports : [];
  const ports: ServicePortBinding[] = [];
  for (const p of portsRaw) {
    const b = normalizePortBinding(p as Partial<ServicePortBinding>);
    if (b) ports.push(b);
  }
  const allowFrom = normalizeAllowFrom(raw.allowFrom);
  const allowCountries = Array.isArray(raw.allowCountries)
    ? raw.allowCountries
        .map((c) => String(c ?? '').trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
        .slice(0, 64)
    : undefined;

  return {
    serviceId,
    mode,
    ports,
    allowFrom: mode === 'restricted' ? allowFrom : allowFrom.length ? allowFrom : undefined,
    allowCountries: allowCountries?.length ? allowCountries : undefined,
    decided: raw.decided === true,
    updatedAt:
      typeof raw.updatedAt === 'string' && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function normalizeExposureStore(raw: Partial<ServiceExposureStore>): ServiceExposureStore {
  const services: Record<string, ServiceExposureDesired> = {};
  const src = raw.services && typeof raw.services === 'object' ? raw.services : {};
  for (const [k, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue;
    const id = String((v as ServiceExposureDesired).serviceId || k).trim();
    if (!isValidServiceId(id) && !/^[a-zA-Z0-9._-]{1,64}$/.test(id)) continue;
    services[id] = normalizeExposureDesired({
      ...(v as ServiceExposureDesired),
      serviceId: id,
    });
  }
  return { version: 1, services };
}

/** Ensure a desired record exists (catalog defaults). Does not persist. */
export function ensureDesired(
  store: ServiceExposureStore,
  serviceId: string,
  ports?: ServicePortBinding[],
): ServiceExposureDesired {
  const existing = store.services[serviceId];
  if (existing) {
    if (ports && ports.length > 0) {
      return {
        ...existing,
        ports,
        updatedAt: new Date().toISOString(),
      };
    }
    return existing;
  }
  const mode = defaultExposureMode(serviceId);
  const resolvedPorts =
    ports && ports.length > 0 ? ports : defaultPortsForService(serviceId);
  return {
    serviceId,
    mode,
    ports: resolvedPorts,
    decided: mode === 'public',
    updatedAt: new Date().toISOString(),
  };
}

export function upsertDesired(
  dataDir: string,
  serviceId: string,
  patch: Partial<ServiceExposureDesired>,
): ServiceExposureDesired {
  const store = loadExposureStore(dataDir);
  const base = ensureDesired(store, serviceId);
  const next = normalizeExposureDesired({
    ...base,
    ...patch,
    serviceId,
    updatedAt: new Date().toISOString(),
  });
  // preserve ports if patch omitted them
  if (!Array.isArray(patch.ports)) {
    next.ports = base.ports;
  }
  if (patch.mode === undefined) {
    next.mode = base.mode;
  } else {
    next.mode = normalizeExposureMode(patch.mode) as ExposureMode;
  }
  if (patch.decided !== undefined) {
    next.decided = patch.decided === true;
  } else if (patch.mode !== undefined) {
    // Explicit mode change from API/UI counts as a decision
    next.decided = true;
  } else {
    next.decided = base.decided;
  }
  store.services[serviceId] = next;
  saveExposureStore(dataDir, store);
  return next;
}

export function listDesired(dataDir: string): ServiceExposureDesired[] {
  const store = loadExposureStore(dataDir);
  return Object.values(store.services).sort((a, b) =>
    a.serviceId.localeCompare(b.serviceId),
  );
}

export function getDesired(
  dataDir: string,
  serviceId: string,
): ServiceExposureDesired | null {
  const store = loadExposureStore(dataDir);
  return store.services[serviceId] ?? null;
}
