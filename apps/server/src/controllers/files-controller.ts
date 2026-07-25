/**
 * File manager routes (sandboxed under dataDir/files/public or project home).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { FileManager, publicFilesRoot } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';

export async function handleFilesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/files')) return false;

  const user = ctx.auth.authenticate(getBearer(req));
  const rootParam = url.searchParams.get('root') ?? 'public';
  let root: string;
  if (rootParam === 'public') {
    root = publicFilesRoot(ctx.dataDir);
  } else if (rootParam.startsWith('project:')) {
    const projectId = rootParam.slice('project:'.length);
    const proj = ctx.projects.get(projectId);
    root = proj.homeDir;
  } else {
    sendJson(res, 400, { ok: false, message: 'root must be public or project:<id>' });
    return true;
  }
  const fm = new FileManager(root);

  if (method === 'GET' && url.pathname === '/api/v1/files') {
    const path = url.searchParams.get('path') ?? '.';
    sendJson(res, 200, { root: rootParam, path, items: fm.list(path) });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/files/read') {
    const path = url.searchParams.get('path') ?? '';
    sendJson(res, 200, fm.readText(path));
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
      detail: { root: rootParam, bytes: result.bytes },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/files/mkdir') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string };
    const result = fm.mkdir(data.path ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'files.mkdir',
      resource: data.path,
      detail: { root: rootParam },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'DELETE' && url.pathname === '/api/v1/files') {
    const path = url.searchParams.get('path') ?? '';
    const result = fm.remove(path);
    ctx.audit.append({
      actor: user.username,
      action: 'files.delete',
      resource: path,
      detail: { root: rootParam },
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  // ensure public root exists listing
  void join;
  return false;
}
