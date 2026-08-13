/**
 * Probe registry — built from SOFTWARE_CATALOG + exclusive / version metadata.
 */

import { SOFTWARE_CATALOG, type SoftwareId } from '../software-catalog.js';
import type { ProbeRegistryEntry, SoftwareProbeId } from './types.js';

const EXCLUSIVE: Partial<Record<SoftwareId, string[]>> = {
  'mysql-server': ['mariadb-server'],
  'mariadb-server': ['mysql-server'],
};

const VERSION_CMD: Partial<Record<SoftwareId, string[]>> = {
  nginx: ['nginx', '-v'],
  certbot: ['certbot', '--version'],
  'mysql-client': ['mysql', '--version'],
  'mysql-server': ['mysqld', '--version'],
  'mariadb-server': ['mariadbd', '--version'],
  'postgresql-client': ['psql', '--version'],
  postgresql: ['postgres', '-V'],
  'redis-tools': ['redis-cli', '--version'],
  'redis-server': ['redis-server', '--version'],
  ufw: ['ufw', 'version'],
  fail2ban: ['fail2ban-client', 'version'],
  postfix: ['postconf', '-d', 'mail_version'],
  dovecot: ['dovecot', '--version'],
  git: ['git', '--version'],
  node: ['node', '--version'],
  pm2: ['pm2', '-v'],
  php: ['php', '-v'],
  python: ['python3', '--version'],
  go: ['go', 'version'],
  rust: ['cargo', '--version'],
  java: ['java', '-version'],
  kotlin: ['kotlinc', '-version'],
  bun: ['bun', '--version'],
  vsftpd: ['vsftpd', '-v'],
  'pdns-server': ['pdns_server', '--version'],
  chromium: ['chromium', '--version'],
};

const DPKG_PRIMARY: Partial<Record<SoftwareId, string>> = {
  nginx: 'nginx',
  apache2: 'apache2',
  certbot: 'certbot',
  'mysql-server': 'mysql-server',
  'mysql-client': 'mariadb-client',
  'mariadb-server': 'mariadb-server',
  postgresql: 'postgresql',
  'postgresql-client': 'postgresql-client',
  'redis-server': 'redis-server',
  'redis-tools': 'redis-tools',
  ufw: 'ufw',
  fail2ban: 'fail2ban',
  postfix: 'postfix',
  dovecot: 'dovecot-core',
  opendkim: 'opendkim',
  vsftpd: 'vsftpd',
  'pdns-server': 'pdns-server',
  git: 'git',
  php: 'php-cli',
  python: 'python3',
  go: 'golang-go',
  node: 'nodejs',
  java: 'openjdk-21-jdk',
  chromium: 'chromium',
  wireguard: 'wireguard',
  openvpn: 'openvpn',
  shadowsocks: 'shadowsocks-libev',
  tigervnc: 'tigervnc-standalone-server',
  novnc: 'novnc',
  'vnc-desktop-xfce': 'xfce4',
  'tigervnc-viewer': 'tigervnc-viewer',
  'db-util': 'db-util',
};

function buildFromCatalog(): Map<SoftwareProbeId, ProbeRegistryEntry> {
  const m = new Map<SoftwareProbeId, ProbeRegistryEntry>();
  for (const s of SOFTWARE_CATALOG) {
    m.set(s.id, {
      id: s.id,
      title: s.title,
      bins: [...s.bins],
      aptPackages: [...s.aptPackages],
      units: s.units ? [...s.units] : undefined,
      exclusiveWith: EXCLUSIVE[s.id],
      versionCommand: VERSION_CMD[s.id],
      dpkgPackage: DPKG_PRIMARY[s.id] ?? s.aptPackages[0],
      requiresExclusiveFlavor:
        s.id === 'mysql-server' || s.id === 'mariadb-server' ? true : undefined,
    });
  }
  return m;
}

const REGISTRY = buildFromCatalog();

/** Extra aliases used by service-console engines → primary server probe id */
export const ENGINE_TO_SERVER_ID: Record<string, SoftwareProbeId> = {
  mysql: 'mysql-server',
  mariadb: 'mariadb-server',
  postgres: 'postgresql',
  redis: 'redis-server',
};

export const ENGINE_TO_CLIENT_ID: Record<string, SoftwareProbeId | undefined> = {
  mysql: 'mysql-client',
  mariadb: 'mysql-client',
  postgres: 'postgresql-client',
  redis: 'redis-tools',
};

export function getProbeEntry(id: SoftwareProbeId): ProbeRegistryEntry | undefined {
  return REGISTRY.get(id);
}

export function listProbeIds(): SoftwareProbeId[] {
  return [...REGISTRY.keys()];
}

export function allProbeEntries(): ProbeRegistryEntry[] {
  return [...REGISTRY.values()];
}
