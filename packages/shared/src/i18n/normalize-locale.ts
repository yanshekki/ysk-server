/**
 * Supported UI/API locales. zh-HK = 香港書面語（繁體）.
 */
export type LocaleCode = 'zh-HK' | 'zh-CN' | 'en';

export const LOCALES: readonly LocaleCode[] = ['zh-HK', 'zh-CN', 'en'] as const;

export const DEFAULT_LOCALE: LocaleCode = 'zh-HK';

/** Display names (in that language where possible) */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  'zh-HK': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
};

/**
 * Normalize Accept-Language / stored user locale to a supported code.
 * zh-TW and bare zh → zh-HK (香港書面語).
 */
export function normalizeLocale(input?: string | null): LocaleCode {
  if (!input || typeof input !== 'string') return DEFAULT_LOCALE;
  const raw = input.trim().replace('_', '-');
  const lower = raw.toLowerCase();

  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'zh-cn' || lower === 'zh-hans' || lower.startsWith('zh-hans')) {
    return 'zh-CN';
  }
  if (
    lower === 'zh-hk' ||
    lower === 'zh-tw' ||
    lower === 'zh-hant' ||
    lower.startsWith('zh-hant') ||
    lower === 'zh' ||
    lower.startsWith('zh-')
  ) {
    // Default Chinese → Hong Kong written Traditional
    if (lower === 'zh-cn' || lower.startsWith('zh-cn') || lower.includes('hans')) {
      return 'zh-CN';
    }
    return 'zh-HK';
  }
  return DEFAULT_LOCALE;
}

/** Parse Accept-Language header (first matching supported tag). */
export function localeFromAcceptLanguage(header?: string | null): LocaleCode {
  if (!header) return DEFAULT_LOCALE;
  const parts = header.split(',').map((p) => p.trim().split(';')[0]?.trim());
  for (const p of parts) {
    if (!p) continue;
    const n = normalizeLocale(p);
    // Only accept if the raw tag is related to our result
    if (p.toLowerCase().startsWith('en')) return 'en';
    if (p.toLowerCase().includes('cn') || p.toLowerCase().includes('hans')) return 'zh-CN';
    if (p.toLowerCase().startsWith('zh')) return 'zh-HK';
    if (n) return n;
  }
  return DEFAULT_LOCALE;
}
