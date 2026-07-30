/**
 * Structured top(1)-style host header — honest /proc samples (no fake PTY).
 * Per-CPU deltas match SSH top press "1".
 */

import type { HostExecutor } from '../host/executor.js';

export type CpuTimesPct = {
  us: number;
  sy: number;
  ni: number;
  id: number;
  wa: number;
  hi: number;
  si: number;
  st: number;
  /** 100 - id (top-style busy; includes iowait in busy-ish sense differently — we use 100-id) */
  busyPct: number;
};

export type TopTasks = {
  total: number;
  running: number;
  sleeping: number;
  stopped: number;
  zombie: number;
};

export type TopMemBlock = {
  totalKiB: number;
  freeKiB: number;
  usedKiB: number;
  buffCacheKiB: number;
  availableKiB: number;
};

export type TopSwapBlock = {
  totalKiB: number;
  freeKiB: number;
  usedKiB: number;
};

export type TopHeader = {
  ok: boolean;
  at: string;
  uptimeSec: number;
  loadavg: [number, number, number];
  tasks: TopTasks;
  /** Aggregate %Cpu(s) */
  cpu: CpuTimesPct;
  /** Per-core %Cpu0…N (top key "1") */
  cpus: CpuTimesPct[];
  memory: TopMemBlock;
  swap: TopSwapBlock;
  notes: string[];
  /** Sample window used for CPU delta (ms) */
  sampleMs?: number;
};

/** Raw jiffies row from /proc/stat */
export type CpuJiffies = {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
};

export function parseProcStat(stdout: string): {
  total?: CpuJiffies;
  cpus: CpuJiffies[];
} {
  const cpus: CpuJiffies[] = [];
  let total: CpuJiffies | undefined;
  for (const line of stdout.split('\n')) {
    const m = line.match(
      /^(cpu\d*)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/,
    );
    if (!m) continue;
    const row: CpuJiffies = {
      user: Number(m[2]),
      nice: Number(m[3]),
      system: Number(m[4]),
      idle: Number(m[5]),
      iowait: Number(m[6]),
      irq: Number(m[7]),
      softirq: Number(m[8]),
      steal: Number(m[9]),
    };
    if (m[1] === 'cpu') total = row;
    else if (/^cpu\d+$/.test(m[1])) cpus.push(row);
  }
  return { total, cpus };
}

export function jiffiesToPct(a: CpuJiffies, b: CpuJiffies): CpuTimesPct {
  const dUser = Math.max(0, b.user - a.user);
  const dNice = Math.max(0, b.nice - a.nice);
  const dSys = Math.max(0, b.system - a.system);
  const dIdle = Math.max(0, b.idle - a.idle);
  const dWait = Math.max(0, b.iowait - a.iowait);
  const dIrq = Math.max(0, b.irq - a.irq);
  const dSoft = Math.max(0, b.softirq - a.softirq);
  const dSteal = Math.max(0, b.steal - a.steal);
  const total =
    dUser + dNice + dSys + dIdle + dWait + dIrq + dSoft + dSteal || 1;
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  const us = pct(dUser);
  const ni = pct(dNice);
  const sy = pct(dSys);
  const id = pct(dIdle);
  const wa = pct(dWait);
  const hi = pct(dIrq);
  const si = pct(dSoft);
  const st = pct(dSteal);
  const busyPct = Math.round((1000 - id * 10)) / 10;
  return {
    us,
    sy,
    ni,
    id,
    wa,
    hi,
    si,
    st,
    busyPct: Math.max(0, Math.min(100, busyPct)),
  };
}

export function parseMeminfo(stdout: string): {
  memory: TopMemBlock;
  swap: TopSwapBlock;
} {
  const get = (key: string): number => {
    const m = stdout.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'));
    return m ? Number(m[1]) : 0;
  };
  const total = get('MemTotal');
  const free = get('MemFree');
  const available = get('MemAvailable') || free;
  const buffers = get('Buffers');
  const cached = get('Cached');
  const sreclaim = get('SReclaimable');
  const buffCache = buffers + cached + sreclaim;
  // top-style used ≈ total - free - buff/cache (approx); better: total - available
  const used = Math.max(0, total - available);
  const swapTotal = get('SwapTotal');
  const swapFree = get('SwapFree');
  return {
    memory: {
      totalKiB: total,
      freeKiB: free,
      usedKiB: used,
      buffCacheKiB: buffCache,
      availableKiB: available,
    },
    swap: {
      totalKiB: swapTotal,
      freeKiB: swapFree,
      usedKiB: Math.max(0, swapTotal - swapFree),
    },
  };
}

export function parseLoadavg(stdout: string): {
  loadavg: [number, number, number];
  uptimeSec: number;
} {
  // /proc/loadavg: 0.52 0.58 0.59 1/372 12345
  const parts = stdout.trim().split(/\s+/);
  const l1 = Number(parts[0]) || 0;
  const l5 = Number(parts[1]) || 0;
  const l15 = Number(parts[2]) || 0;
  return { loadavg: [l1, l5, l15], uptimeSec: 0 };
}

