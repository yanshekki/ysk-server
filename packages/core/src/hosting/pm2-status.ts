/**
 * Read-only PM2 fleet snapshot for Node/Bun runtime Processes tab.
 * Uses pm2 jlist (allowed without YSK_EXECUTE). Never invents running apps.
 */

import type { HostExecutor } from '../host/executor.js';
import { probePm2 } from './pm2-apply.js';

export type Pm2AppRow = {
  name: string;
  pmId: number | null;
  pid: number | null;
  status: string;
  cpu: number | null;
  memory: number | null;
  restarts: number | null;
  unstableRestarts: number | null;
  /** Epoch ms when process started (pm_uptime) */
  pmUptime: number | null;
  mode: string;
  instances: number | null;
  script: string;
  cwd: string;
  interpreter: string;
  nodeArgs: string;
  port: string;
  watching: boolean;
  yskManaged: boolean;
  /** Full process object from jlist for JSON modal */
  raw: Record<string, unknown>;
};

export type Pm2Snapshot = {
  available: boolean;
  path?: string;
  version?: string;
  apps: Pm2AppRow[];
  running: number;
  stopped: number;
  errored: number;
  at: string;
  notes: string[];
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(String).join(' ');
  return String(v);
}

/**
 * Normalize one pm2 jlist entry into a table row.
 */
export function normalizePm2App(raw: Record<string, unknown>): Pm2AppRow {
  const env = (raw.pm2_env ?? {}) as Record<string, unknown>;
  const monit = (raw.monit ?? {}) as Record<string, unknown>;
  const name = str(raw.name || env.name);
  const envMap = (env.env ?? {}) as Record<string, unknown>;
  const port = str(envMap.PORT ?? envMap.port ?? '');
  return {
    name,
    pmId: num(raw.pm_id),
    pid: num(raw.pid),
    status: str(env.status || 'unknown'),
    cpu: num(monit.cpu),
    memory: num(monit.memory),
    restarts: num(env.restart_time),
    unstableRestarts: num(env.unstable_restarts),
    pmUptime: num(env.pm_uptime),
    mode: str(env.exec_mode || env.exec_mode_string),
    instances: num(env.instances),
    script: str(env.pm_exec_path || env.script || raw.name),
    cwd: str(env.pm_cwd),
    interpreter: str(env.exec_interpreter),
    nodeArgs: str(env.node_args),
    port,
    watching: Boolean(env.watch || env.watching),
    yskManaged: name.startsWith('ysk-'),
    raw,
  };
}

/**
 * Parse `pm2 jlist` stdout into rows. Empty / invalid → [].
 * Tolerates warning prefixes and wrapped { processes: [] } shapes.
 */
export function parsePm2Jlist(stdout: string): Pm2AppRow[] {
  let t = String(stdout || '').trim();
  if (!t) return [];
  // Drop leading non-JSON noise (pm2 warnings)
  const bracket = t.indexOf('[');
  const brace = t.indexOf('{');
  if (bracket >= 0 || brace >= 0) {
    const start =
      bracket >= 0 && brace >= 0
        ? Math.min(bracket, brace)
        : bracket >= 0
          ? bracket
          : brace;
    t = t.slice(start);
  }
  try {
    const data = JSON.parse(t) as unknown;
    let arr: unknown[] = [];
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      if (Array.isArray(o.processes)) arr = o.processes;
      else if (Array.isArray(o.apps)) arr = o.apps;
      else if (Array.isArray(o.data)) arr = o.data;
    }
    return arr
      .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      .map((x) => normalizePm2App(x));
  } catch {
    return [];
  }
}

/** True when stdout looked like JSON but did not yield apps (vs truly empty). */
export function pm2JlistLooksBroken(stdout: string, apps: Pm2AppRow[]): boolean {
  const t = String(stdout || '').trim();
  if (!t || apps.length > 0) return false;
  return t.includes('{') || t.includes('[');
}

export function filterPm2Apps(
  apps: Pm2AppRow[],
  opts?: { yskOnly?: boolean; q?: string },
): Pm2AppRow[] {
  let out = apps;
  if (opts?.yskOnly) out = out.filter((a) => a.yskManaged);
  const q = (opts?.q ?? '').trim().toLowerCase();
  if (q) {
    out = out.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.script.toLowerCase().includes(q) ||
        a.cwd.toLowerCase().includes(q) ||
        a.interpreter.toLowerCase().includes(q) ||
        a.status.toLowerCase().includes(q) ||
        String(a.pid ?? '').includes(q),
    );
  }
  return out;
}

function countByStatus(apps: Pm2AppRow[]): {
  running: number;
  stopped: number;
  errored: number;
} {
  let running = 0;
  let stopped = 0;
  let errored = 0;
  for (const a of apps) {
    const s = a.status.toLowerCase();
    if (s === 'online' || s === 'launching') running += 1;
    else if (s === 'stopped' || s === 'stopping') stopped += 1;
    else if (s === 'errored' || s === 'error') errored += 1;
  }
  return { running, stopped, errored };
}

/**
 * Live PM2 snapshot from host (read-only jlist).
 */
export async function collectPm2Snapshot(host: HostExecutor): Promise<Pm2Snapshot> {
  const notes: string[] = [];
  const at = new Date().toISOString();
  const probe = await probePm2(host);
  if (!probe.available) {
    notes.push('pm2 not found on PATH (install Node companion plugin "pm2")');
    return {
      available: false,
      apps: [],
      running: 0,
      stopped: 0,
      errored: 0,
      at,
      notes,
    };
  }

  let version: string | undefined;
  const ver = await host.runCommand(['pm2', '-v'], { timeoutMs: 10_000 });
  if (ver.exitCode === 0) {
    version = (ver.stdout || '').trim().split('\n').filter(Boolean).pop();
  }

  const jlist = await host.runCommand(['pm2', 'jlist'], { timeoutMs: 20_000 });
  if (jlist.exitCode !== 0) {
    notes.push(`pm2 jlist exit=${jlist.exitCode}: ${(jlist.stderr || jlist.stdout || '').slice(0, 200)}`);
    return {
      available: true,
      path: probe.path,
      version,
      apps: [],
      running: 0,
      stopped: 0,
      errored: 0,
      at,
      notes,
    };
  }

  const rawOut = jlist.stdout || '';
  const apps = parsePm2Jlist(rawOut);
  if (!rawOut.trim()) {
    notes.push(
      'PM2 process list empty under the panel user (projects default to systemd — they will not appear here unless started with pm2)',
    );
  } else if (apps.length === 0 && pm2JlistLooksBroken(rawOut, apps)) {
    notes.push(
      `PM2 list could not be parsed: ${rawOut.replace(/\s+/g, ' ').slice(0, 180)}`,
    );
  } else if (apps.length === 0) {
    notes.push(
      'PM2 reports no apps for the panel user. YSK projects usually run under systemd (see project list below when available).',
    );
  }
  notes.push(
    'PM2 list is for the panel process user only; other Linux users have separate PM2 homes',
  );

  const counts = countByStatus(apps);
  return {
    available: true,
    path: probe.path,
    version,
    apps,
    ...counts,
    at,
    notes,
  };
}
