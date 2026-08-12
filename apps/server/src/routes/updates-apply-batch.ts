/**
 * Bulk package apply-batch + SSE stream (Wave Q2).
 * Extracted from updates-apply.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tl } from '@yanshekki/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleUpdatesApplyBatchRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Bulk package apply (sequential, capped) ——
  if (method === 'POST' && url.pathname === '/api/v1/updates/apply-batch') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      packages?: Array<{
        packageName?: string;
        currentVersion?: string;
        candidateVersion?: string;
        risk?: string;
        requiresApproval?: boolean;
        cves?: string[];
        summary?: string;
      }>;
      confirmHighRisk?: boolean;
      stream?: boolean;
    };
    const { applyPackageUpdateBatch, adviseUpdate } = await import('@yanshekki/core');
    type BatchRow = {
      packageName: string;
      currentVersion: string;
      candidateVersion?: string;
      risk?: string;
      requiresApproval?: boolean;
      cves?: string[];
      summary?: string;
    };
    const packages = (data.packages ?? [])
      .filter(
        (p) =>
          p.packageName &&
          p.currentVersion &&
          p.candidateVersion &&
          p.candidateVersion !== p.currentVersion,
      )
      .slice(0, 40)
      .map((p) => ({
        packageName: String(p.packageName),
        currentVersion: String(p.currentVersion),
        candidateVersion: String(p.candidateVersion),
        risk: p.risk,
        requiresApproval: p.requiresApproval,
        cves: p.cves,
        summary: p.summary,
      }));

    if (!packages.length) {
      sendJson(res, 422, {
        ok: false,
        appliedCount: 0,
        failedCount: 0,
        results: [],
        notes: [tl('notes.auto.n0780')],
        blockMessage: tl('notes.auto.n1581'),
      });
      return true;
    }

    const toItem = (row: BatchRow) => {
      const item = adviseUpdate({
        packageName: row.packageName,
        currentVersion: row.currentVersion,
        candidateVersion: row.candidateVersion ?? row.currentVersion,
        knownCves: row.cves,
        hasSecurityFix: Boolean(row.cves?.length),
      });
      if (row.risk) (item as { risk: string }).risk = row.risk;
      if (row.requiresApproval != null) item.requiresApproval = row.requiresApproval;
      if (row.summary) item.summary = row.summary;
      return item;
    };

    const wantStream =
      data.stream === true ||
      String(req.headers.accept || '').includes('text/event-stream') ||
      url.searchParams.get('stream') === '1';

    if (wantStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`: ysk-updates-batch-stream\n\n`);
      let closed = false;
      const abortCtl = new AbortController();
      const send = (event: string, payload: unknown) => {
        if (closed || res.writableEnded) return;
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch {
          closed = true;
        }
      };
      req.on('close', () => {
        closed = true;
        try {
          abortCtl.abort();
        } catch {
          /* */
        }
      });
      send('status', { phase: 'running', total: packages.length });
      try {
        const batch = await applyPackageUpdateBatch({
          host: ctx.host,
          items: packages,
          confirmHighRisk: data.confirmHighRisk,
          toItem,
          abortSignal: abortCtl.signal,
          onLog: (ev) => {
            if (!closed)
              send('log', {
                stream: ev.stream,
                line: ev.line,
                at: new Date().toISOString(),
              });
          },
          onItemDone: (row) => {
            if (!closed) send('item', row);
          },
        });
        if (batch.appliedCount > 0) {
          try {
            ctx.settings.setJson('last_inventory', {
              at: new Date().toISOString(),
              stale: true,
              items: [],
              advice: [],
              sample: [],
              count: 0,
              upgradable: 0,
            });
          } catch {
            /* */
          }
        }
        ctx.audit.append({
          actor: user.username,
          action: 'update.package.apply-batch',
          detail: {
            ok: batch.ok,
            appliedCount: batch.appliedCount,
            failedCount: batch.failedCount,
            stream: true,
          },
          ok: batch.ok,
        });
        send('status', { phase: batch.ok ? 'done' : 'failed' });
        send('result', batch);
        send('end', { reason: 'complete', ok: batch.ok });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send('status', { phase: 'failed' });
        send('result', { ok: false, appliedCount: 0, failedCount: 0, notes: [message] });
        send('end', { reason: 'error', message });
      }
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* */
        }
      }
      return true;
    }

    const batch = await applyPackageUpdateBatch({
      host: ctx.host,
      items: packages,
      confirmHighRisk: data.confirmHighRisk,
      toItem,
    });

    for (const r of batch.results) {
      ctx.db.snapshot.update_jobs.unshift({
        id: randomUUID(),
        packageName: r.packageName,
        at: new Date().toISOString(),
        actor: user.username,
        ok: r.ok,
        applied: r.applied,
        notes: r.notes,
      } as never);
    }
    ctx.db.persist();
    ctx.audit.append({
      actor: user.username,
      action: 'update.package.apply_batch',
      detail: {
        count: packages.length,
        appliedCount: batch.appliedCount,
        failedCount: batch.failedCount,
        ok: batch.ok,
      },
      ok: batch.ok,
    });
    // Always mark inventory cache stale after batch so UI cannot re-show old upgrades
    if (batch.appliedCount > 0) {
      try {
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          stale: true,
          items: [],
          advice: [],
          sample: [],
          count: 0,
          upgradable: 0,
        });
      } catch {
        /* ignore */
      }
    }
    sendJson(res, batch.ok ? 200 : batch.appliedCount > 0 ? 207 : 422, batch);
    return true;
  }

  return false;
}
