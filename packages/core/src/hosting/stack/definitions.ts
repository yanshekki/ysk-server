/**
 * Stack plans / bundles / components — SSOT mirrored from deploy/stack/*.json.
 * Keep in sync with deploy/stack/bundles.json + components.json.
 */

export type SqlServerChoice = 'mariadb' | 'mysql';
export type DataPolicy = 'keep' | 'purge';

export type StackComponentDef = {
  title: string;
  source: 'apt' | 'nodesource' | 'rustup' | 'npm';
  required?: boolean;
  optional?: boolean;
  aptPackages: string[];
  optionalApt?: string[];
  bins: string[];
  units: string[];
  dataPaths: string[];
  exclusiveWith?: string[];
  /** Map to SOFTWARE_CATALOG id when available */
  softwareId?: string;
};

export type StackBundleDef = {
  title: string;
  titleZh?: string;
  required?: boolean;
  description?: string;
  components: string[];
  optionalComponents?: string[];
  sqlChoice?: boolean;
};

export type StackPlanDef = {
  title: string;
  titleZh?: string;
  description?: string;
  bundles: string[];
};

export const STACK_PLANS: Record<string, StackPlanDef> = {
  minimal: {
    title: 'Control plane only',
    description: 'Node + ysk-server + base tools. No hosting stack.',
    bundles: ['control-plane'],
  },
  recommended: {
    title: 'Recommended hosting',
    description: 'Control plane + web + database + defense.',
    bundles: ['control-plane', 'web', 'database', 'defense'],
  },
  full: {
    title: 'All software',
    description: 'Every bundle.',
    bundles: [
      'control-plane',
      'web',
      'database',
      'email',
      'dns',
      'ftp',
      'defense',
      'runtimes',
    ],
  },
};

export const STACK_BUNDLES: Record<string, StackBundleDef> = {
  'control-plane': {
    title: 'Control plane',
    required: true,
    description: 'Base deps, Node.js 20+, ysk-server product, git.',
    components: ['base-deps', 'git', 'node', 'control-plane-product'],
  },
  web: {
    title: 'Web hosting',
    components: ['nginx', 'apache2', 'certbot', 'php'],
  },
  database: {
    title: 'Databases',
    components: [
      'mysql-client',
      'mariadb-server',
      'postgresql-client',
      'postgresql',
      'redis-tools',
      'redis-server',
      'sqlite3',
    ],
    sqlChoice: true,
  },
  email: {
    title: 'Mail stack',
    components: ['postfix', 'dovecot', 'opendkim'],
    optionalComponents: ['rspamd', 'clamav'],
  },
  dns: {
    title: 'DNS',
    components: ['pdns-server'],
  },
  ftp: {
    title: 'FTP / FTPS',
    components: ['vsftpd', 'db-util'],
  },
  defense: {
    title: 'Host defense',
    components: ['ufw', 'fail2ban'],
  },
  runtimes: {
    title: 'Language runtimes',
    components: ['php', 'python', 'go', 'rust'],
  },
};

