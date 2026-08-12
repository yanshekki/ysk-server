/**
 * Local host executor — real filesystem / process operations.
 * High-risk commands only run when explicitly allowed by policy layer.
 */

import { execFile, spawn } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  rmSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { cpus, freemem, loadavg, totalmem, uptime, hostname, platform, arch, release } from 'node:os';
import { resolve as pathResolve, sep as pathSep } from 'node:path';
import { promisify } from 'node:util';
import { ErrorCodes, YskError, yskError, tl } from 'ysk-server-shared';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  argv: string[];
  dryRun: boolean;
}

/** Live output callback for long installs (apt, curl, …). */
export type CommandChunkHandler = (chunk: {
  stream: 'stdout' | 'stderr';
  text: string;
}) => void;

export type RunCommandOpts = {
  dryRun?: boolean;
  timeoutMs?: number;
  cwd?: string;
  /** When set, use spawn and stream chunks as they arrive (line-ish). */
  onChunk?: CommandChunkHandler;
  /** Abort long installs (SSE client disconnect / cancel). */
  signal?: AbortSignal;
};

export interface HostExecutor {
  readFile(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  writeFile(path: string, content: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  sysInfo(): Promise<Record<string, unknown>>;
  serviceStatus(name: string): Promise<RunResult>;
  runCommand(argv: string[], opts?: RunCommandOpts): Promise<RunResult>;
  pathExists(path: string): boolean;
  isRoot(): boolean;
  executeEnabled(): boolean;
}

export interface LocalHostExecutorOptions {
  /** When false, mutating runCommand refuses unless dryRun */
  executeEnabled?: boolean;
  /** Restrict writes to these roots (fail closed outside) */
  allowedWriteRoots?: string[];
}

/**
 * Real local executor used by control plane tools.
 */
export class LocalHostExecutor implements HostExecutor {
  private readonly executeOn: boolean;
  private readonly writeRoots: string[];

  constructor(opts: LocalHostExecutorOptions = {}) {
    this.executeOn =
      opts.executeEnabled ??
      (process.env.YSK_EXECUTE === '1' || process.env.YSK_EXECUTE === 'true');
    this.writeRoots = opts.allowedWriteRoots ?? [];
  }

  isRoot(): boolean {
    return typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  }

  executeEnabled(): boolean {
    return this.executeOn;
  }

  pathExists(path: string): boolean {
    return existsSync(path);
  }

  async readFile(path: string): Promise<string> {
    try {
      return readFileSync(path, 'utf8');
    } catch (err) {
      throw new YskError(ErrorCodes.INTERNAL, tl('notes.auto.t0105', { v0: (path) }), {
        httpStatus: 500,
        cause: err,
      });
    }
  }

  async listDir(path: string): Promise<string[]> {
    try {
      return readdirSync(path);
    } catch (err) {
      throw new YskError(ErrorCodes.INTERNAL, tl('notes.auto.t0106', { v0: (path) }), {
        httpStatus: 500,
        cause: err,
      });
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const inManagedRoot = this.isUnderWriteRoots(path);
    if (!inManagedRoot && this.writeRoots.length > 0) {
      this.assertWritable(path);
    }
    // Managed dataDir writes always allowed; system paths need YSK_EXECUTE
    if (!inManagedRoot && !this.executeOn) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        tl('ops.blocked.writeOutsideDataDir'),
        { httpStatus: 403, details: { path } },
      );
    }
    if (inManagedRoot || this.writeRoots.length === 0) {
      // still enforce roots when configured
      if (this.writeRoots.length > 0) this.assertWritable(path);
    }
    writeFileSync(path, content, 'utf8');
  }

  async deletePath(path: string): Promise<void> {
    const inManagedRoot = this.isUnderWriteRoots(path);
    if (this.writeRoots.length > 0) this.assertWritable(path);
    if (!inManagedRoot && !this.executeOn) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        tl('notes.auto.n0603'),
        { httpStatus: 403, details: { path } },
      );
    }
    rmSync(path, { recursive: true, force: true });
  }

  async mkdirp(path: string): Promise<void> {
    const inManagedRoot = this.isUnderWriteRoots(path);
    if (this.writeRoots.length > 0) this.assertWritable(path);
    // Outside managed roots requires YSK_EXECUTE (same posture as writeFile)
    if (!inManagedRoot && this.writeRoots.length > 0 && !this.executeOn) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        tl('ops.blocked.writeOutsideDataDir'),
        { httpStatus: 403, details: { path } },
      );
    }
    if (!inManagedRoot && this.writeRoots.length === 0 && !this.executeOn) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        tl('ops.blocked.writeOutsideDataDir'),
        { httpStatus: 403, details: { path } },
      );
    }
    mkdirSync(path, { recursive: true });
  }

  async sysInfo(): Promise<Record<string, unknown>> {
    return {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      release: release(),
      uptimeSec: uptime(),
      loadavg: loadavg(),
      cpus: cpus().length,
      memory: {
        total: totalmem(),
        free: freemem(),
      },
      node: process.version,
      pid: process.pid,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      executeEnabled: this.executeOn,
      isRoot: this.isRoot(),
    };
  }

  async serviceStatus(name: string): Promise<RunResult> {
    if (!/^[a-zA-Z0-9@_.-]+$/.test(name)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0107', { v0: (name) }), {
        httpStatus: 400,
      });
    }
    return this.runCommand(['systemctl', 'is-active', name], { dryRun: false, timeoutMs: 5000 });
  }

  async runCommand(argv: string[], opts: RunCommandOpts = {}): Promise<RunResult> {
    if (!argv.length) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0882'), { httpStatus: 400 });
    }
    if (opts.dryRun) {
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: true };
    }
    // Non-mutating info commands always allowed; mutating requires executeEnabled
    const mutating = isMutatingArgv(argv);
    if (mutating && !this.executeOn) {
      throw yskError(ErrorCodes.FORBIDDEN, {
        httpStatus: 403,
        messageKey: 'notes.auto.n0883',
        details: { argv },
      });
    }
    if (opts.onChunk || opts.signal) {
      return runCommandStreaming(argv, {
        timeoutMs: opts.timeoutMs ?? 30_000,
        cwd: opts.cwd,
        onChunk: opts.onChunk ?? (() => {}),
        signal: opts.signal,
      });
    }
    try {
      const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
        timeout: opts.timeoutMs ?? 30_000,
        cwd: opts.cwd,
        maxBuffer: 2 * 1024 * 1024,
      });
      return {
        stdout: String(stdout),
        stderr: String(stderr),
        exitCode: 0,
        argv,
        dryRun: false,
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        stdout: String(e.stdout ?? ''),
        stderr: String(e.stderr ?? e.message ?? 'command failed'),
        exitCode: typeof e.code === 'number' ? e.code : 1,
        argv,
        dryRun: false,
      };
    }
  }

  private isUnderWriteRoots(path: string): boolean {
    if (!this.writeRoots.length) return false;
    return this.writeRoots.some((root) => pathUnderRoot(root, path));
  }

  private assertWritable(path: string): void {
    if (!this.writeRoots.length) return;
    if (!this.isUnderWriteRoots(path)) {
      throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.auto.t0108', { v0: (path) }), {
        httpStatus: 403,
        details: { path, writeRoots: this.writeRoots },
      });
    }
  }
}

