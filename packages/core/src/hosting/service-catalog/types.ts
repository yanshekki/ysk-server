import { tl } from '@ysk-server/shared';
/**
 * Version-aware service setting catalog types.
 *
 * Catalog strings must be i18n *keys* (or plain English fallbacks), never
 * `tl(...)` at module load — that freezes the default locale (zh-HK).
 */

export type ServiceEngine = 'mysql' | 'mariadb' | 'postgres' | 'redis';

export type SettingCategoryId =
  | 'overview'
  | 'lifecycle'
  | 'network'
  | 'performance'
  | 'persistence'
  | 'logging'
  | 'security'
  | 'advanced';

export type SettingType = 'int' | 'bool' | 'string' | 'enum' | 'bytes' | 'duration';

/** How change is applied */
export type ApplyMode = 'runtime' | 'reload' | 'restart' | 'conf_only' | 'lifecycle';

export interface SettingDef {
  key: string;
  /**
   * Display label or i18n key (`notes.*`). Resolved with resolveSettingDef().
   */
  label: string;
  category: SettingCategoryId;
  type: SettingType;
  unit?: string;
  enumValues?: string[];
  /** Description or i18n key (`notes.*`). Resolved with resolveSettingDef(). */
  description?: string;
  applyMode: ApplyMode;
  /** Semver major.minor minimum, e.g. "8.0" */
  minVersion?: string;
  maxVersion?: string;
  danger?: boolean;
  advanced?: boolean;
  /** Maps to engine-specific conf/var name if different from key */
  confKey?: string;
}

/** True when s looks like a shared catalog key, not a human string. */
export function isI18nKey(s?: string | null): boolean {
  if (!s) return false;
  return /^(notes|ops|errors|db|common|services)\./.test(s);
}

/** Translate catalog string if it is a key; otherwise pass through. */
export function resolveCatalogText(s: string): string {
  return isI18nKey(s) ? tl(s) : s;
}

export function resolveSettingDef(d: SettingDef): SettingDef {
  return {
    ...d,
    label: resolveCatalogText(d.label),
    description: d.description != null ? resolveCatalogText(d.description) : d.description,
  };
}

/**
 * Static category meta — keys only; resolve with resolveCategoryMeta().
 */
export const CATEGORY_META: Record<
  SettingCategoryId,
  { labelKey: string; order: number; descriptionKey: string }
> = {
  overview: { labelKey: 'notes.auto.n1010', order: 0, descriptionKey: 'notes.auto.n1206' },
  lifecycle: { labelKey: 'notes.auto.n1242', order: 1, descriptionKey: 'notes.auto.n0619' },
  network: { labelKey: 'notes.auto.n1468', order: 2, descriptionKey: 'notes.auto.n0632' },
  performance: { labelKey: 'notes.auto.n0900', order: 3, descriptionKey: 'notes.auto.n1355' },
  persistence: { labelKey: 'notes.auto.n0881', order: 4, descriptionKey: 'notes.auto.n1291' },
  logging: { labelKey: 'notes.auto.n0915', order: 5, descriptionKey: 'notes.auto.n1517' },
  security: {
    labelKey: 'notes.readiness.security',
    order: 6,
    descriptionKey: 'notes.tpl.securityDesc',
  },
  advanced: { labelKey: 'notes.auto.n1471', order: 7, descriptionKey: 'notes.auto.n0593' },
};

export function resolveCategoryMeta(id: SettingCategoryId): {
  label: string;
  order: number;
  description: string;
} {
  const m = CATEGORY_META[id];
  return {
    label: tl(m.labelKey),
    order: m.order,
    description: tl(m.descriptionKey),
  };
}

export function parseVersion(v?: string | null): { major: number; minor: number; raw: string } {
  const raw = (v ?? '').trim();
  const m = raw.match(/(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 0, raw };
  return { major: Number(m[1]), minor: Number(m[2]), raw };
}

export function versionGte(v: string | undefined, min?: string): boolean {
  if (!min) return true;
  const a = parseVersion(v);
  const b = parseVersion(min);
  if (a.major !== b.major) return a.major > b.major;
  return a.minor >= b.minor;
}

export function versionLte(v: string | undefined, max?: string): boolean {
  if (!max) return true;
  const a = parseVersion(v);
  const b = parseVersion(max);
  if (a.major !== b.major) return a.major < b.major;
  return a.minor <= b.minor;
}

export function filterDefsByVersion(defs: SettingDef[], version?: string): SettingDef[] {
  return defs.filter(
    (d) => versionGte(version, d.minVersion) && versionLte(version, d.maxVersion),
  );
}
