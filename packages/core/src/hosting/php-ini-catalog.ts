import { tl } from '@ysk/shared';
import { FALLBACK_TIMEZONES } from '../host/timezones.js';
import {
  PHP_DISABLE_FUNCTIONS_DEFAULT,
  PHP_DISABLE_FUNCTIONS_OPTIONS,
} from './php-disable-functions.js';
/**
 * Curated php.ini directives for panel forms.
 * One catalog field → one form row in the UI.
 */

export type PhpIniFieldType =
  | 'string'
  | 'int'
  | 'bool'
  | 'bytes'
  | 'select'
  | 'multiselect'
  | 'textarea';

/** IANA zones for date.timezone — select only, not free text. */
export const PHP_TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  ...new Set([
    ...FALLBACK_TIMEZONES,
    'Asia/Macau',
    'Asia/Seoul',
    'Asia/Jakarta',
    'Asia/Manila',
    'Asia/Ho_Chi_Minh',
    'Asia/Kuala_Lumpur',
    'Asia/Kathmandu',
    'Asia/Karachi',
    'Asia/Riyadh',
    'Asia/Tehran',
    'Asia/Jerusalem',
    'Europe/Amsterdam',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Istanbul',
    'Europe/Warsaw',
    'Europe/Stockholm',
    'Africa/Cairo',
    'Africa/Johannesburg',
    'America/Toronto',
    'America/Vancouver',
    'America/Mexico_City',
    'America/Argentina/Buenos_Aires',
    'Pacific/Honolulu',
    'Pacific/Fiji',
  ]),
]
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b))
  .map((z) => ({ value: z, label: z }));

/** Common PHP default_charset values — select only. */
export const PHP_CHARSET_OPTIONS: Array<{ value: string; label: string }> = [
  'UTF-8',
  'ISO-8859-1',
  'ISO-8859-15',
  'Windows-1252',
  'GBK',
  'GB2312',
  'Big5',
  'EUC-JP',
  'Shift_JIS',
  'EUC-KR',
  'KOI8-R',
  'ISO-8859-2',
].map((c) => ({ value: c, label: c }));

export interface PhpIniField {
  key: string;
  /** Human label shown in form (resolved via tl at list time) */
  label: string;
  type: PhpIniFieldType;
  default: string | number | boolean;
  hint?: string;
  danger?: boolean;
  options?: Array<{ value: string; label: string; group?: string }>;
  group: string;
}

/** error_reporting select schemes (value = php.ini expression). */
export const PHP_ERROR_REPORTING_OPTIONS: Array<{ value: string; labelKey: string }> = [
  {
    value: 'E_ALL & ~E_DEPRECATED & ~E_STRICT',
    labelKey: 'runtime.phpIniCatalog.options.errorReportingProd',
  },
  { value: 'E_ALL', labelKey: 'runtime.phpIniCatalog.options.errorReportingAll' },
  {
    value: 'E_ALL & ~E_NOTICE & ~E_DEPRECATED',
    labelKey: 'runtime.phpIniCatalog.options.errorReportingQuiet',
  },
  {
    value: 'E_ERROR | E_WARNING | E_PARSE',
    labelKey: 'runtime.phpIniCatalog.options.errorReportingMinimal',
  },
  { value: '0', labelKey: 'runtime.phpIniCatalog.options.errorReportingOff' },
];

export const PHP_OPEN_BASEDIR_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'runtime.phpIniCatalog.options.openBasedirNone' },
  { value: '/var/www', labelKey: 'runtime.phpIniCatalog.options.openBasedirVarWww' },
  { value: '/home', labelKey: 'runtime.phpIniCatalog.options.openBasedirHome' },
  { value: '/var/www:/tmp', labelKey: 'runtime.phpIniCatalog.options.openBasedirWwwTmp' },
];

export const PHP_ERROR_LOG_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'runtime.phpIniCatalog.options.errorLogDefault' },
  { value: '/var/log/php/error.log', labelKey: 'runtime.phpIniCatalog.options.errorLogPhp' },
  { value: '/var/log/php8.3-fpm.log', labelKey: 'runtime.phpIniCatalog.options.errorLogFpm' },
  { value: 'syslog', labelKey: 'runtime.phpIniCatalog.options.errorLogSyslog' },
];

export interface PhpIniGroup {
  id: string;
  title: string;
  description?: string;
  fields: PhpIniField[];
}

