/**
 * Browser-safe entry for ysk-server-shared.
 * No node:fs / node:async_hooks — web must import only this surface.
 */
export * from './types.js';
export * from './dto.js';
export * from './ops.js';
export * from './migrate.js';
export * from './cdn.js';
export * from './metrics.js';
export * from './network.js';
export * from './system.js';
export * from './databases.js';
export * from './ftp.js';
export * from './files.js';
export * from './email-domain.js';
export * from './fleet.js';
export * from './software.js';
export * from './ssl.js';
export * from './updates.js';
export * from './validators.js';
export * from './ai.js';
export * from './capabilities.js';
export * from './route-capabilities.js';
export * from './service-ports.js';
/** Unified list search/filter (browser-safe pure helpers) */
export * from './list-query.js';

/** Locale helpers only (no server t()/tl() loaders) */
export {
  type LocaleCode,
  LOCALES,
  DEFAULT_LOCALE,
  RTL_LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  isRtlLocale,
  localeFromAcceptLanguage,
} from './i18n/normalize-locale.js';

/**
 * Error codes as constants only — YskError / yskError / tl live on the Node entry.
 * Web UI should not construct server errors.
 */
export { ErrorCodes, type ErrorCode } from './errors-codes.js';