export function parseUptime(stdout: string): number {
  // /proc/uptime: 44523.12 123456.78
  const n = Number(stdout.trim().split(/\s+/)[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Count task states via ps -eo state (cheap, honest).
 */
export function parseTaskStates(stdout: string): TopTasks {
  const tasks: TopTasks = {
    total: 0,
    running: 0,
    sleeping: 0,
    stopped: 0,
    zombie: 0,
  };
  for (const line of stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
    // header when not using --no-headers
    if (line === 'STAT' || line.toUpperCase() === 'STATE') continue;
    // first char of state is primary (Ss → S, Rsl → R)
    const s = line[0]?.toUpperCase();
    if (!s || !/[A-Z]/.test(s)) continue;
    // state tokens are short (R, S, Ss, Rsl, D, Z, T, t, I…)
    if (line.length > 6) continue;
    tasks.total += 1;
    if (s === 'R') tasks.running += 1;
    else if (s === 'T') tasks.stopped += 1;
    else if (s === 'Z') tasks.zombie += 1;
    else tasks.sleeping += 1; // S D I etc.
  }
  return tasks;
}

const emptyCpu = (): CpuTimesPct => ({
  us: 0,
  sy: 0,
  ni: 0,
  id: 100,
  wa: 0,
  hi: 0,
  si: 0,
  st: 0,
  busyPct: 0,
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Collect top-style header. Uses dual /proc/stat sample for real %.
 */
export async function collectTopHeader(
  host: HostExecutor,
  opts?: { sampleMs?: number },
): Promise<TopHeader> {
  const notes: string[] = [];
  const sampleMs = Math.max(100, Math.min(2000, opts?.sampleMs ?? 350));
  const at = new Date().toISOString();

  const readStat = async () => {
    const r = await host.runCommand(['cat', '/proc/stat'], { timeoutMs: 3_000 });
    if (r.exitCode !== 0) return null;
    return parseProcStat(r.stdout);
  };

  const s1 = await readStat();
  await sleep(sampleMs);
  const s2 = await readStat();

  let cpu = emptyCpu();
  let cpus: CpuTimesPct[] = [];
  if (s1?.total && s2?.total) {
    cpu = jiffiesToPct(s1.total, s2.total);
    const n = Math.min(s1.cpus.length, s2.cpus.length);
    for (let i = 0; i < n; i++) {
      cpus.push(jiffiesToPct(s1.cpus[i], s2.cpus[i]));
    }
  } else {
    notes.push('/proc/stat 不可讀 — CPU% 無法計算');
  }

  let memory: TopMemBlock = {
    totalKiB: 0,
    freeKiB: 0,
    usedKiB: 0,
    buffCacheKiB: 0,
    availableKiB: 0,
  };
  let swap: TopSwapBlock = { totalKiB: 0, freeKiB: 0, usedKiB: 0 };
  const mi = await host.runCommand(['cat', '/proc/meminfo'], { timeoutMs: 3_000 });
  if (mi.exitCode === 0) {
    const parsed = parseMeminfo(mi.stdout);
    memory = parsed.memory;
    swap = parsed.swap;
  } else {
    notes.push('/proc/meminfo 不可讀');
  }

  let loadavg: [number, number, number] = [0, 0, 0];
  let uptimeSec = 0;
  const la = await host.runCommand(['cat', '/proc/loadavg'], { timeoutMs: 2_000 });
  if (la.exitCode === 0) {
    loadavg = parseLoadavg(la.stdout).loadavg;
  }
  const up = await host.runCommand(['cat', '/proc/uptime'], { timeoutMs: 2_000 });
  if (up.exitCode === 0) {
    uptimeSec = parseUptime(up.stdout);
  }

  let tasks: TopTasks = {
    total: 0,
    running: 0,
    sleeping: 0,
    stopped: 0,
    zombie: 0,
  };
  const st = await host.runCommand(['ps', '-eo', 'state', '--no-headers'], {
    timeoutMs: 5_000,
  });
  if (st.exitCode === 0) {
    tasks = parseTaskStates(st.stdout);
  } else {
    // fallback without --no-headers
    const st2 = await host.runCommand(['ps', '-eo', 'state'], { timeoutMs: 5_000 });
    if (st2.exitCode === 0) {
      tasks = parseTaskStates(st2.stdout);
    } else {
      notes.push('無法統計 Tasks（ps state 失敗）');
    }
  }

  const ok =
    (s1?.total != null && s2?.total != null) ||
    memory.totalKiB > 0 ||
    tasks.total > 0;

  return {
    ok,
    at,
    uptimeSec,
    loadavg,
    tasks,
    cpu,
    cpus,
    memory,
    swap,
    notes,
    sampleMs,
  };
}
