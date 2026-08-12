/**
 * Project logs + log-dirs (Wave V3).
 * Extracted from projects-ops-data.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import {
  listProjectLogs,
  searchProjectLogs,
  tailProjectLog,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleProjectsOpsLogsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/logs$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const proj = ctx.projects.get(id);
    const extraDirs = proj.logExtraDirs ?? [];
    const nameFilter = url.searchParams.get('name') || undefined;
    const grep = url.searchParams.get('grep') || undefined;
    const files = listProjectLogs(proj.homeDir, {
      extraDirs,
      nameFilter });
    const { listProjectRelatedLogSources } = await import('ysk-server-core');
    const related = listProjectRelatedLogSources({
      projectId: proj.id,
      linuxUser: proj.linuxUser,
      runtime: proj.runtime,
      dataDir: ctx.dataDir,
      phpVersion: proj.runtimeVersion });
    const file = url.searchParams.get('file');
    if (file) {
      const lines = Number(url.searchParams.get('lines') ?? 200);
      sendJson(res, 200, {
        files,
        extraDirs,
        related,
        tail: tailProjectLog(
          proj.homeDir,
          file,
          Number.isFinite(lines) ? lines : 200,
          2 * 1024 * 1024,
          { extraDirs, grep },
        ) });
      return true;
    }
    if (grep) {
      const result = searchProjectLogs(proj.homeDir, {
        extraDirs,
        nameFilter,
        grep });
      sendJson(res, 200, {
        files: result.files,
        hits: result.hits,
        notes: result.notes,
        extraDirs,
        related });
      return true;
    }
    sendJson(res, 200, { files, extraDirs, related });
    return true;
  }
  if (
    method === 'PUT' &&
    url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/log-dirs$/)
  ) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    const raw = await readBody(req);
    let data: { dirs?: unknown } = {};
    try {
      data = raw ? (JSON.parse(raw) as { dirs?: unknown }) : {};
    } catch {
      sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
      return true;
    }
    const result = ctx.projects.setLogExtraDirs(
      id,
      (data.dirs as string[]) ?? [],
      user.username,
    );
    sendJson(res, 200, {
      ok: true,
      project: result.project,
      extraDirs: result.project.logExtraDirs ?? [],
      notes: result.notes });
    return true;
  }

  return false;
}
