/**
 * Optional root password for dump/import during SQL engine switch.
 * Prefer unix_socket (no password). Override: arg or YSK_SQL_ROOT_PASSWORD.
 */

export function resolveSqlRootPassword(explicit?: string): string | undefined {
  const p = (explicit ?? process.env.YSK_SQL_ROOT_PASSWORD ?? '').trim();
  return p || undefined;
}

/** Shell fragment: export MYSQL_PWD for client tools (quoted safely). */
export function sqlPasswordEnvPrefix(password?: string): string {
  if (!password) return '';
  const esc = password.replace(/'/g, `'\\''`);
  return `export MYSQL_PWD='${esc}'; `;
}

export function sqlPassFlag(password?: string): string {
  if (!password) return '';
  // mysqldump -p'pass' form
  const esc = password.replace(/'/g, `'\\''`);
  return `-p'${esc}'`;
}
