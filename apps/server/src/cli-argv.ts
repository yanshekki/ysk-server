/**
 * CLI argv helpers — parse globals before command/sub extraction.
 * Value flags support both `--name VALUE` and `--name=VALUE`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLocale, type LocaleCode } from 'ysk-server-shared';

/** Flags whose next token is a value (never a command/sub). */
export const CLI_VALUE_FLAGS = new Set([
  '--data-dir',
  '--config',
  '--locale',
  '--id',
  '--name',
  '--user',
  '--username',
  '--password',
  '--admin-user',
  '--admin-password',
  '--confirm-username',
  '--confirm',
  '--confirm-phrase',
  '--domain',
  '--server-name',
  '--engine',
  '--q',
  '--query',
  '--role',
  '--package-id',
  '--host',
  '--listen-host',
  '--port',
  '--http-port',
  '--udp-port',
  '--listen-port',
  '--kind',
  '--to',
  '--current',
  '--candidate',
  '--package',
  '--packages',
  '--feature',
  '--ids',
  '--tool',
  '--arg',
  '--ip',
  '--dns',
  '--zone',
  '--source',
  '--lines',
  '--unit',
  '--scope',
  '--keep-token',
  '--token',
  '--ttl-minutes',
  '--path',
  '--file',
  '--conf',
  '--conf-file',
  '--connect-host',
  '--desktop',
  '--geometry',
  '--depth',
  '--rfb-bind',
  '--display',
  '--display-min',
  '--display-max',
  '--service',
  '--mode',
  '--allow-from',
  '--allow-countries',
  '--ports',
  '--decision',
  '--exposure-decision',
  '--reason',
  '--provider',
  '--default-provider',
  '--trust-mode',
  '--enabled-providers',
  '--custom-cidrs',
  '--custom-header',
  '--plan',
  '--bundles',
  '--target',
  '--action',
  '--root-password',
  '--data-policy',
  '--latest',
  '--email',
  '--cert',
  '--key',
  '--out',
  '--proto',
  '--access-mode',
  '--lan-cidrs',
  '--endpoint',
  '--public-host',
  '--project-id',
  '--projectId',
  '--upstream',
  '--root',
  '--if-exists',
  '--changes',
  '--cves',
  '--risk',
  '--local',
  '--job',
]);

const BOOL_GLOBALS = new Set([
  '--json',
  '--help',
  '-h',
  '--execute',
  '--apply',
  '--version',
  '-V',
  '--dry-run',
  '--force',
  '--non-interactive',
  '--check',
]);

export type ParsedCliArgv = {
  /** argv without the node/script prefix */
  raw: string[];
  command: string | undefined;
  /** Non-flag tokens including command */
  tokens: string[];
  dataDir?: string;
  config?: string;
  localeFlag?: string;
  json: boolean;
  help: boolean;
  execute: boolean;
  version: boolean;
};

export function flagTakesValue(name: string): boolean {
  return CLI_VALUE_FLAGS.has(name);
}

/** Read `--name VALUE` or `--name=VALUE`. */
export function getOpt(args: string[], name: string): string | undefined {
  const eqPrefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === name) {
      const next = args[i + 1];
      if (next != null && !next.startsWith('-')) return next;
      return undefined;
    }
    if (a.startsWith(eqPrefix)) return a.slice(eqPrefix.length);
  }
  return undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  if (args.includes(name)) return true;
  const eq = `${name}=`;
  return args.some((a) => a.startsWith(eq));
}

export function wantsHostExecute(args: string[]): boolean {
  return hasFlag(args, '--execute') || hasFlag(args, '--apply');
}

/**
 * Positionals after skipping flags and their values.
 * `--json projects list` → ['projects', 'list']
 * `backup --data-dir /var/lib/ysk-server` → ['backup']
 */
export function cliPositionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      out.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.includes('=')) continue;
    if (a.startsWith('-')) {
      const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
      if (flagTakesValue(name) && args[i + 1] && !args[i + 1]!.startsWith('-')) {
        i += 1;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

export function parseCliArgv(args: string[]): ParsedCliArgv {
  const tokens = cliPositionals(args);
  return {
    raw: args,
    command: tokens[0],
    tokens,
    dataDir: getOpt(args, '--data-dir'),
    config: getOpt(args, '--config'),
    localeFlag: getOpt(args, '--locale'),
    json: hasFlag(args, '--json'),
    help: hasFlag(args, '--help') || hasFlag(args, '-h'),
    execute: wantsHostExecute(args),
    version: hasFlag(args, '--version') || hasFlag(args, '-V'),
  };
}

/** CLI language: --locale → YSK_LOCALE → en (never LANG). */
export function cliLocale(
  flag?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): LocaleCode {
  const fromFlag = flag?.trim();
  if (fromFlag) return normalizeLocale(fromFlag);
  const fromEnv = env.YSK_LOCALE?.trim();
  if (fromEnv) return normalizeLocale(fromEnv);
  return 'en';
}

export const PRODUCT_DATA_DIR = '/var/lib/ysk-server';

/**
 * Resolve control-plane data dir:
 * flag → YSK_DATA_DIR → /var/lib/ysk-server when root + ysk.json → undefined (cwd/.ysk).
 */
export function resolveCliDataDir(opts: {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  uid?: number;
  productDir?: string;
  existsSync?: (p: string) => boolean;
}): string | undefined {
  const flag = opts.flag?.trim();
  if (flag) return flag;
  const envDir = (opts.env ?? process.env).YSK_DATA_DIR?.trim();
  if (envDir) return envDir;
  const product = opts.productDir ?? PRODUCT_DATA_DIR;
  const uid =
    opts.uid ??
    (typeof process.getuid === 'function' ? process.getuid() : -1);
  const exists = opts.existsSync ?? existsSync;
  if (uid === 0 && exists(join(product, 'ysk.json'))) return product;
  return undefined;
}

export { BOOL_GLOBALS };