/**
 * Boundary-safe path containment (resolve + prefix). Prevents `/tmp/../etc` escaping
 * string-prefix roots.
 */
export function pathUnderRoot(root: string, target: string): boolean {
  if (!root || !target) return false;
  if (target.includes('\0') || root.includes('\0')) return false;
  const rootAbs = pathResolve(root);
  const abs = pathResolve(target);
  if (abs === rootAbs) return true;
  // Bare filesystem root `/` only matches exact `/`
  if (rootAbs === pathSep) return abs === pathSep;
  const prefix = rootAbs.endsWith(pathSep) ? rootAbs : rootAbs + pathSep;
  return abs.startsWith(prefix);
}

/**
 * True when argv requires YSK_EXECUTE.
 * Fail-closed: unknown binaries / free-form shell default to mutating.
 * Exported for unit tests and security audits.
 */
export function commandRequiresExecute(argv: string[]): boolean {
  return isMutatingArgv(argv);
}

function isMutatingArgv(argv: string[]): boolean {
  if (!argv.length) return true;
  // Fail-closed: only explicit read-only catalog may skip EXECUTE
  return !isReadOnlyArgv(argv);
}

/** Known-safe pure readers (no shell, no redirect, argv form). */
const READ_ONLY_SIMPLE_BINS = new Set([
  'true',
  'false',
  'echo',
  'printf',
  'cat',
  'head',
  'tail',
  'wc',
  'df',
  'free',
  'uname',
  'whoami',
  'id',
  'pwd',
  'date',
  'ps',
  'which',
  'type',
  'command',
  'test',
  '[',
  'ls',
  'stat',
  'file',
  'realpath',
  'readlink',
  'dirname',
  'basename',
  'grep',
  'egrep',
  'fgrep',
  'awk',
  'du',
  'cut',
  'sort',
  'uniq',
  'sleep',
  'hostname',
  'getconf',
  'nproc',
  'arch',
  'env',
  'printenv',
]);

