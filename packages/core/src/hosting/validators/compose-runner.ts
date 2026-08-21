/**
 * Docker Compose runner for validator instances.
 * Host mutations go through HostExecutor (honesty / allowlist).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import { runOpts, type OpsLogFn } from '../ops-log.js';
import { parseJsonLines, reconcileDockerState } from '../docker/parse.js';

export function composeProjectName(id: string): string {
  return `yskval-${id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48);
}

/** Match `yskval-{id}-{service}-{n}` (and the 48-char compose project cap). */
export function validatorIdFromContainerName(
  name: string,
  ids: readonly string[],
): string | null {
  const n = String(name ?? '').replace(/^\//, '').toLowerCase();
  if (!n.startsWith('yskval-')) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const id of ids) {
    const p = composeProjectName(id);
    if (p.length > bestLen && (n === p || n.startsWith(`${p}-`))) {
      best = id;
      bestLen = p.length;
    }
  }
  return best;
}

export function composeFilePath(instanceDirPath: string): string {
  return `${instanceDirPath.replace(/\/+$/, '')}/compose.yml`;
}

/** Bind-mounts are created as root; many images run as nonroot. */
export function prepareValidatorDataDir(dataPath: string): void {
  mkdirSync(dataPath, { recursive: true });
  try {
    chmodSync(dataPath, 0o777);
  } catch {
    /* still usable as root */
  }
}

/**
 * Compose short-bind as one YAML scalar.
 * Quoting only the host path (`"/host":/data`) is invalid YAML — go-yaml then
 * reports "did not find expected '-' indicator" on the volumes key.
 */
export function composeBind(hostPath: string, containerPath: string, mode?: 'ro' | 'rw'): string {
  const spec = mode ? `${hostPath}:${containerPath}:${mode}` : `${hostPath}:${containerPath}`;
  return JSON.stringify(spec);
}

export async function probeDockerCompose(host: HostExecutor): Promise<{
  ok: boolean;
  version?: string;
  notes: string[];
}> {
  try {
    const r = await host.runCommand(['docker', 'compose', 'version'], { timeoutMs: 8_000 });
    if (r.exitCode === 0) {
      return { ok: true, version: r.stdout.trim().split('\n')[0], notes: [] };
    }
    return { ok: false, notes: [r.stderr.trim() || 'docker compose version failed'] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'docker compose unavailable'] };
  }
}

export function writeComposeFile(
  path: string,
  yaml: string,
  instanceId?: string,
  limits?: { memory?: string; cpus?: string },
): string {
  mkdirSync(dirname(path), { recursive: true });
  const limited = applyComposeLimits(yaml, limits);
  const zoned = applyComposeTimezone(limited);
  const stamped = instanceId ? stampYskComposeLabels(zoned, instanceId) : zoned;
  const body = stamped.endsWith('\n') ? stamped : `${stamped}\n`;
  writeFileSync(path, body, 'utf8');
  return path;
}

/** Host IANA zone for container TZ. Fail closed to UTC if unreadable. */
export function hostTimezoneName(): string {
  try {
    const tz = readFileSync('/etc/timezone', 'utf8').trim();
    if (tz && tz.length < 64 && /^[A-Za-z0-9/_+-]+$/.test(tz)) return tz;
  } catch {
    /* no /etc/timezone */
  }
  const env = String(process.env.TZ ?? '').trim();
  if (env && env.length < 64 && /^[A-Za-z0-9/_+-]+$/.test(env)) return env;
  try {
    const link = readlinkSync('/etc/localtime');
    const m = String(link).match(/\/zoneinfo\/(.+)$/);
    if (m?.[1] && m[1].length < 64 && /^[A-Za-z0-9/_+-]+$/.test(m[1])) return m[1];
  } catch {
    /* no localtime symlink */
  }
  return 'UTC';
}

