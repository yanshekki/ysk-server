/**
 * System apply + protection routes extracted for modularity.
 * (Main router still may handle some; this owns /api/v1/system/* and protection probe helpers.)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { SystemRole } from '@ysk/shared';
import {
  applyEmailStack,
  applyLetsEncrypt,
  applyPhpHosting,
  applyFtps,
  applyFirewall,
  applyNginxSite,
  installControlPlaneSystemd,
  runProtectionProbes,
  getPlaybook,
  runSelfUpdate,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { applyProtection } from '../app-context.js';
import { getBearer, readBody, sendJson } from '../http/util.js';
import { VERSION } from '../version.js';

export async function handleSystemRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Files handled elsewhere; system + protection here
  if (method === 'POST' && url.pathname === '/api/v1/protection/probe') {
    const user = ctx.auth.authenticate(getBearer(req));
    const probe = await ctx.runAutoProtection();
    ctx.audit.append({
      actor: user.username,
      action: 'protection.probe',
      detail: probe,
      ok: true,
    });
    sendJson(res, 200, probe);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/protection/status') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, {
      protection: ctx.protection,
      scheduler: ctx.scheduler.list(),
      lastProbe: ctx.settings.getJson('last_protection_probe') ?? null,
      lastInventory: ctx.settings.getJson('last_inventory') ?? null,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/protection/emergency') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { playbookId?: string };
    const probe = await runProtectionProbes({
      requestCountLastMinute: ctx.requestHits.length,
    });
    applyProtection(ctx, probe.protection);
    const playbookId = data.playbookId ?? probe.suggestedPlaybooks[0]?.id ?? 'local-llm-ops-only';
    let runResult: unknown = null;
    try {
      const pb = getPlaybook(playbookId);
      const task = await ctx.ai.create(`emergency:${pb.id}`, user.username, false);
      task.steps = pb.steps.map((s) => {
        const ev = ctx.allowlist.evaluate(s.tool);
        return {
          id: randomUUID(),
          tool: s.tool,
          args: s.args,
          risk: ev.risk,
          requiresApproval: ev.requiresApproval,
          status: 'planned' as const,
        };
      });
      const tasks = ctx.db.snapshot.ai_tasks as unknown as Array<{ id: string }>;
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task as never;
      ctx.db.persist();
      ctx.ai.approve(task.id, user.username);
      runResult = await ctx.ai.execute(task.id, user.username, user.roles as SystemRole[]);
    } catch (e) {
      runResult = { error: e instanceof Error ? e.message : String(e), playbookId };
    }
    sendJson(res, 200, { probe, playbookId, run: runResult });
    return true;
  }

  if (!url.pathname.startsWith('/api/v1/system/') && url.pathname !== '/api/v1/updates/self/apply') {
    return false;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/email/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      installPackages?: boolean;
      domainId?: string;
    };
    const domain = data.domain ?? 'example.com';
    const result = await applyEmailStack({
      dataDir: ctx.dataDir,
      domain,
      host: ctx.host,
      installPackages: data.installPackages,
    });
    // Write-back apply status onto matching email domain record (durable)
    const applyStatus = {
      status: result.ok ? 'applied' : 'failed',
      ok: result.ok,
      at: new Date().toISOString(),
      written: result.written,
      notes: result.notes,
      actor: user.username,
    };
    const emailRows = ctx.db.snapshot.email_domains as Array<Record<string, unknown>>;
    const match = emailRows.find(
      (e) =>
        (data.domainId && e.id === data.domainId) ||
        String(e.domain ?? '').toLowerCase() === domain.toLowerCase(),
    );
    if (match) {
      match.apply_status = applyStatus.status;
      match.last_apply = { ...applyStatus, serviceStatus: result.serviceStatus };
      match.updated_at = applyStatus.at;
      ctx.db.persist();
      if (typeof match.id === 'string') {
        ctx.email.markApplyStatus(match.id, {
          ok: result.ok,
          notes: result.notes,
          serviceStatus: result.serviceStatus,
        });
      }
    } else {
      // still record standalone apply job under settings for visibility
      ctx.settings.set(
        `email.apply.${domain}`,
        JSON.stringify({ ...applyStatus, serviceStatus: result.serviceStatus }),
      );
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.email.apply',
      detail: { ...result, applyStatus, domainId: match?.id },
      ok: result.ok,
    });
    sendJson(res, 200, {
      ...result,
      applyStatus,
      domainId: match?.id ?? null,
      serviceStatus: result.serviceStatus,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/ssl/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { domain?: string; email?: string; run?: boolean };
    const domain = data.domain ?? 'example.com';
    const result = await applyLetsEncrypt({
      domain,
      email: data.email ?? 'admin@example.com',
      host: ctx.host,
      run: data.run,
    });
    const now = new Date().toISOString();
    const certRow = {
      id: `cert-${domain}-${Date.now()}`,
      domain,
      email: data.email ?? 'admin@example.com',
      provider: 'letsencrypt',
      apply_status: result.ok ? (data.run ? 'issued_or_planned' : 'planned') : 'failed',
      ok: result.ok,
      commands: result.commands,
      notes: result.notes,
      commandResults: result.commandResults,
      created_at: now,
      updated_at: now,
      actor: user.username,
    };
    ctx.db.snapshot.certificates.unshift(certRow);
    // keep last 50
    if (ctx.db.snapshot.certificates.length > 50) {
      ctx.db.snapshot.certificates = ctx.db.snapshot.certificates.slice(0, 50);
    }
    ctx.db.persist();
    ctx.audit.append({
      actor: user.username,
      action: 'system.ssl.apply',
      detail: { ...result, certId: certRow.id },
      ok: result.ok,
    });
    sendJson(res, 200, { ...result, certificate: certRow });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/ssl/certificates') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, { items: ctx.db.snapshot.certificates });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/php/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      docRoot?: string;
      phpVersion?: string;
      poolName?: string;
      enableSite?: boolean;
    };
    const result = await applyPhpHosting({
      dataDir: ctx.dataDir,
      domain: data.domain ?? 'php.local',
      docRoot: data.docRoot ?? `${ctx.dataDir}/www/php`,
      phpVersion: data.phpVersion ?? '8.2',
      poolName: data.poolName ?? 'yskphp',
      host: ctx.host,
      enableSite: data.enableSite,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.php.apply',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/ftps/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { domain?: string; install?: boolean };
    const result = await applyFtps({
      dataDir: ctx.dataDir,
      domain: data.domain ?? 'files.local',
      host: ctx.host,
      install: data.install,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.ftps.apply',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { allowSmtp?: boolean; apply?: boolean };
    const result = await applyFirewall({
      host: ctx.host,
      allowSmtp: data.allowSmtp,
      apply: data.apply,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.apply',
      detail: result,
      ok: result.ok,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/site') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      serverName?: string;
      upstream?: string;
      ssl?: boolean;
      reload?: boolean;
    };
    const result = await applyNginxSite({
      dataDir: ctx.dataDir,
      serverName: data.serverName ?? 'app.local',
      upstream: data.upstream ?? 'http://127.0.0.1:3000',
      ssl: data.ssl,
      host: ctx.host,
      reload: data.reload,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.site',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

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
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/updates/self/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; latest?: string };
    const result = await runSelfUpdate({
      currentVersion: VERSION,
      host: ctx.host,
      apply: data.apply,
      latestOverride: data.latest,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'update.self.apply',
      detail: result,
      ok: result.applied || !data.apply,
    });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
