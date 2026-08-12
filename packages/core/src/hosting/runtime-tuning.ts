import { tl } from '@ysk-server/shared';
/**
 * Per-runtime tuning catalogs + JSON persistence for Node/Python/Go/Rust.
 * Applied as Environment= on systemd unit / deploy env.
 *
 * Catalog titles/hints must be i18n *keys* (or plain English labels), never
 * tl() at module load — that freezes the default locale (zh-HK).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type TuningKind = 'node' | 'python' | 'go' | 'rust';

export type TuningFieldType = 'string' | 'int' | 'bool' | 'select';

export interface TuningField {
  key: string;
  /** Display label or i18n key (notes.*) */
  label: string;
  type: TuningFieldType;
  default: string | number | boolean;
  /** Hint text or i18n key (notes.*) */
  hint?: string;
  /** maps to env var name (default key) */
  env?: string;
  /** option labels may be i18n keys */
  options?: Array<{ value: string; label: string }>;
  group: string;
}

export interface TuningGroup {
  id: string;
  /** Title text or i18n key (notes.*) */
  title: string;
  fields: TuningField[];
}

export interface RuntimeTuningSettings {
  kind: TuningKind;
  version: string;
  values: Record<string, string | number | boolean>;
  /** freeform env */
  env: Record<string, string>;
  updatedAt?: string;
}

function isI18nKey(s?: string | null): boolean {
  if (!s) return false;
  return /^(notes|ops|errors|runtime|common)\./.test(s);
}

function resolveText(s: string): string {
  return isI18nKey(s) ? tl(s) : s;
}

/** Static catalogs — keys only for localizable strings. */
const CATALOGS: Record<TuningKind, TuningGroup[]> = {
  node: [
    {
      id: 'memory',
      title: 'notes.auto.n1360',
      fields: [
        {
          key: 'max_old_space_size',
          label: 'max-old-space-size (MB)',
          type: 'int',
          default: 512,
          hint: 'notes.auto.n0673',
          env: 'NODE_OPTIONS_MAX_OLD_SPACE',
          group: 'memory',
        },
        {
          key: 'max_http_header_size',
          label: 'max-http-header-size',
          type: 'int',
          default: 16384,
          group: 'memory',
        },
      ],
    },
    {
      id: 'runtime',
      title: 'notes.auto.n0634',
      fields: [
        {
          key: 'node_env',
          label: 'NODE_ENV',
          type: 'select',
          default: 'production',
          options: [
            { value: 'production', label: 'production' },
            { value: 'development', label: 'development' },
          ],
          env: 'NODE_ENV',
          group: 'runtime',
        },
        {
          key: 'uv_threadpool_size',
          label: 'UV_THREADPOOL_SIZE',
          type: 'int',
          default: 4,
          env: 'UV_THREADPOOL_SIZE',
          group: 'runtime',
        },
      ],
    },
  ],
  python: [
    {
      id: 'py',
      title: 'notes.auto.n0165',
      fields: [
        {
          key: 'pythonoptimize',
          label: 'PYTHONOPTIMIZE',
          type: 'select',
          default: '0',
          options: [
            { value: '0', label: 'notes.auto.n0062' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
          ],
          env: 'PYTHONOPTIMIZE',
          group: 'py',
        },
        {
          key: 'dont_write_bytecode',
          label: 'PYTHONDONTWRITEBYTECODE',
          type: 'bool',
          default: true,
          env: 'PYTHONDONTWRITEBYTECODE',
          group: 'py',
        },
        {
          key: 'uvicorn_workers',
          label: 'notes.auto.n1598',
          type: 'int',
          default: 2,
          hint: 'notes.auto.n1499',
          group: 'py',
        },
      ],
    },
  ],
  go: [
    {
      id: 'go',
      title: 'notes.auto.n0112',
      fields: [
        {
          key: 'gomaxprocs',
          label: 'GOMAXPROCS',
          type: 'int',
          default: 0,
          hint: 'notes.auto.n0061',
          env: 'GOMAXPROCS',
          group: 'go',
        },
        {
          key: 'gogc',
          label: 'GOGC',
          type: 'int',
          default: 100,
          env: 'GOGC',
          group: 'go',
        },
        {
          key: 'gomemlimit',
          label: 'GOMEMLIMIT',
          type: 'string',
          default: '',
          hint: 'notes.auto.n0551',
          env: 'GOMEMLIMIT',
          group: 'go',
        },
      ],
    },
  ],
  rust: [
    {
      id: 'rust',
      title: 'notes.auto.n0178',
      fields: [
        {
          key: 'rust_log',
          label: 'RUST_LOG',
          type: 'string',
          default: 'info',
          env: 'RUST_LOG',
          group: 'rust',
        },
        {
          key: 'rust_backtrace',
          label: 'RUST_BACKTRACE',
          type: 'select',
          default: '0',
          options: [
            { value: '0', label: '0' },
            { value: '1', label: '1' },
            { value: 'full', label: 'full' },
          ],
          env: 'RUST_BACKTRACE',
          group: 'rust',
        },
        {
          key: 'rustflags',
          label: 'notes.auto.n0168',
          type: 'string',
          default: '',
          env: 'RUSTFLAGS',
          group: 'rust',
        },
      ],
    },
  ],
};

/** Catalog under current request locale. */
export function listTuningCatalog(kind: TuningKind): TuningGroup[] {
  return (CATALOGS[kind] ?? []).map((g) => ({
    ...g,
    title: resolveText(g.title),
    fields: g.fields.map((f) => ({
      ...f,
      label: resolveText(f.label),
      hint: f.hint != null ? resolveText(f.hint) : f.hint,
      options: f.options?.map((o) => ({
        ...o,
        label: resolveText(o.label),
      })),
    })),
  }));
}

export function defaultTuningValues(kind: TuningKind): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const g of CATALOGS[kind] ?? []) {
    for (const f of g.fields) out[f.key] = f.default;
  }
  return out;
}

