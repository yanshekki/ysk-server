/**
 * Browser terminal — targets + one-time WS ticket.
 */
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';

export type TerminalTarget =
  | {
      kind: 'root';
      id: 'root';
      label: string;
      linuxUser: string;
      available: boolean;
      notes: string[];
    }
  | {
      kind: 'project';
      id: string;
      label: string;
      projectId: string;
      projectName: string;
      linuxUser: string;
      homeDir: string;
      available: boolean;
      notes: string[];
    };

export type TerminalTargetsResponse = {
  executeEnabled: boolean;
  isRoot: boolean;
  canOpen: boolean;
  items: TerminalTarget[];
  notes: string[];
  /** True when actor has TOTP enabled — root shell needs step-up code */
  rootNeedsStepUp?: boolean;
};

export type TerminalSessionTicket = {
  ok: boolean;
  sessionId: string;
  ticket: string;
  expiresAt: string;
  linuxUser: string;
  targetKey: string;
  wsPath: string;
};

export const terminalApi = {
  targets: () => api.requestRaw<TerminalTargetsResponse>('/api/v1/terminal/targets'),

  openSession: (body: {
    target: 'root' | { projectId: string };
    cols: number;
    rows: number;
    /** Required for root when actor has TOTP enrolled (or recent step-up) */
    totp?: string;
  }) =>
    api.requestRaw<TerminalSessionTicket>('/api/v1/terminal/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/** Build absolute WS URL for current origin + ticket path. */
export function terminalWsUrl(wsPath: string): string {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  // Prefer ticket path from API (already includes ?ticket=)
  if (wsPath.startsWith('ws://') || wsPath.startsWith('wss://')) return wsPath;
  return `${proto}//${loc.host}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;
}

/** Optional: attach token if ticket path missing (not used with ticket flow). */
export function withAuthToken(wsPath: string): string {
  const token = authStore.getToken();
  if (!token || wsPath.includes('ticket=')) return wsPath;
  const sep = wsPath.includes('?') ? '&' : '?';
  return `${wsPath}${sep}token=${encodeURIComponent(token)}`;
}
