/**
 * Configuration load / validate for YSK Server control plane.
 */

import { ErrorCodes, YskError, type SetupConfigDto } from '@ysk/shared';

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
}

const DEFAULTS = {
  version: 1 as const,
  product: 'ysk-server' as const,
  listenHost: '127.0.0.1',
  listenPort: 8787,
  adminUsername: 'admin',
  locale: 'zh-TW',
};

/**
 * Validate and normalize a setup DTO into a persisted config object.
 */
export function buildConfigFromSetup(input: Partial<SetupConfigDto> & { dataDir: string }): YskConfig {
  if (!input.dataDir || typeof input.dataDir !== 'string') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'dataDir is required', { httpStatus: 400 });
  }
  const port = input.listenPort ?? DEFAULTS.listenPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, `Invalid listenPort: ${port}`, { httpStatus: 400 });
  }
  const host = input.listenHost ?? DEFAULTS.listenHost;
  if (!host || typeof host !== 'string') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'listenHost is required', { httpStatus: 400 });
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
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'Config must be an object', { httpStatus: 400 });
  }
  const o = raw as Record<string, unknown>;
  if (o.product !== 'ysk-server') {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'Config product must be ysk-server', {
      httpStatus: 400,
    });
  }
  if (typeof o.dataDir !== 'string' || !o.dataDir) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'Config missing dataDir', { httpStatus: 400 });
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
  };
}
