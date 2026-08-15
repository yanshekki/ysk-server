/**
 * Preview MySQL ↔ MariaDB exclusive switch (no host mutation).
 */

import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { HostSoftwareProbe } from '../software-probe/index.js';
import {
  SQL_SWITCH_CONFIRM_PHRASE,
  type SqlSwitchPreview,
  type SqlSwitchTarget,
  type SqlSwitchDbInfo,
  type SqlSwitchWarningKey,
} from './types.js';

const BASE_WARNING_KEYS: SqlSwitchWarningKey[] = [
  'exclusive',
  'uninstall_packages',
  'logical_dump',
  'dialect_risk',
  'no_replication',
  'root_auth',
];

const SYSTEM_DBS = new Set([
  'information_schema',
  'performance_schema',
  'sys',
  'mysql',
]);

export function targetServerId(target: SqlSwitchTarget): string {
  return target === 'mysql' ? 'mysql-server' : 'mariadb-server';
}

export function targetUnit(target: SqlSwitchTarget): string {
  return target === 'mysql' ? 'mysql' : 'mariadb';
}

export function sourceUnit(flavor: 'mysql' | 'mariadb'): string {
  return flavor === 'mysql' ? 'mysql' : 'mariadb';
}

export function sourceServerId(flavor: 'mysql' | 'mariadb'): string {
  return flavor === 'mysql' ? 'mysql-server' : 'mariadb-server';
}

/** Non-system names from `SHOW DATABASES` (unix_socket / default client). */
export function parseShowDatabasesOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((n) => n && !SYSTEM_DBS.has(n));
}

/** Read-only name list — no table counts (panel inventory). */
export async function listUserDatabaseNames(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<string[]> {
  const clients = flavor === 'mariadb' ? ['mariadb', 'mysql'] : ['mysql', 'mariadb'];
  for (const client of clients) {
    try {
      const r = await host.runCommand([client, '-N', '-e', 'SHOW DATABASES'], {
        timeoutMs: 15_000,
      });
      if (r.stdout.trim()) return parseShowDatabasesOutput(r.stdout);
    } catch {
      /* next client / blocked */
    }
  }
  return [];
}

/** Host SQL accounts (User@Host). Never includes password hashes. */
export async function listSqlUserAccounts(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<Array<{ user: string; host: string }>> {
  const clients = flavor === 'mariadb' ? ['mariadb', 'mysql'] : ['mysql', 'mariadb'];
  for (const client of clients) {
    try {
      const r = await host.runCommand(
        [client, '-N', '-e', 'SELECT User, Host FROM mysql.user'],
        { timeoutMs: 15_000 },
      );
      if (!r.stdout.trim()) continue;
      return r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [user, hst] = l.split(/\s+/);
          return { user: user ?? '', host: hst ?? '%' };
        })
        .filter((u) => u.user);
    } catch {
      /* next */
    }
  }
  return [];
}

/** List non-system databases via mysql/mariadb client (source still running). */
export async function listUserDatabases(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
  rootPassword?: string,
): Promise<SqlSwitchDbInfo[]> {
  const { sqlPasswordEnvPrefix } = await import('./sql-auth.js');
  const env = sqlPasswordEnvPrefix(rootPassword);
  const client = flavor === 'mariadb' ? 'mariadb' : 'mysql';
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `${env}${client} -N -e "SHOW DATABASES" 2>/dev/null || ${env}mysql -N -e "SHOW DATABASES" 2>/dev/null || true`,
    ],
    { timeoutMs: 30_000 },
  );
  const names = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((n) => n && !SYSTEM_DBS.has(n));
  const out: SqlSwitchDbInfo[] = [];
  for (const name of names) {
    const safe = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safe) continue;
    let tableCount: number | undefined;
    const tc = await host.runCommand(
      [
        'bash',
        '-c',
        `${env}${client} -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${safe}'" 2>/dev/null || ${env}mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${safe}'" 2>/dev/null || true`,
      ],
      { timeoutMs: 15_000 },
    );
    const n = parseInt(tc.stdout.trim(), 10);
    if (!Number.isNaN(n)) tableCount = n;
    out.push({ name: safe, tableCount });
  }
  return out;
}

