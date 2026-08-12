/**
 * Dashboard summary, notifications, apply-audit — extracted from misc residual.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadSmtpRelaySettings, probeAllAgentRuntimes } from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import { requireUser } from '../http/handler.js';
import { sendJson } from '../http/util.js';

export async function handleDashboardRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/dashboard/summary') {
    requireUser(ctx, req);
    const projects = ctx.projects.list();
    const agentRuntimes = await probeAllAgentRuntimes(ctx.host);
    const lastDnsbl = ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run');
    const lastBackup = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
    const lastInventory = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
    const relay = ctx.settings.get('email.smtp_relay');
    sendJson(res, 200, {
      projects: {
        total: projects.length,
        running: projects.filter((p) => p.processStatus === 'running').length,
        items: projects.slice(0, 8).map((p) => ({
          id: p.id,
          name: p.name,
          processStatus: p.processStatus,
          port: p.port,
        })),
      },
      agents: {
        items: agentRuntimes.map((a) => ({
          kind: a.kind,
          name: a.name,
          status: a.status,
          unitActive: a.unitActive,
        })),
      },
      email: {
        domains: ctx.email.list().length,
        lastDnsbl: lastDnsbl ?? null,
        smtpRelay: relay ? JSON.parse(relay) : loadSmtpRelaySettings(ctx.dataDir),
      },
      ops: {
        lastBackup: lastBackup ?? null,
        lastInventory: lastInventory
          ? { at: lastInventory.at, count: lastInventory.count }
          : null,
        scheduler: ctx.scheduler.list(),
      },
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/notifications') {
    requireUser(ctx, req);
    const { collectNotifications } = await import('@yanshekki/core');
    const r = await collectNotifications({
      db: ctx.db,
      host: ctx.host,
      dataDir: ctx.dataDir,
      executeEnabled: ctx.host.executeEnabled(),
      lastBackup: ctx.settings.getJson<Record<string, unknown>>('last_backup_run'),
      lastDnsbl: ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run'),
    });
    sendJson(res, 200, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/apply-audit') {
    requireUser(ctx, req);
    const { auditApplyStatuses } = await import('@yanshekki/core');
    sendJson(res, 200, auditApplyStatuses(ctx.db));
    return true;
  }
  return false;
}
