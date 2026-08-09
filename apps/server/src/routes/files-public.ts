/**
 * WebDAV protocol + public share download (unauthenticated / Basic).
 * Extracted from files-controller (Wave E1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  FileManager,
  getShareByToken,
  verifySharePassword,
  bumpShareDownload,
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { sendJson } from '../http/util.js';
import {
  PUBLIC_AUTH_RL,
  clientIp,
  resolveRoot,
} from './files-shared.js';

export async function handleFilesPublicRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Minimal WebDAV on /webdav/* (Basic ysk:token only)
  if (url.pathname === '/webdav' || url.pathname.startsWith('/webdav/')) {
    const {
      getWebDavSettings,
      verifyWebDavBasicAuth,
      buildPropfindResponse,
      publicFilesRoot,
      FileManager,
    } = await import('@ysk/core');
    const settings = getWebDavSettings(ctx.db);
    if (!settings.enabled) {
      sendJson(res, 503, { ok: false, message: tl('notes.auto.n0206') });
      return true;
    }
    const webdavRlKey = clientIp(req);
    const webdavGate = checkRateLimit('webdav-auth', webdavRlKey, PUBLIC_AUTH_RL);
    if (!webdavGate.ok) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(webdavGate.retryAfterSec),
      });
      res.end(
        JSON.stringify({
          ok: false,
          message: tl('notes.auto.n0960'),
          retryAfterSec: webdavGate.retryAfterSec,
        }),
      );
      return true;
    }
    if (!verifyWebDavBasicAuth(ctx.db, req.headers.authorization)) {
      recordRateLimitFailure('webdav-auth', webdavRlKey, PUBLIC_AUTH_RL);
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="YSK WebDAV"',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ ok: false, message: tl('notes.auto.n0960') }));
      return true;
    }
    clearRateLimit('webdav-auth', webdavRlKey);
    let rel =
      url.pathname === '/webdav' || url.pathname === '/webdav/'
        ? '.'
        : decodeURIComponent(url.pathname.replace(/^\/webdav\/?/, ''));
    // Reject null bytes / path segments that attempt traversal (defense in depth)
    if (
      rel.includes('\0') ||
      rel.split(/[/\\]/).some((seg) => seg === '..')
    ) {
      sendJson(res, 400, {
        ok: false,
        message: tl('notes.files.pathOutsideSandbox', { target: rel }),
      });
      return true;
    }
    const fm = new FileManager(publicFilesRoot(ctx.dataDir));
    if (method === 'OPTIONS' || method === 'PROPFIND') {
      const entries =
        method === 'PROPFIND'
          ? fm.list(rel || '.').map((e) => ({
              name: e.name,
              href: `/webdav/${e.path}`,
              isDir: e.type === 'dir',
              size: e.size,
              mtime: e.mtime }))
          : [];
      const xml = buildPropfindResponse({
        href: url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`,
        entries });
      res.writeHead(207, {
        'Content-Type': 'application/xml; charset=utf-8',
        DAV: '1,2',
        Allow: 'OPTIONS, GET, PUT, PROPFIND' });
      res.end(xml);
      return true;
    }
    if (method === 'GET') {
      try {
        const file = fm.readBinary(rel);
        res.writeHead(200, {
          'Content-Type': file.mime,
          'Content-Length': file.buffer.length });
        res.end(file.buffer);
      } catch (e) {
        sendJson(res, 404, { ok: false, message: e instanceof Error ? e.message : tl('notes.notFound') });
      }
      return true;
    }
    if (method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      const buf = Buffer.concat(chunks);
      fm.writeBase64(rel, buf.toString('base64'));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: rel, bytes: buf.length }));
      return true;
    }
    sendJson(res, 405, { ok: false, message: tl('notes.auto.n0497') });
    return true;
  }

  // Public share download (no session auth; rate-limit password guesses)
  if (method === 'GET' && url.pathname.startsWith('/api/v1/public/files/')) {
    const token = url.pathname.split('/').pop() ?? '';
    const shareRlKey = `${clientIp(req)}:${token.slice(0, 16)}`;
    const shareGate = checkRateLimit('share-auth', shareRlKey, PUBLIC_AUTH_RL);
    if (!shareGate.ok) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(shareGate.retryAfterSec),
      });
      res.end(
        JSON.stringify({
          ok: false,
          message: tl('notes.auto.n1577'),
          needPassword: true,
          retryAfterSec: shareGate.retryAfterSec,
        }),
      );
      return true;
    }
    const share = getShareByToken(ctx.db, token);
    if (!share) {
      // Count unknown tokens lightly to slow token scanning
      recordRateLimitFailure('share-auth', shareRlKey, PUBLIC_AUTH_RL);
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0595') });
      return true;
    }
    // Prefer header (not query — avoids access logs / Referer leak)
    const hdr =
      (typeof req.headers['x-share-password'] === 'string'
        ? req.headers['x-share-password']
        : undefined) ?? undefined;
    const password = hdr ?? url.searchParams.get('password') ?? undefined;
    if (!verifySharePassword(share, password)) {
      recordRateLimitFailure('share-auth', shareRlKey, PUBLIC_AUTH_RL);
      sendJson(res, 401, { ok: false, message: tl('notes.auto.n1577'), needPassword: true });
      return true;
    }
    clearRateLimit('share-auth', shareRlKey);
    try {
      const { root } = resolveRoot(ctx, share.root, { skipCap: true });
      const fm = new FileManager(root);
      const file = fm.readBinary(share.path);
      bumpShareDownload(ctx.db, token);
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.buffer.length,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Access-Control-Allow-Origin': '*' });
      res.end(file.buffer);
    } catch (e) {
      sendJson(res, 404, {
        ok: false,
        message: e instanceof Error ? e.message : tl('notes.notFound') });
    }
    return true;
  }


  return false;
}
