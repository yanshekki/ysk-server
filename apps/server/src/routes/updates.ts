import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
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
          stream?: boolean;
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
        const wantStream =
          Boolean((data as { stream?: boolean }).stream) ||
          String(req.headers.accept || '').includes('text/event-stream') ||
          url.searchParams.get('stream') === '1';

        const runApply = async (hooks?: {
          onLog?: (ev: { stream: 'stdout' | 'stderr'; line: string }) => void;
          abortSignal?: AbortSignal;
        }) => {
          const result = await applyPackageUpdate({
            host: ctx.host,
            item,
            confirmHighRisk: data.confirmHighRisk,
            onLog: hooks?.onLog,
            abortSignal: hooks?.abortSignal,
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
          if (result.ok && result.applied) {
            try {
              ctx.settings.setJson('last_inventory', {
                at: new Date().toISOString(),
                stale: true,
                items: [],
                advice: [],
                sample: [],
                count: 0,
                upgradable: 0,
              });
            } catch {
              /* ignore */
            }
          }
          return result;
        };

        if (wantStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(`: ysk-updates-apply-stream\n\n`);
          let closed = false;
          const abortCtl = new AbortController();
          const send = (event: string, payload: unknown) => {
            if (closed || res.writableEnded) return;
            try {
              res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
            } catch {
              closed = true;
            }
          };
          req.on('close', () => {
            closed = true;
            try {
              abortCtl.abort();
            } catch {
              /* */
            }
          });
          send('status', { phase: 'running', packageName: item.packageName });
          try {
            const result = await runApply({
              abortSignal: abortCtl.signal,
              onLog: (ev) => {
                if (!closed)
                  send('log', {
                    stream: ev.stream,
                    line: ev.line,
                    at: new Date().toISOString(),
                  });
              },
            });
            send('status', {
              phase: result.blocked ? 'blocked' : result.ok ? 'done' : 'failed',
            });
            send('result', result);
            send('end', { reason: 'complete', ok: result.ok });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            send('status', { phase: 'failed' });
            send('result', { ok: false, applied: false, notes: [message] });
            send('end', { reason: 'error', message });
          }
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
              /* */
            }
          }
          return true;
        }

        sendOpsResult(res, await runApply());
        return true;
      }

      // —— Bulk package apply (sequential, capped) ——
      if (method === 'POST' && url.pathname === '/api/v1/updates/apply-batch') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          packages?: Array<{
            packageName?: string;
            currentVersion?: string;
            candidateVersion?: string;
            risk?: string;
            requiresApproval?: boolean;
            cves?: string[];
            summary?: string;
          }>;
          confirmHighRisk?: boolean;
          stream?: boolean;
        };
        const { applyPackageUpdateBatch, adviseUpdate } = await import('@ysk/core');
        type BatchRow = {
          packageName: string;
          currentVersion: string;
          candidateVersion?: string;
          risk?: string;
          requiresApproval?: boolean;
          cves?: string[];
          summary?: string;
        };
        const packages = (data.packages ?? [])
          .filter(
            (p) =>
              p.packageName &&
              p.currentVersion &&
              p.candidateVersion &&
              p.candidateVersion !== p.currentVersion,
          )
          .slice(0, 40)
          .map((p) => ({
            packageName: String(p.packageName),
            currentVersion: String(p.currentVersion),
            candidateVersion: String(p.candidateVersion),
            risk: p.risk,
            requiresApproval: p.requiresApproval,
            cves: p.cves,
            summary: p.summary,
          }));

        if (!packages.length) {
          sendJson(res, 422, {
            ok: false,
            appliedCount: 0,
            failedCount: 0,
            results: [],
            notes: [tl('notes.auto.n0780')],
            blockMessage: tl('notes.auto.n1581'),
          });
          return true;
        }

        const toItem = (row: BatchRow) => {
            const item = adviseUpdate({
              packageName: row.packageName,
              currentVersion: row.currentVersion,
              candidateVersion: row.candidateVersion ?? row.currentVersion,
              knownCves: row.cves,
              hasSecurityFix: Boolean(row.cves?.length),
            });
            if (row.risk) (item as { risk: string }).risk = row.risk;
            if (row.requiresApproval != null) item.requiresApproval = row.requiresApproval;
            if (row.summary) item.summary = row.summary;
            return item;
        };

        const wantStream =
          data.stream === true ||
          String(req.headers.accept || '').includes('text/event-stream') ||
          url.searchParams.get('stream') === '1';

        if (wantStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(`: ysk-updates-batch-stream\n\n`);
          let closed = false;
          const abortCtl = new AbortController();
          const send = (event: string, payload: unknown) => {
            if (closed || res.writableEnded) return;
            try {
              res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
            } catch {
              closed = true;
            }
          };
          req.on('close', () => {
            closed = true;
            try {
              abortCtl.abort();
            } catch {
              /* */
            }
          });
          send('status', { phase: 'running', total: packages.length });
          try {
            const batch = await applyPackageUpdateBatch({
              host: ctx.host,
              items: packages,
              confirmHighRisk: data.confirmHighRisk,
              toItem,
              abortSignal: abortCtl.signal,
              onLog: (ev) => {
                if (!closed)
                  send('log', {
                    stream: ev.stream,
                    line: ev.line,
                    at: new Date().toISOString(),
                  });
              },
              onItemDone: (row) => {
                if (!closed) send('item', row);
              },
            });
            if (batch.appliedCount > 0) {
              try {
                ctx.settings.setJson('last_inventory', {
                  at: new Date().toISOString(),
                  stale: true,
                  items: [],
                  advice: [],
                  sample: [],
                  count: 0,
                  upgradable: 0,
                });
              } catch {
                /* */
              }
            }
            ctx.audit.append({
              actor: user.username,
              action: 'update.package.apply-batch',
              detail: {
                ok: batch.ok,
                appliedCount: batch.appliedCount,
                failedCount: batch.failedCount,
                stream: true,
              },
              ok: batch.ok,
            });
            send('status', { phase: batch.ok ? 'done' : 'failed' });
            send('result', batch);
            send('end', { reason: 'complete', ok: batch.ok });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            send('status', { phase: 'failed' });
            send('result', { ok: false, appliedCount: 0, failedCount: 0, notes: [message] });
            send('end', { reason: 'error', message });
          }
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
              /* */
            }
          }
          return true;
        }

        const batch = await applyPackageUpdateBatch({
          host: ctx.host,
          items: packages,
          confirmHighRisk: data.confirmHighRisk,
          toItem,
        });

        for (const r of batch.results) {
          ctx.db.snapshot.update_jobs.unshift({
            id: randomUUID(),
            packageName: r.packageName,
            at: new Date().toISOString(),
            actor: user.username,
            ok: r.ok,
            applied: r.applied,
            notes: r.notes,
          } as never);
        }
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'update.package.apply_batch',
          detail: {
            count: packages.length,
            appliedCount: batch.appliedCount,
            failedCount: batch.failedCount,
            ok: batch.ok,
          },
          ok: batch.ok,
        });
        // Always mark inventory cache stale after batch so UI cannot re-show old upgrades
        if (batch.appliedCount > 0) {
          try {
            ctx.settings.setJson('last_inventory', {
              at: new Date().toISOString(),
              stale: true,
              items: [],
              advice: [],
              sample: [],
              count: 0,
              upgradable: 0,
            });
          } catch {
            /* ignore */
          }
        }
        sendJson(res, batch.ok ? 200 : batch.appliedCount > 0 ? 207 : 422, batch);
        return true;
      }

      if (method === 'GET' && url.pathname === '/api/v1/scheduler') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { jobs: ctx.scheduler.list() });
        return true;
      }
  return false;
}