export const STACK_COMPONENTS: Record<string, StackComponentDef> = {
  'base-deps': {
    title: 'Base system utilities',
    source: 'apt',
    required: true,
    aptPackages: [
      'curl',
      'git',
      'ca-certificates',
      'build-essential',
      'gnupg',
      'software-properties-common',
      'apt-transport-https',
      'openssl',
      'jq',
      'unzip',
      'zip',
      'rsync',
      'tar',
      'cron',
      'logrotate',
      'htop',
      'net-tools',
      'iproute2',
      'dnsutils',
      'whois',
      'lsof',
      'procps',
      'sudo',
      'acl',
      'attr',
    ],
    bins: ['curl', 'git', 'jq'],
    units: [],
    dataPaths: [],
  },
  nginx: {
    title: 'Nginx',
    source: 'apt',
    aptPackages: ['nginx'],
    bins: ['nginx'],
    units: ['nginx'],
    dataPaths: [],
    softwareId: 'nginx',
  },
  apache2: {
    title: 'Apache HTTP Server',
    source: 'apt',
    optional: true,
    aptPackages: ['apache2'],
    bins: ['apache2', 'apache2ctl'],
    units: ['apache2'],
    dataPaths: [],
  },
  certbot: {
    title: 'Certbot',
    source: 'apt',
    aptPackages: ['certbot', 'python3-certbot-nginx'],
    optionalApt: ['python3-certbot-apache'],
    bins: ['certbot'],
    units: [],
    dataPaths: ['/etc/letsencrypt'],
    softwareId: 'certbot',
  },
  'mysql-client': {
    title: 'MySQL/MariaDB client',
    source: 'apt',
    aptPackages: ['mariadb-client'],
    optionalApt: ['default-mysql-client', 'mysql-client'],
    bins: ['mysql', 'mariadb'],
    units: [],
    dataPaths: [],
    softwareId: 'mysql-client',
  },
  'mysql-server': {
    title: 'MySQL server',
    source: 'apt',
    aptPackages: ['mysql-server'],
    bins: ['mysqld'],
    units: ['mysql'],
    dataPaths: ['/var/lib/mysql'],
    exclusiveWith: ['mariadb-server'],
    softwareId: 'mysql-server',
  },
  'mariadb-server': {
    title: 'MariaDB server',
    source: 'apt',
    aptPackages: ['mariadb-server'],
    bins: ['mariadbd', 'mysqld'],
    units: ['mariadb'],
    dataPaths: ['/var/lib/mysql'],
    exclusiveWith: ['mysql-server'],
    softwareId: 'mariadb-server',
  },
  'postgresql-client': {
    title: 'PostgreSQL client',
    source: 'apt',
    aptPackages: ['postgresql-client'],
    bins: ['psql'],
    units: [],
    dataPaths: [],
    softwareId: 'postgresql-client',
  },
  postgresql: {
    title: 'PostgreSQL server',
    source: 'apt',
    aptPackages: ['postgresql'],
    bins: ['postgres'],
    units: ['postgresql'],
    dataPaths: ['/var/lib/postgresql'],
    softwareId: 'postgresql',
  },
  'redis-tools': {
    title: 'Redis client',
    source: 'apt',
    aptPackages: ['redis-tools'],
    bins: ['redis-cli'],
    units: [],
    dataPaths: [],
    softwareId: 'redis-tools',
  },
  'redis-server': {
    title: 'Redis server',
    source: 'apt',
    aptPackages: ['redis-server'],
    bins: ['redis-server'],
    units: ['redis-server'],
    dataPaths: ['/var/lib/redis'],
    softwareId: 'redis-server',
  },
  sqlite3: {
    title: 'SQLite',
    source: 'apt',
    aptPackages: ['sqlite3'],
    bins: ['sqlite3'],
    units: [],
    dataPaths: [],
  },
  postfix: {
    title: 'Postfix',
    source: 'apt',
    aptPackages: ['postfix'],
    bins: ['postfix'],
    units: ['postfix'],
    dataPaths: ['/var/spool/postfix'],
    softwareId: 'postfix',
  },
  dovecot: {
    title: 'Dovecot',
    source: 'apt',
    aptPackages: ['dovecot-core', 'dovecot-imapd', 'dovecot-pop3d', 'dovecot-lmtpd'],
    bins: ['dovecot'],
    units: ['dovecot'],
    dataPaths: ['/var/mail'],
    softwareId: 'dovecot',
  },
  opendkim: {
    title: 'OpenDKIM',
    source: 'apt',
    aptPackages: ['opendkim', 'opendkim-tools'],
    bins: ['opendkim'],
    units: ['opendkim'],
    dataPaths: [],
    softwareId: 'opendkim',
  },
  rspamd: {
    title: 'Rspamd',
    source: 'apt',
    optional: true,
    aptPackages: ['rspamd'],
    bins: ['rspamd'],
    units: ['rspamd'],
    dataPaths: [],
  },
  clamav: {
    title: 'ClamAV',
    source: 'apt',
    optional: true,
    aptPackages: ['clamav', 'clamav-daemon'],
    bins: ['clamscan'],
    units: ['clamav-daemon'],
    dataPaths: ['/var/lib/clamav'],
  },
  'pdns-server': {
    title: 'PowerDNS',
    source: 'apt',
    aptPackages: ['pdns-server', 'pdns-backend-bind'],
    bins: ['pdns_server', 'pdnsutil'],
    units: ['pdns'],
    dataPaths: [],
    softwareId: 'pdns-server',
  },
  vsftpd: {
    title: 'vsftpd',
    source: 'apt',
    aptPackages: ['vsftpd'],
    bins: ['vsftpd'],
    units: ['vsftpd'],
    dataPaths: [],
    softwareId: 'vsftpd',
  },
  'db-util': {
    title: 'db-util',
    source: 'apt',
    aptPackages: ['db-util', 'libpam-modules'],
    bins: ['db_load'],
    units: [],
    dataPaths: [],
    softwareId: 'db-util',
  },
  ufw: {
    title: 'UFW',
    source: 'apt',
    aptPackages: ['ufw'],
    bins: ['ufw'],
    units: [],
    dataPaths: [],
    softwareId: 'ufw',
  },
  fail2ban: {
    title: 'fail2ban',
    source: 'apt',
    aptPackages: ['fail2ban'],
    bins: ['fail2ban-client'],
    units: ['fail2ban'],
    dataPaths: [],
    softwareId: 'fail2ban',
  },
  php: {
    title: 'PHP',
    source: 'apt',
    aptPackages: [
      'php',
      'php-cli',
      'php-fpm',
      'php-common',
      'php-mysql',
      'php-pgsql',
      'php-sqlite3',
      'php-redis',
      'php-curl',
      'php-xml',
      'php-mbstring',
      'php-zip',
      'php-gd',
      'php-bcmath',
      'php-intl',
      'php-soap',
    ],
    bins: ['php'],
    units: [],
    dataPaths: [],
    softwareId: 'php',
  },
  python: {
    title: 'Python 3',
    source: 'apt',
    aptPackages: ['python3', 'python3-pip', 'python3-venv'],
    bins: ['python3'],
    units: [],
    dataPaths: [],
    softwareId: 'python',
  },
  go: {
    title: 'Go',
    source: 'apt',
    aptPackages: ['golang-go'],
    bins: ['go'],
    units: [],
    dataPaths: [],
    softwareId: 'go',
  },
  rust: {
    title: 'Rust (cargo)',
    source: 'rustup',
    aptPackages: [],
    bins: ['cargo'],
    units: [],
    dataPaths: ['/usr/local/cargo', '/usr/local/rustup'],
    softwareId: 'rust',
  },
  node: {
    title: 'Node.js',
    source: 'nodesource',
    aptPackages: ['nodejs'],
    bins: ['node'],
    units: [],
    dataPaths: [],
    softwareId: 'node',
  },
  git: {
    title: 'Git',
    source: 'apt',
    aptPackages: ['git'],
    bins: ['git'],
    units: [],
    dataPaths: [],
    softwareId: 'git',
  },
  'control-plane-product': {
    title: 'YSK Server product (npm/CLI)',
    source: 'npm',
    aptPackages: [],
    bins: ['ysk-server', 'node'],
    units: ['ysk-server'],
    dataPaths: [],
  },
};