export async function previewSqlEngineSwitch(input: {
  host: HostExecutor;
  target: SqlSwitchTarget;
  dataDir: string;
  rootPassword?: string;
}): Promise<SqlSwitchPreview> {
  const target = input.target;
  if (target !== 'mysql' && target !== 'mariadb') {
    return {
      ok: false,
      currentFlavor: 'none',
      target: 'mysql',
      needsSwitch: false,
      canProceed: false,
      blockReason: 'invalid target (mysql|mariadb)',
      databases: [],
      warnings: [],
      warningKeys: [],
      confirmPhrase: SQL_SWITCH_CONFIRM_PHRASE,
      dataDirHint: join(input.dataDir, 'sql-engine-switch'),
    };
  }

  const probe = new HostSoftwareProbe(input.host);
  const currentFlavor = await probe.detectSqlFlavor();
  const dataDirHint = join(input.dataDir, 'sql-engine-switch');

  if (currentFlavor === 'none') {
    return {
      ok: true,
      currentFlavor,
      target,
      needsSwitch: false,
      canProceed: false,
      blockReason: 'no SQL server installed — use normal one-click install',
      databases: [],
      warnings: [],
      warningKeys: [...BASE_WARNING_KEYS],
      confirmPhrase: SQL_SWITCH_CONFIRM_PHRASE,
      dataDirHint,
      targetUnit: targetUnit(target),
      targetServerId: targetServerId(target),
    };
  }

  if (currentFlavor === target) {
    return {
      ok: true,
      currentFlavor,
      target,
      needsSwitch: false,
      canProceed: false,
      blockReason: `${target} is already the host SQL flavor`,
      databases: [],
      warnings: [],
      warningKeys: [...BASE_WARNING_KEYS],
      confirmPhrase: SQL_SWITCH_CONFIRM_PHRASE,
      dataDirHint,
      sourceUnit: sourceUnit(currentFlavor),
      sourceServerId: sourceServerId(currentFlavor),
      targetUnit: targetUnit(target),
      targetServerId: targetServerId(target),
    };
  }

  // Other flavor installed → switch required
  const { resolveSqlRootPassword } = await import('./sql-auth.js');
  const rootPassword = resolveSqlRootPassword(input.rootPassword);
  const databases = await listUserDatabases(input.host, currentFlavor, rootPassword);
  const execute = input.host.executeEnabled();
  const root = input.host.isRoot();
  let canProceed = true;
  let blockReason: string | undefined;
  if (!execute) {
    canProceed = false;
    blockReason = 'YSK_EXECUTE=1 required';
  } else if (!root) {
    canProceed = false;
    blockReason = 'root required';
  }

  const warningKeys: SqlSwitchWarningKey[] = [
    'replace_engine',
    ...BASE_WARNING_KEYS,
    databases.length ? 'has_user_dbs' : 'no_user_dbs',
  ];
  // English prose only for API logs / non-UI clients (UI uses warningKeys + i18n)
  const warnings: string[] = [
    `Will uninstall ${currentFlavor === 'mysql' ? 'MySQL' : 'MariaDB'} and install ${target === 'mysql' ? 'MySQL' : 'MariaDB'}.`,
    'MySQL and MariaDB cannot run together on one host (exclusive).',
    'Switching will uninstall the current SQL server packages.',
    'User databases will be logical-dumped and re-imported; system schema is not copied as files.',
    'MariaDB-specific or MySQL-specific SQL may fail on import.',
    'Replication, plugins, and binary logs are not migrated.',
    'Root unix_socket / password auth may need re-setup after switch.',
    databases.length
      ? `${databases.length} user database(s) will be exported then imported: ${databases.map((d) => d.name).join(', ')}`
      : 'No user databases detected (only system schemas). Switch will still replace the server.',
  ];

  return {
    ok: true,
    currentFlavor,
    target,
    needsSwitch: true,
    canProceed,
    blockReason,
    databases,
    warnings,
    warningKeys,
    confirmPhrase: SQL_SWITCH_CONFIRM_PHRASE,
    dataDirHint,
    sourceUnit: sourceUnit(currentFlavor),
    sourceServerId: sourceServerId(currentFlavor),
    targetUnit: targetUnit(target),
    targetServerId: targetServerId(target),
  };
}
