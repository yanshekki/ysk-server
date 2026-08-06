/**
 * PM2 fleet snapshot + SSE stream for Node/Bun Processes tab.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type Pm2AppRow = {
  name: string;
  pmId: number | null;
  pid: number | null;
  status: string;
  cpu: number | null;
  memory: number | null;
  restarts: number | null;
  unstableRestarts: number | null;
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

function apiBase(): string {
  return '';
}

export const pm2Api = {
  status: () => api.requestRaw<Pm2Snapshot>('/api/v1/hosting/pm2/status'),

  openStream: (opts: {
    interval?: number;
    onTick: (s: Pm2Snapshot) => void;
    onError?: (msg: string) => void;
    onEnd?: (reason?: string) => void;
  }): AbortController => {
    const ac = new AbortController();
    const q = new URLSearchParams();
    if (opts.interval != null) q.set('interval', String(opts.interval));
    const token = authStore.getToken();
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase()}/api/v1/hosting/pm2/stream?${q.toString()}`,
          {
            headers: {
              Accept: 'text/event-stream',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: ac.signal,
          },
        );
        if (!res.ok || !res.body) {
          opts.onError?.(`HTTP ${res.status}`);
          opts.onEnd?.('http_error');
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let event = 'message';
        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const line of parts) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              try {
                const data = JSON.parse(raw) as Pm2Snapshot & {
                  message?: string;
                  reason?: string;
                };
                if (event === 'tick') opts.onTick(data as Pm2Snapshot);
                else if (event === 'error') opts.onError?.(data.message || 'stream error');
                else if (event === 'end') opts.onEnd?.(data.reason);
              } catch {
                /* ignore partial */
              }
              event = 'message';
            } else if (line === '') {
              event = 'message';
            }
          }
        }
        opts.onEnd?.('closed');
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
          opts.onEnd?.('aborted');
          return;
        }
        opts.onError?.(e instanceof Error ? e.message : 'stream failed');
        opts.onEnd?.('error');
      }
    })();
    return ac;
  },
};
