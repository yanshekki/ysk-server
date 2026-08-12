/**
 * Configuration load / validate for YSK Server control plane.
 */

import { ErrorCodes, YskError, type SetupConfigDto, tl} from 'ysk-server-shared';

export interface YskConfig {
  version: number;
  product: 'ysk-server';
  dataDir: string;
  listenHost: string;
  listenPort: number;
  adminUsername: string;
  locale: string;
  setupCompleted: boolean;
  createdAt: string;
  /**
   * Control-plane TLS (panel HTTPS). When enabled and cert/key files exist,
   * `ysk-server serve` binds HTTPS on listenPort.
   */
  tlsEnabled?: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  /** Domain used for panel LE / URL hints (e.g. demo.ysk.hk) */
  panelDomain?: string;
  /**
   * When TLS is on, also bind plain HTTP on this port (default listenPort-1 if > 1024).
   * Used for migration / health; optional redirect to HTTPS.
   */
  httpListenPort?: number;
  /** If dual HTTP is up, 301 to HTTPS (default true) */
  tlsHttpRedirect?: boolean;
  /**
   * When true (recommended for bootstrap / production IP install),
   * never bind a companion plain-HTTP listener — HTTPS only.
   */
  tlsHttpsOnly?: boolean;
}

const DEFAULTS = {
  version: 1 as const,
  product: 'ysk-server' as const,
  listenHost: '127.0.0.1',
  /** 4-digit control-plane port; avoid common 3000/5173/8080/8787 */
  listenPort: 9287,
  adminUsername: 'admin',
  locale: 'zh-HK',
};

/**
 * Validate and normalize a setup DTO into a persisted config object.
 */
export function buildConfigFromSetup(input: Partial<SetupConfigDto> & { dataDir: string }): YskConfig {
  if (!input.dataDir || typeof input.dataDir !== 'string') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1402'), { httpStatus: 400 });
  }
  const port = input.listenPort ?? DEFAULTS.listenPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.t0001', { v0: (port) }), { httpStatus: 400 });
  }
  const host = input.listenHost ?? DEFAULTS.listenHost;
  if (!host || typeof host !== 'string') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1403'), { httpStatus: 400 });
  }
  return {
    version: DEFAULTS.version,
    product: DEFAULTS.product,
    dataDir: input.dataDir,
    listenHost: host,
    listenPort: port,
    adminUsername: input.adminUsername ?? DEFAULTS.adminUsername,
    locale: input.locale ?? DEFAULTS.locale,
    setupCompleted: true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Parse raw JSON config and validate shape.
 */
export function parseConfig(raw: unknown): YskConfig {
  if (!raw || typeof raw !== 'object') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1372'), { httpStatus: 400 });
  }
  const o = raw as Record<string, unknown>;
  if (o.product !== 'ysk-server') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1371'), {
      httpStatus: 400,
    });
  }
  if (typeof o.dataDir !== 'string' || !o.dataDir) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1373'), { httpStatus: 400 });
  }
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    product: 'ysk-server',
    dataDir: o.dataDir,
    listenHost: typeof o.listenHost === 'string' ? o.listenHost : DEFAULTS.listenHost,
    listenPort: typeof o.listenPort === 'number' ? o.listenPort : DEFAULTS.listenPort,
    adminUsername: typeof o.adminUsername === 'string' ? o.adminUsername : DEFAULTS.adminUsername,
    locale: typeof o.locale === 'string' ? o.locale : DEFAULTS.locale,
    setupCompleted: Boolean(o.setupCompleted),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    tlsEnabled: Boolean(o.tlsEnabled),
    tlsCertPath: typeof o.tlsCertPath === 'string' ? o.tlsCertPath : undefined,
    tlsKeyPath: typeof o.tlsKeyPath === 'string' ? o.tlsKeyPath : undefined,
    panelDomain: typeof o.panelDomain === 'string' ? o.panelDomain : undefined,
    httpListenPort:
      typeof o.httpListenPort === 'number' &&
      Number.isInteger(o.httpListenPort) &&
      o.httpListenPort > 0 &&
      o.httpListenPort < 65536
        ? o.httpListenPort
        : undefined,
    tlsHttpRedirect: o.tlsHttpRedirect === undefined ? true : Boolean(o.tlsHttpRedirect),
    tlsHttpsOnly: Boolean(o.tlsHttpsOnly),
  };
}

/** Default companion HTTP port when TLS is on (avoid privileged 80). */
export function defaultHttpListenPort(httpsPort: number): number {
  if (httpsPort > 1024) return httpsPort - 1;
  return 9286;
}

/** Merge TLS / panel fields into existing config (persist-safe). */
export function mergePanelTlsConfig(
  base: YskConfig,
  patch: {
    tlsEnabled?: boolean;
    tlsCertPath?: string | null;
    tlsKeyPath?: string | null;
    panelDomain?: string | null;
    tlsHttpsOnly?: boolean;
    listenHost?: string;
  },
): YskConfig {
  const next: YskConfig = { ...base };
  if (patch.tlsEnabled !== undefined) next.tlsEnabled = patch.tlsEnabled;
  if (patch.tlsCertPath !== undefined) {
    next.tlsCertPath = patch.tlsCertPath || undefined;
  }
  if (patch.tlsKeyPath !== undefined) {
    next.tlsKeyPath = patch.tlsKeyPath || undefined;
  }
  if (patch.panelDomain !== undefined) {
    next.panelDomain = patch.panelDomain?.trim() || undefined;
  }
  if (patch.tlsHttpsOnly !== undefined) next.tlsHttpsOnly = patch.tlsHttpsOnly;
  if (patch.listenHost !== undefined && patch.listenHost.trim()) {
    next.listenHost = patch.listenHost.trim();
  }
  // HTTPS-only: drop companion HTTP port so dual bind is skipped
  if (next.tlsHttpsOnly) {
    next.httpListenPort = undefined;
  }
  return next;
}
