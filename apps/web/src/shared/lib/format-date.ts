/** Locale-aware dates. All locales use YYYY-MM-DD (not US M/D/Y). */
import { formatDateTime } from './datetime';

export function formatDateLocale(value: string | Date, _locale?: string): string {
  const full = formatDateTime(value);
  if (full === '—' || full.length < 10) return full;
  return full.slice(0, 10);
}

export function formatDateTimeLocale(
  value: string | Date,
  locale?: string,
): string {
  return formatDateTime(value, { locale });
}
