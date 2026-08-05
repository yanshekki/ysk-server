/**
 * PHP apt extension catalog (ondrej/php + Debian/Ubuntu).
 * Package names are versioned: php{X.Y}-{suffix} e.g. php8.2-mysql, php8.3-gd.
 * "gd2" in older panels maps to suffix "gd" (php-gd).
 */

import { PHP_SUPPORTED } from './runtime.js';

export type PhpExtensionGroup =
  | 'core'
  | 'database'
  | 'image'
  | 'web'
  | 'i18n'
  | 'cache'
  | 'crypto'
  | 'mail'
  | 'other';

export type PhpExtensionSpec = {
  /** Stable id used in API/UI (not the apt package name). */
  id: string;
  /** Apt package suffix after php{version}-  e.g. "mysql" → php8.2-mysql */
  aptSuffix: string;
  group: PhpExtensionGroup;
  /** Selected by default on new install */
  recommended?: boolean;
  /**
   * Always installed with PHP (FPM/CLI stack). Not unselectable in install UI;
   * still listed for honesty.
   */
  required?: boolean;
  /** Human label key fragment — UI uses i18n `runtime.phpExt.{id}` with fallback label */
  label: string;
  /** Short hint for operators */
  hint?: string;
};

/**
 * Curated common hosting extensions. Ids are stable; apt names resolved per version.
 */
export const PHP_EXTENSION_CATALOG: PhpExtensionSpec[] = [
  // —— Always with install ——
  {
    id: 'fpm',
    aptSuffix: 'fpm',
    group: 'core',
    required: true,
    recommended: true,
    label: 'FPM',
    hint: 'php-fpm service',
  },
  {
    id: 'cli',
    aptSuffix: 'cli',
    group: 'core',
    required: true,
    recommended: true,
    label: 'CLI',
  },
  {
    id: 'common',
    aptSuffix: 'common',
    group: 'core',
    required: true,
    recommended: true,
    label: 'Common',
  },
  {
    id: 'opcache',
    aptSuffix: 'opcache',
    group: 'core',
    recommended: true,
    label: 'OPcache',
  },
  {
    id: 'readline',
    aptSuffix: 'readline',
    group: 'core',
    recommended: true,
    label: 'Readline',
  },

  // —— Database ——
  {
    id: 'mysql',
    aptSuffix: 'mysql',
    group: 'database',
    recommended: true,
    label: 'MySQL / MariaDB',
    hint: 'mysqli + pdo_mysql',
  },
  {
    id: 'pgsql',
    aptSuffix: 'pgsql',
    group: 'database',
    label: 'PostgreSQL',
    hint: 'pgsql + pdo_pgsql',
  },
  {
    id: 'sqlite3',
    aptSuffix: 'sqlite3',
    group: 'database',
    recommended: true,
    label: 'SQLite3',
  },

  // —— Image ——
  {
    id: 'gd',
    aptSuffix: 'gd',
    group: 'image',
    recommended: true,
    label: 'GD',
    hint: 'images (legacy name: gd2)',
  },
  {
    id: 'imagick',
    aptSuffix: 'imagick',
    group: 'image',
    label: 'Imagick',
    hint: 'ImageMagick',
  },

  // —— Web / content ——
  {
    id: 'curl',
    aptSuffix: 'curl',
    group: 'web',
    recommended: true,
    label: 'cURL',
  },
  {
    id: 'xml',
    aptSuffix: 'xml',
    group: 'web',
    recommended: true,
    label: 'XML',
  },
  {
    id: 'mbstring',
    aptSuffix: 'mbstring',
    group: 'web',
    recommended: true,
    label: 'mbstring',
  },
  {
    id: 'zip',
    aptSuffix: 'zip',
    group: 'web',
    recommended: true,
    label: 'Zip',
  },
  {
    id: 'soap',
    aptSuffix: 'soap',
    group: 'web',
    label: 'SOAP',
  },
  {
    id: 'xsl',
    aptSuffix: 'xsl',
    group: 'web',
    label: 'XSL',
  },
  {
    id: 'tidy',
    aptSuffix: 'tidy',
    group: 'web',
    label: 'Tidy',
  },

  // —— i18n / math ——
  {
    id: 'intl',
    aptSuffix: 'intl',
    group: 'i18n',
    recommended: true,
    label: 'Intl',
  },
  {
    id: 'bcmath',
    aptSuffix: 'bcmath',
    group: 'i18n',
    recommended: true,
    label: 'BCMath',
  },
  {
    id: 'gmp',
    aptSuffix: 'gmp',
    group: 'i18n',
    label: 'GMP',
  },

  // —— Cache ——
  {
    id: 'redis',
    aptSuffix: 'redis',
    group: 'cache',
    label: 'Redis',
  },
  {
    id: 'memcached',
    aptSuffix: 'memcached',
    group: 'cache',
    label: 'Memcached',
  },
  {
    id: 'apcu',
    aptSuffix: 'apcu',
    group: 'cache',
    label: 'APCu',
  },

  // —— Crypto ——
  {
    id: 'mbstring-already',
    aptSuffix: '',
    group: 'crypto',
    label: '',
  },
];

