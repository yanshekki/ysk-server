/**
 * Version-aware service setting catalog types.
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
  label: string;
  category: SettingCategoryId;
  type: SettingType;
  unit?: string;
  enumValues?: string[];
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

export const CATEGORY_META: Record<
  SettingCategoryId,
  { label: string; order: number; description: string }
> = {
  overview: { label: '概覽', order: 0, description: '狀態與版本' },
  lifecycle: { label: '生命週期', order: 1, description: '啟動、停止、重啟、開機自啟' },
  network: { label: '連線與網路', order: 2, description: '埠、綁定、連線上限' },
  performance: { label: '效能與資源', order: 3, description: '記憶體、緩衝、併發' },
  persistence: { label: '持久化', order: 4, description: '磁碟、備份、AOF/WAL' },
  logging: { label: '日誌', order: 5, description: '錯誤日誌、慢查詢' },
  security: { label: '安全', order: 6, description: '密碼、TLS、本機限制' },
  advanced: { label: '進階', order: 7, description: '其他執行期變數' },
};

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
