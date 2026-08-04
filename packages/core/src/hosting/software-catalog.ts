import { tl } from '@ysk/shared';
/**
 * Single catalog of host software required by admin features.
 * Panel installs via software-install.ts — never user CLI.
 */

export type SoftwareId =
  | 'vsftpd'
  | 'db-util'
  | 'nginx'
  | 'certbot'
  | 'mysql-client'
  | 'mysql-server'
  | 'mariadb-server'
  | 'postgresql-client'
  | 'postgresql'
  | 'redis-tools'
  | 'redis-server'
  | 'ufw'
  | 'fail2ban'
  | 'postfix'
  | 'dovecot'
  | 'opendkim'
  | 'pdns-server'
  | 'git'
  | 'node'
  | 'php'
  | 'python'
  | 'go'
  | 'rust';

export type FeatureSoftwareKey =
  | 'ftp'
  | 'nginx'
  | 'ssl'
  | 'mysql'
  | 'mariadb'
  | 'postgres'
  | 'redis'
  | 'firewall'
  | 'fail2ban'
  | 'dns'
  | 'email'
  | 'node'
  | 'php'
  | 'python'
  | 'go'
  | 'rust'
  | 'git'
  | 'all';

export type RuntimeInstaller =
  | 'apt'
  | 'runtime-node'
  | 'runtime-php'
  | 'runtime-python'
  | 'runtime-go'
  | 'runtime-rust';

export interface SoftwareSpec {
  id: SoftwareId;
  /**
   * Literal brand/product name (no i18n). Prefer this for proper nouns.
   * When titleKey is set, title is only a fallback for tests/CLI without locale.
   */
  title: string;
  /** Optional i18n key resolved under request locale (never call tl at module load). */
  titleKey?: string;
  /** Binaries to probe with command -v */
  bins: string[];
  /** Debian/Ubuntu packages */
  aptPackages: string[];
  /** systemctl units to enable --now after install */
  units?: string[];
  features: FeatureSoftwareKey[];
  /** Use dedicated runtime installer instead of apt */
  installer?: RuntimeInstaller;
  /** Default runtime version when installer is runtime-* */
  runtimeVersion?: string;
}

/** Resolve display title under current request locale. */
export function resolveSoftwareTitle(spec: SoftwareSpec): string {
  const catalogKey = `catalog.sw.${spec.id.replace(/-/g, '_')}`;
  const fromCatalog = tl(catalogKey);
  // tl returns key itself when missing — prefer catalog when translated
  if (fromCatalog && fromCatalog !== catalogKey) return fromCatalog;
  if (spec.titleKey) return tl(spec.titleKey);
  return spec.title;
}

/**
 * Static catalog — never call tl() when building this array (module-load freezes default locale).
 */
