/**
 * Files trash / shares / favorites / versions / WebDAV control-plane.
 * Called after auth+root resolve from files-controller (Wave E2).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { UserDto } from 'ysk-server-shared';
import { join } from 'node:path';
import {
  FileManager,
  listFileShares,
  createFileShare,
  deleteFileShare,
  listFavorites,
  toggleFavorite,
  normalizeDownloadModes,
  prepareFileShareBt,
  shouldCreateTorrentAsync,
  enqueueShareTorrentJob,
  stopSeed,
  publicFilesRoot,
  getFileShareById,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson, sendOpsResult } from '../http/util.js';

export type FilesMetaCtx = {
  user: UserDto;
  rootKey: string;
  fm: FileManager;
};

export async function handleFilesMetaSection(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  meta: FilesMetaCtx,
): Promise<boolean> {
  const { user, rootKey, fm } = meta;

  // Trash
  if (method === 'GET' && url.pathname === '/api/v1/files/trash') {
    sendJson(res, 200, { items: fm.listTrash() });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/trash/restore') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { trashId?: string };
    if (!data.trashId) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1407') });
      return true;
    }
    const result = fm.restoreTrash(data.trashId);
    ctx.audit.append({
      actor: user.username,
      action: 'files.trash_restore',
      detail: { root: rootKey, ...result },
      ok: true });
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
      ok: true });
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
      downloadModes?: Array<'direct' | 'bt'> | string;
      mode?: string;
    };
    if (!data.path) {
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    const modes = normalizeDownloadModes(
      data.downloadModes ??
        (data.mode === 'bt'
          ? ['bt']
          : data.mode === 'both'
            ? ['direct', 'bt']
            : ['direct']),
    );
    // ensure file exists
    const entry = fm.stat(data.path);
    const contentAbs =
      rootKey === 'public' || !rootKey
        ? join(publicFilesRoot(ctx.dataDir), entry.path)
        : join(
            (() => {
              const projectId = rootKey.startsWith('project:')
                ? rootKey.slice('project:'.length)
                : '';
              return projectId
                ? ctx.projects.get(projectId).homeDir
                : publicFilesRoot(ctx.dataDir);
            })(),
            entry.path,
          );

    let share = createFileShare(ctx.db, {
      root: rootKey,
      path: data.path,
      password: data.password,
      expiresAt: data.expiresAt,
      createdBy: user.username,
      downloadModes: modes,
      seedStatus: modes.includes('bt') ? 'pending' : 'none',
    });

    const notes: string[] = [];
    let torrentJobId: string | undefined;
    if (modes.includes('bt')) {
      const sizeGate = shouldCreateTorrentAsync(contentAbs);
      if (sizeGate.async) {
        const job = enqueueShareTorrentJob({
          dataDir: ctx.dataDir,
          db: ctx.db,
          share,
          contentAbsPath: contentAbs,
          displayName: entry.name,
          estimatedBytes: sizeGate.estimatedBytes,
        });
        torrentJobId = job.id;
        notes.push(...job.notes);
        share = getFileShareById(ctx.db, share.id) ?? share;
      } else {
        const prepared = await prepareFileShareBt({
          dataDir: ctx.dataDir,
          db: ctx.db,
          share,
          contentAbsPath: contentAbs,
          displayName: entry.name,
        });
        share = prepared.share;
        notes.push(...prepared.notes);
      }
    }

    ctx.audit.append({
      actor: user.username,
      action: 'files.share_create',
      resource: data.path,
      detail: {
        id: share.id,
        token: share.token,
        downloadModes: modes,
        infoHash: share.infoHash,
      },
      ok: true,
    });
    sendJson(res, 201, {
      ok: true,
      notes,
      torrentJobId,
      share: {
        ...share,
        passwordHash: undefined,
        url: `/share/${share.token}`,
        torrentUrl: share.torrentRelPath
          ? `/api/v1/public/files/${share.token}/torrent`
          : undefined,
      },
    });
    return true;
  }
  if (method === 'DELETE' && url.pathname.startsWith('/api/v1/files/shares/')) {
    const id = url.pathname.split('/').pop() ?? '';
    const existing = getFileShareById(ctx.db, id);
    if (existing) await stopSeed(existing.id).catch(() => undefined);
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
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    const r = toggleFavorite(ctx.db, rootKey, data.path);
    sendJson(res, 200, r);
    return true;
  }

  // File versions
  if (method === 'GET' && url.pathname === '/api/v1/files/versions') {
    const path = url.searchParams.get('path') ?? '';
    if (!path) {
      sendJson(res, 400, { ok: false, message: tl('notes.needPath') });
      return true;
    }
    sendJson(res, 200, { items: fm.listVersions(path), path });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/versions/restore') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { path?: string; versionId?: string };
    if (!data.path || !data.versionId) {
      sendJson(res, 400, { ok: false, message: tl('notes.auto.n1411') });
      return true;
    }
    const r = fm.restoreVersion(data.path, data.versionId);
    ctx.audit.append({
      actor: user.username,
      action: 'files.version.restore',
      resource: data.path,
      detail: { versionId: data.versionId, ok: r.ok },
      ok: r.ok });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }

  // WebDAV settings (control plane)
  if (method === 'GET' && url.pathname === '/api/v1/files/webdav') {
    const { getWebDavSettings } = await import('ysk-server-core');
    const s = getWebDavSettings(ctx.db);
    sendJson(res, 200, {
      enabled: s.enabled,
      mountPath: s.mountPath,
      tokenId: s.tokenId,
      updated_at: s.updated_at });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/webdav/token') {
    const { issueWebDavToken } = await import('ysk-server-core');
    const r = issueWebDavToken(ctx.db);
    ctx.audit.append({
      actor: user.username,
      action: 'files.webdav.token',
      detail: { tokenId: r.settings.tokenId },
      ok: true });
    sendJson(res, 200, {
      ok: true,
      token: r.token,
      tokenId: r.settings.tokenId,
      mountPath: r.settings.mountPath,
      notes: r.notes });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/files/webdav/disable') {
    const { setWebDavSettings } = await import('ysk-server-core');
    setWebDavSettings(ctx.db, { enabled: false });
    sendJson(res, 200, { ok: true, enabled: false });
    return true;
  }


  return false;
}
