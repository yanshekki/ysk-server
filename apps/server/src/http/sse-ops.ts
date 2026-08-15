/**
 * Optional SSE wrapper around honesty ops (same events as updates/software).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { localizeOpsResult, type OpsResultInput } from 'ysk-server-shared';
import { sendOpsResult } from './util.js';

export type SseOpsLog = { stream: 'stdout' | 'stderr' | 'status'; line: string };

export function wantsSse(
  req: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
): boolean {
  return (
    body.stream === true ||
    String(req.headers.accept || '').includes('text/event-stream') ||
    url.searchParams.get('stream') === '1'
  );
}

export async function sendMaybeStreamedOps(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: Record<string, unknown>;
  run: (hooks: {
    onLog?: (ev: SseOpsLog) => void;
    signal?: AbortSignal;
  }) => Promise<object>;
}): Promise<void> {
  if (!wantsSse(input.req, input.url, input.body)) {
    sendOpsResult(input.res, await input.run({}));
    return;
  }

  input.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  input.res.write(`: ysk-ops-stream\n\n`);
  let closed = false;
  const abortCtl = new AbortController();
  const send = (event: string, payload: unknown) => {
    if (closed || input.res.writableEnded) return;
    try {
      input.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      closed = true;
    }
  };
  input.req.on('close', () => {
    closed = true;
    try {
      abortCtl.abort();
    } catch {
      /* */
    }
  });
  send('status', { phase: 'running' });
  try {
    const raw = (await input.run({
      signal: abortCtl.signal,
      onLog: (ev) => {
        if (!closed) send('log', { stream: ev.stream, line: ev.line, at: new Date().toISOString() });
      },
    })) as OpsResultInput & Record<string, unknown>;
    const notes = Array.isArray(raw.notes) ? raw.notes.map(String) : [];
    const honest = localizeOpsResult({
      ok: raw.ok,
      apply_status: raw.apply_status as OpsResultInput['apply_status'],
      blocked: raw.blocked,
      blockMessage: raw.blockMessage,
      requiresExecute: raw.requiresExecute,
      requiresRoot: raw.requiresRoot,
      notes,
      written: Array.isArray(raw.written) ? raw.written.map(String) : undefined,
    });
    const result = { ...raw, ...honest };
    send('status', { phase: result.blocked ? 'blocked' : result.ok ? 'done' : 'failed' });
    send('result', result);
    send('end', { reason: 'complete', ok: result.ok !== false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    send('status', { phase: 'failed' });
    send('result', { ok: false, notes: [message] });
    send('end', { reason: 'error', message });
  }
  if (!input.res.writableEnded) {
    try {
      input.res.end();
    } catch {
      /* */
    }
  }
}
