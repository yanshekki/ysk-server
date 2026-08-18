/**
 * Pure helpers for FTPS accounts + vsftpd service UI.
 */
import type { FtpsSettings, FtpsStatus } from 'ysk-server-shared';

/** TCP ports/ranges for panel firewall apply (listen + PASV + 990). */
export function ftpsOpenPortList(
  settings: Pick<FtpsSettings, 'listenPort' | 'pasvMin' | 'pasvMax'>,
): string[] {
  const listen = Number(settings.listenPort) || 21;
  const min = Number(settings.pasvMin) || 30000;
  const max = Number(settings.pasvMax) || 30100;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const ports = [String(listen), lo === hi ? String(lo) : `${lo}:${hi}`];
  if (listen !== 990) ports.push('990');
  return [...new Set(ports)];
}

export function statusLabel(
  s: FtpsStatus | null | undefined,
  t: (k: string) => string,
): { text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!s) return { text: t('common.loading'), tone: 'neutral' };
  if (!s.installed) return { text: t('common.notInstalled'), tone: 'danger' };
  if (s.active === 'active') return { text: t('common.running'), tone: 'ok' };
  if (s.active === 'inactive') return { text: t('common.stopped'), tone: 'warn' };
  if (s.active === 'failed') return { text: t('ftp.stateFailed'), tone: 'danger' };
  return { text: s.active || t('common.installed'), tone: 'warn' };
}

export const EMPTY_FTPS_SETTINGS: FtpsSettings = {
  listen: true,
  listenIpv6: false,
  listenPort: 21,
  bindAddress: 'localhost',
  sslEnable: false,
  forceSsl: false,
  sslDomain: '',
  pasvMin: 30000,
  pasvMax: 30100,
  writeEnable: true,
  chrootLocalUser: true,
  allowWriteableChroot: true,
  banner: 'YSK FTPS',
  guestUsername: 'ftp',
};

/** Parse SSH public key line → algorithm + short preview (for list UI). */
export function parseSshPubkeyMeta(publicKey: string): {
  algo: string;
  preview: string;
  comment: string;
} {
  const parts = String(publicKey || '')
    .trim()
    .split(/\s+/);
  const algo = parts[0] && /^ssh-|^ecdsa-|^sk-/.test(parts[0]) ? parts[0] : 'ssh';
  const body = parts[1] ?? String(publicKey || '').trim();
  const comment = parts.slice(2).join(' ').trim();
  const preview =
    body.length > 40 ? `${body.slice(0, 20)}…${body.slice(-12)}` : body || '—';
  return { algo, preview, comment };
}

export function filterSftpKeys<T extends { username: string }>(
  keys: T[],
  usernameFilter: string,
): T[] {
  const u = usernameFilter.trim();
  if (!u) return keys;
  return keys.filter((k) => k.username === u);
}

export function formatSftpKeyTime(iso: string): string {
  const s = String(iso || '');
  if (!s) return '—';
  return s.slice(0, 19).replace('T', ' ');
}

export function countApplyStatus(
  items: Array<Record<string, unknown>>,
): { applied: number; draft: number } {
  const applied = items.filter((r) => String(r.apply_status) === 'applied').length;
  return { applied, draft: items.length - applied };
}

export function accountPillTone(total: number, draft: number): 'ok' | 'warn' {
  return draft > 0 ? 'warn' : total ? 'ok' : 'warn';
}

export function buildFtpAccountBody(input: {
  username: string;
  password: string;
  homePath: string;
  domain: string;
}): {
  username: string;
  password_plain?: string;
  homePath?: string;
  domain?: string;
} {
  return {
    username: input.username,
    password_plain: input.password || undefined,
    homePath: input.homePath || undefined,
    domain: input.domain || undefined,
  };
}
