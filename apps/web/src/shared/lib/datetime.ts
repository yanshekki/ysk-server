/**
 * Panel-wide timestamps: one 24-hour clock, YYYY-MM-DD HH:mm:ss.
 * Do not call Date#toLocaleString() in pages — it mixes US AM/PM and locales.
 */

export function formatDateTime(
  iso: string | number | Date | null | undefined,
  opts?: { locale?: string; timeZone?: string | null },
): string {
  if (iso == null || iso === '') return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
    });
    const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const p of fmt.formatToParts(d)) {
      if (p.type !== 'literal') bag[p.type] = p.value;
    }
    const hour = bag.hour === '24' ? '00' : (bag.hour ?? '00');
    return `${bag.year}-${bag.month}-${bag.day} ${hour}:${bag.minute}:${bag.second}`;
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
}
