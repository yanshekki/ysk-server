/**
 * System apply — systemd, service matrix/lifecycle, self-update (Wave R1).
 * Extracted from system-apply.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import {
  installControlPlaneSystemd,
  probeControlPlaneSystemd,
  getServiceMatrix,
  lifecycleServiceUnit,
  runSelfUpdate,
  scheduleYskServerRestart,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendJsonAndWait,
  sendOpsResult,
} from '../http/util.js';
import { sendMaybeStreamedOps, wantsSse } from '../http/sse-ops.js';

export async function handleSystemApplyServicesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/system/systemd/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { enable?: boolean };
    const cliPath = process.argv[1] ?? 'ysk-server';
    const result = await installControlPlaneSystemd({
      dataDir: ctx.dataDir,
      cliPath,
      host: ctx.host,
      enable: data.enable,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.systemd.install',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/systemd/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeControlPlaneSystemd(ctx.host, ctx.dataDir);
    sendJson(res, 200, status);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/services/matrix') {
    ctx.auth.authenticate(getBearer(req));
    const matrix = await getServiceMatrix(ctx.host);
    sendJson(res, 200, matrix);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/services/lifecycle') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      unit?: string;
      action?: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';
    };
    if (!data.unit || !data.action) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0458')] });
      return true;
    }
    const unitBase = String(data.unit).replace(/\.service$/, '');
    if (
      (data.action === 'start' || data.action === 'restart') &&
      unitBase === 'vsftpd'
    ) {
      const { loadFtpsSettings, resolveCertPaths, assertFtpStartAllowed } = await import(
        'ysk-server-core'
      );
      const settings = loadFtpsSettings(ctx.db);
      const certs = resolveCertPaths(ctx.dataDir, settings);
      const gate = assertFtpStartAllowed({
        settings,
        sslReady: Boolean(settings.sslEnable && certs.ok),
      });
      if (!gate.ok) {
        sendOpsResult(res, {
          ok: false,
          blocked: true,
          blockMessage: gate.blockMessage,
          notes: [gate.blockMessage],
        });
        return true;
      }
    }
    const result = await lifecycleServiceUnit(ctx.host, data.unit, data.action);
    // Reclaim / re-apply ysk-svc firewall rules when unit lifecycle changes
    if (
      result.ok &&
      (data.action === 'stop' || data.action === 'start' || data.action === 'restart')
    ) {
      try {
        const { syncServiceExposure, unitToExposureService } = await import('ysk-server-core');
        const mapped = unitToExposureService(data.unit!);
        if (mapped) {
          const reason = data.action === 'stop' ? 'stop' : 'start';
          const exp = await syncServiceExposure({
            host: ctx.host,
            dataDir: ctx.dataDir,
            serviceId: mapped.serviceId,
            ports: mapped.ports,
            reason,
            requireDecision: false,
          });
          if (exp.notes?.length) {
            result.notes = [...(result.notes ?? []), ...exp.notes.slice(0, 3)];
          }
        }
      } catch {
        /* non-fatal */
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.services.lifecycle',
      detail: { unit: data.unit, action: data.action, ...result },
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/updates/self/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; latest?: string; stream?: boolean };
    // Panel always applies unless explicitly dry-run
    const apply = data.apply !== false;
    let result: Awaited<ReturnType<typeof runSelfUpdate>> | undefined;
    const run = async (onLog?: (ev: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => void) => {
      result = await runSelfUpdate({
        currentVersion: VERSION,
        host: ctx.host,
        apply,
        latestOverride: data.latest,
        onLog,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'update.self.apply',
        detail: {
          applied: result.applied,
          ok: result.ok,
          checked: result.checked,
          updateAvailable: result.updateAvailable,
          channel: result.channel,
        },
        ok: result.ok,
      });
      const { commandResults: _cmds, ...payload } = result;
      void _cmds;
      if (result.applied && result.restarting) {
        onLog?.({ stream: 'status', line: 'restarting — stream will drop' });
      }
      return payload;
    };
    if (wantsSse(req, url, data as Record<string, unknown>)) {
      await sendMaybeStreamedOps({
        req,
        res,
        url,
        body: data as Record<string, unknown>,
        run: async (hooks) => run(hooks.onLog),
      });
    } else {
      const payload = await run();
      await sendJsonAndWait(
        res,
        result?.ok ? 200 : result?.checked === false ? 502 : 422,
        payload,
      );
    }
    if (result?.applied && result.restarting) {
      scheduleYskServerRestart(4_000);
    }
    return true;
  }

  return false;
}
