import { formatDateTime } from '../../shared/lib/datetime';

/** Human-readable byte count. */
export function formatVpnBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Bytes/sec → human rate. */
export function formatVpnRate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  const units = ['KB/s', 'MB/s', 'GB/s'];
  let v = bps / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatVpnWhen(iso: string | null | undefined): string {
  return formatDateTime(iso);
}
