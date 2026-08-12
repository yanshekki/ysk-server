/**
 * File FS ops — rename/copy/move/chmod/zip/unzip (Wave AA1).
 * Extracted from files-write.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk-server/shared';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson } from '../http/util.js';
import { chownProjectRels } from './files-shared.js';
import type { FilesWriteCtx } from './files-content.js';

export async function handleFilesFsOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  auth: FilesWriteCtx,
): Promise<boolean> {
  const { user, rootKey, owner, fm } = auth;

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

  return false;
}
