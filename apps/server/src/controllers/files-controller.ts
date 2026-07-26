/**
 * File manager routes — ownCloud-style sandboxed API.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FileManager,
  publicFilesRoot,
  listFileShares,
  createFileShare,
  deleteFileShare,
  getShareByToken,
  verifySharePassword,
  bumpShareDownload,
  listFavorites,
  toggleFavorite,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';

function resolveRoot(ctx: AppContext, rootParam: string): { root: string; rootKey: string } {
  if (rootParam === 'public' || !rootParam) {
    return { root: publicFilesRoot(ctx.dataDir), rootKey: 'public' };
  }
  if (rootParam.startsWith('project:')) {
    const projectId = rootParam.slice('project:'.length);
    const proj = ctx.projects.get(projectId);
    return { root: proj.homeDir, rootKey: rootParam };
  }
  throw Object.assign(new Error('root must be public or project:<id>'), { httpStatus: 400 });
}

export async function handleFilesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Public share download (no auth)
  if (method === 'GET' && url.pathname.startsWith('/api/v1/public/files/')) {
    const token = url.pathname.split('/').pop() ?? '';
    const share = getShareByToken(ctx.db, token);
    if (!share) {
      sendJson(res, 404, { ok: false, message: '分享不存在或已過期' });
      return true;
    }
    const password = url.searchParams.get('password') ?? undefined;
    if (!verifySharePassword(share, password)) {
      sendJson(res, 401, { ok: false, message: '需要密碼', needPassword: true });
      return true;
    }
    try {
      const { root } = resolveRoot(ctx, share.root);
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
        message: e instanceof Error ? e.message : 'not found',
      });
    }
    return true;
  }

  if (!url.pathname.startsWith('/api/v1/files')) return false;

  // Authenticated routes
  const user = ctx.auth.authenticate(getBearer(req));
  const rootParam = url.searchParams.get('root') ?? 'public';
  let root: string;
  let rootKey: string;
  try {
    ({ root, rootKey } = resolveRoot(ctx, rootParam));
  } catch (e) {
    sendJson(res, 400, {
      ok: false,
      message: e instanceof Error ? e.message : 'invalid root',
    });
    return true;
  }
  const fm = new FileManager(root);

  if (method === 'GET' && url.pathname === '/api/v1/files') {
    const path = url.searchParams.get('path') ?? '.';
    const sort = (url.searchParams.get('sort') as 'name' | 'size' | 'mtime') || 'name';
    const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'asc';
    const q = url.searchParams.get('q') ?? undefined;
    const items = fm.list(path, { sort, order, q });
    const favs = new Set(listFavorites(ctx.db, rootKey).map((f) => f.path));
    const usage = fm.usage();
    sendJson(res, 200, {
      root: rootKey,
      path,
      items: items.map((i) => ({ ...i, favorite: favs.has(i.path) })),
      usage,
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/read') {
    const path = url.searchParams.get('path') ?? '';
    sendJson(res, 200, fm.readText(path));
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/download') {
    const path = url.searchParams.get('path') ?? '';
    try {
      const file = fm.readBinary(path);
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
        message: e instanceof Error ? e.message : 'not found',
      });
    }
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/stat') {
    const path = url.searchParams.get('path') ?? '';
    sendJson(res, 200, fm.stat(path));
    return true;
  }

  if (method === 'PUT' && url.pathname === '/api/v1/files/write') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; content?: string; base64?: string };
    if (!data.path) {
      sendJson(res, 400, { ok: false, message: 'path required' });
      return true;
    }
    const result = data.base64
      ? fm.writeBase64(data.path, data.base64)
      : fm.writeText(data.path, data.content ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'files.write',
      resource: data.path,
      detail: { root: rootKey, bytes: result.bytes },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/upload') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      dir?: string;
      files?: Array<{ name: string; base64: string }>;
    };
    const dir = (data.dir ?? '.').replace(/\/$/, '') || '.';
    const files = data.files ?? [];
    if (!files.length) {
      sendJson(res, 400, { ok: false, message: 'files required' });
      return true;
    }
    const results: Array<{ path: string; bytes: number }> = [];
    for (const f of files.slice(0, 50)) {
      const name = f.name.replace(/[/\\]/g, '');
      if (!name) continue;
      const path = dir === '.' ? name : `${dir}/${name}`;
      results.push(fm.writeBase64(path, f.base64));
    }
    ctx.audit.append({
      actor: user.username,
      action: 'files.upload',
      detail: { root: rootKey, count: results.length, dir },
      ok: true,
    });
    sendJson(res, 200, { ok: true, results });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/mkdir') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string };
    if (!data.path?.trim()) {
      sendJson(res, 400, { ok: false, message: 'path required' });
      return true;
    }
    const result = fm.mkdir(data.path.trim());
    ctx.audit.append({
      actor: user.username,
      action: 'files.mkdir',
      resource: data.path,
      detail: { root: rootKey },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/create-text') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; content?: string };
    if (!data.path?.trim()) {
      sendJson(res, 400, { ok: false, message: 'path required' });
      return true;
    }
    const result = fm.createTextFile(data.path.trim(), data.content ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'files.create_text',
      resource: data.path,
      detail: { root: rootKey },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'DELETE' && url.pathname === '/api/v1/files') {
    const path = url.searchParams.get('path') ?? '';
    const permanent = url.searchParams.get('permanent') === '1';
    const result = permanent ? fm.removePermanent(path) : fm.remove(path);
    ctx.audit.append({
      actor: user.username,
      action: permanent ? 'files.delete_permanent' : 'files.trash',
      resource: path,
      detail: { root: rootKey, ...result },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/rename') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: 'from and to required' });
      return true;
    }
    const result = fm.rename(data.from, data.to);
    ctx.audit.append({
      actor: user.username,
      action: 'files.rename',
      resource: data.from,
      detail: { root: rootKey, to: data.to },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/copy') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: 'from and to required' });
      return true;
    }
    const result = fm.copy(data.from, data.to);
    ctx.audit.append({
      actor: user.username,
      action: 'files.copy',
      resource: data.from,
      detail: { root: rootKey, to: data.to },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/move') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: 'from and to required' });
      return true;
    }
    const result = fm.move(data.from, data.to);
    ctx.audit.append({
      actor: user.username,
      action: 'files.move',
      resource: data.from,
      detail: { root: rootKey, to: data.to },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/chmod') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; mode?: string };
    if (!data.path || !data.mode) {
      sendJson(res, 400, { ok: false, message: 'path and mode required' });
      return true;
    }
    const result = fm.chmod(data.path, data.mode);
    ctx.audit.append({
      actor: user.username,
      action: 'files.chmod',
      resource: data.path,
      detail: { root: rootKey, mode: data.mode },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/zip') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { paths?: string[]; dest?: string };
    if (!data.paths?.length || !data.dest) {
      sendJson(res, 400, { ok: false, message: 'paths and dest required' });
      return true;
    }
    try {
      const result = fm.zip(data.paths, data.dest);
      ctx.audit.append({
        actor: user.username,
        action: 'files.zip',
        detail: { root: rootKey, ...result },
        ok: true,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/unzip') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { zipPath?: string; destDir?: string };
    if (!data.zipPath) {
      sendJson(res, 400, { ok: false, message: 'zipPath required' });
      return true;
    }
    try {
      const result = fm.unzip(data.zipPath, data.destDir ?? '.');
      ctx.audit.append({
        actor: user.username,
        action: 'files.unzip',
        detail: { root: rootKey, ...result },
        ok: true,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
    }
    return true;
  }

  // Trash
  if (method === 'GET' && url.pathname === '/api/v1/files/trash') {
    sendJson(res, 200, { items: fm.listTrash() });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/trash/restore') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { trashId?: string };
    if (!data.trashId) {
      sendJson(res, 400, { ok: false, message: 'trashId required' });
      return true;
    }
    const result = fm.restoreTrash(data.trashId);
    ctx.audit.append({
      actor: user.username,
      action: 'files.trash_restore',
      detail: { root: rootKey, ...result },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'DELETE' && url.pathname === '/api/v1/files/trash') {
    const trashId = url.searchParams.get('trashId') ?? undefined;
    const result = fm.purgeTrash(trashId ?? undefined);
    ctx.audit.append({
      actor: user.username,
      action: 'files.trash_purge',
      detail: { root: rootKey, ...result },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  // Shares
  if (method === 'GET' && url.pathname === '/api/v1/files/shares') {
    sendJson(res, 200, { items: listFileShares(ctx.db, rootKey) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/shares') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      path?: string;
      password?: string;
      expiresAt?: string;
    };
    if (!data.path) {
      sendJson(res, 400, { ok: false, message: 'path required' });
      return true;
    }
    // ensure file exists
    fm.stat(data.path);
    const share = createFileShare(ctx.db, {
      root: rootKey,
      path: data.path,
      password: data.password,
      expiresAt: data.expiresAt,
      createdBy: user.username,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'files.share_create',
      resource: data.path,
      detail: { id: share.id, token: share.token },
      ok: true,
    });
    sendJson(res, 201, {
      share: {
        ...share,
        passwordHash: undefined,
        url: `/api/v1/public/files/${share.token}`,
      },
    });
    return true;
  }
  if (method === 'DELETE' && url.pathname.startsWith('/api/v1/files/shares/')) {
    const id = url.pathname.split('/').pop() ?? '';
    const ok = deleteFileShare(ctx.db, id);
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  // Favorites
  if (method === 'GET' && url.pathname === '/api/v1/files/favorites') {
    sendJson(res, 200, { items: listFavorites(ctx.db, rootKey) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/favorites/toggle') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string };
    if (!data.path) {
      sendJson(res, 400, { ok: false, message: 'path required' });
      return true;
    }
    const r = toggleFavorite(ctx.db, rootKey, data.path);
    sendJson(res, 200, r);
    return true;
  }

  return false;
}
