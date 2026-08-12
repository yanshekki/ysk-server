/**
 * WebSocket live surface for host-browse browser engine (screencast + input).
 */

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HostBrowseLiveTicketStore, StreamPresetId } from 'ysk-server-core';
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
    sendJson(ws, {
      t: 'err',
      code: 'LIVE_WS_FAIL',
      message: 'invalid or expired live ticket',
    });
    ws.close(4401, 'unauthorized');
    return;
  }

  const session = ctx.hostBrowse.store.get(rec.sessionId, rec.userId);
  if (!session || session.engine !== 'browser') {
    sendJson(ws, {
      t: 'err',
      code: 'SESSION_GONE',
      message: 'browser session not found',
    });
    ws.close(4404, 'not found');
    return;
  }

  try {
    await ctx.hostBrowse.ensureBrowserSession(rec.userId, rec.sessionId);
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      code: 'CHROME_LAUNCH',
      message: e instanceof Error ? e.message : 'failed to open browser',
    });
    ws.close(4503, 'chrome');
    return;
  }

  const handle = ctx.hostBrowse.browser.getHandle(rec.sessionId);
  sendJson(ws, {
    t: 'ready',
    sessionId: rec.sessionId,
    url: session.currentUrl,
    viewport: handle?.viewport ?? { w: 1280, h: 800 },
    stream: handle ? ctx.hostBrowse.browser.getStreamOptions(rec.sessionId) : null,
  });

  const onFrame = (frame: {
    mime: string;
    data: Buffer;
    width: number;
    height: number;
  }) => {
    if (ws.readyState !== ws.OPEN) return;
    sendJson(ws, {
      t: 'frame',
      mime: frame.mime,
      w: frame.width,
      h: frame.height,
      data: frame.data.toString('base64'),
      ts: Date.now(),
    });
  };

  try {
    const stream = await ctx.hostBrowse.browser.startScreencast(
      rec.sessionId,
      onFrame,
    );
    sendJson(ws, { t: 'stream_ok', stream });
  } catch (e) {
    sendJson(ws, {
      t: 'err',
      code: 'LIVE_NO_FRAME',
      message: e instanceof Error ? e.message : 'screencast failed',
    });
  }

  // Optional PCM audio bridge (panel setting audioBridge)
  try {
    const audioSt = await ctx.hostBrowse.browser.startAudioBridge(
      rec.sessionId,
      (chunk) => {
        if (ws.readyState !== ws.OPEN) return;
        sendJson(ws, {
          t: 'audio',
          mime: 'audio/pcm',
          encoding: 's16le',
          channels: chunk.channels,
          sampleRate: chunk.sampleRate,
          data: chunk.pcmB64,
          ts: Date.now(),
        });
      },
    );
    sendJson(ws, { t: 'audio_status', ...audioSt });
  } catch {
    sendJson(ws, {
      t: 'audio_status',
      enabled: false,
      active: false,
      reason: 'audio bridge start failed',
    });
  }

  if (session.currentUrl) {
    sendJson(ws, {
      t: 'meta',
      url: session.currentUrl,
      title: '',
    });
  }

  const pushTabs = async () => {
    try {
      const tabs = await ctx.hostBrowse.listTabs(rec.userId, rec.sessionId);
      sendJson(ws, { t: 'tabs', tabs });
    } catch {
      /* */
    }
  };
  void pushTabs();

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
          preset?: StreamPresetId;
          quality?: number;
          scale?: number;
          everyNthFrame?: number;
          maxWidthCap?: number;
          maxHeightCap?: number;
          pageId?: string;
          url?: string;
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
          const r = await ctx.hostBrowse.browser.resize(
            rec.sessionId,
            Number(msg.w),
            Number(msg.h),
            { restartCast: true },
          );
          sendJson(ws, {
            t: 'resize_ok',
            w: r.w,
            h: r.h,
            stream: r.stream,
          });
        } else if (kind === 'stream') {
          const stream = await ctx.hostBrowse.browser.setStreamOptions(
            rec.sessionId,
            {
              preset: msg.preset,
              quality: msg.quality,
              scale: msg.scale,
              everyNthFrame: msg.everyNthFrame,
              maxWidthCap: msg.maxWidthCap,
              maxHeightCap: msg.maxHeightCap,
            },
          );
          sendJson(ws, { t: 'stream_ok', stream });
        } else if (kind === 'reconnect_cast') {
          const stream = await ctx.hostBrowse.browser.startScreencast(
            rec.sessionId,
            onFrame,
          );
          sendJson(ws, { t: 'stream_ok', stream });
        } else if (kind === 'tab_open') {
          const r = await ctx.hostBrowse.openTab(
            rec.userId,
            rec.sessionId,
            msg.url,
          );
          sendJson(ws, { t: 'tabs', tabs: r.tabs, pageId: r.pageId });
        } else if (kind === 'tab_switch' && msg.pageId) {
          const r = await ctx.hostBrowse.switchTab(
            rec.userId,
            rec.sessionId,
            msg.pageId,
          );
          sendJson(ws, {
            t: 'tabs',
            tabs: r.tabs,
            pageId: r.pageId,
          });
          if (r.currentUrl) {
            sendJson(ws, { t: 'meta', url: r.currentUrl, title: r.title });
          }
        } else if (kind === 'tab_close' && msg.pageId) {
          const r = await ctx.hostBrowse.closeTab(
            rec.userId,
            rec.sessionId,
            msg.pageId,
          );
          sendJson(ws, {
            t: 'tabs',
            tabs: r.tabs,
            pageId: r.activePageId,
          });
          if (r.currentUrl) {
            sendJson(ws, { t: 'meta', url: r.currentUrl, title: '' });
          }
        } else if (kind === 'tabs_list') {
          await pushTabs();
        } else if (kind === 'ping') {
          sendJson(ws, { t: 'pong', ts: Date.now() });
        }
      } catch (e) {
        sendJson(ws, {
          t: 'err',
          code: 'INPUT_ERROR',
          message: e instanceof Error ? e.message : 'input error',
        });
      }
    })();
  });

  const cleanup = () => {
    void ctx.hostBrowse.browser.stopScreencast(rec.sessionId);
    void ctx.hostBrowse.browser.stopAudioBridge(rec.sessionId);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}
