/**
 * WebDAV protocol + public share download (unauthenticated / Basic).
 * Extracted from files-controller (Wave E1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import {
  FileManager,
  getShareByToken,
  verifySharePassword,
  bumpShareDownload,
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
} from 'ysk-server-core';
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
    } = await import('ysk-server-core');
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
    const WEBDAV_PROPFIND_MAX = 500;
    const WEBDAV_PUT_MAX_BYTES = 50 * 1024 * 1024;
    if (method === 'OPTIONS' || method === 'PROPFIND') {
      const entries =
        method === 'PROPFIND'
          ? fm.list(rel || '.').slice(0, WEBDAV_PROPFIND_MAX).map((e) => ({
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
      let total = 0;
      for await (const c of req) {
        const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
        total += b.length;
        if (total > WEBDAV_PUT_MAX_BYTES) {
          sendJson(res, 413, {
            ok: false,
            message: tl('notes.auto.t0003', { v0: WEBDAV_PUT_MAX_BYTES }),
          });
          return true;
        }
        chunks.push(b);
      }
      const buf = Buffer.concat(chunks);
      fm.writeBase64(rel, buf.toString('base64'));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: rel, bytes: buf.length }));
      return true;
    }
    sendJson(res, 405, { ok: false, message: tl('notes.auto.n0497') });
    return true;
  }

  // Public share download / meta / torrent / bt-stats (no session; rate-limit password guesses)
  if (method === 'GET' && url.pathname.startsWith('/api/v1/public/files/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    // public/files/:token[/:action]
    const tokenIdx = parts.indexOf('files') + 1;
    const token = parts[tokenIdx] ?? '';
    const action = parts[tokenIdx + 1]; // torrent | meta | bt-stats | undefined
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
      recordRateLimitFailure('share-auth', shareRlKey, PUBLIC_AUTH_RL);
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0595') });
      return true;
    }
    const hdr =
      (typeof req.headers['x-share-password'] === 'string'
        ? req.headers['x-share-password']
        : undefined) ?? undefined;
    // Query password only on file/torrent GET (browser <a href>). JSON uses header.
    const queryOk = !action || action === 'download' || action === 'torrent';
    const queryPass = queryOk ? (url.searchParams.get('password') ?? undefined) : undefined;
    const password = hdr ?? queryPass;
    const needPass = Boolean(share.passwordHash);
    const authed = verifySharePassword(share, password);

    if (action === 'meta') {
      const unlocked = !needPass || authed;
      // Always rebuild magnet from live tracker settings so browser WebTorrent
      // gets a parseable URI + current announce host (fixes legacy bad magnets).
      let magnetUri: string | undefined;
      if (unlocked && share.infoHash) {
        try {
          const { loadBtTrackerSettings, rebuildShareMagnetUri } = await import(
            'ysk-server-core'
          );
          magnetUri = rebuildShareMagnetUri({
            infoHash: share.infoHash,
            name: share.path.split('/').pop(),
            settings: loadBtTrackerSettings(ctx.dataDir),
          });
        } catch {
          magnetUri = share.magnetUri;
        }
      } else if (unlocked) {
        magnetUri = share.magnetUri;
      }
      // Same-origin tracker for HTTPS share pages (mixed-content safe)
      let trackerWsUrl: string | undefined;
      let announce: string[] | undefined;
      if (unlocked && (share.infoHash || (share.downloadModes ?? []).includes('bt'))) {
        try {
          const { browserTrackerAnnounceUrls } = await import(
            '../bt-tracker/proxy.js'
          );
          const hostHdr = String(req.headers.host || '').trim();
          const isHttps =
            Boolean((req.socket as { encrypted?: boolean })?.encrypted) ||
            String(req.headers['x-forwarded-proto'] || '').includes('https');
          announce = browserTrackerAnnounceUrls(hostHdr, isHttps);
          trackerWsUrl = announce[0];
        } catch {
          /* optional */
        }
      }
      // Meta without password: only non-sensitive fields; magnet only when unlocked
      sendJson(res, 200, {
        ok: true,
        needPassword: needPass && !authed,
        name: share.path.split('/').pop(),
        downloadModes: share.downloadModes ?? ['direct'],
        hasBt: (share.downloadModes ?? []).includes('bt') || Boolean(share.infoHash),
        hasDirect: !(share.downloadModes?.length) || share.downloadModes.includes('direct'),
        seedStatus: share.seedStatus,
        expiresAt: share.expiresAt,
        infoHash: unlocked ? share.infoHash : undefined,
        magnetUri,
        torrentUrl:
          unlocked && (share.torrentRelPath || share.infoHash)
            ? `/api/v1/public/files/${token}/torrent`
            : undefined,
        /** Browser WebTorrent must use this (same-origin wss/ws proxy) */
        trackerWsUrl,
        announce,
      });
      return true;
    }

    if (!authed) {
      recordRateLimitFailure('share-auth', shareRlKey, PUBLIC_AUTH_RL);
      sendJson(res, 401, {
        ok: false,
        message: tl('notes.auto.n1577'),
        needPassword: true,
      });
      return true;
    }
    clearRateLimit('share-auth', shareRlKey);

    if (action === 'bt-stats') {
      const {
        collectBtShareStats,
        listBtTrackerTorrents,
      } = await import('ysk-server-core');
      const tr = share.infoHash
        ? listBtTrackerTorrents().find(
            (t) => t.infoHash.toLowerCase() === share.infoHash!.toLowerCase(),
          )
        : undefined;
      const stats = collectBtShareStats({
        share,
        trackerSeeders: tr?.seeders,
        trackerLeechers: tr?.leechers,
      });
      sendJson(res, 200, { ok: true, stats });
      return true;
    }

    if (action === 'torrent') {
      if (!share.torrentRelPath && !share.infoHash) {
        sendJson(res, 404, { ok: false, message: 'no torrent' });
        return true;
      }
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const abs = join(ctx.dataDir, share.torrentRelPath || '');
      if (!share.torrentRelPath || !existsSync(abs)) {
        sendJson(res, 404, { ok: false, message: 'torrent missing' });
        return true;
      }
      const buf = readFileSync(abs);
      const name = `${share.path.split('/').pop() || share.id}.torrent`;
      res.writeHead(200, {
        'Content-Type': 'application/x-bittorrent',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buf);
      return true;
    }

    // Direct download (default)
    const modes = share.downloadModes ?? ['direct'];
    if (modes.length && !modes.includes('direct') && modes.includes('bt')) {
      let magnetUri = share.magnetUri;
      try {
        const { loadBtTrackerSettings, rebuildShareMagnetUri } = await import(
          'ysk-server-core'
        );
        magnetUri =
          rebuildShareMagnetUri({
            infoHash: share.infoHash,
            name: share.path.split('/').pop(),
            settings: loadBtTrackerSettings(ctx.dataDir),
          }) || magnetUri;
      } catch {
        /* keep stored */
      }
      // BT-only share — no English error body; client shows BT actions only
      sendJson(res, 400, {
        ok: false,
        code: 'BT_ONLY',
        magnetUri,
        torrentUrl: `/api/v1/public/files/${token}/torrent`,
      });
      return true;
    }
    try {
      const { root } = resolveRoot(ctx, share.root, { skipCap: true });
      const fm = new FileManager(root);
      const file = fm.readBinary(share.path);
      bumpShareDownload(ctx.db, token);
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.buffer.length,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(file.buffer);
    } catch (e) {
      sendJson(res, 404, {
        ok: false,
        message: e instanceof Error ? e.message : tl('notes.notFound'),
      });
    }
    return true;
  }


  return false;
}
