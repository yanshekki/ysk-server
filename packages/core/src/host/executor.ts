/**
 * Local host executor — real filesystem / process operations.
 * High-risk commands only run when explicitly allowed by policy layer.
 */

import { execFile } from 'node:child_process';
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
import { promisify } from 'node:util';
import { ErrorCodes, YskError } from '@ysk/shared';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  argv: string[];
  dryRun: boolean;
}

export interface HostExecutor {
  readFile(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  writeFile(path: string, content: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  sysInfo(): Promise<Record<string, unknown>>;
  serviceStatus(name: string): Promise<RunResult>;
  runCommand(argv: string[], opts?: { dryRun?: boolean; timeoutMs?: number; cwd?: string }): Promise<RunResult>;
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
      throw new YskError(ErrorCodes.INTERNAL, `Failed to read ${path}`, {
        httpStatus: 500,
        cause: err,
      });
    }
  }

  async listDir(path: string): Promise<string[]> {
    try {
      return readdirSync(path);
    } catch (err) {
      throw new YskError(ErrorCodes.INTERNAL, `Failed to list ${path}`, {
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
        'Write blocked: set YSK_EXECUTE=1 for paths outside managed dataDir',
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
        'Delete blocked: set YSK_EXECUTE=1 for paths outside managed dataDir',
        { httpStatus: 403, details: { path } },
      );
    }
    rmSync(path, { recursive: true, force: true });
  }

  async mkdirp(path: string): Promise<void> {
    // mkdir for project homes is always allowed under write roots / any path for control-plane data
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
      throw new YskError(ErrorCodes.VALIDATION, `Invalid service name: ${name}`, {
        httpStatus: 400,
      });
    }
    return this.runCommand(['systemctl', 'is-active', name], { dryRun: false, timeoutMs: 5000 });
  }

  async runCommand(
    argv: string[],
    opts: { dryRun?: boolean; timeoutMs?: number; cwd?: string } = {},
  ): Promise<RunResult> {
    if (!argv.length) {
      throw new YskError(ErrorCodes.VALIDATION, 'Command argv empty', { httpStatus: 400 });
    }
    if (opts.dryRun) {
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: true };
    }
    // Non-mutating info commands always allowed; mutating requires executeEnabled
    const mutating = isMutatingArgv(argv);
    if (mutating && !this.executeOn) {
      throw new YskError(
        ErrorCodes.FORBIDDEN,
        'Command blocked: set YSK_EXECUTE=1 for mutating host commands',
        { httpStatus: 403, details: { argv } },
      );
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
    return this.writeRoots.some(
      (root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`),
    );
  }

  private assertWritable(path: string): void {
    if (!this.writeRoots.length) return;
    if (!this.isUnderWriteRoots(path)) {
      throw new YskError(ErrorCodes.SANDBOX_VIOLATION, `Path outside allowed write roots: ${path}`, {
        httpStatus: 403,
        details: { path, writeRoots: this.writeRoots },
      });
    }
  }
}

function isMutatingArgv(argv: string[]): boolean {
  const bin = argv[0];
  if (bin === 'systemctl') {
    const sub = argv[1];
    return sub !== 'is-active' && sub !== 'status' && sub !== 'show' && sub !== 'list-units';
  }
  if (
    bin === 'apt-get' ||
    bin === 'apt' ||
    bin === 'useradd' ||
    bin === 'userdel' ||
    bin === 'groupadd' ||
    bin === 'groupdel' ||
    bin === 'usermod' ||
    bin === 'chown' ||
    bin === 'chmod' ||
    bin === 'cp' ||
    bin === 'mv' ||
    bin === 'rm' ||
    bin === 'rmdir' ||
    bin === 'unlink' ||
    bin === 'install' ||
    bin === 'ln' ||
    bin === 'crontab' ||
    bin === 'a2ensite' ||
    bin === 'a2dissite' ||
    bin === 'mysql' ||
    bin === 'nginx' ||
    bin === 'pm2' ||
    bin === 'pdnsutil'
  ) {
    // nginx -t is read-only check
    if (bin === 'nginx' && argv[1] === '-t') return false;
    // pm2 jlist / list are read-only
    if (bin === 'pm2' && (argv[1] === 'jlist' || argv[1] === 'list' || argv[1] === 'status')) {
      return false;
    }
    return true;
  }
  if (bin === 'certbot') return true;
  // bash -c with destructive patterns still run under higher-level allowlist; treat bash as mutating when not dry
  if (bin === 'bash' || bin === 'sh') {
    const script = argv.slice(1).join(' ');
    if (/\b(rm|mv|cp|apt|useradd|systemctl\s+(enable|start|restart|stop)|crontab)\b/.test(script)) {
      return true;
    }
  }
  return false;
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
