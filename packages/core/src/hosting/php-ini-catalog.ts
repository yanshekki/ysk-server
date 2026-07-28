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
    title: '資源限制',
    description: '每一列一個設定；記憶體、執行時間、輸入限制',
    fields: [
      {
        key: 'memory_limit',
        label: '記憶體上限',
        type: 'bytes',
        default: '256M',
        hint: '例如 128M、256M、512M、-1（無限）',
        group: 'resource',
      },
      {
        key: 'max_execution_time',
        label: '最長執行時間',
        type: 'int',
        default: 60,
        hint: '秒；0 = 無限（CLI）',
        group: 'resource',
      },
      {
        key: 'max_input_time',
        label: '最長輸入時間',
        type: 'int',
        default: 60,
        hint: '秒；解析請求的最長時間',
        group: 'resource',
      },
      {
        key: 'max_input_vars',
        label: '最多輸入變數',
        type: 'int',
        default: 5000,
        hint: '$_GET / $_POST / $_COOKIE 變數上限',
        group: 'resource',
      },
      {
        key: 'max_input_nesting_level',
        label: '輸入巢狀層級',
        type: 'int',
        default: 64,
        group: 'resource',
      },
    ],
  },
  {
    id: 'upload',
    title: '上傳與 POST',
    description: '檔案上傳與 POST 體積',
    fields: [
      {
        key: 'file_uploads',
        label: '允許上傳檔案',
        type: 'bool',
        default: true,
        group: 'upload',
      },
      {
        key: 'upload_max_filesize',
        label: '單一檔案上限',
        type: 'bytes',
        default: '64M',
        group: 'upload',
      },
      {
        key: 'post_max_size',
        label: 'POST 體積上限',
        type: 'bytes',
        default: '64M',
        hint: '應 ≥ 單一檔案上限',
        group: 'upload',
      },
      {
        key: 'max_file_uploads',
        label: '單次最多檔案數',
        type: 'int',
        default: 20,
        group: 'upload',
      },
    ],
  },
  {
    id: 'session',
    title: 'Session',
    description: '工作階段儲存與 cookie',
    fields: [
      {
        key: 'session.save_handler',
        label: 'Session 儲存方式',
        type: 'select',
        default: 'files',
        options: [
          { value: 'files', label: 'files（檔案）' },
          { value: 'redis', label: 'redis' },
          { value: 'memcached', label: 'memcached' },
        ],
        group: 'session',
      },
      {
        key: 'session.gc_maxlifetime',
        label: 'Session 存活秒數',
        type: 'int',
        default: 1440,
        hint: '秒',
        group: 'session',
      },
      {
        key: 'session.cookie_httponly',
        label: 'Cookie HttpOnly',
        type: 'bool',
        default: true,
        group: 'session',
      },
      {
        key: 'session.cookie_secure',
        label: 'Cookie Secure（僅 HTTPS）',
        type: 'bool',
        default: false,
        hint: 'HTTPS 站點建議開啟',
        group: 'session',
      },
      {
        key: 'session.use_strict_mode',
        label: 'Session 嚴格模式',
        type: 'bool',
        default: true,
        group: 'session',
      },
    ],
  },
  {
    id: 'error',
    title: '錯誤與日誌',
    description: '顯示錯誤、記錄與報告等級',
    fields: [
      {
        key: 'display_errors',
        label: '顯示錯誤（畫面）',
        type: 'bool',
        default: false,
        hint: '生產環境請關閉',
        danger: true,
        group: 'error',
      },
      {
        key: 'display_startup_errors',
        label: '顯示啟動錯誤',
        type: 'bool',
        default: false,
        group: 'error',
      },
      {
        key: 'log_errors',
        label: '記錄錯誤到日誌',
        type: 'bool',
        default: true,
        group: 'error',
      },
      {
        key: 'error_reporting',
        label: '錯誤報告等級',
        type: 'string',
        default: 'E_ALL & ~E_DEPRECATED & ~E_STRICT',
        hint: '或整數如 32767',
        group: 'error',
      },
      {
        key: 'error_log',
        label: '錯誤日誌路徑',
        type: 'string',
        default: '',
        hint: '留空用系統預設；可填絕對路徑',
        group: 'error',
      },
    ],
  },
  {
    id: 'opcache',
    title: 'OPcache',
    description: '位元碼快取',
    fields: [
      {
        key: 'opcache.enable',
        label: '啟用 OPcache',
        type: 'bool',
        default: true,
        group: 'opcache',
      },
      {
        key: 'opcache.enable_cli',
        label: 'CLI 啟用 OPcache',
        type: 'bool',
        default: false,
        group: 'opcache',
      },
      {
        key: 'opcache.memory_consumption',
        label: 'OPcache 記憶體（MB）',
        type: 'int',
        default: 128,
        hint: 'MB',
        group: 'opcache',
      },
      {
        key: 'opcache.interned_strings_buffer',
        label: '字串 intern 緩衝（MB）',
        type: 'int',
        default: 16,
        group: 'opcache',
      },
      {
        key: 'opcache.max_accelerated_files',
        label: '最多快取檔案數',
        type: 'int',
        default: 10000,
        group: 'opcache',
      },
      {
        key: 'opcache.validate_timestamps',
        label: '檢查檔案變更',
        type: 'bool',
        default: true,
        hint: '生產可關並手動重載',
        group: 'opcache',
      },
      {
        key: 'opcache.revalidate_freq',
        label: '檢查間隔（秒）',
        type: 'int',
        default: 2,
        group: 'opcache',
      },
    ],
  },
  {
    id: 'security',
    title: '安全與路徑',
    description: '遠端檔案、暴露資訊、函式禁用',
    fields: [
      {
        key: 'allow_url_fopen',
        label: '允許 URL 當檔案開',
        type: 'bool',
        default: true,
        group: 'security',
      },
      {
        key: 'allow_url_include',
        label: '允許 URL include',
        type: 'bool',
        default: false,
        danger: true,
        group: 'security',
      },
      {
        key: 'expose_php',
        label: '暴露 PHP 版本頭',
        type: 'bool',
        default: false,
        group: 'security',
      },
      {
        key: 'open_basedir',
        label: 'open_basedir 路徑限制',
        type: 'string',
        default: '',
        hint: '留空不限制；多路徑用 : 分隔',
        danger: true,
        group: 'security',
      },
      {
        key: 'disable_functions',
        label: '禁用函式列表',
        type: 'textarea',
        default:
          'exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source',
        hint: '逗號分隔；過嚴可能弄壞套件',
        danger: true,
        group: 'security',
      },
    ],
  },
  {
    id: 'locale',
    title: '時區與字元',
    fields: [
      {
        key: 'date.timezone',
        label: '時區',
        type: 'string',
        default: 'Asia/Hong_Kong',
        group: 'locale',
      },
      {
        key: 'default_charset',
        label: '預設字元集',
        type: 'string',
        default: 'UTF-8',
        group: 'locale',
      },
    ],
  },
  {
    id: 'misc',
    title: '其他常用',
    fields: [
      {
        key: 'short_open_tag',
        label: '短標籤 <?',
        type: 'bool',
        default: false,
        group: 'misc',
      },
      {
        key: 'realpath_cache_size',
        label: 'realpath 快取大小',
        type: 'bytes',
        default: '4096K',
        group: 'misc',
      },
      {
        key: 'realpath_cache_ttl',
        label: 'realpath 快取秒數',
        type: 'int',
        default: 120,
        group: 'misc',
      },
      {
        key: 'cgi.fix_redirect',
        label: 'cgi.fix_redirect',
        type: 'int',
        default: 0,
        group: 'misc',
      },
    ],
  },
];

export function listPhpIniCatalog(): PhpIniGroup[] {
  return PHP_INI_GROUPS.map((g) => ({
    ...g,
    fields: g.fields.map((f) => ({ ...f })),
  }));
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
