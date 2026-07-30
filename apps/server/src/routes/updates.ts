import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  collectInventory,
  adviseInventory,
  lookupOsvVulns,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleUpdatesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— Metrics handled by handleMetricsRoutes (deep + processes + SSE) ——
      if (method === 'GET' && url.pathname === '/api/v1/updates/inventory') {
        ctx.auth.authenticate(getBearer(req));
        const cached = url.searchParams.get('cached') === '1';
        if (cached) {
          const last = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
          sendJson(res, 200, {
            cached: true,
            last,
            inventory: (last?.items as unknown[]) ?? last?.sample ?? [],
            advice: (last?.advice as unknown[]) ?? [],
            meta: last?.meta ?? null,
            collectedAt: (last?.at as string) ?? null,
          });
          return true;
        }
        const { items: inv, meta } = await collectInventory(ctx.host);
        const advice = adviseInventory(inv);
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          upgradable: meta.upgradableCount,
          meta,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 120),
          advice: advice.slice(0, 120),
        });
        sendJson(res, 200, {
          cached: false,
          inventory: inv,
          advice,
          meta,
          collectedAt: new Date().toISOString(),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/updates/inventory/refresh') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { osv?: boolean; limit?: number };
        const { items: inv, meta } = await collectInventory(ctx.host);
        let advice = adviseInventory(inv);
        if (data.osv) {
          // Prefer packages that actually have upgrades, then rest
          const ordered = [
            ...advice.filter((a) => a.candidateVersion !== a.currentVersion),
            ...advice.filter((a) => a.candidateVersion === a.currentVersion),
          ];
          const limit = Math.min(data.limit ?? 12, 20);
          for (const item of ordered.slice(0, limit)) {
            const cves = await lookupOsvVulns(item.packageName, item.currentVersion);
            if (cves.length) {
              item.cves = cves;
              item.summary = `${item.summary}；OSV: ${cves.slice(0, 3).join(', ')}`;
              if (item.risk === 'low' && cves.some((c) => /HIGH|CRITICAL/i.test(c))) {
                item.risk = 'high';
                item.requiresApproval = true;
              }
            }
          }
          advice = ordered;
        }
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          upgradable: meta.upgradableCount,
          meta,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 120),
          advice: advice.slice(0, 120),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'update.inventory.refresh',
          detail: {
            count: inv.length,
            upgradable: meta.upgradableCount,
            osv: Boolean(data.osv),
            notes: meta.notes,
          },
          ok: true,
        });
        sendJson(res, 200, {
          inventory: inv,
          advice,
          meta,
          collectedAt: new Date().toISOString(),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/updates/self') {
        ctx.auth.authenticate(getBearer(req));
        const { checkSelfUpdate } = await import('@ysk/core');
        const status = await checkSelfUpdate({ currentVersion: VERSION });
        // Flatten for panel: never pretend latest=current without a real channel check
        sendJson(res, status.ok ? 200 : 502, {
          currentVersion: status.currentVersion,
          latestVersion: status.latestVersion,
          updateAvailable: status.updateAvailable,
          lastCheckAt: status.lastCheckAt,
          channel: status.channel,
          packageName: status.packageName,
          ok: status.ok,
          checked: status.checked,
          notes: status.notes,
          steps: status.steps,
          plan: status.plan,
          registry: status.registry,
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/updates/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          packageName?: string;
          currentVersion?: string;
          candidateVersion?: string;
          risk?: string;
          advice?: string;
          requiresApproval?: boolean;
          cves?: string[];
          summary?: string;
          confirmHighRisk?: boolean;
        };
        const { applyPackageUpdate, planUpdateExecution, adviseUpdate } = await import('@ysk/core');
        if (
          !data.candidateVersion ||
          !data.packageName ||
          data.candidateVersion === data.currentVersion
        ) {
          sendJson(res, 422, {
            ok: false,
            blocked: true,
            applied: false,
            blockMessage: tl('notes.auto.n1581'),
            notes: [tl('notes.auto.n0780')],
          });
          return true;
        }
        const item = adviseUpdate({
          packageName: data.packageName ?? '',
          currentVersion: data.currentVersion ?? '0',
          candidateVersion: data.candidateVersion,
          knownCves: data.cves,
          hasSecurityFix: Boolean(data.cves?.length),
        });
        // Preserve client risk signals when present
        if (data.risk) (item as { risk: string }).risk = data.risk;
        if (data.requiresApproval != null) item.requiresApproval = data.requiresApproval;
        if (data.summary) item.summary = data.summary;
        const plan = planUpdateExecution(item);
        const result = await applyPackageUpdate({
          host: ctx.host,
          item,
          confirmHighRisk: data.confirmHighRisk,
        });
        ctx.db.snapshot.update_jobs.unshift({
          id: randomUUID(),
          packageName: item.packageName,
          at: new Date().toISOString(),
          actor: user.username,
          ok: result.ok,
          applied: result.applied,
          notes: result.notes,
          plan,
        } as never);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'update.package.apply',
          resource: item.packageName,
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/scheduler') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { jobs: ctx.scheduler.list() });
        return true;
      }
  return false;
}
