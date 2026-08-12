/**
 * Detached BT tracker process control (CLI outside serve).
 * Panel `serve` prefers in-process start so seeder shares the same process.
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  closeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadBtTrackerSettings } from './settings.js';
import { isBtTrackerRunning, startBtTracker, stopBtTracker } from './service.js';
import type { HostExecutor } from '../../host/executor.js';
import { tl } from 'ysk-server-shared';

function pidPath(dataDir: string): string {
  return join(dataDir, 'bt-tracker', 'tracker.pid');
}

function logPath(dataDir: string): string {
  return join(dataDir, 'bt-tracker', 'tracker.log');
}

export function readTrackerPid(dataDir: string): number | null {
  const p = pidPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    const n = Number(String(readFileSync(p, 'utf8')).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function isBtTrackerPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isDetachedTrackerRunning(dataDir: string): boolean {
  const pid = readTrackerPid(dataDir);
  if (!pid) return false;
  if (!isBtTrackerPidAlive(pid)) {
    try {
      unlinkSync(pidPath(dataDir));
    } catch {
      /* */
    }
    return false;
  }
  return true;
}

/** True if in-process or detached worker is up. */
export function isAnyBtTrackerRunning(dataDir: string): boolean {
  return isBtTrackerRunning() || isDetachedTrackerRunning(dataDir);
}

function resolveWorkerScript(): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const js = join(here, 'worker.js');
    if (existsSync(js)) return js;
  } catch {
    /* */
  }
  return null;
}

/**
 * Start tracker: in-process when possible; else detached worker (CLI).
 */
export async function startBtTrackerService(input: {
  dataDir: string;
  host: HostExecutor;
  preferDetached?: boolean;
}): Promise<{
  ok: boolean;
  mode: 'in-process' | 'detached' | 'already';
  pid?: number | null;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  if (isBtTrackerRunning()) {
    return {
      ok: true,
      mode: 'already',
      pid: process.pid,
      notes: [tl('notes.btTracker.alreadyRunning')],
    };
  }
  if (isDetachedTrackerRunning(input.dataDir)) {
    return {
      ok: true,
      mode: 'already',
      pid: readTrackerPid(input.dataDir),
      notes: [tl('notes.btTracker.alreadyRunning')],
    };
  }

  if (!input.preferDetached) {
    const r = await startBtTracker({ dataDir: input.dataDir, host: input.host });
    if (r.ok) {
      return { ok: true, mode: 'in-process', pid: process.pid, notes: r.notes };
    }
  }

  const worker = resolveWorkerScript();
  if (!worker) {
    // Last resort: in-process again if preferDetached failed path
    if (input.preferDetached) {
      const r = await startBtTracker({ dataDir: input.dataDir, host: input.host });
      if (r.ok) {
        return {
          ok: true,
          mode: 'in-process',
          pid: process.pid,
          notes: [
            ...r.notes,
            tl('notes.btTracker.workerMissing'),
          ],
        };
      }
      return {
        ok: false,
        mode: 'detached',
        notes: [...r.notes, tl('notes.btTracker.workerMissing')],
        requiresExecute: !input.host.executeEnabled(),
      };
    }
    return {
      ok: false,
      mode: 'detached',
      notes: [tl('notes.btTracker.workerMissing')],
      requiresExecute: !input.host.executeEnabled(),
    };
  }

  mkdirSync(join(input.dataDir, 'bt-tracker'), { recursive: true });
  const logFd = openSync(logPath(input.dataDir), 'a');
  try {
    const child = spawn(process.execPath, [worker, `--data-dir=${input.dataDir}`], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, YSK_BT_TRACKER_DATA_DIR: input.dataDir },
    });
    child.unref();
    if (!child.pid) {
      return {
        ok: false,
        mode: 'detached',
        notes: [tl('notes.btTracker.startFailed', { detail: 'no pid' })],
      };
    }
    writeFileSync(pidPath(input.dataDir), `${child.pid}\n`, 'utf8');
    await new Promise((r) => setTimeout(r, 500));
    if (!isBtTrackerPidAlive(child.pid)) {
      try {
        unlinkSync(pidPath(input.dataDir));
      } catch {
        /* */
      }
      return {
        ok: false,
        mode: 'detached',
        notes: [tl('notes.btTracker.startFailed', { detail: 'worker exited early' })],
      };
    }
    const settings = loadBtTrackerSettings(input.dataDir);
    return {
      ok: true,
      mode: 'detached',
      pid: child.pid,
      notes: [
        tl('notes.btTracker.startedDetached', {
          pid: String(child.pid),
          port: String(settings.httpPort),
        }),
      ],
    };
  } finally {
    try {
      closeSync(logFd);
    } catch {
      /* */
    }
  }
}

export async function stopBtTrackerService(input: {
  dataDir: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (isBtTrackerRunning()) {
    const r = await stopBtTracker();
    notes.push(...r.notes);
  }
  const pid = readTrackerPid(input.dataDir);
  if (pid && isBtTrackerPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 600));
      if (isBtTrackerPidAlive(pid)) process.kill(pid, 'SIGKILL');
      notes.push(tl('notes.btTracker.stopped'));
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  } else if (!notes.length) {
    notes.push(tl('notes.btTracker.notRunning'));
  }
  try {
    if (existsSync(pidPath(input.dataDir))) unlinkSync(pidPath(input.dataDir));
  } catch {
    /* */
  }
  return { ok: true, notes };
}
