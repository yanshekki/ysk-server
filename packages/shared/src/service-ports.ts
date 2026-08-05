/**
 * SSOT: default public / panel ports for YSK Server managed services.
 * Used by Firewall open-port chips and docs — package names vary by distro,
 * but these are the listen ports YSK configures by default.
 *
 * Ranges use "from:to" (UFW syntax). Prefer not exposing DB/Redis/panel on 0.0.0.0.
 */

export type ServicePortProto = 'tcp' | 'udp' | 'both';

export type ServicePortCategory =
  | 'panel'
  | 'web'
  | 'ssh'
  | 'mail'
  | 'ftp'
  | 'db'
  | 'dns'
  | 'cache'
  | 'other';

export type ServicePortDef = {
  /** Stable id */
  id: string;
  /**
   * Single port "80" or UFW range "30000:30100".
   * Value used as chip value / API port field.
   */
  port: string;
  proto: ServicePortProto;
  /** Short chip label (English brand + port) */
  label: string;
  /** YSK feature / service id */
  service: string;
  category: ServicePortCategory;
  /** Opening on public interface is usually a bad idea */
  privateRecommended?: boolean;
  /** Shown in hint only */
  hint?: string;
};

/**
 * Full catalog of YSK-related service ports (defaults).
 * Order = chip display order (panel → web → ssh → mail → ftp → dns → db → cache).
 */
export const YSK_SERVICE_PORTS: ServicePortDef[] = [
  // —— Control plane ——
  {
    id: 'ysk-panel',
    port: '9287',
    proto: 'tcp',
    label: '9287 Panel',
    service: 'ysk-server',
    category: 'panel',
    privateRecommended: true,
    hint: 'YSK Server control plane (default listenPort)',
  },

  // —— SSH ——
  {
    id: 'ssh',
    port: '22',
    proto: 'tcp',
    label: '22 SSH',
    service: 'sshd',
    category: 'ssh',
  },

  // —— Web ——
  {
    id: 'http',
    port: '80',
    proto: 'tcp',
    label: '80 HTTP',
    service: 'nginx',
    category: 'web',
  },
  {
    id: 'https',
    port: '443',
    proto: 'tcp',
    label: '443 HTTPS',
    service: 'nginx',
    category: 'web',
  },
  {
    id: 'http-alt',
    port: '8080',
    proto: 'tcp',
    label: '8080 HTTP-alt',
    service: 'nginx',
    category: 'web',
    hint: 'Alt HTTP / Apache bind when Nginx owns 80',
  },
  {
    id: 'https-alt',
    port: '8443',
    proto: 'tcp',
    label: '8443 HTTPS-alt',
    service: 'nginx',
    category: 'web',
  },

  // —— Mail (Postfix + Dovecot) ——
  {
    id: 'smtp',
    port: '25',
    proto: 'tcp',
    label: '25 SMTP',
    service: 'postfix',
    category: 'mail',
  },
  {
    id: 'smtps',
    port: '465',
    proto: 'tcp',
    label: '465 SMTPS',
    service: 'postfix',
    category: 'mail',
  },
  {
    id: 'submission',
    port: '587',
    proto: 'tcp',
    label: '587 Submission',
    service: 'postfix',
    category: 'mail',
  },
  {
    id: 'imap',
    port: '143',
    proto: 'tcp',
    label: '143 IMAP',
    service: 'dovecot',
    category: 'mail',
  },
  {
    id: 'imaps',
    port: '993',
    proto: 'tcp',
    label: '993 IMAPS',
    service: 'dovecot',
    category: 'mail',
  },
  {
    id: 'pop3',
    port: '110',
    proto: 'tcp',
    label: '110 POP3',
    service: 'dovecot',
    category: 'mail',
  },
  {
    id: 'pop3s',
    port: '995',
    proto: 'tcp',
    label: '995 POP3S',
    service: 'dovecot',
    category: 'mail',
  },

  // —— FTP / FTPS (vsftpd) ——
  {
    id: 'ftp',
    port: '21',
    proto: 'tcp',
    label: '21 FTP',
    service: 'vsftpd',
    category: 'ftp',
  },
  {
    id: 'ftps-implicit',
    port: '990',
    proto: 'tcp',
    label: '990 FTPS',
    service: 'vsftpd',
    category: 'ftp',
    hint: 'Implicit FTPS (if enabled)',
  },
  {
    id: 'ftps-pasv',
    port: '30000:30100',
    proto: 'tcp',
    label: '30000–30100 PASV',
    service: 'vsftpd',
    category: 'ftp',
    hint: 'Default FTPS passive range (pasv_min/max)',
  },

  // —— DNS (PowerDNS) ——
  {
    id: 'dns-udp',
    port: '53',
    proto: 'udp',
    label: '53 DNS/UDP',
    service: 'pdns',
    category: 'dns',
  },
  {
    id: 'dns-tcp',
    port: '53',
    proto: 'tcp',
    label: '53 DNS/TCP',
    service: 'pdns',
    category: 'dns',
  },

  // —— Databases (usually private) ——
  {
    id: 'mysql',
    port: '3306',
    proto: 'tcp',
    label: '3306 MySQL',
    service: 'mysql',
    category: 'db',
    privateRecommended: true,
  },
  {
    id: 'mariadb',
    port: '3306',
    proto: 'tcp',
    label: '3306 MariaDB',
    service: 'mariadb',
    category: 'db',
    privateRecommended: true,
    hint: 'Same default port as MySQL (exclusive engines)',
  },
  {
    id: 'postgres',
    port: '5432',
    proto: 'tcp',
    label: '5432 Postgres',
    service: 'postgresql',
    category: 'db',
    privateRecommended: true,
  },

  // —— Cache ——
  {
    id: 'redis',
    port: '6379',
    proto: 'tcp',
    label: '6379 Redis',
    service: 'redis',
    category: 'cache',
    privateRecommended: true,
  },
];

