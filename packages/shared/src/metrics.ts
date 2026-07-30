/**
 * Host metrics / process table / top header — API + core contract.
 */

export interface DiskMountDto {
  filesystem: string;
  size: number;
  used: number;
  avail: number;
  usedRatio: number;
  mount: string;
}

/** @deprecated Prefer DiskMountDto */
export type DiskMount = DiskMountDto;

export interface MetricsSnapshotDto {
  at: string;
  loadavg: number[];
  cpuCount: number;
  memory: { total: number; free: number; usedRatio: number; available?: number };
  uptimeSec: number;
  disk?: { path: string; free: number; total: number; usedRatio: number };
  diskMounts?: DiskMountDto[];
  alerts: string[];
  notes?: string[];
}

/** @deprecated Prefer MetricsSnapshotDto */
export type MetricsSnapshot = MetricsSnapshotDto;

export interface CpuTimesPctDto {
  us: number;
  sy: number;
  ni: number;
  id: number;
  wa: number;
  hi: number;
  si: number;
  st: number;
  busyPct: number;
}

export type CpuTimesPct = CpuTimesPctDto;

export interface TopHeaderDto {
  ok: boolean;
  at: string;
  uptimeSec: number;
  loadavg: [number, number, number];
  tasks: {
    total: number;
    running: number;
    sleeping: number;
    stopped: number;
    zombie: number;
  };
  cpu: CpuTimesPctDto;
  cpus: CpuTimesPctDto[];
  memory: {
    totalKiB: number;
    freeKiB: number;
    usedKiB: number;
    buffCacheKiB: number;
    availableKiB: number;
  };
  swap: {
    totalKiB: number;
    freeKiB: number;
    usedKiB: number;
  };
  notes: string[];
  sampleMs?: number;
}

export type TopHeader = TopHeaderDto;

export type ProcessSort = 'cpu' | 'mem' | 'time' | 'pid';

export interface ProcessRowDto {
  pid: string;
  user: string;
  cpu: number;
  mem: number;
  command: string;
  etime?: string;
  pr?: string;
  ni?: number;
  virtKiB?: number;
  resKiB?: number;
  shrKiB?: number;
  state?: string;
  timePlus?: string;
}

export type ProcessRow = ProcessRowDto;

export interface ProcessSnapshotDto {
  ok: boolean;
  at: string;
  sort: ProcessSort;
  limit: number;
  rows: ProcessRowDto[];
  topHeader?: TopHeaderDto;
  rawTop?: string;
  notes: string[];
}

export type ProcessSnapshot = ProcessSnapshotDto;

export type ProcessSignal = 'TERM' | 'KILL' | 'HUP' | 'USR1';

export interface SignalProcessResultDto {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  pid: string;
  signal: ProcessSignal;
  stillAlive?: boolean;
  command?: string;
  notes: string[];
  executeEnabled?: boolean;
  nice?: number;
}

export interface ProcessDetailDto {
  ok: boolean;
  pid: string;
  command?: string;
  cwd?: string;
  fdCount?: number;
  notes: string[];
}

export interface MetricsStreamTickDto {
  at: string;
  metrics: MetricsSnapshotDto;
  processes: ProcessSnapshotDto;
  topHeader?: TopHeaderDto;
}

export interface ProjectDiskUsageRowDto {
  projectId: string;
  name: string;
  domain?: string;
  homeDir: string;
  usedBytes: number;
  usedMb: number;
  quotaMb: number | null;
  usedRatio: number | null;
  withinQuota: boolean | null;
  notes: string[];
}

export interface ProjectsDiskUsageSnapshotDto {
  ok: boolean;
  at: string;
  items: ProjectDiskUsageRowDto[];
  totalUsedBytes: number;
  notes: string[];
}
