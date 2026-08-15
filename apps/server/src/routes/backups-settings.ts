/**
 * Backup settings + schedule install.
 * Extracted from backups.ts (Wave K2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleBackupsSettingsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/backups/settings') {
        ctx.auth.authenticate(getBearer(req));
        const {
          getBackupRemotePublic,
          getBackupExclusions,
          getResticSettingsPublic } = await import('ysk-server-core');
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
          getResticSettingsPublic } = await import('ysk-server-core');
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
      if (method === 'POST' && url.pathname === '/api/v1/backups/remote/test') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { remote?: Record<string, unknown> };
        const { testBackupRemote } = await import('ysk-server-core');
        const result = await testBackupRemote({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          overlay: data.remote as never,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'backup.remote.test',
          detail: { kind: result.kind, blocked: result.blocked },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/backups/schedule') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          schedule?: string;
          /** When true, also install managed crontab to host (needs EXECUTE) */
          install?: boolean;
        };
        const job = ctx.cron.ensureBackupSchedule(data.schedule ?? '0 3 * * *');
        let install: Awaited<ReturnType<typeof ctx.cron.installCrontab>> | undefined;
        if (data.install) {
          install = await ctx.cron.installCrontab(user.username);
        }
        const overallOk = data.install ? Boolean(install?.ok) : true;
        ctx.audit.append({
          actor: user.username,
          action: 'backup.schedule',
          detail: {
            jobId: job.id,
            schedule: job.schedule,
            install: Boolean(data.install),
            installOk: install?.ok ?? null,
          },
          ok: overallOk,
        });
        sendJson(res, overallOk ? 200 : 422, {
          ok: overallOk,
          job,
          install: install ?? null,
          notes: [
            tl('notes.auto.t0791', { v0: job.schedule, v1: job.command }),
            data.install
              ? install?.ok
                ? 'host crontab installed'
                : (install?.notes?.join('; ') ?? 'install failed')
              : tl('notes.auto.n0512'),
          ],
        });
        return true;
      }

  return false;
}
