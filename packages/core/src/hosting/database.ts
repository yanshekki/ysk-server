/**
 * MySQL/MariaDB + Redis management plans (pure orchestration).
 */

import { ErrorCodes, YskError } from '@ysk/shared';

export interface DatabasePlan {
  kind: 'mysql' | 'mariadb' | 'redis';
  commands: string[];
  notes: string[];
  connectionHint?: Record<string, string | number>;
}

/**
 * Plan creation of a MySQL/MariaDB database + user with limited grants.
 */
export function planMysqlDatabase(input: {
  dbName: string;
  username: string;
  host?: string;
  privileges?: string;
}): DatabasePlan {
  assertIdent(input.dbName, 'dbName');
  assertIdent(input.username, 'username');
  const host = input.host ?? 'localhost';
  const privileges = input.privileges ?? 'SELECT,INSERT,UPDATE,DELETE,CREATE,INDEX,ALTER';
  return {
    kind: 'mysql',
    commands: [
      `CREATE DATABASE IF NOT EXISTS \`${input.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
      `CREATE USER IF NOT EXISTS '${input.username}'@'${host}' IDENTIFIED BY '***';`,
      `GRANT ${privileges} ON \`${input.dbName}\`.* TO '${input.username}'@'${host}';`,
      'FLUSH PRIVILEGES;',
    ],
    notes: ['密碼需由安全管道設定', '需要 MySQL／MariaDB 管理員權限'],
    connectionHint: { database: input.dbName, user: input.username, host },
  };
}

/**
 * Plan a Redis logical DB / instance binding for a project.
 */
export function planRedisBinding(input: {
  projectId: string;
  dbIndex: number;
  maxmemoryMb?: number;
}): DatabasePlan {
  if (!Number.isInteger(input.dbIndex) || input.dbIndex < 0 || input.dbIndex > 15) {
    throw new YskError(ErrorCodes.VALIDATION, 'Redis dbIndex 須為 0–15', {
      httpStatus: 400,
    });
  }
  const maxmem = input.maxmemoryMb ?? 64;
  return {
    kind: 'redis',
    commands: [
      `# Bind project ${input.projectId} to Redis DB ${input.dbIndex}`,
      `CONFIG SET maxmemory-policy allkeys-lru`,
      `# Optional dedicated instance memory hint: ${maxmem}mb`,
    ],
    notes: ['預設以 Redis 邏輯 DB 編號隔離', '更強隔離請使用獨立 Redis 實例'],
    connectionHint: { db: input.dbIndex, maxmemoryMb: maxmem },
  };
}

function assertIdent(value: string, field: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)) {
    throw new YskError(ErrorCodes.VALIDATION, `欄位 ${field} 無效：${value}`, { httpStatus: 400 });
  }
}
