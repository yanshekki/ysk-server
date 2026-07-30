import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listBackups,
  backupAllProjects,
  restoreProjectBackup,
  deleteProjectBackup,
  resolveBackupDownloadPath,
  localizeLastBackupRun,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult } from '../http/util.js';

export async function handleBackupsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/backups') {
        ctx.auth.authenticate(getBearer(req));
        const rawLast = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
        sendJson(res, 200, {
          items: listBackups(ctx.dataDir),
          lastRun: localizeLastBackupRun(rawLast ?? null),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/run-all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const projects = ctx.db.snapshot.projects;
        const { getBackupExclusions, pushBackupRemote, resticBackupProject, getResticSettings } =
          await import('@ysk/core');
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
              const push = await pushBackupRemote({
                host: ctx.host,
                db: ctx.db,
                dataDir: ctx.dataDir,
                localArchivePath: item.archivePath });
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
      if (method === 'GET' && url.pathname === '/api/v1/backups/settings') {
        ctx.auth.authenticate(getBearer(req));
        const {
          getBackupRemotePublic,
          getBackupExclusions,
          getResticSettingsPublic } = await import('@ysk/core');
        sendJson(res, 200, {
          remote: getBackupRemotePublic(ctx.db),
          exclusions: getBackupExclusions(ctx.db),
          restic: getResticSettingsPublic(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/settings') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          remote?: Record<string, unknown>;
          exclusions?: string[];
          restic?: Record<string, unknown>;
        };
        const {
          setBackupRemote,
          setBackupExclusions,
          getBackupRemotePublic,
          getBackupExclusions,
          setResticSettings,
          getResticSettingsPublic } = await import('@ysk/core');
        if (data.remote) setBackupRemote(ctx.db, data.remote as never);
        if (data.exclusions) setBackupExclusions(ctx.db, data.exclusions);
        if (data.restic) setResticSettings(ctx.db, data.restic as never);
        ctx.audit.append({
          actor: user.username,
          action: 'backup.settings',
          detail: {
            hasRemote: Boolean(data.remote),
            exclusions: data.exclusions?.length,
            restic: Boolean(data.restic) },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          remote: getBackupRemotePublic(ctx.db),
          exclusions: getBackupExclusions(ctx.db),
          restic: getResticSettingsPublic(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/restic/run') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { resticBackupProject, getResticSettings } = await import('@ysk/core');
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
        const { listResticSnapshots } = await import('@ysk/core');
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
        const { resticRestoreProject } = await import('@ysk/core');
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
      if (method === 'POST' && url.pathname === '/api/v1/backups/schedule') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { schedule?: string };
        const job = ctx.cron.ensureBackupSchedule(data.schedule ?? '0 3 * * *');
        ctx.audit.append({
          actor: user.username,
          action: 'backup.schedule',
          detail: job,
          ok: true });
        sendJson(res, 200, {
          ok: true,
          job,
          notes: [
            tl('notes.auto.t0791', { v0: (job.schedule), v1: (job.command) }),
            tl('notes.auto.n0512'),
          ] });
        return true;
      }
  return false;
}
