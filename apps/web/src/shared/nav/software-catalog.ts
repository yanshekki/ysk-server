/**
 * Software hub catalog — single registry for /software tabs + cards.
 * Keep in sync with FEATURE_SECTIONS deep links (to paths must exist in router).
 */

export type SoftwareTabId =
  | 'overview'
  | 'runtimes'
  | 'databases'
  | 'edge'
  | 'mail-files'
  | 'host';

export type RuntimeKindKey =
  | 'node'
  | 'php'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun';

export type SoftwareCardDef = {
  id: string;
  tab: Exclude<SoftwareTabId, 'overview'>;
  /** Route to manage this software */
  to: string;
  /** i18n key under nav.* */
  navKey: string;
  icon: string;
  /** Runtime probe kind */
  runtimeKind?: RuntimeKindKey;
  /** Twin service page (DB engines) */
  serviceTo?: string;
  serviceNavKey?: string;
  /** matrix id hints for services API */
  matrixIds?: string[];
  /**
   * HostSoftwareProbe / SOFTWARE_CATALOG ids for apt upgrade checks.
   * Omit for pure UI surfaces (CDN, file browser, metrics, …) — never fake updates.
   */
  softwareIds?: string[];
  /** Can be selected as project runtime */
  projectRuntime?: boolean;
};

export const SOFTWARE_TABS: Array<{ id: SoftwareTabId; labelKey: string }> = [
  { id: 'overview', labelKey: 'software.tabs.overview' },
  { id: 'runtimes', labelKey: 'software.tabs.runtimes' },
  { id: 'databases', labelKey: 'software.tabs.databases' },
  { id: 'edge', labelKey: 'software.tabs.edge' },
  { id: 'mail-files', labelKey: 'software.tabs.mailFiles' },
  { id: 'host', labelKey: 'software.tabs.host' },
];

