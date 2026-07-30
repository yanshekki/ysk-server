/**
 * Framework-free translator for API + CLI + tests.
 * Web UI uses i18next loaded from the same JSON catalogs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LOCALE,
  type LocaleCode,
  normalizeLocale,
} from './normalize-locale.js';

export type Dict = { [key: string]: string | Dict };

const cache = new Map<LocaleCode, Dict>();

function localesRoot(): string {
  // dist/i18n → ../../locales  OR src/i18n → ../../locales
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../locales'),
    join(here, '../../../locales'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'zh-HK', 'translation.json'))) return c;
  }
  return candidates[0]!;
}

export function loadLocaleDict(locale: LocaleCode): Dict {
  const hit = cache.get(locale);
  if (hit) return hit;
  const path = join(localesRoot(), locale, 'translation.json');
  try {
    const raw = readFileSync(path, 'utf8');
    const dict = JSON.parse(raw) as Dict;
    cache.set(locale, dict);
    return dict;
  } catch {
    if (locale !== DEFAULT_LOCALE) return loadLocaleDict(DEFAULT_LOCALE);
    cache.set(locale, {});
    return {};
  }
}

/** Clear cache (tests). */
export function clearLocaleCache(): void {
  cache.clear();
}

function getPath(dict: Dict, key: string): string | undefined {
  const parts = key.split('.');
  let cur: string | Dict | undefined = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(
  template: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    return v == null ? '' : String(v);
  });
}

/**
 * Translate a dotted key for a locale.
 * Missing key → fallback locale → key itself (honest, visible in dev).
 */
export function t(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  const loc = normalizeLocale(locale);
  const primary = getPath(loadLocaleDict(loc), key);
  if (primary != null) return interpolate(primary, params);
  if (loc !== DEFAULT_LOCALE) {
    const fb = getPath(loadLocaleDict(DEFAULT_LOCALE), key);
    if (fb != null) return interpolate(fb, params);
  }
  if (loc !== 'en') {
    const en = getPath(loadLocaleDict('en'), key);
    if (en != null) return interpolate(en, params);
  }
  return key;
}

/** Deep-merge namespace objects (for building translation bundles). */
export function mergeDicts(...dicts: Dict[]): Dict {
  const out: Dict = {};
  for (const d of dicts) {
    for (const [k, v] of Object.entries(d)) {
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        out[k] &&
        typeof out[k] === 'object'
      ) {
        out[k] = mergeDicts(out[k] as Dict, v as Dict);
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}
