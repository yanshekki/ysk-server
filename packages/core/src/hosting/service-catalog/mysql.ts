import type { SettingDef } from './types.js';

/** MySQL 5.7 / 8.0 catalog — filtered by live version */
export const MYSQL_SETTING_DEFS: SettingDef[] = [
  // Network
  {
    key: 'port',
    label: 'notes.port',
    category: 'network',
    type: 'int',
    applyMode: 'restart',
    description: 'notes.auto.n0534' },
  {
    key: 'bind_address',
    label: 'notes.auto.n0041',
    category: 'network',
    type: 'string',
    applyMode: 'restart',
    confKey: 'bind-address',
    description: 'notes.auto.n1266' },
  {
    key: 'max_connections',
    label: 'notes.auto.n0040',
    category: 'network',
    type: 'int',
    applyMode: 'runtime' },
  {
    key: 'max_connect_errors',
    label: 'notes.auto.n0938',
    category: 'network',
    type: 'int',
    applyMode: 'runtime' },
  {
    key: 'wait_timeout',
    label: 'notes.auto.n1521',
    category: 'network',
    type: 'duration',
    unit: 's',
    applyMode: 'runtime' },
  {
    key: 'interactive_timeout',
    label: 'notes.auto.n0509',
    category: 'network',
    type: 'duration',
    unit: 's',
    applyMode: 'runtime' },
  {
    key: 'skip_name_resolve',
    label: 'notes.auto.n1253',
    category: 'network',
    type: 'bool',
    applyMode: 'restart',
    description: 'notes.auto.n0896' },
  // Performance
  {
    key: 'innodb_buffer_pool_size',
    label: 'notes.auto.n0124',
    category: 'performance',
    type: 'bytes',
    applyMode: 'restart',
    description: 'notes.auto.n0506' },
  {
    key: 'innodb_log_file_size',
    label: 'notes.auto.n0123',
    category: 'performance',
    type: 'bytes',
    applyMode: 'restart' },
  {
    key: 'innodb_flush_log_at_trx_commit',
    label: 'notes.auto.n0122',
    category: 'performance',
    type: 'enum',
    enumValues: ['0', '1', '2'],
    applyMode: 'runtime',
    description: 'notes.auto.n0065' },
  {
    key: 'tmp_table_size',
    label: 'notes.auto.n0924',
    category: 'performance',
    type: 'bytes',
    applyMode: 'runtime' },
  {
    key: 'max_heap_table_size',
    label: 'notes.auto.n1361',
    category: 'performance',
    type: 'bytes',
    applyMode: 'runtime' },
  {
    key: 'table_open_cache',
    label: 'notes.auto.n1347',
    category: 'performance',
    type: 'int',
    applyMode: 'runtime' },
  // Charset
  {
    key: 'character_set_server',
    label: 'notes.auto.n0518',
    category: 'network',
    type: 'string',
    applyMode: 'restart' },
  {
    key: 'collation_server',
    label: 'notes.auto.n0520',
    category: 'network',
    type: 'string',
    applyMode: 'restart' },
  // Logging
  {
    key: 'slow_query_log',
    label: 'notes.auto.n0833',
    category: 'logging',
    type: 'enum',
    enumValues: ['ON', 'OFF'],
    applyMode: 'runtime' },
  {
    key: 'long_query_time',
    label: 'notes.auto.n0835',
    category: 'logging',
    type: 'duration',
    unit: 's',
    applyMode: 'runtime' },
  {
    key: 'log_error',
    label: 'notes.auto.n0023',
    category: 'logging',
    type: 'string',
    applyMode: 'restart' },
  {
    key: 'general_log',
    label: 'notes.auto.n0486',
    category: 'logging',
    type: 'enum',
    enumValues: ['ON', 'OFF'],
    applyMode: 'runtime',
    danger: true,
    description: 'notes.auto.n1520' },
  // Persistence / binlog
  {
    key: 'log_bin',
    label: 'notes.auto.n0508',
    category: 'persistence',
    type: 'string',
    applyMode: 'restart',
    description: 'notes.auto.n1299' },
  {
    key: 'binlog_format',
    label: 'notes.auto.n0082',
    category: 'persistence',
    type: 'enum',
    enumValues: ['ROW', 'STATEMENT', 'MIXED'],
    applyMode: 'runtime' },
  {
    key: 'binlog_expire_logs_seconds',
    label: 'notes.auto.n0081',
    category: 'persistence',
    type: 'int',
    applyMode: 'runtime',
    minVersion: '8.0' },
  {
    key: 'expire_logs_days',
    label: 'notes.auto.n0080',
    category: 'persistence',
    type: 'int',
    applyMode: 'runtime',
    maxVersion: '5.7' },
  // Security
  {
    key: 'require_secure_transport',
    label: 'notes.auto.n0830',
    category: 'security',
    type: 'enum',
    enumValues: ['ON', 'OFF'],
    applyMode: 'runtime',
    minVersion: '5.7' },
  {
    key: 'default_authentication_plugin',
    label: 'notes.auto.n1601',
    category: 'security',
    type: 'string',
    applyMode: 'restart',
    minVersion: '5.7',
    maxVersion: '8.0' },
];

export const MARIADB_SETTING_DEFS: SettingDef[] = [
  ...MYSQL_SETTING_DEFS.filter((d) => d.key !== 'default_authentication_plugin'),
  {
    key: 'thread_handling',
    label: 'notes.auto.n0635',
    category: 'performance',
    type: 'string',
    applyMode: 'restart',
    description: 'notes.auto.n0134' },
];
