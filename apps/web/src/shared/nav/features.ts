/**
 * Feature registry — single source for sidebar + dashboard grid.
 */

export type FeatureItem = {
  to: string;
  key: string;
  icon: string;
  /** i18n key under features.* for short description */
  descKey?: string;
};

export type FeatureSection = {
  sectionKey: string;
  items: FeatureItem[];
};

/** Grouped navigation (Admin control plane) */
export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    sectionKey: 'overview',
    items: [{ to: '/', key: 'dashboard', icon: '◉' }],
  },
  {
    sectionKey: 'sites',
    items: [{ to: '/projects', key: 'projects', icon: '▣' }],
  },
  {
    sectionKey: 'mail',
    items: [{ to: '/email', key: 'email', icon: '✉' }],
  },
  {
    sectionKey: 'files',
    items: [
      { to: '/files', key: 'files', icon: '▤' },
      { to: '/files/public', key: 'publicFiles', icon: '📁' },
      { to: '/ftp', key: 'ftp', icon: '⇄' },
      { to: '/bt-tracker', key: 'btTracker', icon: '🧲' },
    ],
  },
  {
    sectionKey: 'databases',
    items: [
      { to: '/databases/mysql', key: 'mysql', icon: '⬡' },
      { to: '/databases/mysql/service', key: 'mysqlService', icon: '⚙' },
      { to: '/databases/mariadb', key: 'mariadb', icon: '🐬' },
      { to: '/databases/mariadb/service', key: 'mariadbService', icon: '⚙' },
      { to: '/databases/postgres', key: 'postgres', icon: '🐘' },
      { to: '/databases/postgres/service', key: 'postgresService', icon: '⚙' },
      { to: '/databases/redis', key: 'redis', icon: '◆' },
      { to: '/databases/redis/service', key: 'redisService', icon: '⚙' },
    ],
  },
  {
    sectionKey: 'dnsSsl',
    items: [
      { to: '/dns', key: 'dns', icon: '🌐' },
      { to: '/cdn', key: 'cdn', icon: '📡' },
      { to: '/ssl', key: 'ssl', icon: '🔒' },
      { to: '/nginx', key: 'nginx', icon: '🔀' },
      { to: '/apache', key: 'apache', icon: '🕸️' },
    ],
  },
  {
    sectionKey: 'runtimes',
    items: [
      { to: '/runtimes/node', key: 'node', icon: '⬢' },
      { to: '/runtimes/php', key: 'php', icon: '🐘' },
      { to: '/runtimes/python', key: 'python', icon: '🐍' },
      { to: '/runtimes/go', key: 'go', icon: '🐹' },
      { to: '/runtimes/rust', key: 'rust', icon: '🦀' },
      { to: '/runtimes/java', key: 'java', icon: '☕' },
      { to: '/runtimes/kotlin', key: 'kotlin', icon: '🟣' },
      { to: '/runtimes/bun', key: 'bun', icon: '🥟' },
    ],
  },
  {
    sectionKey: 'containers',
    items: [{ to: '/docker', key: 'docker', icon: '🐳' }],
  },
  {
    sectionKey: 'validators',
    items: [{ to: '/validators', key: 'validators', icon: '⛓' }],
  },
  {
    sectionKey: 'security',
    items: [
      // Single DDoS / host-defense entry — UFW & fail2ban live under 防護中心「底層」
      { to: '/protection', key: 'protection', icon: '🛡' },
      { to: '/security', key: 'security', icon: '⛨' },
      { to: '/vpn', key: 'vpn', icon: '🔐' },
      { to: '/vnc', key: 'vnc', icon: '🖥️' },
    ],
  },
  {
    sectionKey: 'system',
    items: [
      { to: '/users', key: 'users', icon: '👤' },
      { to: '/services', key: 'services', icon: '⚙' },
      { to: '/metrics', key: 'metrics', icon: '📊' },
      { to: '/network', key: 'network', icon: '🔌' },
      { to: '/browse', key: 'hostBrowse', icon: '🧭' },
      { to: '/logs', key: 'logs', icon: '📄' },
      { to: '/terminal', key: 'terminal', icon: '⌘' },
      { to: '/cron', key: 'cron', icon: '⏱' },
      { to: '/backups', key: 'backups', icon: '💾' },
      { to: '/system/migrate', key: 'migrate', icon: '🚚' },
      { to: '/updates', key: 'updates', icon: '↻' },
      { to: '/system/unit', key: 'systemd', icon: '📦' },
      { to: '/system/readiness', key: 'readiness', icon: '✅' },
      { to: '/system', key: 'systemIndex', icon: '▦' },
      { to: '/support', key: 'support', icon: '♥' },
    ],
  },
  // AI Tasks / Agents experimental UI removed — operators use CLI + docs
  // (`ysk-server ask`, `agents`, tools). No panel chrome for AI.
];

/** Flat list for dashboard grid (skip dashboard self-link) */
export function allFeatureTiles(): FeatureItem[] {
  return FEATURE_SECTIONS.flatMap((s) => s.items).filter((i) => i.to !== '/');
}
