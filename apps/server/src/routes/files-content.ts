/**
 * File content write/upload/mkdir/create/delete (Wave AA1).
 * Extracted from files-write.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { UserDto } from '@ysk/shared';
import type { FileManager } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson } from '../http/util.js';
import { chownProjectRels } from './files-shared.js';

export type FilesWriteCtx = {
  user: UserDto;
  rootKey: string;
  owner: { linuxUser: string; linuxGroup: string; homeDir: string } | undefined;
  fm: FileManager;
};

export async function handleFilesContentRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  auth: FilesWriteCtx,
): Promise<boolean> {
  const { user, rootKey, owner, fm } = auth;

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

  return false;
}
