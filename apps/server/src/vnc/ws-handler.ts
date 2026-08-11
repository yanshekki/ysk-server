/**
 * WebSocket upgrade handler — browser VNC session.
 * Pipes binary RFB between the panel browser and a TCP RFB endpoint
 * (local TigerVNC or remote client target). Same role as websockify,
 * in-process so users never need 127.0.0.1:novnc in their browser.
 */

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { connect as netConnect, type Socket as NetSocket } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { VncSessionTicketStore } from '@ysk/core';
import type { AppContext } from '../app-context.js';

const MAX_SESSIONS = 16;
const IDLE_MS = 30 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 12_000;

type Live = {
  ws: WebSocket;
  tcp: NetSocket;
  sessionId: string;
  label: string;
  openedAt: number;
  lastActivity: number;
  idleTimer: ReturnType<typeof setInterval>;
};

const liveBySession = new Map<string, Live>();

export function attachVncWebSocket(
  server: HttpServer | HttpsServer,
  ctx: AppContext,
  tickets: VncSessionTicketStore,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname !== '/api/v1/vnc/ws') {
        return;
      }
      wss.handleUpgrade(req, socket as Duplex, head, (ws) => {
        void acceptVncClient(ctx, tickets, ws, url);
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

async function acceptVncClient(
  _ctx: AppContext,
  tickets: VncSessionTicketStore,
  ws: WebSocket,
  url: URL,
): Promise<void> {
  const ticket = url.searchParams.get('ticket') || '';
  const rec = tickets.consume(ticket);
  if (!rec) {
    ws.close(4401, 'unauthorized');
    return;
  }

  if (liveBySession.size >= MAX_SESSIONS) {
    ws.close(4429, 'busy');
    return;
  }

  let tcp: NetSocket;
  try {
    tcp = await openTcp(rec.rfbHost, rec.rfbPort);
  } catch (e) {
    const code = classifyTcpError(e, rec.rfbHost, rec.rfbPort);
    try {
      // reason is visible to browser CloseEvent.reason (≤123 UTF-8 bytes)
      ws.close(4502, code);
    } catch {
      /* */
    }
    return;
  }

  const live: Live = {
    ws,
    tcp,
    sessionId: rec.sessionId,
    label: rec.label,
    openedAt: Date.now(),
    lastActivity: Date.now(),
    idleTimer: setInterval(() => {
      const cur = liveBySession.get(rec.sessionId);
      if (!cur) return;
      if (Date.now() - cur.lastActivity > IDLE_MS) {
        cleanup(rec.sessionId, 4408, 'idle');
      }
    }, 30_000),
  };
  liveBySession.set(rec.sessionId, live);

  tcp.on('data', (buf) => {
    live.lastActivity = Date.now();
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(buf, { binary: true });
      } catch {
        cleanup(rec.sessionId, 1011, 'send failed');
      }
    }
  });
  tcp.on('error', () => cleanup(rec.sessionId, 1011, 'tcp error'));
  tcp.on('close', () => cleanup(rec.sessionId, 1000, 'tcp closed'));

  ws.on('message', (data, isBinary) => {
    live.lastActivity = Date.now();
    try {
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      if (!isBinary && typeof data === 'string') {
        // ignore text control frames
        return;
      }
      if (!tcp.destroyed) tcp.write(buf);
    } catch {
      cleanup(rec.sessionId, 1011, 'write failed');
    }
  });
  ws.on('close', () => cleanup(rec.sessionId, 1000, 'ws closed'));
  ws.on('error', () => cleanup(rec.sessionId, 1011, 'ws error'));
}

function openTcp(host: string, port: number): Promise<NetSocket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host, port }, () => {
      sock.setNoDelay(true);
      resolve(sock);
    });
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => {
      sock.destroy();
      reject(Object.assign(new Error(`timeout ${host}:${port}`), { code: 'ETIMEDOUT' }));
    });
    sock.on('error', (err) => reject(err));
  });
}

/** Stable short codes for browser i18n mapping (ws close reason). */
function classifyTcpError(e: unknown, host: string, port: number): string {
  const err = e as NodeJS.ErrnoException;
  const code = String(err?.code || '');
  if (code === 'ECONNREFUSED' || /refused/i.test(err?.message || '')) {
    return `rfb_refused:${host}:${port}`.slice(0, 120);
  }
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || /timeout/i.test(err?.message || '')) {
    return `rfb_timeout:${host}:${port}`.slice(0, 120);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `rfb_dns:${host}`.slice(0, 120);
  }
  if (code === 'ENETUNREACH') {
    return `rfb_net:${host}:${port}`.slice(0, 120);
  }
  return `rfb_error:${(err?.message || 'unknown').slice(0, 80)}`;
}

function cleanup(sessionId: string, code: number, reason: string): void {
  const live = liveBySession.get(sessionId);
  if (!live) return;
  liveBySession.delete(sessionId);
  try {
    clearInterval(live.idleTimer);
  } catch {
    /* */
  }
  try {
    if (!live.tcp.destroyed) live.tcp.destroy();
  } catch {
    /* */
  }
  try {
    if (
      live.ws.readyState === live.ws.OPEN ||
      live.ws.readyState === live.ws.CONNECTING
    ) {
      live.ws.close(code, reason.slice(0, 120));
    }
  } catch {
    /* */
  }
}