/** Inject TZ (and /etc/localtime when present) so chain logs follow the host clock. */
export function applyComposeTimezone(yaml: string, tz = hostTimezoneName()): string {
  const zone = tz && tz.length < 64 && /^[A-Za-z0-9/_+-]+$/.test(tz) ? tz : 'UTC';
  let out = String(yaml ?? '');
  if (!/\n[ \t]+environment:/m.test(out)) {
    out = out.replace(
      /^([ \t]+restart:\s+unless-stopped)\s*$/gm,
      `$1\n    environment:\n      TZ: ${zone}`,
    );
  } else if (!/\bTZ:\s*/m.test(out)) {
    out = out.replace(/^([ \t]+environment:)\s*$/gm, `$1\n      TZ: ${zone}`);
  }
  if (existsSync('/etc/localtime') && !out.includes('/etc/localtime:')) {
    out = out.replace(
      /^([ \t]+volumes:)\s*$/gm,
      `$1\n      - "/etc/localtime:/etc/localtime:ro"`,
    );
  }
  return out;
}

/** Placeholder compose until a chain adapter supplies a real template. */
export function stubComposeYaml(inst: ValidatorInstanceDto): string {
  const images = Object.values(inst.clients);
  const services =
    images.length > 0
      ? images
          .map((c, i) => {
            const name = c.id.replace(/[^a-z0-9]+/g, '_') || `svc${i}`;
            return [
              `  ${name}:`,
              `    image: ${c.image}:${c.tag}`,
              `    restart: unless-stopped`,
              `    network_mode: bridge`,
              `    volumes:`,
              `      - ${composeBind(inst.dataPath, '/data')}`,
            ].join('\n');
          })
          .join('\n')
      : [
          `  placeholder:`,
          `    image: busybox:1.36`,
          `    command: ['sleep', 'infinity']`,
          `    restart: unless-stopped`,
          `    volumes:`,
          `      - ${composeBind(inst.dataPath, '/data')}`,
        ].join('\n');
  return `# ysk-server validators — generated, do not edit\nservices:\n${services}\n`;
}

export function applyComposeLimits(
  yaml: string,
  limits?: { memory?: string; cpus?: string },
): string {
  if (!limits?.memory && !limits?.cpus) return yaml;
  const extra: string[] = [];
  let out = yaml;
  const memory = limits.memory && /^\d+[mMgGkK]$/.test(limits.memory) ? limits.memory : undefined;
  const cpus = limits.cpus && /^\d+(\.\d+)?$/.test(limits.cpus) ? limits.cpus : undefined;
  // Compose rejects distinct legacy vs deploy.resources.limits for memory, pids, and cpus.
  const pids = out.match(/pids_limit:\s*(\d+)/i)?.[1] ?? '4096';
  const hasDeploy = /\n[ \t]+deploy:\s*\n/.test(out);
  if (memory) {
    if (/mem_limit:/i.test(out)) {
      out = out.replace(/mem_limit:\s*\S+/g, `mem_limit: ${memory}`);
      out = out.replace(/memswap_limit:\s*\S+/g, `memswap_limit: ${memory}`);
    } else {
      extra.push(`    mem_limit: ${memory}`);
      extra.push(`    memswap_limit: ${memory}`);
    }
    if (!/pids_limit:/i.test(out)) extra.push(`    pids_limit: ${pids}`);
  }
  if (cpus) extra.push(`    cpus: ${JSON.stringify(cpus)}`);
  if (memory && !hasDeploy) {
    extra.push(`    deploy:`);
    extra.push(`      resources:`);
    extra.push(`        limits:`);
    extra.push(`          memory: ${memory}`);
    extra.push(`          pids: ${pids}`);
    if (cpus) extra.push(`          cpus: ${JSON.stringify(cpus)}`);
  } else if (hasDeploy) {
    if (memory) {
      out = out.replace(/(\n[ \t]+memory:\s*)\S+/g, `$1${memory}`);
      if (!/\n[ \t]+pids:\s*\d+/.test(out)) {
        out = out.replace(/(\n[ \t]+memory:\s*\S+)/, `$1\n          pids: ${pids}`);
      }
    }
    if (cpus && !/\n[ \t]{6,}cpus:\s/.test(out)) {
      out = out.replace(/(\n[ \t]+memory:\s*\S+)/, `$1\n          cpus: ${JSON.stringify(cpus)}`);
    }
  }
  if (!extra.length) return out;
  return out.replace(/^([ \t]+restart:\s+unless-stopped)\s*$/gm, `$1\n${extra.join('\n')}`);
}