// Remove the accidental empty entry and add real crypto packages
const CRYPTO_AND_REST: PhpExtensionSpec[] = [
  {
    id: 'bz2',
    aptSuffix: 'bz2',
    group: 'other',
    label: 'Bzip2',
  },
  {
    id: 'ldap',
    aptSuffix: 'ldap',
    group: 'other',
    label: 'LDAP',
  },
  {
    id: 'imap',
    aptSuffix: 'imap',
    group: 'mail',
    label: 'IMAP',
  },
  {
    id: 'enchant',
    aptSuffix: 'enchant',
    group: 'other',
    label: 'Enchant',
  },
  {
    id: 'pspell',
    aptSuffix: 'pspell',
    group: 'other',
    label: 'Pspell',
  },
  {
    id: 'snmp',
    aptSuffix: 'snmp',
    group: 'other',
    label: 'SNMP',
  },
  {
    id: 'ssh2',
    aptSuffix: 'ssh2',
    group: 'other',
    label: 'SSH2',
  },
];

/** Full catalog without the placeholder row */
export const PHP_EXTENSIONS: PhpExtensionSpec[] = [
  ...PHP_EXTENSION_CATALOG.filter((e) => e.aptSuffix && e.id !== 'mbstring-already'),
  ...CRYPTO_AND_REST,
];

const BY_ID = new Map(PHP_EXTENSIONS.map((e) => [e.id, e]));

export function listPhpExtensionCatalog(): PhpExtensionSpec[] {
  return PHP_EXTENSIONS.map((e) => ({ ...e }));
}

export function defaultPhpExtensionIds(): string[] {
  return PHP_EXTENSIONS.filter((e) => e.recommended || e.required).map((e) => e.id);
}

export function requiredPhpExtensionIds(): string[] {
  return PHP_EXTENSIONS.filter((e) => e.required).map((e) => e.id);
}

/**
 * Resolve selected extension ids → apt package names for a PHP minor version.
 * Always includes required core packages. Unknown ids ignored (safe).
 */
export function resolvePhpAptPackages(
  version: string,
  extensionIds?: string[] | null,
): { version: string; packages: string[]; resolvedIds: string[] } {
  const ver = version.startsWith('php') ? version.slice(3) : version;
  if (!(PHP_SUPPORTED as readonly string[]).includes(ver)) {
    // still produce packages for free-form if needed; caller validates
  }

  // undefined/null → recommended defaults; [] → required core only; else merge with required
  const extra =
    extensionIds == null
      ? defaultPhpExtensionIds()
      : extensionIds;
  const selected = new Set<string>([...requiredPhpExtensionIds(), ...extra]);

  // Normalize aliases users / old panels may send
  const aliases: Record<string, string> = {
    gd2: 'gd',
    mysqli: 'mysql',
    pdo_mysql: 'mysql',
    pdo_pgsql: 'pgsql',
    postgresql: 'pgsql',
    'php-mysql': 'mysql',
    'php-gd': 'gd',
  };
  for (const raw of [...selected]) {
    const a = aliases[raw.toLowerCase()];
    if (a) {
      selected.delete(raw);
      selected.add(a);
    }
  }

  const resolvedIds: string[] = [];
  const packages: string[] = [];
  const seenPkg = new Set<string>();

  for (const id of selected) {
    const spec = BY_ID.get(id);
    if (!spec?.aptSuffix) continue;
    const pkg = `php${ver}-${spec.aptSuffix}`;
    if (seenPkg.has(pkg)) continue;
    seenPkg.add(pkg);
    packages.push(pkg);
    resolvedIds.push(spec.id);
  }

  // Stable order: required first, then alpha
  packages.sort((a, b) => {
    const ra = a.includes('-fpm') || a.includes('-cli') || a.includes('-common') ? 0 : 1;
    const rb = b.includes('-fpm') || b.includes('-cli') || b.includes('-common') ? 0 : 1;
    return ra - rb || a.localeCompare(b);
  });

  return { version: ver, packages, resolvedIds };
}

/** Catalog payload for API / UI (no secrets). */
export function phpExtensionCatalogDto(version?: string) {
  const ver = version && (PHP_SUPPORTED as readonly string[]).includes(version) ? version : '8.2';
  return {
    version: ver,
    supportedVersions: [...PHP_SUPPORTED],
    extensions: PHP_EXTENSIONS.map((e) => ({
      id: e.id,
      group: e.group,
      label: e.label,
      hint: e.hint,
      recommended: Boolean(e.recommended),
      required: Boolean(e.required),
      /** Example package for selected version */
      package: `php${ver}-${e.aptSuffix}`,
    })),
    defaults: defaultPhpExtensionIds(),
  };
}
