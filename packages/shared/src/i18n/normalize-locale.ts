/**
 * Supported UI/API locales.
 * Tier-1: zh-HK (香港書面語), zh-CN, en — quality bar.
 * Tier-2: world languages (+ ja, ko); full catalogs, key-parity with en.
 */
export type LocaleCode =
  | 'zh-HK'
  | 'zh-CN'
  | 'en'
  | 'ja'
  | 'ko'
  | 'hi'
  | 'es'
  | 'ar'
  | 'fr'
  | 'bn'
  | 'pt'
  | 'id'
  | 'ur';

export const LOCALES: readonly LocaleCode[] = [
  'zh-HK',
  'zh-CN',
  'en',
  'ja',
  'ko',
  'hi',
  'es',
  'ar',
  'fr',
  'bn',
  'pt',
  'id',
  'ur',
] as const;

export const DEFAULT_LOCALE: LocaleCode = 'zh-HK';

/** Locales that require RTL document direction */
export const RTL_LOCALES: readonly LocaleCode[] = ['ar', 'ur'] as const;

/** Display names (in that language where possible) */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'zh-HK': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  hi: 'हिन्दी',
  es: 'Español',
  ar: 'العربية',
  fr: 'Français',
  bn: 'বাংলা',
  pt: 'Português',
  id: 'Bahasa Indonesia',
  ur: 'اردو',
};

const SUPPORTED = new Set<string>(LOCALES);

const TIER2_PRIMARY = new Set([
  'ja',
  'ko',
  'hi',
  'es',
  'ar',
  'fr',
  'bn',
  'pt',
  'id',
  'ur',
]);

/**
 * Normalize Accept-Language / stored user locale to a supported code.
 * zh-TW and bare zh → zh-HK (香港書面語).
 */
export function normalizeLocale(input?: string | null): LocaleCode {
  if (!input || typeof input !== 'string') return DEFAULT_LOCALE;
  const raw = input.trim().replace('_', '-');
  const lower = raw.toLowerCase();
  const primary = lower.split('-')[0] ?? lower;

  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  // Simplified Chinese (before generic zh-* → HK)
  if (
    lower === 'zh-cn' ||
    lower.startsWith('zh-cn-') ||
    lower === 'zh-hans' ||
    lower.startsWith('zh-hans') ||
    lower.includes('hans')
  ) {
    return 'zh-CN';
  }
  if (
    lower === 'zh-hk' ||
    lower.startsWith('zh-hk-') ||
    lower === 'zh-tw' ||
    lower.startsWith('zh-tw-') ||
    lower === 'zh-hant' ||
    lower.startsWith('zh-hant') ||
    lower === 'zh' ||
    lower.startsWith('zh-')
  ) {
    return 'zh-HK';
  }

  // Exact or primary match for all supported
  for (const code of LOCALES) {
    if (lower === code.toLowerCase() || primary === code.toLowerCase()) {
      return code;
    }
  }
  // Regional tags
  if (primary === 'es') return 'es';
  if (primary === 'pt') return 'pt';
  if (primary === 'ar') return 'ar';
  if (primary === 'fr') return 'fr';
  if (primary === 'hi') return 'hi';
  if (primary === 'bn') return 'bn';
  if (primary === 'id' || primary === 'in') return 'id';
  if (primary === 'ur') return 'ur';
  if (primary === 'ja') return 'ja';
  if (primary === 'ko') return 'ko';

  if (SUPPORTED.has(raw as LocaleCode)) return raw as LocaleCode;
  return DEFAULT_LOCALE;
}

export function isRtlLocale(input?: string | null): boolean {
  const code = normalizeLocale(input);
  return (RTL_LOCALES as readonly string[]).includes(code);
}

/** Parse Accept-Language header (first matching supported tag). */
export function localeFromAcceptLanguage(header?: string | null): LocaleCode {
  if (!header) return DEFAULT_LOCALE;
  const parts = header.split(',').map((p) => p.trim().split(';')[0]?.trim());
  for (const p of parts) {
    if (!p) continue;
    const lower = p.toLowerCase();
    if (lower.startsWith('en')) return 'en';
    if (lower.includes('cn') || lower.includes('hans')) return 'zh-CN';
    if (lower.startsWith('zh')) return 'zh-HK';
    const n = normalizeLocale(p);
    if (n !== DEFAULT_LOCALE || lower.startsWith('zh')) return n;
    const primary = lower.split('-')[0] ?? '';
    if (TIER2_PRIMARY.has(primary)) {
      return normalizeLocale(primary);
    }
  }
  return DEFAULT_LOCALE;
}
