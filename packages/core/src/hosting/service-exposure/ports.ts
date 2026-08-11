/**
 * Resolve ServicePortBinding lists for managed services.
 */
import type { ServicePortBinding } from '@ysk/shared';
import { defaultPortsForService } from '@ysk/shared';

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
