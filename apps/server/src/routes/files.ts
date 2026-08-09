import { tl } from '@ysk/shared';
/**
 * File manager routes — ownCloud-style sandboxed API.
 * Project roots: after write, chown to project linuxUser when root+execute.
 * Authenticated file CRUD. Public/meta live in files-public / files-meta (Wave E1–E3).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FileManager,
  listFavorites,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { resolveRoot, chownProjectRels } from './files-shared.js';
import { handleFilesMetaSection } from './files-meta.js';

export async function handleFilesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // WebDAV + public share download → routes/files-public.ts (Wave E1)

  if (!url.pathname.startsWith('/api/v1/files')) return false;

  // Authenticated routes
  const user = ctx.auth.authenticate(getBearer(req));
  const rootParam = url.searchParams.get('root') ?? 'public';
  let root: string;
  let rootKey: string;
  let owner: { linuxUser: string; linuxGroup: string; homeDir: string } | undefined;
  try {
    ({ root, rootKey, owner } = resolveRoot(ctx, rootParam, { user }));
  } catch (e) {
    sendJson(res, 400, {
      ok: false,
      message: e instanceof Error ? e.message : tl('notes.auto.n1008') });
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
      usage });
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
        'Access-Control-Allow-Origin': '*' });
      res.end(file.buffer);
    } catch (e) {
      sendJson(res, 404, {
        ok: false,
        message: e instanceof Error ? e.message : tl('notes.notFound') });
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
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    const result = data.base64
      ? fm.writeBase64(data.path, data.base64)
      : fm.writeText(data.path, data.content ?? '');
    const own = await chownProjectRels(ctx, owner, [data.path]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.write',
      resource: data.path,
      detail: { root: rootKey, bytes: result.bytes, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned, ownershipNotes: own.notes });
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
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1428') });
      return true;
    }
    const results: Array<{ path: string; bytes: number }> = [];
    const paths: string[] = [];
    // Allow nested relative paths from folder drag-drop (e.g. photos/a.jpg)
    for (const f of files.slice(0, 200)) {
      const rel = String(f.name ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .join('/');
      if (!rel) continue;
      const path = dir === '.' ? rel : `${dir.replace(/\/$/, '')}/${rel}`;
      results.push(fm.writeBase64(path, f.base64));
      paths.push(path);
    }
    const own = await chownProjectRels(ctx, owner, paths);
    ctx.audit.append({
      actor: user.username,
      action: 'files.upload',
      detail: { root: rootKey, count: results.length, dir, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ok: true, results, chowned: own.chowned, ownershipNotes: own.notes });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/mkdir') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string };
    if (!data.path?.trim()) {
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    const result = fm.mkdir(data.path.trim());
    const own = await chownProjectRels(ctx, owner, [data.path.trim()]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.mkdir',
      resource: data.path,
      detail: { root: rootKey, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned, ownershipNotes: own.notes });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/create-text') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; content?: string };
    if (!data.path?.trim()) {
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    const result = fm.createTextFile(data.path.trim(), data.content ?? '');
    const own = await chownProjectRels(ctx, owner, [data.path.trim()]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.create_text',
      resource: data.path,
      detail: { root: rootKey, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned, ownershipNotes: own.notes });
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
      ok: true });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/rename') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: tl('notes.files.needSrcDst') });
      return true;
    }
    const result = fm.rename(data.from, data.to);
    const own = await chownProjectRels(ctx, owner, [data.to]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.rename',
      resource: data.from,
      detail: { root: rootKey, to: data.to, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/copy') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: tl('notes.files.needSrcDst') });
      return true;
    }
    const result = fm.copy(data.from, data.to);
    const own = await chownProjectRels(ctx, owner, [data.to]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.copy',
      resource: data.from,
      detail: { root: rootKey, to: data.to, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/move') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { from?: string; to?: string };
    if (!data.from || !data.to) {
      sendJson(res, 400, { ok: false, message: tl('notes.files.needSrcDst') });
      return true;
    }
    const result = fm.move(data.from, data.to);
    const own = await chownProjectRels(ctx, owner, [data.to]);
    ctx.audit.append({
      actor: user.username,
      action: 'files.move',
      resource: data.from,
      detail: { root: rootKey, to: data.to, chowned: own.chowned },
      ok: true });
    sendJson(res, 200, { ...result, chowned: own.chowned });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/chmod') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; mode?: string };
    if (!data.path || !data.mode) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1410') });
      return true;
    }
    const result = fm.chmod(data.path, data.mode);
    ctx.audit.append({
      actor: user.username,
      action: 'files.chmod',
      resource: data.path,
      detail: { root: rootKey, mode: data.mode },
      ok: true });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/zip') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { paths?: string[]; dest?: string };
    if (!data.paths?.length || !data.dest) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1412') });
      return true;
    }
    try {
      const result = fm.zip(data.paths, data.dest);
      ctx.audit.append({
        actor: user.username,
        action: 'files.zip',
        detail: { root: rootKey, ...result },
        ok: true });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)] });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/unzip') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { zipPath?: string; destDir?: string };
    if (!data.zipPath) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1404') });
      return true;
    }
    try {
      const result = fm.unzip(data.zipPath, data.destDir ?? '.');
      ctx.audit.append({
        actor: user.username,
        action: 'files.unzip',
        detail: { root: rootKey, ...result },
        ok: true });
      sendJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)] });
    }
    return true;
  }

  // trash/shares/favorites/versions/webdav settings → files-meta (Wave E2)
  if (await handleFilesMetaSection(ctx, req, res, url, method, { user, rootKey, fm })) {
    return true;
  }

  return false;
}
