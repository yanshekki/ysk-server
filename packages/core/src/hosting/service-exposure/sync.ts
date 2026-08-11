/**
 * Sync desired service exposure → UFW rules (ysk-svc comments).
 */

import { tl } from '@ysk/shared';
import {
  defaultExposureMode,
  defaultPortsForService,
  isValidServiceId,
  yskSvcComment,
  yskSvcCommentPrefix,
  type ExposureDecision,
  type ServiceExposureDesired,
  type ServicePortBinding,
  type SyncReason,
} from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import { normalizeIpOrCidr } from '../../net/ip.js';
import {
  firewallAllowPort,
  firewallDeleteByComment,
  parseUfwNumbered,
  extractUfwComment,
} from '../firewall-ops.js';
import {
  ensureDesired,
  loadExposureStore,
  normalizeAllowFrom,
  saveExposureStore,
  upsertDesired,
} from './store.js';

export type SyncServiceExposureInput = {
  host: HostExecutor;
  dataDir: string;
  serviceId: string;
  ports?: ServicePortBinding[];
  reason: SyncReason;
  /** When start + private default needs user choice */
  exposureDecision?: ExposureDecision;
  allowFrom?: string[];
  /**
   * When true on start with undecided private: return needsExposureDecision
   * without mutating. Default true.
   */
  requireDecision?: boolean;
};

export type AppliedRule = {
  role: string;
  port: string;
  proto: string;
  from?: string;
  comment: string;
};

export type SyncServiceExposureResult = {
  ok: boolean;
  serviceId: string;
  desired: ServiceExposureDesired;
  applied: AppliedRule[];
  removed: number;
  notes: string[];
  blocked?: boolean;
  /** Frontend should show private-exposure modal before start */
  needsExposureDecision?: boolean;
  defaultMode?: 'private' | 'public';
};

function expandProtos(proto: ServicePortBinding['proto']): Array<'tcp' | 'udp'> {
  if (proto === 'both') return ['tcp', 'udp'];
  return [proto === 'udp' ? 'udp' : 'tcp'];
}

/** Build target rule set from desired mode + ports. */
export function buildTargetRules(desired: ServiceExposureDesired): AppliedRule[] {
  if (desired.mode === 'private') return [];

  const out: AppliedRule[] = [];
  const sources =
    desired.mode === 'restricted'
      ? (desired.allowFrom ?? []).map((s) => normalizeIpOrCidr(s)).filter(Boolean) as string[]
      : [undefined];

  if (desired.mode === 'restricted' && sources.length === 0) {
    return [];
  }

  for (const binding of desired.ports) {
    for (const p of expandProtos(binding.proto)) {
      for (const from of sources) {
        out.push({
          role: binding.role,
          port: binding.port,
          proto: p,
          from,
          comment: yskSvcComment(desired.serviceId, binding.role),
        });
      }
    }
  }
  return out;
}

/**
 * Idempotent sync: delete old ysk-svc:<serviceId>:* then apply desired.
 * stop → delete only, keep desired in store.
 */
export async function syncServiceExposure(
  input: SyncServiceExposureInput,
): Promise<SyncServiceExposureResult> {
  const serviceId = String(input.serviceId ?? '').trim();
  const notes: string[] = [];
  const applied: AppliedRule[] = [];

  if (!serviceId || (!isValidServiceId(serviceId) && !/^[a-zA-Z0-9._-]{1,64}$/.test(serviceId))) {
    return {
      ok: false,
      serviceId,
      desired: {
        serviceId: serviceId || 'unknown',
        mode: 'private',
        ports: [],
        updatedAt: new Date().toISOString(),
      },
      applied: [],
      removed: 0,
      notes: [tl('notes.auto.n1113')],
    };
  }

  const store = loadExposureStore(input.dataDir);
  let desired = ensureDesired(store, serviceId, input.ports);

  // Apply exposure decision on start/manual
  if (input.exposureDecision) {
    if (input.exposureDecision === 'keep-private') {
      desired = {
        ...desired,
        mode: 'private',
        decided: true,
        updatedAt: new Date().toISOString(),
      };
    } else if (input.exposureDecision === 'public') {
      desired = {
        ...desired,
        mode: 'public',
        decided: true,
        allowFrom: undefined,
        updatedAt: new Date().toISOString(),
      };
    } else if (input.exposureDecision === 'restricted') {
      const allowFrom = normalizeAllowFrom(input.allowFrom ?? desired.allowFrom ?? []);
      desired = {
        ...desired,
        mode: 'restricted',
        allowFrom,
        decided: true,
        updatedAt: new Date().toISOString(),
      };
    }
  } else if (input.allowFrom && input.reason === 'manual') {
    desired = {
      ...desired,
      allowFrom: normalizeAllowFrom(input.allowFrom),
      updatedAt: new Date().toISOString(),
    };
  }

  if (input.ports && input.ports.length > 0) {
    desired = { ...desired, ports: input.ports, updatedAt: new Date().toISOString() };
  } else if (desired.ports.length === 0) {
    desired = {
      ...desired,
      ports: defaultPortsForService(serviceId),
      updatedAt: new Date().toISOString(),
    };
  }

  // Private start without decision → ask UI first (do not start opening ports)
  const defMode = defaultExposureMode(serviceId);
  const requireDecision = input.requireDecision !== false;
  if (
    input.reason === 'start' &&
    requireDecision &&
    defMode === 'private' &&
    !desired.decided &&
    !input.exposureDecision
  ) {
    // Persist skeleton so UI can load it
    store.services[serviceId] = desired;
    saveExposureStore(input.dataDir, store);
    return {
      ok: true,
      serviceId,
      desired,
      applied: [],
      removed: 0,
      notes: [tl('notes.serviceExposure.needsDecision', { service: serviceId })],
      needsExposureDecision: true,
      defaultMode: 'private',
    };
  }

  // Persist desired before UFW mutations
  store.services[serviceId] = desired;
  saveExposureStore(input.dataDir, store);

  const prefix = yskSvcCommentPrefix(serviceId);

  // stop: only remove rules
  if (input.reason === 'stop') {
    const del = await firewallDeleteByComment(input.host, prefix);
    notes.push(...del.notes);
    return {
      ok: del.ok || del.removed >= 0,
      serviceId,
      desired,
      applied: [],
      removed: del.removed,
      notes,
      blocked: del.blocked,
    };
  }

  // Always clear old managed rules for this service, then re-apply
  const del = await firewallDeleteByComment(input.host, prefix);
  notes.push(...del.notes);
  if (del.blocked) {
    return {
      ok: false,
      serviceId,
      desired,
      applied: [],
      removed: del.removed,
      notes,
      blocked: true,
    };
  }

  const targets = buildTargetRules(desired);
  let fail = 0;
  for (const t of targets) {
    const r = await firewallAllowPort(
      input.host,
      t.port,
      t.proto as 'tcp' | 'udp',
      t.from,
      t.comment,
    );
    notes.push(...r.notes);
    if (r.blocked) {
      return {
        ok: false,
        serviceId,
        desired,
        applied,
        removed: del.removed,
        notes,
        blocked: true,
      };
    }
    if (r.ok) {
      applied.push(t);
    } else {
      fail += 1;
    }
  }

  if (desired.mode === 'private') {
    notes.push(tl('notes.serviceExposure.private', { service: serviceId }));
  } else if (desired.mode === 'restricted' && targets.length === 0) {
    notes.push(tl('notes.serviceExposure.restrictedEmpty'));
  }

  return {
    ok: fail === 0,
    serviceId,
    desired,
    applied,
    removed: del.removed,
    notes,
  };
}

