/**
 * Researched PHP disable_functions catalog for selection UI (not free-text).
 * Stored in php.ini as comma-separated names — UI multi-check maps to that string.
 *
 * Sources: common hosting hardening (cPanel/Plesk-style deny lists), OWASP PHP
 * configuration cheatsheet, and panel default that already shipped in YSK.
 */

export type DisableFunctionOption = {
  value: string;
  /** i18n key under runtime.phpIniCatalog.disableFn.groups.* or plain group id */
  group: 'process' | 'dynamic' | 'info' | 'filesystem' | 'network';
  /** Recommended default for shared hosting */
  recommended?: boolean;
};

/** Panel-recommended default (matches historical catalog default). */
export const PHP_DISABLE_FUNCTIONS_DEFAULT =
  'exec,passthru,shell_exec,system,proc_open,popen,curl_multi_exec,parse_ini_file,show_source';

/**
 * Curated selectable functions. Keep values exact PHP function names.
 * Labels in UI = value (function name); group labels via i18n.
 */
export const PHP_DISABLE_FUNCTIONS_OPTIONS: DisableFunctionOption[] = [
  // Process execution
  { value: 'exec', group: 'process', recommended: true },
  { value: 'system', group: 'process', recommended: true },
  { value: 'passthru', group: 'process', recommended: true },
  { value: 'shell_exec', group: 'process', recommended: true },
  { value: 'proc_open', group: 'process', recommended: true },
  { value: 'proc_close', group: 'process' },
  { value: 'proc_get_status', group: 'process' },
  { value: 'proc_nice', group: 'process' },
  { value: 'proc_terminate', group: 'process' },
  { value: 'popen', group: 'process', recommended: true },
  { value: 'pcntl_exec', group: 'process' },
  { value: 'pcntl_fork', group: 'process' },
  // Dangerous dynamic loading
  { value: 'dl', group: 'dynamic', recommended: true },
  { value: 'assert', group: 'dynamic' },
  // Information disclosure
  { value: 'phpinfo', group: 'info' },
  { value: 'show_source', group: 'info', recommended: true },
  { value: 'highlight_file', group: 'info' },
  { value: 'highlight_string', group: 'info' },
  { value: 'get_cfg_var', group: 'info' },
  { value: 'php_uname', group: 'info' },
  // Filesystem / ownership (aggressive — not all recommended)
  { value: 'symlink', group: 'filesystem' },
  { value: 'link', group: 'filesystem' },
  { value: 'chown', group: 'filesystem' },
  { value: 'chgrp', group: 'filesystem' },
  // Network / misc
  { value: 'curl_multi_exec', group: 'network', recommended: true },
  { value: 'parse_ini_file', group: 'network', recommended: true },
  { value: 'fsockopen', group: 'network' },
  { value: 'pfsockopen', group: 'network' },
  { value: 'stream_socket_client', group: 'network' },
];

export function parseDisableFunctions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(/[\s,]+/)) {
    const n = part.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function serializeDisableFunctions(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const v = n.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.join(',');
}

export function recommendedDisableFunctions(): string[] {
  return PHP_DISABLE_FUNCTIONS_OPTIONS.filter((o) => o.recommended).map((o) => o.value);
}
