/**
 * Shared HTTP helpers for control-plane handlers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from '@ysk/shared';

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  });
  res.end(payload);
}

export function getBearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice('Bearer '.length).trim();
}

export function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof YskError) {
    sendJson(res, err.httpStatus, {
      ok: false,
      code: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  sendJson(res, 500, { ok: false, code: 'YSK_INTERNAL', message });
}
