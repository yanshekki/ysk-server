/**
 * Backup list / status / download / delete (Wave T2).
 * Extracted from backups-core.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
import {
  listBackups,
  filterBackupList,
  deleteProjectBackup,
  resolveBackupDownloadPath,
  localizeLastBackupRun,
  CONTROL_PLANE_BACKUP_ID,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleBackupsListRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/backups') {
    ctx.auth.authenticate(getBearer(req));
    const rawLast = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
    const items = filterBackupList(listBackups(ctx.dataDir), {
      projectId: url.searchParams.get('projectId') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
    });
    sendJson(res, 200, {
      items,
      lastRun: localizeLastBackupRun(rawLast ?? null),
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/backups/status') {
    ctx.auth.authenticate(getBearer(req));
    const rawLast = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
    const items = listBackups(ctx.dataDir);
    const scheduleProbe = await ctx.cron.probeInstallStatus();
    const backupJobs = ctx.cron
      .list()
      .filter((j) => j.command.includes('ysk-backup-all') || j.command.includes('backup all'));
    sendJson(res, 200, {
      ok: true,
      dataDir: ctx.dataDir,
      archiveCount: items.length,
      controlPlaneCount: items.filter((x) => x.projectId === CONTROL_PLANE_BACKUP_ID).length,
      projectArchiveCount: items.filter((x) => x.projectId !== CONTROL_PLANE_BACKUP_ID).length,
      lastRun: localizeLastBackupRun(rawLast ?? null),
      scheduleJobs: backupJobs,
      schedule: scheduleProbe,
      notes: [
        scheduleProbe.hostHasYskEntries === true
          ? 'host crontab has ysk entries'
          : scheduleProbe.hostHasYskEntries === false
            ? 'host crontab missing ysk entries — install via POST /backups/schedule {install:true} or cron install'
            : 'could not probe host crontab',
        scheduleProbe.executeEnabled
          ? 'EXECUTE enabled'
          : 'EXECUTE off — schedule file written only (fail-closed)',
      ],
    });
    return true;
  }
  if (method === 'DELETE' && url.pathname === '/api/v1/backups') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { projectId?: string; name?: string };
    if (!data.projectId || !data.name) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0049')] });
      return true;
    }
    const r = deleteProjectBackup(ctx.dataDir, data.projectId, data.name);
    ctx.audit.append({
      actor: user.username,
      action: 'backup.delete',
      resource: data.projectId,
      detail: { name: data.name, ...r },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/backups/download') {
    ctx.auth.authenticate(getBearer(req));
    const projectId = url.searchParams.get('projectId') ?? '';
    const name = url.searchParams.get('name') ?? '';
    const r = resolveBackupDownloadPath(ctx.dataDir, projectId, name);
    if (!r.ok) {
      sendJson(res, 404, r);
      return true;
    }
    const { createReadStream, statSync } = await import('node:fs');
    const st = statSync(r.path);
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"` });
    createReadStream(r.path).pipe(res);
    return true;
  }

  return false;
}
