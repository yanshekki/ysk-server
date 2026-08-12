/**
 * Single package apply + SSE stream (Wave Q2).
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
  sendOpsResult,
} from '../http/util.js';

export async function handleUpdatesApplySingleRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/updates/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      packageName?: string;
      currentVersion?: string;
      candidateVersion?: string;
      risk?: string;
      advice?: string;
      requiresApproval?: boolean;
      cves?: string[];
      summary?: string;
      confirmHighRisk?: boolean;
      stream?: boolean;
    };
    const { applyPackageUpdate, planUpdateExecution, adviseUpdate } = await import('@yanshekki/core');
    if (
      !data.candidateVersion ||
      !data.packageName ||
      data.candidateVersion === data.currentVersion
    ) {
      sendJson(res, 422, {
        ok: false,
        blocked: true,
        applied: false,
        blockMessage: tl('notes.auto.n1581'),
        notes: [tl('notes.auto.n0780')],
      });
      return true;
    }
    const item = adviseUpdate({
      packageName: data.packageName ?? '',
      currentVersion: data.currentVersion ?? '0',
      candidateVersion: data.candidateVersion,
      knownCves: data.cves,
      hasSecurityFix: Boolean(data.cves?.length),
    });
    // Preserve client risk signals when present
    if (data.risk) (item as { risk: string }).risk = data.risk;
    if (data.requiresApproval != null) item.requiresApproval = data.requiresApproval;
    if (data.summary) item.summary = data.summary;
    const plan = planUpdateExecution(item);
    const wantStream =
      Boolean((data as { stream?: boolean }).stream) ||
      String(req.headers.accept || '').includes('text/event-stream') ||
      url.searchParams.get('stream') === '1';

    const runApply = async (hooks?: {
      onLog?: (ev: { stream: 'stdout' | 'stderr'; line: string }) => void;
      abortSignal?: AbortSignal;
    }) => {
      const result = await applyPackageUpdate({
        host: ctx.host,
        item,
        confirmHighRisk: data.confirmHighRisk,
        onLog: hooks?.onLog,
        abortSignal: hooks?.abortSignal,
      });
      ctx.db.snapshot.update_jobs.unshift({
        id: randomUUID(),
        packageName: item.packageName,
        at: new Date().toISOString(),
        actor: user.username,
        ok: result.ok,
        applied: result.applied,
        notes: result.notes,
        plan,
      } as never);
      ctx.db.persist();
      ctx.audit.append({
        actor: user.username,
        action: 'update.package.apply',
        resource: item.packageName,
        detail: result,
        ok: result.ok,
      });
      if (result.ok && result.applied) {
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
      return result;
    };

    if (wantStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`: ysk-updates-apply-stream\n\n`);
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
      send('status', { phase: 'running', packageName: item.packageName });
      try {
        const result = await runApply({
          abortSignal: abortCtl.signal,
          onLog: (ev) => {
            if (!closed)
              send('log', {
                stream: ev.stream,
                line: ev.line,
                at: new Date().toISOString(),
              });
          },
        });
        send('status', {
          phase: result.blocked ? 'blocked' : result.ok ? 'done' : 'failed',
        });
        send('result', result);
        send('end', { reason: 'complete', ok: result.ok });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send('status', { phase: 'failed' });
        send('result', { ok: false, applied: false, notes: [message] });
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

    sendOpsResult(res, await runApply());
    return true;
  }

  return false;
}