function isReadOnlyArgv(argv: string[]): boolean {
  const bin = baseBin(argv[0] ?? '');
  if (!bin) return false;

  // Power / identity always mutating (never read-only)
  if (['shutdown', 'reboot', 'poweroff', 'halt', 'init'].includes(bin)) return false;

  if (bin === 'hostnamectl') {
    const sub = argv[1] ?? '';
    return sub === 'show' || sub === 'status' || sub === '--help' || sub === 'help';
  }
  if (bin === 'timedatectl') {
    const sub = argv[1] ?? '';
    return (
      sub === 'show' ||
      sub === 'status' ||
      sub === 'list-timezones' ||
      sub === '--help' ||
      sub === 'help'
    );
  }
  if (bin === 'systemctl') {
    const sub = argv[1] ?? '';
    return (
      sub === 'is-active' ||
      sub === 'is-enabled' ||
      sub === 'status' ||
      sub === 'show' ||
      sub === 'list-units' ||
      sub === 'cat' ||
      sub === 'get-default' ||
      sub === 'help' ||
      sub === '--help'
    );
  }
  if (bin === 'nginx') return argv[1] === '-t';
  if (bin === 'pm2') {
    const sub = argv[1] ?? '';
    return sub === 'jlist' || sub === 'list' || sub === 'status';
  }
  if (bin === 'mysql' || bin === 'psql') {
    const joined = argv.join(' ').toLowerCase();
    if (argv.includes('--version') || argv.includes('-V')) return true;
    if (
      /\b(show|select|status)\b/.test(joined) &&
      !/\b(insert|update|delete|drop|create|alter|set\s+global|grant|truncate|replace)\b/.test(
        joined,
      )
    ) {
      return true;
    }
    return false;
  }
  if (bin === 'nmcli') {
    const sub = argv[1] ?? '';
    const rest = argv.slice(1).join(' ');
    if (sub === 'connection' && /\b(modify|add|delete|clone|up|down|reload)\b/.test(rest)) {
      return false;
    }
    if (sub === 'device' && /\b(connect|disconnect|set|reapply|modify)\b/.test(rest)) {
      return false;
    }
    if (sub === 'networking' && /\b(on|off)\b/.test(rest)) return false;
    return true; // show / device status / general
  }
  if (bin === 'kill') return argv[1] === '-0';
  if (bin === 'ip') {
    const mut = argv.some((a) =>
      ['add', 'del', 'delete', 'change', 'replace', 'set', 'flush', 'addrlabel'].includes(a),
    );
    return !mut;
  }
  if (bin === 'resolvectl') {
    const sub = argv[1] ?? '';
    // Inventory only — never dns set / domain / revert / flush-caches
    return (
      sub === 'status' ||
      sub === 'query' ||
      sub === 'dns' ||
      sub === 'domain' ||
      sub === '--help' ||
      sub === 'help'
    ) && !argv.some((a) => a === '--set' || a === 'flush-caches' || a === 'revert');
  }
  if (bin === 'sed') {
    // sed -i mutates files
    if (argv.some((a) => a === '-i' || a.startsWith('-i'))) return false;
    return true;
  }
  if (bin === 'find') {
    if (argv.some((a) => a === '-delete' || a === '-exec' || a === '-execdir')) return false;
    return true;
  }
  if (bin === 'bash' || bin === 'sh') {
    return isReadOnlyShellScript(argv);
  }

  // Version / inventory probes for interpreters & package managers (readiness)
  const versionBins = new Set([
    'php',
    'node',
    'nodejs',
    'python',
    'python3',
    'perl',
    'ruby',
    'java',
    'go',
    'rustc',
    'cargo',
    'rustup',
    'bun',
    'deno',
    'npm',
    'pnpm',
    'yarn',
    'composer',
    'pip',
    'pip3',
    'docker',
    'podman',
    'redis-cli',
    'mysqld',
    'postgres',
    'openssl',
    'journalctl',
    'kotlin',
    'kotlinc',
    'javac',
    'java',
  ]);
  if (versionBins.has(bin)) {
    const sub = argv[1] ?? '';
    if (
      sub === '-v' ||
      sub === '-V' ||
      sub === '--version' ||
      sub === 'version' ||
      sub === '-version' ||
      argv.includes('-version') ||
      (bin === 'java' && (sub === '-version' || argv.includes('-version')))
    ) {
      return true;
    }
    // rustup list / show / which — inventory only
    if (bin === 'rustup') {
      const ro = new Set(['list', 'show', 'which', 'help', '--help', 'toolchain', 'run']);
      // rustup run 1.78 cargo --version is inventory for probe
      if (ro.has(sub) || sub === '') return true;
    }
    // cargo metadata / --version already; cargo --list
    if (bin === 'cargo' && (sub === '--list' || sub === 'metadata' || sub === 'help')) return true;
    // redis-cli INFO / PING
    if (bin === 'redis-cli') {
      const rest = argv.slice(1).join(' ').toUpperCase();
      if (/\b(INFO|PING)\b/.test(rest)) return true;
    }
    // journalctl disk-usage / short reads (not vacuum)
    if (bin === 'journalctl') {
      const joined = argv.join(' ');
      if (/vacuum|rotate|--flush/i.test(joined)) return false;
      return true;
    }
    // openssl version | passwd (hash only — no host write)
    if (bin === 'openssl' && (sub === 'version' || sub === 'passwd' || sub === '--help')) {
      return true;
    }
  }

  // Always-mutating host ops
  if (
    [
      'apt-get',
      'apt',
      'useradd',
      'userdel',
      'groupadd',
      'groupdel',
      'usermod',
      'runuser',
      'chown',
      'chmod',
      'cp',
      'mv',
      'rm',
      'rmdir',
      'unlink',
      'install',
      'ln',
      'mkdir',
      'crontab',
      'a2ensite',
      'a2dissite',
      'certbot',
      'renice',
      'pdnsutil',
      'postsuper',
      'npm',
      'pnpm',
      'yarn',
      'docker',
      'podman',
      'sudo',
      'su',
      'python',
      'python3',
      'perl',
      'php',
      'node',
      'ruby',
      'curl',
      'wget',
      'dd',
      'tee',
      'ufw',
      'iptables',
      'nft',
    ].includes(bin)
  ) {
    // apt list / apt-cache / apt-get --version are read-only inventory
    if (bin === 'apt' || bin === 'apt-get') {
      const sub = argv[1] ?? '';
      if (sub === 'list' || sub === 'show' || sub === 'search' || sub === 'policy' || sub === '--version') {
        return true;
      }
      if (sub === 'cache') return true;
    }
    if (bin === 'curl' || bin === 'wget') {
      // network fetch can write with -o; treat as mutating always (SSRF + write)
      return false;
    }
    return false;
  }

  if (READ_ONLY_SIMPLE_BINS.has(bin)) {
    // hostname set requires arg; bare hostname is read
    if (bin === 'hostname' && argv.length > 1 && !argv[1]!.startsWith('-')) return false;
    return true;
  }

  // Unknown binary → mutating (fail-closed)
  return false;
}