function pathFor(dataDir: string, kind: TuningKind, version: string): string {
  return join(dataDir, 'runtimes', kind, version || 'default', 'tuning.json');
}

export function loadRuntimeTuning(
  dataDir: string,
  kind: TuningKind,
  version = 'default',
): RuntimeTuningSettings {
  const p = pathFor(dataDir, kind, version);
  if (!existsSync(p)) {
    return {
      kind,
      version,
      values: defaultTuningValues(kind),
      env: {},
    };
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as RuntimeTuningSettings;
    return {
      kind,
      version,
      values: { ...defaultTuningValues(kind), ...(raw.values ?? {}) },
      env: raw.env ?? {},
      updatedAt: raw.updatedAt,
    };
  } catch {
    return { kind, version, values: defaultTuningValues(kind), env: {} };
  }
}

export function saveRuntimeTuning(
  dataDir: string,
  settings: RuntimeTuningSettings,
): { settings: RuntimeTuningSettings; written: string[] } {
  const version = settings.version || 'default';
  const dir = join(dataDir, 'runtimes', settings.kind, version);
  mkdirSync(dir, { recursive: true });
  const next: RuntimeTuningSettings = {
    ...settings,
    version,
    values: { ...defaultTuningValues(settings.kind), ...settings.values },
    env: settings.env ?? {},
    updatedAt: new Date().toISOString(),
  };
  const p = pathFor(dataDir, settings.kind, version);
  writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return { settings: next, written: [p] };
}

/**
 * Flatten tuning to env map for systemd / spawn.
 */
export function tuningToEnv(settings: RuntimeTuningSettings): Record<string, string> {
  const env: Record<string, string> = { ...settings.env };
  const catalog = listTuningCatalog(settings.kind);
  const fieldByKey = new Map<string, TuningField>();
  for (const g of catalog) for (const f of g.fields) fieldByKey.set(f.key, f);

  // Node special: build NODE_OPTIONS
  if (settings.kind === 'node') {
    const parts: string[] = [];
    const old = settings.values.max_old_space_size;
    if (old != null && Number(old) > 0) parts.push(`--max-old-space-size=${old}`);
    const hdr = settings.values.max_http_header_size;
    if (hdr != null && Number(hdr) > 0) parts.push(`--max-http-header-size=${hdr}`);
    if (parts.length) env.NODE_OPTIONS = [env.NODE_OPTIONS, ...parts].filter(Boolean).join(' ');
  }

  for (const [k, v] of Object.entries(settings.values)) {
    const f = fieldByKey.get(k);
    if (!f?.env) continue;
    if (f.env === 'NODE_OPTIONS_MAX_OLD_SPACE') continue; // handled
    if (v === '' || v === undefined || v === null) continue;
    if (typeof v === 'boolean') env[f.env] = v ? '1' : '0';
    else if (f.env === 'GOMAXPROCS' && Number(v) === 0) continue;
    else if (f.env === 'GOMEMLIMIT' && !String(v).trim()) continue;
    else if (f.env === 'RUSTFLAGS' && !String(v).trim()) continue;
    else env[f.env] = String(v);
  }
  return env;
}
