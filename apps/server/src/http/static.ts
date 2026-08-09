/**
 * Serve packaged Web UI (SPA) from disk next to API.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve default web dist:
 * - YSK_WEB_ROOT env
 * - monorepo apps/web/dist relative to server package
 * - sibling web/dist for packaged installs
 */
export function resolveWebRoot(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return resolve(explicit);
  if (process.env.YSK_WEB_ROOT && existsSync(process.env.YSK_WEB_ROOT)) {
    return resolve(process.env.YSK_WEB_ROOT);
  }
  // apps/server/dist -> ../../../apps/web/dist (from dist/) or ../../web/dist
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    // Packaged next to server dist (install.sh copies web into apps/server/public/web)
    join(here, '../public/web'),
    join(here, '../../public/web'),
    join(here, '../../../web/dist'),
    join(here, '../../../../apps/web/dist'),
    join(process.cwd(), 'apps/web/dist'),
    join(process.cwd(), 'apps/server/public/web'),
    join(process.cwd(), 'web/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return resolve(c);
  }
  return null;
}

/**
 * Try to serve a static file or SPA index. Returns true if response was written.
 */
export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  urlPathname: string,
  webRoot: string | null,
): boolean {
  if (!webRoot) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  // Never hijack API / health
  if (urlPathname.startsWith('/api/') || urlPathname === '/health') return false;

  const safe = safeJoin(webRoot, urlPathname === '/' ? '/index.html' : urlPathname);
  if (safe && existsSync(safe) && statSync(safe).isFile()) {
    sendFile(res, safe, req.method === 'HEAD');
    return true;
  }

  // SPA fallback for client routes
  const index = join(webRoot, 'index.html');
  if (existsSync(index) && !urlPathname.includes('.')) {
    sendFile(res, index, req.method === 'HEAD');
    return true;
  }
  return false;
}

function safeJoin(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const cleaned = decoded.replace(/^\/+/, '');
  const full = normalize(join(root, cleaned));
  const rootResolved = resolve(root) + sep;
  if (!full.startsWith(rootResolved) && full !== resolve(root)) return null;
  return full;
}

function sendFile(res: ServerResponse, path: string, headOnly: boolean): void {
  const ext = extname(path).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const size = statSync(path).size;
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(path).pipe(res);
}
