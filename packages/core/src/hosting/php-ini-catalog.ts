import { tl } from '@ysk/shared';
/**
 * Curated php.ini directives for panel forms (zh-TW labels).
 * One catalog field → one form row in the UI.
 */

export type PhpIniFieldType = 'string' | 'int' | 'bool' | 'bytes' | 'select' | 'textarea';

export interface PhpIniField {
  key: string;
  /** Human label (zh-TW) shown in form */
  label: string;
  type: PhpIniFieldType;
  default: string | number | boolean;
  hint?: string;
  danger?: boolean;
  options?: Array<{ value: string; label: string }>;
  group: string;
}

export interface PhpIniGroup {
  id: string;
  title: string;
  description?: string;
  fields: PhpIniField[];
}

export const PHP_INI_GROUPS: PhpIniGroup[] = [
  {
    id: 'resource',
    title: tl('notes.auto.n1456'),
    description: tl('notes.auto.n1042'),
    fields: [
      {
        key: 'memory_limit',
        label: tl('notes.auto.n1356'),
        type: 'bytes',
        default: '256M',
        hint: tl('notes.auto.n0550'),
        group: 'resource' },
      {
        key: 'max_execution_time',
        label: tl('notes.auto.n0941'),
        type: 'int',
        default: 60,
        hint: tl('notes.auto.n1296'),
        group: 'resource' },
      {
        key: 'max_input_time',
        label: tl('notes.auto.n0942'),
        type: 'int',
        default: 60,
        hint: tl('notes.auto.n1297'),
        group: 'resource' },
      {
        key: 'max_input_vars',
        label: tl('notes.auto.n0934'),
        type: 'int',
        default: 5000,
        hint: tl('notes.auto.n0055'),
        group: 'resource' },
      {
        key: 'max_input_nesting_level',
        label: tl('notes.auto.n1464'),
        type: 'int',
        default: 64,
        group: 'resource' },
    ] },
  {
    id: 'upload',
    title: tl('notes.auto.n0489'),
    description: tl('notes.auto.n1020'),
    fields: [
      {
        key: 'file_uploads',
        label: tl('notes.auto.n0580'),
        type: 'bool',
        default: true,
        group: 'upload' },
      {
        key: 'upload_max_filesize',
        label: tl('notes.auto.n0624'),
        type: 'bytes',
        default: '64M',
        group: 'upload' },
      {
        key: 'post_max_size',
        label: tl('notes.auto.n0154'),
        type: 'bytes',
        default: '64M',
        hint: tl('notes.auto.n0837'),
        group: 'upload' },
      {
        key: 'max_file_uploads',
        label: tl('notes.auto.n0625'),
        type: 'int',
        default: 20,
        group: 'upload' },
    ] },
  {
    id: 'session',
    title: 'Session',
    description: tl('notes.auto.n0722'),
    fields: [
      {
        key: 'session.save_handler',
        label: tl('notes.auto.n0191'),
        type: 'select',
        default: 'files',
        options: [
          { value: 'files', label: tl('notes.auto.n0290') },
          { value: 'redis', label: 'redis' },
          { value: 'memcached', label: 'memcached' },
        ],
        group: 'session' },
      {
        key: 'session.gc_maxlifetime',
        label: tl('notes.auto.n0193'),
        type: 'int',
        default: 1440,
        hint: tl('notes.auto.n1295'),
        group: 'session' },
      {
        key: 'session.cookie_httponly',
        label: 'Cookie HttpOnly',
        type: 'bool',
        default: true,
        group: 'session' },
      {
        key: 'session.cookie_secure',
        label: tl('notes.auto.n0090'),
        type: 'bool',
        default: false,
        hint: tl('notes.auto.n0116'),
        group: 'session' },
      {
        key: 'session.use_strict_mode',
        label: tl('notes.auto.n0192'),
        type: 'bool',
        default: true,
        group: 'session' },
    ] },
  {
    id: 'error',
    title: tl('notes.auto.n1518'),
    description: tl('notes.auto.n1604'),
    fields: [
      {
        key: 'display_errors',
        label: tl('notes.auto.n1605'),
        type: 'bool',
        default: false,
        hint: tl('notes.auto.n1244'),
        danger: true,
        group: 'error' },
      {
        key: 'display_startup_errors',
        label: tl('notes.auto.n1603'),
        type: 'bool',
        default: false,
        group: 'error' },
      {
        key: 'log_errors',
        label: tl('notes.auto.n1364'),
        type: 'bool',
        default: true,
        group: 'error' },
      {
        key: 'error_reporting',
        label: tl('notes.auto.n1516'),
        type: 'string',
        default: 'E_ALL & ~E_DEPRECATED & ~E_STRICT',
        hint: tl('notes.auto.n0840'),
        group: 'error' },
      {
        key: 'error_log',
        label: tl('notes.auto.n0023'),
        type: 'string',
        default: '',
        hint: tl('notes.auto.n1251'),
        group: 'error' },
    ] },
  {
    id: 'opcache',
    title: 'OPcache',
    description: tl('notes.auto.n0536'),
    fields: [
      {
        key: 'opcache.enable',
        label: tl('notes.auto.n0621'),
        type: 'bool',
        default: true,
        group: 'opcache' },
      {
        key: 'opcache.enable_cli',
        label: tl('notes.auto.n0085'),
        type: 'bool',
        default: false,
        group: 'opcache' },
      {
        key: 'opcache.memory_consumption',
        label: tl('notes.auto.n0144'),
        type: 'int',
        default: 128,
        hint: 'MB',
        group: 'opcache' },
      {
        key: 'opcache.interned_strings_buffer',
        label: tl('notes.auto.n0647'),
        type: 'int',
        default: 16,
        group: 'opcache' },
      {
        key: 'opcache.max_accelerated_files',
        label: tl('notes.auto.n0933'),
        type: 'int',
        default: 10000,
        group: 'opcache' },
      {
        key: 'opcache.validate_timestamps',
        label: tl('notes.auto.n1024'),
        type: 'bool',
        default: true,
        hint: tl('notes.auto.n1243'),
        group: 'opcache' },
      {
        key: 'opcache.revalidate_freq',
        label: tl('notes.auto.n1025'),
        type: 'int',
        default: 2,
        group: 'opcache' },
    ] },
  {
    id: 'security',
    title: tl('notes.auto.n0651'),
    description: tl('notes.auto.n1483'),
    fields: [
      {
        key: 'allow_url_fopen',
        label: tl('notes.auto.n0579'),
        type: 'bool',
        default: true,
        group: 'security' },
      {
        key: 'allow_url_include',
        label: tl('notes.auto.n0578'),
        type: 'bool',
        default: false,
        danger: true,
        group: 'security' },
      {
        key: 'expose_php',
        label: tl('notes.auto.n0925'),
        type: 'bool',
        default: false,
        group: 'security' },
      {
        key: 'open_basedir',
        label: tl('notes.auto.n0351'),
        type: 'string',
        default: '',
        hint: tl('notes.auto.n1250'),
        danger: true,
        group: 'security' },
      {
        key: 'disable_functions',
        label: tl('notes.auto.n1293'),
        type: 'textarea',
        default:
          'exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source',
        hint: tl('notes.auto.n1466'),
        danger: true,
        group: 'security' },
    ] },
  {
    id: 'locale',
    title: tl('notes.auto.n0923'),
    fields: [
      {
        key: 'date.timezone',
        label: tl('notes.auto.n0922'),
        type: 'string',
        default: 'Asia/Hong_Kong',
        group: 'locale' },
      {
        key: 'default_charset',
        label: tl('notes.auto.n1600'),
        type: 'string',
        default: 'UTF-8',
        group: 'locale' },
    ] },
  {
    id: 'misc',
    title: tl('notes.auto.n0594'),
    fields: [
      {
        key: 'short_open_tag',
        label: tl('notes.auto.n1285'),
        type: 'bool',
        default: false,
        group: 'misc' },
      {
        key: 'realpath_cache_size',
        label: tl('notes.auto.n0400'),
        type: 'bytes',
        default: '4096K',
        group: 'misc' },
      {
        key: 'realpath_cache_ttl',
        label: tl('notes.auto.n0401'),
        type: 'int',
        default: 120,
        group: 'misc' },
      {
        key: 'cgi.fix_redirect',
        label: 'cgi.fix_redirect',
        type: 'int',
        default: 0,
        group: 'misc' },
    ] },
];

export function listPhpIniCatalog(): PhpIniGroup[] {
  return PHP_INI_GROUPS.map((g) => ({
    ...g,
    fields: g.fields.map((f) => ({ ...f })) }));
}

export function defaultPhpIniValues(): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const g of PHP_INI_GROUPS) {
    for (const f of g.fields) {
      out[f.key] = f.default;
    }
  }
  return out;
}

export function allPhpIniKeys(): string[] {
  return PHP_INI_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
}
