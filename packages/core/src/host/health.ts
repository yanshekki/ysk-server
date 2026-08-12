import { tl } from '@ysk-server/shared';
/**
 * Port / HTTP health helpers for real process deploy verification.
 */

import net from 'node:net';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if something accepts TCP on host:port. */
export function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Find a free TCP port in [from, to] on localhost. */
export async function findFreePort(from = 3100, to = 3999): Promise<number> {
  for (let port = from; port <= to; port++) {
    const busy = await isPortListening(port, '127.0.0.1', 150);
    if (!busy) {
      // double-check by binding briefly
      const free = await canBind(port);
      if (free) return port;
    }
  }
  throw new Error(tl('notes.auto.t0100', { v0: (from), v1: (to) }));
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export interface HttpHealthResult {
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
  ms: number;
  url: string;
}

/**
 * Poll HTTP GET until the app responds or timeout.
 *
 * @param opts.acceptRedirect — treat 3xx as healthy without following (needed when
 *   Roundcube/nginx force_https redirects loopback health checks to public HTTPS
 *   that is not ready yet). Default false keeps strict 2xx for callers that need it.
 */
export async function waitHttpOk(
  url: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    /** Accept 3xx without following redirects (deploy health). */
    acceptRedirect?: boolean;
  } = {},
): Promise<HttpHealthResult> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const intervalMs = opts.intervalMs ?? 250;
  const acceptRedirect = opts.acceptRedirect === true;
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastErr = '';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2_000),
        headers: { Accept: 'text/plain,*/*' },
        // Manual: do not chase force_https → https://public-host (often fails on loopback)
        redirect: acceptRedirect ? 'manual' : 'follow',
      });
      const body = await res.text().catch(() => '');
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          body: body.slice(0, 512),
          ms: Date.now() - start,
          url,
        };
      }
      if (acceptRedirect && res.status >= 300 && res.status < 400) {
        return {
          ok: true,
          status: res.status,
          body: body.slice(0, 512),
          ms: Date.now() - start,
          url,
        };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    error: lastErr || 'timeout',
    ms: Date.now() - start,
    url,
  };
}

/** Single-shot health check (no retry). */
export async function checkHttp(url: string): Promise<HttpHealthResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3_000),
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body: body.slice(0, 512),
      ms: Date.now() - start,
      url,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - start,
      url,
    };
  }
}
