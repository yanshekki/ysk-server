/**
 * Panel-wide timestamps: UI locale + optional host timezone.
 * Avoid mixing browser locale, hardcoded zh-HK, and UTC-less toLocaleString().
 */

const LOCALE_BCP47: Record<string, string> = {
  'zh-HK': 'zh-HK',
  'zh-CN': 'zh-CN',
  en: 'en-GB',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es',
  fr: 'fr',
  pt: 'pt',
  ar: 'ar',
  hi: 'hi',
  id: 'id',
  bn: 'bn',
  ur: 'ur',
};

export function formatDateTime(
  iso: string | number | Date | null | undefined,
  opts?: { locale?: string; timeZone?: string | null },
): string {
  if (iso == null || iso === '') return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const locale = LOCALE_BCP47[opts?.locale ?? ''] ?? opts?.locale ?? undefined;
  try {
    return d.toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
    });
  } catch {
    return d.toISOString();
  }
}