/**
 * Chip options for firewall UI.
 * `value` is always `port/proto` (e.g. `80/tcp`, `53/udp`, `30000:30100/tcp`)
 * so DNS TCP+UDP can both appear and selection is unique.
 * MariaDB shares MySQL 3306 — one chip only.
 */
export function listFirewallPortChips(): Array<{
  value: string;
  label: string;
  proto: 'tcp' | 'udp';
  port: string;
  privateRecommended?: boolean;
  service: string;
  category: ServicePortCategory;
  hint?: string;
}> {
  const seen = new Set<string>();
  const out: Array<{
    value: string;
    label: string;
    proto: 'tcp' | 'udp';
    port: string;
    privateRecommended?: boolean;
    service: string;
    category: ServicePortCategory;
    hint?: string;
  }> = [];

  for (const p of YSK_SERVICE_PORTS) {
    if (p.id === 'mariadb') continue;

    const protos: Array<'tcp' | 'udp'> =
      p.proto === 'both' ? ['tcp', 'udp'] : [p.proto === 'udp' ? 'udp' : 'tcp'];

    for (const proto of protos) {
      const value = `${p.port}/${proto}`;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({
        value,
        label: p.label,
        proto,
        port: p.port,
        privateRecommended: p.privateRecommended,
        service: p.service,
        category: p.category,
        hint: p.hint,
      });
    }
  }
  return out;
}

/**
 * Parse chip/API value: `80`, `80/tcp`, `30000:30100`, `30000:30100/tcp`.
 */
export function parsePortChipValue(raw: string): {
  port: string;
  from: number;
  to: number;
  proto?: 'tcp' | 'udp';
} | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(.+?)(?:\/(tcp|udp))?$/i);
  if (!m) return null;
  const portPart = m[1]!.trim();
  const proto = m[2] ? (m[2].toLowerCase() as 'tcp' | 'udp') : undefined;
  const spec = parsePortSpec(portPart);
  if (!spec) return null;
  return { port: portPart, from: spec.from, to: spec.to, proto };
}

/** Parse "80" or "30000:30100" into from/to (same if single). */
export function parsePortSpec(raw: string): { from: number; to: number } | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // strip accidental /proto
  const bare = s.replace(/\/(tcp|udp)$/i, '');
  if (bare.includes(':')) {
    const [a, b] = bare.split(':').map((x) => Number(x.trim()));
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a! < 1 || a! > 65535 || b! < 1 || b! > 65535) return null;
    return { from: Math.min(a!, b!), to: Math.max(a!, b!) };
  }
  const n = Number(bare);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return { from: n, to: n };
}

/** True if spec is a multi-port range. */
export function isPortRange(raw: string): boolean {
  const p = parsePortChipValue(raw) ?? parsePortSpec(raw);
  if (!p) return false;
  if ('from' in p && 'to' in p) return p.from !== p.to;
  return false;
}

/** Protocol for allow-port UI / API. `both` opens TCP and UDP. */
export type FirewallPortProto = 'tcp' | 'udp' | 'both';

/** UFW rule target: `80/tcp` or `30000:30100/tcp`. Not used for `both` (dual allow). */
export function ufwPortTarget(port: string, proto: 'tcp' | 'udp'): string | null {
  const spec = parsePortSpec(port);
  if (!spec) return null;
  const body = spec.from === spec.to ? String(spec.from) : `${spec.from}:${spec.to}`;
  return `${body}/${proto}`;
}
