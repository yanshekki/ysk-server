/**
 * Database engine / service settings / Redis — API contract.
 */

export type DbServiceEngine = 'redis' | 'mysql' | 'mariadb' | 'postgres';

export type DbEngineKind = 'mysql' | 'mariadb';

export interface RedisServiceSettingsDto {
  port: number;
  bind: string;
  databases: number;
  maxmemory: string;
  maxmemoryPolicy: string;
  requirepass: string;
  appendonly: boolean;
  protectedMode: boolean;
  timeout: number;
}

export interface SqlServiceSettingsDto {
  port: number;
  bindAddress: string;
  maxConnections: number;
  characterSetServer?: string;
}

export interface PostgresServiceSettingsDto {
  port: number;
  listenAddresses: string;
  maxConnections: number;
}

export type RedisServiceSettings = RedisServiceSettingsDto;
export type SqlServiceSettings = SqlServiceSettingsDto;
export type PostgresServiceSettings = PostgresServiceSettingsDto;

export interface DbEngineStatusDto {
  engine: DbEngineKind;
  title: string;
  clientInstalled: boolean;
  serverInstalled: boolean;
  unit: string;
  active: string;
  version?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  canProvision: boolean;
  canInstall: boolean;
  blockMessage?: string;
  /** Other exclusive engine installed on host (e.g. mariadb-server) */
  blockedByExclusive?: string;
  /** Debian/Ubuntu /etc/mysql/FROZEN present — daemon blocked after engine switch */
  frozen?: boolean;
  frozenMode?: string;
  /** Data dir looks empty / no system tables — safe to re-init after unfreeze */
  datadirEmpty?: boolean;
}

export type DbEngineStatus = DbEngineStatusDto;

export interface RedisServiceStatusDto {
  serverInstalled: boolean;
  clientInstalled: boolean;
  unit: string;
  active: string;
  reachable: boolean;
  ping: string | null;
  executeEnabled: boolean;
  isRoot: boolean;
  canRead: boolean;
  canWrite: boolean;
  canInstall: boolean;
  version?: string;
  usedMemory?: string;
  connectedClients?: string;
  keyspace: Array<{ db: number; keys: number; expires?: number }>;
  databases?: number;
  configuredDatabases?: number;
  blockMessage?: string;
}

export type RedisServiceStatus = RedisServiceStatusDto;

export interface RedisKeyListItemDto {
  key: string;
  type?: string;
  ttl?: number;
}

export type RedisKeyListItem = RedisKeyListItemDto;

export interface RedisKeyViewDto {
  key: string;
  type: string;
  ttl: number;
  value:
    | string
    | Record<string, string>
    | string[]
    | Array<{ member: string; score: string }>;
}

export type RedisKeyView = RedisKeyViewDto;
