/**
 * WebSocket live surface for host-browse browser engine (screencast + input).
 */

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HostBrowseLiveTicketStore } from '@ysk/core';
import type { AppContext } from '../app-context.js';

function sendJson(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function attachHostBrowseWebSocket(
  server: HttpServer | HttpsServer,
  ctx: AppContext,
  tickets: HostBrowseLiveTicketStore,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname !== '/api/v1/host-browse/ws') {
        return;
      }
      wss.handleUpgrade(req, socket as Duplex, head, (ws) => {
        void acceptLiveClient(ctx, tickets, ws, url);
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

async function acceptLiveClient(
  ctx: AppContext,
  tickets: HostBrowseLiveTicketStore,
  ws: WebSocket,
  url: URL,
): Promise<void> {
  const ticket = url.searchParams.get('ticket') || '';
  const rec = tickets.consume(ticket);
  if (!rec) {
    sendJson(ws, { t: 'err', message: 'invalid or expired live ticket' });
    ws.close(4401, 'unauthorized');
    return;
  }

  const session = ctx.hostBrowse.store.get(rec.sessionId, rec.userId);
  if (!session || session.engine !== 'browser') {
    sendJson(ws, { t: 'err', message: 'browser session not found' });
    ws.close(4404, 'not found');
    return;
  }

  try {
    await ctx.hostBrowse.browser.openSession({
      sessionId: rec.sessionId,
      userId: rec.userId,
      mode: session.mode,
    });
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      message: e instanceof Error ? e.message : 'failed to open browser',
    });
    ws.close(4503, 'chrome');
    return;
  }

  sendJson(ws, {
    t: 'ready',
    sessionId: rec.sessionId,
    url: session.currentUrl,
  });

  // Stream frames
  try {
    await ctx.hostBrowse.browser.startScreencast(rec.sessionId, (frame) => {
      if (ws.readyState !== ws.OPEN) return;
      // binary protocol: JSON meta then base64 in JSON for simplicity
      sendJson(ws, {
        t: 'frame',
        mime: frame.mime,
        w: frame.width,
        h: frame.height,
        data: frame.data.toString('base64'),
      });
    });
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      message: e instanceof Error ? e.message : 'screencast failed',
    });
  }

  // Push initial meta
  if (session.currentUrl) {
    sendJson(ws, {
      t: 'meta',
      url: session.currentUrl,
      title: '',
    });
  }

  ws.on('message', (data) => {
    void (async () => {
      try {
        const msg = JSON.parse(String(data)) as {
          t?: string;
          type?: string;
          x?: number;
          y?: number;
          button?: 'left' | 'right' | 'middle';
          deltaX?: number;
          deltaY?: number;
          key?: string;
          text?: string;
          w?: number;
          h?: number;
        };
        const kind = msg.t || msg.type;
        if (kind === 'mouse' && msg.type) {
          await ctx.hostBrowse.browser.mouse(rec.sessionId, {
            type: msg.type as 'move' | 'down' | 'up' | 'click' | 'wheel',
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            button: msg.button,
            deltaX: msg.deltaX,
            deltaY: msg.deltaY,
          });
        } else if (kind === 'mouse' && !msg.type) {
          // default click
          await ctx.hostBrowse.browser.mouse(rec.sessionId, {
            type: 'click',
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            button: msg.button,
          });
        } else if (kind === 'key') {
          await ctx.hostBrowse.browser.keyboard(rec.sessionId, {
            type: (msg.type as 'down' | 'up' | 'press' | 'type') || 'press',
            key: msg.key,
            text: msg.text,
          });
        } else if (kind === 'resize' && msg.w && msg.h) {
          await ctx.hostBrowse.browser.resize(rec.sessionId, msg.w, msg.h);
        } else if (kind === 'ping') {
          sendJson(ws, { t: 'pong' });
        }
      } catch (e) {
        sendJson(ws, {
          t: 'err',
          message: e instanceof Error ? e.message : 'input error',
        });
      }
    })();
  });

  const cleanup = () => {
    void ctx.hostBrowse.browser.stopScreencast(rec.sessionId);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
