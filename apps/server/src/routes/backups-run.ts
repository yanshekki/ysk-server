/**
 * Backup run / control-plane / restore (Wave T2).
 * Extracted from backups-core.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import {
  backupAllProjects,
  backupControlPlane,
  CONTROL_PLANE_BACKUP_ID,
  restoreControlPlaneBackup,
  restoreProjectBackup,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleBackupsRunRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/backups/control-plane') {
    const user = ctx.auth.authenticate(getBearer(req));
    // persist store before snapshot so archive is current
    ctx.db.persist();
    const r = await backupControlPlane({ host: ctx.host, dataDir: ctx.dataDir });
    ctx.settings.setJson('last_control_plane_backup', {
      at: new Date().toISOString(),
      ok: r.ok,
      archivePath: r.archivePath,
      bytes: r.bytes,
      notes: r.notes,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'backup.control_plane',
      detail: { ok: r.ok, archivePath: r.archivePath, bytes: r.bytes },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/backups/control-plane/restore') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      mode?: 'dry-run' | 'full';
      confirmPhrase?: string;
    };
    if (!data.name) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0049')] });
      return true;
    }
    const r = await restoreControlPlaneBackup({
      host: ctx.host,
      dataDir: ctx.dataDir,
      archiveName: data.name,
      mode: data.mode,
      confirmPhrase: data.confirmPhrase,
    });
    ctx.audit.append({
      actor: user.username,
      action:
        data.mode === 'full'
          ? 'backup.control_plane.restore'
          : 'backup.control_plane.restore.dry_run',
      detail: { name: data.name, mode: data.mode ?? 'dry-run', ok: r.ok },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/backups/run-all') {
    const user = ctx.auth.authenticate(getBearer(req));
    const projects = ctx.db.snapshot.projects;
    const { getBackupExclusions, pushBackupRemote, resticBackupProject, getResticSettings } =
      await import('ysk-server-core');
    const excludes = getBackupExclusions(ctx.db);
    const r = await backupAllProjects({
      host: ctx.host,
      dataDir: ctx.dataDir,
      projects: projects.map((p) => ({
        id: p.id,
        home_dir: p.home_dir,
        name: p.name })),
      excludes: excludes.length
        ? excludes
        : ['node_modules', '.git', 'vendor', '.cache'] });
    const sideNotes: string[] = [];
    const sideResults: Array<{
      projectId: string;
      kind: 'remote' | 'restic';
      ok: boolean;
      skipped?: boolean;
      notes: string[];
    }> = [];
    let sideOk = true;
    const resticOn = getResticSettings(ctx.db).enabled;
    for (const item of r.results) {
      if (item.ok && item.archivePath && !item.skipped) {
        const p = projects.find((x) => x.id === item.projectId);
        if (p) {
          p.last_backup_path = item.archivePath;
          p.last_backup_at = new Date().toISOString();
          p.updated_at = new Date().toISOString();
        }
        try {
          const sqlSidecar = item.archivePath.replace(/\.tar\.gz$/i, '.sql');
          const push = await pushBackupRemote({
            host: ctx.host,
            db: ctx.db,
            dataDir: ctx.dataDir,
            localArchivePath: item.archivePath,
            extraLocalPaths: item.includesDatabase ? [sqlSidecar] : [],
          });
          sideResults.push({
            projectId: item.projectId,
            kind: 'remote',
            ok: push.ok,
            skipped: push.skipped,
            notes: push.notes });
          sideNotes.push(
            ...push.notes.map((n) => `[remote ${item.projectId.slice(0, 8)}] ${n}`),
          );
          if (!push.skipped && !push.ok) sideOk = false;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sideOk = false;
          sideResults.push({
            projectId: item.projectId,
            kind: 'remote',
            ok: false,
            notes: [msg] });
          sideNotes.push(`[remote ${item.projectId.slice(0, 8)}] ${msg}`);
        }
        if (resticOn && p) {
          try {
            const rs = await resticBackupProject({
              host: ctx.host,
              dataDir: ctx.dataDir,
              db: ctx.db,
              projectId: p.id,
              homeDir: p.home_dir });
            sideResults.push({
              projectId: item.projectId,
              kind: 'restic',
              ok: rs.ok,
              skipped: rs.skipped,
              notes: rs.notes });
            sideNotes.push(
              ...rs.notes.map((n) => `[restic ${item.projectId.slice(0, 8)}] ${n}`),
            );
            if (!rs.skipped && !rs.ok) sideOk = false;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sideOk = false;
            sideResults.push({
              projectId: item.projectId,
              kind: 'restic',
              ok: false,
              notes: [msg] });
            sideNotes.push(`[restic ${item.projectId.slice(0, 8)}] ${msg}`);
          }
        }
      }
    }
    ctx.db.persist();
    const overallOk = r.ok && sideOk;
    const payload = {
      at: new Date().toISOString(),
      ...r,
      ok: overallOk,
      tarOk: r.ok,
      sideOk,
      sideResults,
      notes: [
        ...r.notes,
        ...sideNotes.slice(0, 40),
        !sideOk
          ? tl('notes.auto.n1482')
          : resticOn
            ? tl('notes.auto.n1486')
            : tl('notes.auto.n0412'),
      ] };
    ctx.settings.setJson('last_backup_run', payload);
    ctx.audit.append({
      actor: user.username,
      action: 'backup.run_all',
      detail: {
        ok: overallOk,
        tarOk: r.ok,
        sideOk,
        projectCount: projects.length,
        resultCount: r.results.length },
      ok: overallOk });
    sendJson(res, overallOk ? 200 : 422, payload);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/backups/restore') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      projectId?: string;
      name?: string;
      mode?: 'full' | 'web' | 'dry-run';
    };
    if (!data.projectId || !data.name) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0049')] });
      return true;
    }
    if (data.projectId === CONTROL_PLANE_BACKUP_ID) {
      const r = await restoreControlPlaneBackup({
        host: ctx.host,
        dataDir: ctx.dataDir,
        archiveName: data.name,
        mode: data.mode === 'full' ? 'full' : 'dry-run',
      });
      ctx.audit.append({
        actor: user.username,
        action:
          data.mode === 'full'
            ? 'backup.control_plane.restore'
            : 'backup.control_plane.restore.dry_run',
        detail: { name: data.name, mode: data.mode ?? 'dry-run', ok: r.ok },
        ok: r.ok,
      });
      sendOpsResult(res, r);
      return true;
    }
    const project = ctx.db.snapshot.projects.find((p) => p.id === data.projectId);
    if (!project) {
      sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0028')] });
      return true;
    }
    const r = await restoreProjectBackup({
      host: ctx.host,
      dataDir: ctx.dataDir,
      projectId: data.projectId,
      archiveName: data.name,
      homeDir: project.home_dir,
      linuxUser: project.linux_user,
      linuxGroup: project.linux_group || project.linux_user,
      mode: data.mode });
    ctx.audit.append({
      actor: user.username,
      action: 'backup.restore',
      resource: data.projectId,
      detail: { name: data.name, mode: data.mode ?? 'full', ...r },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
