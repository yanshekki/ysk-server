/**
 * System Log Center routes — /api/v1/logs/*
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleLogsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/logs')) return false;

  if (method === 'GET' && url.pathname === '/api/v1/logs/overview') {
    ctx.auth.authenticate(getBearer(req));
    const { getLogOverview } = await import('@ysk/core');
    sendJson(
      res,
      200,
      await getLogOverview({ host: ctx.host, dataDir: ctx.dataDir, db: ctx.db }),
    );
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/sources') {
    ctx.auth.authenticate(getBearer(req));
    const { listSourceStatuses, loadLogSettings } = await import('@ysk/core');
    const settings = loadLogSettings(ctx.db);
    sendJson(res, 200, {
      items: listSourceStatuses({
        disabledIds: settings.disabledSources,
        extraManagedLogDirs: [join(ctx.dataDir, 'nginx', 'logs')],
        customAllowPaths: settings.customAllowPaths,
      }),
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/journal/units') {
    ctx.auth.authenticate(getBearer(req));
    const { listJournalUnits } = await import('@ysk/core');
    sendJson(res, 200, await listJournalUnits(ctx.host));
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/journal/query') {
    ctx.auth.authenticate(getBearer(req));
    const { queryLogSource } = await import('@ysk/core');
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
    const { queryLogSource } = await import('@ysk/core');
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
    const { queryLogSource, loadLogSettings } = await import('@ysk/core');
    const source = url.searchParams.get('source') || '';
    if (!source) {
      sendJson(res, 400, { ok: false, notes: ['需要 source'] });
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
    const { listProjectLogIndex } = await import('@ysk/core');
    sendJson(res, 200, {
      items: listProjectLogIndex(ctx.db, { dataDir: ctx.dataDir }),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/logs/export') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      source?: string;
      lines?: number;
      since?: string;
      priority?: string;
      grep?: string;
      format?: 'text' | 'jsonl';
    };
    const { exportLogQuery } = await import('@ysk/core');
    const r = await exportLogQuery({
      host: ctx.host,
      dataDir: ctx.dataDir,
      db: ctx.db,
      source: data.source || '',
      lines: data.lines,
      since: data.since,
      priority: data.priority,
      grep: data.grep,
      format: data.format,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'logs.export',
      detail: { source: data.source, ok: r.ok, bytes: r.bytes, format: r.format },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/v1/logs/export/')) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    if (!/^[a-zA-Z0-9_-]{8,36}$/.test(id)) {
      sendJson(res, 400, { ok: false, notes: ['無效 export id'] });
      return true;
    }
    const base = join(ctx.dataDir, 'logs-export');
    let path = join(base, `${id}.log`);
    let ctype = 'text/plain; charset=utf-8';
    let fname = `ysk-logs-${id}.log`;
    if (!existsSync(path)) {
      path = join(base, `${id}.jsonl`);
      ctype = 'application/x-ndjson; charset=utf-8';
      fname = `ysk-logs-${id}.jsonl`;
    }
    if (!existsSync(path)) {
      sendJson(res, 404, { ok: false, notes: ['匯出不存在或已過期'] });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': ctype,
      'Content-Disposition': `attachment; filename="${fname}"`,
    });
    createReadStream(path).pipe(res);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/logs/journal/vacuum') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { mode?: 'time' | 'size'; value?: string };
    const { vacuumJournal } = await import('@ysk/core');
    const r = await vacuumJournal(ctx.host, data.mode ?? 'time', data.value ?? '14d');
    ctx.audit.append({
      actor: user.username,
      action: 'logs.journal.vacuum',
      detail: { ...data, ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/settings') {
    ctx.auth.authenticate(getBearer(req));
    const { loadLogSettings } = await import('@ysk/core');
    sendJson(res, 200, loadLogSettings(ctx.db));
    return true;
  }

  if (method === 'PUT' && url.pathname === '/api/v1/logs/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { saveLogSettings } = await import('@ysk/core');
    const s = saveLogSettings(ctx.db, data as never);
    ctx.audit.append({
      actor: user.username,
      action: 'logs.settings',
      detail: {
        maxLines: s.maxLines,
        followIntervalSec: s.followIntervalSec,
        autoVacuumEnabled: s.autoVacuumEnabled,
      },
      ok: true,
    });
    sendJson(res, 200, s);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/bookmarks') {
    ctx.auth.authenticate(getBearer(req));
    const { loadLogSettings } = await import('@ysk/core');
    sendJson(res, 200, { items: loadLogSettings(ctx.db).bookmarks });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/logs/bookmarks') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      source?: string;
      since?: string;
      priority?: string;
      grep?: string;
      lines?: number;
    };
    const { addLogBookmark } = await import('@ysk/core');
    const s = addLogBookmark(ctx.db, {
      name: data.name || 'bookmark',
      source: data.source || '',
      since: data.since,
      priority: data.priority,
      grep: data.grep,
      lines: data.lines,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'logs.bookmark.add',
      detail: { name: data.name, source: data.source },
      ok: true,
    });
    sendJson(res, 200, s);
    return true;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/v1/logs/bookmarks/')) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    const { removeLogBookmark } = await import('@ysk/core');
    const s = removeLogBookmark(ctx.db, id);
    ctx.audit.append({
      actor: user.username,
      action: 'logs.bookmark.remove',
      detail: { id },
      ok: true,
    });
    sendJson(res, 200, s);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/logs/logrotate') {
    ctx.auth.authenticate(getBearer(req));
    const { getLogrotateStatus } = await import('@ysk/core');
    sendJson(res, 200, await getLogrotateStatus(ctx.host));
    return true;
  }

  return false;
}