export const SOFTWARE_CATALOG: SoftwareSpec[] = [
  {
    id: 'vsftpd',
    title: 'vsftpd (FTPS)',
    bins: ['vsftpd'],
    aptPackages: ['vsftpd'],
    units: ['vsftpd'],
    features: ['ftp'] },
  {
    id: 'db-util',
    title: 'db-util (FTP user DB)',
    titleKey: 'notes.auto.n0248',
    bins: ['db_load'],
    aptPackages: ['db-util'],
    features: ['ftp'] },
  {
    id: 'nginx',
    title: 'Nginx',
    bins: ['nginx'],
    aptPackages: ['nginx'],
    units: ['nginx'],
    features: ['nginx'] },
  {
    id: 'certbot',
    title: 'Certbot (Let’s Encrypt)',
    bins: ['certbot'],
    aptPackages: ['certbot', 'python3-certbot-nginx'],
    features: ['ssl'] },
  {
    id: 'mysql-client',
    title: 'MySQL/MariaDB client',
    titleKey: 'notes.auto.n0136',
    // Ubuntu/Debian often ship `mariadb` client; older installs still use `mysql`
    bins: ['mysql', 'mariadb'],
    aptPackages: ['mariadb-client', 'default-mysql-client', 'mysql-client'],
    features: ['mysql', 'mariadb'] },
  {
    id: 'mysql-server',
    title: 'MySQL server',
    titleKey: 'notes.auto.n0135',
    bins: ['mysqld'],
    aptPackages: ['mysql-server'],
    units: ['mysql'],
    features: ['mysql'] },
  {
    id: 'mariadb-server',
    title: 'MariaDB server',
    titleKey: 'notes.auto.n0133',
    // Some releases only expose mariadbd; others still provide mysqld symlink
    bins: ['mariadbd', 'mysqld'],
    aptPackages: ['mariadb-server'],
    units: ['mariadb'],
    features: ['mariadb'] },
  {
    id: 'postgresql-client',
    title: 'PostgreSQL client',
    titleKey: 'notes.auto.n0159',
    bins: ['psql'],
    aptPackages: ['postgresql-client'],
    features: ['postgres'] },
  {
    id: 'postgresql',
    title: 'PostgreSQL server',
    titleKey: 'notes.auto.n0157',
    bins: ['postgres'],
    aptPackages: ['postgresql'],
    units: ['postgresql'],
    features: ['postgres'] },
  {
    id: 'redis-tools',
    title: 'Redis client',
    titleKey: 'notes.auto.n0174',
    bins: ['redis-cli'],
    aptPackages: ['redis-tools'],
    features: ['redis'] },
  {
    id: 'redis-server',
    title: 'Redis server',
    titleKey: 'notes.auto.n0171',
    bins: ['redis-server'],
    aptPackages: ['redis-server'],
    units: ['redis-server'],
    features: ['redis'] },
  {
    id: 'ufw',
    title: 'UFW firewall',
    titleKey: 'notes.auto.n0017',
    bins: ['ufw'],
    aptPackages: ['ufw'],
    features: ['firewall'] },
  {
    id: 'fail2ban',
    title: 'fail2ban',
    bins: ['fail2ban-client'],
    aptPackages: ['fail2ban'],
    units: ['fail2ban'],
    features: ['fail2ban'] },
  {
    id: 'postfix',
    title: 'Postfix',
    bins: ['postfix'],
    aptPackages: ['postfix'],
    units: ['postfix'],
    features: ['email'] },
  {
    id: 'dovecot',
    title: 'Dovecot',
    bins: ['dovecot'],
    aptPackages: ['dovecot-core', 'dovecot-imapd'],
    units: ['dovecot'],
    features: ['email'] },
  {
    id: 'opendkim',
    title: 'OpenDKIM',
    bins: ['opendkim'],
    aptPackages: ['opendkim', 'opendkim-tools'],
    units: ['opendkim'],
    features: ['email'] },
  {
    id: 'pdns-server',
    title: 'PowerDNS',
    bins: ['pdns_server', 'pdnsutil'],
    aptPackages: ['pdns-server', 'pdns-backend-bind'],
    units: ['pdns'],
    features: ['dns'] },
  {
    id: 'git',
    title: 'Git',
    bins: ['git'],
    aptPackages: ['git'],
    features: ['git', 'all'] },
  {
    id: 'node',
    title: 'Node.js',
    bins: ['node'],
    aptPackages: [],
    features: ['node'],
    installer: 'runtime-node',
    runtimeVersion: '20' },
  {
    id: 'php',
    title: 'PHP',
    bins: ['php'],
    aptPackages: [],
    features: ['php'],
    installer: 'runtime-php',
    runtimeVersion: '8.3' },
  {
    id: 'python',
    title: 'Python 3',
    bins: ['python3'],
    aptPackages: [],
    features: ['python'],
    installer: 'runtime-python',
    runtimeVersion: '3.12' },
  {
    id: 'go',
    title: 'Go',
    bins: ['go'],
    aptPackages: [],
    features: ['go'],
    installer: 'runtime-go',
    runtimeVersion: '1.22' },
  {
    id: 'rust',
    title: 'Rust (cargo)',
    bins: ['cargo'],
    aptPackages: [],
    features: ['rust'],
    installer: 'runtime-rust',
    runtimeVersion: 'stable' },
];

export function getSoftware(id: string): SoftwareSpec | undefined {
  return SOFTWARE_CATALOG.find((s) => s.id === id);
}

export function listSoftwareForFeature(feature: string): SoftwareSpec[] {
  if (feature === 'all' || !feature) return [...SOFTWARE_CATALOG];
  return SOFTWARE_CATALOG.filter(
    (s) => s.features.includes(feature as FeatureSoftwareKey) || s.features.includes('all'),
  );
}
