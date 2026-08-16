/**
 * Panel-wide timestamps: one 24-hour clock, YYYY-MM-DD HH:mm:ss.
 * Do not call Date#toLocaleString() in pages — it mixes US AM/PM and locales.
 */

export function formatTimeZoneOffset(
  date: Date,
  timeZone?: string | null,
): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      timeZoneName: 'shortOffset',
    });
    const name = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value;
    if (name) {
      const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
      if (m) {
        const hh = m[2].padStart(2, '0');
        const mm = (m[3] ?? '00').padStart(2, '0');
        if (Number(m[2]) === 0 && mm === '00') return 'UTC';
        return mm === '00' ? `UTC${m[1]}${Number(m[2])}` : `UTC${m[1]}${hh}:${mm}`;
      }
      if (/^UTC|GMT$/i.test(name)) return 'UTC';
    }
  } catch {
    /* fall through */
  }
  const min = -date.getTimezoneOffset();
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatDateTime(
  iso: string | number | Date | null | undefined,
  opts?: { locale?: string; timeZone?: string | null; withOffset?: boolean },
): string {
  if (iso == null || iso === '') return '—';
  const raw = typeof iso === 'string' ? iso.trim() : iso;
  const parsed =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
      ? new Date(raw.replace(' ', 'T') + 'Z')
      : raw instanceof Date
        ? raw
        : new Date(raw);
  const d = parsed;
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
    const base = `${bag.year}-${bag.month}-${bag.day} ${hour}:${bag.minute}:${bag.second}`;
    return opts?.withOffset ? `${base} ${formatTimeZoneOffset(d, opts.timeZone)}` : base;
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
}
