/**
 * WebSocket upgrade handler for interactive terminal sessions.
 */

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  buildProjectSpawnPlan,
  buildRootSpawnPlan,
  type TerminalSpawnPlan,
  type TerminalTicketStore,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { openPtySession, type PtySession } from './pty-session.js';

const MAX_SESSIONS = 24;
const IDLE_MS = 30 * 60 * 1000;

type Live = {
  ws: WebSocket;
  pty: PtySession;
  actor: string;
  openedAt: number;
  lastActivity: number;
  idleTimer: ReturnType<typeof setInterval>;
};

const liveBySession = new Map<string, Live>();

export function attachTerminalWebSocket(
  server: HttpServer | HttpsServer,
  ctx: AppContext,
  tickets: TerminalTicketStore,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname !== '/api/v1/terminal/ws') {
        // Not our path — do not destroy; allow other handlers if added later
        return;
      }
      wss.handleUpgrade(req, socket as Duplex, head, (ws) => {
        void acceptTerminalClient(ctx, tickets, ws, url);
      });
    } catch {
      try {
        socket.destroy();
      } catch {
        /* */
      }
    }
  });
}

async function acceptTerminalClient(
  ctx: AppContext,
  tickets: TerminalTicketStore,
  ws: WebSocket,
  url: URL,
): Promise<void> {
  const ticket = url.searchParams.get('ticket') || '';
  const rec = tickets.consume(ticket);
  if (!rec) {
    sendJson(ws, { t: 'err', message: 'invalid or expired terminal ticket' });
    ws.close(4401, 'unauthorized');
    return;
  }

  if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
    sendJson(ws, {
      t: 'err',
      message: 'terminal requires root + YSK_EXECUTE',
    });
    ws.close(4403, 'forbidden');
    return;
  }

  if (liveBySession.size >= MAX_SESSIONS) {
    sendJson(ws, { t: 'err', message: 'too many terminal sessions' });
    ws.close(4429, 'busy');
    return;
  }

  let plan: TerminalSpawnPlan;
  try {
    if (rec.targetKey === 'root') {
      plan = buildRootSpawnPlan({ cols: rec.cols, rows: rec.rows });
    } else {
      const projectId = rec.projectId;
      if (!projectId || !rec.linuxUser) throw new Error('missing project target');
      const proj = ctx.db.snapshot.projects.find((p) => p.id === projectId) as
        | {
            id: string;
            name?: string;
            home_dir?: string;
            homeDir?: string;
            linux_user?: string;
          }
        | undefined;
      if (!proj) throw new Error('project not found');
      const home =
        String(proj.home_dir ?? proj.homeDir ?? '').trim() ||
        `/home/${rec.linuxUser}`;
      plan = buildProjectSpawnPlan({
        linuxUser: rec.linuxUser,
        homeDir: home,
        projectId,
        projectName: String(proj.name ?? projectId),
        cols: rec.cols,
        rows: rec.rows,
      });
    }
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      message: e instanceof Error ? e.message : 'bad target',
    });
    ws.close(4400, 'bad target');
    return;
  }

  let pty: PtySession;
  try {
    pty = await openPtySession(plan, {
      cols: rec.cols,
      rows: rec.rows,
      sessionId: rec.sessionId,
    });
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      message: e instanceof Error ? e.message : 'pty open failed',
    });
    ws.close(4500, 'pty failed');
    return;
  }

  const openedAt = Date.now();
  const live: Live = {
    ws,
    pty,
    actor: rec.actor,
    openedAt,
    lastActivity: openedAt,
    idleTimer: setInterval(() => {
      if (Date.now() - live.lastActivity > IDLE_MS) {
        cleanup(rec.sessionId, 'idle timeout');
      }
    }, 30_000),
  };
  liveBySession.set(rec.sessionId, live);

  ctx.audit.append({
    actor: rec.actor,
    action: 'terminal.open',
    detail: {
      sessionId: rec.sessionId,
      linuxUser: plan.linuxUser,
      kind: plan.kind,
      projectId: plan.projectId,
    },
    ok: true,
  });

  sendJson(ws, {
    t: 'ready',
    sessionId: rec.sessionId,
    user: plan.linuxUser,
    kind: plan.kind,
    projectId: plan.projectId,
  });

  pty.onData((data) => {
    live.lastActivity = Date.now();
    if (ws.readyState === ws.OPEN) {
      try {
        // Binary stdout for throughput
        ws.send(Buffer.from(data, 'utf8'), { binary: true });
      } catch {
        /* */
      }
    }
  });

  pty.onExit(({ exitCode, signal }) => {
    sendJson(ws, { t: 'exit', code: exitCode, signal });
    cleanup(rec.sessionId, 'exit', exitCode);
  });

  ws.on('message', (raw, isBinary) => {
    live.lastActivity = Date.now();
    try {
      if (isBinary) {
        pty.write(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
        return;
      }
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      // Control JSON or raw stdin text
      if (text.startsWith('{')) {
        const msg = JSON.parse(text) as {
          t?: string;
          cols?: number;
          rows?: number;
          d?: string;
        };
        if (msg.t === 'resize' && msg.cols && msg.rows) {
          pty.resize(msg.cols, msg.rows);
          return;
        }
        if (msg.t === 'in' && typeof msg.d === 'string') {
          pty.write(msg.d);
          return;
        }
        if (msg.t === 'ping') {
          sendJson(ws, { t: 'pong' });
          return;
        }
      }
      pty.write(text);
    } catch {
      /* ignore bad frames */
    }
  });

  ws.on('close', () => {
    cleanup(rec.sessionId, 'ws-close');
  });
  ws.on('error', () => {
    cleanup(rec.sessionId, 'ws-error');
  });

  function cleanup(sessionId: string, reason: string, exitCode?: number) {
    const cur = liveBySession.get(sessionId);
    if (!cur) return;
    liveBySession.delete(sessionId);
    clearInterval(cur.idleTimer);
    try {
      cur.pty.kill();
    } catch {
      /* */
    }
    try {
      if (cur.ws.readyState === cur.ws.OPEN) cur.ws.close();
    } catch {
      /* */
    }
    ctx.audit.append({
      actor: cur.actor,
      action: 'terminal.close',
      detail: {
        sessionId,
        reason,
        exitCode,
        durationMs: Date.now() - cur.openedAt,
        linuxUser: plan.linuxUser,
        projectId: plan.projectId,
      },
      ok: true,
    });
  }
}

function sendJson(ws: WebSocket, obj: unknown) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* */
    }
  }
}

/** Test/helper: active session count */
export function terminalLiveCount(): number {
  return liveBySession.size;
}
