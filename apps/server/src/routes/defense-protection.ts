/**
 * Protection set/probe/status/emergency.
 * Extracted from defense-center.ts (Wave O1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { type SystemRole } from '@ysk-server/shared';
import {
  evaluateProtection,
  runProtectionProbes,
  getPlaybook,
} from '@ysk-server/core';
import { applyProtection, type AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleDefenseProtectionRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/protection') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      networkReachable?: boolean;
      ddosSuspected?: boolean;
      forceOffline?: boolean;
      highRequestRate?: boolean;
    };
    const state = evaluateProtection({
      networkReachable: data.networkReachable ?? true,
      ddosSuspected: data.ddosSuspected,
      forceOffline: data.forceOffline,
      highRequestRate: data.highRequestRate,
    });
    applyProtection(ctx, state);
    ctx.audit.append({
      actor: user.username,
      action: 'protection.set',
      detail: state,
      ok: true,
    });
    sendJson(res, 200, ctx.protection);
    return true;
  }
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

  return false;
}
