/**
 * POST runtime install with SSE body stream — live server log lines for the panel.
 */
import { authStore } from '../../shared/stores/auth-store';
import i18n from '../../shared/lib/i18n';
import type { OpsResultLike } from '../../shared/components/ui';

export type RuntimeInstallStreamBody = {
  kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
  version: string;
  install?: boolean;
  extensions?: string[];
  plugins?: string[];
};

export type InstallLogLine = {
  stream: 'stdout' | 'stderr' | 'status';
  line: string;
  at?: string;
};

function localeHeader(): string {
  try {
    const raw =
      i18n.language ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('ysk.locale') : null) ||
      'zh-HK';
    const lower = String(raw).toLowerCase();
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower.includes('cn') || lower.includes('hans')) return 'zh-CN';
    if (lower.startsWith('zh')) return 'zh-HK';
    return 'zh-HK';
  } catch {
    return 'zh-HK';
  }
}

function resultToOps(raw: unknown): OpsResultLike {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, notes: [String(raw)] };
  }
  const o = raw as Record<string, unknown>;
  const notes = Array.isArray(o.notes) ? o.notes.map(String) : [];
  const blocked = Boolean(o.blocked || o.requiresExecute || o.requiresRoot);
  return {
    ok: o.ok !== false && !blocked,
    notes,
    blocked,
    blockMessage: typeof o.blockMessage === 'string' ? o.blockMessage : undefined,
    requiresExecute: Boolean(o.requiresExecute),
    requiresRoot: Boolean(o.requiresRoot),
  };
}

/**
 * Stream install logs via SSE over POST fetch.
 * Calls onLog for each line; resolves with final ops result.
 */
export async function streamRuntimeInstall(
  body: RuntimeInstallStreamBody,
  opts?: {
    onLog?: (line: InstallLogLine) => void;
    signal?: AbortSignal;
  },
): Promise<OpsResultLike> {
  const token = authStore.getToken();
  const res = await fetch('/api/v1/hosting/runtimes/install', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Language': localeHeader(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...body, stream: true, install: body.install !== false }),
    signal: opts?.signal,
  });

  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string; notes?: string[] };
      message = j.message || j.notes?.[0] || message;
    } catch {
      /* */
    }
    opts?.onLog?.({ stream: 'stderr', line: message });
    return { ok: false, notes: [message] };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: OpsResultLike | null = null;
  let eventName = 'message';

  const dispatchBlock = (block: string) => {
    const lines = block.split('\n');
    let dataLines: string[] = [];
    let ev = eventName;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('event:')) {
        ev = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (!dataLines.length) return;
    const dataStr = dataLines.join('\n');
    let data: unknown = dataStr;
    try {
      data = JSON.parse(dataStr);
    } catch {
      /* keep string */
    }
    if (ev === 'log' && data && typeof data === 'object') {
      const d = data as { stream?: string; line?: string; at?: string };
      opts?.onLog?.({
        stream: d.stream === 'stderr' ? 'stderr' : 'stdout',
        line: String(d.line ?? ''),
        at: d.at,
      });
    } else if (ev === 'status' && data && typeof data === 'object') {
      const d = data as { phase?: string };
      if (d.phase) {
        opts?.onLog?.({ stream: 'status', line: `[${d.phase}]` });
      }
    } else if (ev === 'result') {
      finalResult = resultToOps(data);
    } else if (ev === 'end') {
      /* done */
    }
    eventName = 'message';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events separated by blank line
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (block.trim()) dispatchBlock(block);
    }
  }
  if (buffer.trim()) dispatchBlock(buffer);

  return finalResult ?? { ok: false, notes: ['stream ended without result'] };
}
