/**
 * Best-effort export of SHOW GRANTS for non-system users (logical migration).
 */

import type { HostExecutor } from '../../host/executor.js';

const SKIP_USERS = new Set([
  'mysql.sys',
  'mysql.session',
  'mysql.infoschema',
  'mariadb.sys',
  'debian-sys-maint',
]);

export async function exportUserGrants(
  host: HostExecutor,
  flavor: 'mysql' | 'mariadb',
): Promise<{ ok: boolean; sql: string; notes: string[] }> {
  const client = flavor === 'mariadb' ? 'mariadb' : 'mysql';
  const list = await host.runCommand(
    [
      'bash',
      '-c',
      `${client} -N -e "SELECT user,host FROM mysql.user" 2>/dev/null || mysql -N -e "SELECT user,host FROM mysql.user" 2>/dev/null || true`,
    ],
    { timeoutMs: 30_000 },
  );
  const lines = list.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const parts: string[] = [
    '-- YSK sql-engine-switch: grants (best-effort)',
    'FLUSH PRIVILEGES;',
  ];
  let count = 0;
  for (const line of lines) {
    const cols = line.split(/\t/);
    const user = cols[0]?.trim() ?? '';
    const hostPart = cols[1]?.trim() ?? '%';
    if (!user || SKIP_USERS.has(user) || user.startsWith('mysql.')) continue;
    if (user === 'root' && (hostPart === 'localhost' || hostPart === '127.0.0.1')) {
      // keep root grants optional — unix_socket often differs; still export
    }
    const uEsc = user.replace(/'/g, "\\'");
    const hEsc = hostPart.replace(/'/g, "\\'");
    const g = await host.runCommand(
      [
        'bash',
        '-c',
        `${client} -N -e "SHOW GRANTS FOR '${uEsc}'@'${hEsc}'" 2>/dev/null || mysql -N -e "SHOW GRANTS FOR '${uEsc}'@'${hEsc}'" 2>/dev/null || true`,
      ],
      { timeoutMs: 10_000 },
    );
    for (const gl of g.stdout.split('\n')) {
      const t = gl.trim();
      if (!t) continue;
      // SHOW GRANTS returns GRANT ... — append semicolon if missing
      parts.push(t.endsWith(';') ? t : `${t};`);
      count++;
    }
  }
  parts.push('FLUSH PRIVILEGES;');
  return {
    ok: true,
    sql: parts.join('\n') + '\n',
    notes: count ? [`exported ${count} grant line(s)`] : ['no application grants found'],
  };
}
