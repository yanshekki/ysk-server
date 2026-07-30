/**
 * Host metrics + process snapshot + SSE stream + process signals.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleMetricsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/metrics')) return false;

  if (method === 'GET' && url.pathname === '/api/v1/metrics') {
    ctx.auth.authenticate(getBearer(req));
    const { collectMetricsDeep } = await import('@ysk/core');
    const m = await collectMetricsDeep(ctx.host);
    sendJson(res, 200, m);
    return true;
  }

  /** Per-project disk usage (real du on home_dir) */
  if (method === 'GET' && url.pathname === '/api/v1/metrics/projects') {
    ctx.auth.authenticate(getBearer(req));
    const { collectProjectsDiskUsage } = await import('@ysk/core');
    const projects = ctx.projects.list().map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      homeDir: p.homeDir,
      quotaMb: p.quotaMb,
    }));
    const limit = Number(url.searchParams.get('limit') || 50);
    const snap = await collectProjectsDiskUsage({
      host: ctx.host,
      projects,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    sendJson(res, 200, snap);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/metrics/processes') {
    ctx.auth.authenticate(getBearer(req));
    const { collectProcessSnapshot } = await import('@ysk/core');
    const sortRaw = url.searchParams.get('sort') || 'cpu';
    const sort =
      sortRaw === 'mem' || sortRaw === 'time' || sortRaw === 'pid'
        ? sortRaw
        : 'cpu';
    const limit = Number(url.searchParams.get('limit') || 40);
    const includeTop = url.searchParams.get('top') === '1';
    const includeHeader = url.searchParams.get('header') !== '0';
    const snap = await collectProcessSnapshot(ctx.host, {
      sort,
      limit,
      includeTop,
      includeHeader,
    });
    sendOpsResult(res, snap);
    return true;
  }

  /** Standalone top header (load/tasks/cpu/mem) */
  if (method === 'GET' && url.pathname === '/api/v1/metrics/top') {
    ctx.auth.authenticate(getBearer(req));
    const { collectTopHeader } = await import('@ysk/core');
    const header = await collectTopHeader(ctx.host);
    sendOpsResult(res, header);
    return true;
  }

  /** POST signal one process (TERM / KILL / HUP / USR1) */
  if (method === 'POST' && url.pathname === '/api/v1/metrics/processes/signal') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    let data: Record<string, unknown> = {};
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { signalProcess, isProcessSignal } = await import('@ysk/core');
    const signalRaw = data.signal;
    if (!isProcessSignal(signalRaw)) {
      sendJson(res, 400, {
        ok: false,
        message: 'signal 必須為 TERM | KILL | HUP | USR1',
      });
      return true;
    }
    // KILL requires explicit confirmKill (extra guard for UI + API clients)
    if (signalRaw === 'KILL' && data.confirmKill !== true) {
      sendJson(res, 400, {
        ok: false,
        message: 'SIGKILL 需 confirmKill: true',
      });
      return true;
    }
    const result = await signalProcess({
      host: ctx.host,
      pid: String(data.pid ?? ''),
      signal: signalRaw,
      forceSelf: data.forceSelf === true,
      forceControlPlane: data.forceControlPlane === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'metrics.process.signal',
      resource: result.pid,
      detail: {
        signal: result.signal,
        command: result.command,
        stillAlive: result.stillAlive,
        blocked: result.blocked,
        forceSelf: data.forceSelf === true,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  /** POST renice */
  if (method === 'POST' && url.pathname === '/api/v1/metrics/processes/renice') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    let data: Record<string, unknown> = {};
    try {
      data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      sendJson(res, 400, { ok: false, message: 'JSON 無效' });
      return true;
    }
    const { reniceProcess } = await import('@ysk/core');
    const result = await reniceProcess({
      host: ctx.host,
      pid: String(data.pid ?? ''),
      nice: Number(data.nice),
    });
    ctx.audit.append({
      actor: user.username,
      action: 'metrics.process.renice',
      resource: result.pid,
      detail: { nice: result.nice, ok: result.ok, blocked: result.blocked },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  /** GET process detail from /proc */
  const detailMatch = url.pathname.match(
    /^\/api\/v1\/metrics\/processes\/(\d+)$/,
  );
  if (method === 'GET' && detailMatch) {
    ctx.auth.authenticate(getBearer(req));
    const { collectProcessDetail } = await import('@ysk/core');
    const detail = await collectProcessDetail(ctx.host, detailMatch[1]);
    sendOpsResult(res, detail);
    return true;
  }

  /** SSE: metrics + processes + top header every interval (batch, not PTY) */
  if (method === 'GET' && url.pathname === '/api/v1/metrics/stream') {
    ctx.auth.authenticate(getBearer(req));
    const { collectMetricsDeep, collectProcessSnapshot } = await import('@ysk/core');
    const intervalSec = Math.max(
      1,
      Math.min(10, Number(url.searchParams.get('interval') || 2)),
    );
    const sortRaw = url.searchParams.get('sort') || 'cpu';
    const sort =
      sortRaw === 'mem' || sortRaw === 'time' || sortRaw === 'pid'
        ? sortRaw
        : 'cpu';
    const limit = Number(url.searchParams.get('limit') || 40);
    // Stream: structured header always; raw top dump only if top=1
    const includeTop = url.searchParams.get('top') === '1';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`: ysk-metrics-stream\n\n`);

    let closed = false;
    const maxTicks = Math.min(300, Math.floor((10 * 60) / intervalSec));
    let ticks = 0;

    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tick = async () => {
      if (closed) return;
      ticks += 1;
      try {
        const [metrics, processes] = await Promise.all([
          collectMetricsDeep(ctx.host),
          collectProcessSnapshot(ctx.host, {
            sort,
            limit,
            includeTop,
            includeHeader: true,
            sampleMs: 280,
          }),
        ]);
        send('tick', {
          at: new Date().toISOString(),
          metrics,
          processes,
          topHeader: processes.topHeader,
        });
      } catch (e) {
        send('error', {
          message: e instanceof Error ? e.message : 'stream error',
        });
      }
      if (ticks >= maxTicks) {
        send('end', { reason: 'max_duration' });
        closed = true;
        try {
          res.end();
        } catch {
          /* */
        }
        return;
      }
      if (!closed) {
        timer = setTimeout(() => void tick(), intervalSec * 1000);
      }
    };

    let timer: ReturnType<typeof setTimeout> = setTimeout(() => void tick(), 40);
    req.on('close', () => {
      closed = true;
      clearTimeout(timer);
    });
    return true;
  }

  return false;
}
