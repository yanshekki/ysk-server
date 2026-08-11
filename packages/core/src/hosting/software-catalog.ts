import { tl } from '@ysk/shared';
/**
 * Single catalog of host software required by admin features.
 * Panel installs via software-install.ts — never user CLI.
 */

export type SoftwareId =
  | 'vsftpd'
  | 'db-util'
  | 'nginx'
  | 'apache2'
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
  | 'pm2'
  | 'php'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun'
  | 'chromium'
  | 'wireguard'
  | 'openvpn'
  | 'shadowsocks'
  | 'tigervnc'
  | 'novnc'
  | 'vnc-desktop-xfce'
  | 'tigervnc-viewer';

export type FeatureSoftwareKey =
  | 'ftp'
  | 'nginx'
  | 'apache'
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
  | 'java'
  | 'kotlin'
  | 'bun'
  | 'git'
  | 'hostBrowse'
  | 'vpn'
  | 'wireguard'
  | 'openvpn'
  | 'outline'
  | 'vnc'
  | 'tigervnc'
  | 'novnc'
  | 'all';

export type RuntimeInstaller =
  | 'apt'
  | 'npm-global'
  | 'runtime-node'
  | 'runtime-php'
  | 'runtime-python'
  | 'runtime-go'
  | 'runtime-rust'
  | 'runtime-java'
  | 'runtime-kotlin'
  | 'runtime-bun';

export interface SoftwareSpec {
  id: SoftwareId;
  /**
   * Literal brand/product name (no i18n). Prefer this for proper nouns.
   * When titleKey is set, title is only a fallback for tests/CLI without locale.
   */
  title: string;
  /** Optional i18n key resolved under request locale (never call tl at module load). */
  titleKey?: string;
  /** Binaries probed via HostSoftwareProbe / resolveBin */
  bins: string[];
  /** Debian/Ubuntu packages */
  aptPackages: string[];
  /** npm packages for installer: npm-global (e.g. pm2) */
  npmPackages?: string[];
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
    id: 'apache2',
    title: 'Apache HTTP Server',
    bins: ['apache2', 'apache2ctl', 'httpd'],
    aptPackages: ['apache2'],
    units: ['apache2', 'httpd'],
    features: ['apache'] },
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
    id: 'pm2',
    title: 'PM2',
    bins: ['pm2'],
    aptPackages: [],
    npmPackages: ['pm2'],
    features: ['node'],
    installer: 'npm-global' },
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
  {
    id: 'java',
    title: 'Java (OpenJDK)',
    bins: ['java', 'javac'],
    aptPackages: ['openjdk-21-jdk'],
    features: ['java'],
    installer: 'runtime-java',
    runtimeVersion: '21' },
  {
    id: 'kotlin',
    title: 'Kotlin',
    bins: ['kotlin', 'kotlinc'],
    aptPackages: [],
    features: ['kotlin'],
    installer: 'runtime-kotlin',
    runtimeVersion: '2.1.0' },
  {
    id: 'bun',
    title: 'Bun',
    bins: ['bun'],
    aptPackages: [],
    features: ['bun'],
    installer: 'runtime-bun',
    runtimeVersion: 'latest' },
  {
    /** Host Browse real-browser engine — distro Chromium (also detects Google Chrome bins). */
    id: 'chromium',
    title: 'Chromium / Chrome',
    bins: [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
    ],
    // Prefer distro chromium; Ubuntu may use chromium-browser transitional package
    aptPackages: ['chromium'],
    features: ['hostBrowse'] },
  {
    id: 'wireguard',
    title: 'WireGuard',
    bins: ['wg', 'wg-quick'],
    aptPackages: ['wireguard', 'wireguard-tools', 'qrencode'],
    features: ['vpn', 'wireguard'],
  },
  {
    id: 'openvpn',
    title: 'OpenVPN',
    bins: ['openvpn'],
    aptPackages: ['openvpn', 'easy-rsa'],
    features: ['vpn', 'openvpn'],
  },
  {
    id: 'shadowsocks',
    title: 'Shadowsocks (ss-server)',
    bins: ['ss-server'],
    aptPackages: ['shadowsocks-libev'],
    features: ['vpn', 'outline'],
  },
  {
    id: 'tigervnc',
    title: 'TigerVNC server',
    // Debian/Ubuntu: tigervncserver wrapper + Xtigervnc; legacy may ship vncserver/Xvnc
    bins: ['tigervncserver', 'vncserver', 'Xtigervnc', 'Xvnc', 'x0vncserver'],
    // Debian/Ubuntu package names vary; installer tries what apt provides
    aptPackages: [
      'tigervnc-standalone-server',
      'tigervnc-common',
      'tigervnc-tools',
    ],
    features: ['vnc', 'tigervnc'],
  },
  {
    id: 'novnc',
    title: 'noVNC + websockify',
    bins: ['websockify', 'novnc_proxy'],
    aptPackages: ['novnc', 'websockify'],
    features: ['vnc', 'novnc'],
  },
  {
    id: 'vnc-desktop-xfce',
    title: 'XFCE desktop (for VNC)',
    bins: ['startxfce4', 'xfce4-session'],
    aptPackages: ['xfce4', 'xfce4-goodies', 'dbus-x11'],
    features: ['vnc'],
  },
  {
    id: 'tigervnc-viewer',
    title: 'TigerVNC viewer',
    bins: ['vncviewer', 'xtigervncviewer'],
    aptPackages: ['tigervnc-viewer'],
    features: ['vnc'],
  },
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
