/**
 * MySQL / Redis connection probes and SQL plan execution hooks.
 */

import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
import net from 'node:net';

export interface DbEndpoint {
  host: string;
  port: number;
}

/**
 * TCP probe for database reachability (no native mysql client required).
 */
export function probeEndpoint(host: string, port: number, timeoutMs = 3000): Promise<{
  ok: boolean;
  latencyMs: number;
  detail: string;
}> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true, `connected to ${host}:${port}`));
    socket.on('timeout', () => finish(false, 'timeout'));
    socket.on('error', (e) => finish(false, e.message));
  });
}


/** Escape a string for single-quoted MySQL string literals. */
export function escapeMysqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
}

/** Host part of user@host — %, hostname, or IPv4-ish; reject quotes and spaces. */
export function validateMysqlHost(host: string): string {
  const h = (host ?? '%').trim() || '%';
  if (h.length > 255 || /['"\\\s;]/.test(h)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0428', { v0: ('host') }), {
      httpStatus: 400,
    });
  }
  return h;
}

export function validateMysqlIdent(name: string, field: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0428', { v0: (field) }), { httpStatus: 400 });
  }
}

/**
 * Render SQL for create database + user (password placeholder for audit).
 */
export function renderMysqlProvisionSql(input: {
  dbName: string;
  username: string;
  password?: string;
  host?: string;
}): { sql: string[]; connectionHint: Record<string, string> } {
  validateMysqlIdent(input.dbName, 'dbName');
  validateMysqlIdent(input.username, 'username');
  const host = validateMysqlHost(input.host ?? '%');
  const pass = escapeMysqlString(input.password ?? 'CHANGE_ME');
  return {
    sql: [
      `CREATE DATABASE IF NOT EXISTS \`${input.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
      `CREATE USER IF NOT EXISTS '${input.username}'@'${host}' IDENTIFIED BY '${pass}';`,
      `GRANT ALL PRIVILEGES ON \`${input.dbName}\`.* TO '${input.username}'@'${host}';`,
      'FLUSH PRIVILEGES;',
    ],
    connectionHint: {
      database: input.dbName,
      user: input.username,
      host: input.host ?? 'localhost',
    },
  };
}
