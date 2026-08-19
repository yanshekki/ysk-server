/**
 * Browser-safe identifiers for panel create forms (nginx, FTP, projects, SQL, IP).
 * Reject values that would flow into Linux users, nginx conf, or SQL identifiers.
 */

const PROJECT_RE = /^[a-z][a-z0-9-]{0,30}$/;
const FTP_USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const SQL_IDENT_RE = /^[a-z][a-z0-9_]{0,63}$/;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME_BODY_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAILBOX_LOCAL_RE = /^[a-z0-9._+-]{1,64}$/;

export function isProjectName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  return PROJECT_RE.test(s);
}

export function isFtpUsername(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || /\s/.test(s) || s.includes('!')) return false;
  return FTP_USER_RE.test(s);
}

export function isSqlIdent(raw: string): boolean {
  const s = String(raw ?? '').trim();
  return SQL_IDENT_RE.test(s);
}

export function isIpv4(raw: string): boolean {
  return IPV4_RE.test(String(raw ?? '').trim());
}

export function isIpv6(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.includes('%') || /\s/.test(s)) return false;
  if (!s.includes(':')) return false;
  if (s.split('::').length > 2) return false;
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 8) return false;
  return parts.every((p) => p === '' || /^[0-9a-f]{1,4}$/i.test(p));
}

export function isIpAddress(raw: string): boolean {
  const s = String(raw ?? '').trim();
  return isIpv4(s) || isIpv6(s);
}

export function isCidr(raw: string): boolean {
  const s = String(raw ?? '').trim();
  const i = s.lastIndexOf('/');
  if (i <= 0) return false;
  const addr = s.slice(0, i);
  const bits = Number(s.slice(i + 1));
  if (!Number.isInteger(bits) || bits < 0) return false;
  if (isIpv4(addr)) return bits <= 32;
  if (isIpv6(addr)) return bits <= 128;
  return false;
}

/** One nginx server_name token (hostname, wildcard, IP, `_`, localhost). */
export function isNginxServerNameToken(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s.length > 253) return false;
  if (/[;{}$'"\\]/.test(s) || /\s/.test(s)) return false;
  if (s === '_' || s === 'localhost') return true;
  const body = s.startsWith('*.') ? s.slice(2) : s;
  if (isIpv4(body)) return true;
  if (!body.includes('.')) return false;
  return HOSTNAME_BODY_RE.test(body);
}

/** Mailbox / alias local-part (info, sales+list). */
export function isMailboxLocalPart(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return MAILBOX_LOCAL_RE.test(s);
}

/** Apex or mail host used as an email domain (not IP, not wildcard). */
export function isMailDomain(raw: string): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s.length > 253) return false;
  if (isIpv4(s) || isIpv6(s)) return false;
  return HOSTNAME_BODY_RE.test(s);
}

export function isNginxServerNameList(raw: string): boolean {
  const parts = String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length > 0 && parts.every(isNginxServerNameToken);
}

const DOCKER_CMD_TOKEN = /^[A-Za-z0-9._:/=+-]+$/;

export function parseDockerArgvLine(raw: string): string[] | null {
  const parts = String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return [];
  if (parts.length > 32) return null;
  if (!parts.every((p) => DOCKER_CMD_TOKEN.test(p))) return null;
  return parts;
}
