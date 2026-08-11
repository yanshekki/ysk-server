/**
 * Service network exposure — desired firewall state for managed services.
 * SSOT types + comment helpers shared by core + web.
 */

import { YSK_SERVICE_PORTS, type ServicePortProto } from './service-ports.js';

/** How the service should be reachable from the network. */
export type ExposureMode = 'private' | 'public' | 'restricted';

export type ServicePortBinding = {
  /** e.g. listen | pasv | http | api — used in UFW comment role segment */
  role: string;
  /** Single port "21" or UFW range "30000:30100" */
  port: string;
  proto: ServicePortProto;
};

export type ServiceExposureDesired = {
  serviceId: string;
  mode: ExposureMode;
  ports: ServicePortBinding[];
  /** restricted only — IP or CIDR allowlist */
  allowFrom?: string[];
  /** L2: ISO country codes (optional, future) */
  allowCountries?: string[];
  /**
   * User has confirmed exposure for privateRecommended services.
   * When false and default is private, start may return needsExposureDecision.
   */
  decided?: boolean;
  updatedAt: string;
};

export type ServiceExposureStore = {
  version: 1;
  services: Record<string, ServiceExposureDesired>;
};

export type SyncReason = 'start' | 'apply' | 'port-change' | 'manual' | 'stop';

export type ExposureDecision = 'keep-private' | 'public' | 'restricted';

/** UFW comment prefix for managed service rules */
export const YSK_SVC_COMMENT_PREFIX = 'ysk-svc';

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/;

/** Sanitize serviceId / role for UFW comments. */
export function sanitizeSvcToken(raw: string): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'unknown';
}

/**
 * Full comment: `ysk-svc:<serviceId>:<role>`
 * Used on every allow rule so port-change can delete by prefix.
 */
export function yskSvcComment(serviceId: string, role: string): string {
  return `${YSK_SVC_COMMENT_PREFIX}:${sanitizeSvcToken(serviceId)}:${sanitizeSvcToken(role)}`;
}

/** Prefix matching all rules for a service: `ysk-svc:<serviceId>:` */
export function yskSvcCommentPrefix(serviceId: string): string {
  return `${YSK_SVC_COMMENT_PREFIX}:${sanitizeSvcToken(serviceId)}:`;
}

export function isValidServiceId(id: string): boolean {
  return SAFE_ID.test(String(id ?? '').trim());
}

/** Default mode from catalog: privateRecommended → private, else public. */
export function defaultExposureMode(serviceId: string): ExposureMode {
  const sid = String(serviceId ?? '').trim();
  const ports = YSK_SERVICE_PORTS.filter((p) => p.service === sid);
  if (ports.length === 0) return 'public';
  if (ports.some((p) => p.privateRecommended)) return 'private';
  return 'public';
}

/** Default port bindings from YSK_SERVICE_PORTS catalog. */
export function defaultPortsForService(serviceId: string): ServicePortBinding[] {
  const sid = String(serviceId ?? '').trim();
  return YSK_SERVICE_PORTS.filter((p) => p.service === sid).map((p) => ({
    role: p.id,
    port: p.port,
    proto: p.proto,
  }));
}

export function normalizePortBinding(raw: Partial<ServicePortBinding>): ServicePortBinding | null {
  const role = sanitizeSvcToken(String(raw.role ?? 'listen'));
  const port = String(raw.port ?? '').trim();
  if (!port) return null;
  const protoRaw = String(raw.proto ?? 'tcp').toLowerCase();
  const proto: ServicePortProto =
    protoRaw === 'udp' ? 'udp' : protoRaw === 'both' || protoRaw === 'any' ? 'both' : 'tcp';
  return { role, port, proto };
}

export function normalizeExposureMode(raw: unknown): ExposureMode {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'private' || s === 'restricted' || s === 'public') return s;
  return 'public';
}
