/**
 * Package inventory + self-update status (Wave K1).
 * Extracted from updates.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  collectInventory,
  collectCatalogSoftwareUpgrades,
  adviseInventory,
  lookupOsvVulns,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

type InvRow = Record<string, unknown>;

function filterInventoryAdvice(inv: InvRow[], advice: InvRow[], url: URL) {
  const adviceByPkg = new Map(
    advice.map((a) => [String(a.packageName ?? a.name ?? ''), a]),
  );
  const enriched = inv.map((row) => {
    const name = String(row.name ?? row.package ?? row.packageName ?? '');
    const a = adviceByPkg.get(name);
    return {
      ...row,
      packageName: name,
      risk: (a?.risk as string) ?? (row.risk as string) ?? 'low',
      candidateVersion: a?.candidateVersion ?? row.candidateVersion,
      currentVersion: a?.currentVersion ?? row.version ?? row.currentVersion,
      needsApproval: Boolean(a?.needsApproval ?? row.needsApproval),
      upgradable: Boolean(
        a
          ? a.candidateVersion && a.candidateVersion !== a.currentVersion
          : row.upgradable,
      ),
    };
  });
  const { items, meta } = listWithQuery(
    url,
    enriched,
    {
      text: (r: InvRow) => [
        String(r.packageName ?? ''),
        String(r.name ?? ''),
        String(r.version ?? ''),
        String(r.candidateVersion ?? ''),
      ],
      predicates: {
        risk: (r: InvRow, v: string) => String(r.risk ?? 'low') === v,
        upgradable: (r: InvRow, v: string) => (v === '1' ? Boolean(r.upgradable) : true),
        approval: (r: InvRow, v: string) => (v === '1' ? Boolean(r.needsApproval) : true),
      },
      facetOf: {
        risk: (r: InvRow) => String(r.risk ?? 'low'),
        upgradable: (r: InvRow) => (r.upgradable ? '1' : '0'),
        approval: (r: InvRow) => (r.needsApproval ? '1' : '0'),
      },
    },
    {
      enums: {
        risk: ['high', 'medium', 'low'],
        upgradable: ['1'],
        approval: ['1'],
      },
    },
  );
  return { inventory: items, meta, advice };
}


export async function handleUpdatesInventoryRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/updates/inventory') {
        ctx.auth.authenticate(getBearer(req));
        const cached = url.searchParams.get('cached') === '1';
        if (cached) {
          const last = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
          // After package apply we mark cache stale — never serve empty/stale as truth
          const stale = Boolean(last?.stale);
          const inv = ((last?.items as unknown[]) ?? last?.sample ?? []) as InvRow[];
          const advice = ((last?.advice as unknown[]) ?? []) as InvRow[];
          if (!stale && inv.length > 0) {
            const filtered = filterInventoryAdvice(inv, advice, url);
            sendJson(res, 200, {
              cached: true,
              last,
              inventory: filtered.inventory,
              advice: filtered.advice,
              meta: { ...(typeof last?.meta === 'object' && last?.meta ? last.meta : {}), list: filtered.meta },
              listMeta: filtered.meta,
              collectedAt: (last?.at as string) ?? null,
            });
            return true;
          }
          // fall through to live collectInventory
        }
        const [{ items: inv, meta }, catalogSoftware] = await Promise.all([
          collectInventory(ctx.host),
          collectCatalogSoftwareUpgrades(ctx.host),
        ]);
        const advice = adviseInventory(inv);
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          upgradable: meta.upgradableCount,
          meta,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 120),
          advice: advice.slice(0, 120),
          catalogSoftware: catalogSoftware.slice(0, 80),
        });
        const filtered = filterInventoryAdvice(
          inv as unknown as InvRow[],
          advice as unknown as InvRow[],
          url,
        );
        sendJson(res, 200, {
          cached: false,
          inventory: filtered.inventory,
          advice: filtered.advice,
          catalogSoftware,
          meta: { ...meta, list: filtered.meta },
          listMeta: filtered.meta,
          collectedAt: new Date().toISOString(),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/updates/inventory/refresh') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { osv?: boolean; limit?: number };
        const [{ items: inv, meta }, catalogSoftware] = await Promise.all([
          collectInventory(ctx.host),
          collectCatalogSoftwareUpgrades(ctx.host),
        ]);
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
          catalogSoftware: catalogSoftware.slice(0, 80),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'update.inventory.refresh',
          detail: {
            count: inv.length,
            upgradable: meta.upgradableCount,
            catalogUpgradable: catalogSoftware.filter((c) => c.upgradable).length,
            osv: Boolean(data.osv),
            notes: meta.notes,
          },
          ok: true,
        });
        sendJson(res, 200, {
          inventory: inv,
          advice,
          catalogSoftware,
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
        sendOpsResult(res, {
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

  return false;
}