function baseBin(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const base = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  return base.toLowerCase();
}

/**
 * Free-form shell is high risk. Only allow known inventory / probe patterns
 * without redirects that write files.
 */
function isReadOnlyShellScript(argv: string[]): boolean {
  // argv: bash [-c] script  OR  bash -c script
  let script = '';
  const cIdx = argv.indexOf('-c');
  if (cIdx >= 0 && argv[cIdx + 1]) script = argv[cIdx + 1]!;
  else script = argv.slice(1).join(' ');
  const s = script.trim();
  if (!s) return false;

  // Hard deny: file-writing redirects (allow >/dev/null · 2>/dev/null · N>&M inventory probes)
  const withoutNullRedirects = s
    .replace(/\d*>&\d+/g, ' ')
    .replace(/\d*>>?\/dev\/null/g, ' ');
  if (/[>]{1,2}|<<|tee\b|\bdd\b/.test(withoutNullRedirects)) return false;
  if (/\bapt-get\s+update\b/.test(s)) return false;
  if (
    /\bapt(-get)?\s+(install|remove|purge|upgrade|dist-upgrade|autoremove|full-upgrade)\b/.test(s)
  ) {
    return false;
  }
  if (
    /\b(rm|mv|cp|mkdir|useradd|userdel|usermod|chown|chmod|crontab|dd|mkfs|fdisk|parted)\b/.test(s)
  ) {
    return false;
  }
  if (/\bsystemctl\s+(enable|start|restart|stop|disable|mask|daemon-reload|reload)\b/.test(s)) {
    return false;
  }
  // Deny *running* interpreters (not package names like python3 / nodejs / php-cli in lists)
  if (
    /(^|[;&|`(\n]\s*)(python3?|perl|php|node|ruby|lua)(?:\s|$)/m.test(s) ||
    /\b(python3?|perl|php|node|ruby|lua)\s+(-[ce]|--|\/|\.\/)/.test(s)
  ) {
    return false;
  }
  if (/\b(curl|wget)\b/.test(s) && /\s-\w*o\b|\s--output\b/.test(s)) return false;

  // Allow pure inventory / probe helpers used by panel without EXECUTE
  if (
    /\bapt\s+list\b/.test(s) ||
    /\bapt-cache\b/.test(s) ||
    /\bdpkg-query\b/.test(s) ||
    /\bdpkg\s+-l\b/.test(s) ||
    /\bdpkg\s+--get-selections\b/.test(s)
  ) {
    return true;
  }
  // Version inventory via shell (mysql --version, mysqld --version, …)
  if (
    /\b(mysql|mysqld|mariadb|mariadbd|postgres|psql|redis-cli|nginx|apache2|httpd)\b[^\n;|&]*--version\b/.test(
      s,
    ) ||
    /\b(mysql|mysqld|mariadb|mariadbd)\b[^\n;|&]*\s-V\b/.test(s)
  ) {
    return true;
  }
  // Binary presence probes (software / VNC / catalog) — no side effects
  if (
    (/\bcommand\s+-v\b/.test(s) || /\btype\s+-[aP]\b/.test(s) || /\bwhich\s+\S+/.test(s)) &&
    !/\bapt(-get)?\s+(install|remove|purge)/.test(s)
  ) {
    return true;
  }
  // Disk usage probes (quota)
  if (/\bdu\s+(-[a-zA-Z]*k|-sk|-sb)\b/.test(s) || /\bdu\s+-[a-zA-Z]*\b/.test(s)) {
    return true;
  }
  // Simple echo / printf probes (no redirect — already denied above)
  if (/^(echo|printf)(\s|$)/.test(s) || /^(echo|printf)\s/.test(s)) {
    // multi-statement only echo/printf/true/false/exit
    if (/[;&](?!\s*(echo|printf|true|false|exit)\b)/.test(s) && /[;&]/.test(s)) {
      // allow "echo a; echo b; echo c" and "exit N"
      const parts = s.split(/;+/).map((p) => p.trim()).filter(Boolean);
      if (parts.every((p) => /^(echo|printf|true|false|exit)(\s|$)/.test(p))) return true;
      return false;
    }
    return true;
  }
  if (/^exit\s+\d+\s*$/.test(s)) return true;
  // /proc readers
  if (/\/proc\/\d+\//.test(s) && /\b(tr|readlink|ls|wc|head|cat)\b/.test(s)) return true;
  if (/\btop\s+-b\b/.test(s)) return true;
  if (/\bpostqueue\b/.test(s)) return true;
  if (/\bpostfix\s+check\b/.test(s)) return true;
  // File/dir existence probes
  if (/\btest\s+-[efdrwxLsb]\b/.test(s) || /\b\[\s+-[efdrwxLsb]\b/.test(s)) return true;
  if (/\bgrep\b/.test(s) && !/\b-l\b/.test(s)) return true;
  if (/\bsystemctl\s+(is-active|is-enabled|status|show)\b/.test(s)) return true;
  if (/\bservice\s+\S+\s+status\b/.test(s)) return true;
  // Network DNS inventory (resolvectl status | head …)
  if (/\bresolvectl\s+(status|query|dns|domain)\b/.test(s) && !/\b(flush-caches|revert|--set)\b/.test(s)) {
    return true;
  }

  // Identity / passwd inventory (project OS user probes)
  // Note: `getent passwd` is inventory — do not treat as the passwd(1) command.
  if (
    /\b(id|getent|groups)\b/.test(s) &&
    !/\b(useradd|userdel|usermod|chown|chmod)\b/.test(s) &&
    !/(^|[;&|]\s*)passwd\s/.test(s)
  ) {
    return true;
  }

  // Default: shell scripts require EXECUTE
  return false;
}

/**
 * Spawn process and stream stdout/stderr as line-oriented chunks.
 * Used for long runtime installs so the panel can show live progress.
 */
export function runCommandStreaming(
  argv: string[],
  opts: {
    timeoutMs: number;
    cwd?: string;
    onChunk: CommandChunkHandler;
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({
        stdout: '',
        stderr: 'aborted before start',
        exitCode: 130,
        argv,
        dryRun: false,
      });
      return;
    }
    // Prefer line-buffered stdio when stdbuf is available (apt/curl progress for SSE)
    let bin = argv[0]!;
    let args = argv.slice(1);
    if (existsSync('/usr/bin/stdbuf')) {
      args = ['-oL', '-eL', bin, ...args];
      bin = 'stdbuf';
    }
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const safeChunk = (stream: 'stdout' | 'stderr', text: string) => {
      try {
        opts.onChunk({ stream, text });
      } catch {
        /* UI callback must not kill install */
      }
    };

    const killChild = (why: string) => {
      try {
        safeChunk('stderr', why);
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* */
          }
        }, 2_000).unref?.();
      } catch {
        /* */
      }
    };

    const emit = (stream: 'stdout' | 'stderr', text: string) => {
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      let hold = stream === 'stdout' ? stdoutBuf : stderrBuf;
      hold += text;
      const lines = hold.split('\n');
      const rest = lines.pop() ?? '';
      if (stream === 'stdout') stdoutBuf = rest;
      else stderrBuf = rest;
      for (const line of lines) safeChunk(stream, line);
    };

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (stdoutBuf) {
        safeChunk('stdout', stdoutBuf);
        stdoutBuf = '';
      }
      if (stderrBuf) {
        safeChunk('stderr', stderrBuf);
        stderrBuf = '';
      }
      resolve({ stdout, stderr, exitCode, argv, dryRun: false });
    };

    const onAbort = () => {
      killChild('aborted by client (SSE disconnect or cancel)');
      // close handler will finish; force if hang
      setTimeout(() => finish(130), 3_000).unref?.();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (d: Buffer | string) => emit('stdout', String(d)));
    child.stderr?.on('data', (d: Buffer | string) => emit('stderr', String(d)));
    child.on('error', (err) => {
      const msg = err.message || 'spawn failed';
      stderr += msg;
      safeChunk('stderr', msg);
      finish(1);
    });
    child.on('close', (code, signal) => {
      if (opts.signal?.aborted) {
        finish(130);
        return;
      }
      if (signal) {
        const msg = `killed by signal ${signal}`;
        stderr += (stderr ? '\n' : '') + msg;
        safeChunk('stderr', msg);
        finish(code ?? 1);
        return;
      }
      finish(typeof code === 'number' ? code : 1);
    });

    const timer = setTimeout(() => {
      killChild(`timeout after ${opts.timeoutMs}ms`);
      const msg = `timeout after ${opts.timeoutMs}ms`;
      stderr += (stderr ? '\n' : '') + msg;
      finish(124);
    }, opts.timeoutMs);
    timer.unref?.();
  });
}

/** Append a line to audit file (best-effort side channel). */
export function appendHostLog(logPath: string, line: string): void {
  try {
    mkdirSync(dirnameSafe(logPath), { recursive: true });
    appendFileSync(logPath, line + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function dirnameSafe(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '.' : p.slice(0, i);
}

export function fileStatSafe(path: string): { size: number; isFile: boolean } | null {
  try {
    const s = statSync(path);
    return { size: s.size, isFile: s.isFile() };
  } catch {
    return null;
  }
}