/** i18n helpers — dedicated runtime.phpIniCatalog (not broken notes.auto EN). */
const g = (id: string) => tl(`runtime.phpIniCatalog.groups.${id}.title`);
const gd = (id: string) => tl(`runtime.phpIniCatalog.groups.${id}.description`);
const fl = (id: string) => tl(`runtime.phpIniCatalog.fields.${id}.label`);
const fh = (id: string) => tl(`runtime.phpIniCatalog.fields.${id}.hint`);
const opt = (id: string) => tl(`runtime.phpIniCatalog.options.${id}`);

/** Build catalog at call time so request locale is respected. */
function buildPhpIniGroups(): PhpIniGroup[] {
  return [
  {
    id: 'resource',
    title: g('resource'),
    description: gd('resource'),
    fields: [
      {
        key: 'memory_limit',
        label: fl('memory_limit'),
        type: 'bytes',
        default: '256M',
        hint: fh('memory_limit'),
        group: 'resource' },
      {
        key: 'max_execution_time',
        label: fl('max_execution_time'),
        type: 'int',
        default: 60,
        hint: fh('max_execution_time'),
        group: 'resource' },
      {
        key: 'max_input_time',
        label: fl('max_input_time'),
        type: 'int',
        default: 60,
        hint: fh('max_input_time'),
        group: 'resource' },
      {
        key: 'max_input_vars',
        label: fl('max_input_vars'),
        type: 'int',
        default: 5000,
        hint: fh('max_input_vars'),
        group: 'resource' },
      {
        key: 'max_input_nesting_level',
        label: fl('max_input_nesting_level'),
        type: 'int',
        default: 64,
        group: 'resource' },
    ] },
  {
    id: 'upload',
    title: g('upload'),
    description: gd('upload'),
    fields: [
      {
        key: 'file_uploads',
        label: fl('file_uploads'),
        type: 'bool',
        default: true,
        group: 'upload' },
      {
        key: 'upload_max_filesize',
        label: fl('upload_max_filesize'),
        type: 'bytes',
        default: '64M',
        group: 'upload' },
      {
        key: 'post_max_size',
        label: fl('post_max_size'),
        type: 'bytes',
        default: '64M',
        hint: fh('post_max_size'),
        group: 'upload' },
      {
        key: 'max_file_uploads',
        label: fl('max_file_uploads'),
        type: 'int',
        default: 20,
        group: 'upload' },
    ] },
  {
    id: 'session',
    title: g('session'),
    description: gd('session'),
    fields: [
      {
        key: 'session.save_handler',
        label: fl('session_save_handler'),
        type: 'select',
        default: 'files',
        options: [
          { value: 'files', label: opt('sessionFiles') },
          { value: 'redis', label: opt('sessionRedis') },
          { value: 'memcached', label: opt('sessionMemcached') },
        ],
        group: 'session' },
      {
        key: 'session.gc_maxlifetime',
        label: fl('session_gc_maxlifetime'),
        type: 'int',
        default: 1440,
        hint: fh('session_gc_maxlifetime'),
        group: 'session' },
      {
        key: 'session.cookie_httponly',
        label: fl('session_cookie_httponly'),
        type: 'bool',
        default: true,
        group: 'session' },
      {
        key: 'session.cookie_secure',
        label: fl('session_cookie_secure'),
        type: 'bool',
        default: false,
        hint: fh('session_cookie_secure'),
        group: 'session' },
      {
        key: 'session.use_strict_mode',
        label: fl('session_use_strict_mode'),
        type: 'bool',
        default: true,
        group: 'session' },
    ] },
  {
    id: 'error',
    title: g('error'),
    description: gd('error'),
    fields: [
      {
        key: 'display_errors',
        label: fl('display_errors'),
        type: 'bool',
        default: false,
        hint: fh('display_errors'),
        danger: true,
        group: 'error' },
      {
        key: 'display_startup_errors',
        label: fl('display_startup_errors'),
        type: 'bool',
        default: false,
        group: 'error' },
      {
        key: 'log_errors',
        label: fl('log_errors'),
        type: 'bool',
        default: true,
        group: 'error' },
      {
        key: 'error_reporting',
        label: fl('error_reporting'),
        type: 'select',
        default: 'E_ALL & ~E_DEPRECATED & ~E_STRICT',
        hint: fh('error_reporting'),
        options: PHP_ERROR_REPORTING_OPTIONS.map((o) => ({
          value: o.value,
          label: tl(o.labelKey),
        })),
        group: 'error' },
      {
        key: 'error_log',
        label: fl('error_log'),
        type: 'select',
        default: '',
        hint: fh('error_log'),
        options: PHP_ERROR_LOG_OPTIONS.map((o) => ({
          value: o.value,
          label: tl(o.labelKey),
        })),
        group: 'error' },
    ] },
  {
    id: 'opcache',
    title: g('opcache'),
    description: gd('opcache'),
    fields: [
      {
        key: 'opcache.enable',
        label: fl('opcache_enable'),
        type: 'bool',
        default: true,
        group: 'opcache' },
      {
        key: 'opcache.enable_cli',
        label: fl('opcache_enable_cli'),
        type: 'bool',
        default: false,
        group: 'opcache' },
      {
        key: 'opcache.memory_consumption',
        label: fl('opcache_memory_consumption'),
        type: 'int',
        default: 128,
        hint: fh('opcache_memory_consumption'),
        group: 'opcache' },
      {
        key: 'opcache.interned_strings_buffer',
        label: fl('opcache_interned_strings_buffer'),
        type: 'int',
        default: 16,
        group: 'opcache' },
      {
        key: 'opcache.max_accelerated_files',
        label: fl('opcache_max_accelerated_files'),
        type: 'int',
        default: 10000,
        group: 'opcache' },
      {
        key: 'opcache.validate_timestamps',
        label: fl('opcache_validate_timestamps'),
        type: 'bool',
        default: true,
        hint: fh('opcache_validate_timestamps'),
        group: 'opcache' },
      {
        key: 'opcache.revalidate_freq',
        label: fl('opcache_revalidate_freq'),
        type: 'int',
        default: 2,
        group: 'opcache' },
    ] },
  {
    id: 'security',
    title: g('security'),
    description: gd('security'),
    fields: [
      {
        key: 'allow_url_fopen',
        label: fl('allow_url_fopen'),
        type: 'bool',
        default: true,
        group: 'security' },
      {
        key: 'allow_url_include',
        label: fl('allow_url_include'),
        type: 'bool',
        default: false,
        danger: true,
        group: 'security' },
      {
        key: 'expose_php',
        label: fl('expose_php'),
        type: 'bool',
        default: false,
        group: 'security' },
      {
        key: 'open_basedir',
        label: fl('open_basedir'),
        type: 'select',
        default: '',
        hint: fh('open_basedir'),
        danger: true,
        options: PHP_OPEN_BASEDIR_OPTIONS.map((o) => ({
          value: o.value,
          label: tl(o.labelKey),
        })),
        group: 'security' },
      {
        key: 'disable_functions',
        label: fl('disable_functions'),
        type: 'multiselect',
        default: PHP_DISABLE_FUNCTIONS_DEFAULT,
        hint: fh('disable_functions'),
        danger: true,
        options: PHP_DISABLE_FUNCTIONS_OPTIONS.map((o) => ({
          value: o.value,
          label: o.value,
          group: o.group,
        })),
        group: 'security' },
    ] },
  {
    id: 'locale',
    title: g('locale'),
    fields: [
      {
        key: 'date.timezone',
        label: fl('date_timezone'),
        type: 'select',
        default: 'Asia/Hong_Kong',
        options: PHP_TIMEZONE_OPTIONS,
        group: 'locale' },
      {
        key: 'default_charset',
        label: fl('default_charset'),
        type: 'select',
        default: 'UTF-8',
        options: PHP_CHARSET_OPTIONS,
        group: 'locale' },
    ] },
  {
    id: 'misc',
    title: g('misc'),
    fields: [
      {
        key: 'short_open_tag',
        label: fl('short_open_tag'),
        type: 'bool',
        default: false,
        group: 'misc' },
      {
        key: 'realpath_cache_size',
        label: fl('realpath_cache_size'),
        type: 'bytes',
        default: '4096K',
        group: 'misc' },
      {
        key: 'realpath_cache_ttl',
        label: fl('realpath_cache_ttl'),
        type: 'int',
        default: 120,
        group: 'misc' },
      {
        key: 'cgi.fix_redirect',
        label: fl('cgi_fix_redirect'),
        type: 'int',
        default: 0,
        group: 'misc' },
    ] },
  ];
}

/** @deprecated Prefer listPhpIniCatalog() — kept for tests that import static groups */
export const PHP_INI_GROUPS: PhpIniGroup[] = buildPhpIniGroups();

export function listPhpIniCatalog(): PhpIniGroup[] {
  // Rebuild so labels match current request locale
  return buildPhpIniGroups().map((grp) => ({
    ...grp,
    fields: grp.fields.map((f) => ({ ...f })),
  }));
}

export function defaultPhpIniValues(): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const grp of buildPhpIniGroups()) {
    for (const f of grp.fields) {
      out[f.key] = f.default;
    }
  }
  return out;
}

export function allPhpIniKeys(): string[] {
  return buildPhpIniGroups().flatMap((grp) => grp.fields.map((f) => f.key));
}
