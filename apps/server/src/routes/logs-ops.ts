/**
 * Log Center ops routes — export, vacuum, settings, bookmarks, logrotate.
 * Extracted from logs.ts (Wave Q3). Behaviour preserved.
 */
import { tl } from '@yanshekki/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleLogsOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
    const { exportLogQuery } = await import('@yanshekki/core');
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
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1101')] });
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
      sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0607')] });
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
    const { vacuumJournal } = await import('@yanshekki/core');
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
    const { loadLogSettings } = await import('@yanshekki/core');
    sendJson(res, 200, loadLogSettings(ctx.db));
    return true;
  }

  if (method === 'PUT' && url.pathname === '/api/v1/logs/settings') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    const { saveLogSettings } = await import('@yanshekki/core');
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
    const { loadLogSettings } = await import('@yanshekki/core');
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
    const { addLogBookmark } = await import('@yanshekki/core');
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
    const { removeLogBookmark } = await import('@yanshekki/core');
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
    const { getLogrotateStatus } = await import('@yanshekki/core');
    sendJson(res, 200, await getLogrotateStatus(ctx.host));
    return true;
  }

  return false;
}
