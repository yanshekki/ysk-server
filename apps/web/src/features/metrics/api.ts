/**
 * Host metrics + process snapshot + top header + SSE stream.
 */
import type {
  DiskMount,
  MetricsSnapshot,
  CpuTimesPct,
  TopHeader,
  ProcessSort,
  ProcessRow,
  ProcessSnapshot,
  ProcessSignal,
  SignalProcessResultDto,
  ProcessDetailDto,
  MetricsStreamTickDto,
  ProjectDiskUsageRowDto,
  ProjectsDiskUsageSnapshotDto,
} from '@ysk-server/shared';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import i18n from '../../shared/lib/i18n';

export type {
  DiskMount,
  MetricsSnapshot,
  CpuTimesPct,
  TopHeader,
  ProcessSort,
  ProcessRow,
  ProcessSnapshot,
  ProcessSignal,
} from '@ysk-server/shared';

export type SignalProcessResult = SignalProcessResultDto;
export type ProcessDetail = ProcessDetailDto;
export type MetricsStreamTick = MetricsStreamTickDto;
export type ProjectDiskUsageRow = ProjectDiskUsageRowDto;
export type ProjectsDiskUsageSnapshot = ProjectsDiskUsageSnapshotDto;

function apiBase(): string {
  return '';
}

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
        opts.onError?.(i18n.t('metrics.sseNeedLogin'));
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
              ? i18n.t('metrics.sseSessionExpired')
              : i18n.t('metrics.sseHttpError', { status: res.status }),
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
                opts.onTick(parsed as unknown as MetricsStreamTick);
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
