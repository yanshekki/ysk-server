/**
 * Same-origin reverse proxy for the in-process BitTorrent tracker.
 *
 * HTTPS share pages cannot open mixed-content `ws://host:8000` — browser
 * WebTorrent only discovers peers via WebSocket trackers. Proxy:
 *   WS  /api/v1/public/bt-tracker  → ws://127.0.0.1:{httpPort}/
 *   HTTP /api/v1/public/bt-tracker/* → http://127.0.0.1:{httpPort}/*
 */
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import {
  loadBtTrackerSettings,
  isBtTrackerRunning,
  resolveTrackerLoopbackHost,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';

export const BT_TRACKER_PUBLIC_PREFIX = '/api/v1/public/bt-tracker';

function trackerSettings(ctx: AppContext) {
  try {
    return loadBtTrackerSettings(ctx.dataDir);
  } catch {
    return null;
  }
}

function trackerPort(ctx: AppContext): number {
  return trackerSettings(ctx)?.httpPort || 8000;
}

/** Upstream host for process-local proxy — panel listenHost, not a fake public IP. */
function trackerUpstreamHost(ctx: AppContext): string {
  const s = trackerSettings(ctx);
  return s ? resolveTrackerLoopbackHost(s) : '127.0.0.1';
}

/** HTTP reverse proxy (announce / scrape / stats). */
export async function handleBtTrackerPublicProxy(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith(BT_TRACKER_PUBLIC_PREFIX)) return false;

  // Allow CORS for share page / external clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (!isBtTrackerRunning()) {
    // Detached worker may still be up — still try proxy to configured port
  }

  const port = trackerPort(ctx);
  const upstreamHost = trackerUpstreamHost(ctx);
  const rest = url.pathname.slice(BT_TRACKER_PUBLIC_PREFIX.length) || '/';
  const targetPath = rest.startsWith('/') ? rest : `/${rest}`;
  const targetUrl = `http://${upstreamHost}:${port}${targetPath}${url.search}`;

  await new Promise<void>((resolve) => {
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: `${upstreamHost}:${port}`,
    };
    // Avoid hop-by-hop
    delete headers['connection'];
    delete headers['transfer-encoding'];
    delete headers['keep-alive'];
    delete headers['proxy-connection'];
    delete headers['upgrade'];

    const preq = httpRequest(
      targetUrl,
      {
        method: req.method,
        headers: headers as import('node:http').OutgoingHttpHeaders,
        timeout: 30_000,
      },
      (pres) => {
        const outHeaders = { ...pres.headers };
        // Ensure browser can read announce responses
        outHeaders['access-control-allow-origin'] = '*';
        res.writeHead(pres.statusCode || 502, outHeaders);
        pres.pipe(res);
        pres.on('end', () => resolve());
        pres.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('tracker proxy error');
          }
          resolve();
        });
      },
    );
    preq.on('error', (e) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            message: e instanceof Error ? e.message : 'tracker unreachable',
            hint: 'Start BT Tracker in the panel first',
          }),
        );
      }
      resolve();
    });
    preq.on('timeout', () => {
      preq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain' });
        res.end('tracker proxy timeout');
      }
      resolve();
    });
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(preq);
    } else {
      preq.end();
    }
  });
  return true;
}

/**
 * WebSocket upgrade proxy for browser WebTorrent peer discovery.
 * Client: wss://panel/api/v1/public/bt-tracker  →  ws://127.0.0.1:httpPort/
 */
export function attachBtTrackerWebSocketProxy(
  server: HttpServer | HttpsServer,
  ctx: AppContext,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      // Exact path or trailing slash only (not /announce)
      if (
        url.pathname !== BT_TRACKER_PUBLIC_PREFIX &&
        url.pathname !== `${BT_TRACKER_PUBLIC_PREFIX}/`
      ) {
        return;
      }

      const port = trackerPort(ctx);
      const upstreamHost = trackerUpstreamHost(ctx);
      wss.handleUpgrade(req, socket as Duplex, head, (clientWs) => {
        const upstream = new WebSocket(`ws://${upstreamHost}:${port}/`);

        const closeBoth = () => {
          try {
            clientWs.close();
          } catch {
            /* */
          }
          try {
            upstream.close();
          } catch {
            /* */
          }
        };

        upstream.on('open', () => {
          clientWs.on('message', (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });
            }
          });
          upstream.on('message', (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: isBinary });
            }
          });
        });

        clientWs.on('close', closeBoth);
        clientWs.on('error', closeBoth);
        upstream.on('close', closeBoth);
        upstream.on('error', () => {
          try {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1011, 'tracker upstream error');
            }
          } catch {
            /* */
          }
        });
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

/**
 * Browser-facing tracker announce URLs.
 * Prefer same-origin panel proxy (HTTPS-safe). Host comes from the request
 * (panel already reachable as hermes.ysk.hk:9287 etc.) — not a hard-coded IP.
 */
export function browserTrackerAnnounceUrls(reqHost: string, isHttps: boolean): string[] {
  const host = (reqHost || '').split(',')[0]?.trim();
  if (!host) return [];
  const scheme = isHttps ? 'wss' : 'ws';
  return [`${scheme}://${host}${BT_TRACKER_PUBLIC_PREFIX}`];
}
