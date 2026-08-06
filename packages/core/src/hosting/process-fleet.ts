/**
 * Combined process fleet: YSK project systemd units + PM2 (panel user).
 * Used by Node/Bun Processes tab so running projects are visible without pm2 start.
 */

import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';
import { collectPm2Snapshot, type Pm2Snapshot } from './pm2-status.js';

export type ProjectProcessRow = {
  projectId: string;
  name: string;
  runtime: string;
  runtimeVersion: string;
  linuxUser: string;
  unit: string;
  deployMode: string;
  active: string;
  mainPid?: number;
  port?: number;
  entry?: string;
  execStart?: string;
  yskManaged: true;
};

export type ProcessFleetSnapshot = {
  at: string;
  pm2: Pm2Snapshot;
  projects: ProjectProcessRow[];
  notes: string[];
};

function unitName(linuxUser: string): string {
  return `ysk-project-${linuxUser}.service`;
}

/**
 * Collect systemd status for panel projects filtered by runtime kinds.
 */
export async function collectProjectProcessRows(
  host: HostExecutor,
  db: JsonStore,
  runtimes: string[] = ['node', 'bun'],
): Promise<ProjectProcessRow[]> {
  const want = new Set(runtimes.map((r) => r.toLowerCase()));
  const projects = (db.snapshot.projects ?? []) as Array<Record<string, unknown>>;
  const rows: ProjectProcessRow[] = [];

  for (const p of projects) {
    const runtime = String(p.runtime ?? '').toLowerCase();
    if (!want.has(runtime)) continue;
    const id = String(p.id ?? '');
    const name = String(p.name ?? id);
    const linuxUser = String(p.linux_user ?? p.linuxUser ?? '').trim();
    if (!linuxUser) continue;
    const unit = unitName(linuxUser);
    const deployMode = String(
      (p.last_health as { deployMode?: string } | undefined)?.deployMode ??
        p.deploy_mode ??
        p.deployMode ??
        'unknown',
    );
    let active = 'unknown';
    let mainPid: number | undefined;
    let execStart: string | undefined;
    try {
      const act = await host.runCommand(['systemctl', 'is-active', unit], {
        timeoutMs: 5_000,
      });
      active = (act.stdout || '').trim() || 'unknown';
    } catch {
      active = 'unknown';
    }
    try {
      const show = await host.runCommand(
        ['systemctl', 'show', unit, '-p', 'MainPID', '-p', 'ExecStart', '--value'],
        { timeoutMs: 5_000 },
      );
      // systemctl --value with multiple props prints one per line
      const lines = (show.stdout || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // Order matches -p order: MainPID then ExecStart (ExecStart may be multi-line path)
      if (lines[0] && /^\d+$/.test(lines[0])) {
        const n = Number(lines[0]);
        if (n > 0) mainPid = n;
      }
      if (lines.length > 1) {
        execStart = lines.slice(1).join(' ').slice(0, 300);
      }
    } catch {
      /* ignore */
    }
    const portRaw = p.port != null ? Number(p.port) : NaN;
    rows.push({
      projectId: id,
      name,
      runtime,
      runtimeVersion: String(p.runtime_version ?? p.runtimeVersion ?? ''),
      linuxUser,
      unit,
      deployMode,
      active,
      mainPid,
      port: Number.isFinite(portRaw) ? portRaw : undefined,
      entry: p.deploy_entry != null ? String(p.deploy_entry) : undefined,
      execStart,
      yskManaged: true,
    });
  }
  return rows;
}

export async function collectProcessFleet(
  host: HostExecutor,
  db: JsonStore,
  opts?: { runtimes?: string[] },
): Promise<ProcessFleetSnapshot> {
  const runtimes = opts?.runtimes ?? ['node', 'bun'];
  const [pm2, projects] = await Promise.all([
    collectPm2Snapshot(host),
    collectProjectProcessRows(host, db, runtimes),
  ]);
  const notes = [
    ...pm2.notes,
    projects.length === 0
      ? 'No node/bun projects in panel database'
      : `${projects.length} YSK project unit(s) listed (systemd is-active)`,
  ];
  return {
    at: new Date().toISOString(),
    pm2,
    projects,
    notes,
  };
}