export function stampYskComposeLabels(yaml: string, instanceId: string): string {
  if (yaml.includes('com.ysk-server.managed')) return yaml;
  return yaml.replace(
    /^( {2}(?:el|cl|node|reth|lighthouse|geth|nethermind|prysm|teku|nimbus|placeholder):)\s*$/gm,
    `$1\n    labels:\n      com.ysk-server.managed: "true"\n      com.ysk-server.feature: validators\n      com.ysk-server.instance: ${instanceId}`,
  );
}

export async function composePull(input: {
  host: HostExecutor;
  file: string;
  project: string;
  execute: boolean;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const argv = ['docker', 'compose', '-f', input.file, '-p', input.project, 'pull'];
  const r = await input.host.runCommand(argv, {
    ...runOpts({ execute: input.execute, timeoutMs: 600_000, onLog: input.onLog, signal: input.signal }),
  });
  return {
    ok: input.execute ? r.exitCode === 0 : true,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/** Longer watches for chains that panic after compose up -d looks healthy. */
export function composeStayWaits(chain: string): number[] {
  if (chain === 'cosmos' || chain === 'eth' || chain === 'near') {
    return [3_000, 5_000, 8_000, 12_000, 15_000];
  }
  return [2_000, 3_000, 5_000];
}

export async function composeUp(input: {
  host: HostExecutor;
  file: string;
  project: string;
  execute: boolean;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; stdout: string; stderr: string; argv: string[] }> {
  const argv = ['docker', 'compose', '-f', input.file, '-p', input.project, 'up', '-d'];
  const r = await input.host.runCommand(argv, {
    ...runOpts({ execute: input.execute, timeoutMs: 600_000, onLog: input.onLog, signal: input.signal }),
  });
  return {
    ok: input.execute ? r.exitCode === 0 : true,
    stdout: r.stdout,
    stderr: r.stderr,
    argv,
  };
}

export async function composeDown(input: {
  host: HostExecutor;
  file: string;
  project: string;
  execute: boolean;
  onLog?: OpsLogFn;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; stdout: string; stderr: string; argv: string[] }> {
  const argv = ['docker', 'compose', '-f', input.file, '-p', input.project, 'down'];
  const r = await input.host.runCommand(argv, {
    ...runOpts({ execute: input.execute, timeoutMs: 180_000, onLog: input.onLog, signal: input.signal }),
  });
  return {
    ok: input.execute ? r.exitCode === 0 : true,
    stdout: r.stdout,
    stderr: r.stderr,
    argv,
  };
}

export async function composeLogs(input: {
  host: HostExecutor;
  file: string;
  project: string;
  tail?: number;
}): Promise<{ lines: string[]; notes: string[] }> {
  const tail = Math.min(500, Math.max(20, input.tail ?? 200));
  const argv = [
    'docker',
    'compose',
    '-f',
    input.file,
    '-p',
    input.project,
    'logs',
    '--no-color',
    '--tail',
    String(tail),
  ];
  try {
    const r = await input.host.runCommand(argv, { timeoutMs: 20_000 });
    const text = `${r.stdout}\n${r.stderr}`.trim();
    return {
      lines: text ? text.split('\n') : [],
      notes: r.exitCode === 0 ? [] : ['compose logs failed'],
    };
  } catch (e) {
    return { lines: [], notes: [e instanceof Error ? e.message : 'compose logs unavailable'] };
  }
}

export async function composePsRunning(input: {
  host: HostExecutor;
  file: string;
  project: string;
}): Promise<boolean> {
  const info = await composePsInfo(input);
  return info.running;
}

/** Compose `ps --format json` may be a JSON array (v2.29+) or NDJSON. */
export function composePsStatesFromStdout(stdout: string): string[] {
  return parseJsonLines(stdout)
    .map((o) =>
      reconcileDockerState(
        String(o.State ?? o.state ?? ''),
        String(o.Status ?? o.status ?? ''),
      ),
    )
    .filter(Boolean);
}

export type ComposePsInfo = {
  running: boolean;
  restarting: boolean;
  exited: boolean;
  created: boolean;
  missing: boolean;
  restartCount: number | null;
  exitCode: number | null;
};

export function restartCountFromStatus(status: string): number | null {
  const m = String(status ?? '').match(/restarting\s*\((\d+)\)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function composePsInfoFromStates(
  states: string[],
  hasIds: boolean,
  restartCount: number | null = null,
): ComposePsInfo {
  if (!states.length) {
    if (!hasIds) {
      return {
        running: false,
        restarting: false,
        exited: false,
        created: false,
        missing: true,
        restartCount: null,
        exitCode: null,
      };
    }
    return {
      running: true,
      restarting: false,
      exited: false,
      created: false,
      missing: false,
      restartCount: null,
      exitCode: null,
    };
  }
  const restarting = states.some((s) => s.includes('restart'));
  if (states.every((s) => s === 'created')) {
    return {
      running: false,
      restarting: false,
      exited: false,
      created: true,
      missing: false,
      restartCount: null,
      exitCode: null,
    };
  }
  const dead = states.filter((s) => s === 'exited' || s === 'dead');
  const live = states.filter((s) => s === 'running' || s === 'starting');
  return {
    running: live.length > 0 && dead.length === 0 && !restarting,
    restarting,
    exited: dead.length > 0 && live.length === 0 && !restarting,
    created: false,
    missing: false,
    restartCount: restarting ? restartCount : null,
    exitCode: null,
  };
}

export function composePsInfoFromStdout(stdout: string): ComposePsInfo | null {
  const rows = parseJsonLines(stdout);
  if (!rows.length) return null;
  const states = rows
    .map((o) =>
      reconcileDockerState(
        String(o.State ?? o.state ?? ''),
        String(o.Status ?? o.status ?? ''),
      ),
    )
    .filter(Boolean);
  if (!states.length) return null;
  let restartCount: number | null = null;
  let exitCode: number | null = null;
  for (const o of rows) {
    const n = restartCountFromStatus(String(o.Status ?? o.status ?? ''));
    if (n != null) restartCount = Math.max(restartCount ?? 0, n);
    const code = Number(o.ExitCode ?? o.exitCode);
    if (Number.isInteger(code) && code !== 0) exitCode = code;
  }
  const info = composePsInfoFromStates(states, true, restartCount);
  return { ...info, exitCode };
}

export async function composePsInfo(input: {
  host: HostExecutor;
  file: string;
  project: string;
}): Promise<ComposePsInfo> {
  try {
    const fmt = await input.host.runCommand(
      ['docker', 'compose', '-f', input.file, '-p', input.project, 'ps', '--format', 'json'],
      { timeoutMs: 15_000 },
    );
    if (fmt.exitCode === 0 && fmt.stdout.trim()) {
      const fromJson = composePsInfoFromStdout(fmt.stdout);
      if (fromJson) return fromJson;
    }
    const q = await input.host.runCommand(
      ['docker', 'compose', '-f', input.file, '-p', input.project, 'ps', '-q', '-a'],
      { timeoutMs: 15_000 },
    );
    const ids = q.exitCode === 0 && q.stdout.trim().length > 0;
    return composePsInfoFromStates([], ids);
  } catch {
    return {
      running: false,
      restarting: false,
      exited: false,
      created: false,
      missing: true,
      restartCount: null,
      exitCode: null,
    };
  }
}
