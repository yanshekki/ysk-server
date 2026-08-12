/**
 * Terminal HTTP API — targets list + one-time WS tickets.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildProjectSpawnPlan,
  buildRootSpawnPlan,
  listTerminalTargets,
  type TerminalTicketStore,
} from '@ysk-server/core';
import { tl, YskError } from '@ysk-server/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';

export async function handleTerminalRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  tickets: TerminalTicketStore,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/terminal')) return false;

  if (method === 'GET' && url.pathname === '/api/v1/terminal/targets') {
    // Auth only — any panel user who can reach the page may list targets.
    // Opening a session is gated by settings.system + EXECUTE + root.
    const user = ctx.auth.authenticate(getBearer(req));
    const projects = (ctx.db.snapshot.projects ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name ?? p.id),
      linuxUser: String(
        (p as { linux_user?: string }).linux_user ??
          (p as { linuxUser?: string }).linuxUser ??
          '',
      ),
      homeDir: String(
        (p as { home_dir?: string }).home_dir ??
          (p as { homeDir?: string }).homeDir ??
          '',
      ),
      osProvisioned: Boolean(
        (p as { os_provisioned?: boolean }).os_provisioned ??
          (p as { osProvisioned?: boolean }).osProvisioned,
      ),
    }));
    const r = await listTerminalTargets({ host: ctx.host, projects });
    // Hint UI: root shell needs TOTP step-up when actor has 2FA enrolled
    const totp = ctx.auth.totpStatus(user.id);
    sendJson(res, 200, {
      ...r,
      rootNeedsStepUp: Boolean(totp.enabled),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/terminal/sessions') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: 'root' | { projectId?: string };
      cols?: number;
      rows?: number;
      /** TOTP / recovery for root shell step-up */
      totp?: string;
    };

    if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
      sendJson(res, 403, {
        ok: false,
        code: 'YSK_FORBIDDEN',
        message: tl('notes.auto.n0883'),
        notes: [
          'terminal requires control plane as root with YSK_EXECUTE=1',
        ],
      });
      return true;
    }

    const cols = Math.max(20, Math.min(500, Number(data.cols) || 120));
    const rows = Math.max(5, Math.min(200, Number(data.rows) || 32));

    let targetKey = 'root';
    let linuxUser = 'root';
    let projectId: string | undefined;
    let projectName: string | undefined;
    const isRootTarget = !data.target || data.target === 'root';

    if (!isRootTarget && data.target && data.target !== 'root') {
      const pid = String(data.target.projectId || '').trim();
      if (!pid) {
        sendJson(res, 400, {
          ok: false,
          message: 'projectId required',
        });
        return true;
      }
      const proj = (ctx.db.snapshot.projects ?? []).find((p) => p.id === pid);
      if (!proj) {
        sendJson(res, 404, { ok: false, message: 'project not found' });
        return true;
      }
      linuxUser = String(
        (proj as { linux_user?: string }).linux_user ??
          (proj as { linuxUser?: string }).linuxUser ??
          '',
      );
      const homeDir = String(
        (proj as { home_dir?: string }).home_dir ??
          (proj as { homeDir?: string }).homeDir ??
          '',
      );
      const osProvisioned = Boolean(
        (proj as { os_provisioned?: boolean }).os_provisioned ??
          (proj as { osProvisioned?: boolean }).osProvisioned,
      );
      if (!linuxUser || !osProvisioned) {
        sendJson(res, 400, {
          ok: false,
          message: 'project OS user not provisioned',
          notes: ['provision project Linux user first'],
        });
        return true;
      }
      // validate plan can be built
      buildProjectSpawnPlan({
        linuxUser,
        homeDir: homeDir || `/home/${linuxUser}`,
        projectId: pid,
        projectName: String(proj.name ?? pid),
        cols,
        rows,
      });
      targetKey = `project:${pid}`;
      projectId = pid;
      projectName = String(proj.name ?? pid);
    } else {
      // Root shell: require recent TOTP step-up when 2FA is enabled on the actor
      try {
        ctx.auth.requireStepUp(user.id, data.totp);
      } catch (e) {
        if (e instanceof YskError) {
          sendJson(res, e.httpStatus || 403, {
            ok: false,
            code: e.code,
            message: e.message,
            needsStepUp: true,
            details: { needsStepUp: true, target: 'root' },
          });
          return true;
        }
        throw e;
      }
      buildRootSpawnPlan({ cols, rows });
    }

    const ticket = tickets.issue({
      actor: user.username,
      actorUserId: user.id,
      targetKey,
      linuxUser,
      projectId,
      projectName,
      cols,
      rows,
    });

    ctx.audit.append({
      actor: user.username,
      action: 'terminal.ticket',
      detail: {
        sessionId: ticket.sessionId,
        targetKey,
        linuxUser,
        stepUp: isRootTarget,
      },
      ok: true,
    });

    sendJson(res, 200, {
      ok: true,
      sessionId: ticket.sessionId,
      ticket: ticket.ticket,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      linuxUser,
      targetKey,
      wsPath: `/api/v1/terminal/ws?ticket=${encodeURIComponent(ticket.ticket)}`,
    });
    return true;
  }

  return false;
}
