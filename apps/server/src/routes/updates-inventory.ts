/**
 * Package inventory + self-update status (Wave K1).
 * Extracted from updates.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  collectInventory,
  collectCatalogSoftwareUpgrades,
  collectUpdateHub,
  adviseInventory,
  lookupOsvVulns,
  buildUpdatesSummary,
  normalizeUpdatesScanSettings,
  DEFAULT_UPDATES_SCAN,
  checkSelfUpdate,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { VERSION } from '../version.js';
import {
  getBearer,
  readBody,
  sendJson,
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
  const kept = new Set(items.map((r) => String(r.packageName ?? '')));
  const filteredAdvice =
    url.searchParams.get('q') ||
    url.searchParams.get('risk') ||
    url.searchParams.get('upgradable') ||
    url.searchParams.get('approval')
      ? advice.filter((a) => kept.has(String(a.packageName ?? a.name ?? '')))
      : advice;
  return { inventory: items, meta, advice: filteredAdvice };
}


function persistUpdatesSummary(ctx: AppContext) {
  const scanCfg = normalizeUpdatesScanSettings(
    ctx.settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
  );
  const job = ctx.scheduler.list().find((j) => j.id === 'updates.scan');
  const summary = buildUpdatesSummary({
    lastInventory: ctx.settings.getJson('last_inventory'),
    lastSelf: ctx.settings.getJson('last_self_update'),
    scanSettings: scanCfg,
    nextScanAt: job?.nextRunAt ?? null,
  });
  ctx.settings.setJson('updates_summary', summary);
  return summary;
}

export async function handleUpdatesInventoryRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/updates/summary') {
        ctx.auth.authenticate(getBearer(req));
        const summary = persistUpdatesSummary(ctx);
        sendJson(res, 200, { ok: true, ...summary });
        return true;
      }

      if (method === 'GET' && url.pathname === '/api/v1/updates/scan-settings') {
        ctx.auth.authenticate(getBearer(req));
        const settings = normalizeUpdatesScanSettings(
          ctx.settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
        );
        const job = ctx.scheduler.list().find((j) => j.id === 'updates.scan');
        sendJson(res, 200, {
          ok: true,
          settings,
          job: job
            ? {
                id: job.id,
                intervalMs: job.intervalMs,
                lastRunAt: job.lastRunAt ?? null,
                nextRunAt: job.nextRunAt ?? null,
                running: job.running,
              }
            : null,
        });
        return true;
      }

      if (method === 'PATCH' && url.pathname === '/api/v1/updates/scan-settings') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          enabled?: boolean;
          intervalMs?: number;
        };
        const prev = normalizeUpdatesScanSettings(
          ctx.settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
        );
        const next = normalizeUpdatesScanSettings({
          enabled: data.enabled !== undefined ? data.enabled : prev.enabled,
          intervalMs:
            data.intervalMs !== undefined ? data.intervalMs : prev.intervalMs,
        });
        ctx.settings.setJson('updates_scan_settings', next);
        persistUpdatesSummary(ctx);
        ctx.audit.append({
          actor: user.username,
          action: 'update.scan.settings',
          detail: next,
          ok: true,
        });
        sendJson(res, 200, { ok: true, settings: next });
        return true;
      }

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
              entries: (last?.entries as unknown[]) ?? [],
              meta: { ...(typeof last?.meta === 'object' && last?.meta ? last.meta : {}), list: filtered.meta },
              listMeta: filtered.meta,
              collectedAt: (last?.at as string) ?? null,
            });
            return true;
          }
          // fall through to live collectInventory
        }
        const [{ items: inv, meta }, catalogSoftware, hub] = await Promise.all([
          collectInventory(ctx.host),
          collectCatalogSoftwareUpgrades(ctx.host),
          collectUpdateHub({
            host: ctx.host,
            dataDir: ctx.dataDir,
            currentPanelVersion: VERSION,
          }),
        ]);
        const advice = adviseInventory(inv);
        ctx.settings.setJson('last_inventory', {
          at: new Date().toISOString(),
          count: inv.length,
          upgradable: meta.upgradableCount,
          meta,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 500),
          advice: advice.slice(0, 500),
          catalogSoftware: catalogSoftware.slice(0, 80),
          entries: hub.entries,
          stale: false,
        });
        persistUpdatesSummary(ctx);
        ctx.scheduler.touchLastRun('updates.scan');
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
          entries: hub.entries,
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
        const [{ items: inv, meta }, catalogSoftware, hub] = await Promise.all([
          collectInventory(ctx.host),
          collectCatalogSoftwareUpgrades(ctx.host),
          collectUpdateHub({
            host: ctx.host,
            dataDir: ctx.dataDir,
            currentPanelVersion: VERSION,
            refreshRuntimes: true,
          }),
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
          entries: hub.entries,
          stale: false,
        });
        ctx.scheduler.touchLastRun('updates.scan');
        // Refresh panel status into cache (best-effort) so summary badge stays honest
        try {
          const status = await checkSelfUpdate({ currentVersion: VERSION });
          ctx.settings.setJson('last_self_update', {
            currentVersion: status.currentVersion,
            latestVersion: status.latestVersion,
            updateAvailable: status.updateAvailable,
            lastCheckAt: status.lastCheckAt,
            channel: status.channel,
            ok: status.ok,
            checked: status.checked,
          });
        } catch {
          /* keep previous last_self_update */
        }
        const summary = persistUpdatesSummary(ctx);
        ctx.audit.append({
          actor: user.username,
          action: 'update.inventory.refresh',
          detail: {
            count: inv.length,
            upgradable: meta.upgradableCount,
            catalogUpgradable: catalogSoftware.filter((c) => c.upgradable).length,
            badgeCount: summary.badgeCount,
            osv: Boolean(data.osv),
            notes: meta.notes,
          },
          ok: true,
        });
        sendJson(res, 200, {
          inventory: inv,
          advice,
          catalogSoftware,
          entries: hub.entries,
          meta,
          summary,
          collectedAt: new Date().toISOString(),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/updates/self') {
        ctx.auth.authenticate(getBearer(req));
        const status = await checkSelfUpdate({ currentVersion: VERSION });
        ctx.settings.setJson('last_self_update', {
          currentVersion: status.currentVersion,
          latestVersion: status.latestVersion,
          updateAvailable: status.updateAvailable,
          lastCheckAt: status.lastCheckAt,
          channel: status.channel,
          ok: status.ok,
          checked: status.checked,
        });
        persistUpdatesSummary(ctx);
        // Status GET must stay 200 even when the npm channel check failed.
        // sendOpsResult would 422 and the panel treats that as an apply error.
        sendJson(res, 200, {
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
