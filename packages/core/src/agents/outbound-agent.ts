/**
 * Outbound fleet agent loop — polls control plane for commands and acks results.
 */

export interface OutboundAgentOptions {
  controlPlane: string;
  agentId: string;
  group?: string;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  onCommand?: (cmd: { id: string; payload: unknown }) => Promise<unknown> | unknown;
  signal?: AbortSignal;
  /** Enrollment token for unauthenticated edge register (YSK_FLEET_ENROLL_TOKEN). */
  enrollToken?: string;
  /** Panel bearer when enrolling via authenticated panel API. */
  panelToken?: string;
  /** Persisted agent secret from previous register (preferred over re-register). */
  agentToken?: string;
}

/**
 * Register, heartbeat, pull commands, execute handler, ack — one cycle.
 */
export async function agentCycle(
  opts: OutboundAgentOptions & { sessionId?: string; agentToken?: string },
): Promise<{
  sessionId: string;
  agentToken: string;
  heartbeated: boolean;
  commandsHandled: number;
}> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const base = opts.controlPlane.replace(/\/$/, '');

  let sessionId = opts.sessionId;
  let agentToken = opts.agentToken;
  if (!sessionId || !agentToken) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.panelToken) headers.Authorization = `Bearer ${opts.panelToken}`;
    if (opts.enrollToken) headers['X-Ysk-Enroll'] = opts.enrollToken;
    const reg = await fetchFn(`${base}/api/v1/fleet/agents/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        agentId: opts.agentId,
        group: opts.group,
        meta: { source: 'edge' },
        enrollToken: opts.enrollToken,
      }),
    });
    if (!reg.ok) {
      throw new Error(`register failed: HTTP ${reg.status}`);
    }
    const body = (await reg.json()) as { id: string; token?: string };
    sessionId = body.id;
    agentToken = body.token;
    if (!agentToken) {
      throw new Error('register failed: no agent token in response');
    }
  }

  const agentHeaders: Record<string, string> = {
    'X-Ysk-Agent-Token': agentToken,
    Authorization: `Bearer ${agentToken}`,
  };

  const hb = await fetchFn(`${base}/api/v1/fleet/agents/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: agentHeaders,
  });
  if (!hb.ok) {
    throw new Error(`heartbeat failed: HTTP ${hb.status}`);
  }

  const pull = await fetchFn(`${base}/api/v1/fleet/agents/${sessionId}/commands`, {
    headers: agentHeaders,
  });
  if (!pull.ok) {
    throw new Error(`pull commands failed: HTTP ${pull.status}`);
  }
  const { items } = (await pull.json()) as {
    items: Array<{ id: string; payload: unknown }>;
  };

  let handled = 0;
  for (const cmd of items ?? []) {
    let result: unknown;
    let err = false;
    try {
      result = opts.onCommand
        ? await opts.onCommand(cmd)
        : {
            ok: false,
            agentId: opts.agentId,
            error: 'no command handler — refuse silent echo success',
            payload: cmd.payload,
          };
      // CLI / handler results: non-zero exit or ok:false → error status in history
      if (isCommandFailure(result)) err = true;
    } catch (e) {
      err = true;
      result = { error: e instanceof Error ? e.message : String(e), ok: false };
    }
    await fetchFn(`${base}/api/v1/fleet/commands/${cmd.id}/ack`, {
      method: 'POST',
      headers: { ...agentHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, error: err }),
    }).catch(() => undefined);
    handled += 1;
  }

  return { sessionId, agentToken, heartbeated: true, commandsHandled: handled };
}

/**
 * Run agent loop until aborted.
 */
export async function runOutboundAgent(opts: OutboundAgentOptions): Promise<void> {
  const interval = opts.intervalMs ?? 5000;
  let sessionId: string | undefined;
  let agentToken: string | undefined = opts.agentToken;
  while (!opts.signal?.aborted) {
    try {
      const r = await agentCycle({ ...opts, sessionId, agentToken });
      sessionId = r.sessionId;
      agentToken = r.agentToken;
    } catch (e) {
      // reconnect next tick
      sessionId = undefined;
      if (opts.signal?.aborted) break;
      void e;
    }
    await sleep(interval, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Detect failed CLI/handler payload so fleet history marks status=error. */
export function isCommandFailure(result: unknown): boolean {
  if (result == null || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return true;
  if (typeof r.exitCode === 'number' && r.exitCode !== 0) return true;
  if (typeof r.error === 'string' && r.error.length > 0 && r.ok !== true) return true;
  return false;
}