export function listPlanIds(): string[] {
  return Object.keys(STACK_PLANS);
}

export function listBundleIds(): string[] {
  return Object.keys(STACK_BUNDLES);
}

export function getPlan(id: string): StackPlanDef | undefined {
  return STACK_PLANS[id];
}

export function getBundle(id: string): StackBundleDef | undefined {
  return STACK_BUNDLES[id];
}

export function getComponent(id: string): StackComponentDef | undefined {
  return STACK_COMPONENTS[id];
}

export type ExpandOptions = {
  sqlServer?: SqlServerChoice;
  clamav?: boolean;
  /** Include optionalComponents from email etc. when true for that id */
  includeOptional?: string[];
};

/** Expand plan or bundles → ordered unique component ids */
export function expandComponents(
  input: { plan?: string; bundles?: string[] },
  options: ExpandOptions = {},
): { ok: true; plan: string; bundles: string[]; components: string[] } | { ok: false; error: string } {
  const sql = options.sqlServer ?? 'mariadb';
  let bundles = [...(input.bundles ?? [])];
  let plan = input.plan ?? (bundles.length ? 'custom' : 'recommended');

  if (input.plan && !input.bundles?.length) {
    const p = STACK_PLANS[input.plan];
    if (!p) return { ok: false, error: `unknown plan: ${input.plan}` };
    plan = input.plan;
    bundles = [...p.bundles];
  }

  if (!bundles.includes('control-plane')) {
    bundles = ['control-plane', ...bundles];
  }

  for (const b of bundles) {
    if (!STACK_BUNDLES[b]) return { ok: false, error: `unknown bundle: ${b}` };
  }

  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };

  for (const b of bundles) {
    const def = STACK_BUNDLES[b]!;
    for (let c of def.components) {
      if (c === 'mariadb-server' && sql === 'mysql') c = 'mysql-server';
      if (c === 'mysql-server' && sql === 'mariadb') continue;
      if (c === 'mariadb-server' && sql !== 'mariadb') continue;
      if (c === 'mysql-server' && sql !== 'mysql') continue;
      add(c);
    }
    for (const c of def.optionalComponents ?? []) {
      if (c === 'clamav' && !options.clamav) continue;
      if (c === 'rspamd') {
        // soft include attempt for email
        add(c);
        continue;
      }
      if (options.includeOptional?.includes(c) || (c === 'clamav' && options.clamav)) {
        add(c);
      }
    }
  }

  if (!out.includes('base-deps')) out.unshift('base-deps');
  return { ok: true, plan, bundles, components: out };
}

/** Components to remove for given bundles (skips control-plane base bits) */
export function expandUninstallComponents(bundles: string[]): string[] {
  const out: string[] = [];
  const skip = new Set(['base-deps', 'node', 'git', 'control-plane-product']);
  for (const b of bundles) {
    const def = STACK_BUNDLES[b];
    if (!def || b === 'control-plane') continue;
    for (const c of def.components) {
      if (skip.has(c)) continue;
      if (!out.includes(c)) out.push(c);
    }
    for (const c of def.optionalComponents ?? []) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** Safe purge paths only */
export function isPurgePathAllowed(p: string): boolean {
  if (!p || p === '/' || p === '/var' || p === '/home' || p === '/etc') return false;
  if (p.startsWith('/var/')) return true;
  if (p === '/etc/letsencrypt' || p.startsWith('/etc/letsencrypt/')) return true;
  if (p === '/usr/local/cargo' || p.startsWith('/usr/local/cargo/')) return true;
  if (p === '/usr/local/rustup' || p.startsWith('/usr/local/rustup/')) return true;
  return false;
}