/** All software shown in the hub (professional catalog). */
export const SOFTWARE_CARDS: SoftwareCardDef[] = [
  // —— Host tools ——
  {
    id: 'chromium',
    tab: 'host',
    to: '/browse?tab=stack',
    navKey: 'hostBrowse',
    icon: '🧭',
    softwareIds: ['chromium'],
  },
  // —— Runtimes ——
  {
    id: 'node',
    tab: 'runtimes',
    to: '/runtimes/node',
    navKey: 'node',
    icon: '⬢',
    runtimeKind: 'node',
    projectRuntime: true,
    matrixIds: ['node'],
  },
  {
    id: 'php',
    tab: 'runtimes',
    to: '/runtimes/php',
    navKey: 'php',
    icon: '🐘',
    runtimeKind: 'php',
    projectRuntime: true,
    matrixIds: ['php-fpm', 'php'],
  },
  {
    id: 'python',
    tab: 'runtimes',
    to: '/runtimes/python',
    navKey: 'python',
    icon: '🐍',
    runtimeKind: 'python',
    projectRuntime: true,
  },
  {
    id: 'go',
    tab: 'runtimes',
    to: '/runtimes/go',
    navKey: 'go',
    icon: '🐹',
    runtimeKind: 'go',
    projectRuntime: true,
  },
  {
    id: 'rust',
    tab: 'runtimes',
    to: '/runtimes/rust',
    navKey: 'rust',
    icon: '🦀',
    runtimeKind: 'rust',
    projectRuntime: true,
  },
  {
    id: 'java',
    tab: 'runtimes',
    to: '/runtimes/java',
    navKey: 'java',
    icon: '☕',
    runtimeKind: 'java',
    projectRuntime: true,
  },
  {
    id: 'kotlin',
    tab: 'runtimes',
    to: '/runtimes/kotlin',
    navKey: 'kotlin',
    icon: '🟣',
    runtimeKind: 'kotlin',
    projectRuntime: true,
  },
  {
    id: 'bun',
    tab: 'runtimes',
    to: '/runtimes/bun',
    navKey: 'bun',
    icon: '🥟',
    runtimeKind: 'bun',
    projectRuntime: true,
  },

  // —— Databases ——
  {
    id: 'mysql',
    tab: 'databases',
    to: '/databases/mysql',
    navKey: 'mysql',
    icon: '⬡',
    serviceTo: '/databases/mysql/service',
    serviceNavKey: 'mysqlService',
    matrixIds: ['mysql', 'mysqld'],
    softwareIds: ['mysql-server'],
  },
  {
    id: 'mariadb',
    tab: 'databases',
    to: '/databases/mariadb',
    navKey: 'mariadb',
    icon: '🐬',
    serviceTo: '/databases/mariadb/service',
    serviceNavKey: 'mariadbService',
    matrixIds: ['mariadb', 'mysql'],
    softwareIds: ['mariadb-server'],
  },
  {
    id: 'postgres',
    tab: 'databases',
    to: '/databases/postgres',
    navKey: 'postgres',
    icon: '🐘',
    serviceTo: '/databases/postgres/service',
    serviceNavKey: 'postgresService',
    matrixIds: ['postgresql', 'postgres'],
    softwareIds: ['postgresql'],
  },
  {
    id: 'redis',
    tab: 'databases',
    to: '/databases/redis',
    navKey: 'redis',
    icon: '◆',
    serviceTo: '/databases/redis/service',
    serviceNavKey: 'redisService',
    matrixIds: ['redis', 'redis-server'],
    softwareIds: ['redis-server'],
  },

  // —— Edge / DNS / SSL ——
  {
    id: 'dns',
    tab: 'edge',
    to: '/dns',
    navKey: 'dns',
    icon: '🌐',
    matrixIds: ['pdns', 'named', 'bind9'],
    softwareIds: ['pdns-server'],
  },
  {
    id: 'cdn',
    tab: 'edge',
    to: '/cdn',
    navKey: 'cdn',
    icon: '📡',
  },
  {
    id: 'ssl',
    tab: 'edge',
    to: '/ssl',
    navKey: 'ssl',
    icon: '🔒',
    softwareIds: ['certbot'],
  },
  {
    id: 'nginx',
    tab: 'edge',
    to: '/nginx',
    navKey: 'nginx',
    icon: '🔀',
    matrixIds: ['nginx'],
    softwareIds: ['nginx'],
  },

  // —— Mail & files ——
  {
    id: 'email',
    tab: 'mail-files',
    to: '/email',
    navKey: 'email',
    icon: '✉',
    matrixIds: ['postfix', 'dovecot'],
    softwareIds: ['postfix', 'dovecot'],
  },
  {
    id: 'files',
    tab: 'mail-files',
    to: '/files',
    navKey: 'files',
    icon: '▤',
  },
  {
    id: 'publicFiles',
    tab: 'mail-files',
    to: '/files/public',
    navKey: 'publicFiles',
    icon: '📁',
  },
  {
    id: 'ftp',
    tab: 'mail-files',
    to: '/ftp',
    navKey: 'ftp',
    icon: '⇄',
  },
  {
    id: 'ftpService',
    tab: 'mail-files',
    to: '/ftp/service',
    navKey: 'ftpService',
    icon: '⚙',
    matrixIds: ['vsftpd'],
    softwareIds: ['vsftpd'],
  },

  // —— Host / security / ops ——
  {
    id: 'protection',
    tab: 'host',
    to: '/protection',
    navKey: 'protection',
    icon: '🛡',
    matrixIds: ['ufw', 'fail2ban'],
    softwareIds: ['ufw', 'fail2ban'],
  },
  {
    id: 'security',
    tab: 'host',
    to: '/security',
    navKey: 'security',
    icon: '⛨',
  },
  {
    id: 'services',
    tab: 'host',
    to: '/services',
    navKey: 'services',
    icon: '⚙',
  },
  {
    id: 'metrics',
    tab: 'host',
    to: '/metrics',
    navKey: 'metrics',
    icon: '📊',
  },
  {
    id: 'network',
    tab: 'host',
    to: '/network',
    navKey: 'network',
    icon: '🔌',
  },
  {
    id: 'logs',
    tab: 'host',
    to: '/logs',
    navKey: 'logs',
    icon: '📄',
  },
  {
    id: 'cron',
    tab: 'host',
    to: '/cron',
    navKey: 'cron',
    icon: '⏱',
  },
  {
    id: 'backups',
    tab: 'host',
    to: '/backups',
    navKey: 'backups',
    icon: '💾',
  },
  {
    id: 'updates',
    tab: 'host',
    to: '/updates',
    navKey: 'updates',
    icon: '↻',
  },
  {
    id: 'readiness',
    tab: 'host',
    to: '/system/readiness',
    navKey: 'readiness',
    icon: '✅',
  },
  {
    id: 'systemd',
    tab: 'host',
    to: '/system/unit',
    navKey: 'systemd',
    icon: '📦',
  },
  {
    id: 'migrate',
    tab: 'host',
    to: '/system/migrate',
    navKey: 'migrate',
    icon: '🚚',
  },
];

export function cardsForTab(tab: SoftwareTabId): SoftwareCardDef[] {
  if (tab === 'overview') return SOFTWARE_CARDS;
  return SOFTWARE_CARDS.filter((c) => c.tab === tab);
}

export function runtimeCards(): SoftwareCardDef[] {
  return SOFTWARE_CARDS.filter((c) => c.runtimeKind);
}
