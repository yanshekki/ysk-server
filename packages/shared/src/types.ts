/**
 * Shared domain enums and utility types for YSK Server.
 */

/** Product surface name constants */
export const PRODUCT_NAME = 'YSK Server' as const;
export const CLI_NAME = 'ysk-server' as const;
export const PACKAGE_NAME = 'ysk-server' as const;

/** Operation levels for three-axis RBAC */
export type OperationLevel =
  | 'read'
  | 'write-low'
  | 'write-high'
  | 'destructive'
  | 'privilege';

/** Resource scope kinds */
export type ResourceScopeKind = 'global' | 'server' | 'project';

/** Built-in roles */
export type SystemRole = 'admin' | 'operator' | 'viewer' | 'agent';

/** Approval workflow status */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';

/** Risk tier for tools / updates */
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

/** Update recommendation from intelligent update system */
export type UpdateAdvice = 'update' | 'watch' | 'urgent' | 'skip';

/** Protection / offline mode */
export type ProtectionMode = 'normal' | 'degraded' | 'offline' | 'ddos-protection';

/** Supported AI agent runtimes */
export type AgentRuntimeKind = 'openclaw' | 'hermes' | 'ionclaw';

/** Hosting runtime kinds (project + host install) */
export type HostingRuntime =
  | 'node'
  | 'php'
  | 'static'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun';

/** Re-export apply lifecycle for discoverability (canonical: ops.ts) */
export type { ApplyStatus } from './ops.js';

/** Structured CLI output envelope */
export interface StructuredResult<T = unknown> {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Resource scope reference */
export interface ResourceScope {
  kind: ResourceScopeKind;
  id?: string;
}

/**
 * Locale codes — canonical in i18n/normalize-locale.ts.
 * zh-HK = 香港書面語（繁體）SSOT. Browser tag zh-TW is accepted only as alias → zh-HK.
 */
export type { LocaleCode } from './i18n/normalize-locale.js';
export {
  LOCALES,
  DEFAULT_LOCALE,
  RTL_LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  isRtlLocale,
  localeFromAcceptLanguage,
} from './i18n/normalize-locale.js';
