/** Locale-aware dates. zh-* uses ISO YYYY-MM-DD (not US M/D/Y). */
export function formatDateLocale(value: string | Date, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const loc = locale.toLowerCase();
  if (loc.startsWith('zh')) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return d.toLocaleDateString(locale);
}

export function formatDateTimeLocale(value: string | Date, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const loc = locale.toLowerCase();
  if (loc.startsWith('zh')) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${formatDateLocale(d, locale)} ${hh}:${mm}:${ss}`;
  }
  return d.toLocaleString(locale);
}
