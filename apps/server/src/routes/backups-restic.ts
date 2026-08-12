/**
 * Restic incremental backup/restore.
 * Extracted from backups.ts (Wave K2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleBackupsResticRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/backups/restic/run') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { resticBackupProject, getResticSettings } = await import('@yanshekki/core');
        const rs = getResticSettings(ctx.db);
        if (!rs.enabled) {
          sendJson(res, 422, {
            ok: false,
            notes: [tl('notes.auto.n0411')],
            results: [] });
          return true;
        }
        if (!rs.password?.trim()) {
          sendJson(res, 422, {
            ok: false,
            notes: [tl('notes.backup.resticNoPassword')],
            results: [] });
          return true;
        }
        const projects = ctx.db.snapshot.projects.slice(0, 40);
        if (projects.length === 0) {
          sendJson(res, 200, {
            ok: true,
            empty: true,
            notes: [tl('notes.auto.n1049')],
            results: [] });
          return true;
        }
        const results = [];
        for (const p of projects) {
          results.push({
            projectId: p.id,
            ...(await resticBackupProject({
              host: ctx.host,
              dataDir: ctx.dataDir,
              db: ctx.db,
              projectId: p.id,
              homeDir: p.home_dir })) });
        }
        const attempted = results.filter((row) => !row.skipped);
        const ok =
          attempted.length === 0 ? true : attempted.every((row) => row.ok);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.restic.run',
          detail: { count: results.length, ok },
          ok });
        sendJson(res, ok ? 200 : 422, {
          ok,
          results,
          notes: [
            tl('notes.auto.t0790', { v0: (attempted.filter((x) => x.ok).length), v1: (attempted.length) }),
            ok ? tl('notes.auto.n0010') : tl('notes.tpl.someFailed'),
          ] });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/backups/restic/snapshots') {
        ctx.auth.authenticate(getBearer(req));
        const projectId = url.searchParams.get('projectId') ?? undefined;
        const { listResticSnapshots } = await import('@yanshekki/core');
        const r = await listResticSnapshots({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          projectId });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/restic/restore') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          snapshotId?: string;
          targetDir?: string;
          overwriteHome?: boolean;
          confirmPhrase?: string;
          dryRun?: boolean;
        };
        const p = ctx.db.snapshot.projects.find((x) => x.id === data.projectId);
        if (!p) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0687')] });
          return true;
        }
        const { resticRestoreProject } = await import('@yanshekki/core');
        const r = await resticRestoreProject({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          projectId: p.id,
          homeDir: p.home_dir,
          snapshotId: data.snapshotId ?? '',
          targetDir: data.targetDir,
          overwriteHome: data.overwriteHome,
          confirmPhrase: data.confirmPhrase,
          dryRun: data.dryRun });
        ctx.audit.append({
          actor: user.username,
          action: data.dryRun ? 'backup.restic.restore.dry_run' : 'backup.restic.restore',
          resource: p.id,
          detail: {
            ok: r.ok,
            dryRun: Boolean(data.dryRun),
            overwriteHome: Boolean(data.overwriteHome),
            notes: r.notes },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }

  return false;
}
