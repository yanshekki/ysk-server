/**
 * Log Center read/query routes — overview, sources, journal, query, stream, projects.
 * Extracted from logs.ts (Wave Q3). Behaviour preserved.
 */
import { tl } from '@ysk-server/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson } from '../http/util.js';

export async function handleLogsReadRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/logs/overview') {
    ctx.auth.authenticate(getBearer(req));
    try {
      const { getLogOverview } = await import('@ysk-server/core');
      sendJson(
        res,
        200,
        await getLogOverview({ host: ctx.host, dataDir: ctx.dataDir, db: ctx.db }),
      );
    } catch (e) {
      // Never leave the Log center on a raw 500 — return degraded overview
      sendJson(res, 200, {
        at: new Date().toISOString(),
        journalDisk: null,
        journalDiskMb: null,
        varLogHint: null,
        varLogMb: null,
        logrotate: { installed: false, statusText: '', notes: [] },
        recentErrors: 0,
        projectLogs: { fileCount: 0 },
        executeEnabled: ctx.host.executeEnabled(),
        isRoot: ctx.host.isRoot(),
        quickUnits: [],
        notes: [e instanceof Error ? e.message : tl('errors.http.internal')],
        degraded: true,
      });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/sources') {
    ctx.auth.authenticate(getBearer(req));
    try {
      const { listSourceStatuses, loadLogSettings } = await import('@ysk-server/core');
      const settings = loadLogSettings(ctx.db);
      sendJson(res, 200, {
        items: listSourceStatuses({
          disabledIds: settings.disabledSources,
          extraManagedLogDirs: [join(ctx.dataDir, 'nginx', 'logs')],
          customAllowPaths: settings.customAllowPaths,
        }),
      });
    } catch (e) {
      sendJson(res, 200, {
        items: [],
        notes: [e instanceof Error ? e.message : tl('errors.http.internal')],
      });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/journal/units') {
    ctx.auth.authenticate(getBearer(req));
    try {
      const { listJournalUnits } = await import('@ysk-server/core');
      sendJson(res, 200, await listJournalUnits(ctx.host));
    } catch (e) {
      sendJson(res, 200, {
        items: [],
        notes: [e instanceof Error ? e.message : tl('errors.http.internal')],
      });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/journal/query') {
    ctx.auth.authenticate(getBearer(req));
    const { queryLogSource } = await import('@ysk-server/core');
    const unit = url.searchParams.get('unit') || '';
    const source = unit ? `journal:${unit}` : 'journal:';
    const r = await queryLogSource({
      host: ctx.host,
      dataDir: ctx.dataDir,
      db: ctx.db,
      source,
      lines: Number(url.searchParams.get('lines') || 300),
      since: url.searchParams.get('since') || undefined,
      priority: url.searchParams.get('priority') || undefined,
      grep: url.searchParams.get('grep') || undefined,
    });
    sendJson(res, r.ok || r.lines.length ? 200 : 422, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/query') {
    ctx.auth.authenticate(getBearer(req));
    const { queryLogSource } = await import('@ysk-server/core');
    const source = url.searchParams.get('source') || '';
    const r = await queryLogSource({
      host: ctx.host,
      dataDir: ctx.dataDir,
      db: ctx.db,
      source,
      lines: Number(url.searchParams.get('lines') || 300),
      since: url.searchParams.get('since') || undefined,
      priority: url.searchParams.get('priority') || undefined,
      grep: url.searchParams.get('grep') || undefined,
    });
    sendJson(res, r.ok || r.lines.length ? 200 : 422, r);
    return true;
  }

  /** SSE follow stream — polls query; max ~10 min then closes */
  if (method === 'GET' && url.pathname === '/api/v1/logs/stream') {
    ctx.auth.authenticate(getBearer(req));
    const { queryLogSource, loadLogSettings } = await import('@ysk-server/core');
    const source = url.searchParams.get('source') || '';
    if (!source) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1571')] });
      return true;
    }
    const settings = loadLogSettings(ctx.db);
    const intervalSec = Math.max(
      1,
      Math.min(30, Number(url.searchParams.get('interval') || settings.followIntervalSec || 3)),
    );
    const lines = Number(url.searchParams.get('lines') || settings.maxLines || 300);
    const since = url.searchParams.get('since') || undefined;
    const priority = url.searchParams.get('priority') || undefined;
    const grep = url.searchParams.get('grep') || undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`: ysk-logs-stream\n\n`);

    let closed = false;
    const maxTicks = Math.min(200, Math.floor((10 * 60) / intervalSec));
    let ticks = 0;
    let lastFingerprint = '';

    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tick = async () => {
      if (closed) return;
      ticks += 1;
      try {
        const r = await queryLogSource({
          host: ctx.host,
          dataDir: ctx.dataDir,
          db: ctx.db,
          source,
          lines,
          since,
          priority,
          grep,
        });
        const fp = `${r.lineCount}:${r.lines[r.lines.length - 1] ?? ''}`;
        if (fp !== lastFingerprint) {
          lastFingerprint = fp;
          send('log', {
            ok: r.ok,
            source: r.source,
            lines: r.lines,
            lineCount: r.lineCount,
            truncated: r.truncated,
            notes: r.notes,
            at: new Date().toISOString(),
          });
        } else {
          send('ping', { at: new Date().toISOString() });
        }
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : 'stream error' });
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

    let timer: ReturnType<typeof setTimeout> = setTimeout(() => void tick(), 50);
    req.on('close', () => {
      closed = true;
      clearTimeout(timer);
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/projects') {
    ctx.auth.authenticate(getBearer(req));
    const { listProjectLogIndex } = await import('@ysk-server/core');
    sendJson(res, 200, {
      items: listProjectLogIndex(ctx.db, { dataDir: ctx.dataDir }),
    });
    return true;
  }

  return false;
}
