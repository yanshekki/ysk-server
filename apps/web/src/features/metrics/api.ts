/**
 * Host metrics + process snapshot + top header + SSE stream.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type DiskMount = {
  filesystem: string;
  size: number;
  used: number;
  avail: number;
  usedRatio: number;
  mount: string;
};

export type MetricsSnapshot = {
  at: string;
  loadavg: number[];
  cpuCount: number;
  memory: { total: number; free: number; usedRatio: number; available?: number };
  uptimeSec: number;
  disk?: { path: string; free: number; total: number; usedRatio: number };
  diskMounts?: DiskMount[];
  alerts: string[];
  notes?: string[];
};

export type CpuTimesPct = {
  us: number;
  sy: number;
  ni: number;
  id: number;
  wa: number;
  hi: number;
  si: number;
  st: number;
  busyPct: number;
};

export type TopHeader = {
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
  cpu: CpuTimesPct;
  cpus: CpuTimesPct[];
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
};

export type ProcessSort = 'cpu' | 'mem' | 'time' | 'pid';

export type ProcessRow = {
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
};

export type ProcessSnapshot = {
  ok: boolean;
  at: string;
  sort: ProcessSort;
  limit: number;
  rows: ProcessRow[];
  topHeader?: TopHeader;
  rawTop?: string;
  notes: string[];
};

export type ProcessSignal = 'TERM' | 'KILL' | 'HUP' | 'USR1';

export type SignalProcessResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  pid: string;
  signal: ProcessSignal;
  stillAlive?: boolean;
  command?: string;
  notes: string[];
  executeEnabled?: boolean;
};

export type ProcessDetail = {
  ok: boolean;
  pid: string;
  command?: string;
  cwd?: string;
  fdCount?: number;
  notes: string[];
};

export type MetricsStreamTick = {
  at: string;
  metrics: MetricsSnapshot;
  processes: ProcessSnapshot;
  topHeader?: TopHeader;
};

function apiBase(): string {
  return '';
}

export type ProjectDiskUsageRow = {
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
};

export type ProjectsDiskUsageSnapshot = {
  ok: boolean;
  at: string;
  items: ProjectDiskUsageRow[];
  totalUsedBytes: number;
  notes: string[];
};

export const metricsApi = {
  snapshot: () => api.requestRaw<MetricsSnapshot>('/api/v1/metrics'),
  projectsUsage: (opts?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return api.requestRaw<ProjectsDiskUsageSnapshot>(
      `/api/v1/metrics/projects${qs ? `?${qs}` : ''}`,
    );
  },
  topHeader: () => api.requestRaw<TopHeader>('/api/v1/metrics/top'),
  processes: (opts?: {
    sort?: ProcessSort;
    limit?: number;
    top?: boolean;
    header?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (opts?.sort) q.set('sort', opts.sort);
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.top === true) q.set('top', '1');
    if (opts?.header === false) q.set('header', '0');
    const qs = q.toString();
    return api.requestRaw<ProcessSnapshot>(
      `/api/v1/metrics/processes${qs ? `?${qs}` : ''}`,
    );
  },
  async signal(body: {
    pid: string;
    signal: ProcessSignal;
    confirmKill?: boolean;
    forceSelf?: boolean;
    forceControlPlane?: boolean;
  }): Promise<SignalProcessResult> {
    const token = authStore.getToken();
    const res = await fetch(`${apiBase()}/api/v1/metrics/processes/signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    let data: SignalProcessResult = {
      ok: false,
      pid: body.pid,
      signal: body.signal,
      notes: [],
    };
    try {
      data = (await res.json()) as SignalProcessResult;
    } catch {
      /* keep default */
    }
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        pid: body.pid,
        signal: body.signal,
        notes: [`HTTP ${res.status}`],
      };
    }
    return {
      ...data,
      pid: data.pid ?? body.pid,
      signal: data.signal ?? body.signal,
      notes: Array.isArray(data.notes) ? data.notes : [],
      ok: Boolean(data.ok),
    };
  },
  processDetail: (pid: string) =>
    api.requestRaw<ProcessDetail>(
      `/api/v1/metrics/processes/${encodeURIComponent(pid)}`,
    ),
  async renice(body: {
    pid: string;
    nice: number;
  }): Promise<SignalProcessResult & { nice?: number }> {
    const token = authStore.getToken();
    const res = await fetch(`${apiBase()}/api/v1/metrics/processes/renice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    let data: SignalProcessResult & { nice?: number } = {
      ok: false,
      pid: body.pid,
      signal: 'TERM',
      notes: [],
    };
    try {
      data = (await res.json()) as SignalProcessResult & { nice?: number };
    } catch {
      /* */
    }
    return {
      ...data,
      pid: data.pid ?? body.pid,
      notes: Array.isArray(data.notes) ? data.notes : [],
      ok: Boolean(data.ok),
    };
  },
  openStream: (opts: {
    interval?: number;
    sort?: ProcessSort;
    limit?: number;
    top?: boolean;
    onTick: (t: MetricsStreamTick) => void;
    onError?: (msg: string) => void;
    onEnd?: (reason?: string) => void;
  }): AbortController => {
    const ac = new AbortController();
    const q = new URLSearchParams();
    q.set('interval', String(opts.interval ?? 2));
    q.set('sort', opts.sort ?? 'cpu');
    q.set('limit', String(opts.limit ?? 40));
    if (opts.top === true) q.set('top', '1');
    const token = authStore.getToken();
    if (!token) {
      queueMicrotask(() => {
        opts.onError?.('未登入，無法開啟 SSE');
        opts.onEnd?.('no_token');
      });
      return ac;
    }
    const url = `${apiBase()}/api/v1/metrics/stream?${q}`;

    void (async () => {
      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: ac.signal,
          cache: 'no-store',
          credentials: 'include',
        });
        if (!res.ok || !res.body) {
          opts.onError?.(
            res.status === 401
              ? '未登入或 session 失效，無法開啟 SSE'
              : `stream HTTP ${res.status}`,
          );
          opts.onEnd?.('http_error');
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const block of parts) {
            const lines = block.split('\n');
            let event = 'message';
            let data = '';
            for (const line of lines) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              if (event === 'tick') {
                opts.onTick(parsed as MetricsStreamTick);
              } else if (event === 'error') {
                opts.onError?.(String(parsed.message ?? 'stream error'));
              } else if (event === 'end') {
                opts.onEnd?.(String(parsed.reason ?? 'end'));
              }
            } catch {
              /* ignore parse */
            }
          }
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        opts.onError?.(e instanceof Error ? e.message : 'stream failed');
      }
    })();

    return ac;
  },
};
