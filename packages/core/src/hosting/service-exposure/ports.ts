/**
 * Resolve ServicePortBinding lists for managed services.
 */
import type { ServicePortBinding } from 'ysk-server-shared';
import { defaultPortsForService } from 'ysk-server-shared';

/** DB console engine → YSK service id (catalog / comments). */
export function engineToServiceId(engine: string): string {
  const e = String(engine ?? '').trim().toLowerCase();
  if (e === 'postgres' || e === 'postgresql') return 'postgresql';
  if (e === 'mariadb') return 'mariadb';
  if (e === 'mysql') return 'mysql';
  if (e === 'redis') return 'redis';
  return e;
}

export function ftpsPortBindings(settings: {
  listenPort?: number;
  pasvMin?: number;
  pasvMax?: number;
}): ServicePortBinding[] {
  const listen = Number(settings.listenPort) || 21;
  const min = Number(settings.pasvMin) || 30000;
  const max = Number(settings.pasvMax) || 30100;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const out: ServicePortBinding[] = [
    { role: 'ftp', port: String(listen), proto: 'tcp' },
    {
      role: 'ftps-pasv',
      port: lo === hi ? String(lo) : `${lo}:${hi}`,
      proto: 'tcp',
    },
  ];
  if (listen !== 990) {
    out.push({ role: 'ftps-implicit', port: '990', proto: 'tcp' });
  }
  return out;
}

export function vpnPortBindings(
  listenPort: number,
  proto: 'tcp' | 'udp' | 'both' = 'udp',
): ServicePortBinding[] {
  const p = Number(listenPort);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return [];
  return [{ role: 'listen', port: String(p), proto }];
}

export function dnsPortBindings(): ServicePortBinding[] {
  return [
    { role: 'dns-udp', port: '53', proto: 'udp' },
    { role: 'dns-tcp', port: '53', proto: 'tcp' },
  ];
}

/** Postfix public mail ports. */
export function postfixPortBindings(): ServicePortBinding[] {
  const defaults = defaultPortsForService('postfix');
  return defaults.length
    ? defaults
    : [
        { role: 'smtp', port: '25', proto: 'tcp' },
        { role: 'smtps', port: '465', proto: 'tcp' },
        { role: 'submission', port: '587', proto: 'tcp' },
      ];
}

/** Dovecot IMAP/POP public ports. */
export function dovecotPortBindings(): ServicePortBinding[] {
  const defaults = defaultPortsForService('dovecot');
  return defaults.length
    ? defaults
    : [
        { role: 'imap', port: '143', proto: 'tcp' },
        { role: 'imaps', port: '993', proto: 'tcp' },
        { role: 'pop3', port: '110', proto: 'tcp' },
        { role: 'pop3s', port: '995', proto: 'tcp' },
      ];
}

/** Sync both MTA + MDA after email stack apply. */
export async function syncMailServiceExposure(input: {
  host: import('../../host/executor.js').HostExecutor;
  dataDir: string;
  reason?: 'start' | 'apply' | 'port-change' | 'manual' | 'stop';
}): Promise<{ notes: string[]; ok: boolean; blocked?: boolean }> {
  const { syncServiceExposure } = await import('./sync.js');
  const reason = input.reason ?? 'apply';
  const notes: string[] = [];
  let ok = true;
  let blocked = false;
  for (const [serviceId, ports] of [
    ['postfix', postfixPortBindings()] as const,
    ['dovecot', dovecotPortBindings()] as const,
  ]) {
    const exp = await syncServiceExposure({
      host: input.host,
      dataDir: input.dataDir,
      serviceId,
      ports: [...ports],
      reason,
      requireDecision: false,
    });
    notes.push(...exp.notes.slice(0, 3));
    if (!exp.ok) ok = false;
    if (exp.blocked) blocked = true;
  }
  return { notes, ok, blocked };
}

/** Port from console apply changes if present, else catalog defaults. */
export function dbPortBindings(
  engine: string,
  changes?: Record<string, string>,
  livePort?: string,
): ServicePortBinding[] {
  const serviceId = engineToServiceId(engine);
  const portKey = Object.keys(changes ?? {}).find((k) => /port/i.test(k));
  const fromChange = portKey ? String(changes![portKey] ?? '').trim() : '';
  const port = fromChange || String(livePort ?? '').trim();
  if (port && /^\d{1,5}$/.test(port)) {
    return [{ role: 'listen', port, proto: 'tcp' }];
  }
  const defaults = defaultPortsForService(serviceId);
  return defaults.length ? defaults : [{ role: 'listen', port: fallbackPort(serviceId), proto: 'tcp' }];
}

function fallbackPort(serviceId: string): string {
  if (serviceId === 'postgresql') return '5432';
  if (serviceId === 'redis') return '6379';
  return '3306';
}

/**
 * Map systemd unit → exposure serviceId (+ optional ports).
 * Used when Services page starts/stops units so ysk-svc rules follow lifecycle.
 */
export function unitToExposureService(unit: string): {
  serviceId: string;
  ports?: ServicePortBinding[];
} | null {
  const base = String(unit ?? '')
    .trim()
    .replace(/\.service$/i, '')
    .toLowerCase();
  if (!base) return null;
  if (base === 'vsftpd') return { serviceId: 'vsftpd', ports: ftpsPortBindings({}) };
  if (base === 'nginx') {
    return {
      serviceId: 'nginx',
      ports: [
        { role: 'http', port: '80', proto: 'tcp' },
        { role: 'https', port: '443', proto: 'tcp' },
      ],
    };
  }
  if (base === 'apache2' || base === 'httpd') {
    return {
      serviceId: 'apache',
      ports: [
        { role: 'http', port: '80', proto: 'tcp' },
        { role: 'https', port: '443', proto: 'tcp' },
      ],
    };
  }
  if (base === 'postfix') return { serviceId: 'postfix', ports: postfixPortBindings() };
  if (base === 'dovecot') return { serviceId: 'dovecot', ports: dovecotPortBindings() };
  if (base === 'pdns' || base === 'pdns-recursor') {
    return { serviceId: 'pdns', ports: dnsPortBindings() };
  }
  if (base === 'mysql' || base === 'mysqld') {
    return { serviceId: 'mysql', ports: dbPortBindings('mysql') };
  }
  if (base === 'mariadb') return { serviceId: 'mariadb', ports: dbPortBindings('mariadb') };
  if (base === 'postgresql' || base.startsWith('postgresql@')) {
    return { serviceId: 'postgresql', ports: dbPortBindings('postgres') };
  }
  if (base === 'redis' || base === 'redis-server') {
    return { serviceId: 'redis', ports: dbPortBindings('redis') };
  }
  if (base === 'sshd' || base === 'ssh') {
    return { serviceId: 'sshd', ports: [{ role: 'ssh', port: '22', proto: 'tcp' }] };
  }
  if (base === 'wg-quick' || base.startsWith('wg-quick@') || base === 'wireguard') {
    return { serviceId: 'wireguard' };
  }
  if (base === 'openvpn' || base.startsWith('openvpn@')) {
    return { serviceId: 'openvpn' };
  }
  return null;
}