/**
 * List live UFW rules tagged with ysk-svc for a service (or all).
 */
export async function listManagedServiceRules(
  host: HostExecutor,
  serviceId?: string,
): Promise<Array<{ num?: number; comment?: string; raw: string; from?: string; to?: string }>> {
  const num = await host.runCommand(['ufw', 'status', 'numbered'], { timeoutMs: 10_000 });
  const body = `${num.stdout || ''}`.trim();
  const rules = parseUfwNumbered(
    body
      .split('\n')
      .map((l) => l.trim())
      .filter((t) => /^\[\s*\d+\]/.test(t)),
  );
  const prefix = serviceId ? yskSvcCommentPrefix(serviceId) : 'ysk-svc:';
  return rules
    .filter((r) => {
      const c = r.comment || extractUfwComment(r.raw) || '';
      return c.startsWith(prefix) || c === prefix.replace(/:$/, '');
    })
    .map((r) => ({
      num: r.num,
      comment: r.comment,
      raw: r.raw,
      from: r.from,
      to: r.to,
    }));
}

/**
 * Snapshot for GET: desired + applied rule summary.
 */
export async function getServiceExposureStatus(
  host: HostExecutor,
  dataDir: string,
  serviceId: string,
): Promise<{
  desired: ServiceExposureDesired;
  liveRules: Awaited<ReturnType<typeof listManagedServiceRules>>;
  inSync: boolean;
  defaultMode: import('@ysk/shared').ExposureMode;
}> {
  const store = loadExposureStore(dataDir);
  const desired = ensureDesired(store, serviceId);
  // do not auto-persist on GET
  const liveRules = await listManagedServiceRules(host, serviceId);
  const targets = buildTargetRules(desired);
  const inSync =
    desired.mode === 'private'
      ? liveRules.length === 0
      : liveRules.length >= targets.length && targets.length > 0
        ? true
        : targets.length === 0
          ? liveRules.length === 0
          : false;

  return {
    desired,
    liveRules,
    inSync,
    defaultMode: defaultExposureMode(serviceId),
  };
}

/** PUT helper — update mode/allowFrom then optional sync. */
export async function putServiceExposure(input: {
  host: HostExecutor;
  dataDir: string;
  serviceId: string;
  mode?: ServiceExposureDesired['mode'];
  ports?: ServicePortBinding[];
  allowFrom?: string[];
  allowCountries?: string[];
  sync?: boolean;
}): Promise<SyncServiceExposureResult | { ok: true; desired: ServiceExposureDesired; notes: string[] }> {
  const desired = upsertDesired(input.dataDir, input.serviceId, {
    mode: input.mode,
    ports: input.ports,
    allowFrom: input.allowFrom,
    allowCountries: input.allowCountries,
    decided: true,
  });

  if (input.sync === false) {
    return { ok: true, desired, notes: [] };
  }

  return syncServiceExposure({
    host: input.host,
    dataDir: input.dataDir,
    serviceId: input.serviceId,
    ports: desired.ports,
    reason: 'manual',
    exposureDecision:
      desired.mode === 'private'
        ? 'keep-private'
        : desired.mode === 'restricted'
          ? 'restricted'
          : 'public',
    allowFrom: desired.allowFrom,
    requireDecision: false,
  });
}
